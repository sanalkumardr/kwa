-- =====================================================================
-- 005_auth_dpr_gps.sql — phone-OTP auth table + DPR GPS/chainage columns
-- Run after 004. Structural; safe for all environments.
-- =====================================================================

BEGIN;
SET search_path = kwa, public;

-- One-time passcodes for phone login. Codes are stored HASHED, never plain.
-- Not RLS-scoped (auth happens before any user context exists) — like
-- app_user/org_unit. Soft-delete envelope kept for consistency.
CREATE TABLE otp (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      text NOT NULL,
  code_hash  text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts   int NOT NULL DEFAULT 0,
  consumed   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted    boolean NOT NULL DEFAULT false,
  synced     boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_otp_phone ON otp(phone, created_at DESC);

CREATE TRIGGER trg_touch_otp BEFORE UPDATE ON otp
  FOR EACH ROW EXECUTE FUNCTION kwa.touch_updated_at();

-- DPR gains location: the raw GPS fix plus the chainage it maps to (computed
-- server-side on sync via kwa.locate_chainage) and the segment it fell on.
ALTER TABLE dpr ADD COLUMN gps        geometry(Point, 4326);
ALTER TABLE dpr ADD COLUMN chainage   numeric(10,3);
ALTER TABLE dpr ADD COLUMN segment_id uuid REFERENCES pipeline_segment(id);

COMMIT;
