# Supabase setup

Mobius supports an authenticated Supabase workspace and a separately enabled browser-local demo. Without configuration, the app shows a setup screen; it never silently falls back to fake records.

## Hosted project

1. Create a Supabase project named **MobiusBG** in your organization. The management API can also do this when a `SUPABASE_ACCESS_TOKEN` binding for `api.supabase.com` is available in the cloud environment. That token is for provisioning only; the app does not read it.
2. Apply `supabase/migrations/20261113000100_buying_group.sql` using the project's SQL editor. It is a one-time transactional migration; do not reapply it after success. Alternatively, link the Supabase CLI to the project and run `supabase db push`.
3. Under Authentication settings, keep anonymous sign-ins off and email confirmation on. Enable public email sign-ups **after configuring and verifying SMTP**. Set a minimum password length of 12. Configure the Site URL and allowed redirect URLs to the actual application origin. Confirmation, invitation, and recovery links redirect to the root URL, which forwards authentication callbacks to `/workspace`.
4. Configure SMTP before enabling signup for the group. Supabase's default email delivery is restricted and is not suitable for confirming arbitrary members. SMTP credentials belong in Supabase's dashboard, not the app. See [Email delivery](email-delivery.md) for a Gmail starting option and a dedicated-provider alternative.
5. Set the app's environment variables (in cloud environment settings or an ignored `.env.local`):

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
   NEXT_PUBLIC_DEMO_MODE=false
   ```

   Use the publishable key from the project's Connect/API settings. The legacy **anon** key also works. Never use a secret or service-role key in a `NEXT_PUBLIC_` variable. These two public values are intentionally included in the browser bundle. RLS and database functions enforce authorization.

6. Allow the exact project hostname (`YOUR_PROJECT_REF.supabase.co`) in the cloud environment's outbound network settings. Keep existing allowed destinations. No service-role key is required for the running app.
7. Rebuild and restart the app after changing public variables: `npm run build`, then `npm start`. Stop a development server before building, since both use `.next`.

## Current workspace connection (verified November 13, 2026)

- Hosted project: **MobiusBG**, reference `etifpdcqrunvltzboxya`, region `us-east-1`; management status is `ACTIVE_HEALTHY`.
- App endpoint: `https://etifpdcqrunvltzboxya.supabase.co`. The ignored `/workspace/MobiusBG/.env.local` contains this URL, the project's publishable key, and `NEXT_PUBLIC_DEMO_MODE=false`. No management token or service-role key is stored there.
- The cloud environment's enforced outbound policy allows both `api.supabase.com` and `etifpdcqrunvltzboxya.supabase.co`. Management API and Auth health/settings requests succeed through the inherited HTTPS proxy with certificate verification enabled.
- Migration `20261113000100` is recorded as applied. All four application tables have RLS enabled and the application's database functions exist. Anonymous reads of `deals` return the expected HTTP 401 / PostgreSQL `42501` permission denial; do not grant anonymous table access to make this check return 200.
- Node.js 24 diagnostic scripts need `NODE_USE_ENV_PROXY=1` to use the supplied proxy. With it, the installed Supabase JavaScript client reaches the hosted API and receives the expected anonymous-access denial. Direct Node requests fail in this environment. Preserve the supplied proxy and CA variables.
- `npm run build` passes, and the production page displays the real-account sign-in form without the demo role switch. Headless Chromium using the supplied proxy cannot yet verify hosted API requests: it reports `net::ERR_CERT_AUTHORITY_INVALID` for Auth settings and PostgREST. The browser needs to trust the managed proxy's CA before browser authentication can be verified; TLS verification was not disabled.

Deployment update (November 14, 2026): the app is deployed at `https://mobiusbg.netlify.app`. Supabase's Site URL and redirect allowlist use that origin, and the first administrator account exists. The app supports email signup at `/join`, followed by email confirmation and administrator approval. Hosted public signup remains disabled until SMTP is configured and tested; anonymous sign-ins remain disabled and email confirmation remains required. The current hosted email limit is 2 per hour and must be reviewed when custom SMTP is configured. Production email delivery has not been verified; the integration suite is intentionally restricted to the local stack.

## First administrator

Create or invite your own account in Supabase Authentication → Users. If you were invited, follow the email link to set a password. In the SQL editor, promote exactly that account:

```sql
update public.profiles
set role = 'admin', active = true
where id = (select id from auth.users where email = 'YOUR_EMAIL_HERE');
```

Check that exactly one intended profile was updated. Administrator status is never taken from user-supplied metadata, a browser role switch, or the first sign-up.

Members register at `/join` using email and a password of at least 12 characters. After verifying their email, they see **Awaiting group approval**. New accounts always start as inactive members, regardless of user-supplied metadata. In the app's **Members** tab, click **Approve membership** for each intended member. Their waiting screen refreshes automatically or they can click **Check membership**. Approval and email confirmation are independent requirements: approving a profile does not bypass Auth email verification. Deactivation revokes database access even for already signed-in users. Administrators may still invite accounts through Supabase Authentication → Users. Changes to administrator roles remain a trusted SQL-editor operation.

## Security and data behavior

- Active members can read deals and group capacity. Members can only read their own reservations; administrators can read all reservations and member profiles.
- Direct browser inserts/updates/deletes are not permitted. Database functions validate authorization, quantities, money, delivery methods, and deadlines.
- A reservation locks its deal row, checks remaining capacity, snapshots payout terms, and updates capacity in a single transaction. A request UUID makes reservation retries idempotent.
- Receipt and payment totals can only increase. Payments cannot cover more units than have been received, and receipts cannot exceed the reservation. Money is stored in cents.
- Approval, reservation, delivery, receipt, and payment changes have an audit trail. Payment entries record amounts and actors; the app records transfers that you make externally and never sends money itself.
- Deals close at the end of their displayed deadline in **America/Chicago**. Browser checks and database checks use the same business date.
- Shared data refreshes every 10 seconds while visible and when the window regains focus. The database capacity check remains authoritative if the displayed capacity is stale.
- Real records are never copied from the local demo. The demo role switch and localStorage data are only available when `NEXT_PUBLIC_DEMO_MODE=true` is explicitly configured.

## Local integration testing

Node.js 24, Docker, and Chromium are required. Run from `/workspace/MobiusBG`. Use the installed CLI through `node_modules/.bin/supabase` (or `npx supabase`).

```sh
npm ci --cache /workspace/.npm-cache
npx supabase start -x realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
# Save local development credentials privately; never print or commit this file.
npx supabase status -o json > supabase/.temp/local-status.json
npm run test:supabase
```

The integration runner refuses non-loopback Supabase URLs. It creates isolated test accounts and deals only in the local stack and tests the real Auth/PostgREST/database flow, row-level access, metadata impersonation, concurrent capacity, idempotency, payout snapshots, partial receipt/payment limits, account deactivation, and browser sign-in/sign-out. It also exercises signup, the real confirmation email captured by local Mailpit on port 54324, pre-confirmation login denial, pending-member access denial, administrator approval through the browser, and signup failure messaging. The local service-role key is only read by test tooling and never exposed to the app. Test data remains in the local development database; `supabase db reset` removes **all local data** if you choose to reset it.

The regular `npm test` suite runs the explicitly enabled demo on port 3100. Supabase tests use port 3101. Run browser suites and builds sequentially; development processes must not write `.next` concurrently.

In a managed cloud container, the Supabase CLI may require permission to write its user settings outside `/workspace`. Docker must use the managed local socket. Preserve supplied proxy and certificate trust. If an internal container health probe is accidentally routed through the outbound proxy, diagnose its `no_proxy` handling and validate the local Auth health endpoint plus authenticated API requests before calling the stack ready; do not infer health from a PID or ignore failed functional requests.

In this environment, the Auth image's BusyBox `wget` health check routes its loopback request through the proxy despite loopback exclusions. Its equivalent check succeeds with `wget -Y off`; Auth also returns its expected health response through the local API gateway. For this diagnosed local-only probe problem, start with the same exclusions plus `--ignore-health-check`, then require both `curl -fsS http://127.0.0.1:54321/auth/v1/health` and the integration suite to succeed. The ignored health flag alone is never a readiness check. The hosted Supabase service does not use this local Docker setup.
