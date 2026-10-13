/**
 * "Reframe" (decided 2026-10-11, D11 (d)): a canvas MACRO, not a node type.
 * Choosing it in the add-node menu drops the three real nodes a vertical
 * speaker clip needs, wired and grouped:
 *
 *   Transcribe (speakers) -> Speaker Frames -> Speaker View (video, 9:16, Cut, glide)
 *
 * Because they are real nodes in the OUTER graph, every engine feature keeps
 * working with no special case — Preview, the stop rule, Render final, the
 * region editor and the "Which face is Speaker A?" repair path — and what the
 * macro writes is ordinary workflow JSON that any client could have written.
 * That is also why `reframe` is never a node type: nothing would run it.
 *
 * Pure: the graph in, the next graph out. `insertCanvasMacro`
 * (`hooks/use-canvas-macro.ts`) applies it to the live canvas as ONE undo step.
 *
 * One video feeds three inputs (Transcribe `audio`, Speaker Frames `video`,
 * Speaker View `video`). A group has no input handles, so the video is wired
 * here when the macro knows it (a selected video node, or the handle the menu
 * was opened from), and otherwise by `planReframeVideoFanOut`: the first video
 * wired into any one of the three wires the other two as well (an input that
 * already holds a wire is left as it is).
 */
import { NODE_DEF_MAP, type WorkflowEdge, type WorkflowNode } from "@/types/nodes"
import { resolveEffectiveSourceType } from "@nodaro/shared"
import { findNonOverlappingPosition, nodeRect, type PlacementRect } from "@/lib/find-free-position"

/** The three real nodes, in pipeline order. */
export const REFRAME_CHILD_TYPES = ["transcribe", "speaker-frames", "speaker-view"] as const
export type ReframeChildType = (typeof REFRAME_CHILD_TYPES)[number]

/** The marker on the group's `data`, so the canvas can recognise a Reframe group. */
export const REFRAME_MACRO_ID = "reframe"

/** The label the group is created with (stored in English, localized for display). */
export const REFRAME_GROUP_LABEL = "Reframe"

/** The input each child reads the clip from. */
export const REFRAME_VIDEO_INPUT: Readonly<Record<ReframeChildType, string>> = {
  transcribe: "audio",
  "speaker-frames": "video",
  "speaker-view": "video",
}

/**
 * Layout inside the group, in group-local coordinates. Each cell clears the
 * node's own minimum size (Transcribe 300x350, Speaker Frames 240 wide, Speaker
 * View 240 wide and as tall as a 9:16 result), with room to breathe.
 */
export const REFRAME_LAYOUT = {
  group: { width: 1080, height: 560 },
  transcribe: { x: 40, y: 60 },
  "speaker-frames": { x: 420, y: 60 },
  "speaker-view": { x: 760, y: 60 },
} as const

export interface ReframeVideoSource {
  readonly source: string
  readonly sourceHandle?: string | null
}

export interface ReframeIds {
  readonly group: string
  readonly transcribe: string
  readonly frames: string
  readonly view: string
}

export interface ReframeDefaults {
  readonly transcribe: Record<string, unknown>
  readonly frames: Record<string, unknown>
  readonly view: Record<string, unknown>
}

export interface ReframePlan {
  readonly nodes: WorkflowNode[]
  readonly edges: WorkflowEdge[]
  readonly groupId: string
  readonly wiredVideo: boolean
}

/** Air between a group a drop landed inside of and the Reframe group placed beside it. */
const BESIDE_GAP = 80

type Graph = { readonly nodes: readonly WorkflowNode[]; readonly edges: readonly WorkflowEdge[] }

const wire = (source: string, sourceHandle: string | null | undefined, target: string, targetHandle: string): WorkflowEdge => ({
  id: `edge-${source}-${sourceHandle ?? "out"}-${target}-${targetHandle}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
  targetHandle,
}) as WorkflowEdge

const pointInRect = (p: { x: number; y: number }, r: PlacementRect) =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height

/**
 * Whether `handleId` of a `nodeType` node emits a video. Every video pip in the
 * catalogue is called `video`; an aggregate lane or a scraper pip that carries
 * one is caught by the effective source type, the rule the drop validator reads.
 */
export function emitsVideo(nodeType: string | null | undefined, handleId: string | null | undefined): boolean {
  if (!handleId) return false
  return handleId === "video" || resolveEffectiveSourceType(nodeType, handleId) === "video"
}

/** The output handle of `node` that emits a video, or undefined when it has none. */
export function videoOutputHandleOf(node: { readonly type?: string | null }): string | undefined {
  const outputs = NODE_DEF_MAP.get(node.type as never)?.outputs ?? []
  return outputs.find((h) => emitsVideo(node.type, h))
}

export function planReframeMacro(
  graph: Graph,
  input: {
    /** Where the group's top-left is wanted, in flow coordinates. */
    readonly position: { readonly x: number; readonly y: number }
    readonly ids: ReframeIds
    readonly defaults: ReframeDefaults
    /** The video to wire into all three, when the caller knows it. */
    readonly video?: ReframeVideoSource
  },
): ReframePlan {
  const { position, ids, defaults, video } = input
  // Groups cannot be nested (`orderNodesParentFirst` is single-level and the
  // drag-attach path refuses to parent a group), so a drop inside one lands
  // BESIDE it (decided 2026-10-12): the search starts just past that group's
  // right edge instead of at a point the new group could never occupy.
  const topLevelGroups = graph.nodes.filter((n) => n.type === "group" && !n.hidden && !n.parentId)
  let wanted = position
  for (let hops = 0; hops <= topLevelGroups.length; hops += 1) {
    const holder = topLevelGroups.find((g) => pointInRect(wanted, nodeRect(g)))
    if (!holder) break
    const rect = nodeRect(holder)
    wanted = { x: rect.x + rect.width + BESIDE_GAP, y: rect.y }
  }

  // Land on the closest free spot, as `addNode` does. A node inside a group is
  // positioned in group space and is already covered by its group's rect.
  const obstacles = graph.nodes
    .filter((n) => n.type !== "sticky-note" && !n.hidden && !n.parentId)
    .map(nodeRect)
  const groupAt = findNonOverlappingPosition(wanted, REFRAME_LAYOUT.group, obstacles)

  const child = (id: string, type: ReframeChildType, data: Record<string, unknown>): WorkflowNode =>
    ({ id, type, parentId: ids.group, position: { ...REFRAME_LAYOUT[type] }, data }) as unknown as WorkflowNode

  const groupNode = {
    id: ids.group,
    type: "group",
    position: groupAt,
    width: REFRAME_LAYOUT.group.width,
    height: REFRAME_LAYOUT.group.height,
    selected: true,
    data: { label: REFRAME_GROUP_LABEL, macro: REFRAME_MACRO_ID },
  } as unknown as WorkflowNode

  const created: WorkflowNode[] = [
    groupNode,
    // Speaker detection is what makes the transcript usable downstream: without
    // `diarize` there is no speaker to follow.
    // The provider is pinned, not inherited: speaker detection comes only from
    // ElevenLabs (as "Add Transcribe" writes it), so no default may turn it off.
    child(ids.transcribe, "transcribe", { ...defaults.transcribe, provider: "elevenlabs-stt", diarize: true }),
    child(ids.frames, "speaker-frames", { ...defaults.frames }),
    // Explicit, so the node reads the same everywhere (canvas, MCP, a saved
    // workflow) instead of depending on a default derived at run time.
    // Starts at PREVIEW (D17, decided 2026-10-12): the first run is the cheap
    // one, and Render final is the person's explicit step to the full-price cut.
    child(ids.view, "speaker-view", { ...defaults.view, quality: "proxy", targetAspect: "9:16", switchType: "cut", motion: "glide" }),
  ]

  const edges: WorkflowEdge[] = [
    ...graph.edges,
    ...(video
      ? [
          wire(video.source, video.sourceHandle, ids.transcribe, REFRAME_VIDEO_INPUT.transcribe),
          wire(video.source, video.sourceHandle, ids.frames, REFRAME_VIDEO_INPUT["speaker-frames"]),
          wire(video.source, video.sourceHandle, ids.view, REFRAME_VIDEO_INPUT["speaker-view"]),
        ]
      : []),
    wire(ids.transcribe, "json", ids.frames, "transcript"),
    wire(ids.transcribe, "json", ids.view, "transcript"),
    wire(ids.frames, "tracks", ids.view, "tracks"),
  ]

  return {
    // The new group takes focus, as a node added from the menu does.
    nodes: [...graph.nodes.map((n) => (n.selected ? ({ ...n, selected: false } as WorkflowNode) : n)), ...created],
    edges,
    groupId: ids.group,
    wiredVideo: !!video,
  }
}

/** The group's three children, by type (undefined when one has been deleted). */
export function reframeChildren(nodes: readonly WorkflowNode[], groupId: string): Partial<Record<ReframeChildType, WorkflowNode>> {
  const out: Partial<Record<ReframeChildType, WorkflowNode>> = {}
  for (const n of nodes) {
    if (n.parentId !== groupId) continue
    if ((REFRAME_CHILD_TYPES as readonly string[]).includes(n.type ?? "")) out[n.type as ReframeChildType] ??= n
  }
  return out
}

/** True for a group the Reframe macro made. */
export const isReframeGroup = (node: { readonly type?: string | null; readonly data?: unknown } | undefined): boolean =>
  node?.type === "group" && (node.data as { macro?: unknown } | undefined)?.macro === REFRAME_MACRO_ID

const hasWire = (edges: readonly WorkflowEdge[], target: string, handle: string) =>
  edges.some((e) => e.target === target && e.targetHandle === handle)

/**
 * Whether `child`'s video input is fed a VIDEO. Speaker Frames' and Speaker
 * View's `video` pins take nothing else, so any wire counts. Transcribe's
 * `audio` pin takes audio OR video: a wire from something that does not emit a
 * video (an Upload Audio) is a normal wire there but leaves the clip unwired.
 */
function hasVideoWire(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  child: ReframeChildType,
  childId: string,
): boolean {
  const handle = REFRAME_VIDEO_INPUT[child]
  if (child !== "transcribe") return hasWire(edges, childId, handle)
  return edges.some((e) => {
    if (e.target !== childId || e.targetHandle !== handle) return false
    const source = nodes.find((n) => n.id === e.source)
    return !!source && emitsVideo(source.type, e.sourceHandle)
  })
}

/**
 * The "Wire a video" badge: a Reframe group none of whose three video inputs
 * is fed a video yet (see `hasVideoWire`: an audio wire on Transcribe does not
 * count). (A group with a child missing is not badged: there is no longer a
 * macro to finish.)
 */
export function reframeNeedsVideo(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], groupId: string): boolean {
  const group = nodes.find((n) => n.id === groupId)
  if (!isReframeGroup(group)) return false
  const kids = reframeChildren(nodes, groupId)
  if (REFRAME_CHILD_TYPES.some((t) => !kids[t])) return false
  return REFRAME_CHILD_TYPES.every((t) => !hasVideoWire(nodes, edges, t, kids[t]!.id))
}

/**
 * The extra wires a video connection earns inside a Reframe group: the FIRST
 * video wired into any of the three inputs wires the other two to the same
 * source. Only while no input is fed a video yet (`edges` is the graph BEFORE
 * the new connection), so a later rewire of one input never drags the others
 * along. An input that already holds ANY wire is left alone — the store appends
 * these edges without validating them, and a deliberate audio wire on
 * Transcribe is not ours to stack a second wire on. Empty when the connection
 * is not that.
 */
export function planReframeVideoFanOut(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  connection: { readonly source: string; readonly sourceHandle?: string | null; readonly target: string; readonly targetHandle?: string | null },
): WorkflowEdge[] {
  const target = nodes.find((n) => n.id === connection.target)
  if (!target?.parentId) return []
  const type = target.type as ReframeChildType
  if (!(REFRAME_CHILD_TYPES as readonly string[]).includes(type)) return []
  if (connection.targetHandle !== REFRAME_VIDEO_INPUT[type]) return []
  const groupId = target.parentId
  if (!isReframeGroup(nodes.find((n) => n.id === groupId))) return []
  // A wire from one of the macro's own nodes is not "a video from outside".
  const source = nodes.find((n) => n.id === connection.source)
  if (!source || source.parentId === groupId) return []
  // Transcribe's `audio` pin takes audio OR video, so an audio source is a normal
  // wire there. Only a source that really emits a video may feed the two `video`
  // pins — the store appends these edges without validating them.
  if (!emitsVideo(source.type, connection.sourceHandle)) return []
  if (!reframeNeedsVideo(nodes, edges, groupId)) return []
  const kids = reframeChildren(nodes, groupId)
  return REFRAME_CHILD_TYPES.filter((t) => t !== type && !hasWire(edges, kids[t]!.id, REFRAME_VIDEO_INPUT[t])).map((t) =>
    wire(connection.source, connection.sourceHandle, kids[t]!.id, REFRAME_VIDEO_INPUT[t]),
  )
}
