-- Migration: reprice the legend-sized structured LLM reads (decided 2026-10-20)
--
--   A production cost audit (2026-10-20) found the describe-to-picker analyzer
--   — one vision call whose system prompt is a rendered catalog legend, tens of
--   thousands of input tokens a read — priced flat at 10 on every tier rung
--   (migrations 224 / 288 / 358) with a derived premium-direct of 25 (490),
--   while the read's cost on the models above economy, and above all on
--   Anthropic's own API (Advanced mode, or any Claude effort — the former
--   default, Opus 5.5 at high), ran several times that. Two more routes make
--   the same read: POST /v1/llm/structured (the caller's own legend-sized
--   system prompt; migration 358 seeded it flat at 10 "at describe-to-picker
--   parity"), and POST /v1/text-to-picker, which billed describe-to-picker's
--   rungs although its default run analyzes EVERY picker's legend — several
--   times the tokens of one image read. The new rows give each rung headroom
--   over its worst-case cost:
--
--     describe-to-picker:economy         10 → 10   (unchanged; the Gemini 3.8 Flash default)
--     describe-to-picker                 10 → 18   (standard models on the aggregator)
--     describe-to-picker:premium         10 → 36   (premium models on the aggregator)
--     describe-to-picker:premium-direct  25 → 136  (a premium read on the vendor's own API)
--
--     llm-structured:economy             10 → 10   \  the same read, the caller's own
--     llm-structured                     10 → 18    | schema and system prompt:
--     llm-structured:premium             10 → 36    | describe-to-picker's rungs
--     llm-structured:premium-direct      25 → 136  /
--
--     text-to-picker:economy             NEW  16   \  its own feature id from now on
--     text-to-picker                     NEW  41    | (it reserved describe-to-picker's
--     text-to-picker:premium             NEW  81    | rows before); an all-picker read is
--     text-to-picker:premium-direct      NEW 200   /  several times an image read
--
--   The premium-direct rows are STATED, not CEIL(premium × 2.5) as migration
--   490 derived them: the multiplier understates a legend-sized direct read.
--   They are listed in LLM_PREMIUM_DIRECT_EXPLICIT (backend/src/ee/billing/
--   credits.ts), and STATIC_CREDIT_COSTS carries the same twelve rows.
--
--   Plain UPDATEs for the rows that exist (a reprice is a decision about the
--   price the deployment charges from now on); seeds for text-to-picker's new
--   ids, ON CONFLICT DO NOTHING like every seed.

UPDATE public.model_pricing SET credit_cost = 18 WHERE model_identifier = 'describe-to-picker';
UPDATE public.model_pricing SET credit_cost = 36 WHERE model_identifier = 'describe-to-picker:premium';
UPDATE public.model_pricing SET credit_cost = 136 WHERE model_identifier = 'describe-to-picker:premium-direct';

-- Economy stays at 10; stated so a row an older seed left elsewhere lands on the decided price.
UPDATE public.model_pricing SET credit_cost = 10 WHERE model_identifier = 'describe-to-picker:economy';

UPDATE public.model_pricing SET credit_cost = 18 WHERE model_identifier = 'llm-structured';
UPDATE public.model_pricing SET credit_cost = 36 WHERE model_identifier = 'llm-structured:premium';
UPDATE public.model_pricing SET credit_cost = 136 WHERE model_identifier = 'llm-structured:premium-direct';
UPDATE public.model_pricing SET credit_cost = 10 WHERE model_identifier = 'llm-structured:economy';

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('text-to-picker:economy',        16,  true, 'other'),
  ('text-to-picker',                41,  true, 'other'),
  ('text-to-picker:premium',        81,  true, 'other'),
  ('text-to-picker:premium-direct', 200, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;
