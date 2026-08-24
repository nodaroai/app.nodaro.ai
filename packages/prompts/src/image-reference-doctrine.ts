/**
 * Reference-image prompting doctrine for IMAGE generation — the single source
 * of truth for the `{image:N:label}` token idiom on `generate-image`. Consumed
 * by backend/scripts/gen-skills (the `image-reference-prompting` block in the
 * generate-image node skill), the same way `PROVIDER_PROMPT_DOCTRINES` feeds
 * the video node skills.
 *
 * Unlike the per-provider video doctrines, this is a PLATFORM mechanism: the
 * token grammar and expansion are Nodaro's own (`prompt-builder.ts` —
 * `IMAGE_TOKEN_PATTERN`, `expandImageRefTokens`), so there is one doctrine,
 * not one per model family.
 *
 * Source of truth for the semantics documented here (verified 2026-08-25):
 * - `IMAGE_TOKEN_PATTERN` = `/\{image:(\d+)(?::([^}\n]+))?\}/gi`
 * - `expandImageRefTokens`: `{image:N:label}` → `Image N (label)`,
 *   `{image:N}` → `Image N`; out-of-range tokens are left untouched so the
 *   author can see and fix them.
 * - N is the reference's 1-based position in the assembled reference list
 *   (connection order on the `references` handle).
 */

export interface ImageReferenceDoctrine {
  /** Human heading for skill docs. */
  readonly heading: string
  /** Full markdown doctrine for generated skill docs. */
  readonly doctrine: string
}

export const IMAGE_REFERENCE_PROMPT_DOCTRINE: ImageReferenceDoctrine = {
  heading: "Reference-image prompting ({image:N:label} tokens)",
  doctrine: `The \`references\` handle takes MULTIPLE image producers (upload-image, generate-image, …) wired into one generate-image node. Connection order is the numbering: the first-connected reference is 1. The prompt then binds them with tokens:

- \`{image:N:label}\` → expands server-side to \`Image N (label)\`, aligned with the numbered reference list sent to the provider.
- \`{image:N}\` → \`Image N\` (no role named).
- A token whose N has no wired reference is left as literal text in the final prompt — visible on purpose, so fix the numbering instead of ignoring it.

**How to compose**
- The prompt should be little more than tokens plus glue words: \`{image:1:person} with {image:2:face}\`. The label tells the model what to TAKE from that image — \`person\`, \`face\`, \`background\`, \`settings\`, or a concrete garment/prop name (\`jacket\`).
- Order = priority. Put the identity-critical image first. Swapping the numbers (or the labels) swaps the result — \`{image:2:person} with {image:1:face}\` transplants in the opposite direction.
- Do NOT re-describe what a referenced image already shows; a sentence fighting the reference degrades adherence. Add only what is NEW (pose, lighting, scene) — or better, reference it from another image.

**Core patterns (each is one generate-image node with two wired references)**
- Identity transplant: \`{image:1:person} with {image:2:face}\` — body/outfit/scene from 1, face from 2.
- Reverse transplant: \`{image:2:person} with {image:1:face}\` — same two references, opposite result.
- Keep the stage, change the star: \`{image:1:background} with {image:2:person}\`.
- Relocation: \`{image:1:person} in {image:2:settings}\`.
- Garment transfer: \`{image:1:person} Wearing {image:2:jacket} on top, at {image:2:settings}\` — several labels can pull different things from the SAME image.

**Providers & settings**
- Multi-reference composition is strongest on the GPT-Image family (\`gpt-image-2\`) and the Nano Banana family (\`nano-banana-pro\`). Check a model's reference support via \`list_models\` before relying on more than one reference.
- Set an explicit \`aspectRatio\` and prefer \`resolution: "2K"\` for composites — face detail survives the merge better.

**Known pitfall**
- Person+face composition intermittently trips provider content filters ("Content policy violation"). Keep wording neutral (no glamor/body emphasis), and on a rejection rephrase the glue words or swap provider rather than retrying unchanged.`,
}
