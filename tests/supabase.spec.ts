import {test,expect} from '@playwright/test';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {readFileSync} from 'node:fs';
import {randomUUID,randomBytes} from 'node:crypto';

const local=JSON.parse(readFileSync('supabase/.temp/local-status.json','utf8'));
if(new URL(local.API_URL).hostname!=='127.0.0.1')throw new Error('Only local Supabase test data may be modified.');
const service=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const publicClient=()=>createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const password=randomBytes(24).toString('base64url');
const run=randomUUID().slice(0,8);
let admin:SupabaseClient,member:SupabaseClient,other:SupabaseClient,pending:SupabaseClient;
let memberId:string;
const emails={admin:`admin-${run}@example.test`,member:`member-${run}@example.test`,other:`other-${run}@example.test`,pending:`pending-${run}@example.test`};

async function user(email:string,role:'admin'|'member',active:boolean){
  const {data,error}=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{role:'admin',active:true}});
  expect(error).toBeNull();
  const id=data.user!.id;
  // Account metadata must never grant membership or admin privileges.
  const initial=await service.from('profiles').select('role,active').eq('id',id).single();
  expect(initial.data).toEqual({role:'member',active:false});
  const updated=await service.from('profiles').update({role,active}).eq('id',id);
  expect(updated.error).toBeNull();
  const client=publicClient();
  const login=await client.auth.signInWithPassword({email,password});
  expect(login.error).toBeNull();
  return{client,id};
}

async function deal(capacity=10){
  const id=randomUUID();
  const result=await admin.rpc('create_deal',{p_id:id,p_title:`Live test ${id.slice(0,6)}`,p_category:'Laptops',p_retailer:'Test retailer',p_url:'https://example.com/product',p_base:29999,p_commission:1501,p_capacity:capacity,p_deadline:'2099-12-31',p_instructions:'Test warehouse drop-off'});
  expect(result.error).toBeNull();return id;
}
async function reserve(client:SupabaseClient,dealId:string,quantity=1,id=randomUUID()){
  return client.rpc('reserve_deal',{p_deal_id:dealId,p_quantity:quantity,p_request_id:id});
}

test.beforeAll(async()=>{
  admin=(await user(emails.admin,'admin',true)).client;
  const m=await user(emails.member,'member',true);member=m.client;memberId=m.id;
  other=(await user(emails.other,'member',true)).client;
  pending=(await user(emails.pending,'member',false)).client;
});

test('authentication, RLS, and role changes are enforced by the database',async()=>{
  const id=await deal();
  expect((await publicClient().from('deals').select('*')).error).not.toBeNull();
  expect((await pending.from('deals').select('*')).data).toEqual([]);
  expect((await reserve(pending,id)).error).not.toBeNull();
  const created=await reserve(member,id);expect(created.error).toBeNull();
  const reservationId=created.data;
  expect((await other.from('reservations').select('*').eq('id',reservationId)).data).toEqual([]);
  expect((await member.from('reservations').update({base:1,received:1,paid:1}).eq('id',reservationId)).error).not.toBeNull();
  expect((await member.from('profiles').update({role:'admin',active:true}).eq('id',memberId)).error).not.toBeNull();
  expect((await member.rpc('record_units',{p_id:reservationId,p_kind:'received',p_units:1})).error).not.toBeNull();
  expect((await other.rpc('submit_delivery',{p_id:reservationId,p_method:'Local drop-off',p_reference:'Spoofed'})).error).not.toBeNull();
  expect((await member.rpc('set_member_active',{p_id:memberId,p_active:true})).error).not.toBeNull();
  expect((await member.from('deals').insert({id:randomUUID()})).error).not.toBeNull();
  expect((await member.from('audit_events').select('*')).data).toEqual([]);
});

test('simultaneous reservations cannot overbook, and request retries are idempotent',async()=>{
  const id=await deal(1);
  const [a,b]=await Promise.all([reserve(member,id),reserve(other,id)]);
  expect([a,b].filter(r=>!r.error)).toHaveLength(1);
  expect([a,b].filter(r=>r.error)).toHaveLength(1);
  const d=await member.from('deals').select('reserved').eq('id',id).single();expect(d.data?.reserved).toBe(1);
  const retryDeal=await deal(2),request=randomUUID();
  const retried=await Promise.all([reserve(member,retryDeal,1,request),reserve(member,retryDeal,1,request)]);
  expect(retried.every(r=>!r.error)).toBe(true);
  expect((await member.from('deals').select('reserved').eq('id',retryDeal).single()).data?.reserved).toBe(1);
  expect((await reserve(member,retryDeal,2,request)).error).not.toBeNull();
});

test('payout snapshots and partial receipt/payment limits survive direct API calls',async()=>{
  const id=await deal();
  const reserved=await reserve(member,id,2);expect(reserved.error).toBeNull();const r=reserved.data;
  expect((await service.from('deals').update({base:100,commission:0}).eq('id',id)).error).toBeNull();
  expect((await member.from('reservations').select('base,commission').eq('id',r).single()).data).toEqual({base:29999,commission:1501});
  expect((await admin.rpc('record_units',{p_id:r,p_kind:'paid',p_units:1})).error).not.toBeNull();
  expect((await admin.rpc('record_units',{p_id:r,p_kind:'received',p_units:3})).error).not.toBeNull();
  expect((await admin.rpc('record_units',{p_id:r,p_kind:'received',p_units:1})).error).toBeNull();
  expect((await admin.rpc('record_units',{p_id:r,p_kind:'paid',p_units:2})).error).not.toBeNull();
  expect((await admin.rpc('record_units',{p_id:r,p_kind:'paid',p_units:1})).error).toBeNull();
  expect((await admin.rpc('record_units',{p_id:r,p_kind:'received',p_units:0})).error).not.toBeNull();
  expect((await admin.rpc('record_units',{p_id:r,p_kind:'paid',p_units:0})).error).not.toBeNull();
  const events=await admin.from('audit_events').select('action,details').eq('subject_id',r).eq('action','paid');
  expect(events.data).toEqual([{action:'paid',details:{previous:0,total:1,amount_cents:31500}}]);
});

test('deactivated users lose access immediately, including existing sessions',async()=>{
  const m=await user(`deactivated-${run}@example.test`,'member',true);
  const id=await deal();expect((await reserve(m.client,id)).error).toBeNull();
  expect((await admin.rpc('set_member_active',{p_id:m.id,p_active:false})).error).toBeNull();
  expect((await m.client.from('reservations').select('*')).data).toEqual([]);
  expect((await reserve(m.client,id)).error).not.toBeNull();
});

test('pending members cannot enter the workspace through the browser',async({page})=>{
  await page.goto('/workspace');
  await page.getByLabel('Email',{exact:true}).fill(emails.pending);
  await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Awaiting group approval'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Switch to admin'})).toHaveCount(0);
});

test('invitation links let a new member set their password without granting membership',async({page})=>{
  const email=`invited-${run}@example.test`;
  const generated=await service.auth.admin.generateLink({type:'invite',email});
  expect(generated.error).toBeNull();
  const confirmed=await publicClient().auth.verifyOtp({type:'invite',token_hash:generated.data.properties!.hashed_token});
  expect(confirmed.error).toBeNull();
  const session=confirmed.data.session!;
  const hash=new URLSearchParams({access_token:session.access_token,refresh_token:session.refresh_token,token_type:'bearer',expires_in:'3600',type:'invite'});
  await page.goto('/#'+hash.toString());
  await expect(page.getByRole('heading',{name:'Set your password'})).toBeVisible();
  const newPassword=randomBytes(24).toString('base64url');
  await page.getByLabel('New password',{exact:true}).fill(newPassword);
  await page.getByRole('button',{name:'Save password',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Awaiting group approval'})).toBeVisible();
  expect((await publicClient().auth.signInWithPassword({email,password:newPassword})).error).toBeNull();
});

test('real browser login, reservation, delivery, and admin receipt/payment workflow',async({browser,page})=>{
  const id=await deal(4);
  const title=(await admin.from('deals').select('title').eq('id',id).single()).data!.title;
  await page.goto('/workspace');
  await page.getByLabel('Email',{exact:true}).fill(emails.member);
  await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Switch to admin'})).toHaveCount(0);
  await page.getByLabel('Search deals').fill(title);
  await page.getByRole('button',{name:'Reserve units'}).click();
  await page.getByLabel('Quantity',{exact:true}).fill('2');
  await page.getByRole('button',{name:'Confirm reservation'}).click();
  const row=page.locator('tbody tr').filter({hasText:title});
  await row.getByRole('button',{name:'Add delivery'}).click();
  await page.getByLabel('Delivery method').selectOption('Local drop-off');
  await page.getByLabel('Tracking number or drop-off reference').fill('Test warehouse');
  await page.getByRole('button',{name:'Save delivery details'}).click();
  await expect(row).toContainText('Test warehouse');
  await page.reload();
  await page.getByRole('button',{name:'My reservations',exact:true}).click();
  await expect(row).toContainText('2 units');

  const context=await browser.newContext(),adminPage=await context.newPage();
  await adminPage.goto('/workspace');
  await adminPage.getByLabel('Email',{exact:true}).fill(emails.admin);
  await adminPage.getByLabel('Password',{exact:true}).fill(password);
  await adminPage.getByRole('button',{name:'Sign in',exact:true}).click();
  await adminPage.getByRole('button',{name:'Deliveries',exact:true}).click();
  const adminRow=adminPage.locator('tbody tr').filter({hasText:title});
  await adminRow.getByLabel(`Total received units for ${title}`).fill('1');
  await adminRow.getByRole('button',{name:'Mark received'}).click();
  await expect(adminRow).toContainText('1 / 2');
  await adminPage.getByRole('button',{name:'Payouts',exact:true}).click();
  await adminRow.getByLabel(`Total paid units for ${title}`).fill('1');
  await adminRow.getByRole('button',{name:'Record paid'}).click();
  await expect(adminRow).toContainText('$315.00 paid');
  await adminPage.getByRole('button',{name:'Members',exact:true}).click();
  await expect(adminPage.locator('tbody tr').filter({hasText:emails.pending})).toContainText('Awaiting approval');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Welcome to your buying group'})).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await context.close();
});
