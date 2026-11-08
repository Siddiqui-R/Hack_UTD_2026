export default function handler(request,response){
 response.setHeader('Cache-Control','no-store');
 if(request.method!=='GET')return response.status(405).json({error:'GET required'});
 return response.status(200).json({pdfReady:!!process.env.PDF_RENDERER_URL,moduleConfigured:!!process.env.VITE_STDB_URI&&!!process.env.VITE_STDB_DB});
}
