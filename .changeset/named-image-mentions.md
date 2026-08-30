---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

feat(prompts,shared): named-image mentions — `@<name-slug>:<index>[:<role>]`

A wired image (`wired-image` / `manual` reference) can now be addressed inline by
the slug of its name — an upload node's label on the canvas, or the name a thin
client puts on the reference — the same way characters and locations already are.
`@town:3` renders the reference's binding at the position it was typed
(`reference image C`); `@town:3:background` renders the role phrase
(`the background from reference image C`). Model-facing rendering is unchanged:
lettered bindings on the image path.

- `@nodaro/shared` gains `imageMentionSlug`, `parseImageMentionToken`,
  `findImageMentionTokens`, `knownImageSlugsFromRefs` and the
  `ImageMentionTokenInfo` type. This is a DELIBERATE give-away to the public
  tier: the SDK and every thin client must share one grammar with the resolver,
  so the parser lives in `shared` while all prompt-assembly logic stays in
  `@nodaro/prompts`. Grammar is 2–3 segments (no variants, no buckets, no usage
  modes) plus the additive `~lock` / `~nolock` sentinel; a 4-part token is never
  claimed, so an unresolved character mention (`@kira:1:smile:face`) can never be
  mis-captured as a 3-part image mention with `:face` left dangling. No new
  `ConnectedReference` field — the slug derives from `defaultName`, so nothing
  changes on the wire and the reference schema is untouched.
- `toConnectedReference` gains `kind: "image"`, the SDK interface point for a
  thin client binding an uploaded image.
- `buildImagePrompt` resolves image mentions as Phase-0 pass 3, after characters
  and locations. Pass order is precedence: a name shared with a character
  resolves as the character. Duplicate image slugs bind first-wins, matching
  `buildTileIdForUrl` — every unrenamed upload node shares its default label, so
  ties are the common case rather than an edge.
- HYBRID only. Under the legacy reference format an `@name:N` token stays literal
  text and the reference attaches exactly as before, so
  `IMAGE_REFERENCE_FORMAT=legacy` reverts the feature entirely.

No prompt text changed for any prompt that carries no `@<image-name>` mention:
the Phase-0 arm is gated on TOKEN presence rather than slug presence, so an
unmentioned graph never enters the mention path and its prompt and
`referenceImageUrls` are byte-identical. Prompts that DO carry a mention
intentionally re-seat that reference's letter — its URL moves from the trailing
auto-attach block into the mention block, which re-letters everything after it.
That is the point of the feature, not a regression.

A capped-out reference degrades silently: `imageReferenceLimit(provider)`
truncates `connectedReferences` before Phase 0, so a mention whose reference was
capped out falls through as literal text — matching how a capped character
mention behaves today.
