import { supabase } from "../../lib/supabase.js"
import { hasCredits } from "../../lib/config.js"
import { getAppSettings } from "../../lib/app-settings.js"
import { FREE_TIER_RESTRICTIONS, TIER_STORAGE_LIMITS } from "./stripe-config.js"
import { buildCreditModelIdentifier, buildVideoCreditModelIdentifier, buildMotionCreditModelIdentifier } from "@nodaro/shared"
import { buildLlmCreditIdentifier } from "@nodaro/shared"

// ============================================================
// Types
// ============================================================

export interface CreditCheckResult {
  allowed: boolean
  error?: string
  balance?: number
  required?: number
  dailyLimit?: number
  dailySpent?: number
  subscriptionCredits?: number
  topupCredits?: number
  watermark?: boolean
  /** App credits allowance shortage (only set when app run is blocked for free users) */
  appCreditsAllowance?: number
}

export interface UserBalance {
  total: number
  subscription: number
  topup: number
  dailySpent: number
  dailyLimit: number | null
  monthlyAllocation: number
  tier: string
  features: Record<string, unknown>
  periodEnd: string | null
  /** Credits earned for app usage (free tier only — earned by running flows) */
  appCreditsAllowance: number
}

export interface ReserveResult {
  usageLogId: string
  creditsReserved: number
  watermark: boolean
}

export interface StorageLimitResult {
  allowed: boolean
  error?: string
  usedBytes: number
  limitBytes: number
}

/**
 * Pre-fetched profile shape for checkCreditsWithProfile.
 * Must include credit-related columns.
 */
export interface CreditProfile {
  tier?: string | null
  subscription_tier?: string | null
  subscription_credits?: number | null
  topup_credits?: number | null
  daily_spent_credits?: number | null
  last_daily_reset?: string | null
  app_credits_allowance?: number | null
}

/**
 * Pre-fetched profile shape for checkStorageLimitWithProfile.
 * Must include storage columns + tier for fallback.
 */
export interface StorageProfile {
  tier?: string | null
  storage_used_bytes?: number | null
  storage_limit_bytes?: number | null
}

// ============================================================
// Fallback Static Credit Costs (used when model_pricing table doesn't exist)
// ============================================================

export const STATIC_CREDIT_COSTS: Record<string, number> = {
  ***REDACTED-OSS-SCRUB***
  // Markup % is configurable in admin settings (app_settings.cost_markup_percent).
  // Base entries = default/cheapest setting. Composite entries = specific setting.
  //
  // ── Image Generation ──
  "nano-banana": 2,              // 4 KIE cr, $0.02
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "nano-banana-2:4K": 7,          // 18 KIE cr, $0.09
  "nano-banana-pro": 6,          // 18 KIE cr, $0.09 (1K/2K default)
  "nano-banana-pro:4K": 8,       // 24 KIE cr, $0.12
  ***REDACTED-OSS-SCRUB***
  "flux:2K": 3,                  // 7 KIE cr, $0.035
  "grok": 2,                     // 4 KIE cr, $0.02
  ***REDACTED-OSS-SCRUB***
  "gpt-image:high": 7,           // 22 KIE cr, $0.11
  "gpt-image-2": 2,              // 4 KIE cr, $0.02 (1K default; estimated, recalibrate from anomalies)
  "gpt-image-2:2K": 4,           // 12 KIE cr, $0.06 (estimated)
  "gpt-image-2:4K": 7,           // 22 KIE cr, $0.11 (estimated)
  "imagen4": 3,                  // 8 KIE cr, $0.04
  "imagen4-fast": 2,             // 4 KIE cr, $0.02
  "imagen4-ultra": 4,            // 12 KIE cr, $0.06
  ***REDACTED-OSS-SCRUB***
  "seedream": 3,                 // 6.5 KIE cr, $0.032
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "seedream-5-lite:high": 5,     // estimated (4K)
  "flux-flex": 5,                // 14 KIE cr, $0.07 (1K default)
  "flux-flex:2K": 8,             // 24 KIE cr, $0.12
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── Replicate "Open" (uncensored) — run direct via Replicate, not KIE ──
  "flux-2-klein": 2,             // ~$0.025, BFL Flux 2 9B Klein via Replicate
  "kontext-multi": 4,            // ~$0.05, multi-image-kontext-pro via Replicate
  // ── Image Editing ──
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "topaz-image-upscale": 4,      // 10 KIE cr, $0.05 (2K default)
  "topaz-image-upscale:4K": 7,   // 20 KIE cr, $0.10
  "topaz-image-upscale:8K": 13,  // 40 KIE cr, $0.20
  "grok-upscale": 4,             // 10 KIE cr, $0.05
  // ── Image-to-Image ──
  "flux-i2i": 5,                 // 14 KIE cr, $0.07 (1K default)
  "flux-i2i:2K": 8,              // 24 KIE cr, $0.12
  ***REDACTED-OSS-SCRUB***
  "flux-pro-i2i:2K": 3,          // 7 KIE cr, $0.035
  "grok-i2i": 2,                 // 4 KIE cr, $0.02
  ***REDACTED-OSS-SCRUB***
  "gpt-image-i2i:high": 7,       // 22 KIE cr, $0.11
  "gpt-image-2-i2i": 2,          // 4 KIE cr, $0.02 (1K default; estimated)
  "gpt-image-2-i2i:2K": 4,       // 12 KIE cr, $0.06 (estimated)
  "gpt-image-2-i2i:4K": 7,       // 22 KIE cr, $0.11 (estimated)
  "ideogram-edit": 6,            // 18 KIE cr, $0.09 (BALANCED default)
  "ideogram-edit:TURBO": 4,      // 12 KIE cr, $0.06
  "ideogram-edit:QUALITY": 8,    // 24 KIE cr, $0.12
  "ideogram-remix": 6,           // 18 KIE cr, $0.09 (BALANCED default)
  "ideogram-remix:TURBO": 4,     // 12 KIE cr, $0.06
  "ideogram-remix:QUALITY": 8,   // 24 KIE cr, $0.12
  "ideogram-reframe": 3,         // 7 KIE cr, $0.035 (V3 Reframe BALANCED)
  "ideogram-reframe:TURBO": 2,   // 3.5 KIE cr, $0.0175
  "ideogram-reframe:QUALITY": 4, // 10 KIE cr, $0.05
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "qwen-i2i": 2,                 // 4 KIE cr, $0.02
  ***REDACTED-OSS-SCRUB***
  "seedream-edit": 3,            // 6.5 KIE cr, $0.032
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "seedream-5-lite-i2i:high": 5, // estimated (4K)
  // ── Video Generation (I2V / T2V) ──
  "minimax": 18,                 // 57 KIE cr, $0.285 (6s, 1080p)
  "veo3": 79,                    // 250 KIE cr, $1.25 (VEO 3.1 Quality)
  "veo3.1": 19,                  // 60 KIE cr, $0.30 (VEO 3.1 Fast @ 720p)
  "veo3.1:1080p": 21,            // 65 KIE cr, $0.325 (VEO 3.1 Fast @ 1080p)
  "veo3_lite": 10,               // 30 KIE cr, $0.15 (VEO 3.1 Lite @ 720p)
  "veo3_lite:1080p": 11,         // 35 KIE cr, $0.175 (VEO 3.1 Lite @ 1080p)
  ***REDACTED-OSS-SCRUB***
  // Kling 2.6 duration-tiered pricing (5s/10s, audio doubles cost)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "kling:10s:audio": 56,         // 220 KIE cr, $1.10 (10s with audio)
  "kling-turbo": 14,             // 42 KIE cr, $0.21 (5s fallback)
  // Kling Turbo duration-tiered pricing
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "kling-3.0": 63,               // 200 KIE cr, $1.00 (5s, audio, 1080P — 40 cr/sec) — fallback only
  // Kling 3.0 duration-tiered pricing (1080P, per-second: 27 no audio, 40 with audio)
  "kling-3.0:5s": 43,            // 135 KIE cr, $0.675 (1080P, no audio, 5s)
  "kling-3.0:10s": 86,           // 270 KIE cr, $1.35 (1080P, no audio, 10s)
  "kling-3.0:15s": 128,          // 405 KIE cr, $2.025 (1080P, no audio, 15s)
  "kling-3.0:5s:audio": 63,      // 200 KIE cr, $1.00 (1080P, audio, 5s)
  "kling-3.0:10s:audio": 126,    // 400 KIE cr, $2.00 (1080P, audio, 10s)
  "kling-3.0:15s:audio": 189,    // 600 KIE cr, $3.00 (1080P, audio, 15s)
  "grok-i2v": 7,                 // 20 KIE cr, $0.10 (6s fallback)
  // Grok I2V duration-tiered pricing (shared with grok T2V)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── Seedance 2.0 — per-second billing, resolution × video-ref dimensions ──
  // Base fallback (8s/480p/no-ref)
  "seedance-2": 38,
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── Seedance 2.0 Fast — same matrix, lower rates ──
  "seedance-2-fast": 31,
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // 480p with video ref (8 KIE cr/s)
  "seedance-2-fast:4s:480p-ref": 8,    // 32 KIE cr, $0.16
  "seedance-2-fast:8s:480p-ref": 16,   // 64 KIE cr, $0.32
  "seedance-2-fast:12s:480p-ref": 24,  // 96 KIE cr, $0.48
  "seedance-2-fast:15s:480p-ref": 30,  // 120 KIE cr, $0.60
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "wan-i2v": 22,                 // 70 KIE cr, $0.35 (5s 720p fallback)
  // Wan I2V duration-tiered pricing (720p default)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "wan-turbo": 13,               // 40 KIE cr, $0.20 (5s, 480p I2V default)
  ***REDACTED-OSS-SCRUB***
  // Hailuo 2.3 Pro duration-tiered pricing (768p default)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "hailuo-2.3": 10,              // 30 KIE cr, $0.15 (6s fallback)
  // Hailuo 2.3 duration-tiered pricing
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "hailuo-standard": 10,         // 30 KIE cr, $0.15 (6s fallback)
  // Hailuo Standard duration-tiered pricing
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "kling-master": 50,            // 160 KIE cr, $0.80 (5s fallback)
  // Kling Master duration-tiered pricing
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "kling-3-omni": 32,            // Replicate, ~$0.50 est (5s 720p fallback)
  // Kling 3 Omni duration-tiered pricing (Replicate, estimated — actual cost tracked via predict_time)
  "kling-3-omni:5s": 32,         // ~$0.50 est
  "kling-3-omni:10s": 63,        // ~$1.00 est
  "kling-3-omni:15s": 94,        // ~$1.50 est
  "runway-kie": 4,               // 12 KIE cr, $0.06 (5s, 720p)
  // ── Video Extend ──
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── VEO Upscale ──
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── Video-to-Video / Motion ──
  "wan": 22,                     // 70 KIE cr, $0.35 (V2V 5s 720p)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "wan-t2v": 33,                 // 104.5 KIE cr, $0.5225 (T2V 5s 1080p default)
  "wan-turbo-t2v": 25,           // 80 KIE cr, $0.40 (T2V 5s 720p default)
  // Wan 2.7 T2I — 1K/2K/4K (estimated, adjust after audit-credits post-ship)
  "wan-2.7": 3,        // $0.04 × 1.25 / $0.02 = 2.5 → 3 (8 KIE cr, 1K default)
  "wan-2.7:2K": 5,     // $0.08 × 1.25 / $0.02 = 5   (16 KIE cr est.)
  "wan-2.7:4K": 10,    // $0.16 × 1.25 / $0.02 = 10  (32 KIE cr est.)

  // Wan 2.7 Pro T2I — 1K/2K/4K (estimated)
  "wan-2.7-pro": 4,        // $0.06 × 1.25 / $0.02 = 3.75 → 4 (12 KIE cr, 1K)
  "wan-2.7-pro:2K": 8,     // $0.12 × 1.25 / $0.02 = 7.5 → 8 (24 KIE cr est.)
  "wan-2.7-pro:4K": 15,    // $0.24 × 1.25 / $0.02 = 15  (48 KIE cr est.)

  // Wan 2.7 I2V (estimated)
  "wan-2.7-i2v": 24,    // $0.375 × 1.25 / $0.02 = 23.4 → 24 (75 KIE cr, 5s 720p)

  // Wan 2.7 T2V (estimated)
  "wan-2.7-t2v": 24,    // $0.375 × 1.25 / $0.02 = 23.4 → 24 (75 KIE cr, 5s 720p)

  // HappyHorse (estimated)
  "happyhorse": 16,        // $0.25 × 1.25 / $0.02 = 15.6 → 16 (50 KIE cr, 5s 720p)
  "happyhorse-i2v": 16,    // $0.25 × 1.25 / $0.02 = 15.6 → 16 (50 KIE cr, 5s 720p)
  "happyhorse-ref2v": 19,  // $0.30 × 1.25 / $0.02 = 18.75 → 19 (60 KIE cr, 5s 720p)
  "happyhorse-edit": 25,   // $0.40 × 1.25 / $0.02 = 25  (80 KIE cr)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── Motion Transfer (per-second pricing, duration-tiered) ──
  ***REDACTED-OSS-SCRUB***
  "kling-3.0-motion": 38,        // 10s default: 120 KIE cr, $0.60
  "kling-3.0-motion:5s": 19,     // 60 KIE cr, $0.30
  "kling-3.0-motion:10s": 38,    // 120 KIE cr, $0.60
  "kling-3.0-motion:15s": 57,    // 180 KIE cr, $0.90
  "kling-3.0-motion:30s": 113,   // 360 KIE cr, $1.80
  ***REDACTED-OSS-SCRUB***
  "kling-3.0-motion:1080p": 63,  // 10s default: 200 KIE cr, $1.00
  "kling-3.0-motion:1080p:5s": 32,   // 100 KIE cr, $0.50
  "kling-3.0-motion:1080p:10s": 63,  // 200 KIE cr, $1.00
  "kling-3.0-motion:1080p:15s": 94,  // 300 KIE cr, $1.50
  "kling-3.0-motion:1080p:30s": 188, // 600 KIE cr, $3.00
  ***REDACTED-OSS-SCRUB***
  "motion-transfer": 19,         // 10s default: 60 KIE cr, $0.30 (Kling 2.6 720p)
  "kling-motion": 19,            // alias
  "motion-transfer:5s": 10,      // 30 KIE cr, $0.15
  "motion-transfer:10s": 19,     // 60 KIE cr, $0.30
  "motion-transfer:15s": 29,     // 90 KIE cr, $0.45
  "motion-transfer:30s": 57,     // 180 KIE cr, $0.90
  ***REDACTED-OSS-SCRUB***
  "motion-transfer:1080p": 29,   // 10s default: 90 KIE cr, $0.45
  "motion-transfer:1080p:5s": 15,    // 45 KIE cr, $0.225
  "motion-transfer:1080p:10s": 29,   // 90 KIE cr, $0.45
  "motion-transfer:1080p:15s": 43,   // 135 KIE cr, $0.675
  "motion-transfer:1080p:30s": 85,   // 270 KIE cr, $1.35
  // Wan Animate (Move + Replace) — resolution-tiered pricing
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── Lip Sync ──
  // Kling AI Avatar 2.0 (May 2026) supports up to 5min audio, billed per-second
  // by KIE at 8 cr/sec (Standard, 720p) and 16 cr/sec (Pro, 1080p).
  // Composite identifiers `<provider>:<bucket>s` map to ceil(bucket × Nodaro-rate).
  // Nodaro rates: 2 cr/sec Standard, 4 cr/sec Pro (matches pre-upgrade ~14s flat).
  // Bare keys remain for back-compat — callers without audioDurationSec hit them.
  "kling-avatar": 28,             // legacy default ~14s
  "kling-avatar:15s": 30,         // 15s × 2 cr/sec
  "kling-avatar:30s": 60,         // 30s × 2 cr/sec
  "kling-avatar:60s": 120,        // 60s × 2 cr/sec
  "kling-avatar:120s": 240,       // 120s × 2 cr/sec
  "kling-avatar:300s": 600,       // 300s × 2 cr/sec — 5-min ceiling
  "kling-avatar-pro": 56,         // legacy default ~14s
  "kling-avatar-pro:15s": 60,     // 15s × 4 cr/sec
  "kling-avatar-pro:30s": 120,    // 30s × 4 cr/sec
  "kling-avatar-pro:60s": 240,    // 60s × 4 cr/sec
  "kling-avatar-pro:120s": 480,   // 120s × 4 cr/sec
  "kling-avatar-pro:300s": 1200,  // 300s × 4 cr/sec — 5-min ceiling
  ***REDACTED-OSS-SCRUB***
  // ── Audio / TTS / Music ──
  "elevenlabs-v3": 4,             // direct ElevenLabs API, $0.05
  ***REDACTED-OSS-SCRUB***
  "elevenlabs-multilingual": 4,  // 12 KIE cr per 1K chars, $0.06
  "elevenlabs": 2,               // alias for turbo
  ***REDACTED-OSS-SCRUB***
  // Replicate disabled
  ***REDACTED-OSS-SCRUB***
  "suno": 4,                     // 12 KIE cr, $0.06 (per generation, V4 default)
  "suno-v5": 4,                  // 12 KIE cr, $0.06 (V5, same KIE cost as V4)
  "suno-v5_5": 4,                // 12 KIE cr, $0.06 (V5.5)
  "suno-generate": 4,            // 12 KIE cr (V4 default)
  "suno-cover": 4,               // 12 KIE cr
  "suno-extend": 4,              // 12 KIE cr
  "suno-lyrics": 2,              // 0.4 KIE cr
  "suno-separate": 5,            // 10 KIE cr, vocal separation
  "suno-separate-stem": 16,      // 50 KIE cr, full stem separation
  "suno-music-video": 5,         // 2 KIE cr
  "suno-mashup": 4,              // 12 KIE cr
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "suno-add-instrumental": 4,    // 12 KIE cr
  "suno-add-vocals": 4,          // 12 KIE cr
  ***REDACTED-OSS-SCRUB***
  "suno-upload-extend": 4,       // 12 KIE cr
  // Replicate disabled
  // "musicgen": 7,                 // Replicate Meta MusicGen
  // "lyria": 7,                    // Replicate Google Lyria 2
  // "bark": 7,                     // Replicate Suno Bark
  ***REDACTED-OSS-SCRUB***
  // Replicate disabled
  // "whisper": 4,                   // Replicate whisper transcription
  // "incredibly-fast-whisper": 4,   // Replicate fast whisper
  ***REDACTED-OSS-SCRUB***
  "elevenlabs-dialogue": 5,     // 14 KIE cr per 1K chars, $0.07
  "voice-clone": 5,              // ElevenLabs instant voice clone
  "elevenlabs-voice-changer": 4,  // ElevenLabs speech-to-speech
  "elevenlabs-dubbing": 8,        // ElevenLabs dubbing (async)
  "elevenlabs-voice-remix": 4,    // ElevenLabs voice remix/preview
  "elevenlabs-voice-design": 5,   // ElevenLabs voice design (full controls)
  "elevenlabs-forced-alignment": 3, // ElevenLabs forced alignment
  "infinitalk": 42,              // fallback (720p default)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── Speech-to-Video ──
  "speech-to-video": 4,           // 12 KIE cr, $0.06 (480p)
  "speech-to-video:580p": 6,      // 18 KIE cr, $0.09
  "speech-to-video:720p": 8,      // 24 KIE cr, $0.12
  // ── Processing ──
  "topaz": 1,                     // processing
  "ffmpeg": 1,
  "render-video": 15,            // Remotion compute
  // Replicate disabled
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── LLM (standard tier = base entry, economy = 0.5x min 1, premium = 3x) ──
  "prompt-helper": 2,            // standard
  "prompt-helper:economy": 1,
  "prompt-helper:premium": 5,
  "ai-writer": 5,                // standard
  "ai-writer:economy": 3,
  "ai-writer:premium": 15,
  "llm-chat": 5,                 // standard
  "llm-chat:economy": 3,
  "llm-chat:premium": 15,
  "translate": 1,                // internal utility (replicate i2i prompt translation)
  "translate:economy": 1,
  "translate:premium": 3,
  "scene-graph-ai": 10,          // standard
  "scene-graph-ai:economy": 5,
  "scene-graph-ai:premium": 30,
  "video-composer": 10,          // standard
  "video-composer:economy": 5,
  "video-composer:premium": 30,
  "after-effects": 10,           // standard
  "after-effects:economy": 5,
  "after-effects:premium": 30,
  "lottie-overlay": 10,          // standard
  "lottie-overlay:economy": 5,
  "lottie-overlay:premium": 30,
  "3d-title": 15,                // standard
  "3d-title:economy": 8,
  "3d-title:premium": 45,
  "motion-graphics": 10,         // standard
  "motion-graphics:economy": 5,
  "motion-graphics:premium": 30,
  "composite": 0,
  "sub-workflow": 0,
  // ── Node types (additional entries for workflow estimation by node.type) ──
  "generate-script": 10,
  "generate-script:economy": 5,
  "generate-script:premium": 30,
  "generate-image": 2,
  "edit-image": 2,
  "image-to-image": 2,
  "modify-image": 2,
  "upscale-image": 1,
  "remove-background": 1,
  "image-to-video": 25,
  "video-to-video": 25,
  "text-to-video": 25,
  "text-to-speech": 4,
  "generate-music": 4,
  "text-to-audio": 4,
  "lip-sync": 13,
  "latentsync": 5,
  "wav2lip": 1,
  "video-retalking": 20,
  "sadtalker": 9,
  "video-upscale": 19,
  "extend-video": 40,
  "roop-face-swap": 16,           // $0.25 Replicate × 1.25 / $0.02
  "generate-mask": 2,             // adirik/grounded-sam (Replicate) — segmentation mask
  "transcribe": 4,
  // ── Web Scrape (Apify + direct RSS) ──
  "web-scrape": 5,
  "web-scrape:google-search": 2,
  "web-scrape:content-crawler": 3,
  "web-scrape:content-crawler:site": 10,
  "web-scrape:instagram": 5,
  "web-scrape:tiktok": 5,
  "web-scrape:rss": 1,
  "qa-check": 5,
  "qa-check:economy": 3,
  "qa-check:premium": 15,
  // ── Dynamic-priced video utilities (NOT used by routes, but kept as
  //    safety-net fallback). The three rows below are unreachable when
  //    routes/loop-video.ts, routes/trim-video.ts, routes/combine-videos.ts
  //    use the computeCredits hook in creditGuard. Their model_pricing rows
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "combine-videos": 3,
  "merge-video-audio": 2,
  "add-captions": 3,
  "add-captions:kinetic": 5,
  "resize-video": 2,
  "trim-audio": 1,
  "split-media": 2,
  "mix-audio": 2,
  "combine-audio": 1,
  "adjust-volume": 1,
  "trim-video": 1,
  "extract-frame": 1,
  "speed-ramp": 2,
  "loop-video": 1,
  "fade-video": 1,
  "transcode-video": 1,
  "audio-isolation": 8,          // alias for elevenlabs-isolation
  "text-to-dialogue": 4,
  "image-to-text": 5,
  "image-to-text:economy": 3,
  "image-to-text:premium": 15,
  "character": 2,
  "object": 2,
  "location": 2,
  "voice-changer": 4,
  "dubbing": 8,
  "voice-remix": 4,
  "voice-design": 5,
  "forced-alignment": 3,
  "social-media-format": 2,
  "social-publish": 1,
  "instagram-post": 1,
  "tiktok-post": 1,
  "youtube-upload": 1,
  "linkedin-post": 1,
  "x-post": 1,
  "facebook-post": 1,
  "telegram-post": 1,
  "save-to-storage": 0,
  "router": 0,
  "component": 0,               // Component node itself is free; inner nodes have their own costs
}

// Tier order for restriction checks
const TIER_ORDER = ["free", "basic", "standard", "pro", "business"]

// ============================================================
// Helper Functions
// ============================================================

/**
 * Check if credit system is disabled (community or business edition)
 */
function creditsDisabled(): boolean {
  return !hasCredits()
}

/**
 * Resolve the user's tier from profile, checking both `tier` and `subscription_tier`
 * columns for backward compatibility.
 */
function resolveTier(profile: Record<string, unknown>): string {
  return (profile.tier as string) ?? (profile.subscription_tier as string) ?? "free"
}

/**
 * Check if daily_spent_credits needs resetting (new UTC day).
 * Returns the effective daily spent value (0 if reset needed).
 * Uses atomic RPC with FOR UPDATE lock to prevent race conditions at midnight.
 */
async function getEffectiveDailySpent(
  userId: string,
  currentDailySpent: number,
  lastReset: string | null
): Promise<number> {
  const todayUTC = new Date().toISOString().slice(0, 10)
  const lastResetDay = lastReset ? lastReset.slice(0, 10) : null

  if (lastResetDay !== todayUTC) {
    // Atomic reset via RPC (FOR UPDATE lock prevents race at midnight)
    const { data, error } = await supabase.rpc("reset_daily_spent_if_needed", {
      p_user_id: userId,
    })
    if (!error && data !== null && data !== undefined) {
      return data as number
    }
    // Fallback: non-atomic reset if RPC not available
    await supabase
      .from("profiles")
      .update({
        daily_spent_credits: 0,
        last_daily_reset: new Date().toISOString().slice(0, 10),
      })
      .eq("id", userId)
    return 0
  }

  return currentDailySpent
}

// ============================================================
// TTL Cache — reusable map with time-based expiration
// ============================================================

class TtlCache<T> {
  private readonly entries = new Map<string, T>()
  private expiresAt = 0

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    if (Date.now() >= this.expiresAt) {
      this.entries.clear()
      return undefined
    }
    return this.entries.get(key)
  }

  set(key: string, value: T): void {
    if (Date.now() >= this.expiresAt) {
      this.entries.clear()
      this.expiresAt = Date.now() + this.ttlMs
    }
    this.entries.set(key, value)
  }

  invalidate(): void {
    this.entries.clear()
    this.expiresAt = 0
  }
}

// ── Model pricing cache (60s TTL) ──

export interface ModelPricing {
  creditCost: number
  isEnabled: boolean
  tierRestriction: string | null
}

const modelPricingCache = new TtlCache<ModelPricing>(60_000)

/**
 * Invalidate the model pricing cache (e.g. after admin updates model_pricing table)
 */
export function invalidateModelPricingCache(): void {
  modelPricingCache.invalidate()
}

/**
 * Returns the PRE-MARKUP base cost for a model (cached 60s).
 * Use this when the caller will apply markup separately (e.g. routes
 * composing dbCost + addon via the creditGuard computeCredits hook).
 * For most callers, prefer getModelCreditCostFromDB which returns
 * post-markup values matching what the user is charged.
 */
export async function getModelCreditBaseCost(modelIdentifier: string): Promise<ModelPricing> {
  const cached = modelPricingCache.get(modelIdentifier)
  if (cached) return cached

  const { data, error } = await supabase
    .from("model_pricing")
    .select("credit_cost, is_enabled, tier_restriction")
    .eq("model_identifier", modelIdentifier)
    .single()

  let base: ModelPricing
  if (error || !data) {
    const staticCost = STATIC_CREDIT_COSTS[modelIdentifier]
    if (staticCost === undefined) {
      console.warn(`[credits] Unknown model identifier "${modelIdentifier}" — no DB or static cost, defaulting to 1`)
    }
    base = { creditCost: staticCost ?? 1, isEnabled: true, tierRestriction: null }
  } else {
    base = { creditCost: data.credit_cost, isEnabled: data.is_enabled, tierRestriction: data.tier_restriction }
  }
  modelPricingCache.set(modelIdentifier, base)
  return base
}

/**
 * Get credit cost for a model from database, falling back to static costs.
 * Base costs are cached for 60s. The cost_markup_percent from admin settings
 * is applied on top: finalCost = ceil(baseCost * (1 + markup/100)).
 * Both DB values and STATIC_CREDIT_COSTS represent base costs at 0% markup.
 */
export async function getModelCreditCostFromDB(modelIdentifier: string): Promise<ModelPricing> {
  const base = await getModelCreditBaseCost(modelIdentifier)
  // Apply markup from admin settings (cached 60s separately)
  const settings = await getAppSettings()
  if (settings.cost_markup_percent > 0 && base.creditCost > 0) {
    return {
      ...base,
      creditCost: Math.ceil(base.creditCost * (1 + settings.cost_markup_percent / 100)),
    }
  }
  return base
}

// ── Tier config cache (60s TTL) ──

interface TierConfig {
  daily_credit_limit: number | null
  monthly_credits: number | null
  features: Record<string, unknown> | null
}

const tierConfigCache = new TtlCache<TierConfig>(60_000)

async function getTierConfig(tier: string): Promise<TierConfig> {
  const cached = tierConfigCache.get(tier)
  if (cached) return cached

  const { data } = await supabase
    .from("tier_config")
    .select("daily_credit_limit, monthly_credits, features")
    .eq("tier", tier)
    .single()

  const result: TierConfig = {
    daily_credit_limit: data?.daily_credit_limit ?? null,
    monthly_credits: data?.monthly_credits ?? null,
    features: (data?.features as Record<string, unknown>) ?? null,
  }

  tierConfigCache.set(tier, result)
  return result
}

// ============================================================
// Credits Service
// ============================================================

export class CreditsService {
  /**
   * Log a credit transaction (never throws -- errors are logged silently)
   */
  static async logTransaction(params: {
    userId: string
    amount: number
    creditType: "subscription" | "topup"
    source: "subscription_created" | "subscription_renewal" | "one_time_purchase" | "admin_adjustment" | "usage" | "refund" | "stripe_refund" | "expiry"
    description?: string
    jobId?: string
    stripeTransactionId?: string
    adminUserId?: string
    balanceAfter: number
  }): Promise<boolean> {
    try {
      const { error } = await supabase
        .from("credit_transactions")
        .insert({
          user_id: params.userId,
          amount: params.amount,
          credit_type: params.creditType,
          source: params.source,
          description: params.description || null,
          job_id: params.jobId || null,
          stripe_transaction_id: params.stripeTransactionId || null,
          admin_user_id: params.adminUserId || null,
          balance_after: params.balanceAfter,
        })
      if (error) {
        console.error("[credits] Failed to log transaction:", error)
        return false
      }
      return true
    } catch (err) {
      console.error("[credits] Failed to log transaction:", err)
      return false
    }
  }

  /**
   * Admin: adjust a user's credits (add or remove)
   */
  static async adminAdjustCredits(params: {
    userId: string
    amount: number
    creditType: "subscription" | "topup"
    description: string
    adminUserId: string
  }): Promise<{ newBalance: number }> {
    if (creditsDisabled()) {
      return { newBalance: 999999 }
    }

    const field = params.creditType === "subscription" ? "subscription_credits" : "topup_credits"
    const otherField = params.creditType === "subscription" ? "topup_credits" : "subscription_credits"

    // Atomic update using SQL expression to avoid TOCTOU race condition.
    // GREATEST ensures credits never go below 0.
    const { data: updated, error: updateError } = await supabase
      .rpc("admin_adjust_credits" as string, {
        p_user_id: params.userId,
        p_field: field,
        p_amount: params.amount,
      })

    // Fallback if RPC doesn't exist yet: use read-then-write (existing behavior)
    let newValue: number
    let otherValue: number
    if (updateError) {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("subscription_credits, topup_credits")
        .eq("id", params.userId)
        .single()

      if (profileError || !profile) {
        throw new Error("User profile not found")
      }

      const currentValue = ((profile as Record<string, unknown>)[field] ?? 0) as number
      newValue = Math.max(0, currentValue + params.amount)
      otherValue = ((profile as Record<string, unknown>)[otherField] ?? 0) as number

      const { error: fallbackError } = await supabase
        .from("profiles")
        .update({ [field]: newValue })
        .eq("id", params.userId)

      if (fallbackError) {
        throw new Error(`Failed to update credits: ${fallbackError.message}`)
      }
    } else {
      // RPC returns the new values
      const result = updated as Record<string, number> | null
      newValue = (result?.[field] ?? 0) as number
      otherValue = (result?.[otherField] ?? 0) as number
    }

    const newTotal = newValue + otherValue

    await CreditsService.logTransaction({
      userId: params.userId,
      amount: params.amount,
      creditType: params.creditType,
      source: "admin_adjustment",
      description: params.description,
      adminUserId: params.adminUserId,
      balanceAfter: newTotal,
    })

    return { newBalance: newTotal }
  }

  /**
   * Check if user has sufficient credits (read-only check).
   * Enforces free tier restrictions: blocked models, daily credit cap.
   * Returns allowed: true for self-hosted mode.
   */
  static async checkCredits(
    userId: string,
    modelIdentifier: string,
    isAppRun?: boolean,
  ): Promise<CreditCheckResult> {
    // Self-hosted: always allow
    if (creditsDisabled()) {
      return { allowed: true, balance: 999999, watermark: false }
    }

    // Get user's profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("tier, subscription_tier, subscription_credits, topup_credits, daily_spent_credits, last_daily_reset, app_credits_allowance")
      .eq("id", userId)
      .single()

    if (profileError || !profile) {
      return {
        allowed: false,
        error: "User profile not found",
      }
    }

    return CreditsService.checkCreditsWithProfile(userId, profile as CreditProfile, modelIdentifier, isAppRun)
  }

  /**
   * Check credits using a pre-fetched profile (avoids extra DB query).
   * The profile must include: tier, subscription_tier, subscription_credits,
   * topup_credits, daily_spent_credits, last_daily_reset.
   */
  static async checkCreditsWithProfile(
    userId: string,
    profile: CreditProfile,
    modelIdentifier: string,
    isAppRun?: boolean,
    creditOverride?: number,
  ): Promise<CreditCheckResult> {
    if (creditsDisabled()) {
      return { allowed: true, balance: 999999, watermark: false }
    }

    // When a route supplies a dynamic credit override, use it for the
    // creditCost while still respecting the DB row's isEnabled +
    // tierRestriction (admins disabling a model still wins).
    const dbPricing = await getModelCreditCostFromDB(modelIdentifier)
    const pricing = creditOverride !== undefined
      ? { ...dbPricing, creditCost: creditOverride }
      : dbPricing

    if (!pricing.isEnabled) {
      return {
        allowed: false,
        error: "This model is currently disabled",
      }
    }

    const userTier = resolveTier(profile as Record<string, unknown>)
    const isFree = userTier === "free"
    const watermark = isFree && FREE_TIER_RESTRICTIONS.watermark

    // Check tier restriction (from model_pricing table)
    if (pricing.tierRestriction) {
      const userTierIndex = TIER_ORDER.indexOf(userTier)
      const requiredTierIndex = TIER_ORDER.indexOf(pricing.tierRestriction)

      if (userTierIndex < requiredTierIndex) {
        return {
          allowed: false,
          error: `This model requires ${pricing.tierRestriction} tier or higher. Please upgrade your plan.`,
          watermark,
        }
      }
    }

    // Free tier: blocked models
    if (isFree) {
      const blockedModels = FREE_TIER_RESTRICTIONS.blockedModels as readonly string[]
      if (blockedModels.includes(modelIdentifier)) {
        return {
          allowed: false,
          error: "This model requires a paid subscription. Upgrade to Basic or higher.",
          watermark,
        }
      }
    }

    // Calculate total balance
    const subscriptionCredits = profile.subscription_credits ?? 0
    const topupCredits = profile.topup_credits ?? 0
    const totalBalance = subscriptionCredits + topupCredits

    // Check if user has enough credits
    if (totalBalance < pricing.creditCost) {
      return {
        allowed: false,
        error: `Insufficient credits. Required: ${pricing.creditCost}, Available: ${totalBalance}`,
        balance: totalBalance,
        required: pricing.creditCost,
        subscriptionCredits,
        topupCredits,
        watermark,
      }
    }

    // App run check: free tier users with no topup must have earned enough app allowance
    if (isAppRun && isFree && topupCredits === 0) {
      const appAllowance = profile.app_credits_allowance ?? 0
      if (appAllowance < pricing.creditCost) {
        return {
          allowed: false,
          error: `Insufficient app credits. You have ${appAllowance} app credits but need ${pricing.creditCost}. Earn app credits by running flows in the editor.`,
          balance: totalBalance,
          required: pricing.creditCost,
          appCreditsAllowance: appAllowance,
          watermark,
        }
      }
    }

    // Free tier: daily credit cap
    if (isFree) {
      const dailyCap = FREE_TIER_RESTRICTIONS.dailyCreditCap
      const dailySpent = await getEffectiveDailySpent(
        userId,
        profile.daily_spent_credits ?? 0,
        profile.last_daily_reset ?? null
      )

      if (dailySpent >= dailyCap) {
        return {
          allowed: false,
          error: `Daily credit limit reached for free tier. Limit: ${dailyCap}, Spent today: ${dailySpent}. Upgrade for higher limits.`,
          balance: totalBalance,
          required: pricing.creditCost,
          dailyLimit: dailyCap,
          dailySpent,
          watermark,
        }
      }

      return {
        allowed: true,
        balance: totalBalance,
        required: pricing.creditCost,
        subscriptionCredits,
        topupCredits,
        dailyLimit: dailyCap,
        dailySpent,
        watermark,
      }
    }

    // Paid tiers: check daily limit from tier_config if configured
    const tierConfig = await getTierConfig(userTier)
    const dailyLimit = tierConfig.daily_credit_limit ?? undefined
    const dailySpent = profile.daily_spent_credits ?? 0

    if (dailyLimit !== undefined && dailySpent + pricing.creditCost > dailyLimit) {
      return {
        allowed: false,
        error: `Daily credit limit reached. Limit: ${dailyLimit}, Spent: ${dailySpent}`,
        balance: totalBalance,
        required: pricing.creditCost,
        dailyLimit,
        dailySpent,
        watermark,
      }
    }

    return {
      allowed: true,
      balance: totalBalance,
      required: pricing.creditCost,
      subscriptionCredits,
      topupCredits,
      dailyLimit,
      dailySpent,
      watermark,
    }
  }

  /**
   * Reserve credits atomically using reserve_credits RPC.
   * Single RPC call: deducts credits (subscription first, then topup),
   * increments daily_spent, and creates usage_log — all in one transaction.
   */
  static async reserveCredits(
    userId: string,
    jobId: string,
    modelIdentifier: string,
    providerCostUsd: number,
    displayCostUsd: number,
    options?: { watermarkOverride?: boolean; isAppRun?: boolean; creditOverride?: number },
  ): Promise<ReserveResult> {
    // Self-hosted: skip reservation
    if (creditsDisabled()) {
      return { usageLogId: "self-hosted-skip", creditsReserved: 0, watermark: false }
    }

    const { watermarkOverride, isAppRun, creditOverride } = options ?? {}

    // Get credit cost: route-supplied override or DB lookup.
    const dbPricing = await getModelCreditCostFromDB(modelIdentifier)
    const pricing = creditOverride !== undefined
      ? { ...dbPricing, creditCost: creditOverride }
      : dbPricing
    let watermark: boolean
    if (watermarkOverride !== undefined) {
      watermark = watermarkOverride
    } else {
      const { data: tierProfile } = await supabase
        .from("profiles")
        .select("tier, subscription_tier")
        .eq("id", userId)
        .single()

      const userTier = tierProfile ? resolveTier(tierProfile as Record<string, unknown>) : "free"
      watermark = userTier === "free" && FREE_TIER_RESTRICTIONS.watermark
    }

    // Skip deduction for zero-cost models
    if (pricing.creditCost === 0) {
      const { data: usageLog } = await supabase
        .from("usage_logs")
        .insert({
          user_id: userId,
          job_id: jobId,
          action: modelIdentifier,
          provider: "reserved",
          credits_used: 0,
          cost_usd: providerCostUsd,
          metadata: { status: "reserved", display_cost_usd: displayCostUsd },
        })
        .select("id")
        .single()

      return {
        usageLogId: usageLog?.id ?? "log-failed",
        creditsReserved: 0,
        watermark,
      }
    }

    // Atomic reservation via single RPC (deducts credits + increments daily spent + creates usage log)
    const { data: usageLogId, error: reserveError } = await supabase.rpc("reserve_credits", {
      p_user_id: userId,
      p_credits: pricing.creditCost,
      p_job_id: jobId,
      p_model_identifier: modelIdentifier,
      p_provider_cost_usd: providerCostUsd,
      p_display_cost_usd: displayCostUsd,
      p_is_app_run: isAppRun ?? false,
    })

    if (reserveError) {
      console.error("[credits] reserve_credits RPC failed:", reserveError.message)
      throw new Error(`Credit reservation failed: ${reserveError.message}`)
    }

    if (!usageLogId) {
      console.error("[credits] reserve_credits returned null usage log ID")
      return { usageLogId: "log-failed", creditsReserved: pricing.creditCost, watermark }
    }

    // Fetch usage_log metadata (from_sub/from_topup) for accurate creditType,
    // and current user balance for accurate balanceAfter (C3 + H6 fix)
    let creditType: "subscription" | "topup" = "subscription"
    let balanceAfter = 0
    try {
      const [{ data: usageLog }, { data: balanceProfile }] = await Promise.all([
        supabase
          .from("usage_logs")
          .select("metadata")
          .eq("id", usageLogId)
          .single(),
        supabase
          .from("profiles")
          .select("subscription_credits, topup_credits")
          .eq("id", userId)
          .single(),
      ])
      const meta = usageLog?.metadata as Record<string, unknown> | null
      const fromSub = (meta?.from_sub as number) ?? 0
      const fromTopup = (meta?.from_topup as number) ?? 0
      if (fromTopup > 0 && fromSub === 0) {
        creditType = "topup"
      }
      if (balanceProfile) {
        balanceAfter = (balanceProfile.subscription_credits ?? 0) + (balanceProfile.topup_credits ?? 0)
      }
    } catch {
      // Non-critical: fall back to defaults if fetch fails
    }

    // Log credit transaction
    await CreditsService.logTransaction({
      userId,
      amount: -pricing.creditCost,
      creditType,
      source: "usage",
      description: `Job ${jobId}: ${modelIdentifier}`,
      jobId,
      balanceAfter,
    })

    return { usageLogId: usageLogId as string, creditsReserved: pricing.creditCost, watermark }
  }

  /**
   * Commit reserved credits after job success
   * Updates usage_log status to 'committed'
   */
  static async commitCredits(
    usageLogId: string,
    actualCredits?: number
  ): Promise<void> {
    if (creditsDisabled() || usageLogId === "self-hosted-skip") return

    // Try RPC first
    const { error: rpcError } = await supabase.rpc("commit_credits", {
      p_usage_log_id: usageLogId,
      p_actual_credits: actualCredits,
    })

    if (!rpcError) return

    // Fallback: manual commit. Update the canonical `status` column (the same
    // column the SQL `commit_credits`/`refund_credits` functions use), guarded
    // by status='reserved' so a concurrent commit/refund can't double-fire.
    console.warn("[credits] commit_credits RPC not found, using fallback")

    const { error } = await supabase
      .from("usage_logs")
      .update({ status: "committed" })
      .eq("id", usageLogId)
      .eq("status", "reserved")

    if (error) {
      console.error("[credits] Failed to commit credits:", error)
    }
  }

  /**
   * Refund reserved credits after job failure
   * Updates usage_log status to 'refunded' and restores credits
   */
  static async refundCredits(usageLogId: string): Promise<void> {
    if (creditsDisabled() || usageLogId === "self-hosted-skip") return

    // Try RPC first
    const { error: rpcError } = await supabase.rpc("refund_credits", {
      p_usage_log_id: usageLogId,
    })

    if (!rpcError) return

    // Fallback: manual refund
    console.warn("[credits] refund_credits RPC not found, using fallback")

    // Get the usage log to find credits to refund
    const { data: usageLog, error: logError } = await supabase
      .from("usage_logs")
      .select("user_id, job_id, credits_used, status, metadata")
      .eq("id", usageLogId)
      .single()

    if (logError || !usageLog) {
      console.error("[credits] Usage log not found for refund:", usageLogId)
      return
    }

    // Only `reserved` rows are eligible to refund. Already-committed or
    // already-refunded rows must not be touched (mirrors the SQL function's
    // `WHERE id = ? AND status = 'reserved'` guard).
    if (usageLog.status !== "reserved") {
      console.warn(`[credits] Skipping refund — usage log ${usageLogId} status is "${usageLog.status}"`)
      return
    }

    // Atomic claim: flip status reserved → refunded conditionally. If two
    // callers race here, exactly one matches a row; the other gets `null` and
    // returns without touching balances. Done BEFORE any credit restoration
    // so the balance mutation is gated behind a single-winner mutex.
    const { data: claimed, error: claimError } = await supabase
      .from("usage_logs")
      .update({ status: "refunded" })
      .eq("id", usageLogId)
      .eq("status", "reserved")
      .select("id")
      .maybeSingle()

    if (claimError) {
      console.error("[credits] Failed to claim refund slot:", usageLogId, claimError.message)
      return
    }
    if (!claimed) {
      console.warn("[credits] Refund slot already claimed (concurrent caller):", usageLogId)
      return
    }

    // Past this point we are the sole refunder; safe to restore balances.
    const meta = usageLog.metadata as Record<string, unknown> | null
    const fromSub = (meta?.from_sub as number) ?? 0
    const fromTopup = (meta?.from_topup as number) ?? 0

    // Restore subscription credits if any were deducted from that pool
    if (fromSub > 0) {
      const { error: subError } = await supabase.rpc("add_subscription_credits", {
        p_user_id: usageLog.user_id,
        p_credits: fromSub,
      })
      if (subError) {
        console.error("[credits] add_subscription_credits RPC failed for refund:", usageLogId, subError.message)
      }
    }

    // Restore topup credits if any were deducted from that pool
    if (fromTopup > 0) {
      const { error: topupError } = await supabase.rpc("add_topup_credits", {
        p_user_id: usageLog.user_id,
        p_credits: fromTopup,
      })
      if (topupError) {
        console.error("[credits] add_topup_credits RPC failed for refund:", usageLogId, topupError.message)
      }
    }

    // Fallback: if metadata didn't record pool split, restore all to topup
    if (fromSub === 0 && fromTopup === 0 && usageLog.credits_used > 0) {
      const { error: fallbackError } = await supabase.rpc("add_topup_credits", {
        p_user_id: usageLog.user_id,
        p_credits: usageLog.credits_used,
      })
      if (fallbackError) {
        console.error("[credits] Fallback add_topup_credits RPC failed:", usageLogId, fallbackError.message)
      }
    }

    // Determine creditType for transaction log based on which pool was dominant
    const refundCreditType: "subscription" | "topup" =
      fromSub > 0 && fromTopup === 0 ? "subscription" : "topup"

    await CreditsService.logTransaction({
      userId: usageLog.user_id,
      amount: usageLog.credits_used,
      creditType: refundCreditType,
      source: "refund",
      description: "Refund for failed job",
      jobId: usageLog.job_id ?? undefined,
      balanceAfter: 0,
    })
  }

  /**
   * Check if user is within their storage limit.
   * Returns allowed: true for self-hosted mode.
   */
  static async checkStorageLimit(userId: string): Promise<StorageLimitResult> {
    if (creditsDisabled()) {
      return { allowed: true, usedBytes: 0, limitBytes: Number.MAX_SAFE_INTEGER }
    }

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("tier, storage_used_bytes, storage_limit_bytes")
      .eq("id", userId)
      .single()

    if (error || !profile) {
      return { allowed: false, error: "User profile not found", usedBytes: 0, limitBytes: 0 }
    }

    return CreditsService.checkStorageLimitWithProfile(profile as StorageProfile)
  }

  /**
   * Check storage limit using a pre-fetched profile (avoids extra DB query).
   * The profile must include: storage_used_bytes, storage_limit_bytes.
   */
  static checkStorageLimitWithProfile(profile: StorageProfile): StorageLimitResult {
    if (creditsDisabled()) {
      return { allowed: true, usedBytes: 0, limitBytes: Number.MAX_SAFE_INTEGER }
    }

    const usedBytes = profile.storage_used_bytes ?? 0
    const tier = (profile.tier as string) ?? "free"
    const dbLimit = profile.storage_limit_bytes ?? 0
    const tierLimit = TIER_STORAGE_LIMITS[tier] ?? TIER_STORAGE_LIMITS.free
    // Use tier-based limit when DB has no value or the stale 500MB default (524288000)
    const limitBytes = dbLimit > 0 && dbLimit !== 524288000 ? dbLimit : tierLimit

    if (usedBytes >= limitBytes) {
      const usedGB = (usedBytes / (1024 * 1024 * 1024)).toFixed(1)
      const limitGB = (limitBytes / (1024 * 1024 * 1024)).toFixed(1)
      return {
        allowed: false,
        error: `Storage limit reached (${usedGB} GB of ${limitGB} GB used). Delete files or upgrade your plan.`,
        usedBytes,
        limitBytes,
      }
    }

    return { allowed: true, usedBytes, limitBytes }
  }

  /**
   * Get user's current balance and tier info
   */
  static async getBalance(userId: string): Promise<UserBalance> {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select(`
        subscription_credits,
        topup_credits,
        tier,
        subscription_tier,
        daily_spent_credits,
        last_daily_reset,
        current_period_end,
        app_credits_allowance
      `)
      .eq("id", userId)
      .single()

    if (error || !profile) {
      // Return default values if profile not found
      return {
        total: 0,
        subscription: 0,
        topup: 0,
        dailySpent: 0,
        dailyLimit: null,
        monthlyAllocation: 0,
        tier: "free",
        features: {},
        periodEnd: null,
        appCreditsAllowance: 0,
      }
    }

    const userTier = resolveTier(profile as Record<string, unknown>)

    // Get tier configuration (cached)
    const tierConfig = await getTierConfig(userTier)

    const subscriptionCredits = profile.subscription_credits ?? 0
    const topupCredits = profile.topup_credits ?? 0

    // For free tier, use FREE_TIER_RESTRICTIONS.dailyCreditCap
    const dailyLimit = userTier === "free"
      ? FREE_TIER_RESTRICTIONS.dailyCreditCap
      : (tierConfig.daily_credit_limit ?? null)

    // Reset daily spent if it's a new UTC day (otherwise stale value shows in UI)
    const dailySpent = await getEffectiveDailySpent(
      userId,
      profile.daily_spent_credits ?? 0,
      profile.last_daily_reset as string | null
    )

    // Read current_period_end: DB first, then Stripe API as self-healing fallback
    let periodEnd: string | null = profile.current_period_end ?? null
    if (userTier !== "free") {
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("current_period_end, stripe_subscription_id")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("current_period_end", { ascending: false })
        .limit(1)
        .single()
      if (sub?.current_period_end) {
        periodEnd = sub.current_period_end
      }

      // Self-heal: if period end is stale (past), fetch directly from Stripe
      const isPast = !periodEnd || new Date(periodEnd).getTime() < Date.now()
      if (isPast && hasCredits()) {
        try {
          const { data: custRow } = await supabase
            .from("stripe_customers")
            .select("stripe_customer_id")
            .eq("user_id", userId)
            .single()
          if (custRow?.stripe_customer_id) {
            const { getStripe } = await import("./stripe-client.js")
            const subs = await getStripe().subscriptions.list({
              customer: custRow.stripe_customer_id,
              status: "active",
              limit: 1,
            })
            const activeSub = subs.data[0]
            if (activeSub) {
              const item = activeSub.items.data[0]
              const freshEnd = item
                ? new Date(item.current_period_end * 1000).toISOString()
                : null
              if (freshEnd) {
                periodEnd = freshEnd
                // Self-heal: update DB so we don't hit Stripe again
                const freshStart = item
                  ? new Date(item.current_period_start * 1000).toISOString()
                  : null
                await supabase
                  .from("subscriptions")
                  .upsert({
                    user_id: userId,
                    stripe_subscription_id: activeSub.id,
                    stripe_price_id: activeSub.items.data[0]?.price?.id ?? "",
                    tier: userTier,
                    status: "active",
                    current_period_start: freshStart,
                    current_period_end: freshEnd,
                  }, { onConflict: "stripe_subscription_id" })
                await supabase
                  .from("profiles")
                  .update({ current_period_end: freshEnd })
                  .eq("id", userId)
              }
            }
          }
        } catch (err) {
          // Non-critical: log and continue with stale/null periodEnd
          console.warn("[credits] Stripe subscription self-heal failed:", err)
        }
      }
    }

    return {
      total: subscriptionCredits + topupCredits,
      subscription: subscriptionCredits,
      topup: topupCredits,
      dailySpent,
      dailyLimit,
      monthlyAllocation: tierConfig.monthly_credits ?? 0,
      tier: userTier,
      features: (tierConfig.features as Record<string, unknown>) ?? {},
      periodEnd,
      appCreditsAllowance: profile.app_credits_allowance ?? 0,
    }
  }

  /**
   * Quick eligibility check for app runs (free-tier users only).
   * Returns null if eligible, or an error object if blocked.
   * Paid/topped-up users always pass.
   */
  static async checkAppRunEligibility(userId: string): Promise<{
    allowed: boolean
    error?: string
    appCreditsAllowance?: number
  }> {
    if (creditsDisabled()) return { allowed: true }

    const { data: profile } = await supabase
      .from("profiles")
      .select("tier, subscription_tier, topup_credits, app_credits_allowance")
      .eq("id", userId)
      .single()

    if (!profile) return { allowed: true } // fail open — per-node check will catch

    const userTier = resolveTier(profile as Record<string, unknown>)
    if (userTier !== "free") return { allowed: true }

    const topup = (profile.topup_credits as number) ?? 0
    if (topup > 0) return { allowed: true }

    const allowance = (profile.app_credits_allowance as number) ?? 0
    if (allowance <= 0) {
      return {
        allowed: false,
        error: "You need app credits to run this app. Earn them by running flows in the editor, or upgrade your plan.",
        appCreditsAllowance: allowance,
      }
    }

    return { allowed: true, appCreditsAllowance: allowance }
  }

  /**
   * Get credit cost for a specific model
   */
  static async getModelCreditCost(modelIdentifier: string): Promise<number> {
    const pricing = await getModelCreditCostFromDB(modelIdentifier)
    return pricing.creditCost
  }

  /**
   * Estimate credits for a workflow, reading node data for variable-cost nodes.
   * Mirrors the frontend getModelIdentifier() logic for composite model identifiers.
   */
  static estimateWorkflowCredits(nodes: ReadonlyArray<{ type: string; data?: Record<string, unknown> }>): number {
    return nodes.reduce((sum, node) => {
      const modelId = getNodeModelIdentifier(node)
      return sum + (STATIC_CREDIT_COSTS[modelId] ?? STATIC_CREDIT_COSTS[node.type] ?? 0)
    }, 0)
  }
}

/**
 * Compute composite model identifier from a workflow node for credit estimation.
 * Mirrors frontend getModelIdentifier() in config-panels/helpers.ts.
 */
function getNodeModelIdentifier(node: { type: string; data?: Record<string, unknown> }): string {
  const nodeType = node.type
  const data = node.data ?? {}

  // AI Writer always uses "ai-writer"
  if (nodeType === "ai-writer") return "ai-writer"

  // LLM Chat uses tiered credit identifier based on selected model
  if (nodeType === "llm-chat") {
    const llmModel = data.llmModel as string | undefined
    return buildLlmCreditIdentifier("llm-chat", llmModel)
  }

  // Suno generate/cover/extend use "model" field (V4/V5/V5_5)
  if (nodeType.startsWith("suno-") && nodeType !== "suno-lyrics" && nodeType !== "suno-separate" && nodeType !== "suno-music-video") {
    const m = data.model as string
    if (m === "V5_5") return "suno-v5_5"
    if (m === "V5") return "suno-v5"
    return nodeType
  }

  // Suno separate: "split_stem" costs more
  if (nodeType === "suno-separate") {
    return (data.type as string) === "split_stem" ? "suno-separate-stem" : "suno-separate"
  }

  const provider = data.provider as string | undefined
  if (!provider) return nodeType

  // Extend-video: VEO quality costs more than fast
  if (nodeType === "extend-video" && provider === "veo-extend" && data.model === "quality") {
    return "veo-extend:quality"
  }

  // Motion transfer: duration-tiered pricing
  if (nodeType === "motion-transfer") {
    return buildMotionCreditModelIdentifier(
      provider,
      (data.resolution as string) ?? "720p",
      data.videoDuration as number | undefined,
    )
  }

  // Video nodes with duration/audio-based variable pricing
  if (nodeType === "image-to-video" || nodeType === "text-to-video") {
    const duration = data.duration as number | string | undefined
    const sound = (data.sound ?? data.kling3Sound) as boolean | undefined
    return buildVideoCreditModelIdentifier(provider, duration, sound, nodeType as "image-to-video" | "text-to-video", (data.videoSize ?? data.mode) as string | undefined)
  }

  // Image/edit nodes with quality/resolution variable pricing
  return buildCreditModelIdentifier(
    provider,
    data.quality as string | undefined,
    data.resolution as string | undefined,
    data.renderingSpeed as string | undefined,
    data.targetResolution as string | undefined,
  )
}

// Export legacy function for backward compatibility
export function estimateWorkflowCredits(nodes: ReadonlyArray<{ type: string; data?: Record<string, unknown> }>): number {
  return CreditsService.estimateWorkflowCredits(nodes)
}
