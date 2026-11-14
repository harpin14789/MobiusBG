import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from './handler.mjs';

const secret = 'local-test-worker-secret';
const alert = { member_id: '11111111-1111-4111-8111-111111111111', email: 'pending@example.test', lease_token: 'lease' };
function fixture({ alerts = [alert], mailError, completeError, claimError } = {}) {
  const sent = [], calls = [];
  const handler = createHandler({
    secret, sender: { address: 'sender@example.test' },
    recipient: 'owner@example.test', siteUrl: 'https://mobius.example.test',
    sendMail: async (mail) => { if (mailError) throw mailError; sent.push(mail); },
    client: { rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'claim_approval_alerts') return { data: alerts, error: claimError };
      return { data: !completeError, error: completeError };
    } },
  });
  const request = (body = {}, token = secret, method = 'POST') => handler(new Request('https://worker.example.test', {
    method, headers: { 'X-Mobius-Alert-Secret': token, 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  }));
  return { request, sent, calls };
}

test('unauthorized requests cannot query members or send email', async () => {
  const f = fixture();
  assert.equal((await f.request({}, 'wrong-secret')).status, 401);
  assert.equal((await f.request({}, '', 'GET')).status, 405);
  assert.deepEqual(f.calls, []); assert.deepEqual(f.sent, []);
});

test('verified pending member alerts use a fixed recipient and authenticated workspace link', async () => {
  const f = fixture();
  const result = await f.request({ to: 'attacker@example.test', email: 'spoof@example.test' });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { sent: 1, failed: 0 });
  assert.equal(f.sent[0].to, 'owner@example.test');
  assert.match(f.sent[0].text, /pending@example\.test/);
  assert.match(f.sent[0].text, /https:\/\/mobius\.example\.test\/workspace/);
  assert.ok(!f.sent[0].text.includes('spoof@example.test'));
  assert.deepEqual(f.calls[1].args, {
    p_member_id: alert.member_id, p_lease_token: alert.lease_token, p_sent: true, p_error: null,
  });
});

test('empty queues do not send repeat notifications', async () => {
  const f = fixture({ alerts: [] });
  assert.equal((await f.request()).status, 200);
  assert.deepEqual(f.sent, []);
});

test('delivery failure releases the lease for retry without storing SMTP details', async () => {
  const error = Object.assign(new Error('sensitive transport details'), { code: 'EAUTH' });
  const f = fixture({ mailError: error });
  const result = await f.request();
  assert.equal(result.status, 503);
  assert.equal(f.calls[1].args.p_sent, false);
  assert.equal(f.calls[1].args.p_error, 'EAUTH');
  assert.ok(!JSON.stringify(f.calls).includes('sensitive'));
});

test('database failures are not reported as successful delivery', async () => {
  const f = fixture({ completeError: { message: 'database failure' } });
  assert.equal((await f.request()).status, 503);
  const g = fixture({ claimError: { message: 'database failure' } });
  assert.equal((await g.request()).status, 503);
  assert.deepEqual(g.sent, []);
});

test('authenticated setup test sends only to the configured owner and does not touch queue', async () => {
  const f = fixture();
  assert.equal((await f.request({ action: 'test', to: 'attacker@example.test' })).status, 200);
  assert.equal(f.sent[0].to, 'owner@example.test');
  assert.deepEqual(f.calls, []);
});
