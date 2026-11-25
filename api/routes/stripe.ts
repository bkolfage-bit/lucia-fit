import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { eq } from "drizzle-orm";
import { getStripe } from "../stripe";
import { getDb } from "../queries/connection";
import { bookings } from "@db/schema";

export const stripeRoutes = new Hono();

stripeRoutes.post(
  "/webhook",
  bodyLimit({ maxSize: 128 * 1024, onError: (c) => c.body(null, 413) }),
  async (c) => {
    const stripe = getStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const signature = c.req.header("stripe-signature");
    if (!stripe || !secret) return c.json({ error: "Stripe webhook is not configured" }, 503);
    if (!signature) return c.json({ error: "Missing signature" }, 400);

    let event;
    try {
      const rawBody = await c.req.text();
      event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
    } catch {
      return c.json({ error: "Invalid webhook signature" }, 400);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.payment_status === "paid") {
        await getDb()
          .update(bookings)
          .set({ paymentStatus: "paid", bookingStatus: "confirmed" })
          .where(eq(bookings.stripeSessionId, session.id));
      }
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object;
      await getDb()
        .update(bookings)
        .set({ bookingStatus: "cancelled", paymentStatus: "unpaid" })
        .where(eq(bookings.stripeSessionId, session.id));
    }

    return c.json({ received: true });
  },
);
