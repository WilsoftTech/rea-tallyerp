ALTER TABLE command_outcomes ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE security_audit(
  tenant_id text NOT NULL REFERENCES tenants(id), id text NOT NULL, actor_id text NOT NULL REFERENCES user_accounts(id),
  action text NOT NULL, reason text NOT NULL, details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id)
);
CREATE TRIGGER security_audit_immutable BEFORE UPDATE OR DELETE ON security_audit FOR EACH ROW EXECUTE FUNCTION immutable_row();
ALTER TABLE security_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON security_audit USING(tenant_id=current_setting('app.tenant',true)) WITH CHECK(tenant_id=current_setting('app.tenant',true));
ALTER TABLE company_access ADD CONSTRAINT company_access_book FOREIGN KEY(tenant_id,company_id) REFERENCES cloud_books(tenant_id,company_id);
