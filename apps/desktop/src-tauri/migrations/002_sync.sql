ALTER TABLE outbox RENAME TO outbox_v1;
CREATE TABLE outbox(
  tenant TEXT NOT NULL, company TEXT NOT NULL, command TEXT NOT NULL, payload TEXT NOT NULL, wire TEXT,
  state TEXT NOT NULL CHECK(state IN ('not-enrolled','pending','sending','accepted','rejected','conflict')),
  sequence INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, last_error TEXT, server_cursor INTEGER,
  resolution_root TEXT, local_only INTEGER NOT NULL DEFAULT 0 CHECK(local_only IN (0,1)),
  PRIMARY KEY(tenant,company,command), FOREIGN KEY(tenant,company,command) REFERENCES receipts(tenant,company,command)
) STRICT;
INSERT INTO outbox(tenant,company,command,payload,wire,state,sequence)
SELECT o.tenant,o.company,o.command,o.payload,json_extract(r.body,'$.command'),o.state,a.sequence
FROM outbox_v1 o JOIN receipts r USING(tenant,company,command)
JOIN audit a ON a.tenant=o.tenant AND a.company=o.company AND json_extract(a.body,'$.commandId')=o.command;
DROP TABLE outbox_v1;
CREATE INDEX outbox_delivery ON outbox(tenant,company,state,sequence);
CREATE TRIGGER outbox_payload_immutable BEFORE UPDATE OF tenant,company,command,payload,wire,sequence ON outbox
WHEN NEW.tenant<>OLD.tenant OR NEW.company<>OLD.company OR NEW.command<>OLD.command OR NEW.payload<>OLD.payload
  OR NEW.wire IS NOT OLD.wire OR NEW.sequence<>OLD.sequence
BEGIN SELECT RAISE(ABORT,'OUTBOX_PAYLOAD_IMMUTABLE'); END;
CREATE TABLE sync_profiles(
  tenant TEXT NOT NULL, company TEXT NOT NULL, endpoint TEXT NOT NULL, remote_tenant TEXT NOT NULL, remote_company TEXT NOT NULL,
  user_id TEXT NOT NULL, device_id TEXT NOT NULL, generation TEXT NOT NULL, epoch TEXT NOT NULL,
  public_key TEXT NOT NULL, offline_grant TEXT NOT NULL, cursor INTEGER NOT NULL CHECK(cursor>=0),
  canonical TEXT NOT NULL CHECK(json_valid(canonical)), paused TEXT, last_seen INTEGER NOT NULL, last_online INTEGER NOT NULL,
  lease_owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(tenant,company), FOREIGN KEY(tenant,company) REFERENCES books(tenant,company)
) STRICT;
CREATE TABLE cloud_intents(
  tenant TEXT NOT NULL, company TEXT NOT NULL, command TEXT NOT NULL, wire TEXT NOT NULL CHECK(json_valid(wire)),
  state TEXT NOT NULL CHECK(state IN ('pending','accepted','rejected','conflict')), result TEXT, last_error TEXT,
  PRIMARY KEY(tenant,company,command), FOREIGN KEY(tenant,company) REFERENCES books(tenant,company)
) STRICT;
CREATE TRIGGER intent_payload_immutable BEFORE UPDATE OF tenant,company,command,wire ON cloud_intents
BEGIN SELECT RAISE(ABORT,'OUTBOX_PAYLOAD_IMMUTABLE'); END;
CREATE TABLE sync_events(
  tenant TEXT NOT NULL, company TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL,
  action TEXT NOT NULL, detail TEXT NOT NULL, PRIMARY KEY(tenant,company,id),
  FOREIGN KEY(tenant,company) REFERENCES books(tenant,company)
) STRICT;
CREATE TRIGGER sync_event_update BEFORE UPDATE ON sync_events BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
CREATE TRIGGER sync_event_delete BEFORE DELETE ON sync_events BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
CREATE TABLE resolutions(
  tenant TEXT NOT NULL, company TEXT NOT NULL, root TEXT NOT NULL, original_command TEXT NOT NULL,
  reversal_command TEXT NOT NULL, reason TEXT NOT NULL, replacement_command TEXT,
  PRIMARY KEY(tenant,company,original_command),
  FOREIGN KEY(tenant,company,original_command) REFERENCES outbox(tenant,company,command),
  FOREIGN KEY(tenant,company,reversal_command) REFERENCES outbox(tenant,company,command)
) STRICT;
PRAGMA user_version=2;
CREATE TABLE enrollment_intents(
  tenant TEXT NOT NULL, company TEXT NOT NULL, endpoint TEXT NOT NULL, remote_tenant TEXT NOT NULL,
  enrollment_id TEXT NOT NULL, device_id TEXT NOT NULL, generation TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)), state TEXT NOT NULL CHECK(state IN ('pending','accepted')),
  PRIMARY KEY(tenant,company), FOREIGN KEY(tenant,company) REFERENCES books(tenant,company)
) STRICT;
CREATE TABLE join_intents(
  tenant TEXT NOT NULL, endpoint TEXT NOT NULL, remote_tenant TEXT NOT NULL, remote_company TEXT NOT NULL,
  user_id TEXT NOT NULL, local_company TEXT NOT NULL, device_id TEXT NOT NULL, generation TEXT NOT NULL,
  PRIMARY KEY(tenant,endpoint,remote_tenant,remote_company,user_id)
) STRICT;
