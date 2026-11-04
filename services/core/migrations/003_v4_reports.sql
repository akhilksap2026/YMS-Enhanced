-- Iteration 4: completed yard visits (gate-in -> gate-out) for turn-time / scorecard reports.
CREATE TABLE IF NOT EXISTS yard_visits (tenant_id text NOT NULL REFERENCES tenants(id), id text NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, id));
ALTER TABLE yard_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE yard_visits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON yard_visits;
CREATE POLICY tenant_isolation ON yard_visits USING (tenant_id = current_setting('app.tenant', true)) WITH CHECK (tenant_id = current_setting('app.tenant', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON yard_visits TO app_user;
