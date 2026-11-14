# Planned fulfillment and payout workflow

These are requirements supplied by the co-founder for a future replacement of the current systems. They are a planning record, not a claim that these capabilities are implemented. Confirm unresolved decisions before implementation and consult the existing feature documentation for current behavior.

## Deal setup and commitments

- A deal can allow warehouse drop-off, labels for tax-exempt members, or dropshipping to a tax-free warehouse address. Confirm whether a deal may offer multiple methods and how tax-exempt eligibility is established.
- The deal poster sets a separate customizable commitment cap for each combination of region (West, Central, or East) and fulfillment method (dropship, warehouse drop-off, or label needed). Confirm how a member's region is determined.
- Enforce the agreed caps and availability in database transactions, including edits and simultaneous reservations; do not rely only on browser checks.

## Delivery and receipt

- Members submit tracking numbers for dropship orders.
- The super admin uploads labels they have generated for members, and members receive the labels by email. Define supported file types, secure storage, access, and how to recover if an email fails.
- Members dropping off at Blue Ocean submit the drop-off code shown on their receipt.
- A submitted delivery prompts the super admin to verify receipt, manually or via a future Blue Ocean API integration. API availability, credentials, identifiers, event semantics, and documentation have not been confirmed. A received quantity becomes pending payment; partial receipts and duplicate notifications must be handled safely.

## Payouts and invoices

- The super admin can adjust an individual's payout while it is pending, for example to compensate for boxes. Define whether adjustments are per unit or a separate amount, how they apply to partial receipts, and how the member is informed. Preserve history and prevent retroactive changes to amounts already paid.
- Generate a list of amounts awaiting payment, including member, item, quantity, payout price, and total; define filters and export format.
- Defer invoice generation until after the other functionality. Revisit the invoice recipient, issuer, format, and treatment of adjustments with the owner later.
- Potential later feature: an ACH batch file for US Bank. Obtain the bank's current specifications and security requirements before design or implementation. Handle bank details and generated files as sensitive data; this is not currently a payment-processing feature.

## Existing functionality and key differences

Existing deal and delivery flows, label requests, manual receipt and payment records, and member-specific pricing are described in [member submissions](member-submissions.md) and [member profiles](member-profiles.md). Label requests currently do not generate or email labels. Current reservation pricing cannot be edited after any units are received or paid; the proposed pending-payment adjustment requires a deliberate change to that rule. Blue Ocean integration, the requested caps, invoices, and ACH export are not established by this document as implemented.
