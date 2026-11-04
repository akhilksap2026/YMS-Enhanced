-- Iteration 4: integration message log (outbound queue + inbound journal, DLQ), notification deliveries, audit, door visit history, sites.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['integration_msgs','deliveries','audit','door_visits','sites'] LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I (tenant_id text NOT NULL REFERENCES tenants(id), id text NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, id))', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant'', true))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP; END $$;
