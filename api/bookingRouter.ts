import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { bookings } from "@db/schema";
import { ALL_TIMES, SERVICE_IDS, getService, getSessionPrice, sessionsOverlap, supportsDuration } from "@contracts/training";
import { getStripe, isStripeEnabled } from "./stripe";
import { getBraintree, getBraintreeMerchantAccountId, getVenmoProfileId, isVenmoEnabled } from "./braintree";

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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lastDay = new Date(today);
  lastDay.setDate(lastDay.getDate() + 60);
  if (date < today || date > lastDay) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a date within the next 60 days." });
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
    venmoEnabled: isVenmoEnabled(),
    venmoProfileId: getVenmoProfileId(),
  })),

  venmoClientToken: publicQuery.query(async () => {
    const braintree = getBraintree();
    if (!braintree) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Venmo checkout is not connected." });
    }
    const response = await braintree.clientToken.generate({});
    if (!response.success || !response.clientToken) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Venmo checkout could not be initialized." });
    }
    return { clientToken: response.clientToken };
  }),

  availability: publicQuery
    .input(z.object({ date: dateSchema, duration: durationSchema }))
    .query(async ({ input }) => {
      assertBookableDate(input.date);
      const taken = await getDb()
        .select({ startTime: bookings.startTime, duration: bookings.duration })
        .from(bookings)
        .where(and(eq(bookings.sessionDate, input.date), ne(bookings.bookingStatus, "cancelled")));
      return ALL_TIMES.filter(
        (time) => !taken.some((slot) => sessionsOverlap(time, input.duration, slot.startTime, slot.duration)),
      ).map((time) => ({ time, available: true }));
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
    if (input.paymentMethod === "venmo" && !isVenmoEnabled()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Venmo checkout is not connected yet. Choose pay at session.",
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

  payVenmo: publicQuery
    .input(
      z.object({
        token: z.string().uuid(),
        paymentMethodNonce: z.string().min(1).max(1000),
        deviceData: z.string().max(10000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const braintree = getBraintree();
      if (!braintree) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Venmo checkout is not connected." });
      }
      const db = getDb();
      const [booking] = await db.select().from(bookings).where(eq(bookings.manageToken, input.token)).limit(1);
      if (!booking || booking.paymentMethod !== "venmo") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Venmo booking not found." });
      }
      if (booking.bookingStatus === "cancelled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This reservation has been cancelled." });
      }
      if (booking.paymentStatus === "paid") {
        return {
          paid: true,
          bookingId: booking.id,
          transactionId: booking.braintreeTransactionId,
          venmoUsername: booking.venmoUsername,
        };
      }
      if (booking.paymentStatus !== "pending") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This Venmo payment needs review. Contact Lucia before trying again.",
        });
      }

      const service = getService(booking.serviceId);
      const validAmounts = service
        ? [getSessionPrice(service, 1, booking.duration), getSessionPrice(service, 2, booking.duration)]
        : [];
      if (!validAmounts.includes(booking.amountCents)) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The booking total needs review." });
      }

      const [claim] = await db
        .update(bookings)
        .set({ paymentStatus: "processing" })
        .where(and(eq(bookings.id, booking.id), eq(bookings.paymentStatus, "pending")));
      if (claim.affectedRows !== 1) {
        throw new TRPCError({ code: "CONFLICT", message: "This payment is already being processed." });
      }

      let result;
      try {
        const nameParts = booking.customerName.trim().split(/\s+/);
        const profileId = getVenmoProfileId();
        result = await braintree.transaction.sale({
          amount: (booking.amountCents / 100).toFixed(2),
          paymentMethodNonce: input.paymentMethodNonce,
          deviceData: input.deviceData || undefined,
          merchantAccountId: getBraintreeMerchantAccountId(),
          orderId: `LN-${booking.id}-${booking.manageToken.slice(0, 8)}`,
          customer: {
            firstName: nameParts.shift() || booking.customerName,
            lastName: nameParts.join(" ") || undefined,
            email: booking.email,
            phone: booking.phone,
          },
          options: {
            submitForSettlement: true,
            ...(profileId ? { venmo: { profileId } } : {}),
          },
        });
      } catch {
        // A network failure can be ambiguous. Keep the processing lock so a retry cannot double-charge.
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "We couldn’t confirm the Venmo payment. Contact Lucia before retrying so you aren’t charged twice.",
        });
      }

      if (!result.success || !result.transaction) {
        await db
          .update(bookings)
          .set({ paymentStatus: "pending" })
          .where(and(eq(bookings.id, booking.id), eq(bookings.paymentStatus, "processing")));
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Venmo didn’t approve the payment. No payment was recorded; you can try again or cancel the reservation.",
        });
      }

      const transaction = result.transaction;
      const venmoUsername = transaction.venmoAccount?.username || null;
      await db
        .update(bookings)
        .set({
          paymentStatus: "paid",
          bookingStatus: "confirmed",
          braintreeTransactionId: transaction.id,
          venmoUsername,
        })
        .where(eq(bookings.id, booking.id));

      return { paid: true, bookingId: booking.id, transactionId: transaction.id, venmoUsername };
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
