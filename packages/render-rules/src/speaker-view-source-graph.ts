/**
 * The graph half of the Speaker View source check (decided 2026-10-12, R5):
 * which Speaker Views are fed a bare video, and the extra "runs after" edges
 * that make every paid node feeding one wait for that video. One rule for both
 * engines — the server's orchestrator and the editor's own graph runner (a
 * Sub-workflow node run on the canvas) — so a source is checked before anything
 * that feeds the Speaker View charges, wherever the run executes. Pure.
 */
import { ancestorsOf } from "./graph-walk"
import { speakerViewClipRefusal, speakerViewNodeLabel, type SpeakerViewClipFacts } from "./speaker-view-video-mode"

type SourceNode = { readonly id: string; readonly type?: unknown; readonly data?: unknown }
type SourceEdge = { readonly id?: string; readonly source: string; readonly target: string; readonly targetHandle?: string | null }

export interface VideoFedSpeakerView {
  readonly id: string
  /** The name on the node, else the type's own: a message never shows the id. */
  readonly label: string
  /** The node wired into the `video` handle. */
  readonly videoSourceId: string
  readonly targetAspect: unknown
  readonly requireFaces: boolean
}

const blank = (v: unknown) => v === undefined || v === null || v === ""

/** The Speaker View nodes fed a bare video (and no edit: both together is refused elsewhere). */
export function videoFedSpeakerViews(nodes: ReadonlyArray<SourceNode>, edges: ReadonlyArray<SourceEdge>): VideoFedSpeakerView[] {
  const out: VideoFedSpeakerView[] = []
  for (const node of nodes) {
    if (node.type !== "speaker-view") continue
    const data = node.data as Record<string, unknown>
    if (data.skipped === true) continue
    const into = (handle: string) => edges.filter((e) => e.target === node.id && e.targetHandle === handle)
    const video = into("video").at(-1)
    if (!video || into("edl").length > 0 || !blank(data.edl)) continue
    out.push({
      id: node.id,
      label: speakerViewNodeLabel(node),
      videoSourceId: video.source,
      targetAspect: data.targetAspect,
      requireFaces: data.requireFaces === true,
    })
  }
  return out
}

/**
 * The extra "runs after" edges that make a paid node feeding a video-fed
 * Speaker View wait for that Speaker View's source: from the source to every
 * executable ancestor of the Speaker View that is neither the source, nor
 * upstream of it. `executable` keeps sources and parameter nodes out (they never
 * run through a level).
 *
 * One view's edges cannot close a loop on their own (an ancestor of the source
 * is never ordered behind it), but two views' edges can, together with the
 * graph's real wires. Each edge is therefore added only if its target cannot
 * already reach its source over the real wires plus the edges kept so far; the
 * one dropped is the weaker guarantee only — the node's dispatch gate still
 * judges the source once it exists. Without this, a loop makes the level
 * builder silently drop every node on it.
 */
export function speakerViewSourceOrderingEdges(
  nodes: ReadonlyArray<SourceNode>,
  edges: ReadonlyArray<SourceEdge>,
  executable: (nodeType: string) => boolean,
): Array<SourceEdge & { readonly id: string }> {
  const views = videoFedSpeakerViews(nodes, edges)
  if (views.length === 0) return []
  const typeOf = new Map(nodes.map((n) => [n.id, typeof n.type === "string" ? n.type : undefined] as const))
  const out = new Map<string, string[]>()
  const link = (from: string, to: string) => {
    const list = out.get(from)
    if (list) list.push(to)
    else out.set(from, [to])
  }
  for (const e of edges) link(e.source, e.target)
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>([from])
    const stack = [from]
    while (stack.length > 0) {
      const id = stack.pop()!
      if (id === to) return true
      for (const next of out.get(id) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        stack.push(next)
      }
    }
    return false
  }
  const extra = new Map<string, SourceEdge & { readonly id: string }>()
  for (const view of views) {
    const upstreamOfSource = ancestorsOf(view.videoSourceId, edges)
    for (const id of ancestorsOf(view.id, edges)) {
      const type = typeOf.get(id)
      if (type === undefined || !executable(type)) continue
      if (id === view.videoSourceId || upstreamOfSource.has(id)) continue
      const key = `${view.videoSourceId}->${id}`
      if (extra.has(key) || reaches(id, view.videoSourceId)) continue
      extra.set(key, { id: `sv-source-order:${key}`, source: view.videoSourceId, target: id })
      link(view.videoSourceId, id)
    }
  }
  return [...extra.values()]
}

/**
 * What the clip's own facts refuse for this Speaker View, as a sentence naming
 * it by its label (never its id); null when it may run. The clip's facts come
 * from the one cached measurement.
 */
export function speakerViewSourceRefusal(
  view: Pick<VideoFedSpeakerView, "label" | "targetAspect" | "requireFaces">,
  clip: SpeakerViewClipFacts,
): string | null {
  const refusal = speakerViewClipRefusal({ clip, targetAspect: view.targetAspect, requireFaces: view.requireFaces })
  return refusal ? `${refusal.message} (Speaker View node "${view.label}").` : null
}
