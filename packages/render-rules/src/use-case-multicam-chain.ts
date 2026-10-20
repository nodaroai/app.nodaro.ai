/**
 * The plan chain every multicam use-case builder makes (decided 2026-10-17):
 * the multicam front (use-case-multicam.ts), the builder's Transcribe on the
 * sound, any step that also listens to the sound and feeds the plan (Tighten's
 * Silence Detect), the builder's plan over every recording with its role and
 * Audio Sync's offsets, and Camera Switch between the plan and the render with
 * two or more cameras (hints off, the Cameras override as camera ids). What a
 * render reads after it: the switched edit and its renamed transcript, or —
 * without a switch — the plan's edit and the transcript. ONE chain for
 * Tighten, Trailer and Clip Pack; each builder adds its own render and tail.
 * Pure: fresh objects every call.
 */
import type { UseCaseGraphEdge, UseCaseGraphNode, UseCaseHandleRef } from "./use-case-graph"
import type { UseCaseSources } from "./use-case-registry"
import type { UseCaseCameras } from "./use-case-cameras"
import { usecaseEdge, usecaseTranscribeNode } from "./use-case-graph-parts"
import { usecaseMulticamFront, usecaseSwitchNode, usecaseSwitchWires, type MulticamFront, type MulticamSourceRole } from "./use-case-multicam"

/** A step that reads the sound on `input` and feeds its `output` into the plan's `planInput` (Tighten's Silence Detect). */
export interface MulticamSoundListener {
  readonly node: UseCaseGraphNode
  readonly input: string
  readonly output: string
  readonly planInput: string
}

export interface MulticamPlanChain {
  readonly front: MulticamFront
  /** The front, Transcribe, the listeners, the plan and (with two or more cameras) Camera Switch, in that order. */
  readonly nodes: UseCaseGraphNode[]
  readonly edges: UseCaseGraphEdge[]
  /** The switch, when built (two or more cameras with picture). */
  readonly switched: boolean
  /** The edit a render reads: the switched edit, else the plan's. */
  readonly edit: UseCaseHandleRef
  /** The transcript a render reads: the switch's renamed one, else the transcript. */
  readonly named: UseCaseHandleRef
  /** Audio Sync's and Speaker Map's results, for the output map (absent when neither runs). */
  readonly multicam?: { readonly sync?: UseCaseHandleRef; readonly map?: UseCaseHandleRef }
}

/** The multicam plan chain of `sources` (see the module note). */
export function usecaseMulticamPlanChain(
  sources: UseCaseSources,
  cameras: UseCaseCameras,
  opts: {
    readonly transcribeId: string
    readonly planId: string
    /** The builder's plan node over these recordings, in this order, with these roles. */
    readonly plan: (sourceOrder: readonly string[], sourceConfig: Readonly<Record<string, { readonly role: MulticamSourceRole }>>) => UseCaseGraphNode
    readonly listeners?: readonly MulticamSoundListener[]
    /** Where Camera Switch sits on the canvas. */
    readonly switchAt: { readonly column: number; readonly row: number }
  },
): MulticamPlanChain {
  const listeners = opts.listeners ?? []
  const transcript = { nodeId: opts.transcribeId, handle: "json" } as const
  const front = usecaseMulticamFront(sources, cameras, { transcript })
  const pipOf = (id: string) => (front.nodes.find((n) => n.id === id)!.type === "upload-audio" ? "audio" : "video")
  const nodes: UseCaseGraphNode[] = [
    ...front.nodes,
    usecaseTranscribeNode(opts.transcribeId, 1, 0),
    ...listeners.map((l) => l.node),
    opts.plan(front.planSourceIds, front.planSourceConfig),
  ]
  const edges: UseCaseGraphEdge[] = [
    ...front.edges,
    usecaseEdge(front.sound.nodeId, front.sound.pip, opts.transcribeId, "audio"),
    ...listeners.map((l) => usecaseEdge(front.sound.nodeId, front.sound.pip, l.node.id, l.input)),
    ...front.planSourceIds.map((id) => usecaseEdge(id, pipOf(id), opts.planId, "sources")),
    ...(front.offsets ? [usecaseEdge(front.offsets.nodeId, front.offsets.handle, opts.planId, "offsets")] : []),
    usecaseEdge(opts.transcribeId, "json", opts.planId, "transcript"),
    ...listeners.map((l) => usecaseEdge(l.node.id, l.output, opts.planId, l.planInput)),
  ]
  const sw = usecaseSwitchNode(front, cameras, opts.switchAt.column, opts.switchAt.row)
  if (sw) {
    nodes.push(sw)
    edges.push(...usecaseSwitchWires(front, { nodeId: opts.planId, handle: "edl" }, transcript))
  }
  const multicam = { ...(front.offsets ? { sync: front.offsets } : {}), ...(front.map ? { map: front.map } : {}) }
  return {
    front,
    nodes,
    edges,
    switched: !!sw,
    edit: sw ? { nodeId: sw.id, handle: "edl" } : { nodeId: opts.planId, handle: "edl" },
    named: sw ? { nodeId: sw.id, handle: "transcript" } : transcript,
    ...(Object.keys(multicam).length > 0 ? { multicam } : {}),
  }
}
