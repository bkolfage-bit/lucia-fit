import { z } from "zod";
import { and, asc, desc, eq, gte, lt, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { adminProcedure, createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { blockedSlots, bookings } from "@db/schema";
import { ALL_TIMES } from "@contracts/training";
import {
  clearedCookie,
  isAdminConfigured,
  sessionCookie,
  sessionFromRequest,
  verifyPasscode,
} from "./lib/admin";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.enum(ALL_TIMES);

function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

// RFC 4180: quote anything containing a comma, quote, or newline.
function csvCell(value: string | number): string {
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function assertValidDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a valid date." });
  }
  if (value < localToday()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That date is in the past." });
  }
}

// The blocked_slots table is applied to the production database by hand (the
// developer runs db/blocked_slots.sql before the deploy goes live). Until it
// exists, admin reads should degrade to "no blocks" and writes should fail
// with a clear setup message — never a raw 500.
async function readBlocks<T>(query: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await query();
  } catch {
    return fallback;
  }
}

async function writeBlocks<T>(query: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Blocked time isn’t set up in the database yet — run the blocked_slots SQL first.",
    });
  }
}

export const adminRouter = createRouter({
  login: publicQuery
    .input(z.object({ passcode: z.string().min(1).max(200) }))
    .mutation(({ input, ctx }) => {
      if (!isAdminConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Admin is not configured on this server yet.",
        });
      }
      if (!verifyPasscode(input.passcode)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "That passcode is not correct." });
      }
      ctx.resHeaders.append("Set-Cookie", sessionCookie());
      return { ok: true };
    }),

  logout: publicQuery.mutation(({ ctx }) => {
    ctx.resHeaders.append("Set-Cookie", clearedCookie());
    return { ok: true };
  }),

  session: publicQuery.query(({ ctx }) => ({
    configured: isAdminConfigured(),
    authenticated: sessionFromRequest(ctx.req),
  })),

  overview: adminProcedure.query(async () => {
    const db = getDb();
    const today = localToday();
    const rows = await db
      .select({
        id: bookings.id,
        email: bookings.email,
        sessionDate: bookings.sessionDate,
        paymentStatus: bookings.paymentStatus,
        bookingStatus: bookings.bookingStatus,
      })
      .from(bookings)
      .where(ne(bookings.bookingStatus, "cancelled"));
    const upcoming = rows.filter((row) => row.sessionDate >= today);
    const blocks = await readBlocks(
      () =>
        db
          .select({ id: blockedSlots.id })
          .from(blockedSlots)
          .where(gte(blockedSlots.blockDate, today)),
      [] as { id: number }[],
    );
    return {
      upcomingSessions: upcoming.length,
      pendingPayments: upcoming.filter((row) => row.paymentStatus !== "paid").length,
      clients: new Set(rows.map((row) => row.email.toLowerCase())).size,
      blockedEntries: blocks.length,
    };
  }),

  bookings: adminProcedure
    .input(z.object({ filter: z.enum(["upcoming", "past", "all"]).default("upcoming") }))
    .query(async ({ input }) => {
      const db = getDb();
      const today = localToday();
      const conditions = [ne(bookings.bookingStatus, "cancelled")];
      if (input.filter === "upcoming") conditions.push(gte(bookings.sessionDate, today));
      if (input.filter === "past") conditions.push(lt(bookings.sessionDate, today));
      const rows = await db
        .select()
        .from(bookings)
        .where(and(...conditions))
        .orderBy(
          input.filter === "past"
            ? desc(bookings.sessionDate)
            : asc(bookings.sessionDate),
          asc(bookings.startTime),
        );
      return rows.map((row) => ({ ...row, manageToken: undefined }));
    }),

  updateBooking: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        action: z.enum(["mark_paid", "mark_unpaid", "confirm", "complete", "cancel"]),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const [booking] = await db.select().from(bookings).where(eq(bookings.id, input.id)).limit(1);
      if (!booking) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
      const patch: Partial<typeof bookings.$inferInsert> = {};
      switch (input.action) {
        case "mark_paid":
          patch.paymentStatus = "paid";
          if (booking.bookingStatus === "pending") patch.bookingStatus = "confirmed";
          break;
        case "mark_unpaid":
          patch.paymentStatus = booking.paymentMethod === "pay_later" ? "unpaid" : "pending";
          break;
        case "confirm":
          patch.bookingStatus = "confirmed";
          break;
        case "complete":
          patch.bookingStatus = "completed";
          break;
        case "cancel":
          patch.bookingStatus = "cancelled";
          break;
      }
      await db.update(bookings).set(patch).where(eq(bookings.id, input.id));
      return { ok: true };
    }),

  blocks: adminProcedure.query(async () => {
    return readBlocks(
      () =>
        getDb()
          .select()
          .from(blockedSlots)
          .where(gte(blockedSlots.blockDate, localToday()))
          .orderBy(asc(blockedSlots.blockDate), asc(blockedSlots.startTime)),
      [] as (typeof blockedSlots.$inferSelect)[],
    );
  }),

  addBlock: adminProcedure
    .input(
      z.object({
        date: dateSchema,
        time: timeSchema.nullish(),
        reason: z.string().trim().max(200).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      assertValidDate(input.date);
      return writeBlocks(async () => {
        const db = getDb();
        const existing = await db
          .select()
          .from(blockedSlots)
          .where(eq(blockedSlots.blockDate, input.date));
        const wholeDay = existing.find((row) => row.startTime === null);
        if (!input.time) {
          if (wholeDay) {
            throw new TRPCError({ code: "CONFLICT", message: "That day is already fully blocked." });
          }
          // A full-day block supersedes any per-slot blocks for that date.
          if (existing.length) {
            await db.delete(blockedSlots).where(eq(blockedSlots.blockDate, input.date));
          }
          await db.insert(blockedSlots).values({
            blockDate: input.date,
            startTime: null,
            reason: input.reason || null,
          });
          return { ok: true };
        }
        if (wholeDay) {
          throw new TRPCError({ code: "CONFLICT", message: "The whole day is already blocked." });
        }
        if (existing.some((row) => row.startTime === input.time)) {
          throw new TRPCError({ code: "CONFLICT", message: "That time is already blocked." });
        }
        await db.insert(blockedSlots).values({
          blockDate: input.date,
          startTime: input.time,
          reason: input.reason || null,
        });
        return { ok: true };
      });
    }),

  removeBlock: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      return writeBlocks(async () => {
        await getDb().delete(blockedSlots).where(eq(blockedSlots.id, input.id));
        return { ok: true };
      });
    }),

  // The client database is derived from bookings: everyone who has ever
  // booked appears here with their latest contact details — including people
  // who cancelled, since their contact info is still valuable for outreach.
  // No separate table to keep in sync.
  clients: adminProcedure.query(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(bookings)
      .orderBy(desc(bookings.createdAt));
    const today = localToday();
    const byEmail = new Map<string, {
      name: string;
      email: string;
      phone: string;
      address: string;
      sessions: number;
      upcoming: number;
      completedSessions: number;
      cancelled: number;
      totalCents: number;
      lastSession: string | null;
      nextSession: string | null;
    }>();
    for (const row of rows) {
      const key = row.email.toLowerCase();
      const entry = byEmail.get(key) ?? {
        name: row.customerName,
        email: row.email,
        phone: row.phone,
        address: row.address,
        sessions: 0,
        upcoming: 0,
        completedSessions: 0,
        cancelled: 0,
        totalCents: 0,
        lastSession: null,
        nextSession: null,
      };
      if (row.bookingStatus === "cancelled") {
        entry.cancelled += 1;
      } else {
        entry.sessions += 1;
      }
      if (row.sessionDate >= today && (row.bookingStatus === "confirmed" || row.bookingStatus === "pending")) {
        entry.upcoming += 1;
        if (!entry.nextSession || row.sessionDate < entry.nextSession) entry.nextSession = row.sessionDate;
      }
      if (row.bookingStatus === "completed") entry.completedSessions += 1;
      if (row.paymentStatus === "paid") entry.totalCents += row.amountCents;
      if (row.sessionDate <= today && row.bookingStatus !== "cancelled" && (!entry.lastSession || row.sessionDate > entry.lastSession)) {
        entry.lastSession = row.sessionDate;
      }
      byEmail.set(key, entry);
    }
    return [...byEmail.values()].sort((a, b) => {
      if ((b.nextSession ? 1 : 0) !== (a.nextSession ? 1 : 0)) return (b.nextSession ? 1 : 0) - (a.nextSession ? 1 : 0);
      return a.name.localeCompare(b.name);
    });
  }),

  clientBookings: adminProcedure
    .input(z.object({ email: z.string().trim().email() }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(bookings)
        .where(eq(bookings.email, input.email))
        .orderBy(desc(bookings.sessionDate), desc(bookings.startTime));
      return rows.map((row) => ({ ...row, manageToken: undefined }));
    }),

  // CSV export of every booking ever made — cancelled included, so nothing
  // (and no one) is ever lost. The browser downloads it as a file.
  exportBookings: adminProcedure.query(async () => {
    const rows = await getDb()
      .select()
      .from(bookings)
      .orderBy(asc(bookings.sessionDate), asc(bookings.startTime));
    const header = [
      "id", "date", "time", "duration_min", "service", "amount_usd",
      "name", "email", "phone", "address", "goals", "notes",
      "payment_method", "payment_status", "booking_status", "booked_at",
    ];
    const lines = rows.map((row) =>
      [
        row.id,
        row.sessionDate,
        row.startTime,
        row.duration,
        row.serviceName,
        (row.amountCents / 100).toFixed(2),
        row.customerName,
        row.email,
        row.phone,
        row.address,
        row.goals ?? "",
        row.notes ?? "",
        row.paymentMethod,
        row.paymentStatus,
        row.bookingStatus,
        row.createdAt.toISOString(),
      ]
        .map(csvCell)
        .join(","),
    );
    return [header.join(","), ...lines].join("\r\n");
  }),

  // CSV export of the client database — one row per person (by email),
  // latest contact details, with cancelled bookings counted separately.
  exportClients: adminProcedure.query(async () => {
    const rows = await getDb()
      .select()
      .from(bookings)
      .orderBy(desc(bookings.createdAt));
    const byEmail = new Map<string, {
      name: string; email: string; phone: string; address: string;
      sessions: number; completed: number; cancelled: number; totalCents: number;
      firstBookedAt: Date; lastActivityAt: Date;
    }>();
    for (const row of rows) {
      const key = row.email.toLowerCase();
      const entry = byEmail.get(key) ?? {
        name: row.customerName,
        email: row.email,
        phone: row.phone,
        address: row.address,
        sessions: 0,
        completed: 0,
        cancelled: 0,
        totalCents: 0,
        firstBookedAt: row.createdAt,
        lastActivityAt: row.createdAt,
      };
      if (row.bookingStatus === "cancelled") entry.cancelled += 1;
      else entry.sessions += 1;
      if (row.bookingStatus === "completed") entry.completed += 1;
      if (row.paymentStatus === "paid") entry.totalCents += row.amountCents;
      if (row.createdAt < entry.firstBookedAt) entry.firstBookedAt = row.createdAt;
      if (row.createdAt > entry.lastActivityAt) entry.lastActivityAt = row.createdAt;
      byEmail.set(key, entry);
    }
    const header = [
      "name", "email", "phone", "address",
      "sessions_booked", "sessions_completed", "sessions_cancelled",
      "total_paid_usd", "first_booking_at", "last_activity_at",
    ];
    const lines = [...byEmail.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((client) =>
        [
          client.name,
          client.email,
          client.phone,
          client.address,
          client.sessions,
          client.completed,
          client.cancelled,
          (client.totalCents / 100).toFixed(2),
          client.firstBookedAt.toISOString(),
          client.lastActivityAt.toISOString(),
        ]
          .map(csvCell)
          .join(","),
      );
    return [header.join(","), ...lines].join("\r\n");
  }),
});
