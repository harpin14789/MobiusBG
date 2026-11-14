import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Deal, Reservation, State, DeliverySubmission, LabelRequest } from "./store";

export type Profile = {
  id: string;
  email: string;
  role: "member" | "admin" | "super_admin";
  active: boolean;
};
export const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!url || !key) return null;
  // Secret keys must never be configured as browser-facing credentials.
  if (!key.startsWith("sb_publishable_")) {
    try {
      const claims = JSON.parse(
        atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
      );
      if (claims.role !== "anon") throw new Error();
    } catch {
      throw new Error(
        "Configure a Supabase publishable or legacy anon key, never a secret or service-role key.",
      );
    }
  }
  if (!client) client = createClient(url, key);
  return client;
}

// Fetch all pages rather than silently truncating at the API's max_rows limit.
async function rows<T>(client: SupabaseClient, table: string): Promise<T[]> {
  const result: T[] = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .order("id")
      .range(start, start + 499);
    if (error) throw new Error(error.message);
    result.push(...(data as T[]));
    if (data.length < 500) return result;
  }
}

type DealRow = Deal & { created_at: string };
type ReservationRow = Omit<Reservation, "dealId" | "createdAt"> & {
  deal_id: string;
  member_id: string;
  created_at: string;
};
export async function loadWorkspace(
  client: SupabaseClient,
  admin: boolean,
): Promise<{ state: State; members: Profile[] }> {
  const [deals, reservations, members, submissions, labels] = await Promise.all([
    rows<DealRow>(client, "deals"),
    rows<ReservationRow>(client, "reservations"),
    admin ? rows<Profile>(client, "profiles") : Promise.resolve([]),
    rows<DeliverySubmission>(client, "delivery_submissions"),
    rows<LabelRequest>(client, "label_requests"),
  ]);
  return {
    state: {
      deals: deals.sort((a, b) => b.created_at.localeCompare(a.created_at)),
      reservations: reservations
        .map((r) => ({
          ...r,
          dealId: r.deal_id,
          createdAt: r.created_at,
          memberId: r.member_id,
          memberEmail: members.find((m) => m.id === r.member_id)?.email,
          submissions: submissions.filter((s) => s.reservation_id === r.id),
          labelRequest: labels.find((label) => label.reservation_id === r.id),
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    },
    members,
  };
}

export async function rpc(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
) {
  const { error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
}

export async function postDeal(client: SupabaseClient, d: Deal) {
  await rpc(client, "create_deal_with_labels", {
    p_id: d.id,
    p_title: d.title,
    p_category: d.category,
    p_retailer: d.retailer,
    p_url: d.url,
    p_base: d.base,
    p_commission: d.commission,
    p_capacity: d.capacity,
    p_deadline: d.deadline,
    p_instructions: d.instructions,
    p_label_min_quantity: d.label_min_quantity ?? null,
  });
}
