-- Migration: kyc_document_ref_sha256
-- Updates the documentRef column on KycRecord to store a tamper-evident
-- reference in the format "<s3-object-key>:<sha256-hex>".
-- The column remains nullable (NULL until POST /kyc/confirm-upload succeeds).

-- Add a PostgreSQL comment so the intent is visible in pg_catalog queries and
-- introspection tools (e.g. psql \d+, pgAdmin, Prisma Studio tooltips).
COMMENT ON COLUMN "KycRecord"."documentRef"
    IS 'SHA-256 hex digest of the uploaded document prefixed with the S3 object key: "<s3-key>:<sha256-hex>". Null until upload is confirmed via POST /kyc/confirm-upload.';
