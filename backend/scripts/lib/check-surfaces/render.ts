/**
 * Text rendering of a surface report: one table per feature (a row per atom,
 * a column per surface), or with `--all` one summary line per feature.
 */
import { NODE_COLUMNS, ROUTE_COLUMNS, countGaps } from "./model.js"
import { REPORT_ONLY_SURFACES, type Cell, type FeatureReport, type Surface, type SurfaceReport } from "./types.js"

const MAX_CELL = 30

function clip(s: string, n = MAX_CELL): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** `backend/src/routes/characters.ts:41` → `characters.ts:41`. */
function shortRef(ref: string): string {
  return ref.replace(/(^|\s)(?:[\w.@-]+\/)+([\w.-]+:\d+)/g, "$1$2")
}

export function cellText(surface: Surface, cell: Cell | undefined): string {
  if (!cell) return ""
  switch (cell.status) {
    case "present": {
      const ref = cell.ref ?? ""
      // A route's own row names the route; show where it is registered.
      const first = ref.split(", ")[0]!
      const extra = ref.split(", ").length > 1 ? ` +${ref.split(", ").length - 1}` : ""
      const words = shortRef(first).split(" ")
      const last = words[words.length - 1]!
      const hasRef = words.length > 1 && /:\d+$/.test(last)
      // Routes and docs show where; the other surfaces show the name (`characters list`).
      const label =
        surface === "openapi"
          ? ""
          : surface === "route" || surface.endsWith("doc") || surface === "node-doc-live"
          ? (words.find((w) => /:\d+$/.test(w)) ?? words.join(" ").split("/").pop()!)
          : (hasRef ? words.slice(0, -1) : words).join(" ")
      return clip(`✓ ${label}${extra}`.trimEnd())
    }
    case "missing":
      return "✗"
    case "na":
      return clip(`n/a(${cell.reason ?? ""})`)
    case "report-only":
      return "·"
  }
}

/** The feature's summary; with `surfaces`, gaps are recounted over the shown columns only. */
function summaryLine(f: FeatureReport, surfaces?: readonly Surface[]): string {
  const s = surfaces ? { ...f.summary, ...countGaps(f, surfaces) } : f.summary
  const by = Object.entries(s.gapsBySurface)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(", ")
  return `${s.atoms} atoms · ${s.complete} complete · ${s.gaps} gaps${by ? ` (${by})` : ""} · ${s.exempt} exempt`
}

export function editionLine(edition: SurfaceReport["edition"]): string {
  return edition === "static"
    ? "edition: static (routes/ + ee/routes/, plugin routes classified)"
    : `edition: ${edition} (runtime boot)`
}

export function renderFeature(report: SurfaceReport, f: FeatureReport, surfaces?: readonly Surface[]): string {
  const kind = f.atoms.every((a) => a.kind === "node") ? "node" : "route"
  const columns = (kind === "node" ? NODE_COLUMNS : ROUTE_COLUMNS).filter((c) => !surfaces || surfaces.includes(c))
  const aliases = f.aliases as { sdk?: string; cli?: string[]; mcpFiles?: string[] }
  const alias = aliases.sdk
    ? `   (sdk: ${aliases.sdk} · cli: ${aliases.cli?.join(", ") || "—"} · mcp: ${aliases.mcpFiles?.join(", ") || "—"})`
    : ""
  const rows: string[][] = [["atom", ...columns]]
  for (const a of f.atoms) {
    const label = `${a.key}${a.bucket !== "public" ? ` [${a.bucket}]` : ""}`
    rows.push([label, ...columns.map((c) => cellText(c, a.surfaces[c]))])
  }
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => [...r[i]!].length)))
  const table = rows.map((r) => r.map((c, i) => c + " ".repeat(widths[i]! - [...c].length)).join("  ").trimEnd())
  const reportOnly = columns.filter((c) => REPORT_ONLY_SURFACES.has(c))
  return [
    `Feature: ${f.id}${alias}`,
    editionLine(report.edition),
    "",
    ...table,
    "",
    `Summary: ${summaryLine(f, surfaces)}${reportOnly.length ? ` · ${reportOnly.join(", ")} report-only` : ""}`,
  ].join("\n")
}

export function renderAll(report: SurfaceReport, extras: string[] = []): string {
  const lines = [editionLine(report.edition), ""]
  const width = Math.max(...report.features.map((f) => f.id.length))
  const ordered = [
    ...report.features.filter((f) => f.id !== "_internal"),
    ...report.features.filter((f) => f.id === "_internal"),
  ]
  for (const f of ordered) lines.push(`${f.id.padEnd(width)}  ${summaryLine(f)}`)
  const total = report.features.reduce(
    (acc, f) => ({ atoms: acc.atoms + f.summary.atoms, gaps: acc.gaps + f.summary.gaps }),
    { atoms: 0, gaps: 0 },
  )
  lines.push("", `${report.features.length} features · ${total.atoms} atom rows · ${total.gaps} gaps (an atom shared by several features is counted in each)`)
  const u = report.unmapped
  lines.push(
    "",
    `Unmapped SDK properties: ${u.sdkProps.join(", ") || "none"}`,
    `Unmapped CLI groups: ${u.cliGroups.join(", ") || "none"}`,
    `Unmapped route prefixes: ${u.routePrefixes.join(", ") || "none"}`,
    `Stale exemptions: ${report.staleExemptions.join("; ") || "none"}`,
    ...extras,
  )
  return lines.join("\n")
}
