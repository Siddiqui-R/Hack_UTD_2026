import { getCommander, signIn, newIdentity, enrollAgent, call, sql, auditRows, auditHash } from '../lib.mjs';
import { incident, rows, read, check, must, denied, ident } from '../slice-helpers.mjs';
export const slice = '12';
export const title = 'RECORD snapshot permissions and integrity';
export async function run() {
  const cmd=await getCommander(),obs=await signIn('observer'),home=await incident('record'),other=await incident('record-other');
  const ag=await enrollAgent(home.id);
  must(await call(cmd,'submit_evidence',[home.id,'private record evidence']));
  must(await call(cmd,'submit_evidence',[other.id,'foreign evidence secret']));
  must(await call(cmd,'add_scope_item',[home.id,'private asset','customer data','compromised','confirmed',42,'private note']));
  const before=(await auditRows()).length;
  const full=await read(cmd,'get_record',[home.id]),redacted=await read(obs,'get_record',[home.id]);
  check('R-snapshot', 'server snapshot includes incident, timestamp and real scope',full.schemaVersion===1 && full.incident.id===String(home.id) && /^\d+$/.test(full.generatedAt) && full.scope.length===1 && full.evidence.length===1);
  check('R-redaction', 'observer export omits evidence, scope, conflicts, investigations and audit payloads',
    !redacted.permissions.canReadEvidence && !redacted.permissions.canReadScope &&
    ['evidence','scope','conflicts','investigations'].every(k=>redacted[k].length===0) && redacted.audit.every(e=>e.payloadJson==='[restricted]'));
  check('R-cross', 'snapshot contains no foreign incident evidence',!JSON.stringify(full).includes('foreign evidence secret'));
  check('R-head', 'snapshot separates current head from absent external checkpoint',full.anchoredCheckpoint===null && full.verification.anchorStatus==='unconfigured' && full.verification.anchorOk!==true && full.auditHead.hash.length===64);
  check('R-read-only', 'snapshot and redaction reads write zero audit rows',(await auditRows()).length===before);
  const [event]=(await auditRows()).filter(e=>String(e.incident_id)===String(home.id));
  const inspected=await read(cmd,'inspect_audit_event',[event.seq]);
  check('R-inspect', 'module inspector agrees with independent event hash',inspected.storedHash===event.event_hash && inspected.recomputedHash===auditHash(event));
  for(const [label,who] of [['observer',obs],['agent',ag],['outsider',await newIdentity()]]) {
    await denied(`R-inspect-${label}`,`${label} cannot inspect audit payload`,who,'inspect_audit_event',[event.seq]);
  }
  await denied('R-agent', 'agent cannot export human RECORD snapshot',ag,'get_record',[home.id]);
  await denied('R-outsider', 'outsider cannot export RECORD snapshot',await newIdentity(),'get_record',[home.id]);
  const gone=await signIn('responder');must(await call(cmd,'revoke_session',[ident(gone)]));
  await denied('R-revoked', 'revoked human cannot export snapshot',gone,'get_record',[home.id]);
  const integrity=await read(cmd,'verify_integrity');
  check('R-integrity', 'unconfigured integrity API returns unanchored with clean chain',Array.isArray(integrity) && integrity[0][0]===true && integrity[1][1]==='unconfigured');
}
