import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  int,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";

export const bookings = mysqlTable(
  "bookings",
  {
    id: serial("id").primaryKey(),
    serviceId: varchar("service_id", { length: 40 }).notNull(),
    serviceName: varchar("service_name", { length: 120 }).notNull(),
    duration: int("duration").notNull(),
    amountCents: int("amount_cents").notNull(),
    sessionDate: varchar("session_date", { length: 10 }).notNull(),
    startTime: varchar("start_time", { length: 5 }).notNull(),
    customerName: varchar("customer_name", { length: 120 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    phone: varchar("phone", { length: 40 }).notNull(),
    address: text("address").notNull(),
    goals: text("goals"),
    notes: text("notes"),
    paymentMethod: mysqlEnum("payment_method", ["stripe", "pay_later", "venmo"]).notNull(),
    paymentStatus: mysqlEnum("payment_status", ["unpaid", "pending", "processing", "paid", "refunded"])
      .default("unpaid")
      .notNull(),
    bookingStatus: mysqlEnum("booking_status", ["pending", "confirmed", "cancelled", "completed"])
      .default("confirmed")
      .notNull(),
    stripeSessionId: varchar("stripe_session_id", { length: 255 }),
    braintreeTransactionId: varchar("braintree_transaction_id", { length: 255 }),
    venmoUsername: varchar("venmo_username", { length: 255 }),
    manageToken: varchar("manage_token", { length: 64 }).notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("booking_slot_unique").on(table.sessionDate, table.startTime),
    index("booking_stripe_session_idx").on(table.stripeSessionId),
    uniqueIndex("booking_braintree_transaction_unique").on(table.braintreeTransactionId),
  ],
);

export const blockedSlots = mysqlTable(
  "blocked_slots",
  {
    id: serial("id").primaryKey(),
    blockDate: varchar("block_date", { length: 10 }).notNull(),
    // NULL means the whole day is blocked; otherwise one 30-minute slot.
    startTime: varchar("start_time", { length: 5 }),
    reason: varchar("reason", { length: 200 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("blocked_slots_date_idx").on(table.blockDate)],
);

export type Booking = typeof bookings.$inferSelect;
export type InsertBooking = typeof bookings.$inferInsert;
export type BlockedSlot = typeof blockedSlots.$inferSelect;
export type InsertBlockedSlot = typeof blockedSlots.$inferInsert;
