"use client";

import { useState, type FormEvent } from "react";
import type { Deal, DeliverySubmission, LabelRequest, Reservation } from "../lib/store";

const destinations = [
  "4 Orchard View Dr", "11075 SW 11th St", "5001 Commerce Dr",
  "1313 E Burnside St", "3842 NE 70th Ave", "7315 SE Lincoln St",
  "2226 SE 55th Ave", "Blue Ocean Dropoff", "Speeder Solutions TX Dropoff",
  "Shipped to home", "Other",
];

type Common = {
  email: string; deal: Deal; reservation: Reservation;
  busy: boolean; error: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function DeliveryForm({ email, deal, reservation, submission, busy, error, onSubmit }: Common & { submission: DeliverySubmission | null }) {
  const initial = submission?.destination || "";
  const [destination, setDestination] = useState(destinations.includes(initial) ? initial : initial ? "Other" : "");
  const remaining = reservation.quantity - (reservation.submissions || []).reduce((n, s) => n + s.quantity, 0);
  return <form onSubmit={onSubmit}>
    <p className="form-help">Submit once per unique UPC/item type. Put all tracking numbers for that UPC in the same submission. Total submitted units cannot exceed your reservation.</p>
    <label>Email<input type="email" value={email} readOnly aria-readonly="true" /></label>
    <label>Name on payment account<input name="payment_name" maxLength={120} defaultValue={submission?.payment_name} autoComplete="name" required /></label>
    <label>Deal<input value={deal.title} readOnly aria-readonly="true" /></label>
    <label>Product UPC<input name="upc" inputMode="numeric" pattern="(?:[0-9]{8}|[0-9]{12,14})" title="Enter an 8, 12, 13, or 14 digit product barcode" defaultValue={submission?.upc} required /></label>
    <label>Delivery method<select name="method" defaultValue={submission?.method || reservation.method || "Ship to warehouse"}><option>Ship to warehouse</option><option>Local drop-off</option><option>Admin-provided label</option></select></label>
    <label>Tracking number or drop-off reference<textarea name="reference" rows={3} maxLength={2000} defaultValue={submission?.reference || (!reservation.submissions?.length ? reservation.reference : "")} required aria-describedby="tracking-help" /></label>
    <p id="tracking-help" className="form-help">Separate tracking numbers with a comma and a space. For Blue Ocean drop-offs, use the receipt ID below the barcode, such as XX-MOBUS-YOURNAME-123123123123.</p>
    <label>Submission quantity<input name="delivery_quantity" type="number" min={1} max={reservation.quantity} step={1} defaultValue={submission?.quantity || Math.max(1, remaining)} required /></label>
    <label>Destination address<select aria-label="Destination address" name="destination_choice" value={destination} onChange={e => setDestination(e.target.value)} required><option value="">Select a destination</option>{destinations.map(d => <option key={d}>{d}</option>)}</select></label>
    {destination === "Other" && <label>Other destination<input name="destination_other" maxLength={300} defaultValue={initial === "Other" ? "" : initial} required /></label>}
    {destination === "Shipped to home" && <p className="form-help">If this deal offers prepaid labels, request a label from your reservation. You can then add the tracking number here after the label has been provided.</p>}
    <label>Amazon delivery OTP codes (optional)<input name="amazon_otp" maxLength={100} defaultValue={submission?.amazon_otp} autoComplete="off" aria-describedby="otp-help" /></label>
    <p id="otp-help" className="form-help">Only Amazon package-delivery codes, if needed. Never enter a sign-in code or password.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <button disabled={busy} className="primary full">Save delivery details</button>
  </form>;
}

export function LabelRequestForm({ email, deal, reservation, request, busy, error, onSubmit }: Common & { request: LabelRequest | null }) {
  return <form onSubmit={onSubmit}>
    <p className="form-help">One request per reserved item/deal. We can combine boxes when preparing labels. This deal requires at least {deal.label_min_quantity} units per request. Submitting a request does not generate a carrier label automatically.</p>
    <label>Email<input type="email" value={email} readOnly aria-readonly="true" /></label>
    <label>WhatsApp phone number or Discord tag<input name="contact" maxLength={120} defaultValue={request?.contact} required /></label>
    <label>Item / deal<input value={deal.title} readOnly aria-readonly="true" /></label>
    <label>Shipping-from ZIP code<input name="origin_zip" autoComplete="postal-code" inputMode="numeric" pattern="[0-9]{5}(?:-[0-9]{4})?" defaultValue={request?.origin_zip} required /></label>
    <label>Quantity breakdown by box<input name="box_quantities" placeholder="5 / 5 / 5" defaultValue={request?.box_quantities.join(" / ")} required aria-describedby="box-quantity-help" /></label>
    <p id="box-quantity-help" className="form-help">Enter the number of units in each box, separated with slashes. The total must meet the deal’s label minimum and cannot exceed your {reservation.quantity} reserved units.</p>
    <label>Box weights in pounds<input name="box_weights" placeholder="25 / 25 / 25" defaultValue={request?.box_weights.join(" / ")} required aria-describedby="box-weight-help" /></label>
    <p id="box-weight-help" className="form-help">One weight per box, in the same order as your quantities. Use pounds, for example 25 lb / 25 lb / 25 lb.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <button disabled={busy} className="primary full">Submit label request</button>
  </form>;
}
