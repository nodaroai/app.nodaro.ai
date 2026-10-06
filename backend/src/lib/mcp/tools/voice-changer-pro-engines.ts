/**
 * The per-voice `engine` values of Voice Changer Pro — the Cloud plugin
 * route's `recastVoice.engine` enum (`nodaro-cloud-plugins`, `route.ts`),
 * mirrored once here for the MCP tool schema.
 *
 *  - `"sts"` — the default speech-to-speech recast.
 *  - `"v3"`  — Re-speak: the performance is regenerated from the transcript
 *              (stability 0 / 0.5 / 1 only).
 *  - `"v4"`  — Re-speak on the newer model: any stability 0–1, similarity
 *              honoured, each line generated with its neighbours as context.
 *
 * Adding a value here before the pinned plugin accepts it turns every such
 * call into a 400 — the schema would let it through and the plugin's route
 * would refuse it after the fact. Release order: plugin first, then this.
 */
export const VOICE_CHANGER_PRO_ENGINES = ["sts", "v3", "v4"] as const

export type VoiceChangerProEngine = (typeof VOICE_CHANGER_PRO_ENGINES)[number]
