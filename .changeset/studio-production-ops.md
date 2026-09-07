---
"@nodaro/shared": minor
---

**@nodaro/shared** — the WRITE protocol of `/v1/studio/productions`, as types.

`studio-production-wire.ts` already carried what those routes RETURN. This adds
what they take: `StudioProductionOp`, the discriminated union of every semantic
operation a studio production accepts — the twelve document sections plus
`land_job` — with `StudioProductionOpName`, `StudioOpOf<K>` and the `S | D | P |
$` confirmation class every dispatcher reads before it acts.

Operations rather than a JSON Patch or a whole-document PUT, because the editor,
an MCP agent and the copilot hold the same production open at once: an operation
addresses by stable KEY (shot, folder, cut and bin ids; a result by its job id
or url) and never by position, so a batch composed against a slightly older
document still applies correctly on the newest one.

Types only, and the document's own sub-objects stay opaque here. The schemas,
the handlers and `applyOps` live in the FSL-licensed
`@nodaro/studio-production`, which narrows every payload to its real type and
pins its union against this one at build time, so the two cannot drift.
