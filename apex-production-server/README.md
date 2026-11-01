# Apex Field Operations — Production Server (local build only, v1)

## What this server is

A minimal, real Node server that will later be deployed from `main` in a
GitHub repo under `seededhealthinc-hash` and run on Render by the Levy & Loom
desk (the desk creates the Render service itself; no Render login or key is
needed by the builder). GitHub Pages cannot receive payment messages, which
is why a server is needed.

This code is now pushed to GitHub (see below). It is **not** a live
production deployment: nothing has been deployed to Render, and nothing
has been sent to the desk yet.

## What this server is NOT

- It is not a payment system. There is no payment code, no Stripe code, and
  no checkout code in this build.
- It does not take, store, or confirm any payment, and the `/success` page
  does not, by itself, prove that a payment was taken.
- It does not collect any customer data.
- It does not mark anything paid, does not touch any Google Sheet, does not
  call any external service, and does not verify any signature.
- It contains no keys and no secrets, and no keys or secrets have been asked
  for or used.

## Routes

- `GET /` — short plain page stating this is the Apex Field Operations
  production server (demo/status only, no payment, no customer data).
- `GET /success` — simple success page: "Payment successful. Thank you —
  your retainer is being set up. A tradesperson account will be confirmed
  separately." It does not claim a payment was actually taken, and it does
  not collect any payment details.
- `GET /cancel` — simple cancel page: "Payment cancelled. Nothing was
  changed. You can return and try again when ready."
- `POST /webhooks/levyloom` — an EMPTY handler for now. It accepts the
  request, logs only that a webhook was received (no body content, no
  personal data), and returns 200 with a plain JSON acknowledgement stating
  the handler is not yet implemented and the playbook will fill it in.
  The Levy & Loom integration playbook has NOT arrived yet, so this route
  must stay empty until it does.

## Stateless: no database, no background jobs, no schedulers

This server is stateless. It uses:

- No database.
- No background jobs.
- No schedulers.
- No files that must survive a restart. It writes no files at runtime.

On a paid message in future (after the playbook arrives), the design agreed
with the desk is to mark the tradesperson's row in the existing Google Sheet
as paid — that lookup and write are **not** implemented in this build.

## Customer ID field (for later use only)

The customer ID field name is `clientReferenceId`. Its value will later be
the tradesperson's unique row ID in the existing Google Sheet (one per
tradesperson account). That lookup is **not** implemented in this build, no
Sheet has been created, and no ID has been hardcoded.

## Environment variables

There are no required environment variables. The server runs with zero
required settings.

Full list of environment variable NAMES it will read:

- `PORT` — optional only. The port the server listens on. Default: `3000`
  when `PORT` is not set. This is a runtime port, not a payment setting.
- No other environment variables are required, and none are read.
- The Levy & Loom settings will be defined by the integration playbook when
  it arrives. No secret names have been invented for them here, and no
  values are included anywhere in this repo.

## How to run it locally

Build command: none required (no dependencies, no build step).

```sh
node server.js
```

Or, equivalently:

```sh
npm start
```

Then visit `http://localhost:3000/` (or the port set in `PORT`).

## Build and start commands

- Build command: none (no dependencies, no build step).
- Start command: `node server.js` (equivalently `npm start`).

## Runtime version tested

Node v24.22.1 (tested locally, 1 November 2026).

## Exact details the owner will later send to the desk

> - Repo name and branch: `seededhealthinc-hash/Apex-Field-Operations`, branch `main`, root directory `apex-production-server` (the server code lives in that folder, alongside the existing Pages demo at the repo root — the demo is unchanged).
> - Live address: TBD — the desk creates the Render service and gives the live address. The payment-message address will then be `https://<live-address>/webhooks/levyloom`, and the success and cancel page addresses will be `https://<live-address>/success` and `https://<live-address>/cancel`.
> - Build command: none (no dependencies, no build step).
> - Start command: `node server.js` (equivalently `npm start`).
> - Runtime version: Node v24.22.1.
> - Database: none. The server is stateless and uses no database.
> - Always-on jobs / schedulers: none.
> - Files that must survive a restart: none. The server writes no files at runtime.
> - Environment variable NAMES: `PORT` (optional only, default 3000). No other environment variables are required, and no Levy & Loom setting names have been invented — the integration playbook will define them when it arrives. No values are included.
> - Customer ID field: `clientReferenceId` — whose value will later be the tradesperson's unique row ID in the existing Google Sheet (one per tradesperson account). Not implemented in this build.

## What is still blocked / not done

- Code pushed to GitHub (commit 03d374c5f631bba697c73b477d2da1d85183f135, plus this README update). Nothing deployed to Render yet.
- No payment code, no Stripe work, and no integration playbook — the
  webhook route stays empty until the playbook arrives.
- No owner message has been sent to the desk yet. The owner-details section
  above is ready to send, with the repo, branch, root directory, commands, runtime, stateless design, env var names, and clientReferenceId field.
