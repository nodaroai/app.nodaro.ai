/**
 * The model the surface checker reports on.
 *
 * An ATOM is one thing a user can reach: a REST route (`METHOD /v1/path`, every
 * parameter collapsed to `:p`) or a node type. A FEATURE is a named group of
 * atoms (an SDK resource, a node, a route-only family). Each atom gets one CELL
 * per surface: present (with where), missing, not applicable (with why), or a
 * report-only column with nothing there.
 */

export const SURFACES = [
  "route",
  "openapi",
  "sdk",
  "sdk-doc",
  "cli",
  "cli-doc",
  "mcp",
  "mcp-doc",
  "api-doc",
  "node-doc",
  "node-doc-live",
] as const
export type Surface = (typeof SURFACES)[number]

/** Columns whose absence is never a gap: the OpenAPI spec is a curated subset. */
export const REPORT_ONLY_SURFACES: ReadonlySet<Surface> = new Set<Surface>(["openapi"])

export type CellStatus = "present" | "missing" | "na" | "report-only"

export interface Cell {
  status: CellStatus
  /** Where it was found: `path:line`, or a name (`characters.list`) plus where. */
  ref?: string
  /** For `na`: why the surface does not apply. For `missing`, an optional hint. */
  reason?: string
}

export type AtomKind = "route" | "node"

/** Why a route is not scored on every surface. `public` routes are. */
export type RouteBucket =
  | "public"
  | "admin"
  | "in_app_only"
  | "webhook"
  | "selfhost"
  | "infra"
  | "plugin"

export interface Atom {
  /** `GET /v1/characters/:p`, or `node:generate-image`. */
  key: string
  kind: AtomKind
  bucket: RouteBucket
  /** Set when the route takes no credential (a label only). */
  anonymous?: boolean
  surfaces: Partial<Record<Surface, Cell>>
}

export interface FeatureSummary {
  atoms: number
  complete: number
  gaps: number
  gapsBySurface: Partial<Record<Surface, number>>
  exempt: number
}

export interface FeatureReport {
  id: string
  aliases: Record<string, unknown>
  atoms: Atom[]
  summary: FeatureSummary
}

export interface SurfaceReport {
  version: 1
  edition: "static" | "cloud" | "community"
  generatedFrom: string
  features: FeatureReport[]
  unmapped: { sdkProps: string[]; cliGroups: string[]; routePrefixes: string[] }
  staleExemptions: string[]
}
