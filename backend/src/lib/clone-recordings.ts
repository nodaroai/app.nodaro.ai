/**
 * A one-off voice clone's recordings are the runner's own (decided 2026-11-13: recordings as app
 * inputs). A graph as anyone but its author receives it — a published app's or a template's
 * snapshot, a share link's viewer, a run read as published, a copy of someone else's workflow —
 * never carries its author's recordings or consent: every clone ships switched on with its links
 * emptied (both `""`, a clone whose recordings are not in yet) and no consent record, and the
 * clone node ships without its earlier results (they speak in its author's voice). The runner puts
 * their own recordings and their own consent onto the emptied clone (an app's inputs), and a clone
 * left empty is refused, never dropped for another voice. Applied by the one publish funnel
 * (`ugcStripPart`, lib/ugc-composed-graph.ts), so every graph it ships or a run loads is stripped;
 * a workspace collaborator who may only view the workflow reads its clones emptied too
 * (lib/workflow-route-access.ts), its results kept (they are shown the work).
 */
import { RUN_OVERRIDE_CLEARED_FIELDS } from "@nodaro/shared/nodes"

/** A clone switched on whose recordings are not in yet. */
const EMPTIED = { sourceAudioUrl: "", consentAudioUrl: "" } as const

/** A node's field that can carry a clone's recordings or its consent. */
export const CLONE_FIELDS: ReadonlySet<string> = new Set(["replica", "replicaConsent", "speakers"])

/** How a clone ships: always without its recordings and consent; `outputs` also drops the clone node's earlier results. */
export interface CloneStripOptions {
  readonly outputs?: boolean
}

type GraphNode = { readonly id?: unknown; readonly type?: unknown; readonly data?: unknown }

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)

/** A clone entry (a Text to Speech node's data, or a dialogue speaker) without its recordings or consent; the same object when it holds neither. */
function emptied<T extends Record<string, unknown>>(entry: T): T {
  if (entry.replica == null && !("replicaConsent" in entry)) return entry
  const { replicaConsent: _consent, ...rest } = entry
  return (entry.replica == null ? rest : { ...rest, replica: { ...EMPTIED } }) as unknown as T
}

/** The node's data without its earlier results (`RUN_OVERRIDE_CLEARED_FIELDS`); the same object when it holds none. */
function withoutResults(data: Record<string, unknown>): Record<string, unknown> {
  if (!RUN_OVERRIDE_CLEARED_FIELDS.some((key) => key in data)) return data
  const out = { ...data }
  for (const key of RUN_OVERRIDE_CLEARED_FIELDS) delete out[key]
  return out
}

/** One node's data as it ships (see the file comment); the same object when it holds no clone. */
export function cloneDataWithoutRecordings(type: unknown, data: Record<string, unknown>, opts: CloneStripOptions = {}): Record<string, unknown> {
  if (type === "text-to-speech") {
    const next = emptied(data)
    return opts.outputs && data.replica != null ? withoutResults(next) : next
  }
  if (type === "text-to-dialogue" && Array.isArray(data.speakers)) {
    let changed = false
    let cloned = false
    const speakers = data.speakers.map((speaker) => {
      if (!isRecord(speaker)) return speaker
      if (speaker.replica != null) cloned = true
      const next = emptied(speaker)
      if (next !== speaker) changed = true
      return next
    })
    const next = changed ? { ...data, speakers } : data
    return opts.outputs && cloned ? withoutResults(next) : next
  }
  return data
}

/** The nodes as they ship (see the file comment): each clone's links emptied and its consent gone. */
export function withoutCloneRecordings<T extends GraphNode>(nodes: readonly T[], opts: CloneStripOptions = {}): T[] {
  return nodes.map((node) => {
    if (!isRecord(node.data)) return node
    const data = cloneDataWithoutRecordings(node.type, node.data, opts)
    return data === node.data ? node : ({ ...node, data } as T)
  })
}
