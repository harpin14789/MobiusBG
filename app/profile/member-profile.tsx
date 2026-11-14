"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "../../lib/supabase";
import styles from "./profile.module.css";

type PaymentMethod = "none" | "bank" | "zelle" | "taekus";
type MemberProfileData = {
  id: string; full_name: string; email: string; phone: string; discord: string;
  role: string; active: boolean; own_profile: boolean; payment_method: PaymentMethod;
  payment_details: Record<string,string>; payment_updated_at: string | null;
};
const paymentNames = { none: "Not set", bank: "US bank transfer", zelle: "Zelle", taekus: "Taekus Pay" };
const fieldNames: Record<string,string> = {
  account_holder: "Account holder", bank_name: "Bank name", account_type: "Account type",
  account_last4: "Account ending", account_number: "Account number", routing_number: "Routing number",
  name: "Name on payment platform", identifier: "Zelle email or phone", code: "Taekus Pay code",
};

export default function MemberProfile() {
  const [client,setClient] = useState<SupabaseClient | null>(null);
  const [profile,setProfile] = useState<MemberProfileData | null>(null);
  const [method,setMethod] = useState<PaymentMethod>("none");
  const [loading,setLoading] = useState(true);
  const [signedIn,setSignedIn] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const [revision,setRevision] = useState(0);

  useEffect(()=>{
    let cancelled=false;
    let unsubscribe=()=>{};
    async function connect(){
      try {
        const c=getSupabase();
        if(!c)throw Error("Account settings are unavailable. Please try again later.");
        setClient(c);
        const {data:{subscription}}=c.auth.onAuthStateChange((event)=>{
          if(event==='SIGNED_OUT' && !cancelled){setProfile(null);setSignedIn(false);setMessage("");}
        });
        unsubscribe=()=>subscription.unsubscribe();
        const session=await c.auth.getSession();
        if(session.error)throw session.error;
        if(cancelled)return;
        if(!session.data.session){setLoading(false);return;}
        setSignedIn(true);
        const target=new URLSearchParams(window.location.search).get('member');
        const {data,error}=await c.rpc('get_member_profile',{p_member_id:target,p_reveal_payment:false});
        if(error)throw error;
        if(!cancelled){setProfile(data);setMethod(data.payment_method);}
      }catch(e){if(!cancelled)setError(e instanceof Error?e.message:"Could not load this profile.");}
      finally{if(!cancelled)setLoading(false);}
    }
    void connect();
    return()=>{cancelled=true;unsubscribe();};
  },[]);

  async function reload(reveal=false){
    if(!client||!profile)return;
    const {data,error}=await client.rpc('get_member_profile',{p_member_id:profile.id,p_reveal_payment:reveal});
    if(error)throw error;
    setProfile(data);setMethod(data.payment_method);setRevision(n=>n+1);
  }

  async function revealBank(){
    if(busy)return;
    setBusy(true);setError("");
    try{await reload(!profile?.payment_details.account_number);}
    catch{setError("Could not load payment details. Please try again.");}
    finally{setBusy(false);}
  }

  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!client||!profile?.own_profile||busy)return;
    const form=new FormData(event.currentTarget);
    const value=(key:string)=>String(form.get(key)||"").trim();
    const details:Record<string,string>=method==='bank'?{
      account_holder:value('account_holder'),bank_name:value('bank_name'),account_type:value('account_type'),
      routing_number:value('routing_number'),account_number:value('account_number'),
    }:method==='zelle'?{name:value('payment_name'),identifier:value('identifier')}
      :method==='taekus'?{name:value('payment_name'),code:value('code')}:{};
    setBusy(true);setError("");setMessage("");
    try{
      const {error}=await client.rpc('save_member_profile',{
        p_full_name:value('full_name'),p_phone:value('phone'),p_discord:value('discord'),
        p_payment_method:method,p_payment_details:details,
      });
      if(error)throw error;
      await reload();
      setMessage("Profile saved. If your payment information changed, the super admin will receive an update notification.");
    }catch(e){setError(e instanceof Error?e.message:"Could not save your profile.");}
    finally{setBusy(false);}
  }

  const details=profile?.payment_details || {};
  const storedBank=profile?.payment_method==='bank' && !!(details.account_last4 || details.account_number);
  return <main className={styles.shell}>
    <div className={styles.header}><Link href="/workspace">← Back to workspace</Link><Link href="/privacy">Privacy policy</Link></div>
    <article className={styles.card}>
      <p className={styles.eyebrow}>MOBIUS · ACCOUNT DETAILS</p>
      <h1>{profile?.own_profile ? "My profile" : profile ? profile.full_name || "Member profile" : "Member profile"}</h1>
      {loading ? <p role="status">Loading profile…</p> : !signedIn ? <p><Link href="/workspace">Sign in</Link> to view your profile.</p> : profile ? <>
        <p className={styles.description}>{profile.own_profile ? "Keep your contact and payout information up to date." : "Private member profile · Super-admin access"}</p>
        {!profile.own_profile ? <>
          <dl className={styles.details}><dt>Name</dt><dd>{profile.full_name||"Not provided"}</dd><dt>Email</dt><dd>{profile.email}</dd><dt>Phone / WhatsApp</dt><dd>{profile.phone||"Not provided"}</dd><dt>Discord</dt><dd>{profile.discord||"Not provided"}</dd><dt>Membership</dt><dd>{profile.active?"Active":"Awaiting approval"} · {profile.role.replace("_"," ")}</dd><dt>Payment method</dt><dd>{paymentNames[profile.payment_method]}</dd>
          {Object.entries(details).map(([key,value])=><div className={styles.detailPair} key={key}><dt>{fieldNames[key]||key}</dt><dd>{key==='account_last4'?`•••• ${value}`:value}</dd></div>)}</dl>
          {profile.payment_method==='bank' && <button type="button" className="primary" disabled={busy} onClick={revealBank}>{details.account_number?"Hide bank details":"Show bank details"}</button>}
        </> : <form key={revision} onSubmit={save} autoComplete="off">
          <label>Full name<input name="full_name" maxLength={120} defaultValue={profile.full_name} autoComplete="name" required /></label>
          <label>Email<input type="email" value={profile.email} readOnly /></label>
          <div className={styles.row}><label>Phone / WhatsApp<input name="phone" maxLength={40} defaultValue={profile.phone} autoComplete="tel" /></label><label>Discord tag<input name="discord" maxLength={100} defaultValue={profile.discord} /></label></div>
          <h2>Payment information</h2><p className={styles.description}>Used to arrange payouts outside the app. Saving details does not initiate a payment.</p>
          <label>Payment method<select aria-label="Payment method" value={method} onChange={e=>setMethod(e.target.value as PaymentMethod)}><option value="none">Not set</option><option value="bank">US bank transfer</option><option value="zelle">Zelle</option><option value="taekus">Taekus Pay</option></select></label>
          {method==='bank' && <div key="bank">
            <label>Name on bank account<input name="account_holder" defaultValue={details.account_holder || profile.full_name} maxLength={120} required /></label>
            <div className={styles.row}><label>Bank name<input name="bank_name" defaultValue={details.bank_name} maxLength={120} required /></label><label>Account type<select name="account_type" defaultValue={details.account_type || 'checking'}><option value="checking">Checking</option><option value="savings">Savings</option></select></label></div>
            {storedBank && <p className={styles.description}>Saved account ending in {(details.account_last4 || details.account_number?.slice(-4))}. Leave the number fields blank to keep them. <button type="button" className="text-button" onClick={revealBank} disabled={busy}>{details.account_number?"Hide details":"Show saved details"}</button></p>}
            <div className={styles.row}><label>Routing number<input name="routing_number" inputMode="numeric" pattern="[0-9]{9}" maxLength={9} defaultValue={details.routing_number} required={!storedBank} /></label><label>Account number<input name="account_number" inputMode="numeric" pattern="[0-9]{4,17}" maxLength={17} defaultValue={details.account_number} required={!storedBank} /></label></div>
          </div>}
          {method==='zelle' && <div key="zelle"><label>Name registered with Zelle<input name="payment_name" defaultValue={profile.payment_method==='zelle'?details.name:profile.full_name} maxLength={120} required /></label><label>Zelle email or phone<input name="identifier" defaultValue={profile.payment_method==='zelle'?details.identifier:''} maxLength={254} required /></label></div>}
          {method==='taekus' && <div key="taekus"><label>Exact name on Taekus<input name="payment_name" defaultValue={profile.payment_method==='taekus'?details.name:''} maxLength={120} required /></label><label>Taekus Pay alphanumeric code<input name="code" defaultValue={profile.payment_method==='taekus'?details.code:''} pattern="[A-Za-z0-9]+" maxLength={128} autoComplete="off" spellCheck={false} required /></label></div>}
          <button className="primary full" disabled={busy}>{busy?"Saving…":"Save profile"}</button>
        </form>}
        {profile.payment_updated_at && <p className={styles.description}>Payment details last saved: {new Date(profile.payment_updated_at).toLocaleString()}</p>}
      </> : null}
      {error && <p role="alert" className="error">{error}</p>}
      {message && <p role="status" className={styles.success}>{message}</p>}
    </article>
  </main>;
}
