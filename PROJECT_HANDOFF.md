# MobiusBG project handoff

This guide is for developers and AI coding agents continuing work on MobiusBG. Read [AGENTS.md](AGENTS.md) before changing code, then consult the feature documents linked below. Confirm the current code and deployment state before making assumptions: this document is a handoff, not a guarantee that production still matches a particular commit.

## What the application does

Mobius Buying Group lets members reserve units on deals, buy those items with their own money, submit delivery information, and track payments recorded by the group. The application records payments; it does not transfer money. It also accepts eligible shipping-label requests; labels are prepared outside the app.

The public site is at `https://mobiusbg.netlify.app`. The public landing page is `/`, signup is `/join`, the authenticated workspace is `/workspace`, and member profiles are at `/profile`. The repository is `https://github.com/harpin14789/MobiusBG`.

## Roles and important workflows

- **Super admin:** Manages members and approvals, roles, deals, group reservations, deliveries, label requests, payments, and private member profiles. The protected Mobius account cannot be demoted through the app. Super admins do not reserve units.
- **Admin:** Can view, post, edit, and archive deals. Admins do not reserve units or manage member profiles, deliveries, payments, approvals, or roles.
- **Member:** Can view deals, reserve units, adjust or cancel their own reservations within the applicable limits, submit delivery details and eligible label requests, view their payments, and maintain their profile and payout methods.

New email and Google accounts require super-admin approval. Email accounts also require email confirmation. A reservation alone is not a delivery submission. The delivery tracker should show submitted deliveries, and requesting a shipping label is a member action, not a super-admin delivery action. Super admins review label requests separately.

Members can save up to one US bank, Zelle, and Taekus Pay method each. Super admins can view these details and receive an email when payment information changes; notification emails do not include the sensitive details. Posting-only admins cannot access them.

Super admins can edit individual reservations and assign a private payout to one member on a deal. Custom pricing applies to future reservations; existing reservations preserve their saved terms unless edited. Reservation quantities cannot be reduced below committed deliveries, label requests, or received units. Reservation payout terms cannot be changed after units have been received or paid. Authorization and capacity rules must be enforced in the database as well as in the interface.

See [member roles](docs/member-roles.md), [member profiles](docs/member-profiles.md), and [member submissions](docs/member-submissions.md) for details. Check [CHANGELOG.md](CHANGELOG.md) and Git history for the development timeline.

## Code and infrastructure

- Next.js, React, and TypeScript provide the application. Main workspace UI: `app/dashboard.tsx`; profiles: `app/profile/`; shared types/state: `lib/store.ts`; Supabase integration: `lib/supabase.ts`.
- Supabase provides authentication, Postgres, row-level security, database functions, and scheduled notification processing. Database changes belong in new files under `supabase/migrations/`; do not edit already-applied migrations or apply production changes casually.
- The `approval-alerts` Edge Function handles approval and member event email queues. Gmail SMTP credentials are configured privately in Supabase Auth and Edge Function secrets; changing one does not automatically update the other. See [approval alerts](docs/approval-alerts.md) and [email delivery](docs/email-delivery.md).
- GitHub `main` is connected to Netlify. Pushing to `main` triggers a production deployment; check Netlify's deploy status before assuming changes are live. Changes requiring database migrations or Edge Function updates also need those deployed to Supabase; a Git push alone does not do that.
- Google OAuth is configured through Google and Supabase; see [Google sign-in](docs/google-sign-in.md). Hosted authentication settings and credentials may change independently of this repository.

## Local setup and testing

Use Node.js 24 and npm. Clone the repository, run `npm ci`, and start with `npm run dev`. Production build: `npm run build`. Type check: `npm run typecheck`. The local demo browser suite uses `npm test`; notification worker tests use `npm run test:alerts`. The Supabase integration suite uses `npm run test:supabase` and requires a running local Supabase stack, Docker, and Chromium. Follow [Supabase setup](docs/supabase.md) for exact steps and prerequisites. Run browser suites and builds sequentially because they can share Next.js build files.

The real app uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; `NEXT_PUBLIC_DEMO_MODE=true` explicitly enables a separate localStorage demo with sample data. Do not mistake demo records for production data. Public Supabase keys are designed for client use, so database policies must protect all real data.

Keep `.env.local`, service-role keys, access tokens, SMTP passwords, OAuth secrets, bank details, and other private data out of Git, logs, screenshots, and chat. Obtain any necessary access through the project owner and the relevant service accounts. Do not use a service-role key in a `NEXT_PUBLIC_` variable.

## Working together

Before starting, pull the latest changes and check `git status`. Preserve existing work and review the current implementation before modifying a feature. Coordinate production database migrations, email changes, and deployment with the project owner; do not reset databases or expose real member data during testing. Use the local Supabase stack for integration tests. After changes, update the relevant documentation and changelog when useful, run checks appropriate to the change, and describe any remaining deployment steps or unverified behavior.

## Keeping the handoff current

Every developer and AI coding assistant, regardless of model or tool, working on MobiusBG should read [AGENTS.md](AGENTS.md) and update this file and [CHANGELOG.md](CHANGELOG.md) alongside development changes. Keep the sections above accurate for the current application; record concise recent handoff notes below when useful, including verification, deployment steps, known issues, and unfinished work. Avoid duplicating sensitive data or credentials. Review Git history and the current code when resuming work, since deployments and service settings can change independently.

### Recent development handoff

- Shared documentation instructions apply to developers and AI coding assistants using any model or tool. Update the handoff and changelog together with development work. This documentation update changes no application behavior or service configuration.
