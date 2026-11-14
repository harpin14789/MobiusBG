# Planned fulfillment and payout workflow

These are requirements supplied by the co-founder for a future replacement of the current systems. They are a planning record, not a claim that these capabilities are implemented. Confirm unresolved decisions before implementation and consult the existing feature documentation for current behavior.

## Deal setup and commitments

- A deal can allow warehouse drop-off, labels for tax-exempt members, or dropshipping to a tax-free warehouse address. A deal may offer multiple methods; the deal poster chooses which are allowed. Label eligibility is set on each deal, along with the minimum quantity needed for a label; no separate member eligibility flag was requested.
- The deal poster sets a separate customizable commitment cap for each combination of region (West, Central, or East) and fulfillment method (dropship, warehouse drop-off, or label needed). Use the member's saved profile region to determine the applicable cap. Existing reservations retain their original region if the member later changes their profile region; future reservations use the updated region.
- Enforce the agreed caps and availability in database transactions, including edits and simultaneous reservations; do not rely only on browser checks.

## Delivery and receipt

- Members submit tracking numbers for dropship orders.
- The super admin uploads labels they have generated for members, and members receive the labels by email. Email a secure download link; define supported file types, secure storage, link lifetime, access, and how to recover if an email fails.
- Members dropping off at Blue Ocean submit the drop-off code shown on their receipt.
- A submitted delivery prompts the super admin to verify receipt, manually or via a future Blue Ocean API integration. API availability, credentials, identifiers, event semantics, and documentation have not been confirmed. A received quantity becomes pending payment; partial receipts and duplicate notifications must be handled safely.

## Payouts and invoices

- The super admin can adjust an individual's payout while it is pending, for example to compensate for boxes. Allow both per-unit and separate dollar adjustments; define how they apply to partial receipts and how the member is informed. Preserve history and prevent retroactive changes to amounts already paid.
- Generate a list of amounts awaiting payment, including member, item, quantity, payout price, and total; define filters and export format.
- Defer invoice generation until after the other functionality. Revisit the invoice recipient, issuer, format, and treatment of adjustments with the owner later.
- Potential later feature: an ACH batch file for US Bank. Obtain the bank's current specifications and security requirements before design or implementation. Handle bank details and generated files as sensitive data; this is not currently a payment-processing feature.

## Existing functionality and key differences

Existing deal and delivery flows, label requests, manual receipt and payment records, and member-specific pricing are described in [member submissions](member-submissions.md) and [member profiles](member-profiles.md). Label requests currently do not generate or email labels. Current reservation pricing cannot be edited after any units are received or paid; the proposed pending-payment adjustment requires a deliberate change to that rule. Blue Ocean integration, the requested caps, invoices, and ACH export are not established by this document as implemented.

## Proposed implementation sequence

This sequence is a proposal, not an implementation. The owner's answers and any necessary external integration details determine the final design.

1. **Deal options and commitments.** Allow deal posters to configure permitted fulfillment methods and a separate cap for each West/Central/East and method combination. Members choose an allowed method when reserving; the applicable region comes from their saved profile. Protect each cap against simultaneous reservations and edits, preserve existing reservations when migrating, and show available capacity clearly. Keep each existing reservation in its original region after profile changes; use deal-level label availability and minimum quantity to determine label eligibility.
2. **Delivery submissions.** Guide members through the selected method: dropship tracking, a Blue Ocean drop-off receipt code, or a label request. Keep reservation, submitted delivery, and actual receipt distinct. Support partial deliveries and ensure submissions do not exceed committed quantities. Confirm whether existing submissions need conversion and how addresses are presented.
3. **Uploaded shipping labels.** Let the super admin attach an externally generated label to the appropriate member request, with private access and a reliable notification. Use a secure link rather than an email attachment; define accepted file types, storage, retention, link lifetime, and how to resend or replace a label. This does not create labels or purchase postage.
4. **Receipt verification.** Provide a manual super-admin receipt workflow that records the quantity and evidence and moves received, unpaid units into pending payment. Explore Blue Ocean automation only after obtaining its API documentation, access and matching rules; handle duplicate events, partial receipt and failures. Keep manual review available.
5. **Pending payment and payout list.** Let the super admin adjust pending payout amounts with a reason and an audit trail without changing amounts already paid. Support per-unit and separate dollar adjustments, and handle partially paid reservations explicitly. Show/export member, item, quantity, saved payout, adjustments and amount due. Confirm the desired export format and who can access it.
6. **Later: invoice and ACH.** Revisit invoice requirements after the preceding flows work. Treat a US Bank ACH batch file as a separate future project requiring the bank's current specifications, secure handling and explicit review before use; no funds should be initiated by the app without a separately agreed workflow.

## Acceptance checks across stages

- Member, posting-only admin and super-admin permissions are enforced by database policies/functions as well as the interface.
- Concurrent reservations and quantity changes cannot exceed the appropriate cap; cancellation releases capacity without deleting history.
- Existing reservations, submissions, payout records, private member data and audit history remain intact through migrations.
- Receipt, payout adjustments and recorded payments preserve an auditable history, support partial quantities, and never count already-paid units twice.
- Test locally with representative role, concurrency, delivery and payment scenarios; verify hosted migrations and notification configuration separately before announcing deployment.

## Open decisions

- How should per-unit and separate-dollar adjustments apply to partial receipts and payments, and how should members be informed?
- What is Blue Ocean's API documentation and what identifies a drop-off or receipt? Manual verification can proceed without the API.
- What label file formats, secure-link lifetime and retention are required?
- What format should the pending-payment list use? Invoice details and ACH export are deferred.
