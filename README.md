# Lucia Nuzzi — At-Home Personal Training

A responsive full-stack personal-training website with editorial motion, an interactive session finder, persistent appointment booking, calendar export, cancellation, Venmo payments, optional Stripe Checkout, and a private admin dashboard for managing the schedule, blocked time, and clients.

## Run

```bash
npm install
npm run db:push
npm run dev
```

The development server runs at `http://localhost:3000`.

```bash
npm run check
npm run build
npm start
```

## Booking data

Appointments are stored in the platform MySQL database through Drizzle ORM. A unique date/time index prevents double-booking, and duration-aware overlap checks keep longer sessions from conflicting with adjacent appointments. Cancelled appointments release their time slots.

## Activate online card payments

Pay-at-session booking works without additional setup. To enable real card payments, configure:

```bash
STRIPE_SECRET_KEY=sk_live_or_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Create a Stripe webhook pointing to `/api/stripe/webhook` and subscribe to:

- `checkout.session.completed`
- `checkout.session.expired`

Stripe Checkout uses the booking's server-side service price, not a browser-supplied amount. Successful payments mark the booking paid and confirmed through both the return verification and the webhook.

Do not expose the secret keys through `VITE_` variables or frontend code.

## Venmo payments

Venmo is the primary payment option and needs no setup, credentials, or payment processor. When a client chooses Venmo, the session time is reserved immediately and the confirmation screen shows a **Pay @lucia-nuzzi in Venmo** button. It opens the client's Venmo app (or venmo.com on desktop) with the recipient, exact amount, and a booking-reference note already filled in. Lucia confirms receipt in her own Venmo app; the reservation holds the slot in the meantime. Automated Venmo capture would require PayPal-owned rails (Braintree / PayPal Checkout), which this project intentionally does not use.

## Admin dashboard (`/admin`)

Lucia's private management area, linked from the site footer. Sign-in uses a single passcode (no user accounts); a signed, httpOnly cookie keeps the session for 7 days.

**Setup (one time, before the dashboard code goes live):**

1. Apply the blocked-time table to the production database:
   ```bash
   mysql "$DATABASE_URL" < db/blocked_slots.sql
   ```
2. Set the environment variable `ADMIN_PASSCODE` to a strong private passcode. Optional: `ADMIN_SESSION_SECRET` to sign sessions independently (rotating it logs everyone out without changing the passcode).

Until the table exists, the public booking site keeps working normally (it treats blocked time as empty), and the dashboard shows a clear setup message instead of failing.

**What it does:**

- **Schedule** — every booking with client contact shortcuts (call / email / text), payment and confirmation status, and actions: mark paid (use when a Venmo payment arrives), confirm, complete, or cancel (two-tap).
- **Availability** — block a whole day or a single start time, with an optional private reason. Blocked days appear as "Off" in the booking date picker and blocked times can't be selected or booked; removing a block reopens it instantly.
- **Clients** — a client database built automatically from bookings: latest contact details, session counts, next session, and total paid. Search by name, email, or phone; type a message once and send it via the email or Messages app with the address filled in; expand any client for their full booking history.

Dashboard UI: `src/pages/Admin.tsx`. API: `api/adminRouter.ts` (passcode gate in `api/lib/admin.ts`).

## Local SEO

The site targets Palm Beach, Florida with a location-specific title and description, Open Graph and Twitter sharing metadata, crawler directives in `public/robots.txt`, and Schema.org structured data for Lucia, her local business, and the three training services. Palm Beach location details also appear in the hero, Meet Lucia section, FAQs, and footer. No unverified street address or phone number is included. Canonical and social URLs resolve from the active site origin; add a sitemap when the final production domain is known.

## Launch settings

- Services and prices: `contracts/training.ts` ($165/hour for one person; $250/hour for two; Mobility & Stretching is a fixed 60-minute session at the same $165/$250 rates)
- Weekly time slots: `ALL_TIMES` in `contracts/training.ts` (30-minute starts from 7:30 AM through 6:00 PM; Sundays are closed). Booked and overlapping start times are removed from the picker. The booking calendar offers the next 30 available days.
- Booking UI: `src/components/BookingFlow.tsx`
- Booking API: `api/bookingRouter.ts`
- Admin dashboard: `src/pages/Admin.tsx`, `api/adminRouter.ts`
- Homepage and motion: `src/pages/Home.tsx`, `src/App.css`
- Photography: user-supplied images in `public/images/`; see `CREDITS.md` for placement details.

Lucia's official Instagram profile is linked throughout the site. The active website uses only user-supplied photography.
