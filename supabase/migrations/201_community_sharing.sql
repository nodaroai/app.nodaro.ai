-- 201_community_sharing.sql
--
-- Admin-curated community sharing for characters/locations/objects.
-- Admins publish into community_listings (+ protected snapshot); any logged-in
-- user browses and clones. Snapshot-copy independence: assets are R2-copied at
***REDACTED-OSS-SCRUB***
--
-- License: Nodaro Enterprise (this schema backs ee/ code; see LICENSE.md).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS community_listings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type           TEXT NOT NULL CHECK (entity_type IN ('character','location','object')),
  source_id             UUID,
  creator_id            UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  creator_display_name  TEXT,
  slug                  TEXT NOT NULL UNIQUE,
  title                 TEXT NOT NULL,
  description           TEXT,
  category              TEXT,
  style                 TEXT,
  tags                  TEXT[] NOT NULL DEFAULT '{}',
  preview_media_url     TEXT,
  preview_images        JSONB NOT NULL DEFAULT '[]',
  clone_count           INT  NOT NULL DEFAULT 0,
  favorite_count        INT  NOT NULL DEFAULT 0,
  is_listed             BOOLEAN NOT NULL DEFAULT true,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  attestation_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  likeness_attestation_at TIMESTAMPTZ,
  published_bytes       BIGINT NOT NULL DEFAULT 0,
  r2_assets_purged_at   TIMESTAMPTZ,
  search_vector         TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce(immutable_array_to_string(tags, ' '), '')), 'C')
  ) STORED,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT community_listings_source_id_key UNIQUE (source_id),
  CONSTRAINT community_listings_likeness_chk CHECK (entity_type <> 'character' OR likeness_attestation_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_community_listings_browse
  ON community_listings (entity_type, is_listed, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_listings_tags ON community_listings USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_community_listings_search ON community_listings USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_community_listings_popular
  ON community_listings (clone_count DESC, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS community_listing_snapshots (
  listing_id UUID PRIMARY KEY REFERENCES community_listings(id) ON DELETE CASCADE,
  snapshot   JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS community_listing_favorites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES community_listings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_community_favorites_user ON community_listing_favorites (user_id);

CREATE TABLE IF NOT EXISTS community_listing_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID NOT NULL REFERENCES community_listings(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL CHECK (reason IN ('real_person_no_consent','inappropriate','ip_violation','other')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_community_reports_dedup
  ON community_listing_reports (listing_id, reporter_id) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS community_clones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    UUID NOT NULL REFERENCES community_listings(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL,
  new_entity_id UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_community_clones_user_listing ON community_clones (user_id, listing_id);
CREATE INDEX IF NOT EXISTS idx_community_clones_listing ON community_clones (listing_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE community_listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS community_listings_authed_read ON community_listings;
CREATE POLICY community_listings_authed_read ON community_listings
  FOR SELECT USING (is_active = true AND auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS community_listings_admin_all ON community_listings;
CREATE POLICY community_listings_admin_all ON community_listings
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE community_listing_snapshots ENABLE ROW LEVEL SECURITY;
-- No SELECT/ALL policy: deny-by-default. Service-role (publish/clone) bypasses RLS.

ALTER TABLE community_listing_favorites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS community_favorites_own ON community_listing_favorites;
CREATE POLICY community_favorites_own ON community_listing_favorites
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE community_listing_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS community_reports_insert ON community_listing_reports;
CREATE POLICY community_reports_insert ON community_listing_reports
  FOR INSERT WITH CHECK (reporter_id = auth.uid());
DROP POLICY IF EXISTS community_reports_admin_read ON community_listing_reports;
CREATE POLICY community_reports_admin_read ON community_listing_reports
  FOR SELECT USING (is_admin());

ALTER TABLE community_clones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS community_clones_own ON community_clones;
CREATE POLICY community_clones_own ON community_clones
  FOR SELECT USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION publish_community_listing(
  p_id                    UUID,
  p_source_id             UUID,
  p_entity_type           TEXT,
  p_creator_id            UUID,
  p_creator_display_name  TEXT,
  p_slug                  TEXT,
  p_title                 TEXT,
  p_description           TEXT,
  p_category              TEXT,
  p_style                 TEXT,
  p_tags                  TEXT[],
  p_preview_media_url     TEXT,
  p_preview_images        JSONB,
  p_likeness_attestation_at TIMESTAMPTZ,
  p_published_bytes       BIGINT,
  p_snapshot              JSONB
)
RETURNS TABLE(id UUID, slug TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id   UUID;
  v_slug TEXT;
BEGIN
  INSERT INTO community_listings (
    id, source_id, entity_type, creator_id, creator_display_name,
    slug, title, description, category, style, tags,
    preview_media_url, preview_images, likeness_attestation_at,
    published_bytes, is_listed, is_active, attestation_at, r2_assets_purged_at, updated_at
  ) VALUES (
    p_id, p_source_id, p_entity_type, p_creator_id, p_creator_display_name,
    p_slug, p_title, p_description, p_category, p_style, COALESCE(p_tags, '{}'),
    p_preview_media_url, COALESCE(p_preview_images, '[]'::jsonb), p_likeness_attestation_at,
    p_published_bytes, true, true, NOW(), NULL, NOW()
  )
  ON CONFLICT (source_id) DO UPDATE SET
    is_active            = true,
    is_listed            = true,
    creator_display_name = EXCLUDED.creator_display_name,
    slug                 = EXCLUDED.slug,
    title                = EXCLUDED.title,
    description          = EXCLUDED.description,
    category             = EXCLUDED.category,
    style                = EXCLUDED.style,
    tags                 = EXCLUDED.tags,
    preview_media_url    = EXCLUDED.preview_media_url,
    preview_images       = EXCLUDED.preview_images,
    likeness_attestation_at = COALESCE(EXCLUDED.likeness_attestation_at, community_listings.likeness_attestation_at),
    published_bytes      = EXCLUDED.published_bytes,
    r2_assets_purged_at  = NULL,
    updated_at           = NOW()
  WHERE community_listings.creator_id = p_creator_id
  RETURNING community_listings.id, community_listings.slug INTO v_id, v_slug;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'publish_community_listing: not owner of existing listing for source %', p_source_id
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO community_listing_snapshots (listing_id, snapshot)
  VALUES (v_id, p_snapshot)
  ON CONFLICT (listing_id) DO UPDATE SET snapshot = EXCLUDED.snapshot;

  RETURN QUERY SELECT v_id, v_slug;
END;
$$;

REVOKE ALL ON FUNCTION publish_community_listing(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT[],TEXT,JSONB,TIMESTAMPTZ,BIGINT,JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION record_clone(
  p_listing_id    UUID,
  p_user_id       UUID,
  p_entity_type   TEXT,
  p_new_entity_id UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  INSERT INTO community_clones (listing_id, user_id, entity_type, new_entity_id)
  VALUES (p_listing_id, p_user_id, p_entity_type, p_new_entity_id);

  UPDATE community_listings
     SET clone_count = clone_count + 1
   WHERE id = p_listing_id
  RETURNING clone_count INTO v_count;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION record_clone(UUID,UUID,TEXT,UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION update_community_favorite_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE community_listings SET favorite_count = favorite_count + 1 WHERE id = NEW.listing_id;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE community_listings SET favorite_count = GREATEST(0, favorite_count - 1) WHERE id = OLD.listing_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_community_favorite_count ON community_listing_favorites;
CREATE TRIGGER trg_community_favorite_count
  AFTER INSERT OR DELETE ON community_listing_favorites
  FOR EACH ROW EXECUTE FUNCTION update_community_favorite_count();
