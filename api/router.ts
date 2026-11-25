import { createRouter, publicQuery } from "./middleware";
import { bookingRouter } from "./bookingRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  booking: bookingRouter,
});

export type AppRouter = typeof appRouter;
