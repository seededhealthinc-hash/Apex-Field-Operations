# Apex Field Operations — Production Server, v2 (Levy & Loom)

Live on Render at https://apex-field-operations.onrender.com (free plan, deploys main, root apex-production-server), per the Levy & Loom desk message 2026-11-02. The desk places the settings in Render; this repo contains NAMES only, never values.

## What this server is

A minimal, real Node server (built-ins only, no dependencies) that runs the Levy & Loom payment flow from the Integration Playbook (Part 2.3 checkout including "One-off payments", Part 2.4 portal, Part 3 webhook dispatch, read 2026-11-02).

Payment path is Levy & Loom ONLY. No Stripe code, no Stripe key, no direct Stripe Payment Links, Checkout Sessions, Subscriptions, Products, Prices or Webhook Endpoints are created here.

## Routes

- `GET /` — status page.
- `GET /success` — grants NOTHING. It states plainly that this page alone does not confirm a payment; only a signed callback counts.
- `GET /cancel` — "Payment cancelled. Nothing was changed."
- `POST /checkout/setup` — body `{ clientReferenceId, customerEmail?, redirect? }`. Calls Levy & Loom `POST /api/connect/create-charge` with price `LEVY_LOOM_PRICE_SETUP` (£495 one-off, one-time price), callback/success/cancel URLs derived from the public live host + callback path. Returns a 302 to the returned `checkoutUrl`, or JSON with `checkoutUrl` when `redirect: false`. Never sends `allowPromotionCodes` or `trialPeriodDays`.
- `POST /checkout/retainer` — same call with price `LEVY_LOOM_PRICE_RETAINER` (£79 a month, recurring). Start this only after the setup is paid.
- `POST /portal` — body `{ customerId, redirect? }` ("Manage my plan"). Calls Levy & Loom `POST /api/connect/portal-session` (Part 2.4) and redirects to the returned URL, or returns it as JSON when `redirect: false`. `customerId` is the one delivered in `subscription.activated`.
- `POST /webhooks/levyloom` (or the path in `LEVY_LOOM_CALLBACK_PATH`) — reads the raw body, verifies `X-LevyLoom-Signature` with `LEVY_LOOM_WEBHOOK_SECRET` per Part 3.1 (HMAC-SHA256 over `<t>.<raw body>`, multiple `v1` values accepted, 5-minute tolerance, timing-safe compare). Unsigned or wrongly signed requests get 401. Verified events are classified and answered 2xx quickly, with duplicate deliveries de-duplicated on `X-LevyLoom-Delivery`:
  - `payment.succeeded` = setup paid
  - `subscription.activated` = retainer active
  - `subscription.payment_failed` = keep access while `rescue.accessGranted` is true
  - `subscription.canceled` = retainer ended
  - `payment.refunded` / `subscription.refunded` = record it
  - plus `subscription.updated`, `payment_recovered`, `grace_expired`, `paused`, `resumed` for completeness

## Google Sheet write — PENDING, not claimed as done

The desk's Render env list contains Levy & Loom settings only. It does NOT contain any Google Sheets credential, so this server cannot authenticate a Sheets API write on its own, and no credential is invented here. The webhook handler therefore verifies, classifies, and queues the Sheet outcome (clientReferenceId, event type, outcome only) and reports `sheetWrite: "pending_sheets_credential"`. A future, separately approved step must supply a Sheets credential to Render (or an owner-approved Make route) before "write to that tradesperson's row" can execute for real. Do not present the Sheet step as complete until that credential and a live callback test prove it.

## Environment variables (NAMES only, never values)

- `PORT` — optional, default 3000.
- `LEVY_LOOM_BASE_URL` — gateway host (playbook BASE, production https://api.levyandloom.com).
- `LEVY_LOOM_MERCHANT_ID` — accepted for reference; the gateway identifies the merchant from the API key, so no call uses this id directly.
- `LEVY_LOOM_CONNECTED_ACCOUNT_ID` — the merchant's own connected account, sent on every create-charge call.
- `LEVY_LOOM_API_KEY` — Bearer token for Levy & Loom calls. Never logged, never returned, never committed.
- `LEVY_LOOM_WEBHOOK_SECRET` — HMAC secret for callback verification. Never logged, never returned, never committed.
- `LEVY_LOOM_CALLBACK_PATH` — callback path, `/webhooks/levyloom`.
- `LEVY_LOOM_PRICE_SETUP` — £495 one-off setup price id.
- `LEVY_LOOM_PRICE_RETAINER` — £79 a month retainer price id.
- `PUBLIC_BASE_URL` — optional override for the public live host; defaults to https://apex-field-operations.onrender.com.

If a required Levy & Loom setting is missing, checkout/portal return 503 `payment_not_configured` naming only the missing env var names.

## Stateless

No database, no background jobs, no schedulers, no files written at runtime — except an in-memory, bounded set of processed delivery ids for de-duplication.

## Customer ID field

`clientReferenceId` — the tradesperson's unique Sheet row ID (one per tradesperson account). It is echoed in every callback, so no Stripe id mapping is needed.

## How to run it locally

Build command: none (no dependencies, no build step).

```sh
node server.js
```

Then visit `http://localhost:3000/`. Without the Levy & Loom env vars, checkout/portal return 503 naming the missing names; the webhook still returns 401 for unsigned requests.

## Build and start commands

- Build command: none.
- Start command: `node server.js` (equivalently `npm start`).
- Runtime tested: Node v24.22.1.

## History

- v1 (2026-11-01): status/success/cancel pages + empty webhook handler, pushed to GitHub in the existing Apex-Field-Operations repo under `apex-production-server/`. No payment code until the playbook arrived.
- v2 (2026-11-02): playbook applied — checkout (setup + retainer), signed webhook, portal. Live Render address supplied by the desk 2026-11-02. Sheet write remains pending for the reason above.
