-- Tenancy and entity tables. Every table carries tenant_id and is protected by row-level security.
CREATE TABLE IF NOT EXISTS tenants (id text PRIMARY KEY, name text NOT NULL, kind text NOT NULL DEFAULT 'customer', created_at timestamptz NOT NULL DEFAULT now());
DO $$ BEGIN CREATE ROLE app_user NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['units','zones','doors','appointments','tasks','charges','exceptions','carriers','settings','outbox'] LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I (tenant_id text NOT NULL REFERENCES tenants(id), id text NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, id))', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant'', true))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP; END $$;
CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id), email text NOT NULL, name text NOT NULL, role text NOT NULL,
  password_hash text NOT NULL, carrier_id text, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, email));
ALTER TABLE users ENABLE ROW LEVEL SECURITY; ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON users;
CREATE POLICY tenant_isolation ON users USING (tenant_id = current_setting('app.tenant', true)) WITH CHECK (tenant_id = current_setting('app.tenant', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO app_user; GRANT SELECT ON tenants TO app_user;
