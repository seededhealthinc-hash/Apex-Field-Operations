// Apex Field Operations — production server, v2 (Levy & Loom playbook applied)
// Minimal Node server using built-in modules only. No dependencies.
// Payment path is Levy & Loom ONLY. No Stripe code, no Stripe key, no
// direct Stripe Payment Links, Checkout Sessions, Subscriptions, Products,
// Prices or Webhook Endpoints are created here, per playbook Part 1.
//
// Secrets are read ONLY from environment variables, which the Levy & Loom
// desk places in Render. No secret value is in this repo, in any file, in
// any log line, or in any response. Env var NAMES read:
//   PORT, LEVY_LOOM_BASE_URL, LEVY_LOOM_MERCHANT_ID (accepted, not used
//     to call anything — the gateway identifies the merchant from the API
//     key), LEVY_LOOM_CONNECTED_ACCOUNT_ID, LEVY_LOOM_API_KEY,
//   LEVY_LOOM_WEBHOOK_SECRET, LEVY_LOOM_CALLBACK_PATH,
//   LEVY_LOOM_PRICE_SETUP, LEVY_LOOM_PRICE_RETAINER, PUBLIC_BASE_URL
//     (optional override for the public live host; defaults to the Render
//     address the desk gave, which is public, not a secret).
//
// Stateless, except for an in-memory set of processed delivery ids used
// only to de-duplicate retried callbacks (playbook Part 3). No database,
// no background jobs, no schedulers, no files written at runtime.
//
// GOOGLE SHEET NOTE — read this before calling the Sheet write "done":
// The desk's Render env list contains Levy & Loom settings only. It does
// NOT contain any Google Sheets credential, so this server cannot
// authenticate a Sheets API write on its own, and no credential is
// invented here. The webhook handler therefore does the verified,
// auditable part now — signature check, event classification, 2xx fast —
// and queues the Sheet outcome in memory + console (clientReferenceId,
// event type, outcome only; no raw body, no personal data beyond the id
// needed to find the row). A future, separately approved step must supply
// a Sheets credential to Render (or a Make route the owner approves)
// before "write to that tradesperson's row" can be executed for real.
// Until then the Sheet step is explicitly PENDING, not claimed as done.

const http = require('node:http');
const https = require('node:https');
const { createHmac, timingSafeEqual } = require('node:crypto');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const BASE_URL = process.env.LEVY_LOOM_BASE_URL || 'https://api.levyandloom.com';
const CALLBACK_PATH = process.env.LEVY_LOOM_CALLBACK_PATH || '/webhooks/levyloom';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://apex-field-operations.onrender.com').replace(/\/$/, '');

// In-memory de-duplication only. Bounded so a long-running process
// cannot grow it without limit; oldest entries are dropped first.
const seenDeliveries = new Set();
function markDelivery(id) {
  if (!id) return false;
  if (seenDeliveries.has(id)) return true;
  seenDeliveries.add(id);
  if (seenDeliveries.size > 10000) {
    const first = seenDeliveries.values().next().value;
    seenDeliveries.delete(first);
  }
  return false;
}

function htmlPage(title, heading, body) {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 560px; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
h1 { font-size: 1.5rem; }
p { margin: 0.75rem 0; }
</style>
</head>
<body>
<h1>${heading}</h1>
${body}
</body>
</html>
`;
}

function sendHtml(res, status, title, heading, body) {
  const page = htmlPage(title, heading, body);
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page);
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req, res) {
  try {
    const buf = await readBody(req);
    if (buf.length === 0) return {};
    return JSON.parse(buf.toString('utf8'));
  } catch (e) {
    sendJson(res, 400, { ok: false, error: 'invalid_json' });
    return null;
  }
}

// Playbook Part 3.1: HMAC-SHA256(webhookSecret, "<t>.<raw body>").
// Header: t=<unix>,v1=<hex> (two v1 values during rotation — accept any
// matching one). Reject anything older than 5 minutes. Verify BEFORE
// parsing, with a timing-safe comparison. Never log the secret, the
// signature, or the raw body.
function verifyLevyLoom(rawBodyText, signatureHeader, secret, toleranceSeconds = 300) {
  if (!secret) return false;
  let t = NaN;
  const signatures = [];
  for (const kv of String(signatureHeader || '').split(',')) {
    const i = kv.indexOf('=');
    if (i === -1) continue;
    const k = kv.slice(0, i).trim();
    const v = kv.slice(i + 1).trim();
    if (k === 't') t = Number.parseInt(v, 10);
    else if (k === 'v1') signatures.push(v);
  }
  if (!Number.isInteger(t) || signatures.length === 0) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSeconds) return false;
  let expected;
  try {
    expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBodyText}`).digest('hex'), 'hex');
  } catch (e) {
    return false;
  }
  return signatures.some((sig) => {
    try {
      const b = Buffer.from(sig, 'hex');
      return b.length === expected.length && timingSafeEqual(expected, b);
    } catch (e) {
      return false;
    }
  });
}

function levyLoomConfig() {
  const missing = [];
  if (!process.env.LEVY_LOOM_API_KEY) missing.push('LEVY_LOOM_API_KEY');
  if (!process.env.LEVY_LOOM_CONNECTED_ACCOUNT_ID) missing.push('LEVY_LOOM_CONNECTED_ACCOUNT_ID');
  return missing;
}

// Call Levy & Loom only. No Stripe call is made anywhere in this file.
function callLevyLoom(path, body) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(path, BASE_URL);
    } catch (e) {
      reject(new Error('invalid_base_url'));
      return;
    }
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          Authorization: `Bearer ${process.env.LEVY_LOOM_API_KEY}`,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch (e) {
            parsed = null;
          }
          resolve({ status: res.statusCode, body: parsed, raw: text });
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function startCheckout(req, res, priceEnvName) {
  const body = await readJsonBody(req, res);
  if (body === null) return;
  const clientReferenceId = typeof body.clientReferenceId === 'string' ? body.clientReferenceId.trim() : '';
  if (!clientReferenceId || clientReferenceId.length > 200) {
    sendJson(res, 400, { ok: false, error: 'clientReferenceId_required' });
    return;
  }
  const missing = levyLoomConfig();
  const priceId = process.env[priceEnvName];
  if (!priceId) missing.push(priceEnvName);
  if (missing.length > 0) {
    // Names only, never values. The desk places these in Render.
    sendJson(res, 503, { ok: false, error: 'payment_not_configured', missing });
    return;
  }
  const payload = {
    connectedAccountId: process.env.LEVY_LOOM_CONNECTED_ACCOUNT_ID,
    priceId,
    quantity: 1,
    clientReferenceId,
    callbackUrl: `${PUBLIC_BASE_URL}${CALLBACK_PATH}`,
    successUrl: `${PUBLIC_BASE_URL}/success`,
    cancelUrl: `${PUBLIC_BASE_URL}/cancel`,
  };
  if (typeof body.customerEmail === 'string' && body.customerEmail.trim()) {
    payload.customerEmail = body.customerEmail.trim();
  }
  // Deliberately omitted, per the owner's instruction: allowPromotionCodes
  // and trialPeriodDays are never sent (and are refused for one-time
  // prices in any case, playbook Part 2.3).
  let result;
  try {
    result = await callLevyLoom('/api/connect/create-charge', payload);
  } catch (e) {
    sendJson(res, 502, { ok: false, error: 'levy_loom_unreachable' });
    return;
  }
  if (result.status !== 201 && result.status !== 200) {
    sendJson(res, result.status || 502, {
      ok: false,
      error: (result.body && result.body.error && result.body.error.code) || 'create_charge_failed',
    });
    return;
  }
  const checkoutUrl = result.body && result.body.checkoutUrl;
  if (!checkoutUrl) {
    sendJson(res, 502, { ok: false, error: 'no_checkout_url' });
    return;
  }
  // Send the tradesperson to the returned checkout URL.
  if (body.redirect === false) {
    sendJson(res, 200, { ok: true, checkoutUrl, sessionId: result.body.sessionId || null });
  } else {
    res.writeHead(302, { location: checkoutUrl });
    res.end();
  }
}

async function startPortal(req, res) {
  const body = await readJsonBody(req, res);
  if (body === null) return;
  const customerId = typeof body.customerId === 'string' ? body.customerId.trim() : '';
  if (!customerId) {
    sendJson(res, 400, { ok: false, error: 'customerId_required' });
    return;
  }
  const missing = levyLoomConfig();
  if (missing.length > 0) {
    sendJson(res, 503, { ok: false, error: 'payment_not_configured', missing });
    return;
  }
  let result;
  try {
    result = await callLevyLoom('/api/connect/portal-session', {
      customerId,
      returnUrl: `${PUBLIC_BASE_URL}/`,
    });
  } catch (e) {
    sendJson(res, 502, { ok: false, error: 'levy_loom_unreachable' });
    return;
  }
  if (result.status !== 201 && result.status !== 200) {
    sendJson(res, result.status || 502, {
      ok: false,
      error: (result.body && result.body.error && result.body.error.code) || 'portal_session_failed',
    });
    return;
  }
  const url = result.body && result.body.url;
  if (!url) {
    sendJson(res, 502, { ok: false, error: 'no_portal_url' });
    return;
  }
  if (body.redirect === false) {
    sendJson(res, 200, { ok: true, url });
  } else {
    res.writeHead(302, { location: url });
    res.end();
  }
}

// Map a verified callback to the Apex outcome the owner specified.
// This function classifies and records; it does NOT grant access from
// any other source, and it does NOT write to a Sheet by itself — see the
// GOOGLE SHEET NOTE at the top of this file for why that step is pending.
function classifyCallback(event) {
  const data = (event && event.data) || {};
  const type = event && event.type;
  const rescueGranted =
    data.rescue && typeof data.rescue.accessGranted === 'boolean'
      ? data.rescue.accessGranted
      : data.accessGranted;
  switch (type) {
    case 'payment.succeeded':
      return { outcome: 'setup_paid', grant: true, note: 'One-off setup paid.' };
    case 'subscription.activated':
      return { outcome: 'retainer_active', grant: true, note: 'Retainer subscription active.' };
    case 'subscription.payment_failed':
      return {
        outcome: rescueGranted ? 'retainer_payment_failed_keep_access' : 'retainer_payment_failed_access_not_granted',
        grant: rescueGranted === true,
        note: 'Keep access only while rescue.accessGranted is true.',
      };
    case 'subscription.canceled':
      return { outcome: 'retainer_ended', grant: false, note: 'Retainer ended.' };
    case 'subscription.grace_expired':
      return { outcome: 'retainer_grace_expired', grant: false, note: 'Grace period expired.' };
    case 'subscription.updated':
      return { outcome: 'retainer_updated', grant: true, note: 'Retainer tier/status updated.' };
    case 'subscription.payment_recovered':
      return { outcome: 'retainer_payment_recovered', grant: true, note: 'Past-due retainer paid.' };
    case 'subscription.paused':
      return { outcome: 'retainer_paused', grant: false, note: 'Retainer collection paused.' };
    case 'subscription.resumed':
      return { outcome: 'retainer_resumed', grant: true, note: 'Retainer collection resumed.' };
    case 'payment.refunded':
      return { outcome: 'setup_refunded_record', grant: false, note: 'One-off setup refund recorded.' };
    case 'subscription.refunded':
      return { outcome: 'retainer_refunded_record', grant: false, note: 'Retainer refund recorded.' };
    default:
      return { outcome: 'unhandled_event_recorded', grant: false, note: 'Event recorded, no access change.' };
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/') {
    sendHtml(
      res,
      200,
      'Apex Field Operations — Production Server',
      'Apex Field Operations — Production Server',
      '<p>This is the Apex Field Operations production server.</p>' +
        '<p>Payments go through Levy &amp; Loom only. No Stripe code or key is used here.</p>' +
        '<p>Checkout is started per tradesperson at /checkout/setup (£495 one-off) and then /checkout/retainer (£79 a month). Access is granted only by a signed Levy &amp; Loom callback, never by the success page.</p>'
    );
    return;
  }

  if (req.method === 'GET' && url.pathname === '/success') {
    sendHtml(
      res,
      200,
      'Payment — Apex Field Operations',
      'Thank you.',
      '<p>This page alone does not confirm a payment and grants nothing.</p>' +
        '<p>Your account is confirmed only when a signed Levy &amp; Loom callback arrives. If that has happened, the tradesperson account will be marked accordingly; if not, nothing has been granted yet.</p>'
    );
    return;
  }

  if (req.method === 'GET' && url.pathname === '/cancel') {
    sendHtml(
      res,
      200,
      'Payment cancelled — Apex Field Operations',
      'Payment cancelled.',
      '<p>Nothing was changed. You can return and try again when ready.</p>'
    );
    return;
  }

  if (req.method === 'POST' && url.pathname === '/checkout/setup') {
    await startCheckout(req, res, 'LEVY_LOOM_PRICE_SETUP');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/checkout/retainer') {
    await startCheckout(req, res, 'LEVY_LOOM_PRICE_RETAINER');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/portal') {
    await startPortal(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === CALLBACK_PATH) {
    let raw;
    try {
      raw = await readBody(req);
    } catch (e) {
      sendJson(res, 400, { ok: false, error: 'body_read_failed' });
      return;
    }
    const rawText = raw.toString('utf8');
    const secret = process.env.LEVY_LOOM_WEBHOOK_SECRET;
    if (!verifyLevyLoom(rawText, req.headers['x-levyloom-signature'], secret)) {
      // Unsigned or wrongly signed: 401, and per playbook Part 3 this
      // 4xx is not retried. Never log the body or the signature.
      sendJson(res, 401, { ok: false, error: 'invalid_signature' });
      return;
    }
    let event;
    try {
      event = JSON.parse(rawText);
    } catch (e) {
      sendJson(res, 400, { ok: false, error: 'invalid_json' });
      return;
    }
    const deliveryId = req.headers['x-levyloom-delivery'] || (event && event.id) || null;
    const duplicate = markDelivery(deliveryId);
    const classified = classifyCallback(event);
    const clientReferenceId = (event.data && event.data.clientReferenceId) || null;
    // 2xx quickly, per playbook Part 2.5 (under 10 seconds). The Sheet
    // outcome is queued for the pending Sheets-credential step — see the
    // note at the top of this file. Only ids and outcomes are logged,
    // never the raw body, email, or payment details.
    console.log(
      JSON.stringify({
        webhook: 'levyloom',
        type: event.type || null,
        deliveryId,
        duplicate,
        clientReferenceId,
        outcome: classified.outcome,
        grant: classified.grant,
        sheetWrite: 'pending_sheets_credential',
      })
    );
    sendJson(res, 200, {
      ok: true,
      status: duplicate ? 'duplicate_ignored' : 'received',
      outcome: classified.outcome,
      sheetWrite: 'pending_sheets_credential',
    });
    return;
  }

  sendJson(res, 404, { ok: false, status: 'not_found' });
});

server.listen(PORT, () => {
  console.log(`Apex Field Operations production server listening on port ${PORT}`);
});
