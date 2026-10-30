CREATE TABLE enrollment_cancellations(
  tenant_id text NOT NULL REFERENCES tenants(id), id text NOT NULL,
  actor_id text NOT NULL REFERENCES user_accounts(id), reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
  at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id)
);
ALTER TABLE enrollment_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment_cancellations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON enrollment_cancellations USING(tenant_id=current_setting('app.tenant',true));
CREATE TRIGGER cancellation_immutable BEFORE UPDATE OR DELETE ON enrollment_cancellations FOR EACH ROW EXECUTE FUNCTION immutable_row();
