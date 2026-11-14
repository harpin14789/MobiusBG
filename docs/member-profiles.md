# Member profiles and payment changes

Members open **My profile** from the workspace, or use `/profile`. Confirmed accounts awaiting approval can complete their profile from the waiting screen. It stores a full name, optional phone/WhatsApp and Discord contact, and up to one account for each payout method:

- **US bank transfer:** account-holder name, bank name, checking/savings type, nine-digit routing number, and account number. Routing numbers are checked for length and checksum; this does not verify ownership of a bank account.
- **Zelle:** registered name and email address or phone number.
- **Taekus Pay:** the exact platform name and an alphanumeric Taekus Pay code. Case is preserved and no fixed code length is assumed, up to 128 characters.

Saving these details does not initiate a payment. Blank bank number fields preserve existing numbers; members may add or remove a method without replacing the others. Saving unchanged payment details or changing only contact information does not create an email alert.

## Access and storage

The super admin's **Members** list shows each member's name and email. Click the member to open a read-only private profile at `/profile?member=UUID`. The profile includes that member's reservation history by deal, saved payout terms, received and paid quantities, delivery submissions, and shipping-label request status. Bank numbers are masked until **Show bank details** is selected; full bank-detail views are recorded in the audit log. Each member can read and edit only their own profile. Posting-only Admin accounts cannot access payment profiles, including direct API calls. Membership role and active status cannot be changed through profile editing.

Payment payloads are encrypted in the database using pgcrypto AES-256 with a key generated and retained in Supabase Vault. They are kept in `mobius_private.member_payment_profiles`, which has no browser table access. The authenticated `get_member_payment_methods` and `save_member_payment_methods` functions enforce ownership/super-admin authorization before decrypting or saving. Normal membership-list queries contain no payment payloads. Financial information is not saved to app localStorage or email notifications. Do not export or print Vault keys or payment ciphertext/decrypted records into logs or repository files.

## Payment update notifications

The same scheduled [email worker](approval-alerts.md) sends the owner an alert when payment information is added, changed, removed, or switched to another method. The email identifies the member by name and email and links to their authenticated profile. It deliberately excludes bank numbers, Zelle identifiers, and Taekus codes. Every actual payment change creates a separate event; failed sends use the same bounded retry/lease design as approval alerts. Emails may arrive a few minutes after saving, depending on queue volume.

## Super-admin management flow

Only active regular Members can reserve units. Super admins and posting-only Admins cannot reserve deals through the UI or API. Super-admin **Reservations** groups records by deal, showing reserved units/capacity, member count, received units, and unpaid received units. **View reservations** opens the member breakdown, delivery details, and quick links to the filtered delivery/payment screens. Member search and approval-status filters help review accounts, and sidebar counts highlight pending memberships and new label requests.
