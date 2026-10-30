CREATE TABLE user_accounts(
  id text PRIMARY KEY, username text NOT NULL UNIQUE, password_hash text NOT NULL,
  disabled boolean NOT NULL DEFAULT false
);
CREATE TABLE tenants(id text PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200));
CREATE TABLE memberships(
  tenant_id text NOT NULL REFERENCES tenants(id), user_id text NOT NULL REFERENCES user_accounts(id),
  role text NOT NULL CHECK(role IN ('owner','accountant','entry','viewer')),
  version integer NOT NULL CHECK(version>0), disabled boolean NOT NULL DEFAULT false,
  PRIMARY KEY(tenant_id,user_id)
);
CREATE TABLE cloud_sessions(
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES user_accounts(id), expires_at timestamptz NOT NULL
);
CREATE TABLE company_access(
  tenant_id text NOT NULL, company_id text NOT NULL, user_id text NOT NULL,
  PRIMARY KEY(tenant_id,company_id,user_id),
  FOREIGN KEY(tenant_id,user_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE TABLE cloud_books(
  tenant_id text NOT NULL REFERENCES tenants(id), company_id text NOT NULL,
  revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740990),
  cursor bigint NOT NULL CHECK(cursor BETWEEN 0 AND 9007199254740990),
  epoch text NOT NULL, state text NOT NULL CHECK(jsonb_typeof(state::jsonb)='object'),
  PRIMARY KEY(tenant_id,company_id)
);
CREATE TABLE devices(
  tenant_id text NOT NULL, company_id text NOT NULL, id text NOT NULL,
  user_id text NOT NULL REFERENCES user_accounts(id), generation text NOT NULL,
  source_tenant text NOT NULL, source_company text NOT NULL,
  disabled boolean NOT NULL DEFAULT false,
  PRIMARY KEY(tenant_id,company_id,id),
  FOREIGN KEY(tenant_id,company_id) REFERENCES cloud_books(tenant_id,company_id)
);
CREATE TABLE enrollment_receipts(
  tenant_id text NOT NULL, id text NOT NULL, payload text NOT NULL, result jsonb NOT NULL,
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);
CREATE TABLE cloud_periods(
  tenant_id text NOT NULL, company_id text NOT NULL, id text NOT NULL, year_id text NOT NULL,
  start_date date NOT NULL, end_date date NOT NULL, status text NOT NULL CHECK(status IN ('open','locked')),
  version bigint NOT NULL CHECK(version>0), PRIMARY KEY(tenant_id,company_id,id),
  FOREIGN KEY(tenant_id,company_id) REFERENCES cloud_books(tenant_id,company_id),
  CHECK(end_date>=start_date)
);
CREATE TABLE cloud_ledgers(
  tenant_id text NOT NULL, company_id text NOT NULL, id text NOT NULL,
  PRIMARY KEY(tenant_id,company_id,id),
  FOREIGN KEY(tenant_id,company_id) REFERENCES cloud_books(tenant_id,company_id)
);
CREATE TABLE cloud_journals(
  tenant_id text NOT NULL, company_id text NOT NULL, id text NOT NULL, period_id text NOT NULL,
  business_date date NOT NULL, period_version bigint NOT NULL, body jsonb NOT NULL,
  finalized boolean NOT NULL DEFAULT false, PRIMARY KEY(tenant_id,company_id,id),
  FOREIGN KEY(tenant_id,company_id,period_id) REFERENCES cloud_periods(tenant_id,company_id,id)
);
CREATE TABLE cloud_lines(
  tenant_id text NOT NULL, company_id text NOT NULL, journal_id text NOT NULL, position integer NOT NULL,
  ledger_id text NOT NULL, side text NOT NULL CHECK(side IN ('debit','credit')), amount bigint NOT NULL CHECK(amount>0),
  PRIMARY KEY(tenant_id,company_id,journal_id,position),
  FOREIGN KEY(tenant_id,company_id,journal_id) REFERENCES cloud_journals(tenant_id,company_id,id),
  FOREIGN KEY(tenant_id,company_id,ledger_id) REFERENCES cloud_ledgers(tenant_id,company_id,id)
);
CREATE TABLE command_outcomes(
  tenant_id text NOT NULL, company_id text NOT NULL, command_id text NOT NULL,
  payload text, user_id text NOT NULL REFERENCES user_accounts(id), device_id text NOT NULL,
  status text NOT NULL CHECK(status IN ('accepted','rejected','conflict')),
  code text, message text NOT NULL, cursor bigint NOT NULL CHECK(cursor>0), result jsonb,
  PRIMARY KEY(tenant_id,company_id,command_id),
  FOREIGN KEY(tenant_id,company_id) REFERENCES cloud_books(tenant_id,company_id)
);
CREATE TABLE cloud_audit(
  tenant_id text NOT NULL, company_id text NOT NULL, sequence bigint NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(tenant_id,company_id,sequence),
  FOREIGN KEY(tenant_id,company_id) REFERENCES cloud_books(tenant_id,company_id)
);
CREATE TABLE cloud_changes(
  tenant_id text NOT NULL, company_id text NOT NULL, cursor bigint NOT NULL CHECK(cursor>0),
  command_id text NOT NULL, snapshot text NOT NULL, outcome jsonb NOT NULL,
  PRIMARY KEY(tenant_id,company_id,cursor),
  FOREIGN KEY(tenant_id,company_id,command_id) REFERENCES command_outcomes(tenant_id,company_id,command_id)
);

CREATE FUNCTION immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'IMMUTABLE_HISTORY' USING ERRCODE='23514'; END $$;
CREATE TRIGGER outcome_immutable BEFORE UPDATE OR DELETE ON command_outcomes FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON cloud_audit FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER change_immutable BEFORE UPDATE OR DELETE ON cloud_changes FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER enrollment_immutable BEFORE UPDATE OR DELETE ON enrollment_receipts FOR EACH ROW EXECUTE FUNCTION immutable_row();

CREATE FUNCTION guard_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p cloud_periods%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.finalized) THEN
    RAISE EXCEPTION 'POSTED_JOURNAL_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    SELECT * INTO STRICT p FROM cloud_periods WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND id=NEW.period_id FOR UPDATE;
    IF NEW.business_date<p.start_date OR NEW.business_date>p.end_date THEN
      RAISE EXCEPTION 'DATE_OUTSIDE_PERIOD' USING ERRCODE='23514';
    END IF;
    IF coalesce(current_setting('app.import',true),'')<>'on' AND (p.status<>'open' OR p.version<>NEW.period_version) THEN
      RAISE EXCEPTION 'PERIOD_LOCKED' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_guard BEFORE INSERT OR UPDATE OR DELETE ON cloud_journals FOR EACH ROW EXECUTE FUNCTION guard_journal();
CREATE FUNCTION guard_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE is_final boolean;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'POSTED_JOURNAL_IMMUTABLE' USING ERRCODE='23514'; END IF;
  SELECT finalized INTO STRICT is_final FROM cloud_journals WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND id=NEW.journal_id;
  IF is_final THEN RAISE EXCEPTION 'POSTED_JOURNAL_IMMUTABLE' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER line_guard BEFORE INSERT OR UPDATE OR DELETE ON cloud_lines FOR EACH ROW EXECUTE FUNCTION guard_line();
CREATE FUNCTION journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total numeric; n bigint; done boolean;
BEGIN
  SELECT finalized INTO done FROM cloud_journals WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND id=NEW.id;
  SELECT count(*),coalesce(sum(CASE side WHEN 'debit' THEN amount::numeric ELSE -amount::numeric END),0)
    INTO n,total FROM cloud_lines WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND journal_id=NEW.id;
  IF NOT done OR n<2 OR n>1000 OR total<>0 THEN RAISE EXCEPTION 'UNBALANCED_JOURNAL' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_balance AFTER INSERT OR UPDATE ON cloud_journals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_balanced();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['tenants','memberships','company_access','cloud_books','devices','enrollment_receipts','cloud_periods','cloud_ledgers','cloud_journals','cloud_lines','command_outcomes','cloud_audit','cloud_changes']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    IF table_name='tenants' THEN
      EXECUTE 'CREATE POLICY tenant_scope ON tenants USING(id=current_setting(''app.tenant'',true)) WITH CHECK(id=current_setting(''app.tenant'',true))';
    ELSE
      EXECUTE format('CREATE POLICY tenant_scope ON %I USING(tenant_id=current_setting(''app.tenant'',true)) WITH CHECK(tenant_id=current_setting(''app.tenant'',true))',table_name);
    END IF;
  END LOOP;
END $$;
CREATE POLICY own_memberships ON memberships FOR SELECT USING(user_id=current_setting('app.user',true));
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cloud_books','devices','cloud_periods','cloud_ledgers','cloud_journals','cloud_lines','command_outcomes','cloud_audit','cloud_changes']
  LOOP
    EXECUTE format('DROP POLICY tenant_scope ON %I',t);
    EXECUTE format('CREATE POLICY financial_scope ON %I USING(
      tenant_id=current_setting(''app.tenant'',true)
      AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=%I.tenant_id AND m.user_id=current_setting(''app.user'',true) AND NOT m.disabled
        AND (m.role=''owner'' OR EXISTS(SELECT 1 FROM company_access a WHERE a.tenant_id=%I.tenant_id AND a.company_id=%I.company_id AND a.user_id=m.user_id)))
      )',t,t,t,t);
  END LOOP;
END $$;
CREATE FUNCTION protect_period() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.start_date<>OLD.start_date OR NEW.end_date<>OLD.end_date OR NEW.year_id<>OLD.year_id)
    AND EXISTS(SELECT 1 FROM cloud_journals WHERE tenant_id=OLD.tenant_id AND company_id=OLD.company_id AND period_id=OLD.id)
    THEN RAISE EXCEPTION 'REFERENCED_PERIOD_IMMUTABLE' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER period_guard BEFORE UPDATE ON cloud_periods FOR EACH ROW EXECUTE FUNCTION protect_period();
