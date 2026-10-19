import { useMemo } from "react"
import { useT } from "@/lib/i18n"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CAMERA_SWITCH_BOUNDS, CAMERA_SWITCH_DEFAULTS, CAMERA_SWITCH_NAME_MAX, cameraSwitchCameras, cameraSwitchSpeakerMap, clampCameraSwitchSetting, speakerMapResultOf, transcriptSpeakerLabels, type CameraSwitchNumericSetting } from "@nodaro/shared/edl"
import { isRenderNodeType, renderTranscriptOutputOf } from "@nodaro/shared/nodes"
import { CAMERA_SWITCH_SPEAKER_MAP_HANDLE, cameraSwitchSpeakerMapLanding, cameraSwitchSpeakerMapProblem, drawnSourceId } from "@nodaro/render-rules"
import { TEXT_PRODUCER_TYPES } from "@/lib/generate-image-handles"
import type { CameraSwitchNodeData, WorkflowEdge, WorkflowNode } from "@/types/nodes"
import type { ConfigProps } from "./types"
import { ReplaceRenderNodeAction } from "@/components/editor/replace-render-node-action"
import { renderTypeLabel } from "@/hooks/use-replace-render-node"
import { SPEAKER_VIEW_TYPE } from "@/lib/replace-render-node"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"

/** The Select value for "no camera of their own" (stored as ""). */
const NO_CAMERA = "__none__"

const parseMaybe = (v: unknown): unknown => {
  if (typeof v !== "string") return v
  try { return JSON.parse(v) } catch { return undefined }
}

/** The cameras a speaker can be given, as {id, label}: the video sources of the
 *  Edit Plan wired into `edl` (its Sources edges + its per-source roles), or —
 *  when the upstream is not an Edit Plan — the video sources of the EDL it
 *  produced last. Never the mic, the wide or the screen. */
export function cameraChoices(
  nodeId: string | undefined,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): Array<{ id: string; label: string }> {
  if (!nodeId) return []
  const labelOf = (id: string) => ((nodes.find((n) => n.id === id)?.data as { label?: string } | undefined)?.label ?? id)
  const edlEdge = edges.find((e) => e.target === nodeId && e.targetHandle === "edl")
  const upstream = edlEdge ? nodes.find((n) => n.id === edlEdge.source) : undefined
  if (!upstream) return []
  if (upstream.type === "edit-plan") {
    const cfg = ((upstream.data as { sourceConfig?: Record<string, { role?: string; kind?: string }> }).sourceConfig ?? {})
    const order = ((upstream.data as { sourceOrder?: string[] }).sourceOrder ?? [])
    // Edit Plan's order and per-source config are keyed by the node each wire
    // was DRAWN from (a Teleport Receive's id); the camera id is the node the
    // wire carries — the id Edit Plan's run mints into the EDL.
    const wired = edges
      .filter((e) => e.target === upstream.id && e.targetHandle === "sources")
      .map((e) => ({ key: drawnSourceId(e), id: e.source }))
    const keys = wired.map((w) => w.key)
    const orderedKeys = [...order.filter((k) => keys.includes(k)), ...keys.filter((k) => !order.includes(k))]
    return orderedKeys
      .map((k) => wired.find((w) => w.key === k)!)
      .filter(({ key, id }) => {
        const node = nodes.find((n) => n.id === id)
        const role = cfg[key]?.role
        const kind = cfg[key]?.kind ?? (node?.type?.includes("audio") ? "audio" : "video")
        return kind === "video" && role !== "wide" && role !== "screen" && role !== "master-audio"
      })
      .map(({ id }) => ({ id, label: labelOf(id) }))
  }
  // The EDL the wire carries (a pip of its own, e.g. Speaker Map's `edl`, or
  // Camera Switch's), else the producer's generatedJson as before.
  const first = (v: unknown) => (Array.isArray(v) ? v[0] : v)
  const fromPip = cameraSwitchCameras(first(parseMaybe(extractNodeOutput(upstream, edlEdge?.sourceHandle ?? undefined))))
  const cameras = fromPip.length > 0 ? fromPip : cameraSwitchCameras(first((upstream.data as { generatedJson?: unknown }).generatedJson))
  return cameras.map((c) => ({ id: c.id, label: labelOf(c.id) }))
}

/** What the run reads off `speakerMap`, as the resolvers record it
 *  (`cameraSwitchSpeakerMapLanding`): the JSON the wire's pip carries, "" when
 *  its upstream has produced nothing yet, undefined when nothing is wired. */
export function wiredSpeakerMap(
  nodeId: string | undefined,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): string | undefined {
  if (!nodeId) return undefined
  let recorded: string | undefined
  for (const edge of edges) {
    if (edge.target !== nodeId || edge.targetHandle !== CAMERA_SWITCH_SPEAKER_MAP_HANDLE) continue
    const producer = nodes.find((n) => n.id === edge.source)
    if (!producer) continue
    recorded = cameraSwitchSpeakerMapLanding(recorded, extractNodeOutput(producer, edge.sourceHandle ?? undefined), { type: producer.type, textSources: TEXT_PRODUCER_TYPES })
  }
  return recorded
}

/** The renders this Camera Switch's edit goes to directly that are not Speaker
 *  View — the ones layout hints would make refuse (G1), each offered the swap
 *  under the hints note (U7, SV16 b). In edge order, each once. */
export function hintRefusingRenders(
  nodeId: string | undefined,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): WorkflowNode[] {
  if (!nodeId) return []
  const ids = new Set(edges.filter((e) => e.source === nodeId && e.sourceHandle === "edl").map((e) => e.target))
  return nodes.filter((n) => ids.has(n.id) && isRenderNodeType(n.type) && n.type !== SPEAKER_VIEW_TYPE)
}

/** The speaker labels of the transcript wired into `transcript` (from the
 *  producer's last result), in order of first appearance. */
export function speakerChoices(
  nodeId: string | undefined,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): string[] {
  return transcriptSpeakerLabels(wiredTranscript(nodeId, nodes, edges))
}

/** The transcript wired into `transcript`, from the producer's last result. */
export function wiredTranscript(
  nodeId: string | undefined,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): unknown {
  if (!nodeId) return undefined
  const edge = edges.find((e) => e.target === nodeId && e.targetHandle === "transcript")
  const producer = edge ? nodes.find((n) => n.id === edge.source) : undefined
  if (!producer) return undefined
  const d = producer.data as { generatedJson?: unknown; generatedResults?: Array<{ transcript?: unknown }>; activeResultIndex?: number }
  const results = Array.isArray(d.generatedResults) ? d.generatedResults : []
  const fromResult = results[d.activeResultIndex ?? 0]?.transcript
  const generated = d.generatedJson as { transcript?: unknown } | undefined
  // A Camera Switch upstream carries { edl, transcript }; a render carries its
  // transcript on the field its registry names (Speaker View's json is its EDL).
  const remapped = renderTranscriptOutputOf(producer.type)
  return fromResult ?? (producer.type === "camera-switch" ? generated?.transcript : remapped ? (d as Record<string, unknown>)[remapped.dataField] : d.generatedJson)
}

const secs = (ms: number | undefined) => (typeof ms === "number" ? String(ms / 1000) : "")
const toMs = (v: string): number | undefined => {
  const n = Number(v)
  return v.trim() === "" || !Number.isFinite(n) || n < 0 ? undefined : Math.round(n * 1000)
}

export function CameraSwitchConfig({ data, onUpdate, nodes, edges = [], nodeId }: ConfigProps<CameraSwitchNodeData> & { nodeId?: string }) {
  const t = useT()
  const cameras = useMemo(() => cameraChoices(nodeId, nodes, edges), [nodeId, nodes, edges])
  const transcript = useMemo(() => wiredTranscript(nodeId, nodes, edges), [nodeId, nodes, edges])
  const speakers = useMemo(() => transcriptSpeakerLabels(transcript), [transcript])
  const wiredMap = useMemo(() => wiredSpeakerMap(nodeId, nodes, edges), [nodeId, nodes, edges])
  const refusing = useMemo(() => hintRefusingRenders(nodeId, nodes, edges), [nodeId, nodes, edges])
  const stored = data.speakerMap ?? {}
  // What the run will use — the ONE merge the run sends (cameraSwitchSpeakerMap):
  // the person's choices, the ordinal override, a wired Speaker Map, then the
  // order. The cameras are already the offered ones, so they stand in for the
  // EDL (an Edit Plan that has not run has none yet).
  const effective = cameraSwitchSpeakerMap(
    { speakerMap: stored, speakerMapByOrder: data.speakerMapByOrder },
    { sources: cameras.map((c) => ({ id: c.id, kind: "video" })) },
    transcript,
    { speakerMap: wiredMap },
  )
  const fromWiredMap = speakerMapResultOf(wiredMap) !== null
  // The run's own verdict on the wire: shown here, so the table never looks
  // like the order default while the run would refuse.
  const wiredProblem = cameraSwitchSpeakerMapProblem(wiredMap)
  const names = data.speakerNames ?? {}

  const setCamera = (label: string, value: string) =>
    onUpdate({ speakerMap: { ...stored, [label]: value === NO_CAMERA ? "" : value } })
  // Typing is free; leaving the field snaps it into the range the route accepts.
  const clampOnBlur = (key: CameraSwitchNumericSetting) => () => {
    const clamped = clampCameraSwitchSetting(key, data[key])
    if (clamped !== data[key]) onUpdate({ [key]: clamped })
  }
  const setName = (label: string, value: string) => {
    const next = { ...names }
    if (value.trim()) next[label] = value
    else delete next[label]
    onUpdate({ speakerNames: next })
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-muted-foreground">{t("proccfg.cameraSwitchHint")}</p>

      <div className="flex flex-col gap-1.5">
        <Label>{t("proccfg.cameraSwitchSpeakers")}</Label>
        {wiredProblem && (
          <p role="alert" className="text-[11px] text-amber-500">
            {t(wiredProblem === "empty-speaker-map" ? "proccfg.cameraSwitchSpeakerMapEmpty" : "proccfg.cameraSwitchSpeakerMapNotAMap")}
          </p>
        )}
        {speakers.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">{t("proccfg.cameraSwitchSpeakersEmpty")}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {speakers.map((label) => (
              <div key={label} className="grid grid-cols-[1fr_1fr] gap-1.5 items-center">
                <Input
                  className="h-7 text-xs"
                  aria-label={t("proccfg.cameraSwitchNameAria", { speaker: label })}
                  placeholder={label}
                  maxLength={CAMERA_SWITCH_NAME_MAX}
                  value={names[label] ?? ""}
                  onChange={(e) => setName(label, e.target.value)}
                />
                <Select value={effective[label] || NO_CAMERA} onValueChange={(v) => setCamera(label, v)}>
                  <SelectTrigger aria-label={t("proccfg.cameraSwitchCameraAria", { speaker: label })} className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {cameras.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                    <SelectItem value={NO_CAMERA}>{t("proccfg.cameraSwitchNoCamera")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">{t("proccfg.cameraSwitchSpeakersHint")}</p>
            {fromWiredMap && <p className="text-[11px] text-muted-foreground">{t("proccfg.cameraSwitchSpeakersFromMap")}</p>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="camera-switch-min-shot">{t("proccfg.cameraSwitchMinShot")}</Label>
          <Input id="camera-switch-min-shot" type="number" min={CAMERA_SWITCH_BOUNDS.minShotMs.min / 1000} max={CAMERA_SWITCH_BOUNDS.minShotMs.max / 1000} step={0.5} placeholder={secs(CAMERA_SWITCH_DEFAULTS.minShotMs)}
            value={secs(data.minShotMs)} onChange={(e) => onUpdate({ minShotMs: toMs(e.target.value) })} onBlur={clampOnBlur("minShotMs")} />
        </div>
        <div>
          <Label htmlFor="camera-switch-lead">{t("proccfg.cameraSwitchLead")}</Label>
          <Input id="camera-switch-lead" type="number" min={CAMERA_SWITCH_BOUNDS.leadMs.min / 1000} max={CAMERA_SWITCH_BOUNDS.leadMs.max / 1000} step={0.1} placeholder={secs(CAMERA_SWITCH_DEFAULTS.leadMs)}
            value={secs(data.leadMs)} onChange={(e) => onUpdate({ leadMs: toMs(e.target.value) })} onBlur={clampOnBlur("leadMs")} />
        </div>
        <div>
          <Label htmlFor="camera-switch-max-shot">{t("proccfg.cameraSwitchMaxShot")}</Label>
          <Input id="camera-switch-max-shot" type="number" min={CAMERA_SWITCH_BOUNDS.maxShotMs.min / 1000} max={CAMERA_SWITCH_BOUNDS.maxShotMs.max / 1000} step={1} placeholder={secs(CAMERA_SWITCH_DEFAULTS.maxShotMs)}
            value={secs(data.maxShotMs)} onChange={(e) => onUpdate({ maxShotMs: toMs(e.target.value) })} onBlur={clampOnBlur("maxShotMs")} />
        </div>
        <div>
          <Label htmlFor="camera-switch-wide-every">{t("proccfg.cameraSwitchWideEvery")}</Label>
          <Input id="camera-switch-wide-every" type="number" min={CAMERA_SWITCH_BOUNDS.wideEvery.min} max={CAMERA_SWITCH_BOUNDS.wideEvery.max} step={1} placeholder="0"
            value={typeof data.wideEvery === "number" ? String(data.wideEvery) : ""}
            onChange={(e) => onUpdate({ wideEvery: e.target.value.trim() === "" ? undefined : clampCameraSwitchSetting("wideEvery", Number(e.target.value)) })} />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("proccfg.cameraSwitchWideHint")}</p>

      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="camera-switch-layout-hints">{t("proccfg.cameraSwitchLayoutHints")}</Label>
        <Switch id="camera-switch-layout-hints" checked={data.layoutHints === true} onCheckedChange={(v) => onUpdate({ layoutHints: v })} />
      </div>
      <p className="text-[11px] text-muted-foreground">{t("proccfg.cameraSwitchLayoutHintsHint")}</p>
      {data.layoutHints === true && refusing.map((r) => (
        <ReplaceRenderNodeAction
          key={r.id}
          nodeId={r.id}
          toType={SPEAKER_VIEW_TYPE}
          label={t("renderSwap.replaceNode", {
            // One render: its type ("Replace Apply EDL with …"); several: each by its own label.
            from: refusing.length === 1 ? renderTypeLabel(r.type ?? "") : String((r.data as { label?: unknown }).label ?? r.id),
            to: renderTypeLabel(SPEAKER_VIEW_TYPE),
          })}
        />
      ))}
    </div>
  )
}
