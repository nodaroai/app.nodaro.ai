/**
 * Node types whose output carries Suno chaining ids (`sunoTrackId` /
 * `sunoTaskId`) for a downstream Suno node (extend / separate / replace /
 * add-vocals / …) to chain off.
 *
 * One set for the three readers — the canvas resolver, the orchestrator
 * resolver, and the config panels' "Inherited" hint (#819). They used to keep
 * their own copies and drifted: the canvas read ids off a `suno-separate`
 * (whose output is stems, not a track) while the orchestrator ignored it, so
 * the same graph resolved on one path and not the other. Structural
 * vocabulary only — node type names, no prompt content.
 */
export const SUNO_TRACK_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "suno-mashup",
  "suno-replace-section",
  "suno-add-instrumental",
  "suno-add-vocals",
  "suno-convert-wav",
  "suno-upload-extend",
])
