-- Seedance 2.5 at 1080p and GPT Image 2 at 2K / 4K move to these KIE rates.
--
-- Seedance 2.5 at 1080p, one row per second across 4-30s, the same conversion
-- as the rest of its ladder (migrations 304 and 324):
--   credits = ceil(KIE_rate x duration / 4) x 10
-- KIE rates: 158 cr/s no-video-ref / 95 cr/s with video ref, the rates the
-- finalize rows (`seedance-2-5-hd`, migration 504) already hold. 480p, 720p
-- and the finalize rows do not move.
--
-- GPT Image 2, text-to-image and image-to-image, KIE 6 / 10 / 16 cr at
-- 1K / 2K / 4K: 15 / 25 / 40, the ladder GPT Image 2.5 holds on the same KIE
-- rates (migration 405). The 1K rows already hold 15, and GPT Image 2.5 does
-- not move.
--
-- A `model_pricing` row wins over STATIC_CREDIT_COSTS, so the rows move with
-- the static table, whose values these MUST match
-- (static-costs-match-migrations.test.ts). Each statement names one row and
-- moves it only from the price it held before: a row an administrator retuned
-- stays as it is, a row a deployment does not have stays missing, and a second
-- run changes nothing. Only `credit_cost` is set, so `is_enabled`,
-- `tier_restriction` and `category` stay. Proven on a database by
-- supabase/tests/seedance-1080p-gpt-image-2-prices.behavior.sql.

-- Seedance 2.5, 1080p no video ref
UPDATE public.model_pricing SET credit_cost = 1580 WHERE model_identifier = 'seedance-2-5:4s:1080p' AND credit_cost = 1140;
UPDATE public.model_pricing SET credit_cost = 1980 WHERE model_identifier = 'seedance-2-5:5s:1080p' AND credit_cost = 1430;
UPDATE public.model_pricing SET credit_cost = 2370 WHERE model_identifier = 'seedance-2-5:6s:1080p' AND credit_cost = 1710;
UPDATE public.model_pricing SET credit_cost = 2770 WHERE model_identifier = 'seedance-2-5:7s:1080p' AND credit_cost = 2000;
UPDATE public.model_pricing SET credit_cost = 3160 WHERE model_identifier = 'seedance-2-5:8s:1080p' AND credit_cost = 2280;
UPDATE public.model_pricing SET credit_cost = 3560 WHERE model_identifier = 'seedance-2-5:9s:1080p' AND credit_cost = 2570;
UPDATE public.model_pricing SET credit_cost = 3950 WHERE model_identifier = 'seedance-2-5:10s:1080p' AND credit_cost = 2850;
UPDATE public.model_pricing SET credit_cost = 4350 WHERE model_identifier = 'seedance-2-5:11s:1080p' AND credit_cost = 3140;
UPDATE public.model_pricing SET credit_cost = 4740 WHERE model_identifier = 'seedance-2-5:12s:1080p' AND credit_cost = 3420;
UPDATE public.model_pricing SET credit_cost = 5140 WHERE model_identifier = 'seedance-2-5:13s:1080p' AND credit_cost = 3710;
UPDATE public.model_pricing SET credit_cost = 5530 WHERE model_identifier = 'seedance-2-5:14s:1080p' AND credit_cost = 3990;
UPDATE public.model_pricing SET credit_cost = 5930 WHERE model_identifier = 'seedance-2-5:15s:1080p' AND credit_cost = 4280;
UPDATE public.model_pricing SET credit_cost = 6320 WHERE model_identifier = 'seedance-2-5:16s:1080p' AND credit_cost = 4560;
UPDATE public.model_pricing SET credit_cost = 6720 WHERE model_identifier = 'seedance-2-5:17s:1080p' AND credit_cost = 4850;
UPDATE public.model_pricing SET credit_cost = 7110 WHERE model_identifier = 'seedance-2-5:18s:1080p' AND credit_cost = 5130;
UPDATE public.model_pricing SET credit_cost = 7510 WHERE model_identifier = 'seedance-2-5:19s:1080p' AND credit_cost = 5420;
UPDATE public.model_pricing SET credit_cost = 7900 WHERE model_identifier = 'seedance-2-5:20s:1080p' AND credit_cost = 5700;
UPDATE public.model_pricing SET credit_cost = 8300 WHERE model_identifier = 'seedance-2-5:21s:1080p' AND credit_cost = 5990;
UPDATE public.model_pricing SET credit_cost = 8690 WHERE model_identifier = 'seedance-2-5:22s:1080p' AND credit_cost = 6270;
UPDATE public.model_pricing SET credit_cost = 9090 WHERE model_identifier = 'seedance-2-5:23s:1080p' AND credit_cost = 6560;
UPDATE public.model_pricing SET credit_cost = 9480 WHERE model_identifier = 'seedance-2-5:24s:1080p' AND credit_cost = 6840;
UPDATE public.model_pricing SET credit_cost = 9880 WHERE model_identifier = 'seedance-2-5:25s:1080p' AND credit_cost = 7130;
UPDATE public.model_pricing SET credit_cost = 10270 WHERE model_identifier = 'seedance-2-5:26s:1080p' AND credit_cost = 7410;
UPDATE public.model_pricing SET credit_cost = 10670 WHERE model_identifier = 'seedance-2-5:27s:1080p' AND credit_cost = 7700;
UPDATE public.model_pricing SET credit_cost = 11060 WHERE model_identifier = 'seedance-2-5:28s:1080p' AND credit_cost = 7980;
UPDATE public.model_pricing SET credit_cost = 11460 WHERE model_identifier = 'seedance-2-5:29s:1080p' AND credit_cost = 8270;
UPDATE public.model_pricing SET credit_cost = 11850 WHERE model_identifier = 'seedance-2-5:30s:1080p' AND credit_cost = 8550;

-- Seedance 2.5, 1080p with video ref
UPDATE public.model_pricing SET credit_cost = 950 WHERE model_identifier = 'seedance-2-5:4s:1080p-ref' AND credit_cost = 690;
UPDATE public.model_pricing SET credit_cost = 1190 WHERE model_identifier = 'seedance-2-5:5s:1080p-ref' AND credit_cost = 860;
UPDATE public.model_pricing SET credit_cost = 1430 WHERE model_identifier = 'seedance-2-5:6s:1080p-ref' AND credit_cost = 1030;
UPDATE public.model_pricing SET credit_cost = 1670 WHERE model_identifier = 'seedance-2-5:7s:1080p-ref' AND credit_cost = 1200;
UPDATE public.model_pricing SET credit_cost = 1900 WHERE model_identifier = 'seedance-2-5:8s:1080p-ref' AND credit_cost = 1370;
UPDATE public.model_pricing SET credit_cost = 2140 WHERE model_identifier = 'seedance-2-5:9s:1080p-ref' AND credit_cost = 1550;
UPDATE public.model_pricing SET credit_cost = 2380 WHERE model_identifier = 'seedance-2-5:10s:1080p-ref' AND credit_cost = 1720;
UPDATE public.model_pricing SET credit_cost = 2620 WHERE model_identifier = 'seedance-2-5:11s:1080p-ref' AND credit_cost = 1890;
UPDATE public.model_pricing SET credit_cost = 2850 WHERE model_identifier = 'seedance-2-5:12s:1080p-ref' AND credit_cost = 2060;
UPDATE public.model_pricing SET credit_cost = 3090 WHERE model_identifier = 'seedance-2-5:13s:1080p-ref' AND credit_cost = 2230;
UPDATE public.model_pricing SET credit_cost = 3330 WHERE model_identifier = 'seedance-2-5:14s:1080p-ref' AND credit_cost = 2400;
UPDATE public.model_pricing SET credit_cost = 3570 WHERE model_identifier = 'seedance-2-5:15s:1080p-ref' AND credit_cost = 2570;
UPDATE public.model_pricing SET credit_cost = 3800 WHERE model_identifier = 'seedance-2-5:16s:1080p-ref' AND credit_cost = 2740;
UPDATE public.model_pricing SET credit_cost = 4040 WHERE model_identifier = 'seedance-2-5:17s:1080p-ref' AND credit_cost = 2920;
UPDATE public.model_pricing SET credit_cost = 4280 WHERE model_identifier = 'seedance-2-5:18s:1080p-ref' AND credit_cost = 3090;
UPDATE public.model_pricing SET credit_cost = 4520 WHERE model_identifier = 'seedance-2-5:19s:1080p-ref' AND credit_cost = 3260;
UPDATE public.model_pricing SET credit_cost = 4750 WHERE model_identifier = 'seedance-2-5:20s:1080p-ref' AND credit_cost = 3430;
UPDATE public.model_pricing SET credit_cost = 4990 WHERE model_identifier = 'seedance-2-5:21s:1080p-ref' AND credit_cost = 3600;
UPDATE public.model_pricing SET credit_cost = 5230 WHERE model_identifier = 'seedance-2-5:22s:1080p-ref' AND credit_cost = 3770;
UPDATE public.model_pricing SET credit_cost = 5470 WHERE model_identifier = 'seedance-2-5:23s:1080p-ref' AND credit_cost = 3940;
UPDATE public.model_pricing SET credit_cost = 5700 WHERE model_identifier = 'seedance-2-5:24s:1080p-ref' AND credit_cost = 4110;
UPDATE public.model_pricing SET credit_cost = 5940 WHERE model_identifier = 'seedance-2-5:25s:1080p-ref' AND credit_cost = 4290;
UPDATE public.model_pricing SET credit_cost = 6180 WHERE model_identifier = 'seedance-2-5:26s:1080p-ref' AND credit_cost = 4460;
UPDATE public.model_pricing SET credit_cost = 6420 WHERE model_identifier = 'seedance-2-5:27s:1080p-ref' AND credit_cost = 4630;
UPDATE public.model_pricing SET credit_cost = 6650 WHERE model_identifier = 'seedance-2-5:28s:1080p-ref' AND credit_cost = 4800;
UPDATE public.model_pricing SET credit_cost = 6890 WHERE model_identifier = 'seedance-2-5:29s:1080p-ref' AND credit_cost = 4970;
UPDATE public.model_pricing SET credit_cost = 7130 WHERE model_identifier = 'seedance-2-5:30s:1080p-ref' AND credit_cost = 5140;

-- GPT Image 2, 2K and 4K
UPDATE public.model_pricing SET credit_cost = 25 WHERE model_identifier = 'gpt-image-2:2K' AND credit_cost = 30;
UPDATE public.model_pricing SET credit_cost = 40 WHERE model_identifier = 'gpt-image-2:4K' AND credit_cost = 60;
UPDATE public.model_pricing SET credit_cost = 25 WHERE model_identifier = 'gpt-image-2-i2i:2K' AND credit_cost = 30;
UPDATE public.model_pricing SET credit_cost = 40 WHERE model_identifier = 'gpt-image-2-i2i:4K' AND credit_cost = 60;
