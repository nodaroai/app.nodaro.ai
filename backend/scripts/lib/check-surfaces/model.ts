/**
 * Joins the per-surface inventories into features of atoms with one cell per
 * surface (types.ts), applies the exemptions, and summarizes.
 *
 * Pure: every input is passed in, so the golden tests build a model from
 * hand-made inventories without booting anything.
 */
import { NODE_TYPES_WITHOUT_RUN_ROUTE, nodeRunRoute } from "@nodaro/shared"
import type { SurfaceExemption } from "../../check-surfaces.exemptions.js"
import type { CliInventory } from "./cli.js"
import type { ApiDocMention, NodeDocs, SdkDocs } from "./docs.js"
import { FEATURE_ALIASES, LOCAL_CLI_GROUPS, ROUTE_ONLY_FAMILIES, isPluginPath, ownerByPrefix } from "./features.js"
import type { McpInventory } from "./mcp.js"
import type { Classifier, RouteEntry } from "./routes.js"
import type { SdkInventory } from "./sdk.js"
import {
  REPORT_ONLY_SURFACES,
  type Atom,
  type Cell,
  type FeatureReport,
  type RouteBucket,
  type Surface,
  type SurfaceReport,
} from "./types.js"

export interface NodeInfo {
  type: string
  category: string
}

export interface ModelInputs {
  edition: SurfaceReport["edition"]
  sha: string
  routes: RouteEntry[]
  classify: Classifier
  openapi: Set<string> | null
  sdk: SdkInventory
  sdkDocs: SdkDocs
  cli: CliInventory
  cliDocs: Map<string, string>
  mcp: McpInventory
  mcpDocs: Map<string, string>
  apiDocs: Map<string, ApiDocMention>
  nodes: NodeInfo[]
  /** Node type → the MCP tool that runs it. */
  nodeTools: Readonly<Record<string, string>>
  /** Parameter (picker) node types: read from the graph, never run. */
  parameterTypes: ReadonlySet<string>
  nodeDocs: NodeDocs
  exemptions: readonly SurfaceExemption[]
}

/** Node categories whose nodes run inside the workflow engine, with no route of their own. */
export const ENGINE_ONLY_CATEGORIES: ReadonlySet<string> = new Set(["input", "trigger", "output", "control", "utility", "entity"])

export const ROUTE_COLUMNS: readonly Surface[] = ["route", "openapi", "sdk", "sdk-doc", "cli", "cli-doc", "mcp", "mcp-doc", "api-doc"]
export const NODE_COLUMNS: readonly Surface[] = ["route", "openapi", "sdk", "sdk-doc", "cli", "cli-doc", "mcp", "mcp-doc", "node-doc", "node-doc-live"]

const present = (ref: string): Cell => ({ status: "present", ref })
const missing = (reason?: string): Cell => (reason ? { status: "missing", reason } : { status: "missing" })
const na = (reason: string): Cell => ({ status: "na", reason })

function splitKey(key: string): { method: string; path: string } {
  const i = key.indexOf(" ")
  return { method: key.slice(0, i), path: key.slice(i + 1) }
}

/**
 * Whether a caller's `method path` can name the route `key`. One-way: only a
 * `:p` in the KEY is a wildcard. A caller's unresolved `:p` never binds to a
 * key's literal segment (`GET /x/:p` is not `GET /x/capabilities`).
 */
const matches = (method: string, path: string, key: string): boolean => {
  const k = splitKey(key)
  if (method !== "?" && method !== k.method) return false
  const a = path.split("/")
  const b = k.path.split("/")
  return a.length === b.length && a.every((s, i) => s === b[i] || b[i] === ":p")
}

/** A generic node dispatch (`POST /v1/:p`) names no route of its own. */
const isGeneric = (path: string) => /^\/v1\/:p$/.test(path)

/**
 * A feature's gaps counted over `surfaces` only (every surface when omitted);
 * report-only columns never count. The summary line and `--strict` both use
 * this, so a run filtered with `--surfaces` judges only what it shows.
 */
export function countGaps(
  f: FeatureReport,
  surfaces?: readonly Surface[],
): { gaps: number; complete: number; gapsBySurface: Partial<Record<Surface, number>> } {
  const gapsBySurface: Partial<Record<Surface, number>> = {}
  let gaps = 0
  let complete = 0
  for (const a of f.atoms) {
    let atomGaps = 0
    for (const [s, cell] of Object.entries(a.surfaces) as Array<[Surface, Cell]>) {
      if (cell.status !== "missing" || REPORT_ONLY_SURFACES.has(s) || (surfaces && !surfaces.includes(s))) continue
      atomGaps++
      gapsBySurface[s] = (gapsBySurface[s] ?? 0) + 1
    }
    if (!atomGaps) complete++
    gaps += atomGaps
  }
  return { gaps, complete, gapsBySurface }
}

/** Whether `--strict` fails: a gap on a shown surface of a selected feature, or any stale exemption. */
export function strictFails(features: readonly FeatureReport[], staleExemptions: readonly string[], surfaces?: readonly Surface[]): boolean {
  return staleExemptions.length > 0 || features.some((f) => countGaps(f, surfaces).gaps > 0)
}

export function buildModel(inp: ModelInputs): SurfaceReport {
  // ---- route atoms --------------------------------------------------------
  const registered = new Map<string, RouteEntry>()
  for (const r of inp.routes) if (!registered.has(`${r.method} ${r.path}`)) registered.set(`${r.method} ${r.path}`, r)
  const atomKeys = new Set(registered.keys())
  /**
   * The atom a caller's `method path` joins: the exact key; else, for an
   * unknown method (`?`), the same path on any method; else a REGISTERED route
   * whose `:p` segments take the caller's literals. Only registered routes are
   * matched loosely, so two unregistered spellings (plugin routes, docs-only
   * paths) join only when identical, never by insertion order.
   */
  const findAtom = (method: string, path: string): string | undefined => {
    const exact = `${method} ${path}`
    if (atomKeys.has(exact)) return exact
    if (method === "?") {
      const samePathKey = [...atomKeys].find((k) => splitKey(k).path === path)
      if (samePathKey) return samePathKey
    }
    return [...registered.keys()].find((k) => matches(method, path, k))
  }
  const addAtom = (method: string, path: string): string | undefined => {
    if (isGeneric(path)) return undefined
    const found = findAtom(method, path)
    if (found) return found
    if (method === "?") return undefined
    atomKeys.add(`${method} ${path}`)
    return `${method} ${path}`
  }

  const sdkByAtom = new Map<string, string[]>()
  for (const m of inp.sdk.methods.values()) {
    for (const r of m.routes) {
      const key = addAtom(r.method, r.path)
      if (key) sdkByAtom.set(key, [...(sdkByAtom.get(key) ?? []), m.key])
    }
  }
  const mcpByAtom = new Map<string, string[]>()
  for (const t of inp.mcp.tools.values()) {
    // `serves`: a tool that reads the database itself, credited on the route it stands in for.
    for (const r of [...t.routes, ...(t.serves ?? [])]) {
      const key = addAtom(r.method, r.path)
      if (key) mcpByAtom.set(key, [...(mcpByAtom.get(key) ?? []), t.name])
    }
  }
  const apiDocByAtom = new Map<string, ApiDocMention>()
  for (const [k, mention] of inp.apiDocs) {
    const { method, path } = splitKey(k)
    const key = addAtom(method, path)
    if (key && !apiDocByAtom.has(key)) apiDocByAtom.set(key, mention)
  }
  const cliBySdk = new Map<string, string[]>()
  for (const c of inp.cli.commands) for (const s of c.sdk) cliBySdk.set(s, [...(cliBySdk.get(s) ?? []), c.path])
  const cliRef = new Map(inp.cli.commands.map((c) => [c.path, c.ref]))
  const openapiHas = (key: string) => {
    if (!inp.openapi) return false
    const { method, path } = splitKey(key)
    return [...inp.openapi].some((op) => matches(method, path, op))
  }

  /** The cells every route-shaped atom shares, from its SDK methods, CLI commands and MCP tools. */
  const surfaceCells = (sdkKeys: string[], toolNames: string[]): Partial<Record<Surface, Cell>> => {
    const cells: Partial<Record<Surface, Cell>> = {}
    if (sdkKeys.length) {
      cells.sdk = present(sdkKeys.map((k) => `${k} ${inp.sdk.methods.get(k)?.ref ?? ""}`.trim()).join(", "))
      const docd = sdkKeys.find((k) => inp.sdkDocs.methods.has(k))
      cells["sdk-doc"] = docd ? present(`${docd} ${inp.sdkDocs.methods.get(docd)}`) : missing()
      const cmds = [...new Set(sdkKeys.flatMap((k) => cliBySdk.get(k) ?? []))]
      if (cmds.length) {
        cells.cli = present(cmds.map((c) => `${c}${cliRef.get(c) ? ` ${cliRef.get(c)}` : ""}`).join(", "))
        const d = cmds.find((c) => inp.cliDocs.has(c))
        cells["cli-doc"] = d ? present(`${d} ${inp.cliDocs.get(d)}`) : missing()
      } else {
        cells.cli = missing()
        cells["cli-doc"] = na("no CLI command")
      }
    } else {
      cells.sdk = missing()
      cells["sdk-doc"] = na("no SDK method")
      cells.cli = na("no SDK method for a command to call")
      cells["cli-doc"] = na("no CLI command")
    }
    if (toolNames.length) {
      cells.mcp = present(toolNames.map((n) => `${n} ${inp.mcp.tools.get(n)?.ref ?? ""}`.trim()).join(", "))
      const d = toolNames.find((n) => inp.mcpDocs.has(n))
      cells["mcp-doc"] = d ? present(`${d} ${inp.mcpDocs.get(d)}`) : missing()
    } else {
      cells.mcp = missing()
      cells["mcp-doc"] = na("no MCP tool")
    }
    return cells
  }

  const nodeRouteOf = new Map<string, string>() // atom key → node type
  const nodeAtoms: Array<{ type: string; atom: Atom }> = []
  for (const node of inp.nodes) {
    // The route nodes.run and the workflow engine both use (@nodaro/shared);
    // null for a type with no route of its own.
    const routePath = nodeRunRoute(node.type)
    const sdkPaths = inp.sdk.nodeRunRoutes(node.type)
    const key =
      (routePath ? findAtom("POST", routePath) : undefined) ??
      sdkPaths.map((p) => findAtom("POST", p)).find((k): k is string => !!k && registered.has(k))
    const isRegistered = !!key && registered.has(key)
    if (isRegistered) nodeRouteOf.set(key!, node.type)
    const cells: Partial<Record<Surface, Cell>> = {}
    let bucket: RouteBucket = "public"
    if (isRegistered) {
      const r = registered.get(key!)!
      bucket = r.bucket
      cells.route = present(`${key} ${r.ref}`)
      cells.openapi = openapiHas(key!) ? present(key!) : { status: "report-only" }
      const sdkKeys = [...(sdkByAtom.get(key!) ?? [])]
      const viaRun = sdkPaths.some((p) => matches("POST", p, key!))
      if (viaRun) sdkKeys.unshift("nodes.run")
      const toolNames = [...new Set([...(mcpByAtom.get(key!) ?? []), ...(inp.nodeTools[node.type] && inp.mcp.tools.has(inp.nodeTools[node.type]!) ? [inp.nodeTools[node.type]!] : [])])]
      Object.assign(cells, surfaceCells([...new Set(sdkKeys)], toolNames))
      if (!viaRun && cells.sdk?.status === "missing") {
        cells.sdk = missing(`nodes.run("${node.type}") posts ${sdkPaths.join(" | ")}, not ${splitKey(key!).path}`)
      }
    } else {
      const reason = !routePath
        ? `no route of its own: ${NODE_TYPES_WITHOUT_RUN_ROUTE[node.type]}`
        : isPluginPath(routePath)
          ? "plugin"
          : inp.parameterTypes.has(node.type)
            ? "parameter node: read from the graph, never run"
            : ENGINE_ONLY_CATEGORIES.has(node.category)
              ? `${node.category} node: runs inside the workflow engine`
              : undefined
      if (reason === "plugin") bucket = "plugin"
      cells.route = reason ? na(reason) : missing(`no route at ${routePath}`)
      for (const s of ["openapi", "sdk", "sdk-doc", "cli", "cli-doc"] as Surface[]) cells[s] = na(reason ?? "no route")
      const tool = inp.nodeTools[node.type]
      if (tool && inp.mcp.tools.has(tool)) {
        cells.mcp = present(`${tool} ${inp.mcp.tools.get(tool)?.ref ?? ""}`.trim())
        cells["mcp-doc"] = inp.mcpDocs.has(tool) ? present(`${tool} ${inp.mcpDocs.get(tool)}`) : missing()
      } else {
        cells.mcp = na(reason ?? "no route")
        cells["mcp-doc"] = na("no MCP tool")
      }
    }
    const page = inp.nodeDocs.pages.get(node.type)
    cells["node-doc"] = page ? (page.inReadme ? present(page.page) : missing("page exists but docs/nodes/README.md does not link it")) : missing()
    cells["node-doc-live"] = inp.nodeDocs.live.has(node.type) ? present("docs site snapshot") : missing()
    nodeAtoms.push({ type: node.type, atom: { key: `node:${node.type}`, kind: "node", bucket, surfaces: cells } })
  }

  const routeAtoms = new Map<string, Atom>()
  for (const key of atomKeys) {
    const { method, path } = splitKey(key)
    const reg = registered.get(key)
    const bucket: RouteBucket = reg?.bucket ?? inp.classify(method, path)
    const cells: Partial<Record<Surface, Cell>> = {}
    cells.route = reg ? present(reg.ref) : bucket === "plugin" ? na("plugin") : missing(apiDocByAtom.has(key) && !sdkByAtom.has(key) && !mcpByAtom.has(key) ? "only the docs name it" : undefined)
    cells.openapi = openapiHas(key) ? present(key) : { status: "report-only" }
    Object.assign(cells, surfaceCells(sdkByAtom.get(key) ?? [], mcpByAtom.get(key) ?? []))
    const doc = apiDocByAtom.get(key)
    cells["api-doc"] = doc ? present(`${doc.ref}${doc.section ? ` §${doc.section}` : ""}`) : missing()
    routeAtoms.set(key, { key, kind: "route", bucket, ...(reg?.anonymous ? { anonymous: true } : {}), surfaces: cells })
  }

  // Off the public surfaces on purpose: a missing cell is not a gap.
  for (const atom of [...routeAtoms.values(), ...nodeAtoms.map((n) => n.atom)]) {
    if (atom.bucket === "public") continue
    for (const [s, cell] of Object.entries(atom.surfaces) as Array<[Surface, Cell]>) {
      if (cell.status === "missing") atom.surfaces[s] = na(atom.bucket)
    }
  }

  // ---- features -----------------------------------------------------------
  const members = new Map<string, Set<string>>()
  const join = (feature: string, key: string) => members.set(feature, (members.get(feature) ?? new Set()).add(key))
  const unmappedSegments = new Set<string>()
  for (const [key, atom] of routeAtoms) {
    const { path } = splitKey(key)
    // `nodes.run` (and runAndWait / runMany through it) reaches every node's
    // route; that alone does not pull a node's route out of its node row into
    // the `nodes` feature.
    const claimants = new Set(
      (sdkByAtom.get(key) ?? []).map((k) => inp.sdk.methods.get(k)!.prop).filter((prop) => !(prop === "nodes" && nodeRouteOf.has(key))),
    )
    const owner = ownerByPrefix(path)
    if (owner) claimants.add(owner.id)
    for (const c of claimants) join(c, key)
    if (claimants.size) continue
    const nodeType = nodeRouteOf.get(key)
    if (nodeType) continue // shown as its node atom
    if (atom.bucket !== "public" && atom.bucket !== "plugin") {
      join("_internal", key)
      continue
    }
    const seg = path.split("/")[2] ?? path
    if (!(seg in ROUTE_ONLY_FAMILIES)) unmappedSegments.add(`/v1/${seg}`)
    join(`route:${seg}`, key)
  }
  for (const { type, atom } of nodeAtoms) join(`node:${type}`, atom.key)

  // ---- exemptions ---------------------------------------------------------
  const atomByKey = new Map<string, Atom>([...routeAtoms, ...nodeAtoms.map((n) => [n.atom.key, n.atom] as const)])
  const staleExemptions: string[] = []
  const exemptCount = new Map<string, number>()
  for (const ex of inp.exemptions) {
    let used = false
    for (const key of members.get(ex.feature) ?? []) {
      if (ex.atom && ex.atom !== key) continue
      const atom = atomByKey.get(key)!
      const cell = atom.surfaces[ex.surface]
      if (cell?.status !== "missing") continue
      atom.surfaces[ex.surface] = na(`exempt: ${ex.reason}`)
      exemptCount.set(key, (exemptCount.get(key) ?? 0) + 1)
      used = true
    }
    if (!used) staleExemptions.push(`${ex.feature} · ${ex.surface}${ex.atom ? ` · ${ex.atom}` : ""}`)
  }

  const features: FeatureReport[] = [...members.entries()].map(([id, keys]) => {
    const atoms = [...keys].map((k) => atomByKey.get(k)!).sort((a, b) => a.key.localeCompare(b.key))
    const { gaps, complete, gapsBySurface } = countGaps({ atoms } as FeatureReport)
    const exempt = atoms.reduce((n, a) => n + (exemptCount.get(a.key) ?? 0), 0)
    const alias = FEATURE_ALIASES.find((f) => f.id === id)
    return {
      id,
      aliases: alias ? { sdk: alias.id, cli: alias.cli, routePrefixes: alias.routePrefixes, mcpFiles: alias.mcpFiles } : {},
      atoms,
      summary: { atoms: atoms.length, complete, gaps, gapsBySurface, exempt },
    }
  })
  features.sort((a, b) => b.summary.gaps - a.summary.gaps || a.id.localeCompare(b.id))

  const mapped = new Set(FEATURE_ALIASES.map((f) => f.id))
  const cliMapped = new Set([...FEATURE_ALIASES.flatMap((f) => f.cli), ...LOCAL_CLI_GROUPS])
  return {
    version: 1,
    edition: inp.edition,
    generatedFrom: inp.sha,
    features,
    unmapped: {
      sdkProps: inp.sdk.props.filter((p) => !mapped.has(p)),
      cliGroups: inp.cli.groups.filter((g) => !cliMapped.has(g)),
      routePrefixes: [...unmappedSegments].sort(),
    },
    staleExemptions,
  }
}
