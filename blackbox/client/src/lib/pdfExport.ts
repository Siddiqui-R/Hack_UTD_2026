import type { RecordSnapshot } from './recordTypes';
export const PDF_ENDPOINT: string = import.meta.env.VITE_PDF_URL || '/api/pdf';
export const USE_PDF_PROXY = PDF_ENDPOINT === '/api/pdf';
function save(blob: Blob, filename: string) {
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function downloadSnapshot(snapshot: RecordSnapshot) { save(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}),`BLACKBOX-INC-${snapshot.incident.id}.json`); }
// Rabeet owns rendering. No database credential or session token is forwarded to the renderer.
export async function exportPdf(snapshot: RecordSnapshot, sessionToken?: string) {
  if(!PDF_ENDPOINT)throw new Error('PDF renderer is not configured');
  if(USE_PDF_PROXY && !sessionToken)throw new Error('Sign in to export a record');
  const response=await fetch(PDF_ENDPOINT,{method:'POST',headers:{'content-type':'application/json',...(USE_PDF_PROXY?{authorization:`Bearer ${sessionToken}`}:{})},body:JSON.stringify(USE_PDF_PROXY?{incidentId:snapshot.incident.id}:snapshot)});
  if(!response.ok || !response.headers.get('content-type')?.includes('application/pdf'))throw new Error('PDF renderer did not return a PDF');
  save(await response.blob(),`BLACKBOX-INC-${snapshot.incident.id}.pdf`);
}
