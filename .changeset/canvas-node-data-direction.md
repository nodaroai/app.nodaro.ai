---
"@nodaro/prompts": minor
---

feat(assemble-image-input): the canvas executors honor a node's stored `direction` / `structured`.

`readDirectionFields` / `readStructuredFields` are new public exports: narrow,
throw-free readers that turn untrusted persisted node data into the typed levers
`assembleImageInput` already accepts. `readDirectionFields` iterates the
direction registry, so a dimension added there is honored by construction, and
it accepts `string | string[]` on every key, bounded by the SAME two constants
the wire schema enforces — `DIRECTION_ID_MAX_CHARS` (also a new export) and
`DIRECTION_ARRAY_CEILING`, imported rather than re-typed per door, so a body the
route accepts and the same node re-run from the canvas cannot start disagreeing
about which strings are ids. Bounding cardinality is load-bearing, not hygiene:
node data is validated only as `z.record(z.string(), z.unknown())` on write, and
`renderDirectionHints` de-dupes with an `includes` scan, so an unbounded stored
array would put quadratic work in front of the per-dimension slice — for the
orchestrator, on every payload build. `renderDirectionHints` now also stops
scanning a key once `maxPicks` unique ids are in hand (same output, linear
cost). `readStructuredFields` validates field by field, which is what keeps junk
from rendering verbatim into the recorded prompt. The frontend single-node executor, the orchestrator's
`generate-image` payload builder, and the config-panel final-prompt preview all
read through them, so a graph that carries picker IDS (rather than baked hint
text) folds identically on every path and stays editable on the canvas.

No prompt text changed for a node that carries no `direction` / `structured`
key — which is every workflow authored before this release: `composePromptText`
still returns such a prompt verbatim and untrimmed, and the platform-caller
parity fixtures are unchanged. A node that DOES carry them is trimmed and
`". "`-joined, additively with the hints from any wired Framing/Lighting/Style
picker node, and is not gated by the node's Inject Look switch (that switch
documents wired handles; stored direction is node-local look data like `style`).
