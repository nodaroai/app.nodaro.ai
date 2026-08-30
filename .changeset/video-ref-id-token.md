---
"@nodaro/prompts": minor
"@nodaro/shared": minor
---

feat(video): `{ref:<id>}` / `{ref:<id>:<label>}` — address a video reference by its own id.

A caller that passes `connectedReferences` to the video routes can now name a reference in the `prompt` by the `id` it gave that entry, and the platform substitutes the `@image_N` seat after it has numbered the references. Until now a client that wanted the binding inline had to compute `N` itself — a client-side mirror of the platform's numbering walk (flat refs → mentioned characters → unmentioned wired characters → the rest, bounded by the provider's image cap) that silently misbound pictures the moment the walk changed.

- `resolveVideoReferenceCore` records each reference's seat as it numbers (`id → @image_N`) and resolves `{ref:<id>}` tokens against that map — before the `referenceOrder` reorder, so the binding follows the reference to its final seat. `{image:N}` / `{video:N}` / `{audio:N}` are unchanged: still resolved after the reorder, still keeping the author's literal `N`.
- Ids are opaque and may contain `:` and `/`; they are matched by identity against the known ids, never parsed by character class. The optional `:<label>` uses the same label class as `{image:N:label}` and renders `the <label> from @image_N`.
- A token never ships raw: an unknown id, a reference the walk skipped, one the provider cap dropped, or a provider without image-reference support degrades to the label, else the reference's display name, else nothing. New core input `refNamesById` lets a caller supply names for references it capped out before the walk; new exported `resolveRefIdTokens` is the standalone resolver.
- `VideoExtraRef.id` (prompts) and `ExtraRefInput.id` (shared) carry the row id through to the slot map. Additive: extras without an id number exactly as before.
- No output changes for prompts that carry no `{ref:` token.
