"use client"

import { usecaseRecordingsProblem, type UseCaseNodeType } from "@nodaro/render-rules"
import { useT } from "@/lib/i18n"
import type { UseCaseMulticamViewer } from "@/lib/use-case-multicam-viewer"
import { USE_CASE_RECORDINGS_REASON_KEYS } from "@/lib/use-case-recordings-copy"
import { usecaseWiredRecordings } from "@/lib/use-case-wired-recordings"
import { usecaseWiredMediaKind } from "@/lib/use-case-audio-lock"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import type { ConfigProps } from "./types"
import { UseCaseCamerasFields } from "./use-case-cameras-fields"

/**
 * Whether the recordings this viewer's run reads are all sound only — the
 * store's audio lock asks the same (`usecaseWiredMediaKind`): the first
 * recording alone, or — for a viewer who may use Speaker Map — every one.
 * While their availability is loading the run could read one recording or
 * all: sound only only when both readings say so.
 */
export function usecaseViewerSoundOnly(nodeId: string, nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], viewer: UseCaseMulticamViewer): boolean {
  const soundOnly = (multicam: boolean) => usecaseWiredMediaKind(nodeId, nodes, edges, multicam) === "audio"
  return viewer === "loading" ? soundOnly(false) && soundOnly(true) : soundOnly(viewer === "offered")
}

/**
 * The recordings section every use-case panel that takes several recordings
 * shows (decided 2026-10-17): with two or more recordings or a Master audio,
 * the Cameras settings (`UseCaseCamerasFields` — the recordings in the run's
 * order, the wide camera, already in sync, who is on which camera) and a
 * badge for what the run would refuse (`usecaseRecordingsProblem`) — only to
 * a viewer who may use Speaker Map. Any other viewer is told their run reads
 * the first recording only; nothing shows until their availability has
 * landed. ONE section for Tighten Episode, Trailer and Clip Pack.
 */
export function UseCaseMulticamSection({
  type,
  data,
  onUpdate,
  nodeId,
  nodes,
  edges,
  sources = [],
  viewer,
}: {
  readonly type: UseCaseNodeType
  readonly data: Readonly<Record<string, unknown>>
  readonly onUpdate: ConfigProps<never>["onUpdate"]
  readonly nodeId: string
  readonly nodes: readonly WorkflowNode[]
  readonly edges: readonly WorkflowEdge[]
  readonly sources?: ConfigProps<never>["sources"]
  readonly viewer: UseCaseMulticamViewer
}) {
  const t = useT()
  // The recordings the type reads (in the node's order), and a Master audio that is not one of them.
  const wired = usecaseWiredRecordings({ id: nodeId, type, data }, nodes, edges)
  const masterId = wired.masterId
  const recordings = wired.recordings.map((r) => {
    const source = (sources ?? []).find((s) => s.id === r.nodeId && s.targetHandle === "media")
    return { ...r, label: source?.label ?? r.nodeId, source }
  })
  const multicam = recordings.length >= 2 || !!masterId
  if (!multicam || viewer === "loading") return null
  if (viewer === "withheld") return <p className="text-xs text-muted-foreground">{t("proccfg.usecaseNeedsSpeakerMap")}</p>
  const problem = usecaseRecordingsProblem({ kinds: recordings.map((r) => r.kind), masterAudio: !!masterId, cameras: data.cameras })
  const problemKey = problem ? USE_CASE_RECORDINGS_REASON_KEYS[problem.code] : undefined
  return (
    <>
      <UseCaseCamerasFields
        data={data}
        onUpdate={onUpdate}
        recordings={recordings}
        hasMaster={!!masterId}
        masterLabel={(sources ?? []).find((s) => s.id === masterId && s.targetHandle === "masterAudio")?.label}
        report={data.useCaseCameras}
      />
      {problem && <p className="text-xs text-red-500">{problemKey ? t(problemKey) : problem.message}</p>}
    </>
  )
}
