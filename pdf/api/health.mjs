// Liveness only: does not launch Chromium or accept snapshots. Use PDF_HEALTH_URL=<host>/api/health for demo:check.
export default function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  return res.status(200).send('BLACKBOX PDF renderer');
}
