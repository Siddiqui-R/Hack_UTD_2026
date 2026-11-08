import type { RecordSnapshot } from './recordTypes';
export const PDF_ENDPOINT: string | undefined = import.meta.env.VITE_PDF_URL;
function save(blob: Blob, filename: string) {
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function downloadSnapshot(snapshot: RecordSnapshot) { save(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}),`BLACKBOX-INC-${snapshot.incident.id}.json`); }
// Rabeet owns rendering. No database credential or session token is forwarded to the renderer.
export async function exportPdf(snapshot: RecordSnapshot) {
  if(!PDF_ENDPOINT)throw new Error('PDF renderer is not configured');
  const response=await fetch(PDF_ENDPOINT,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(snapshot)});
  if(!response.ok || !response.headers.get('content-type')?.includes('application/pdf'))throw new Error('PDF renderer did not return a PDF');
  save(await response.blob(),`BLACKBOX-INC-${snapshot.incident.id}.pdf`);
}
