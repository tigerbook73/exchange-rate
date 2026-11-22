-- Additive: old deployments can continue reading/writing while this is applied.
-- This is a completed batch marker, not an acquired lock or expiring lease.
ALTER TABLE collection_state ADD COLUMN write_id TEXT;
