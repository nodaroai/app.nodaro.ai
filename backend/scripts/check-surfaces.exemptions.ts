/**
 * Intended gaps for `npm run check:surfaces`: a surface that a feature (or one
 * of its atoms) deliberately does not offer, with why.
 *
 * This list only shrinks. An exemption that no longer matches a gap is STALE
 * and fails `--strict`, so remove it once the gap is closed. Leave out `atom`
 * to exempt the whole surface for the feature — a reason is required either
 * way. Reasons say why the gap is intended; they are public text (this repo
 * is mirrored), so no names, dates or business numbers.
 *
 * Not listed here because the checker decides them itself: routes in the
 * admin / in-app-only / webhook / self-host / infra / plugin buckets, MCP
 * tools that call no route, local-only CLI commands, and generated docs.
 */
import type { Surface } from "./lib/check-surfaces/types.js"

export interface SurfaceExemption {
  /** Feature id: an SDK property path, `node:<type>`, `route:<segment>` or `_internal`. */
  feature: string
  surface: Surface
  /** `METHOD /v1/path` (parameters as `:p`) or `node:<type>`; omitted = every atom of the feature. */
  atom?: string
  reason: string
}

export const SURFACE_EXEMPTIONS: readonly SurfaceExemption[] = [
  {
    feature: "node:site-capture",
    surface: "node-doc-live",
    reason:
      "new node: the docs-site page is written and published once the node is in production; remove this entry, and the node's AWAITING_DOCS_PAGE row, when the node-docs snapshot is refreshed",
  },
]
