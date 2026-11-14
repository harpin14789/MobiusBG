# Mobius Buying Group

A first interactive prototype for a private buying group. Members purchase deals with their own funds; the group pays the advertised base amount plus any explicit commission per accepted unit.

## Run locally

Requires Node.js 24 and npm. From `/workspace/MobiusBG`:

```sh
npm ci --cache /workspace/.npm-cache
npm run dev
```

For a production build, run `npm run build` then `npm start`. Use `npm run typecheck` and `npm test` for validation. Browser tests use `/usr/bin/chromium`; set `CHROMIUM_PATH` to use another Chromium executable.

## Current functionality

- Public landing page at `/` with membership inquiries, FAQs, and member sign-in at `/workspace`. Existing root invitation and recovery callbacks are forwarded with their authentication parameters preserved. Explicit local demo mode retains its dashboard at `/`.
- Email signup at `/join`, email confirmation, and administrator approval in **Members**. Accounts cannot grant themselves access. Production signup requires configured [email delivery](docs/email-delivery.md); SMTP credentials are stored only in Supabase.
- [Google sign-in](docs/google-sign-in.md) on both auth screens, using the same administrator approval rules. Google provider credentials are configured only in Supabase.
- [Three member roles](docs/member-roles.md): protected Mobius super admin, posting-only Admin, and regular Member. Only the super admin can approve memberships or assign roles.
- [Approval alerts](docs/approval-alerts.md) email the owner after a new account verifies its email, with a private retry queue and a scheduled Supabase worker.

- Admin preview: post deals with product links, deadlines, quantities, delivery instructions, base payouts, and optional commissions.
- Member preview: browse/search deals and reserve available quantities.
- Reservations capture base and commission amounts at creation, in integer cents.
- Record warehouse shipping, local drop-off, or admin-provided-label delivery details.
- Record partial receipts and cumulative paid quantities. Payment records cannot exceed received quantities. Receipt and payment counts cannot be decreased through the UI.
- Awaiting payout is the received quantity less paid quantity, multiplied by the reservation's saved per-unit payout.
- Responsive layout, browser persistence, and keyboard-accessible dialogs.

## Supabase workspace

See [Supabase setup](docs/supabase.md) for project creation, the database migration, private member login, first-admin activation, invitations, environment variables, and integration testing.

The app requires Supabase configuration by default. Each member has an individual account, sees only their own reservations and payout details, and can see shared deal capacity. The super admin manages all records and membership approvals; posting-only admins can view and create deals. Database functions prevent overbooking, preserve payout terms, and validate receipts/payments regardless of browser inputs.

For the isolated sample-data demo, explicitly set `NEXT_PUBLIC_DEMO_MODE=true` before starting or building. This mode stores data only in this origin’s localStorage and provides a role-preview switch. It never sends payments or creates labels. Clear the `mobius-demo-v1` localStorage key to reset demo data. Real accounts use Supabase and never import demo records.
