import { z } from "zod"
import {
  MAX_SUBJECT_KEYS,
  SUBJECT_ARRAY_CEILING,
  SUBJECT_ID_MAX_CHARS,
  SUBJECT_KEY_MAX_CHARS,
  normalizeSubjectFields,
  type SubjectFields,
} from "@nodaro/prompts"

/**
 * Route-level Zod door for `@nodaro/prompts` `SubjectFields` — the flat SUBJECT
 * id channel (Person, Styling, and the `heldProp` / `material` / `animal`
 * props) that Studio, the MCP route and canvas node data all speak. The
 * companion of `direction-schema.ts`, and deliberately its structural twin
 * wherever the two channels are alike.
 *
 * ONE schema for every surface that takes subject: `/v1/generate-image`,
 * `/v1/generate-video` and `/v1/text-to-video` import it unchanged.
 * `/v1/extend-video` deliberately does not — its prompt continues an existing
 * clip, where re-stating who is in it is the wrong lever, exactly as with
 * direction. Surface is a RENDER concern (`renderSubjectHints` skips off-surface
 * rows), not a wire concern.
 *
 * A `z.record`, NOT the derived `z.object` direction uses, and the difference is
 * forced rather than stylistic: Person is pack-aware
 * (`getRegisteredPersonFieldByDimension`), so the key set is not build-time
 * knowable. A fixed `z.object` combined with the deliberately NON-strict posture
 * would silently DROP every deployment-registered pack dimension — the exact
 * failure the pack seam exists to prevent.
 *
 * SAME THREE TOLERANCES as direction, all load-bearing:
 *  1. unknown keys are not a 400 — a NEWER client on an OLDER API loses those
 *     hints QUIETLY rather than erroring, which is why platform-first deploy
 *     ordering is load-bearing rather than a nicety;
 *  2. every key accepts `string | string[]` up to a flat ceiling, with the
 *     per-dimension cap applied by the normalizer rather than rejected — a
 *     client that stored 3 ids on a 2-pick dimension keeps running (top 2 win);
 *  3. NO `.min(1)` on an id — the empty string is realistic stored input and
 *     the renderer drops it, so rejecting it would be a new 400 on input a real
 *     client sends.
 *
 * TWO BOUNDS ARE DELIBERATELY *NOT* TOLERANT, matching direction exactly: an
 * array longer than `SUBJECT_ARRAY_CEILING` and an id longer than
 * `SUBJECT_ID_MAX_CHARS` are 400s. Both constants ARE the direction constants
 * (`@nodaro/prompts` defines one as the other), shared with the persisted-node
 * reader (`readSubjectFields`) rather than re-typed per door: a body this route
 * accepts and the same node re-run from the canvas must not disagree about
 * which strings are ids. Two record-shaped bounds join them — a cap on the
 * NUMBER of keys (`MAX_SUBJECT_KEYS`, which `z.record` cannot express in its
 * type and so is enforced by refinement) and on the LENGTH of a key.
 *
 * THE NUMBER ARM is for `customAge` — the one non-id value in the vocabulary
 * (the literal age in years, read only when `age === "age-custom"`). A record
 * cannot type one key differently from the rest, so a number is accepted on any
 * key and is simply inert everywhere else: the renderer reads numbers from that
 * key alone. Range is CLAMPED (0..120) by the normalizer, not rejected —
 * tolerance for input someone plausibly sent.
 *
 * THE `.transform` IS PART OF THE CONTRACT, not a convenience: `z.record` cannot
 * strip unknown keys the way a non-strict `z.object` does, and the parsed body
 * is what lands verbatim in `jobs.input_data`. Normalizing AT THE DOOR keeps
 * that record in the platform's own vocabulary and equal to what actually folds.
 * `renderSubjectHints` normalizes again internally — the function is idempotent,
 * and the renderer must not depend on any door having run first.
 */

const subjectValue = z.union([
  z.string().max(SUBJECT_ID_MAX_CHARS),
  z.array(z.string().max(SUBJECT_ID_MAX_CHARS)).max(SUBJECT_ARRAY_CEILING),
  z.number(),
])

export const subjectSchema = z
  .record(z.string().max(SUBJECT_KEY_MAX_CHARS), subjectValue)
  .refine((v) => Object.keys(v).length <= MAX_SUBJECT_KEYS, {
    message: `subject carries more than ${MAX_SUBJECT_KEYS} keys`,
  })
  // `?? {}` rather than `?? undefined`: a bag whose every key was unknown still
  // means the caller asked for structured assembly, and the route's
  // structured-mode detection runs on the RAW body in the pricing preHandler and
  // on the PARSED body in the handler. Returning `undefined` here would make
  // those two disagree; an empty bag renders to no clauses, so the assembled
  // prompt is identical either way.
  .transform((v) => normalizeSubjectFields(v as SubjectFields) ?? {})
