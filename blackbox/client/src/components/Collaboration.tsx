import { useEffect, useRef, useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { tables, reducers } from '../module_bindings';
import type { Incident, TeamMember } from '../module_bindings/types';
import { TeamPane } from './TeamPane';
import { useRun } from './Toast';
import { fmtUtc, tsToDate } from '../lib/format';
function Chat({incident,me,team}:{incident:Incident;me:TeamMember;team:readonly TeamMember[]}) {
 const [messages]=useTable(tables.messages.where(r=>r.incidentId.eq(incident.id)));
 const send=useReducer(reducers.sendMessage),run=useRun();
 const [text,setText]=useState('');const bottom=useRef<HTMLDivElement>(null);
 const rows=[...messages].sort((a,b)=>a.id<b.id?-1:1);
 // Block body on purpose: newer browsers return a Promise from scrollIntoView, and React
 // treats any returned value as a cleanup function ("destroy is not a function").
 useEffect(()=>{ bottom.current?.scrollIntoView({block:'nearest'}); },[rows.length]);
 const submit=async()=>{ if(!text.trim())return; if(await run(()=>send({incidentId:incident.id,text})))setText(''); };
 return <section className="flex min-h-0 flex-col bg-bg-1"><div className="label border-b border-line px-3 py-3">Incident chat · #{incident.id.toString()}</div><div className="min-h-0 flex-1 overflow-y-auto p-3">{!rows.length&&<p className="text-text-2">No messages in this incident.</p>}{rows.map(m=><div key={m.id.toString()} className="mb-3 border-b border-line pb-3"><div className="flex justify-between gap-2 font-mono text-[11px] text-text-1"><span>{team.find(u=>u.identity.isEqual(m.sender))?.displayName??m.sender.toHexString().slice(0,8)}</span><span className="text-text-2">{fmtUtc(tsToDate(m.createdAt)).slice(11)}</span></div><p className="mt-1 whitespace-pre-wrap break-words">{m.text}</p></div>)}<div ref={bottom}/></div>{me.role==='observer'?<p className="border-t border-line p-3 font-mono text-[11px] text-text-2">READ ONLY · OBSERVER</p>:<form className="flex flex-col gap-2 border-t border-line p-3" onSubmit={e=>{e.preventDefault();submit();}}><textarea aria-label="Chat message" className="field h-20 resize-y py-2" maxLength={4000} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();submit();}}} required placeholder="Message the response team · Enter to send, Shift+Enter for a new line"/><button className="btn" type="submit">Send message <span className="kbd">⏎</span></button></form>}</section>;
}
export function Collaboration({incident,me,team}:{incident?:Incident;me:TeamMember;team:readonly TeamMember[]}){
 const[tab,setTab]=useState<'team'|'chat'>('team');
 return <div className="flex min-h-0 flex-col border-l border-line bg-bg-1"><div className="flex gap-1 border-b border-line px-2 py-1">{(['team','chat']as const).map(t=><button key={t} className="btn border-0 bg-transparent font-mono text-[11px] uppercase" aria-pressed={tab===t} style={{color:tab===t?'var(--color-accent)':undefined}} onClick={()=>setTab(t)}>{t}</button>)}</div><div className="grid min-h-0 flex-1">{tab==='team'?<TeamPane team={team} me={me}/>:incident?<Chat key={incident.id.toString()} incident={incident} me={me} team={team}/>:<p className="p-4 text-text-2">Select an incident to read its chat.</p>}</div></div>;
}
