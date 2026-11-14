# Member roles

| Role | Access |
| --- | --- |
| Super admin | Full group operations, delivery/payment records, membership approval, profiles, and role management. Cannot reserve units. |
| Admin | View deals and post new deals only. No reservations, delivery/payment records, audit log, membership approval, or role assignment. |
| Member | View available deals, reserve units, submit their own deliveries, and read their own payout records. |

`themobiusenterprises@gmail.com` is promoted to the protected `super_admin` role by migration `20261114000100`. All new accounts still start as inactive `member` accounts. In **Members**, the super admin can approve an account and choose **Admin** or **Member** from its role selector. Assigning a role does not approve membership; inactive admins cannot post deals.

The protected super-admin account cannot be demoted or deactivated through the application. Creating another super admin requires a trusted database administrator; the app can assign only Admin and Member. Direct browser profile updates and metadata-based elevation remain forbidden. Role and membership changes are audited, and database authorization checks the current profile on each request, including existing sessions. Screens refresh their role within the normal membership refresh interval or on reload.

The existing SQL function `is_admin()` is retained for compatibility with operational functions and policies, but now returns true only for an active super admin. Deal posting uses `can_post_deals()` separately. `is_member()` permits normal member operations for active members and the super admin, not the posting-only Admin role. These rules are enforced in database functions and row-level policies in addition to the UI.
