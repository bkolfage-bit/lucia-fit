# Lucia Nuzzi — At-Home Personal Training

A responsive full-stack personal-training website with editorial motion, an interactive session finder, persistent appointment booking, calendar export, cancellation, and optional Stripe Checkout and Venmo through Braintree.

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

## Activate Venmo through Braintree

Venmo stays disabled until all three Braintree credentials are supplied. Use sandbox credentials while testing, then switch the environment and credentials together for production:

```bash
BRAINTREE_ENVIRONMENT=sandbox
BRAINTREE_MERCHANT_ID=...
BRAINTREE_PUBLIC_KEY=...
BRAINTREE_PRIVATE_KEY=...
```

Enable Venmo in the Braintree merchant account and complete Venmo's business review before accepting live payments. If the account requires a specific merchant account or Venmo business profile, also set:

```bash
BRAINTREE_MERCHANT_ACCOUNT_ID=...
BRAINTREE_VENMO_PROFILE_ID=...
```

The browser receives only a short-lived Braintree client token. After the visitor authorizes a single-use Venmo payment, the server charges the booking's stored server-calculated total with device data and immediate settlement. Only a successful Braintree transaction marks the booking paid; the confirmation includes the server-returned Venmo username and transaction ID. Cancelled or declined authorization remains unpaid, and an ambiguous gateway response stays in a processing state to prevent an automatic duplicate charge.

Never expose `BRAINTREE_PRIVATE_KEY` through `VITE_` variables or frontend code. Production Venmo checkout requires HTTPS, an approved production Braintree account, and testing of the mobile app-return and desktop login flows with real merchant credentials.

## Launch settings

- Services and prices: `contracts/training.ts` ($165/hour for one person; $250/hour for two; Mobility & Stretching is $130 for 45 minutes solo or $200 for two)
- Weekly time slots: `ALL_TIMES` in `contracts/training.ts` (30-minute starts from 7:00 AM through 7:30 PM; Sundays are closed). Booked and overlapping start times are removed from the picker.
- Booking UI: `src/components/BookingFlow.tsx`
- Booking API: `api/bookingRouter.ts`
- Homepage and motion: `src/pages/Home.tsx`, `src/App.css`
- Replace supporting photography in `public/images/`; see `CREDITS.md` for current image sources.

The Instagram media supplied in the brief was not accessible from the build environment, so no Instagram photos are redistributed. Lucia's official profile is linked throughout the site.
