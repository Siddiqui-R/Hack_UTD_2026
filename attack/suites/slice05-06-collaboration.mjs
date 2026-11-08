import { getCommander, signIn, newIdentity, enrollAgent, call, sql, ownerSql, tsArg } from '../lib.mjs';
import { incident, rows, read, check, must, denied, audited, ident } from '../slice-helpers.mjs';
export const slice = '5/6';
export const title = 'Chat privacy, scope and stale edits';

export async function run() {
  const cmd = await getCommander(), resp = await signIn('responder'), obs = await signIn('observer');
  const home = await incident('chat-scope'), other = await incident('chat-other'), ag = await enrollAgent(home.id);
  const outsider = await newIdentity(), expired = await signIn('responder'), revoked = await signIn('responder');
  must(ownerSql(`DELETE FROM session WHERE identity = ${expired.identity}`));
  must(await call(cmd, 'revoke_session', [ident(revoked)]));
  const blocked = [['observer',obs], ['outsider',outsider], ['expired',expired], ['revoked',revoked], ['agent',ag]];
  for (const [label,who] of blocked) {
    await denied(`M-${label}`, `${label} cannot send chat; zero audit rows`, who, 'send_message', [home.id, 'forbidden']);
    await denied(`S-${label}`, `${label} cannot add scope; zero audit rows`, who, 'add_scope_item', [home.id,'DB','PII','unknown','unconfirmed',1,'secret']);
  }
  await audited('M-send', 'message send audited exactly once', resp, 'send_message', [home.id,'home message']);
  await audited('M-other', 'second incident message audited once', cmd, 'send_message', [other.id,'other message']);
  const visible = await rows(`SELECT * FROM messages WHERE incident_id = ${home.id}`, obs);
  check('M-filter', 'selected incident query contains only its chat', visible.length === 1 && visible[0].text === 'home message');
  for (const [label,who] of [['outsider',outsider],['expired',expired],['revoked',revoked],['agent',ag]]) {
    check(`M-read-${label}`, `${label} sees no message rows`, (await rows('SELECT * FROM messages',who)).length === 0);
  }
  check('M-private', 'underlying message table private', !(await sql(obs,'SELECT * FROM message')).ok);
  await denied('M-empty', 'empty messages rejected', resp, 'send_message', [home.id,'']);
  await denied('M-long', 'oversized messages rejected', resp, 'send_message', [home.id,'x'.repeat(4001)]);
  await denied('M-missing', 'missing incident rejected', resp, 'send_message', [999999,'text']);
  await audited('S-add', 'scope insert audited once', resp, 'add_scope_item', [home.id,'customer-db','PII','exfiltrated','confirmed',40000,'scope secret']);
  const [scope] = await rows(`SELECT * FROM scope_items WHERE incident_id = ${home.id}`, resp);
  const args = [scope.id,'compromised','likely',30000,tsArg(scope.updated_at)];
  for (const [label,who] of blocked) await denied(`S-up-${label}`, `${label} cannot update scope`, who,'update_scope_item',args);
  for (const [label,who] of [['observer',obs],['outsider',outsider],['expired',expired],['revoked',revoked],['agent',ag]]) {
    check(`S-view-${label}`, `${label} sees no scope view rows`, (await rows('SELECT * FROM scope_items',who)).length === 0);
  }
  check('S-private', 'scope table private', !(await sql(obs,'SELECT * FROM scope_item')).ok);
  const got = await read(ag,'get_scope',[home.id]);
  check('S-real', 'agent reads real scope within enrolled incident', got.available && got.items.length === 1 && got.items[0].records === '40000');
  await denied('S-cross', 'agent cannot read another incident scope', ag,'get_scope',[other.id]);
  await audited('S-update', 'scope update audited once', resp,'update_scope_item',args);
  await denied('S-stale', 'stale scope update rejected atomically', resp,'update_scope_item',args);
  await denied('S-enum', 'invalid scope state rejected', resp,'add_scope_item',[home.id,'DB','PII','gone','confirmed',1,'']);
  for (const who of [expired,revoked]) await denied(`S-proc-${who===expired?'expired':'revoked'}`, 'dead session cannot read scope procedure',who,'get_scope',[home.id]);
}
