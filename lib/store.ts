export type Deal = {
  id: string;
  title: string;
  category: string;
  retailer: string;
  url: string;
  base: number;
  commission: number;
  capacity: number;
  deadline: string;
  instructions: string;
  reserved?: number;
  label_min_quantity?: number | null;
  retailers?: { name: string; url: string }[];
  archived?: boolean;
  custom_terms?: boolean;
};
export type MemberDealTerms = { id:string; deal_id:string; member_id:string; base:number; commission:number };
export type LabelRequest = {
  id: string; reservation_id: string; member_id: string; email: string;
  contact: string; origin_zip: string; box_quantities: number[]; box_weights: number[];
  quantity: number; status: "requested" | "in_progress" | "completed";
};
export type DeliverySubmission = {
  id: string;
  reservation_id: string;
  member_id: string;
  email: string;
  payment_name: string;
  upc: string;
  method: string;
  reference: string;
  quantity: number;
  destination: string;
  amazon_otp: string;
};
export type Reservation = {
  id: string;
  dealId: string;
  quantity: number;
  base: number;
  commission: number;
  createdAt: string;
  method: string;
  reference: string;
  submitted: boolean;
  received: number;
  paid: number;
  memberId?: string;
  memberEmail?: string;
  submissions?: DeliverySubmission[];
  labelRequest?: LabelRequest;
};
export type State = { deals: Deal[]; reservations: Reservation[] };
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
export const remaining = (state: State, deal: Deal) =>
  deal.capacity -
  (deal.reserved ??
    state.reservations
      .filter((r) => r.dealId === deal.id)
      .reduce((n, r) => n + r.quantity, 0));
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const seed: State = {
  deals: [
    {
      id: "d1",
      title: "Meta Quest 3S",
      category: "VR & gaming",
      retailer: "Best Buy",
      url: "https://www.bestbuy.com/",
      base: 24000,
      commission: 1500,
      capacity: 30,
      deadline: "2026-12-01",
      instructions:
        "Reserve before purchasing. Keep the retail box sealed. Ship to the warehouse or arrange a local drop-off with the group.",
    },
    {
      id: "d2",
      title: "GeForce RTX 5070",
      category: "Graphics cards",
      retailer: "Micro Center",
      url: "https://www.microcenter.com/",
      base: 55000,
      commission: 2500,
      capacity: 12,
      deadline: "2026-12-01",
      instructions:
        "New, sealed units only. Submit your tracking number after shipping. Contact the group admin for a prepaid label.",
    },
    {
      id: "d3",
      title: "MacBook Air 13-inch",
      category: "Laptops",
      retailer: "Costco",
      url: "https://www.costco.com/",
      base: 75000,
      commission: 0,
      capacity: 20,
      deadline: "2026-12-01",
      instructions:
        "Base model, sealed retail packaging. Use the warehouse address shared in WhatsApp. Local drop-off is also available.",
    },
  ],
  reservations: [],
};
export const STORAGE_KEY = "mobius-demo-v1";
export function readState(): State {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return structuredClone(seed);
  const data = JSON.parse(raw) as State;
  if (!Array.isArray(data.deals) || !Array.isArray(data.reservations))
    throw new Error("Invalid saved demo data");
  return data;
}
