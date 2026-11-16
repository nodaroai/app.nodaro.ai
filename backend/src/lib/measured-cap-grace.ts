/**
 * A step's length cap, with the hair past it its charge forgives. A step whose
 * run measures its input quotes a length at or past its cap at its top row,
 * and holds and charges a file up to its grace past a mark at that mark
 * (`CLIP_PRICE_GRACE_SEC`, 0.05 s, on Video SFX, Pitch & Tempo, Dubbing and
 * Lip Sync; Nemotron's second). So a file up to that grace past the cap — a
 * 300 s cut that measures 300.016 s — is ACCEPTED, held at the top row, and
 * trimmed to the cap before it is sent on (each step's own lever: the seconds
 * a model is asked to score, a cut on the input, the window a dub is given),
 * as the bucketed Lip Sync lane already trims to its cap. Past the grace, the
 * step's own refusal, as before.
 */

/** Float noise: a length that is arithmetic can land a hair past the edge, and must not be refused for it. */
const FLOAT_NOISE_SEC = 1e-9

/** Is a measured length within the step's cap, up to `graceSec` past it forgiven? */
export function withinCapGrace(measuredSec: number, capSec: number, graceSec: number): boolean {
  return measuredSec <= capSec + graceSec + FLOAT_NOISE_SEC
}
