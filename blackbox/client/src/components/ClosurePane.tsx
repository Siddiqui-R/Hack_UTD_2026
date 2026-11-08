import { useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import type { Incident, TeamMember } from '../module_bindings/types';
import type { Identity } from 'spacetimedb';
import { useRun } from './Toast';
import { fmtUtc, tsToDate } from '../lib/format';
export function ClosurePane({incident,me,team}:{incident:Incident;me:TeamMember;team:readonly TeamMember[]}){
 const[requests]=useTable(tables.closureRequests.where(r=>r.incidentId.eq(incident.id))),[approvals]=useTable(tables.closureApprovals);
 const request=useReducer(reducers.requestClosure),approve=useReducer(reducers.approveClosure),cancel=useReducer(reducers.cancelClosure),run=useRun();
 const[reason,setReason]=useState(''),[open,setOpen]=useState(false);
 const latest=[...requests].sort((a,b)=>a.id>b.id?-1:1)[0];
 const pending=latest?.status==='pending';
 const votes=approvals.filter(a=>a.requestId===latest?.id);
 // Same rule approveClosure applies at execution: only live, unrevoked commanders/responders count,
 // and the requester counts only while still a live commander. `online` = session row present
 // (the server sweep removes expired sessions within 60 s).
 const live=(who:Identity,roles:readonly string[])=>{const m=team.find(u=>u.identity.isEqual(who));return !!m&&m.online&&!m.revoked&&roles.includes(m.role);};
 const counted=votes.filter(a=>live(a.approver,['commander','responder'])).length+(latest&&live(latest.requestedBy,['commander'])?1:0);
 const lapsed=votes.length-votes.filter(a=>live(a.approver,['commander','responder'])).length;
 const already=votes.some(a=>a.approver.isEqual(me.identity)),self=latest?.requestedBy.isEqual(me.identity);
 const stale=latest&&latest.expectedUpdatedAt.microsSinceUnixEpoch!==incident.updatedAt.microsSinceUnixEpoch;
 return <section className="flex flex-col gap-3 border-t border-line px-6 py-4"><div className="label">Incident closure · 2 independent human approvals</div>{incident.status==='closed'?<p className="font-mono text-[12px] text-text-1">INCIDENT CLOSED</p>:pending?<><p className="text-text-1">{latest.reason}</p><div className="font-mono text-[11px] text-text-2">REQUEST #{latest.id.toString()} · {counted}/2 VALID APPROVALS{lapsed?` · ${lapsed} LAPSED (SESSION ENDED)`:''}{counted<2?` · ${2-counted} MORE NEEDED`:''} · EXPIRES {fmtUtc(tsToDate(latest.expiresAt),false)}</div>{stale&&<p className="text-medium">Incident changed. Cancel this request and review the current incident before requesting again.</p>}<div className="flex gap-2">{me.role!=='observer'&&<button className="btn btn-danger" disabled={!!self||already||!!stale} onClick={()=>run(()=>approve({requestId:latest.id}))}>{self?'YOUR REQUEST COUNTS AS APPROVAL 1':already?'APPROVAL RECORDED':'APPROVE CLOSURE · APPROVAL 2'}</button>}{me.role==='commander'&&<button className="btn" onClick={()=>run(()=>cancel({requestId:latest.id}))}>Cancel request</button>}</div></>:me.role==='commander'?<><button className="btn btn-danger self-start" onClick={()=>setOpen(!open)}>REQUEST CLOSURE · 2 APPROVALS</button>{open&&<form className="flex flex-col gap-2" onSubmit={async e=>{e.preventDefault();if(await run(()=>request({incidentId:incident.id,reason,expectedUpdatedAt:incident.updatedAt}))){setOpen(false);setReason('');}}}><label className="label" htmlFor="closure-reason">Reason for closure</label><textarea id="closure-reason" className="field h-20 py-2" value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000} required/><p className="text-[12px] text-text-2">Your request counts as approval 1. One other signed-in commander or responder must approve this exact incident version. The agent cannot approve.</p><button className="btn btn-danger self-start" type="submit">SUBMIT CLOSURE REQUEST</button></form>}</>:<p className="text-text-2">A commander must request closure. Direct closure is blocked.</p>}</section>;
}
