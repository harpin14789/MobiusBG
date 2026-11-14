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
  payment_methods: Record<string,Record<string,string>>;
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
  const [loading,setLoading] = useState(true);
  const [signedIn,setSignedIn] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const [revision,setRevision] = useState(0);
  const [enabled,setEnabled] = useState({bank:false,zelle:false,taekus:false});

  async function fetchProfile(c:SupabaseClient,target:string|null,reveal:boolean){
    const {data,error}=await c.rpc('get_member_profile',{p_member_id:target,p_reveal_payment:false});
    if(error)throw error;
    if(data.own_profile && data.role==='super_admin')return {...data,payment_methods:{}};
    const methods=await c.rpc('get_member_payment_methods',{p_member_id:target,p_reveal_payment:reveal});
    if(methods.error)throw methods.error;
    return {...data,payment_methods:methods.data || {}};
  }
  function applyProfile(data:MemberProfileData){
    setProfile(data);
    setEnabled({bank:!!data.payment_methods.bank,zelle:!!data.payment_methods.zelle,taekus:!!data.payment_methods.taekus});
  }

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
        const data=await fetchProfile(c,target,false);
        if(!cancelled)applyProfile(data);
      }catch(e){if(!cancelled)setError(e instanceof Error?e.message:"Could not load this profile.");}
      finally{if(!cancelled)setLoading(false);}
    }
    void connect();
    return()=>{cancelled=true;unsubscribe();};
  },[]);

  async function reload(reveal=false){
    if(!client||!profile)return;
    const data=await fetchProfile(client,profile.id,reveal);
    applyProfile(data);setRevision(n=>n+1);
  }

  async function revealBank(){
    if(busy)return;
    setBusy(true);setError("");
    try{await reload(!profile?.payment_methods.bank?.account_number);}
    catch{setError("Could not load payment details. Please try again.");}
    finally{setBusy(false);}
  }

  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!client||!profile?.own_profile||busy)return;
    const form=new FormData(event.currentTarget);
    const value=(key:string)=>String(form.get(key)||"").trim();
    const methods:Record<string,Record<string,string>>={};
    if(enabled.bank)methods.bank={account_holder:value('account_holder'),bank_name:value('bank_name'),account_type:value('account_type'),routing_number:value('routing_number'),account_number:value('account_number')};
    if(enabled.zelle)methods.zelle={name:value('zelle_name'),identifier:value('identifier')};
    if(enabled.taekus)methods.taekus={name:value('taekus_name'),code:value('code')};
    setBusy(true);setError("");setMessage("");
    try{
      const common={p_full_name:value('full_name'),p_phone:value('phone'),p_discord:value('discord')};
      const {error}=profile.role==='super_admin'
        ? await client.rpc('save_member_profile',{...common,p_payment_method:profile.payment_method,p_payment_details:profile.payment_details})
        : await client.rpc('save_member_payment_methods',{...common,p_methods:methods});
      if(error)throw error;
      await reload();
      setMessage(profile.role==='super_admin' ? "Profile saved." : "Profile saved. If your payment information changed, the super admin will receive an update notification.");
    }catch(e){setError(e instanceof Error?e.message:"Could not save your profile.");}
    finally{setBusy(false);}
  }

  const bank=profile?.payment_methods.bank || {};
  const zelle=profile?.payment_methods.zelle || {};
  const taekus=profile?.payment_methods.taekus || {};
  const storedBank=!!(bank.account_last4 || bank.account_number);
  return <main className={styles.shell}>
    <div className={styles.header}><Link href="/workspace">← Back to workspace</Link><Link href="/privacy">Privacy policy</Link></div>
    <article className={styles.card}>
      <p className={styles.eyebrow}>MOBIUS · ACCOUNT DETAILS</p>
      <h1>{profile?.own_profile ? "My profile" : profile ? profile.full_name || "Member profile" : "Member profile"}</h1>
      {loading ? <p role="status">Loading profile…</p> : !signedIn ? <p><Link href="/workspace">Sign in</Link> to view your profile.</p> : profile ? <>
        <p className={styles.description}>{profile.own_profile ? profile.role==='super_admin' ? "Keep your contact information up to date." : "Keep your contact and payout information up to date." : "Private member profile · Super-admin access"}</p>
        {!profile.own_profile ? <>
          <dl className={styles.details}><dt>Name</dt><dd>{profile.full_name||"Not provided"}</dd><dt>Email</dt><dd>{profile.email}</dd><dt>Phone / WhatsApp</dt><dd>{profile.phone||"Not provided"}</dd><dt>Discord</dt><dd>{profile.discord||"Not provided"}</dd><dt>Membership</dt><dd>{profile.active?"Active":"Awaiting approval"} · {profile.role.replace("_"," ")}</dd></dl>
          <h2>Payment methods</h2>{!Object.keys(profile.payment_methods).length && <p>Not provided</p>}
          {Object.entries(profile.payment_methods).map(([methodName,details])=><section key={methodName}><h3>{paymentNames[methodName as PaymentMethod]}</h3><dl className={styles.details}>{Object.entries(details).map(([key,value])=><div className={styles.detailPair} key={key}><dt>{fieldNames[key]||key}</dt><dd>{key==='account_last4'?`•••• ${value}`:value}</dd></div>)}</dl></section>)}
          {profile.payment_methods.bank && <button type="button" className="primary" disabled={busy} onClick={revealBank}>{bank.account_number?"Hide bank details":"Show bank details"}</button>}
        </> : <form key={revision} onSubmit={save} autoComplete="off">
          <label>Full name<input name="full_name" maxLength={120} defaultValue={profile.full_name} autoComplete="name" required /></label>
          <label>Email<input type="email" value={profile.email} readOnly /></label>
          <div className={styles.row}><label>Phone / WhatsApp<input name="phone" maxLength={40} defaultValue={profile.phone} autoComplete="tel" /></label><label>Discord tag<input name="discord" maxLength={100} defaultValue={profile.discord} /></label></div>
          {profile.role!=='super_admin' && <><h2>Payment information</h2><p className={styles.description}>Used to arrange payouts outside the app. Saving details does not initiate a payment.</p>
          <p className={styles.description}>Add any combination of these methods, one account per method. Uncheck a method and save to remove it.</p>
          <label className="checkbox-label"><input type="checkbox" checked={enabled.bank} onChange={e=>setEnabled(v=>({...v,bank:e.target.checked}))} />US bank transfer</label>
          {enabled.bank && <div key="bank">
            <label>Name on bank account<input name="account_holder" defaultValue={bank.account_holder || profile.full_name} maxLength={120} required /></label>
            <div className={styles.row}><label>Bank name<input name="bank_name" defaultValue={bank.bank_name} maxLength={120} required /></label><label>Account type<select name="account_type" defaultValue={bank.account_type || 'checking'}><option value="checking">Checking</option><option value="savings">Savings</option></select></label></div>
            {storedBank && <p className={styles.description}>Saved account ending in {(bank.account_last4 || bank.account_number?.slice(-4))}. Leave the number fields blank to keep them. <button type="button" className="text-button" onClick={revealBank} disabled={busy}>{bank.account_number?"Hide details":"Show saved details"}</button></p>}
            <div className={styles.row}><label>Routing number<input name="routing_number" inputMode="numeric" pattern="[0-9]{9}" maxLength={9} defaultValue={bank.routing_number} required={!storedBank} /></label><label>Account number<input name="account_number" inputMode="numeric" pattern="[0-9]{4,17}" maxLength={17} defaultValue={bank.account_number} required={!storedBank} /></label></div>
          </div>}
          <label className="checkbox-label"><input type="checkbox" checked={enabled.zelle} onChange={e=>setEnabled(v=>({...v,zelle:e.target.checked}))} />Zelle</label>
          {enabled.zelle && <div key="zelle"><label>Name registered with Zelle<input name="zelle_name" defaultValue={zelle.name || profile.full_name} maxLength={120} required /></label><label>Zelle email or phone<input name="identifier" defaultValue={zelle.identifier || ''} maxLength={254} required /></label></div>}
          <label className="checkbox-label"><input type="checkbox" checked={enabled.taekus} onChange={e=>setEnabled(v=>({...v,taekus:e.target.checked}))} />Taekus Pay</label>
          {enabled.taekus && <div key="taekus"><label>Exact name on Taekus<input name="taekus_name" defaultValue={taekus.name || ''} maxLength={120} required /></label><label>Taekus Pay alphanumeric code<input name="code" defaultValue={taekus.code || ''} pattern="[A-Za-z0-9]+" maxLength={128} autoComplete="off" spellCheck={false} required /></label></div>}</>}
          <button className="primary full" disabled={busy}>{busy?"Saving…":"Save profile"}</button>
        </form>}
        {profile.payment_updated_at && (!profile.own_profile || profile.role!=='super_admin') && <p className={styles.description}>Payment details last saved: {new Date(profile.payment_updated_at).toLocaleString()}</p>}
      </> : null}
      {error && <p role="alert" className="error">{error}</p>}
      {message && <p role="status" className={styles.success}>{message}</p>}
    </article>
  </main>;
}
