# MobiusBG development history

This document summarizes the development recorded in this repository, from the initial application through the latest changes. The commit IDs link each milestone to its Git history. More detailed setup and feature documentation is in the [docs folder](docs/).

## Initial application and hosting

- **Initial buying group application** (`1d81b12`): Created the Next.js app and Supabase-backed workspace with authenticated accounts, deals, reservations, deliveries, receipts, and payment records. Added a separate local demo mode and safeguards for capacity, saved payout amounts, and payment totals.
- **Public landing page** (`ab93eee`): Added the public Mobius landing page and moved the authenticated workspace to `/workspace`. Configured the project for GitHub and Netlify hosting.

## Accounts and access

- **Email signup and approval** (`9bd93f3`): Added account creation, email confirmation, and a waiting screen until a super admin approves membership. Configured Gmail SMTP for signup and password-reset emails; see [email delivery](docs/email-delivery.md).
- **Google sign-in** (`7ec0aa9`): Added Google sign-in to the signup and login screens. New Google users still require membership approval; callback errors are handled. See [Google sign-in](docs/google-sign-in.md).
- **Privacy policy** (`71330e4`): Added a public privacy policy and links from the landing and authentication pages.
- **Roles and approval alerts** (`8c71ab9`): Added the protected Mobius super-admin role, a deal-management Admin role, and regular Member access. Only the super admin can approve members and assign roles. Added scheduled email alerts for new members awaiting approval. See [roles](docs/member-roles.md) and [alerts](docs/approval-alerts.md).

## Deals and reservations

- **Deal management and retailers** (`f82128a`): Allowed admins and the super admin to post, edit, and archive deals with multiple retailer links. Existing reservations retain their saved payout terms when a deal changes.
- **Super-admin reservation management** (`e77f2e0`): Organized reservations by deal, with member breakdowns, quantities, and links to related delivery and payment records. Only members can reserve units.
- **Reservation history on member profiles** (`08b514f`): Added each member's reservations and related delivery and payment information to their super-admin profile view.
- **Reservation editing and private pricing** (`31a263e`): Members can increase, reduce, or cancel their reservations, subject to capacity and committed delivery quantities. Super admins can edit individual reservations and set a private base payout and commission for a specific member's future reservations. Existing reservation prices stay saved unless a super admin changes them; prices cannot be changed after units are received or paid. Members are notified of super-admin changes. See [member submissions](docs/member-submissions.md).

## Deliveries and payments

- **Delivery and label forms** (`8c71ab9`): Expanded member submissions to capture tracking and delivery information, and added shipping-label requests for eligible deals with minimum quantities and box details. The super admin can review and update label-request status; the app does not purchase or generate labels.
- **Member profiles and payout details** (`e77f2e0`, `8b3375c`): Added member profile editing and support for up to one US bank transfer, Zelle, and Taekus Pay method each. The super admin can view member profiles and receives an alert when payout information changes. Payout information is protected in Supabase, and alert emails omit financial details. See [member profiles](docs/member-profiles.md).
- **Member event emails** (`8b3375c`): Added queued notifications for new or updated deals, received units, and recorded payments. Payments are made outside the app; the email reports the recorded update.
- **Delivery workflow correction** (`16083bf`): Changed the delivery tracker to show submitted member deliveries rather than every reservation, and removed member-only shipping-label actions from the super-admin delivery view.

## Deployment and verification

The app is hosted on Netlify and uses Supabase for authentication, data, and scheduled email processing. GitHub's `main` branch is connected to Netlify for deployment. The repository includes local browser, database integration, and alert-worker tests. See [Supabase setup](docs/supabase.md) for configuration and testing instructions.

This history summarizes work represented in the repository; it does not claim that every production integration has been independently verified for every user or provider.

## Shared development handoff

- Added `PROJECT_HANDOFF.md` and instructions for developers and AI coding assistants using any model or tool to maintain the handoff and changelog as the project evolves.
