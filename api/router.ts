import { createRouter, publicQuery } from "./middleware";
import { bookingRouter } from "./bookingRouter";
import { adminRouter } from "./adminRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  booking: bookingRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
