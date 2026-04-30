-- Add archive support to issues (soft-delete for completed/closed issues).
-- archived_at IS NOT NULL means the issue is archived.
ALTER TABLE issue ADD COLUMN archived_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE issue ADD COLUMN archived_by UUID DEFAULT NULL REFERENCES "user"(id);
