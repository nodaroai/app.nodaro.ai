---
"@nodaro/prompts": minor
---

Resolve creature and object `@-mentions` inline, and suppress their trailing
canonical fallback.

`buildImagePrompt`'s hybrid Phase 0 gains a wired-entity pass that runs after
the character, location and image passes — precedence `character → location →
image → creature → object`, enforced by pass order plus a creature-first slug
map, so a name claimed by an earlier kind never reaches a later one.

A mentioned `wired-creature` / `wired-object` renders its role phrase INLINE at
the typed position ("the creature from reference image D"), takes its role from
the token's 3rd segment → the node's `defaultRole` → the source default, honors
the `~lock` / `~nolock` sentinels, and carries its identity-lock line and
`elementInjection` exactly once. The bound URLs are fed to
`renderObjectCreatureCanonicalHybrid`'s covered set, so the reference no longer
renders a second time as a dangling trailing line after the style hints — the
double-render this leg exists to remove.

The pass is gated on token presence, so every mention-free prompt keeps its
exact branch and byte output, and the legacy reference format is untouched
(an `@name:N` token stays literal text and the entity attaches as it does today).

Like the character, location and named-image resolvers, the entity pass splices
through `spliceMentionPhrase`, so an entity chip's own trailing space cannot
leave a doubled space at the seam where the model is being told what the
reference is.
