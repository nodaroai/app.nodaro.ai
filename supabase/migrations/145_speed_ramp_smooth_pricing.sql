-- 145_speed_ramp_smooth_pricing.sql
-- Seed the composite credit identifier for motion-compensated frame
-- interpolation in the Adjust Speed node (5 credits, vs 2 for fast mode).
-- Mirrors the kinetic-captions composite identifier pattern in migration 098.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES ('speed-ramp:smooth', 5, true, 'processing')
ON CONFLICT (model_identifier) DO NOTHING;
