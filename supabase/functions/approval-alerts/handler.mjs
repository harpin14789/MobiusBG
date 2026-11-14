// Transport and database clients are injected to keep the worker testable
// without connecting to Google or putting credentials in local test files.
export function createHandler({ secret, client, sendMail, sender, recipient, siteUrl }) {
  async function authorized(value) {
    if (!secret || !value) return false;
    const digest = (s) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    const [a, b] = await Promise.all([digest(secret), digest(value)]);
    const left = new Uint8Array(a), right = new Uint8Array(b);
    let difference = 0;
    for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
    return difference === 0;
  }

  const respond = (body, status = 200) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store' },
  });

  return async function handler(request) {
    if (request.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);
    if (!await authorized(request.headers.get('X-Mobius-Alert-Secret'))) {
      return respond({ error: 'Unauthorized' }, 401);
    }
    let body;
    try { body = await request.json(); }
    catch { return respond({ error: 'Invalid JSON' }, 400); }

    if (body?.action === 'test') {
      try {
        await sendMail({
          from: sender, to: recipient,
          subject: 'Mobius approval alerts are connected',
          text: `This is a setup test for Mobius approval alerts. New verified members awaiting approval will be emailed to this address. No membership has been changed.\n\nReview members: ${siteUrl}/workspace`,
        });
        return respond({ test: 'sent' });
      } catch (error) {
        const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code)
          ? error.code : 'smtp_error';
        return respond({ error: 'Email delivery failed', code }, 502);
      }
    }
    if (body?.action) return respond({ error: 'Unknown action' }, 400);

    const { data, error } = await client.rpc('claim_approval_alerts');
    if (error) return respond({ error: 'Could not claim approval alerts' }, 503);
    let sent = 0, failed = 0;
    for (const alert of data ?? []) {
      let delivered = false, errorCode = null;
      try {
        await sendMail({
          from: sender, to: recipient,
          messageId: `<mobius-approval-${alert.member_id}@mobiusbg.netlify.app>`,
          subject: 'Mobius: a new member is awaiting approval',
          text: `A new member has verified their email and is waiting for your approval.\n\nMember email: ${alert.email}\n\nSign in as the Mobius super admin, open Members, and choose Approve membership for this email:\n${siteUrl}/workspace\n\nNo access is granted by this email. Review the request in the workspace.`,
        });
        delivered = true;
      } catch (error) {
        // Store an error category only; SMTP errors can contain credentials or
        // message contents. Never log transport configuration or member data.
        errorCode = typeof error?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code)
          ? error.code : 'smtp_error';
      }
      const completed = await client.rpc('complete_approval_alert', {
        p_member_id: alert.member_id,
        p_lease_token: alert.lease_token,
        p_sent: delivered,
        p_error: errorCode,
      });
      if (delivered && !completed.error && completed.data === true) sent++;
      else failed++;
    }
    return respond({ sent, failed }, failed ? 503 : 200);
  };
}
