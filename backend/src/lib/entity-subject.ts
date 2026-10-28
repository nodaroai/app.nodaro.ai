import {
  renderSubjectHints,
  SUBJECT_IMAGE_HINT_MODE_DEFAULT,
  type SubjectFields,
} from "@nodaro/prompts/prompt-builder"

/**
 * The clauses a request's `subject` (Person / Styling / prop catalog ids —
 * `subjectSchema`, the same door `/v1/generate-image` uses) adds to an ITEM
 * route's prompt: `/v1/generate-character` and `/v1/generate-creature`.
 *
 * ONE call for every item route, so the words a pick becomes are written in
 * exactly one place (`renderSubjectHints`, the renderer the image and video
 * routes fold with) and a client never phrases a pick itself. Same surface and
 * verbosity as `/v1/generate-image` (`assembleImageInput`): a Keepers shelf
 * and a Create Image tile given the same ids render the same clauses.
 *
 * The item routes have no provider prompt cap and so no shed machinery; the
 * clauses are handed to the route's own prompt builder, which places them in
 * its hint slot (after the prose, before the studio scaffolding). Unknown keys
 * and unknown ids contribute nothing, as on every other door.
 */
export function renderEntitySubjectHints(subject: SubjectFields | undefined): string[] {
  return renderSubjectHints(subject, { surface: "image", mode: SUBJECT_IMAGE_HINT_MODE_DEFAULT })
}
