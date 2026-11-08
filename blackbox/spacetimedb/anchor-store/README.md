# External checkpoint store

Deploy server.mjs separately from the database host/account, behind HTTPS, with a persistent volume.
It needs Node 22+ and no packages. Set distinct ANCHOR_WRITE_TOKEN and ANCHOR_READ_TOKEN as deployment secrets,
CHECKPOINT_FILE to the volume's JSONL file, and HOST/PORT for the deployment. No update/delete routes exist.
Back up the append-only file under separate operator credentials. Do not commit keys or checkpoint files.

Publish module environment ANCHOR_URL (base URL), ANCHOR_WRITE_TOKEN, ANCHOR_READ_TOKEN and
ANCHOR_INDEPENDENT=1 only after the store is genuinely independently deployed. Run owner-only start_anchoring
once per database; existing databases are preserved. It creates the 60-second scheduler and an immediate request.
Severity changes and destructive approvals also enqueue immediate checkpoints. No reducer performs HTTP.

A localhost deployment is useful for wiring but is always labelled LOCAL, never independently anchored.
Without configured deployment secrets the application remains explicitly UNANCHORED. verifyIntegrity fetches
external checkpoint history, not a trusted copy from the database; it compares every stored checkpoint.
writeAnchor infrastructure bookkeeping is not audited (avoids recursive checkpoint generation).

Rabeet: validate durability, credential separation, checkpoint immutability and full-history comparison.
This store protects against database-only rewrites; owning both environments remains outside that claim.
