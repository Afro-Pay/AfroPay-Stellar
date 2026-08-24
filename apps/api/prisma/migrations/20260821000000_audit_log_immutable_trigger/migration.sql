-- AuditLog rows have been documented as "immutable by convention" since the
-- model was introduced, but nothing stopped a bug, a rogue script, or a
-- compromised credential from UPDATEing or DELETEing a row directly against
-- the database. This adds a database-level guarantee.
--
-- Exception: AdminComplianceService.eraseUser() (src/admin/admin.service.ts)
-- legitimately UPDATEs historical AuditLog rows to pseudonymise userId and
-- redact PII from metadata when a user exercises their right to erasure —
-- it never deletes rows, only scrubs identifying fields on them. That
-- transaction opts in explicitly via a session-local setting so the
-- exception is scoped to that one code path and does not weaken the
-- guarantee for anything else. DELETE is never permitted, including there.
CREATE OR REPLACE FUNCTION audit_log_prevent_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('audit_log.allow_anonymization', true) = 'on' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'AuditLog rows are immutable: % is not permitted on "AuditLog" (id=%)',
    TG_OP,
    COALESCE(OLD."id", 'unknown');
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_prevent_mutation();
