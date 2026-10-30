CREATE TABLE vault (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  tenant TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  generation TEXT NOT NULL
) STRICT;
CREATE TABLE books (
  tenant TEXT NOT NULL,
  company TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  state TEXT NOT NULL CHECK(json_valid(state)),
  PRIMARY KEY(tenant,company),
  FOREIGN KEY(tenant) REFERENCES vault(tenant)
) STRICT;
CREATE TABLE periods (
  tenant TEXT NOT NULL, company TEXT NOT NULL, id TEXT NOT NULL,
  year_id TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','locked')),
  version INTEGER NOT NULL CHECK(version>0),
  PRIMARY KEY(tenant,company,id),
  FOREIGN KEY(tenant,company) REFERENCES books(tenant,company),
  CHECK(length(start)=10 AND length(end)=10 AND start<=end)
) STRICT;
CREATE TABLE ledgers (
  tenant TEXT NOT NULL, company TEXT NOT NULL, id TEXT NOT NULL,
  PRIMARY KEY(tenant,company,id),
  FOREIGN KEY(tenant,company) REFERENCES books(tenant,company)
) STRICT;
CREATE TABLE journals (
  tenant TEXT NOT NULL, company TEXT NOT NULL, id TEXT NOT NULL,
  period_id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
  finalized INTEGER NOT NULL DEFAULT 0 CHECK(finalized IN (0,1)),
  PRIMARY KEY(tenant,company,id),
  FOREIGN KEY(tenant,company,period_id) REFERENCES periods(tenant,company,id)
) STRICT;
CREATE TABLE lines (
  tenant TEXT NOT NULL, company TEXT NOT NULL, journal TEXT NOT NULL,
  position INTEGER NOT NULL, ledger TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('debit','credit')),
  amount INTEGER NOT NULL CHECK(amount>0),
  PRIMARY KEY(tenant,company,journal,position),
  FOREIGN KEY(tenant,company,journal) REFERENCES journals(tenant,company,id),
  FOREIGN KEY(tenant,company,ledger) REFERENCES ledgers(tenant,company,id)
) STRICT;
CREATE TRIGGER journal_immutable_update BEFORE UPDATE ON journals WHEN OLD.finalized=1
BEGIN SELECT RAISE(ABORT,'POSTED_JOURNAL_IMMUTABLE'); END;
CREATE TRIGGER journal_immutable_delete BEFORE DELETE ON journals
BEGIN SELECT RAISE(ABORT,'POSTED_JOURNAL_IMMUTABLE'); END;
CREATE TRIGGER line_immutable_insert BEFORE INSERT ON lines
WHEN (SELECT finalized FROM journals WHERE tenant=NEW.tenant AND company=NEW.company AND id=NEW.journal)=1
BEGIN SELECT RAISE(ABORT,'POSTED_JOURNAL_IMMUTABLE'); END;
CREATE TRIGGER line_immutable_update BEFORE UPDATE ON lines
BEGIN SELECT RAISE(ABORT,'POSTED_JOURNAL_IMMUTABLE'); END;
CREATE TRIGGER line_immutable_delete BEFORE DELETE ON lines
BEGIN SELECT RAISE(ABORT,'POSTED_JOURNAL_IMMUTABLE'); END;
CREATE TABLE receipts (
  tenant TEXT NOT NULL, company TEXT NOT NULL, command TEXT NOT NULL,
  body TEXT NOT NULL CHECK(json_valid(body)),
  PRIMARY KEY(tenant,company,command),
  FOREIGN KEY(tenant,company) REFERENCES books(tenant,company)
) STRICT;
CREATE TRIGGER receipt_immutable_update BEFORE UPDATE ON receipts
BEGIN SELECT RAISE(ABORT,'RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER receipt_immutable_delete BEFORE DELETE ON receipts
BEGIN SELECT RAISE(ABORT,'RECEIPT_IMMUTABLE'); END;
CREATE TABLE audit (
  tenant TEXT NOT NULL, company TEXT NOT NULL, sequence INTEGER NOT NULL,
  body TEXT NOT NULL CHECK(json_valid(body)),
  PRIMARY KEY(tenant,company,sequence),
  FOREIGN KEY(tenant,company) REFERENCES books(tenant,company)
) STRICT;
CREATE TRIGGER audit_immutable_update BEFORE UPDATE ON audit
BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
CREATE TRIGGER audit_immutable_delete BEFORE DELETE ON audit
BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
CREATE TABLE outbox (
  tenant TEXT NOT NULL, company TEXT NOT NULL, command TEXT NOT NULL,
  payload TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state='not-enrolled'),
  PRIMARY KEY(tenant,company,command),
  FOREIGN KEY(tenant,company,command) REFERENCES receipts(tenant,company,command)
) STRICT;
PRAGMA user_version=1;
