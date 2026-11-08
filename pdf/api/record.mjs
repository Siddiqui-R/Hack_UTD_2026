// Hosted renderer (Vercel): POST RecordSnapshot v1 -> application/pdf, for the client's /api/pdf adapter.
// Same HTML as the local renderer (render.mjs), printed by @sparticuz/chromium. Requires the shared Bearer
// credential PDF_RENDERER_TOKEN (32+ characters); without it every request is refused. Never logs snapshots.
import { timingSafeEqual } from 'node:crypto';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { validateSnapshot, snapshotHtml } from '../render.mjs';

const MAX_SNAPSHOT = 2 * 1024 * 1024;
const MAX_PDF = 4 * 1024 * 1024;
chromium.setGraphicsMode = false; // no WebGL needed; faster cold start

function authorized(header) {
  const token = process.env.PDF_RENDERER_TOKEN ?? '';
  if (token.length < 32) return false; // misconfigured deployment refuses everything
  const provided = Buffer.from(String(header ?? '')), expected = Buffer.from(`Bearer ${token}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function parse(body) {
  if (Buffer.isBuffer(body)) return JSON.parse(body.toString('utf8'));
  return typeof body === 'string' ? JSON.parse(body) : body;
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  if (req.method !== 'POST') { res.setHeader('allow', 'POST'); return res.status(405).send('Use POST'); }
  if (!authorized(req.headers.authorization)) return res.status(401).send('Renderer credential required');
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return res.status(415).send('JSON required');
  const length = Number(req.headers['content-length']);
  if (!Number.isSafeInteger(length) || length > MAX_SNAPSHOT) return res.status(413).send('Snapshot exceeds 2 MiB');

  let snapshot;
  try { snapshot = validateSnapshot(parse(req.body)); } catch { return res.status(422).send('Invalid RecordSnapshot v1'); }

  let browser;
  try {
    browser = await puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
      executablePath: await chromium.executablePath(),
      headless: 'shell',
    });
    const page = await browser.newPage();
    // The HTML is self-contained and carries a deny-all CSP; also refuse any request outright.
    await page.setRequestInterception(true);
    page.on('request', request => request.abort());
    await page.setContent(snapshotHtml(snapshot), { waitUntil: 'load', timeout: 8000 });
    const pdf = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true, timeout: 10000 }));
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('not a PDF');
    if (pdf.length > MAX_PDF) return res.status(502).send('PDF exceeds the adapter size limit');
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="BLACKBOX-INC-${snapshot.incident.id}.pdf"`);
    return res.status(200).send(pdf);
  } catch {
    return res.status(500).send('PDF rendering failed');
  } finally {
    await browser?.close().catch(() => {});
  }
}
