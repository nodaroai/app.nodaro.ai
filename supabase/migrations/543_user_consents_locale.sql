-- user_consents.locale — the interface language a marketing-email consent was
-- given in.
--
-- The row already says WHICH copy was agreed to (consent_version) and WHERE it
-- was answered (source_app). It did not say in what language the person was
-- looking at it. Every grant now writes it: the language of the LATEST consent,
-- so a later "yes" in another language replaces it, and NULL when the client did
-- not name one. A decline or a withdrawal writes it only when the client names
-- one, so opting out from an older client never erases the language of the grant
-- it ends. Rows from before this column stay NULL = not recorded; nothing is
-- backfilled.
--
-- The language also rides to the marketing contact list with the rest of the
-- row (ee/lib/consent-loops-sync.ts), so campaigns can be sent per language.
--
-- Numbered 543; 542 belongs to a change that has not landed yet.

ALTER TABLE public.user_consents ADD COLUMN IF NOT EXISTS locale text;

COMMENT ON COLUMN public.user_consents.locale IS
  'The interface language the consent was given in: a @nodaro/shared LocaleId such as en, ja or pt-BR. The language of the latest consent action; NULL = not recorded. consent_version still identifies the admin-configured copy; locale says which language the interface was in, not how that copy was worded in it.';
