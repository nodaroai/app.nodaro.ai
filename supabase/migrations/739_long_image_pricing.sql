-- 739: Long Image, the node that makes one very tall picture from a prompt:
-- a webpage design, or a product detail page from one to three product
-- pictures. A run is charged the row of its mode, its page length (a product
-- page), its size and the pictures it sends: one row per webpage size and
-- picture count (0 to 2), and per product-page length, size and picture count
-- (1 to 3). The bare row is the default run (a webpage design at 2K with no
-- picture).
--
-- Values MUST match the unit's backend/src/nodes/long-image/price.ee.ts
-- (static-costs-match-migrations.test.ts holds the two together).
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.

BEGIN;

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('long-image', 269, true, 'image'),
  ('long-image:webpage:1K', 248, true, 'image'),
  ('long-image:webpage:1K:1ref', 249, true, 'image'),
  ('long-image:webpage:1K:2ref', 250, true, 'image'),
  ('long-image:webpage:2K', 269, true, 'image'),
  ('long-image:webpage:2K:1ref', 270, true, 'image'),
  ('long-image:webpage:2K:2ref', 272, true, 'image'),
  ('long-image:ecommerce:short:1K:1ref', 108, true, 'image'),
  ('long-image:ecommerce:short:1K:2ref', 109, true, 'image'),
  ('long-image:ecommerce:short:1K:3ref', 110, true, 'image'),
  ('long-image:ecommerce:short:2K:1ref', 129, true, 'image'),
  ('long-image:ecommerce:short:2K:2ref', 130, true, 'image'),
  ('long-image:ecommerce:short:2K:3ref', 132, true, 'image'),
  ('long-image:ecommerce:medium:1K:1ref', 213, true, 'image'),
  ('long-image:ecommerce:medium:1K:2ref', 214, true, 'image'),
  ('long-image:ecommerce:medium:1K:3ref', 215, true, 'image'),
  ('long-image:ecommerce:medium:2K:1ref', 249, true, 'image'),
  ('long-image:ecommerce:medium:2K:2ref', 250, true, 'image'),
  ('long-image:ecommerce:medium:2K:3ref', 252, true, 'image'),
  ('long-image:ecommerce:long:1K:1ref', 354, true, 'image'),
  ('long-image:ecommerce:long:1K:2ref', 355, true, 'image'),
  ('long-image:ecommerce:long:1K:3ref', 357, true, 'image'),
  ('long-image:ecommerce:long:2K:1ref', 389, true, 'image'),
  ('long-image:ecommerce:long:2K:2ref', 390, true, 'image'),
  ('long-image:ecommerce:long:2K:3ref', 392, true, 'image')
ON CONFLICT (model_identifier) DO NOTHING;

COMMIT;
