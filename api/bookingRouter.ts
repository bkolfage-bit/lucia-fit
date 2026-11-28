import { z } from "zod";
import { and, eq, gte, lte, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { blockedSlots, bookings } from "@db/schema";
import { ALL_TIMES, SERVICE_IDS, VENMO_USERNAME, getBookableDates, getService, getSessionPrice, sessionsOverlap, supportsDuration } from "@contracts/training";
import { getStripe, isStripeEnabled } from "./stripe";
import { log } from "./lib/logger";

// The blocked_slots table is applied to production by hand (SQL is run before
// the code that needs it deploys). If it is ever missing — a deploy race, a
// fresh dev database — public booking must keep working with zero blocks
// rather than 500ing the whole site's availability.
async function safeBlocks(query: () => Promise<{ blockDate: string; startTime: string | null }[]>) {
  try {
    return await query();
  } catch (error) {
    log.warn("blocked_slots unavailable, continuing without blocks", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [] as { blockDate: string; startTime: string | null }[];
  }
}

function blocksForDate(blocks: { blockDate: string; startTime: string | null }[], date: string) {
  return blocks.filter((block) => block.blockDate === date);
}

function isBlocked(
  blocks: { blockDate: string; startTime: string | null }[],
  startTime: string,
  duration: number,
) {
  return blocks.some(
    (block) =>
      block.startTime === null || sessionsOverlap(startTime, duration, block.startTime, 30),
  );
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.enum(ALL_TIMES);
const durationSchema = z.union([z.literal(45), z.literal(60), z.literal(120)]);

function assertBookableDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a valid session date." });
  }
  if (date.getDay() === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Sundays are rest days. Choose another date." });
  }
  if (!getBookableDates().includes(value)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a date within the 30-day booking window." });
  }
}

const bookingInput = z.object({
  serviceId: z.enum(SERVICE_IDS),
  sessionDate: dateSchema,
  startTime: timeSchema,
  duration: durationSchema.optional(),
  participants: z.union([z.literal(1), z.literal(2)]),
  customerName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().min(7).max(40),
  address: z.string().trim().min(5).max(800),
  goals: z.string().trim().max(1200).optional(),
  notes: z.string().trim().max(1200).optional(),
  paymentMethod: z.enum(["stripe", "venmo", "pay_later"]),
});

export const bookingRouter = createRouter({
  paymentConfig: publicQuery.query(() => ({
    stripeEnabled: isStripeEnabled(),
    venmoRecipient: `@${VENMO_USERNAME}`,
  })),

  availability: publicQuery
    .input(z.object({ date: dateSchema, duration: durationSchema }))
    .query(async ({ input }) => {
      assertBookableDate(input.date);
      const db = getDb();
      const taken = await db
        .select({ startTime: bookings.startTime, duration: bookings.duration })
        .from(bookings)
        .where(and(eq(bookings.sessionDate, input.date), ne(bookings.bookingStatus, "cancelled")));
      const blocks = blocksForDate(
        await safeBlocks(() =>
          db
            .select({ blockDate: blockedSlots.blockDate, startTime: blockedSlots.startTime })
            .from(blockedSlots)
            .where(eq(blockedSlots.blockDate, input.date)),
        ),
        input.date,
      );
      return ALL_TIMES.map((time) => {
        if (isBlocked(blocks, time, input.duration)) {
          return { time, available: false, status: "blocked" as const };
        }
        if (taken.some((slot) => sessionsOverlap(time, input.duration, slot.startTime, slot.duration))) {
          return { time, available: false, status: "booked" as const };
        }
        return { time, available: true, status: "available" as const };
      });
    }),

  // Dates in the booking window that Lucia has blocked off entirely, so the
  // date picker can disable them up front instead of after the fact.
  blockedDays: publicQuery.query(async () => {
    const window = getBookableDates();
    const rows = await safeBlocks(() =>
      getDb()
        .select({ blockDate: blockedSlots.blockDate, startTime: blockedSlots.startTime })
        .from(blockedSlots)
        .where(
          and(
            gte(blockedSlots.blockDate, window[0]),
            lte(blockedSlots.blockDate, window[window.length - 1]),
          ),
        ),
    );
    const wholeDays = new Set(rows.filter((row) => row.startTime === null).map((row) => row.blockDate));
    // A day whose every slot is individually blocked is effectively closed too.
    const perDay = new Map<string, number>();
    for (const row of rows) {
      if (row.startTime !== null) perDay.set(row.blockDate, (perDay.get(row.blockDate) ?? 0) + 1);
    }
    for (const [date, count] of perDay) {
      if (count >= ALL_TIMES.length) wholeDays.add(date);
    }
    return window.filter((date) => wholeDays.has(date));
  }),

  create: publicQuery.input(bookingInput).mutation(async ({ input, ctx }) => {
    assertBookableDate(input.sessionDate);
    const service = getService(input.serviceId);
    if (!service) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a valid session." });
    const duration = input.duration ?? service.duration;
    if (!supportsDuration(service, duration)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Choose an available session length." });
    }
    const amountCents = getSessionPrice(service, input.participants, duration);
    if (input.paymentMethod === "stripe" && !isStripeEnabled()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Card checkout is not connected yet. Choose pay at session.",
      });
    }
    const db = getDb();
    const dayBookings = await db
      .select({
        id: bookings.id,
        startTime: bookings.startTime,
        duration: bookings.duration,
        bookingStatus: bookings.bookingStatus,
      })
      .from(bookings)
      .where(eq(bookings.sessionDate, input.sessionDate));

    const conflict = dayBookings.find(
      (booking) =>
        booking.bookingStatus !== "cancelled" &&
        sessionsOverlap(input.startTime, duration, booking.startTime, booking.duration),
    );
    if (conflict) {
      throw new TRPCError({ code: "CONFLICT", message: "That session overlaps another booking. Please choose another time." });
    }

    const blocks = blocksForDate(
      await safeBlocks(() =>
        db
          .select({ blockDate: blockedSlots.blockDate, startTime: blockedSlots.startTime })
          .from(blockedSlots)
          .where(eq(blockedSlots.blockDate, input.sessionDate)),
      ),
      input.sessionDate,
    );
    if (isBlocked(blocks, input.startTime, duration)) {
      throw new TRPCError({ code: "CONFLICT", message: "That time is blocked off. Please choose another time." });
    }
    const cancelledAtStart = dayBookings.find(
      (booking) => booking.startTime === input.startTime && booking.bookingStatus === "cancelled",
    );
    if (cancelledAtStart) await db.delete(bookings).where(eq(bookings.id, cancelledAtStart.id));

    const manageToken = crypto.randomUUID();
    const [{ id }] = await db
      .insert(bookings)
      .values({
        serviceId: service.id,
        serviceName: service.name,
        duration,
        amountCents,
        sessionDate: input.sessionDate,
        startTime: input.startTime,
        customerName: input.customerName,
        email: input.email,
        phone: input.phone,
        address: input.address,
        goals: input.goals || null,
        notes: input.notes || null,
        paymentMethod: input.paymentMethod,
        paymentStatus: input.paymentMethod === "pay_later" ? "unpaid" : "pending",
        bookingStatus: input.paymentMethod === "pay_later" ? "confirmed" : "pending",
        manageToken,
      })
      .$returningId();

    let checkoutUrl: string | null = null;
    if (input.paymentMethod === "stripe") {
      const stripe = getStripe();
      if (!stripe) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Payment setup failed." });
      const origin = new URL(ctx.req.url).origin;
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: input.email,
        client_reference_id: String(id),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: amountCents,
              product_data: {
                name: `${service.name} with Lucia Nuzzi`,
                description: `${input.sessionDate} at ${input.startTime} · ${duration} minutes · At-home training for ${input.participants} ${input.participants === 1 ? "person" : "people"}`,
              },
            },
          },
        ],
        metadata: { bookingId: String(id), manageToken, participants: String(input.participants), duration: String(duration) },
        success_url: `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}&booking=${manageToken}#book`,
        cancel_url: `${origin}/?payment=cancelled&booking=${manageToken}#book`,
      });
      await db
        .update(bookings)
        .set({ stripeSessionId: session.id, paymentStatus: "pending", bookingStatus: "pending" })
        .where(eq(bookings.id, id));
      checkoutUrl = session.url;
      if (!checkoutUrl) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe did not return a checkout URL." });
      }
    }

    return { bookingId: id, manageToken, checkoutUrl, paymentMethod: input.paymentMethod };
  }),

  byToken: publicQuery
    .input(z.object({ token: z.string().uuid() }))
    .query(async ({ input }) => {
      const [booking] = await getDb().select().from(bookings).where(eq(bookings.manageToken, input.token)).limit(1);
      if (!booking) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
      const service = getService(booking.serviceId);
      const participants: 1 | 2 =
        service && booking.amountCents === getSessionPrice(service, 2, booking.duration) ? 2 : 1;
      return { ...booking, participants };
    }),

  verifyPayment: publicQuery
    .input(z.object({ token: z.string().uuid(), sessionId: z.string().min(5).max(255) }))
    .mutation(async ({ input }) => {
      const stripe = getStripe();
      if (!stripe) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Card checkout is not connected." });
      const db = getDb();
      const [booking] = await db.select().from(bookings).where(eq(bookings.manageToken, input.token)).limit(1);
      if (!booking || booking.stripeSessionId !== input.sessionId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Payment session not found." });
      }
      const session = await stripe.checkout.sessions.retrieve(input.sessionId);
      if (session.payment_status !== "paid") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Payment has not completed yet." });
      }
      await db
        .update(bookings)
        .set({ paymentStatus: "paid", bookingStatus: "confirmed" })
        .where(eq(bookings.id, booking.id));
      return { paid: true, bookingId: booking.id };
    }),

  cancel: publicQuery
    .input(z.object({ token: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [booking] = await db.select().from(bookings).where(eq(bookings.manageToken, input.token)).limit(1);
      if (!booking) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
      if (booking.paymentStatus === "paid" || booking.paymentStatus === "processing") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Paid or processing sessions need to be changed directly with Lucia." });
      }
      await db.update(bookings).set({ bookingStatus: "cancelled" }).where(eq(bookings.id, booking.id));
      return { cancelled: true };
    }),
});
