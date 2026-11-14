# Approval email alerts

The owner, `themobiusenterprises@gmail.com`, receives an alert when a new account verifies its email and is still awaiting membership approval. Google-verified signups are included. Unverified email signups do not generate an alert. The email contains the applicant's email address and a link to the authenticated workspace; it cannot itself approve someone.

## Components

- `20261114000200_approval_alerts.sql` adds a private queue and an Auth user trigger. Signup writes only to the queue and does not wait for email delivery. A unique member ID prevents repeat signup/update alerts.
- The `approval-alerts` Supabase Edge Function claims up to five queued records per run and uses the configured Gmail account to send only to the fixed owner address.
- The scheduler in `supabase/approval-alerts-schedule.sql` invokes the worker every two minutes. A secret shared between Edge secrets and database Vault authenticates it; it is never included in browser code or the cron command. JWT gateway checks are disabled for this worker because it validates its own random scheduler secret.
- Leases prevent concurrent workers from claiming the same event. SMTP failures retry with exponential backoff, up to five attempts. Accounts approved before delivery are skipped. Delivery is at least once: a crash after SMTP acceptance but before acknowledgment can cause a duplicate; deterministic message IDs help mail threading but do not guarantee deduplication by Gmail.

## Setup and updates

From an authorized managed environment, run:

```sh
python3 scripts/setup-approval-alerts.py --send-test
```

The script applies only unrecorded migrations and reuses the non-secret Supabase Auth SMTP settings. The Auth settings API returns a password fingerprint, not the recoverable Gmail App Password. Enter the actual App Password directly in **Edge Functions → Secrets → MOBIUS_SMTP_PASSWORD**; the script preserves that value. It deploys the worker, sends one labeled setup message when requested, and enables the schedule. For Gmail, Auth can retain port 587/STARTTLS while the Edge Function uses Gmail's port 465 with TLS. Both verify server certificates. It never writes SMTP passwords or scheduler secrets into repository files or command output.

If the Gmail App Password changes, update the worker's secret directly. Saving a different password only in Supabase Auth does not update the separate Edge secrets. Alerts count toward Gmail's outgoing quota; Supabase Auth's email-send limit applies separately to its confirmation/reset messages.

`MOBIUS_SMTP_HOST`, `MOBIUS_SMTP_PORT`, `MOBIUS_SMTP_USER`, `MOBIUS_SMTP_PASSWORD`, `MOBIUS_SMTP_SENDER`, `MOBIUS_APPROVAL_RECIPIENT`, and `MOBIUS_ALERT_SECRET` are private Edge settings. The schedule reads `mobius_alerts_url` and `mobius_alerts_secret` from Supabase Vault. No SMTP variables are needed in Netlify. The worker uses Supabase's supplied server-side service-role binding and never exposes it to the browser.

## Monitoring

In the trusted Supabase SQL editor, inspect status counts without displaying credentials:

```sql
select status, count(*) from mobius_private.approval_alerts group by status;
select member_id, attempts, last_error, created_at
from mobius_private.approval_alerts where status = 'failed';
select jobname, active from cron.job where jobname = 'mobius-approval-alerts';
```

Errors store a sanitized category, not the SMTP response or password. Fix the delivery configuration before requeueing a failed item in the SQL editor. Monitor the cron job and provider logs; an accepted SMTP message does not guarantee inbox placement. No existing pending accounts are backfilled by the migration.

`npm run test:alerts` exercises worker authentication, fixed-recipient delivery, failure handling, and safe acknowledgment. `npm run test:supabase` exercises the real local queue, email-confirmation timing, lease protection, and membership approval. Local tests never send production notifications.
