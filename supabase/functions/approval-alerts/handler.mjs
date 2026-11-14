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
    const payments = await client.rpc('claim_payment_change_alerts');
    if (payments.error) return respond({ error: 'Could not claim payment update alerts' }, 503);
    const memberEvents = await client.rpc('claim_member_event_alerts');
    if (memberEvents.error) return respond({ error: 'Could not claim member notifications' }, 503);
    const alerts = [
      ...(data ?? []).map(alert => ({ ...alert, kind: 'approval' })),
      ...(payments.data ?? []).map(alert => ({ ...alert, kind: 'payment' })),
      ...(memberEvents.data ?? []).map(alert => ({ ...alert, event_kind: alert.kind, kind: 'member_event' })),
    ];
    let sent = 0, failed = 0;
    for (const alert of alerts) {
      let delivered = false, errorCode = null;
      try {
        const isMember = alert.kind === 'member_event';
        const eventKind = alert.event_kind || alert.kind_original;
        const dealAction = alert.kind === 'member_event' && ['deal_created','deal_updated','custom_terms'].includes(eventKind);
        const action = eventKind === 'deal_created' ? 'A new deal is available' : eventKind === 'deal_updated' ? 'A deal has been updated' : eventKind === 'custom_terms' ? 'Your private deal pricing has changed' : eventKind === 'reservation_updated' ? 'Your reservation was updated' : eventKind === 'received' ? 'Units were marked received' : 'A payment was recorded';
        const amount = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(alert.amount_cents)||0)/100);
        await sendMail({
          from: sender, to: isMember ? alert.email : recipient,
          messageId: `<mobius-${alert.kind}-${alert.kind === 'approval' ? alert.member_id : alert.id}@mobiusbg.netlify.app>`,
          subject: isMember ? `Mobius: ${action}` : alert.kind === 'payment' ? 'Mobius: member payment information updated' : 'Mobius: a new member is awaiting approval',
          text: isMember
            ? `${action}.\n\nDeal: ${alert.deal_title}\n${dealAction ? '' : eventKind === 'reservation_updated' ? `New reserved quantity: ${alert.total_units}\n` : `Units in this update: ${alert.quantity_delta}\nTotal ${eventKind === 'received' ? 'received' : 'paid'} units: ${alert.total_units}\n${eventKind === 'paid' ? `Amount recorded: ${amount}\nPayments are sent separately; this email confirms only the recorded update.\n` : ''}`}\nSign in to review the details:\n${siteUrl}/workspace`
            : alert.kind === 'payment'
            ? `A member has added, changed, or removed their payment information.\n\nMember: ${alert.full_name || 'Name not provided'}\nEmail: ${alert.email}\n\nSign in as the super admin to review the current payment information:\n${siteUrl}/profile?member=${alert.member_id}\n\nBank account numbers and payment codes are intentionally omitted from this email. No payment has been initiated.`
            : `A new member has verified their email and is waiting for your approval.\n\nMember email: ${alert.email}\n\nSign in as the Mobius super admin, open Members, and choose Approve membership for this email:\n${siteUrl}/workspace\n\nNo access is granted by this email. Review the request in the workspace.`,
        });
        delivered = true;
      } catch (error) {
        // Store an error category only; SMTP errors can contain credentials or
        // message contents. Never log transport configuration or member data.
        errorCode = typeof error?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code)
          ? error.code : 'smtp_error';
      }
      const completed = await client.rpc(alert.kind === 'payment' ? 'complete_payment_change_alert' : alert.kind === 'member_event' ? 'complete_member_event_alert' : 'complete_approval_alert', {
        ...(alert.kind === 'approval' ? { p_member_id: alert.member_id } : { p_id: alert.id }),
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
