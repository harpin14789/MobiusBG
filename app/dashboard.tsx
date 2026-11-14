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

type Tab =
  | "Overview"
  | "Deals"
  | "My reservations"
  | "Deliveries"
  | "Payouts"
  | "Members";
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
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
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
  const [tab, setTab] = useState<Tab>("Overview");
  const [demoAdmin, setAdmin] = useState(false);
  const admin = live ? account.role === "admin" : demoAdmin;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All deals");
  const [notice, setNotice] = useState("");
  const [reserveDeal, setReserveDeal] = useState<Deal | null>(null);
  const [delivery, setDelivery] = useState<Reservation | null>(null);
  const [create, setCreate] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState("");
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
    const saved = client
      ? await changeCloud(() =>
          rpc(client, "submit_delivery", {
            p_id: delivery?.id,
            p_method: method,
            p_reference: reference,
          }),
        )
      : update((s) => ({
          ...s,
          reservations: s.reservations.map((r) =>
            r.id === delivery?.id
              ? { ...r, method, reference, submitted: true }
              : r,
          ),
        }));
    if (saved) {
      setDelivery(null);
      setNotice("Delivery details submitted. Receipt confirmation is pending.");
    }
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
          {state.reservations.map((r) => {
            const deal = state.deals.find((d) => d.id === r.dealId)!;
            return (
              <tr key={r.id}>
                <td>
                  <strong>{deal.title}</strong>
                  <small>
                    {r.memberEmail && (
                      <>
                        {r.memberEmail}
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
                        setError("");
                      }}
                    >
                      {r.submitted ? "Edit delivery" : "Add delivery"}
                    </button>
                  )}
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
            ...nav,
            ...(live && admin
              ? [{ name: "Members" as const, icon: Users }]
              : []),
          ].map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={tab === name ? "nav-item active" : "nav-item"}
              onClick={() => {
                setTab(name);
                setError("");
              }}
            >
              <Icon size={19} />
              {name}
              {name === "Deals" && (
                <span className="nav-count">{openDeals.length}</span>
              )}
            </button>
          ))}
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
                  ? admin
                    ? "Administrator"
                    : "Member"
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
            {admin ? (
              <button
                className="primary"
                onClick={() => {
                  setCreate(true);
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
                          <button
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
                          </button>
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
                  <h2>Your reservations</h2>
                  <p>A clear picture of what’s in motion.</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => setTab("My reservations")}
                >
                  View reservations <ArrowRight size={16} />
                </button>
              </section>
              {reservations}
            </>
          ) : (
            tab !== "Deals" &&
            tab !== "Members" && (
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
                {reservations}
              </>
            )
          )}
          {tab === "Members" && admin && live && (
            <section className="members-section">
              <h2>Group members</h2>
              <p>
                Invite people from Supabase Authentication → Users, then
                activate their membership here. New accounts have no group
                access until approved.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.id}>
                        <td>{m.email}</td>
                        <td>{m.role}</td>
                        <td>{m.active ? "Active" : "Awaiting approval"}</td>
                        <td>
                          {m.role === "member" && (
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
                              {m.active ? "Deactivate" : "Activate"}
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
      {delivery && (
        <Modal title="Delivery details" close={() => setDelivery(null)}>
          <form onSubmit={submitDelivery}>
            <p className="form-help">
              {state.deals.find((d) => d.id === delivery.dealId)?.title} ·{" "}
              {delivery.quantity} units
            </p>
            <label>
              Delivery method
              <select
                name="method"
                defaultValue={delivery.method || "Ship to warehouse"}
              >
                <option>Ship to warehouse</option>
                <option>Local drop-off</option>
                <option>Admin-provided label</option>
              </select>
            </label>
            <label>
              Tracking number or drop-off reference
              <input
                name="reference"
                defaultValue={delivery.reference}
                placeholder="Tracking number or location and date"
                maxLength={300}
                required
              />
            </label>
            <p className="form-help">
              Request warehouse addresses and prepaid labels from the admin in
              WhatsApp. This demo records delivery details; it does not generate
              labels.
            </p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button disabled={busy} className="primary full">
              Save delivery details <Check size={16} />
            </button>
          </form>
        </Modal>
      )}
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
