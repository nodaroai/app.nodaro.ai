-- 689_share_link_locale.sql
--
-- The interface language a share link was shared in. The creator's client may
-- send it when it turns the link on (`PUT /v1/shares { locale }`), and the
-- link's preview card (what a chat or a social network shows for the link) is
-- written in it: its description line and its language tags. Null: English.
--
-- The API stores a language id the platform names (`en`, `de`, `pt-BR`, `he`,
-- ...), never free text; the CHECK holds the shape only, so a new interface
-- language needs no migration.
--
-- Staging reaches the shared database before this does, so the API names the
-- column only once a probe has seen it.
--
-- Idempotent: CI re-applies the newest migration.

ALTER TABLE public.share_links ADD COLUMN IF NOT EXISTS locale text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'share_links_locale_shape'
       AND conrelid = 'public.share_links'::regclass
  ) THEN
    ALTER TABLE public.share_links
      ADD CONSTRAINT share_links_locale_shape CHECK (locale IS NULL OR locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$');
  END IF;
END $$;

COMMENT ON COLUMN public.share_links.locale IS
  'The interface language the link was shared in (e.g. en, de, pt-BR, he); its preview card is written in it. Null: English.';
