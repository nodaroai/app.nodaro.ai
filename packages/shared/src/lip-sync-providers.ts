/**
 * The Lip Sync node's models — its route's accepted values, the model tree's
 * lip-sync branch and the catalog's lip-sync model list all read this one
 * list. A leaf module (no imports), so the catalog can read it without the
 * import cycle `model-constants.ts` would make; `model-constants.ts`
 * re-exports it.
 */
/** Lip sync providers */
export const LIP_SYNC_PROVIDERS = [
  "kling-avatar",
  "kling-avatar-pro",
  "infinitalk",
  // ByteDance OmniHuman 1.5 — KIE image+audio avatar, prompt-directed
  // performance, per-second billed, 60s audio cap. Routes the default KIE
  // path (not in any replicate/fal/seedance/video-input set).
  "omnihuman-1-5",
  // ByteDance OmniHuman 2.0 — a different model from 1.5 (no speaker mask, no
  // resolution choice, no fast mode, no seed; 720p output). KIE image+audio
  // avatar on the default KIE path, charged per second of its audio at a rate
  // (LIP_SYNC_AUDIO_RATES), never by bucket.
  "omnihuman-2-0",
  "latentsync",
  // (Wav2Lip, VideoReTalking and SadTalker were retired 2026-11-12:
  // RETIRED_LIP_SYNC_PROVIDERS below.)
  // HeyGen Lipsync Precision + Sync Lipsync 2 Pro — Replicate-hosted, video-input
  // dubbing models billed per second of output. Routed through replicateLipSync;
  // priced per-second via buildLipSyncCreditId (see lip-sync-pricing.ts).
  "heygen-lipsync-precision",
  "lipsync-2-pro",
  // Sync Lipsync v3 — fal.ai-hosted, video-input dubbing model billed per
  // second of output (/min). Routed through falLipSync (the worker's fal
  // branch); priced per-second via buildLipSyncCreditId (see lip-sync-pricing.ts).
  "sync-lipsync-v3",
  // Volcengine video-to-video lip sync — KIE-hosted, VIDEO-input AI dubbing
  // (mode lite/basic; multi-speaker scene-detection + speaker ID in basic).
  // Billed per-second via buildLipSyncCreditId; routed through the KIE
  // `lipSyncVideo` path (KieModelConfig.inputKind === "video"), NOT the
  // image+prompt `lipSync` path.
  "volcengine-lipsync",
  // Seedance 2 / 2 Fast — not "lip-sync models" per se, but ByteDance's
  // multimodal video models do native phoneme-level lip sync in 8+
  // languages when fed `reference_audio_urls` alongside a `first_frame_url`.
  // Routed through the i2v provider with the audio passed as a reference,
  // not the dedicated lip-sync flow.
  "seedance-2",
  "seedance-2-fast",
  "seedance-2-mini",
  "seedance-2-5",
  "seedance-2-5-flash",
  // MiniMax Hailuo 3 — same multimodal audio-driven mechanism (r2v
  // reference_audio_urls paired with an image ref); rides the same
  // reference-audio lip-sync surface as the Seedance 2 family.
  "minimax-h3",
  // LTX 2.5 Fast — its audio-to-video endpoint (catalog `drivingAudio`) makes
  // a talking clip from a portrait and the voice line, as long as the voice
  // (decided 2026-11-23). Priced and sent by the same rule as Generate Video's
  // audio-to-video run (`driving-audio.ts`): never one of the lanes above.
  "ltx-2.5-fast",
] as const
export type LipSyncProvider = typeof LIP_SYNC_PROVIDERS[number]
