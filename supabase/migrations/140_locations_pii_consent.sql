-- 140_locations_pii_consent.sql
-- Phase 2 #7: track PII consent for location reference photos.
--
-- Reference photos may contain people's faces (interior shots with staff,
-- wide street scenes, mood-board imagery sourced from web). The studio's
-- reference-photos-section UI now requires the user to explicitly tick a
-- "I have rights and consent" checkbox before the first photo can be added.
-- That tick is recorded as a timestamp on the location row so we have an
-- audit trail per-location.
--
-- The column is nullable; existing rows have no consent record. The UI
-- treats NULL as "consent not yet given" and shows the checkbox; non-NULL
-- as "consent recorded on <date>" and lets the user add more photos freely.

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS pii_consent_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN locations.pii_consent_at IS
  'Timestamp when the user explicitly consented that uploaded reference photos do not include PII without rights/consent. NULL = consent not yet given for any reference photo on this location.';
