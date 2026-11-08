// Render the existing RecordSnapshot v1 contract. All supplied strings are escaped as text.
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const decimal = value => typeof value === 'string' && /^\d{1,20}$/.test(value);
export const utc = value => {
  if (!decimal(value)) throw new Error('invalid snapshot timestamp');
  const date = new Date(Number(BigInt(value) / 1000n));
  if (!Number.isFinite(date.getTime())) throw new Error('invalid snapshot timestamp');
  return date.toISOString().replace('T',' ').replace('.000Z',' UTC');
};
export function validateSnapshot(s) {
  if (!s || s.schemaVersion !== 1 || !s.incident || !decimal(s.incident.id) || !s.incident.title ||
      !s.permissions || typeof s.permissions.canReadEvidence !== 'boolean' || typeof s.permissions.canReadScope !== 'boolean' ||
      !s.verification || typeof s.verification.ok !== 'boolean' || !s.auditHead || !decimal(s.auditHead.seq) || !hash(s.auditHead.hash)) throw new Error('RecordSnapshot v1 required');
  utc(s.generatedAt);
  for (const key of ['audit','tasks','evidence','conflicts','investigations','closures','scope']) {
    if (!Array.isArray(s[key]) || s[key].length > 10000 || s[key].some(r=>!r || typeof r!=='object' || Array.isArray(r))) throw new Error(`invalid ${key}`);
  }
  const c=s.anchoredCheckpoint;
  if (c !== null && (!c || !decimal(c.seq) || !hash(c.headHash) || !decimal(c.at) || BigInt(c.seq)>BigInt(s.auditHead.seq))) throw new Error('invalid anchored checkpoint');
  if (c) utc(c.at);
  if (c && c.seq === s.auditHead.seq && c.headHash !== s.auditHead.hash && (c.independentlyVerified || s.verification.anchorOk===true)) throw new Error('checkpoint contradicts current head');
  return s;
}

export function snapshotHtml(value) {
  const s=validateSnapshot(value),v=s.verification,c=s.anchoredCheckpoint;
  const independent=v.ok && v.anchorOk===true && v.anchorStatus==='verified' && c?.independentlyVerified===true;
  const status=!v.ok?'INTEGRITY BROKEN':v.anchorOk===false?'ANCHOR MISMATCH':independent?'INDEPENDENT CHECKPOINT VERIFIED':'NOT INDEPENDENTLY ANCHORED';
  const pair=(label,value)=>`<div class="pair"><span class="label">${escape(label)}</span><div>${escape(value)}</div></div>`;
  const text=value=>`<pre>${escape(value)}</pre>`;
  const section=(name,body)=>`<section><h2>${escape(name)}</h2>${body || '<p class="muted">None recorded.</p>'}</section>`;
  const item=(heading,body)=>`<article><h3>${escape(heading)}</h3>${body}</article>`;
  const checkpoint=c?`${pair('Checkpoint sequence',c.seq)}${pair('External head hash',c.headHash)}${pair('Checkpoint time',utc(c.at))}${pair('External reference',c.externalRef)}
    <p>${independent?'Independent verification covers history through checkpoint #'+escape(c.seq)+'.':'Independent verification is not confirmed for this checkpoint.'}
    ${BigInt(c.seq)<BigInt(s.auditHead.seq)?' The later database tail is not covered by this checkpoint.':''}</p>`:'<p>No external checkpoint was confirmed at snapshot time.</p>';
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'">
  <style>
  @page{size:A4;margin:18mm 17mm 20mm;@bottom-left{content:"BLACKBOX / INCIDENT RECORD";font:8pt Arial;color:#667085}@bottom-right{content:counter(page) " / " counter(pages);font:8pt Arial;color:#667085}}
  *{box-sizing:border-box}body{font:10pt/1.5 Arial,sans-serif;color:#182230;margin:0}header{border-top:6px solid #182230;padding-top:14px;margin-bottom:22px}.brand{font:bold 12pt Consolas,monospace;letter-spacing:3px}.kicker,.label{font:8pt Consolas,monospace;text-transform:uppercase;color:#475467}h1{font-size:25pt;line-height:1.15;margin:12px 0}h2{font-size:13pt;border-bottom:1px solid #98a2b3;padding-bottom:6px;margin:22px 0 12px;break-after:avoid}h3{font-size:10pt;margin:12px 0 5px;break-after:avoid}p{margin:6px 0 10px}section{margin-top:16px}.pair{margin:8px 0;break-inside:avoid}.pair div{overflow-wrap:anywhere;white-space:pre-wrap}.pair .label{display:block}pre{font:8.5pt/1.5 Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 14px}article{border-bottom:1px solid #e4e7ec;padding-bottom:8px}article p{overflow-wrap:anywhere}.status{border:1px solid #98a2b3;background:#f2f4f7;padding:12px;margin:16px 0}.status strong{font:11pt Consolas,monospace}.muted{color:#667085}.note{font-size:8pt;border-top:1px solid #d0d5dd;padding-top:12px;margin-top:22px}.hash{font:9pt Consolas,monospace;overflow-wrap:anywhere}
  </style></head><body><header><div class="brand">BLACKBOX</div><div class="kicker">Incident coordination record / snapshot v1</div><h1>${escape(s.incident.title)}</h1><p>Incident #${escape(s.incident.id)} | ${escape(s.incident.severity)} | ${escape(s.incident.status)}</p><p class="kicker">Snapshot: ${escape(utc(s.generatedAt))}</p></header>
  <div class="status"><strong>${escape(status)}</strong><p>${escape(v.anchorReason || v.reason)}</p>${!v.ok?`<p>First broken record: #${escape(v.brokenAt ?? 'unknown')}</p>`:''}</div>
  ${section('Incident',pair('Type',s.incident.type)+pair('Containment',s.incident.containment)+pair('Affected systems',s.incident.systemsAffected)+pair('Reported by',s.incident.reportedBy))}
  ${section('Integrity at snapshot time',pair('Global records checked',v.checked)+pair('Current database sequence',s.auditHead.seq)+pair('Current database head hash',s.auditHead.hash)+checkpoint)}
  ${section('Compromised-data scope',s.permissions.canReadScope?s.scope.map(r=>item(r.asset,`${pair('Data / state / confidence',`${r.dataType} / ${r.state} / ${r.confidence}`)}${pair('Records',r.records)}${text(r.note)}`)).join(''):'<p>Restricted for this reader.</p>')}
  ${section('Tasks',s.tasks.map(r=>item(`#${r.id} / ${r.assigneeRole}`,`<p>${escape(r.text)}</p><p class="kicker">Created by ${escape(r.createdBy)}</p>`)).join(''))}
  ${section('Evidence',s.permissions.canReadEvidence?s.evidence.map(r=>item(`Evidence #${r.id}`,text(r.text))).join(''):'<p>Restricted for this reader.</p>')}
  ${section('Conflicts',s.permissions.canReadEvidence?s.conflicts.map(r=>item(`Evidence #${r.evidenceIdA} / #${r.evidenceIdB}`,text(r.reason))).join(''):'<p>Restricted for this reader.</p>')}
  ${section('Investigations',s.permissions.canReadEvidence?s.investigations.map(r=>item(`Run #${r.id} / ${r.mode} / ${r.status}`,pair('Model',r.modelId)+pair('Latency (ms)',r.latencyMs)+pair('Previous conclusion',r.previousSummary)+pair('Conclusion',r.summary))).join(''):'<p>Restricted for this reader.</p>')}
  ${section('Closure provenance',s.closures.map(r=>item(`Request #${r.id} / ${r.status}`,pair('Reason',r.reason)+pair('Requester',r.requestedBy)+(r.approvals??[]).map(a=>pair('Reviewer',a.approver)).join(''))).join(''))}
  ${section('Incident audit timeline',s.audit.map(r=>item(`#${r.seq} / ${r.action}`,pair('Actor',r.actor)+pair('Event hash',r.eventHash)+text(s.permissions.canReadEvidence?r.payloadJson:'[restricted]'))).join(''))}
  <p class="note">Rendered from the supplied snapshot. Verification reflects the snapshot time. This PDF is not a signed attestation.</p></body></html>`;
}

function browserPath() {
  const candidates=[process.env.PDF_BROWSER_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  const found=candidates.find(p=>p && existsSync(p));
  if(!found)throw new Error('Set PDF_BROWSER_PATH to an installed Chrome/Chromium browser');
  return found;
}
export async function renderPdf(snapshot) {
  const html=snapshotHtml(snapshot);
  const dir=await mkdtemp(path.join(tmpdir(),'blackbox-pdf-'));
  if(path.dirname(dir)!==path.resolve(tmpdir()) || !path.basename(dir).startsWith('blackbox-pdf-')) throw new Error('invalid temporary output directory');
  try {
    const input=path.join(dir,'record.html'),output=path.join(dir,'record.pdf');
    await writeFile(input,html,{mode:0o600});
    await execute(browserPath(),['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',
      '--disable-extensions','--disable-background-networking','--disable-component-update','--disable-sync',
      `--user-data-dir=${path.join(dir,'profile')}`,'--no-pdf-header-footer',`--print-to-pdf=${output}`,pathToFileURL(input).href],
      {timeout:30000,windowsHide:true,maxBuffer:1024*1024});
    const pdf=await readFile(output);
    if(pdf.subarray(0,5).toString()!=='%PDF-')throw new Error('Browser did not produce a PDF');
    return pdf;
  } finally { await rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100}); }
}
