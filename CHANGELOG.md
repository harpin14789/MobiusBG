# MobiusBG changelog

This file tracks notable changes to the application. Detailed setup and feature documentation is available in the `docs` folder.

## Reservation management and member-specific pricing

- Members can edit their reservation quantities or cancel a reservation. Quantities already committed to delivery, a shipping-label request, or receipt are protected.
- Super admins can edit an individual member's reservation, including its payout before units have been received or paid.
- Super admins can set a private payout for a specific member on a deal. The custom price applies to future reservations; existing reservations retain their saved terms unless a super admin changes them.
- Affected members receive an email notification when a super admin changes their reservation or member-specific pricing, subject to the configured email service.
