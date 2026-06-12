-- workflows.version becomes a real monotonic change counter. The column has
-- existed since 001 (INTEGER NOT NULL DEFAULT 1) but was never written.
--
-- A BEFORE UPDATE trigger bumps it on every CONTENT change (nodes / edges /
-- settings / name), so EVERY writer participates — editor (Supabase JS),
-- REST PATCH, MCP update_workflow_json, manual psql. Optimistic concurrency
-- can then CAS on an integer ("expectedVersion") instead of updated_at
-- string equality, immune to timestamp precision and trigger races.
--
-- The ELSE branch force-restores OLD.version on non-content updates, so a
-- client can never tamper with the counter by writing `version` directly.

CREATE OR REPLACE FUNCTION public.bump_workflow_version()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.nodes IS DISTINCT FROM NEW.nodes
        OR OLD.edges IS DISTINCT FROM NEW.edges
        OR OLD.settings IS DISTINCT FROM NEW.settings
        OR OLD.name IS DISTINCT FROM NEW.name) THEN
        NEW.version = OLD.version + 1;
    ELSE
        NEW.version = OLD.version;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bump_workflow_version ON public.workflows;
CREATE TRIGGER bump_workflow_version BEFORE UPDATE ON public.workflows
    FOR EACH ROW EXECUTE FUNCTION public.bump_workflow_version();
