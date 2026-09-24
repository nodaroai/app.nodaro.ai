// Split the Suno template into its runs.
//
// The template is the same idea run several times over, each run changing one
// thing. Nothing about that is written down in the workflow, so it is derived:
// one run per Suno Generate node, ordered down the canvas, with the style nodes
// feeding it. Deriving means adding a run to the template adds it here too.

import { nodeMedia, nodeField } from "../derive-tutorial-data"
import { nodePicks } from "./person-node-picks"
import { tx, type TFunction } from "@/lib/i18n"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

export interface SunoInput {
  id: string
  /** Node type, e.g. "music-genre". */
  kind: string
  picks: string[]
}

export interface SunoRun {
  id: string
  inputs: SunoInput[]
  audioUrl: string | null
  prompt: string
  instrumental: boolean
  model: string | null
  /** Every pick across the run's style nodes — what Suno is told to make. */
  styleDescription: string
}

const GENERATOR = "suno-generate"

/** The style-node families the tutorial shows, in the order they read. */
export const INPUT_ORDER = [
  "music-genre",
  "music-mood",
  "instrumentation",
  "voice-character",
  "voice-delivery",
]

function orderOf(kind: string): number {
  const i = INPUT_ORDER.indexOf(kind)
  return i === -1 ? INPUT_ORDER.length : i
}

export function deriveSunoRuns(nodes: WorkflowNode[], edges: WorkflowEdge[]): SunoRun[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const generators = nodes
    .filter((n) => n.type === GENERATOR)
    .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0))

  const runs: SunoRun[] = []
  for (const gen of generators) {
    const inputs: SunoInput[] = []
    for (const edge of edges) {
      if (edge.target !== gen.id) continue
      const src = byId.get(edge.source)
      if (!src?.type || !INPUT_ORDER.includes(src.type)) continue
      inputs.push({ id: src.id, kind: src.type, picks: nodePicks(src) })
    }
    inputs.sort((a, b) => orderOf(a.kind) - orderOf(b.kind))

    runs.push({
      id: gen.id,
      inputs,
      audioUrl: nodeMedia(gen),
      prompt: nodeField(gen, "prompt") ?? "",
      instrumental: nodeField(gen, "instrumental") === "true",
      model: nodeField(gen, "model"),
      // The bridge between "what you picked" and "what came out": Suno is sent
      // the picks, joined, and nothing else unless you add a prompt.
      styleDescription: inputs
        .flatMap((i) => i.picks)
        .map((p) => p.toLowerCase())
        .join(", "),
    })
  }

  // A generator fed by exactly the same nodes as the one before it is a second
  // TAKE of that run, not a new lesson — showing it as its own step would claim
  // a change that never happened.
  return runs.filter((run, i) => {
    if (i === 0) return true
    const prev = runs[i - 1].inputs.map((x) => x.id).join(",")
    return run.inputs.map((x) => x.id).join(",") !== prev
  })
}

/**
 * What changed between two consecutive runs, in the reader's terms. `nameOf`
 * names a style-node family inside the sentence — the body passes the node's
 * localized label; the default is the node type in plain words. `t` defaults
 * to the live locale for non-render callers.
 */
export function describeChange(
  previous: SunoRun | undefined,
  run: SunoRun,
  t: TFunction = tx,
  nameOf: (kind: string) => string = (kind) => kind.replace(/-/g, " "),
): string {
  if (!previous) return t("tut.sunoChangeStart")

  const before = new Set(previous.inputs.map((i) => i.kind))
  const after = new Set(run.inputs.map((i) => i.kind))
  const added = [...after].filter((k) => !before.has(k))
  const removed = [...before].filter((k) => !after.has(k))

  // "a and b and c", joined the way each language joins a list.
  const both = (kinds: string[]) => kinds.map(nameOf).reduce((a, b) => t("tut.listAnd", { a, b }))
  if (added.length) return t("tut.sunoChangeAdded", { names: both(added) })
  if (removed.length) return t("tut.sunoChangeDropped", { names: both(removed) })
  if (run.instrumental !== previous.instrumental) {
    return run.instrumental ? t("tut.sunoChangeInstrumental") : t("tut.sunoChangeVocals")
  }

  const changed = run.inputs.filter((input) => {
    const other = previous.inputs.find((p) => p.kind === input.kind)
    return other && other.picks.join("|") !== input.picks.join("|")
  })
  if (changed.length) return t("tut.sunoChangeChanged", { names: changed.map((c) => nameOf(c.kind)).join(", ") })
  return t("tut.sunoChangeSame")
}
