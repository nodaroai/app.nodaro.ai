/**
 * Reading a workflow JSON blob — the one place the format is understood.
 *
 * Two surfaces import the same files: the editor toolbar (file, clipboard, and
 * its "add to this canvas" mode) and the home screen's Import JSON button. They
 * must agree about what a valid bundle IS, because the disagreement is silent:
 * a second parser that forgets the tutorial wrapper accepts a file the other
 * one rejects, or drops `assets` and lands a workflow whose character chips
 * point at nothing. So the parse rule, the payload shape and the sentences the
 * user reads afterwards live here, and both callers read them from here.
 *
 * Everything below is pure. The network call (`importWorkflow` in `lib/api`)
 * and the toasts stay with the caller, which is what lets the toolbar offer
 * "add to the open canvas" while the home screen only ever creates.
 */
import type { WorkflowExport } from "@nodaro/shared/workflow"
import type { DbCharacter, DbObject, DbLocation } from "@/lib/api"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

/** A media reference the exporting instance knew we would not be able to fetch. */
export interface WorkflowMediaRefLite {
  readonly nodeId: string
  readonly nodeLabel?: string
}

/**
 * The on-disk shape, as loosely as we are willing to read it. `version` is a
 * string because exports in the wild carry both `1` and `"1.0"`;
 * {@link toWorkflowExportPayload} is what pins it to the wire contract.
 */
export interface ExportedWorkflow {
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  settings?: Record<string, unknown>
  exportedAt: string
  version: string
  assets?: {
    characters: DbCharacter[]
    objects: DbObject[]
    locations: DbLocation[]
  }
  /** Media another instance cannot fetch — see `WorkflowPortability` (#866). */
  portability?: {
    unreachableMedia: Array<{ nodeId: string; nodeLabel?: string; field: string; url: string }>
  }
}

/** The longest name the workflows table takes. */
const NAME_MAX = 200
const IMPORT_SUFFIX = " (Imported)"

/**
 * Parse a workflow JSON string, throwing a sentence worth showing a user.
 *
 * Accepts the tutorial/seed wrapper (`{ meta, workflow: { nodes, … } }`)
 * alongside a flat export, so a file straight out of `backend/seeds` imports
 * like any other. Nodes and edges are the only structure required: everything
 * else the backend's Zod schema defaults or strips, and refusing a bundle here
 * for a field the server would have accepted is a worse failure than passing it
 * on.
 */
export function parseWorkflowJson(jsonStr: string): ExportedWorkflow {
  const raw = JSON.parse(jsonStr) as Record<string, unknown>
  const inner =
    raw.workflow && typeof raw.workflow === "object" && raw.workflow !== null && "nodes" in (raw.workflow as object)
      ? (raw.workflow as Record<string, unknown>)
      : raw
  const data = inner as unknown as ExportedWorkflow
  if (!data.nodes || !Array.isArray(data.nodes)) throw new Error("Missing nodes array")
  if (!data.edges || !Array.isArray(data.edges)) throw new Error("Missing edges array")
  return data
}

/**
 * The portable bundle `POST /v1/workflows/import` expects.
 *
 * The version is coerced (older exports wrote `"1.0"`), the name is suffixed so
 * an import never looks like the original it was taken from, and extra asset
 * fields ride along for the backend schema to strip — listing them here would
 * be a third copy of a shape that already exists twice.
 */
export function toWorkflowExportPayload(data: ExportedWorkflow): WorkflowExport {
  const base = data.name || "Untitled Workflow"
  return {
    version: 1,
    exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : new Date().toISOString(),
    name: (base + IMPORT_SUFFIX).slice(0, NAME_MAX),
    nodes: data.nodes as unknown as WorkflowExport["nodes"],
    edges: data.edges as unknown as WorkflowExport["edges"],
    ...(data.settings ? { settings: data.settings } : {}),
    ...(data.assets ? { assets: data.assets as unknown as WorkflowExport["assets"] } : {}),
  }
}

/** "Node A, Node B, …" for a media-ref list — labels first, ids as the fallback, capped. */
export function describeMediaRefNodes(refs: ReadonlyArray<WorkflowMediaRefLite>, max = 4): string {
  const names = [...new Set(refs.map((r) => r.nodeLabel || r.nodeId))]
  return names.slice(0, max).join(", ") + (names.length > max ? ", …" : "")
}

/** How many bundled entities an import will re-create, for the success line. */
export function bundledAssetCount(data: Pick<ExportedWorkflow, "assets">): number {
  const a = data.assets
  if (!a) return 0
  return (a.characters?.length ?? 0) + (a.objects?.length ?? 0) + (a.locations?.length ?? 0)
}

/** Read a picked file as text, so a caller need not hand-roll FileReader. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => resolve(String(event.target?.result ?? ""))
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"))
    reader.readAsText(file)
  })
}
