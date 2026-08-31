---
"@nodaro/shared": minor
---

Creature and object `@-mention` grammar.

`wired-creature` and `wired-object` references gain the same name-addressed
mention grammar the named-image reference already had —
`@<name-slug>:<index>[:<role>][~lock|~nolock]` — through a new
`entity-mention-slug` surface: `entityMentionSlug`, `parseEntityMentionToken`,
`findEntityMentionTokens`, `entityMentionSlugForRef`, `knownEntitySlugsFromRefs`
and the `EntityMentionTokenInfo` type.

The grammar itself — slug shape, parser, finder and both collision guards (the
4-part trailing reject that stops a character token being mis-claimed, and the
slash guard that stops a location bucket token being spliced as a truncated
prefix) — is factored into one internal core shared with the named-image
grammar, so those guards exist in exactly one place. Every existing
image-mention export keeps its signature and behavior.
