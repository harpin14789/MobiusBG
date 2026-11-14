"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  Infinity as InfinityIcon,
  LayoutDashboard,
  Package,
  Plus,
  Search,
  ShoppingBag,
  Truck,
  Users,
  X,
} from "lucide-react";
import {
  Deal,
  DeliverySubmission,
  LabelRequest,
  Reservation,
  State,
  STORAGE_KEY,
  money,
  readState,
  remaining,
  seed,
  today,
} from "../lib/store";
import { loadWorkspace, postDeal, rpc, type Profile } from "../lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DeliveryForm, LabelRequestForm } from "./submission-forms";

type Tab =
  | "Overview"
  | "Deals"
  | "My reservations"
  | "Deliveries"
  | "Payouts"
  | "Members"
  | "Reservations"
  | "Label requests";
const nav = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Deals", icon: ShoppingBag },
  { name: "My reservations", icon: Package },
  { name: "Deliveries", icon: Truck },
  { name: "Payouts", icon: CircleDollarSign },
] as const;

function Modal({
  title,
  close,
  children,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      aria-label={title}
      className={wide ? "wide-modal" : undefined}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={close}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export default function Dashboard({
  account,
  client,
  signOut,
}: {
  account?: Profile;
  client?: SupabaseClient;
  signOut?: () => Promise<void>;
}) {
  const live = !!client && !!account;
  const [state, setState] = useState<State>(
    live ? { deals: [], reservations: [] } : seed,
  );
  const [members, setMembers] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const reservationRequest = useRef("");
  const [loaded, setLoaded] = useState(false);
  const postingOnly = live && account.role === "admin";
  const [tab, setTab] = useState<Tab>(postingOnly ? "Deals" : "Overview");
  const [demoAdmin, setAdmin] = useState(false);
  const superAdmin = live && account.role === "super_admin";
  const admin = live ? superAdmin : demoAdmin;
  const canPostDeals = admin || postingOnly;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All deals");
  const [notice, setNotice] = useState("");
  const [reserveDeal, setReserveDeal] = useState<Deal | null>(null);
  const [delivery, setDelivery] = useState<Reservation | null>(null);
  const [editingSubmission, setEditingSubmission] = useState<DeliverySubmission | null>(null);
  const [labelReservation, setLabelReservation] = useState<Reservation | null>(null);
  const [labelsOffered, setLabelsOffered] = useState(false);
  const [create, setCreate] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState("");
  const [selectedReservationDeal, setSelectedReservationDeal] = useState<Deal | null>(null);
  const [reservationSearch, setReservationSearch] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [memberStatus, setMemberStatus] = useState("all");
  async function reload() {
    if (!client) return;
    const result = await loadWorkspace(client, admin);
    setState(result.state);
    setMembers(result.members);
    setLoaded(true);
  }
  useEffect(() => {
    if (client) {
      let cancelled = false;
      const refresh = async () => {
        try {
          const result = await loadWorkspace(client, admin);
          if (!cancelled) {
            setState(result.state);
            setMembers(result.members);
            setLoaded(true);
          }
        } catch (e) {
          if (!cancelled) setError((e as Error).message);
        }
      };
      void refresh();
      const timer = setInterval(() => {
        if (document.visibilityState === "visible") void refresh();
      }, 10000);
      window.addEventListener("focus", refresh);
      return () => {
        cancelled = true;
        clearInterval(timer);
        window.removeEventListener("focus", refresh);
      };
    }
    try {
      setState(readState());
    } catch {
      setNotice(
        "Saved demo data could not be read. Clear this site’s storage to reset it.",
      );
    }
    setLoaded(true);
    const sync = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        try {
          setState(readState());
        } catch {
          setNotice("Could not load saved data.");
        }
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [client, admin]);

  async function changeCloud(operation: () => Promise<void>): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
      try {
        await reload();
      } catch {
        setError(
          "Saved successfully, but the latest data could not be loaded. Refresh before making another change.",
        );
      }
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save. Please try again.",
      );
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function update(change: (current: State) => State): boolean {
    try {
      const next = change(readState());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setState(next);
      setError("");
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save. Please try again.",
      );
      return false;
    }
  }
  const reservedUnits = state.reservations.reduce((n, r) => n + r.quantity, 0);
  const receivedUnits = state.reservations.reduce((n, r) => n + r.received, 0);
  const payable = state.reservations.reduce(
    (n, r) => n + (r.received - r.paid) * (r.base + r.commission),
    0,
  );
  const paid = state.reservations.reduce(
    (n, r) => n + r.paid * (r.base + r.commission),
    0,
  );
  const openDeals = state.deals.filter(
    (d) => remaining(state, d) > 0 && d.deadline >= today(),
  );
  const visibleDeals = state.deals.filter(
    (d) =>
      `${d.title} ${d.retailer}`.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "All deals" || d.category === filter),
  );

  async function reserve(e: React.FormEvent) {
    e.preventDefault();
    if (!reserveDeal) return;
    if (client) {
      if (!reservationRequest.current)
        reservationRequest.current = crypto.randomUUID();
      if (
        await changeCloud(() =>
          rpc(client, "reserve_deal", {
            p_deal_id: reserveDeal.id,
            p_quantity: quantity,
            p_request_id: reservationRequest.current,
          }),
        )
      ) {
        setReserveDeal(null);
        setNotice("Reservation confirmed. Your payout terms are locked in.");
        setTab("My reservations");
      }
      return;
    }
    if (
      update((current) => {
        const deal = current.deals.find((d) => d.id === reserveDeal.id);
        if (!deal || deal.deadline < today())
          throw new Error("This deal has closed.");
        if (
          !Number.isSafeInteger(quantity) ||
          quantity < 1 ||
          quantity > remaining(current, deal)
        )
          throw new Error("Choose a quantity within the remaining capacity.");
        return {
          ...current,
          reservations: [
            ...current.reservations,
            {
              id: crypto.randomUUID(),
              dealId: deal.id,
              quantity,
              base: deal.base,
              commission: deal.commission,
              createdAt: new Date().toISOString(),
              method: "",
              reference: "",
              submitted: false,
              received: 0,
              paid: 0,
            },
          ],
        };
      })
    ) {
      setReserveDeal(null);
      setNotice("Reservation confirmed. Your payout terms are locked in.");
      setTab("My reservations");
    }
  }

  async function createDeal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const base = Math.round(Number(form.get("base")) * 100),
      commission = Math.round(Number(form.get("commission")) * 100),
      capacity = Number(form.get("capacity"));
    const url = String(form.get("url"));
    if (
      !Number.isSafeInteger(base) ||
      base <= 0 ||
      !Number.isSafeInteger(commission) ||
      commission < 0 ||
      !Number.isSafeInteger(capacity) ||
      capacity < 1
    ) {
      setError("Enter valid prices and a whole-number capacity.");
      return;
    }
    try {
      if (!["https:", "http:"].includes(new URL(url).protocol))
        throw new Error();
    } catch {
      setError("Enter a valid product URL starting with https:// or http://.");
      return;
    }
    const deal: Deal = {
      id: crypto.randomUUID(),
      title: String(form.get("title")).trim(),
      retailer: String(form.get("retailer")).trim(),
      category: String(form.get("category")),
      url,
      base,
      commission,
      capacity,
      deadline: String(form.get("deadline")),
      instructions: String(form.get("instructions")).trim(),
      label_min_quantity: labelsOffered ? Number(form.get("label_min_quantity")) : null,
    };
    const saved = client
      ? await changeCloud(() => postDeal(client, deal))
      : update((s) => ({ ...s, deals: [deal, ...s.deals] }));
    if (saved) {
      setCreate(false);
      setTab("Deals");
      setNotice(
        live
          ? "Deal posted. Members can now reserve units."
          : "Deal posted. Members can now reserve units in this demo.",
      );
    }
  }

  async function submitDelivery(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const method = String(form.get("method")),
      reference = String(form.get("reference")).trim();
    if (!delivery) return;
    const fields = {
      payment_name: String(form.get("payment_name")).trim(),
      upc: String(form.get("upc")).trim(),
      quantity: Number(form.get("delivery_quantity")),
      destination: String(form.get("destination_choice")) === "Other"
        ? String(form.get("destination_other")).trim() : String(form.get("destination_choice")),
      amazon_otp: String(form.get("amazon_otp") || "").trim(),
    };
    const submitted = (delivery.submissions || []).filter(s => s.id !== editingSubmission?.id);
    if (!Number.isSafeInteger(fields.quantity) || fields.quantity < 1 ||
      submitted.reduce((n,s) => n+s.quantity,0) + fields.quantity > delivery.quantity ||
      submitted.reduce((n,s) => n+s.quantity,0) + fields.quantity < delivery.received) {
      setError("Submitted quantities must fit your reservation and cannot be below received units."); return;
    }
    const submission: DeliverySubmission = {
      ...fields, id: editingSubmission?.id || crypto.randomUUID(),
      reservation_id: delivery.id, member_id: account?.id || "demo",
      email: delivery.memberEmail || account?.email || "demo@example.test", method, reference,
    };
    const saved = client
      ? await changeCloud(() =>
          rpc(client, "save_delivery_submission", {
            p_reservation_id: delivery.id,
            p_submission_id: editingSubmission?.id || null,
            p_payment_name: fields.payment_name, p_upc: fields.upc,
            p_method: method,
            p_reference: reference,
            p_quantity: fields.quantity, p_destination: fields.destination,
            p_amazon_otp: fields.amazon_otp,
          }),
        )
      : update((s) => ({
          ...s,
          reservations: s.reservations.map((r) =>
            r.id === delivery?.id
              ? { ...r, method, reference, submitted: true, submissions: [...submitted, submission] }
              : r,
          ),
        }));
    if (saved) {
      setDelivery(null);
      setEditingSubmission(null);
      setNotice("Delivery details submitted. Receipt confirmation is pending.");
    }
  }

  async function submitLabelRequest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!labelReservation) return;
    const form = new FormData(e.currentTarget);
    const quantities = String(form.get("box_quantities")).split(/[\/,]/).map(v => Number(v.trim()));
    const weights = String(form.get("box_weights")).split(/[\/,]/).map(v => Number(v.trim().replace(/\s*lbs?$/i,"")));
    const total = quantities.reduce((n,q) => n+q,0);
    const deal = state.deals.find(d => d.id === labelReservation.dealId)!;
    if (!deal.label_min_quantity || !quantities.length || quantities.length !== weights.length ||
      quantities.some(q => !Number.isSafeInteger(q) || q<1) ||
      weights.some(w => !Number.isFinite(w) || w<=0 || w>10000) ||
      total < deal.label_min_quantity || total > labelReservation.quantity) {
      setError("Enter matching quantities and positive pound weights for each box. The total must meet the label minimum and fit your reservation."); return;
    }
    const request: LabelRequest = {
      id: labelReservation.labelRequest?.id || crypto.randomUUID(), reservation_id: labelReservation.id,
      member_id: labelReservation.memberId || account?.id || "demo",
      email: labelReservation.memberEmail || account?.email || "demo@example.test",
      contact: String(form.get("contact")).trim(), origin_zip: String(form.get("origin_zip")).trim(),
      box_quantities: quantities, box_weights: weights, quantity: total, status: "requested",
    };
    const saved = client ? await changeCloud(() => rpc(client, "save_label_request", {
      p_reservation_id: labelReservation.id, p_contact: request.contact, p_origin_zip: request.origin_zip,
      p_box_quantities: quantities, p_box_weights: weights,
    })) : update(s => ({...s, reservations: s.reservations.map(r => r.id===labelReservation.id ? {...r,labelRequest:request} : r)}));
    if (saved) { setLabelReservation(null); setNotice("Shipping label request saved. The super admin will prepare labels and contact you."); }
  }

  async function record(
    e: React.FormEvent<HTMLFormElement>,
    reservation: Reservation,
    kind: "received" | "paid",
  ) {
    e.preventDefault();
    const value = Number(new FormData(e.currentTarget).get("units"));
    if (client) {
      if (
        await changeCloud(() =>
          rpc(client, "record_units", {
            p_id: reservation.id,
            p_kind: kind,
            p_units: value,
          }),
        )
      )
        setNotice(
          kind === "received"
            ? "Received quantity updated."
            : "Payment recorded. No money was transferred.",
        );
      return;
    }
    if (
      update((s) => ({
        ...s,
        reservations: s.reservations.map((r) => {
          if (r.id !== reservation.id) return r;
          const max = kind === "received" ? r.quantity : r.received;
          if (
            !Number.isSafeInteger(value) ||
            value < (kind === "received" ? r.received : r.paid) ||
            value > max
          )
            throw new Error(`Enter a total between ${r[kind]} and ${max}.`);
          return { ...r, [kind]: value };
        }),
      }))
    )
      setNotice(
        kind === "received"
          ? "Received quantity updated."
          : "Payment recorded. No money was transferred.",
      );
  }

  const visibleReservations = state.reservations.filter(r => !superAdmin ||
    `${state.deals.find(d=>d.id===r.dealId)?.title} ${r.memberEmail || ""} ${members.find(m=>m.id===r.memberId)?.full_name || ""} ${r.reference}`.toLowerCase().includes(reservationSearch.toLowerCase()));
  const reservationGroups = state.deals.map(deal => ({deal, entries: state.reservations.filter(r=>r.dealId===deal.id)}))
    .filter(group => group.entries.length && `${group.deal.title} ${group.entries.map(r=>r.memberEmail || "").join(" ")}`.toLowerCase().includes(reservationSearch.toLowerCase()));
  const groupReservations = <div className="table-wrap"><table><thead><tr><th>Deal</th><th>Reserved / capacity</th><th>Members</th><th>Received</th><th>Unpaid received units</th><th>Details</th></tr></thead><tbody>
    {reservationGroups.map(({deal,entries})=><tr key={deal.id}><td><strong>{deal.title}</strong><small>Deadline: {deal.deadline}</small></td><td>{entries.reduce((n,r)=>n+r.quantity,0)} / {deal.capacity}</td><td>{new Set(entries.map(r=>r.memberId)).size}</td><td>{entries.reduce((n,r)=>n+r.received,0)}</td><td>{entries.reduce((n,r)=>n+r.received-r.paid,0)}</td><td><button className="small-button" onClick={()=>setSelectedReservationDeal(deal)}>View reservations</button></td></tr>)}
  </tbody></table>{!reservationGroups.length && <p className="live-note">No group reservations match this search.</p>}</div>;
  const reservations = (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Product / reservation</th>
            <th>Quantity</th>
            <th>Delivery</th>
            <th>Received</th>
            <th>Total payout</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {visibleReservations.map((r) => {
            const deal = state.deals.find((d) => d.id === r.dealId)!;
            return (
              <tr key={r.id}>
                <td>
                  <strong>{deal.title}</strong>
                  <small>
                    {r.memberEmail && (
                      <>
                        {superAdmin ? <a className="member-profile-link" href={`/profile?member=${r.memberId}`}>{members.find(m=>m.id===r.memberId)?.full_name || r.memberEmail}</a> : r.memberEmail}
                        <br />
                      </>
                    )}
                    {r.id.slice(0, 8).toUpperCase()} · {money(r.base)}
                    {r.commission > 0
                      ? ` + ${money(r.commission)} commission`
                      : ""}{" "}
                    / unit
                  </small>
                </td>
                <td>{r.quantity} units</td>
                <td>
                  {r.submitted ? (
                    <>
                      <span className="badge blue">{r.method}</span>
                      <small>{r.reference}</small>
                      {!!r.submissions?.length && <details className="submission-details"><summary>{r.submissions.length} item submission{r.submissions.length === 1 ? "" : "s"}</summary>{r.submissions.map(s => <div className="submission-record" key={s.id}>
                        <strong>UPC {s.upc} · {s.quantity} units</strong>
                        <small>{s.email}<br />Payment name: {s.payment_name}<br />Destination: {s.destination}<br />{s.reference}{s.amazon_otp && <><br />Amazon delivery OTP: {s.amazon_otp}</>}</small>
                        <button className="text-button" onClick={() => {setDelivery(r);setEditingSubmission(s);setError("");}}>Edit UPC {s.upc}</button>
                      </div>)}</details>}
                    </>
                  ) : (
                    <span className="badge amber">Awaiting details</span>
                  )}
                </td>
                <td>
                  {r.received} / {r.quantity}
                </td>
                <td>
                  <strong>{money(r.quantity * (r.base + r.commission))}</strong>
                  <small>{money(r.paid * (r.base + r.commission))} paid</small>
                </td>
                <td>
                  {tab === "Payouts" && admin ? (
                    <form
                      className="inline-form"
                      onSubmit={(e) => record(e, r, "paid")}
                    >
                      <input
                        aria-label={`Total paid units for ${deal.title}`}
                        name="units"
                        type="number"
                        min={r.paid}
                        max={r.received}
                        defaultValue={r.paid}
                        key={r.paid}
                        required
                      />
                      <button disabled={busy} className="small-button">
                        Record paid
                      </button>
                    </form>
                  ) : tab === "Deliveries" && admin ? (
                    <form
                      className="inline-form"
                      onSubmit={(e) => record(e, r, "received")}
                    >
                      <input
                        aria-label={`Total received units for ${deal.title}`}
                        name="units"
                        type="number"
                        min={r.received}
                        max={r.quantity}
                        defaultValue={r.received}
                        key={r.received}
                        required
                      />
                      <button disabled={busy} className="small-button">
                        Mark received
                      </button>
                    </form>
                  ) : (
                    <button
                      className="small-button"
                      onClick={() => {
                        setDelivery(r);
                        setEditingSubmission(r.submissions?.[0] || null);
                        setError("");
                      }}
                    >
                      {r.submitted ? "Edit delivery" : "Add delivery"}
                    </button>
                  )}
                  {!postingOnly && !!r.submissions?.length && r.submissions.reduce((n,s)=>n+s.quantity,0)<r.quantity && <button className="small-button" onClick={() => {setDelivery(r);setEditingSubmission(null);setError("");}}>Add another UPC</button>}
                  {deal.label_min_quantity && !postingOnly && <div className="label-request-action">
                    {r.labelRequest && <small>Label request: {r.labelRequest.status.replace("_"," ")}</small>}
                    {r.quantity >= deal.label_min_quantity && (!r.labelRequest || r.labelRequest.status === "requested") ? <button className="small-button" onClick={() => {setLabelReservation(r);setError("");}}>{r.labelRequest ? "Edit label request" : "Request shipping label"}</button> : !r.labelRequest && <small>Prepaid label minimum: {deal.label_min_quantity} units</small>}
                  </div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {state.reservations.length === 0 && (
        <div className="empty">
          <Package size={32} />
          <h3>Your next deal starts here</h3>
          <p>
            Reserve a few units from an open deal to start tracking your
            deliveries and payouts.
          </p>
          <button className="primary" onClick={() => setTab("Deals")}>
            Explore deals <ArrowRight size={16} />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Mobius home">
          <span className="brand-icon">
            <InfinityIcon size={28} />
          </span>
          mobius<span className="brand-dot">.</span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">M</span>
          <div>
            <strong>Mobius Buying Group</strong>
            <small>Member workspace</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {[
            ...nav.filter((item) => !postingOnly || item.name === "Deals").map(item => superAdmin && item.name === "My reservations" ? {...item,name:"Reservations" as const} : item),
            ...(superAdmin
              ? [{ name: "Members" as const, icon: Users }, { name: "Label requests" as const, icon: Truck }]
              : []),
          ].map(({ name, icon: Icon }) => (
            <button
              key={name}
              aria-label={name}
              className={tab === name ? "nav-item active" : "nav-item"}
              onClick={() => {
                setTab(name);
                setReservationSearch("");
                setError("");
              }}
            >
              <Icon size={19} />
              {name}
              {name === "Members" && members.some(m=>!m.active) && <span className="nav-count">{members.filter(m=>!m.active).length}</span>}
              {name === "Label requests" && state.reservations.some(r=>r.labelRequest?.status==='requested') && <span className="nav-count">{state.reservations.filter(r=>r.labelRequest?.status==='requested').length}</span>}
              {name === "Deals" && (
                <span className="nav-count">{openDeals.length}</span>
              )}
            </button>
          ))}
          {live && !postingOnly && <a className="nav-item" href="/profile"><Users size={19} />My profile</a>}
        </nav>
        <div className="sidebar-bottom">
          <div className="group-note">
            <Users size={20} />
            <strong>Better deals. Together.</strong>
            <p>Your buying group, without the back-and-forth.</p>
          </div>
          <div className="profile">
            <span className="avatar">
              {live
                ? account.email.slice(0, 2).toUpperCase()
                : admin
                  ? "AD"
                  : "DM"}
            </span>
            <div>
              <strong>
                {live ? account.email : admin ? "Admin preview" : "Demo member"}
              </strong>
              <small>
                {live
                  ? superAdmin
                    ? "Super administrator"
                    : postingOnly ? "Admin · Deal posting" : "Member"
                  : "Local demo account"}
              </small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace</span>
            <span className="slash">/</span>
            <strong>{tab}</strong>
          </div>
          <div className="topbar-right">
            <span className="demo-pill">
              <span /> {live ? "Connected workspace" : "Demo workspace"}
            </span>
            <button
              className="role-toggle"
              onClick={() => {
                if (live) {
                  void signOut?.();
                } else {
                  setAdmin(!admin);
                  setError("");
                }
              }}
            >
              {live
                ? "Sign out"
                : admin
                  ? "Switch to member"
                  : "Switch to admin"}
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR BUYING GROUP, CONNECTED</div>
              <h1>
                {tab === "Overview"
                  ? "A little less chat. A lot more clarity."
                  : tab}
              </h1>
              <p>
                {tab === "Overview"
                  ? "Every deal, delivery, and payout. Right where you need it."
                  : tab === "Deals"
                    ? "Find your next deal. See the capacity. Reserve your units."
                    : tab === "Payouts"
                      ? "Track what’s earned, what’s pending, and what’s been paid."
                      : tab === "Deliveries"
                        ? "From purchase to warehouse, keep every unit accounted for."
                        : "Your commitments and locked-in payout terms, all in one place."}
              </p>
            </div>
            {canPostDeals ? (
              <button
                className="primary"
                onClick={() => {
                  setCreate(true);
                  setLabelsOffered(false);
                  setError("");
                }}
              >
                <Plus size={17} />
                Post a deal
              </button>
            ) : (
              <span className="member-label">
                <span /> Member view
              </span>
            )}
          </div>
          {!live && (
            <div className="demo-note">
              <span className="badge">DEMO</span> Sample deals · Data is saved
              only in this browser. Accounts, shared capacity, and payments are
              not connected.
            </div>
          )}
          {live && (
            <div className="live-note">
              Shared group capacity · Updates every 10 seconds · Payouts are
              recorded after you send payment.
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              <Check size={16} />
              {notice}
              <button
                aria-label="Dismiss notification"
                className="icon-button"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {error && !reserveDeal && !delivery && !create && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {(tab === "Overview" || tab === "Payouts") && (
            <section className="stats" aria-label="Group statistics">
              <div className="stat">
                <div className="stat-top">
                  Open deals
                  <ShoppingBag size={17} />
                </div>
                <strong>{openDeals.length.toString().padStart(2, "0")}</strong>
                <small>
                  <span className="green-dot" />
                  Ready to reserve
                </small>
              </div>
              <div className="stat">
                <div className="stat-top">
                  Reserved units
                  <Package size={17} />
                </div>
                <strong>{reservedUnits.toString().padStart(2, "0")}</strong>
                <small>{receivedUnits} units received</small>
              </div>
              <div className="stat">
                <div className="stat-top">
                  Awaiting payout
                  <Clock3 size={17} />
                </div>
                <strong>{money(payable)}</strong>
                <small>Received units, not yet paid</small>
              </div>
              <div className="stat">
                <div className="stat-top">
                  Total paid
                  <ArrowDownLeft size={17} />
                </div>
                <strong>{money(paid)}</strong>
                <small>Recorded payments</small>
              </div>
            </section>
          )}
          {(tab === "Overview" || tab === "Deals") && (
            <>
              <section className="section-heading">
                <div>
                  <h2>
                    {tab === "Overview"
                      ? "Find your next opportunity"
                      : "Open opportunities"}
                    <span className="count">{visibleDeals.length}</span>
                  </h2>
                  <p>Good deals move fast. Lock in your spot.</p>
                </div>
                {tab === "Overview" && (
                  <button
                    className="text-button"
                    onClick={() => setTab("Deals")}
                  >
                    View all deals <ArrowRight size={16} />
                  </button>
                )}
              </section>
              <div className="filters">
                <div className="filter-tabs">
                  {[
                    "All deals",
                    "Laptops",
                    "Graphics cards",
                    "VR & gaming",
                  ].map((f) => (
                    <button
                      key={f}
                      className={filter === f ? "selected" : ""}
                      onClick={() => setFilter(f)}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <label className="search">
                  <Search size={16} />
                  <input
                    aria-label="Search deals"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search deals…"
                  />
                </label>
              </div>
              <section className="deal-grid">
                {visibleDeals.map((d) => {
                  const left = remaining(state, d),
                    reserved = d.capacity - left,
                    closed = d.deadline < today(),
                    available = left > 0 && !closed;
                  return (
                    <article className="deal-card" key={d.id}>
                      <div
                        className={`product-visual ${d.category === "Laptops" ? "laptop" : d.category === "Graphics cards" ? "graphics" : "vr"}`}
                      >
                        <span className="category">{d.category}</span>
                        <span
                          className={`availability ${available ? "" : "closed"}`}
                        >
                          <span />
                          {closed ? "Closed" : left === 0 ? "Filled" : "Open"}
                        </span>
                        {d.category === "Laptops" ? (
                          <div className="laptop-art">
                            <div className="screen">
                              <div />
                            </div>
                            <div className="keyboard" />
                          </div>
                        ) : d.category === "Graphics cards" ? (
                          <div className="gpu-art">
                            <div className="fan" />
                            <div className="fan" />
                            <div className="gpu-label">GEFORCE RTX</div>
                          </div>
                        ) : (
                          <div className="quest-art">
                            <div className="headset">
                              <i />
                              <i />
                              <i />
                            </div>
                            <div className="controller left" />
                            <div className="controller right" />
                          </div>
                        )}
                      </div>
                      <div className="deal-content">
                        <div className="retailer">
                          {d.retailer}
                          <span>·</span>Ends{" "}
                          {new Date(
                            d.deadline + "T12:00:00",
                          ).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </div>
                        <h3>{d.title}</h3>
                        <div className="payout-line">
                          <div>
                            <span className="field-caption">
                              YOU RECEIVE / UNIT
                            </span>
                            <strong>{money(d.base + d.commission)}</strong>
                          </div>
                          {d.commission > 0 && (
                            <span className="commission">
                              +{money(d.commission)} commission
                            </span>
                          )}
                        </div>
                        <p className="base-price">
                          {money(d.base)} base
                          {d.commission > 0
                            ? ` + ${money(d.commission)} commission`
                            : " · No additional commission"}
                        </p>
                        {!!d.label_min_quantity && <p className="label-offer">Prepaid shipping labels · minimum {d.label_min_quantity} units</p>}
                        <div className="capacity-label">
                          <span>
                            <strong>{left}</strong> of {d.capacity} spots left
                          </span>
                          <span>{reserved} reserved</span>
                        </div>
                        <div className="progress">
                          <span
                            style={{
                              width: `${(reserved / d.capacity) * 100}%`,
                            }}
                          />
                        </div>
                        <div className="card-footer">
                          <a href={d.url} target="_blank" rel="noreferrer">
                            Retailer <ExternalLink size={13} />
                          </a>
                          {!canPostDeals && <button
                            disabled={busy || !loaded || !available}
                            className="reserve-button"
                            onClick={() => {
                              reservationRequest.current = crypto.randomUUID();
                              setReserveDeal(d);
                              setQuantity(1);
                              setError("");
                            }}
                          >
                            {available ? "Reserve units" : "Unavailable"}
                            <ArrowRight size={15} />
                          </button>}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>
              {visibleDeals.length === 0 && (
                <div className="empty">
                  <Search />
                  <h3>No deals found</h3>
                  <p>Try a different search or category.</p>
                </div>
              )}
            </>
          )}
          {tab === "Overview" ? (
            <>
              <section className="section-heading lower">
                <div>
                  <h2>{superAdmin ? "Reservations by deal" : "Your reservations"}</h2>
                  <p>{superAdmin ? "Group totals with a member-by-member breakdown for each deal." : "A clear picture of what’s in motion."}</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => setTab(superAdmin ? "Reservations" : "My reservations")}
                >
                  View reservations <ArrowRight size={16} />
                </button>
              </section>
              {superAdmin ? groupReservations : reservations}
            </>
          ) : (
            tab !== "Deals" &&
            tab !== "Members" && tab !== "Label requests" && tab !== "Reservations" && (
              <>
                <section className="section-heading">
                  <div>
                    <h2>
                      {tab === "Payouts"
                        ? "Payment ledger"
                        : tab === "Deliveries"
                          ? "Delivery tracker"
                          : "Your reservations"}
                    </h2>
                    <p>
                      {admin && tab === "Deliveries"
                        ? "Enter the cumulative number of units received for each reservation."
                        : admin && tab === "Payouts"
                          ? "Record cumulative paid units after sending payment through your usual method."
                          : "Amounts are based on the payout terms at the time of reservation."}
                    </p>
                  </div>
                </section>
                {superAdmin && <label>Search group reservations<input value={reservationSearch} onChange={e=>setReservationSearch(e.target.value)} placeholder="Deal, member name, email, or reference" /></label>}
                {reservations}
              </>
            )
          )}
          {tab === "Reservations" && superAdmin && <section><h2>Reservations by deal</h2><p className="live-note">Select a deal to see who reserved units, delivery details, and payment status.</p><label>Search reservations by deal or member<input value={reservationSearch} onChange={e=>setReservationSearch(e.target.value)} /></label>{groupReservations}</section>}
          {tab === "Members" && superAdmin && live && (
            <section className="members-section">
              <h2>Group members</h2>
              <p>
                New members create an account at /join and confirm their email.
                Approve their membership here when you’re ready to give them
                access. Assign Admin to let someone post deals only. Delivery
                and payment records stay restricted to the super admin and
                each regular member’s own records. Only super admins can approve
                membership or change roles; role changes do not activate an account.
              </p>
              <div className="form-row"><label>Search members<input value={memberSearch} onChange={e=>setMemberSearch(e.target.value)} placeholder="Name or email" /></label><label>Membership status<select aria-label="Membership status" value={memberStatus} onChange={e=>setMemberStatus(e.target.value)}><option value="all">All members</option><option value="pending">Awaiting approval</option><option value="active">Active</option></select></label></div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.filter(m=>`${m.full_name || ""} ${m.email}`.toLowerCase().includes(memberSearch.toLowerCase()) && (memberStatus==='all' || (memberStatus==='pending' ? !m.active : m.active))).sort((a,b)=>Number(a.active)-Number(b.active)||(a.full_name||a.email).localeCompare(b.full_name||b.email)).map((m) => (
                      <tr key={m.id}>
                        <td><a className="member-profile-link" href={`/profile?member=${m.id}`}><strong>{m.full_name || "Name not provided"}</strong><small>{m.email}</small></a></td>
                        <td>
                          {m.role === "super_admin" ? "Super admin (protected)" : (
                            <select
                              aria-label={`Role for ${m.email}`}
                              value={m.role}
                              disabled={busy}
                              onChange={(event) => {
                                const role = event.target.value;
                                void changeCloud(() => rpc(client!, "set_member_role", {
                                  p_id: m.id,
                                  p_role: role,
                                }));
                              }}
                            >
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                            </select>
                          )}
                        </td>
                        <td>{m.active ? "Active" : "Awaiting approval"}</td>
                        <td>
                          {m.role !== "super_admin" && (
                            <button
                              disabled={busy}
                              className="small-button"
                              onClick={() =>
                                void changeCloud(() =>
                                  rpc(client!, "set_member_active", {
                                    p_id: m.id,
                                    p_active: !m.active,
                                  }),
                                )
                              }
                            >
                              {m.active ? "Deactivate" : "Approve membership"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {tab === "Label requests" && superAdmin && live && <section className="members-section">
            <h2>Shipping label requests</h2><p>Prepare carrier labels separately, combine boxes as appropriate, and contact the member using the details below. Posting-only admins cannot see these requests.</p>
            <div className="table-wrap"><table><thead><tr><th>Member / item</th><th>Contact / origin</th><th>Boxes</th><th>Status</th></tr></thead><tbody>
              {state.reservations.filter(r => r.labelRequest).map(r => {
                const request=r.labelRequest!;
                return <tr key={request.id}><td><strong>{state.deals.find(d=>d.id===r.dealId)?.title}</strong><small>{request.email}<br />{request.quantity} total units</small></td>
                  <td>{request.contact}<small>Ships from ZIP {request.origin_zip}</small></td>
                  <td>{request.box_quantities.map((q,i)=><small key={i}>Box {i+1}: {q} units · {request.box_weights[i]} lb</small>)}</td>
                  <td><select aria-label={`Label status for ${request.email}`} value={request.status} disabled={busy} onChange={e=>{const status=e.target.value;void changeCloud(()=>rpc(client!,"set_label_request_status",{p_id:request.id,p_status:status}));}}><option value="requested">Requested</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select></td></tr>;
              })}
            </tbody></table></div>
            {!state.reservations.some(r=>r.labelRequest) && <p>No shipping label requests yet.</p>}
          </section>}
          <footer>
            Made for the way your group buys.
            <span>
              <InfinityIcon size={17} /> mobius
            </span>
          </footer>
        </main>
      </div>
      {reserveDeal && (
        <Modal title="Reserve your units" close={() => setReserveDeal(null)}>
          <form onSubmit={reserve}>
            <div className="modal-product">
              <ShoppingBag size={23} />
              <div>
                <h3>{reserveDeal.title}</h3>
                <p>{remaining(state, reserveDeal)} units available</p>
              </div>
            </div>
            <p className="instructions">{reserveDeal.instructions}</p>
            <label>
              Quantity
              <input
                autoFocus
                type="number"
                min="1"
                max={remaining(state, reserveDeal)}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                required
              />
            </label>
            <div className="price-summary">
              <span>
                Base per unit<strong>{money(reserveDeal.base)}</strong>
              </span>
              <span>
                Commission per unit
                <strong>{money(reserveDeal.commission)}</strong>
              </span>
              <span className="total">
                Total payout
                <strong>
                  {money(
                    (reserveDeal.base + reserveDeal.commission) *
                      (Number.isFinite(quantity) ? quantity : 0),
                  )}
                </strong>
              </span>
            </div>
            <p className="form-help">
              You purchase with your own funds. These payout terms are saved
              with your reservation. Payment becomes due as units are received.
            </p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button disabled={busy} className="primary full">
              Confirm reservation <ArrowRight size={16} />
            </button>
          </form>
        </Modal>
      )}
      {selectedReservationDeal && superAdmin && <Modal wide title={`Reservations · ${selectedReservationDeal.title}`} close={()=>setSelectedReservationDeal(null)}>
        <p className="form-help">{state.reservations.filter(r=>r.dealId===selectedReservationDeal.id).reduce((n,r)=>n+r.quantity,0)} units reserved of {selectedReservationDeal.capacity} capacity.</p>
        <div className="table-wrap"><table><thead><tr><th>Member</th><th>Reserved</th><th>Received</th><th>Paid units</th><th>Awaiting payout</th><th>Delivery</th></tr></thead><tbody>
          {state.reservations.filter(r=>r.dealId===selectedReservationDeal.id).map(r=><tr key={r.id}><td><a className="member-profile-link" href={`/profile?member=${r.memberId}`}><strong>{members.find(m=>m.id===r.memberId)?.full_name || "Name not provided"}</strong><small>{r.memberEmail}</small></a></td><td>{r.quantity}</td><td>{r.received}</td><td>{r.paid}</td><td>{money((r.received-r.paid)*(r.base+r.commission))}</td><td>{r.submitted ? <>{r.method}<small>{r.reference}</small>{r.submissions?.map(s=><details className="submission-details" key={s.id}><summary>UPC {s.upc} · {s.quantity} units</summary><small>Payment name: {s.payment_name}<br />Destination: {s.destination}<br />{s.reference}{s.amazon_otp && <><br />Amazon delivery OTP: {s.amazon_otp}</>}</small></details>)}</> : "Awaiting details"}</td></tr>)}
        </tbody></table></div>
        <div className="management-actions"><button className="primary" onClick={()=>{setReservationSearch(selectedReservationDeal.title);setTab('Deliveries');setSelectedReservationDeal(null);}}>Manage deliveries</button><button className="primary" onClick={()=>{setReservationSearch(selectedReservationDeal.title);setTab('Payouts');setSelectedReservationDeal(null);}}>Manage payouts</button></div>
      </Modal>}
      {delivery && (
        <Modal title="Delivery details" close={() => setDelivery(null)}>
          <DeliveryForm key={editingSubmission?.id || "new"} reservation={delivery} submission={editingSubmission} deal={state.deals.find(d=>d.id===delivery.dealId)!} email={delivery.memberEmail || account?.email || "demo@example.test"} busy={busy} error={error} onSubmit={submitDelivery} />
        </Modal>
      )}
      {labelReservation && <Modal title="Request a shipping label" close={()=>setLabelReservation(null)}>
        <LabelRequestForm reservation={labelReservation} request={labelReservation.labelRequest || null} deal={state.deals.find(d=>d.id===labelReservation.dealId)!} email={labelReservation.memberEmail || account?.email || "demo@example.test"} busy={busy} error={error} onSubmit={submitLabelRequest} />
      </Modal>}
      {create && (
        <Modal title="Post a new deal" close={() => setCreate(false)}>
          <form onSubmit={createDeal}>
            <label>
              Product name
              <input
                name="title"
                placeholder="e.g. Meta Quest 3S 128GB"
                maxLength={120}
                required
              />
            </label>
            <div className="form-row">
              <label>
                Retailer
                <input name="retailer" maxLength={80} required />
              </label>
              <label>
                Category
                <select name="category">
                  <option>Laptops</option>
                  <option>Graphics cards</option>
                  <option>VR & gaming</option>
                  <option>Other</option>
                </select>
              </label>
            </div>
            <label>
              Product URL
              <input name="url" type="url" placeholder="https://" required />
            </label>
            <div className="form-row">
              <label>
                Base payout ($)
                <input
                  name="base"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                />
              </label>
              <label>
                Commission ($)
                <input
                  name="commission"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue="0"
                  required
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Total capacity
                <input
                  name="capacity"
                  type="number"
                  min="1"
                  step="1"
                  required
                />
              </label>
              <label>
                Reserve by
                <input name="deadline" type="date" min={today()} required />
              </label>
            </div>
            <label>
              Delivery instructions
              <textarea
                name="instructions"
                rows={3}
                required
                maxLength={2000}
                placeholder="Eligible models, warehouse / drop-off instructions…"
              />
            </label>
            <label className="checkbox-label"><input type="checkbox" name="labels_offered" checked={labelsOffered} onChange={e=>setLabelsOffered(e.target.checked)} />Prepaid shipping labels available</label>
            {labelsOffered && <label>Minimum units for a shipping label<input name="label_min_quantity" type="number" min={1} step={1} defaultValue={1} required /></label>}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button disabled={busy} className="primary full">
              Post deal <Plus size={16} />
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
