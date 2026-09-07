/**
 * `Production` — the parsed document every operation reads and rewrites.
 *
 * It is exactly what {@link parseProduction} returns: the shots in timeline
 * order plus the production-level layers (`cast`, `film`, `folders`, `cuts`,
 * `trash`, `storyboard`, `music`, `musicPlan`, `archived`, `selectedShotId`,
 * `freecutDraftUrl`). Naming the return type rather than restating it is
 * deliberate — the codec stays the single source of truth for the document's
 * shape, and a field added there reaches every handler without an edit here.
 *
 * NOT in it: `id`, `name`, `version`, `thumbnailUrl`, `shared`. Those are
 * columns on the workflow ROW, not `settings.studio`. Two operations address
 * them anyway (`set_name`, `set_thumbnail`) and hand the write to the route
 * through the receipt's `row` field — see `SECTIONS.md`, section 1.
 *
 * Copy-on-write: a handler returns a NEW production and never mutates the one
 * it was handed. The store's re-render, `applyOps`'s atomicity (an op that
 * throws must leave the input untouched) and the outbox replay all rest on it.
 */
import type { parseProduction } from "../shot-graph"

export type Production = ReturnType<typeof parseProduction>
