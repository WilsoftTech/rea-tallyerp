ALTER TABLE command_outcomes ADD COLUMN replaces text;
ALTER TABLE command_outcomes ADD CONSTRAINT resolution_root FOREIGN KEY(tenant_id,company_id,replaces) REFERENCES command_outcomes(tenant_id,company_id,command_id);
CREATE UNIQUE INDEX one_accepted_replacement ON command_outcomes(tenant_id,company_id,replaces) WHERE replaces IS NOT NULL AND status='accepted';
