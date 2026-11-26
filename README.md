# Lucia Nuzzi — At-Home Personal Training

A responsive full-stack personal-training website with editorial motion, an interactive session finder, persistent appointment booking, calendar export, cancellation, Venmo payments, and optional Stripe Checkout.

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

## Local SEO

The site targets Palm Beach, Florida with a location-specific title and description, Open Graph and Twitter sharing metadata, crawler directives in `public/robots.txt`, and Schema.org structured data for Lucia, her local business, and the three training services. Palm Beach location details also appear in the hero, Meet Lucia section, FAQs, and footer. No unverified street address or phone number is included. Canonical and social URLs resolve from the active site origin; add a sitemap when the final production domain is known.

## Launch settings

- Services and prices: `contracts/training.ts` ($165/hour for one person; $250/hour for two; Mobility & Stretching is a fixed 60-minute session at the same $165/$250 rates)
- Weekly time slots: `ALL_TIMES` in `contracts/training.ts` (30-minute starts from 7:30 AM through 6:00 PM; Sundays are closed). Booked and overlapping start times are removed from the picker. The booking calendar offers the next 30 available days.
- Booking UI: `src/components/BookingFlow.tsx`
- Booking API: `api/bookingRouter.ts`
- Homepage and motion: `src/pages/Home.tsx`, `src/App.css`
- Photography: user-supplied images in `public/images/`; see `CREDITS.md` for placement details.

Lucia's official Instagram profile is linked throughout the site. The active website uses only user-supplied photography.
