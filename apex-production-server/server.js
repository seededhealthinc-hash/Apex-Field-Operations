// Apex Field Operations — production server (local build only, v1)
// Minimal Node server using built-in modules only. No dependencies.
// This is NOT a live production deployment. No payment code, no Stripe
// code, no checkout code, no keys, and no external calls exist in this file.
// The /webhooks/levyloom route is intentionally empty: the Levy & Loom
// integration playbook has not arrived yet, and it will fill that handler in.
// Stateless: no database, no background jobs, no schedulers, no files
// written at runtime.

const http = require('node:http');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/') {
    sendHtml(
      res,
      200,
      'Apex Field Operations — Production Server',
      'Apex Field Operations — Production Server',
      '<p>This is the Apex Field Operations production server (demo/status only).</p>' +
        '<p>No payment is taken here, and no customer data is collected here.</p>' +
        '<p>Payment handling is not implemented in this build. It will be added only after the Levy &amp; Loom integration playbook arrives.</p>'
    );
    return;
  }

  if (req.method === 'GET' && url.pathname === '/success') {
    sendHtml(
      res,
      200,
      'Payment successful — Apex Field Operations',
      'Payment successful.',
      '<p>Thank you — your retainer is being set up. A tradesperson account will be confirmed separately.</p>' +
        '<p>This page does not, by itself, prove that a payment was taken. It is a static success page for the future checkout flow.</p>'
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

  if (req.method === 'POST' && url.pathname === '/webhooks/levyloom') {
    // Intentionally empty handler. Consume and discard the request body
    // WITHOUT logging it, storing it, or acting on it, so no body content
    // and no personal data is recorded. Nothing is marked paid, no Sheet
    // is touched, no external service is called, and no signature is
    // verified (no keys exist yet). The playbook will fill this in.
    req.on('data', () => {
      // Discard only.
    });
    req.on('end', () => {
      console.log('Webhook received at /webhooks/levyloom — handler not yet implemented (playbook pending).');
      sendJson(res, 200, {
        ok: true,
        status: 'not_implemented',
        message: 'Webhook handler is not yet implemented. The Levy & Loom integration playbook will fill it in.',
      });
    });
    req.on('error', () => {
      sendJson(res, 200, {
        ok: true,
        status: 'not_implemented',
        message: 'Webhook handler is not yet implemented. The Levy & Loom integration playbook will fill it in.',
      });
    });
    return;
  }

  sendJson(res, 404, { ok: false, status: 'not_found' });
});

server.listen(PORT, () => {
  console.log(`Apex Field Operations production server listening on port ${PORT}`);
});
