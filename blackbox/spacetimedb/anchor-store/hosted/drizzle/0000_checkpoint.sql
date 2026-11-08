CREATE TABLE checkpoint (
  database_id TEXT NOT NULL,
  seq TEXT NOT NULL,
  seq_key TEXT NOT NULL,
  head_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  external_ref TEXT NOT NULL,
  PRIMARY KEY(database_id, seq)
);
--> statement-breakpoint
CREATE INDEX checkpoint_order ON checkpoint(database_id, seq_key);
--> statement-breakpoint
CREATE TRIGGER checkpoint_no_update BEFORE UPDATE ON checkpoint BEGIN SELECT RAISE(ABORT, 'checkpoints are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER checkpoint_no_delete BEFORE DELETE ON checkpoint BEGIN SELECT RAISE(ABORT, 'checkpoints are immutable'); END;
