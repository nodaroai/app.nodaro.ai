// tools/units/capabilities.mjs
// The closed list of manifest `capabilities`. A capability is a declarative
// membership a central seam consumes ("finalize-media" → the job-finalize
// media set, "length:pass-video" → the video-output-length rule). Each entry
// names the ONE seam (tools/units/seams.mjs) that reads it, so an unknown
// capability fails validation and a new one needs a reviewed seam first.
//
// Empty until the first seam that reads one goes live (PR1b adds the pilot's:
// ffmpeg-media, finalize-media, length:pass-video, panel:video-processing).
// Shape: { "<capability>": { seam: "<seam id>", why: "<what the seam does with it>" } }
export const CAPABILITIES = {}
