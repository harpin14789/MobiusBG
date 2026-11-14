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

async function user(email:string,role:'admin'|'member'|'super_admin',active:boolean){
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
  admin=(await user(emails.admin,'super_admin',true)).client;
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

test('email signup requires confirmation and administrator approval before group access',async({page,browser,request})=>{
  const mailbox=`signup-${run}`;
  const email=`${mailbox}@example.test`;
  await page.goto('/join');
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Check your email'})).toBeVisible();
  const unconfirmed=await publicClient().auth.signInWithPassword({email,password});
  expect(unconfirmed.error?.code).toBe('email_not_confirmed');
  const profile=await service.from('profiles').select('id,role,active').eq('email',email).single();
  expect(profile.error).toBeNull();
  expect(profile.data).toMatchObject({role:'member',active:false});

  // Inspect only the local test inbox. Exercise the actual confirmation email
  // rather than bypassing email verification through the administrative API.
  let messages:Array<{ID:string}>=[];
  await expect.poll(async()=>{
    const response=await request.get(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    expect(response.ok()).toBe(true);
    messages=(await response.json()).messages;return messages.length;
  }).toBeGreaterThan(0);
  const messageResponse=await request.get(`http://127.0.0.1:54324/api/v1/message/${messages[0].ID}`);
  expect(messageResponse.ok()).toBe(true);
  const message=await messageResponse.json();
  const body=message.HTML||message.Text;
  const link=body.match(/https?:\/\/[^"'<>\s]+\/auth\/v1\/verify\?[^"'<>\s]+/)?.[0]?.replaceAll('&amp;','&');
  expect(link).toBeTruthy();
  expect(new URL(link!).hostname).toBe('127.0.0.1');
  await page.goto(link!);
  await expect(page.getByRole('heading',{name:'Awaiting group approval'})).toBeVisible();
  await expect(page.getByLabel('Search deals')).toHaveCount(0);
  const account=publicClient();
  expect((await account.auth.signInWithPassword({email,password})).error).toBeNull();
  expect((await account.from('deals').select('*')).data).toEqual([]);
  expect((await account.rpc('set_member_active',{p_id:profile.data!.id,p_active:true})).error).not.toBeNull();

  const context=await browser.newContext(),adminPage=await context.newPage();
  try {
    await adminPage.goto('/workspace');
    await adminPage.getByLabel('Email',{exact:true}).fill(emails.admin);
    await adminPage.getByLabel('Password',{exact:true}).fill(password);
    await adminPage.getByRole('button',{name:'Sign in',exact:true}).click();
    await adminPage.getByRole('button',{name:'Members',exact:true}).click();
    const row=adminPage.locator('tbody tr').filter({hasText:email});
    await expect(row).toContainText('Awaiting approval');
    await row.getByRole('button',{name:'Approve membership',exact:true}).click();
    await expect(row).toContainText('Active');
    await page.getByRole('button',{name:'Check membership',exact:true}).click();
    await expect(page.getByLabel('Search deals')).toBeVisible();
    expect((await account.from('deals').select('id')).data!.length).toBeGreaterThan(0);
    await row.getByRole('button',{name:'Deactivate',exact:true}).click();
    await expect(row).toContainText('Awaiting approval');
    expect((await account.from('deals').select('*')).data).toEqual([]);
  } finally {await context.close();}
});

test('disabled signup shows an error instead of a false confirmation',async({page})=>{
  await page.route('**/auth/v1/signup**',route=>route.fulfill({
    status:422,contentType:'application/json',
    body:JSON.stringify({error_code:'signup_disabled',msg:'Signups not allowed for this instance'}),
  }));
  await page.goto('/join');
  await page.getByLabel('Email',{exact:true}).fill(`disabled-${run}@example.test`);
  await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page.locator('.auth-card [role=alert]')).toContainText('New accounts are not available yet');
  await expect(page.getByRole('heading',{name:'Check your email'})).toHaveCount(0);
});

test('Google sign-in starts from both auth screens and cancelled callbacks allow retry',async({page})=>{
  let attempts=0;
  await page.route('**/auth/v1/authorize?**',route=>{
    const url=new URL(route.request().url());
    expect(url.searchParams.get('provider')).toBe('google');
    expect(url.searchParams.get('redirect_to')).toBe('http://127.0.0.1:3101');
    attempts++;
    // Google credentials are not used in local tests. Simulate the provider's
    // cancellation redirect to verify the real browser/SDK callback handling.
    return route.fulfill({status:302,headers:{location:'http://127.0.0.1:3101/#error=access_denied&error_description=User+cancelled'}});
  });
  for (const path of ['/workspace','/join']) {
    await page.goto(path);
    await page.getByRole('button',{name:'Continue with Google',exact:true}).click();
    await expect(page).toHaveURL('http://127.0.0.1:3101/workspace');
    await expect(page.locator('.auth-card [role=alert]')).toContainText('Sign-in was cancelled or could not be completed');
    await expect(page.getByRole('button',{name:'Continue with Google',exact:true})).toBeEnabled();
    await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  }
  expect(attempts).toBe(2);
});

test('super admin can assign posting-only admins while database blocks all operational access',async({page,browser})=>{
  const email=`poster-${run}@example.test`;
  const poster=await user(email,'member',true);
  await page.goto('/workspace');
  await page.getByLabel('Email',{exact:true}).fill(emails.admin);
  await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:'Members',exact:true}).click();
  await expect(page.locator('tbody tr').filter({hasText:emails.admin}).getByText('Super admin (protected)',{exact:true})).toBeVisible();
  await page.getByLabel(`Role for ${email}`,{exact:true}).selectOption('admin');
  await expect.poll(async()=> (await service.from('profiles').select('role').eq('id',poster.id).single()).data?.role).toBe('admin');
  const context=await browser.newContext(),staff=await context.newPage();
  try {
    await staff.goto('/workspace');
    await staff.getByLabel('Email',{exact:true}).fill(email);
    await staff.getByLabel('Password',{exact:true}).fill(password);
    await staff.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(staff.getByRole('button',{name:'Post a deal',exact:true})).toBeVisible();
    for(const name of ['Members','Deliveries','Payouts','My reservations','Reserve units'])
      await expect(staff.getByRole('button',{name,exact:true})).toHaveCount(0);
    const args={p_id:randomUUID(),p_title:`Staff deal ${run}`,p_category:'Laptops',p_retailer:'Test',p_url:'https://example.com',p_base:100,p_commission:0,p_capacity:1,p_deadline:'2099-12-31',p_instructions:'Local test'};
    expect((await poster.client.rpc('create_deal',args)).error).toBeNull();
    expect((await poster.client.from('deals').select('id').eq('id',args.p_id)).data).toHaveLength(1);
    expect((await poster.client.from('reservations').select('*')).data).toEqual([]);
    expect((await poster.client.from('audit_events').select('*')).data).toEqual([]);
    expect((await poster.client.from('delivery_submissions').select('*')).data).toEqual([]);
    expect((await poster.client.from('label_requests').select('*')).data).toEqual([]);
    expect((await reserve(poster.client,args.p_id)).error).not.toBeNull();
    expect((await poster.client.rpc('record_units',{p_id:randomUUID(),p_kind:'paid',p_units:1})).error).not.toBeNull();
    expect((await poster.client.rpc('submit_delivery',{p_id:randomUUID(),p_method:'Local drop-off',p_reference:'forbidden'})).error).not.toBeNull();
    expect((await poster.client.rpc('set_member_active',{p_id:memberId,p_active:false})).error).not.toBeNull();
    expect((await poster.client.rpc('set_member_role',{p_id:poster.id,p_role:'super_admin'})).error).not.toBeNull();
    expect((await poster.client.from('profiles').update({role:'super_admin'}).eq('id',poster.id)).error).not.toBeNull();
    await page.getByLabel(`Role for ${email}`,{exact:true}).selectOption('member');
    await expect.poll(async()=> (await service.from('profiles').select('role').eq('id',poster.id).single()).data?.role).toBe('member');
    expect((await poster.client.rpc('create_deal',{...args,p_id:randomUUID()})).error).not.toBeNull();
    const own=(await admin.auth.getUser()).data.user!.id;
    expect((await admin.rpc('set_member_role',{p_id:own,p_role:'member'})).error).not.toBeNull();
    expect((await admin.rpc('set_member_active',{p_id:own,p_active:false})).error).not.toBeNull();
    expect((await admin.rpc('set_member_role',{p_id:poster.id,p_role:'super_admin'})).error).not.toBeNull();
  } finally {await context.close();}
});

test('approval alert queue requires email verification, protects leases, and skips approved accounts',async()=>{
  const created=await service.auth.admin.createUser({email:`alert-${run}@example.test`,password,email_confirm:false});
  expect(created.error).toBeNull();
  const id=created.data.user!.id;
  expect((await member.rpc('claim_approval_alerts')).error).not.toBeNull();
  expect((await publicClient().rpc('claim_approval_alerts')).error).not.toBeNull();
  let claimed=await service.rpc('claim_approval_alerts');
  expect(claimed.error).toBeNull();
  expect(claimed.data.some((r:{member_id:string})=>r.member_id===id)).toBe(false);
  expect((await service.auth.admin.updateUserById(id,{email_confirm:true})).error).toBeNull();
  claimed=await service.rpc('claim_approval_alerts');
  expect(claimed.error).toBeNull();
  const entry=claimed.data.find((r:{member_id:string})=>r.member_id===id);
  expect(entry).toBeTruthy();
  expect((await service.rpc('claim_approval_alerts')).data.some((r:{member_id:string})=>r.member_id===id)).toBe(false);
  const complete=(lease:string)=>service.rpc('complete_approval_alert',{p_member_id:id,p_lease_token:lease,p_sent:true,p_error:null});
  expect((await complete(randomUUID())).data).toBe(false);
  expect((await complete(entry.lease_token)).data).toBe(true);
  expect((await complete(entry.lease_token)).data).toBe(false);
  expect((await service.auth.admin.updateUserById(id,{user_metadata:{name:'Updated name'}})).error).toBeNull();
  expect((await service.rpc('claim_approval_alerts')).data.some((r:{member_id:string})=>r.member_id===id)).toBe(false);
  const approved=await user(`skip-alert-${run}@example.test`,'member',true);
  expect((await service.rpc('claim_approval_alerts')).data.some((r:{member_id:string})=>r.member_id===approved.id)).toBe(false);
});

test('item submissions capture payment and delivery fields, enforce quantity totals, and isolate private data',async()=>{
  const id=await deal(5);
  const reservation=(await reserve(member,id,2)).data;
  const fields={p_reservation_id:reservation,p_submission_id:null,p_payment_name:'Test payment name',p_upc:'195133197656',p_method:'Ship to warehouse',p_reference:'123456789012, 987654321098',p_quantity:1,p_destination:'4 Orchard View Dr',p_amazon_otp:'123456'};
  const saved=await member.rpc('save_delivery_submission',fields);
  expect(saved.error).toBeNull();
  const first=saved.data;
  const row=await member.from('delivery_submissions').select('*').eq('id',first).single();
  expect(row.data).toMatchObject({payment_name:fields.p_payment_name,upc:fields.p_upc,reference:fields.p_reference,quantity:1,destination:fields.p_destination,amazon_otp:'123456',email:emails.member});
  expect((await other.from('delivery_submissions').select('*').eq('id',first)).data).toEqual([]);
  expect((await other.rpc('save_delivery_submission',{...fields,p_upc:'195133197657'})).error).not.toBeNull();
  expect((await member.from('delivery_submissions').update({quantity:100}).eq('id',first)).error).not.toBeNull();
  expect((await member.rpc('save_delivery_submission',fields)).error).not.toBeNull();
  expect((await member.rpc('save_delivery_submission',{...fields,p_submission_id:first,p_payment_name:''})).error).not.toBeNull();
  const second=await member.rpc('save_delivery_submission',{...fields,p_upc:'195133197657'});
  expect(second.error).toBeNull();
  expect((await member.rpc('save_delivery_submission',{...fields,p_upc:'195133197658'})).error).not.toBeNull();
  expect((await member.rpc('save_delivery_submission',{...fields,p_submission_id:first,p_quantity:2})).error).not.toBeNull();
  expect((await admin.from('delivery_submissions').select('id').eq('reservation_id',reservation)).data).toHaveLength(2);
  const one=(await reserve(member,id,1)).data;
  const attempts=await Promise.all(['195133197659','195133197660'].map(upc=>member.rpc('save_delivery_submission',{...fields,p_reservation_id:one,p_upc:upc})));
  expect(attempts.filter(r=>!r.error)).toHaveLength(1);
  expect(attempts.filter(r=>r.error)).toHaveLength(1);
});

test('shipping labels enforce deal eligibility and box minimums and can be handled only by the super admin',async({page,browser})=>{
  const id=randomUUID();
  const created=await admin.rpc('create_deal_with_labels',{p_id:id,p_title:`Label eligible ${run}`,p_category:'Laptops',p_retailer:'Test',p_url:'https://example.com',p_base:100,p_commission:0,p_capacity:10,p_deadline:'2099-12-31',p_instructions:'Ship from home',p_label_min_quantity:3});
  expect(created.error).toBeNull();
  const reservation=(await reserve(member,id,4)).data;
  const fields={p_reservation_id:reservation,p_contact:'@testmember',p_origin_zip:'60601',p_box_quantities:[2,2],p_box_weights:[25,25]};
  expect((await member.rpc('save_label_request',{...fields,p_box_quantities:[2],p_box_weights:[25]})).error).not.toBeNull();
  expect((await member.rpc('save_label_request',{...fields,p_box_quantities:[3,3]})).error).not.toBeNull();
  expect((await member.rpc('save_label_request',{...fields,p_box_weights:[25]})).error).not.toBeNull();
  expect((await member.rpc('save_label_request',{...fields,p_box_weights:[-1,25]})).error).not.toBeNull();
  expect((await other.rpc('save_label_request',fields)).error).not.toBeNull();
  const noOffer=(await reserve(member,await deal(),3)).data;
  expect((await member.rpc('save_label_request',{...fields,p_reservation_id:noOffer})).error).not.toBeNull();
  await page.goto('/workspace');
  await page.getByLabel('Email',{exact:true}).fill(emails.member);
  await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  const row=page.locator('tbody tr').filter({hasText:`Label eligible ${run}`});
  await row.getByRole('button',{name:'Request shipping label',exact:true}).click();
  await page.getByLabel('WhatsApp phone number or Discord tag').fill('@testmember');
  await page.getByLabel('Shipping-from ZIP code').fill('60601');
  await page.getByLabel('Quantity breakdown by box').fill('2 / 2');
  await page.getByLabel('Box weights in pounds').fill('25 lb / 25 lb');
  await page.getByRole('button',{name:'Submit label request',exact:true}).click();
  await expect(row).toContainText('Label request: requested');
  const request=(await member.from('label_requests').select('*').eq('reservation_id',reservation).single()).data!;
  expect(request).toMatchObject({email:emails.member,contact:'@testmember',origin_zip:'60601',quantity:4,box_quantities:[2,2]});
  expect((await other.from('label_requests').select('*').eq('id',request.id)).data).toEqual([]);
  expect((await member.rpc('set_label_request_status',{p_id:request.id,p_status:'completed'})).error).not.toBeNull();
  const context=await browser.newContext(),owner=await context.newPage();
  try {
    await owner.goto('/workspace');
    await owner.getByLabel('Email',{exact:true}).fill(emails.admin);
    await owner.getByLabel('Password',{exact:true}).fill(password);
    await owner.getByRole('button',{name:'Sign in',exact:true}).click();
    await owner.getByRole('button',{name:'Label requests',exact:true}).click();
    const labelRow=owner.locator('tbody tr').filter({hasText:`Label eligible ${run}`});
    await expect(labelRow).toContainText('@testmember');
    await expect(labelRow).toContainText('60601');
    await labelRow.getByLabel(`Label status for ${emails.member}`).selectOption('in_progress');
    await expect.poll(async()=> (await member.from('label_requests').select('status').eq('id',request.id).single()).data?.status).toBe('in_progress');
    expect((await member.rpc('save_label_request',fields)).error).not.toBeNull();
  } finally {await context.close();}
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
  await page.getByLabel('Name on payment account').fill('Test Member');
  await page.getByLabel('Product UPC',{exact:true}).fill('195133197656');
  await page.getByLabel('Destination address',{exact:true}).selectOption('Blue Ocean Dropoff');
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
