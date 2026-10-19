// @registry-lookup localizes the labels of the nodes wired into this one, one label at a time
import { orderUseCaseMedia, usecaseCamerasReportOf, usecaseMediaOrderOf, type UseCaseCamerasReport } from "@nodaro/render-rules"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ConnectedMediaList } from "@/components/editor/config-panels/connected-media-list"
import type { SourceNodeInfo } from "@/components/editor/config-panels/types"
import { useLocalizeNodeLabel } from "@/lib/i18n/labels"
import { useT } from "@/lib/i18n"

/** One recording wired into a use-case node's Recordings: its upstream node, what it is, and its row's source. */
export interface UseCaseCameraRecording {
  readonly nodeId: string
  readonly label: string
  readonly kind: "video" | "audio"
  /** The wired source as the panel lists it (its thumbnail); a bare row when absent. */
  readonly source?: SourceNodeInfo
}

const NONE = "none"
const AUTO = "auto"
const WIDE = "wide"

const isPlainRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/**
 * The Cameras section every multicam-capable use-case node shows with two or
 * more recordings or a Master audio (decided 2026-10-17):
 *  - Recordings: the wired recordings in the order the run reads them
 *    (`orderUseCaseMedia` over the node's `mediaOrder` — the one ordering
 *    rule), dragged to reorder (writes `mediaOrder`); each named by its
 *    camera position, or "Sound only"; then the Master audio, when wired;
 *  - Wide camera: None, or a recording with picture (`cameras.wide`, a position);
 *  - Recordings already in sync (`cameras.synced`: no Audio Sync);
 *  - Who is on which camera: one row per speaker of the last run's report
 *    (else one per camera) — Automatic, a camera, or the wide shot
 *    (`cameras.speakerCameras`: ordinal → position, 0 = the wide shot).
 * No fail-safe here: the workflow store keeps these settings following the
 * wires (lib/use-case-cameras-invariant.ts).
 */
export function UseCaseCamerasFields({
  data,
  onUpdate,
  recordings,
  hasMaster,
  masterLabel,
  report,
}: {
  readonly data: Readonly<Record<string, unknown>>
  readonly onUpdate: (patch: Record<string, unknown>) => void
  readonly recordings: ReadonlyArray<UseCaseCameraRecording>
  readonly hasMaster: boolean
  readonly masterLabel?: string
  readonly report?: UseCaseCamerasReport | unknown
}) {
  const t = useT()
  const localizeNode = useLocalizeNodeLabel()
  const ordered = orderUseCaseMedia(recordings, usecaseMediaOrderOf(data))
  const cameras = isPlainRecord(data.cameras) ? data.cameras : {}
  const overrides = isPlainRecord(cameras.speakerCameras) ? (cameras.speakerCameras as Record<string, unknown>) : {}
  const withPicture = ordered.map((r, i) => ({ ...r, position: i + 1 })).filter((r) => r.kind === "video")
  const writeCameras = (patch: Record<string, unknown>) => onUpdate({ cameras: { ...cameras, ...patch } })
  const rowName = (nodeId: string) => {
    const i = ordered.findIndex((r) => r.nodeId === nodeId)
    return i < 0 ? "" : ordered[i]!.kind === "audio" ? t("proccfg.usecaseSoundOnly") : t("proccfg.usecaseCameraN", { n: i + 1 })
  }
  const speakers = usecaseCamerasReportOf(report)?.speakers.map((s) => s.ordinal) ?? withPicture.map((_, i) => i + 1)
  const wide = typeof cameras.wide === "number" && withPicture.some((r) => r.position === cameras.wide) ? String(cameras.wide) : NONE
  const choiceOf = (ordinal: number) => {
    const cam = overrides[String(ordinal)]
    return cam === 0 ? WIDE : typeof cam === "number" ? String(cam) : AUTO
  }
  const pickFor = (ordinal: number, v: string) => {
    const { [String(ordinal)]: _was, ...rest } = overrides
    writeCameras({ speakerCameras: v === AUTO ? rest : { ...rest, [String(ordinal)]: v === WIDE ? 0 : Number(v) } })
  }

  return (
    <div className="space-y-3" data-testid="use-case-cameras">
      <Label className="text-sm font-medium">{t("proccfg.usecaseCameras")}</Label>

      <div className="space-y-1.5">
        <Label>{t("proccfg.usecaseRecordings")}</Label>
        <ConnectedMediaList
          sources={ordered.map((r) => r.source ?? { id: r.nodeId, type: "", label: r.label, value: "" })}
          mediaOrder={ordered.map((r) => r.nodeId)}
          onUpdateOrder={(order) => onUpdate({ mediaOrder: order })}
          mediaType="any"
          renderRowExtra={(entry) => <span className="text-[10px] text-muted-foreground">{rowName(entry.id)}</span>}
        />
        {hasMaster && (
          <p className="text-xs text-muted-foreground">
            {t("proccfg.usecaseMasterAudio")}{masterLabel ? `: ${localizeNode(masterLabel)}` : ""}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>{t("proccfg.usecaseWideCamera")}</Label>
        <Select value={wide} onValueChange={(v) => writeCameras({ wide: v === NONE ? null : Number(v) })}>
          <SelectTrigger aria-label={t("proccfg.usecaseWideCamera")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("proccfg.usecaseWideNone")}</SelectItem>
            {withPicture.map((r) => <SelectItem key={r.nodeId} value={String(r.position)}>{t("proccfg.usecaseCameraN", { n: r.position })}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="use-case-cameras-synced">{t("proccfg.usecaseSynced")}</Label>
          <Switch id="use-case-cameras-synced" aria-label={t("proccfg.usecaseSynced")} checked={cameras.synced === true} onCheckedChange={(v) => writeCameras({ synced: v })} />
        </div>
        <p className="text-xs text-muted-foreground">{t("proccfg.usecaseSyncedHint")}</p>
      </div>

      {withPicture.length >= 2 && (
        <div className="space-y-1.5">
          <Label>{t("proccfg.usecaseWhoOnCamera")}</Label>
          {speakers.map((ordinal) => (
            <div key={ordinal} className="flex items-center justify-between gap-2">
              <span className="text-xs">{t("proccfg.usecaseSpeakerN", { n: ordinal })}</span>
              <Select value={choiceOf(ordinal)} onValueChange={(v) => pickFor(ordinal, v)}>
                <SelectTrigger className="w-40" aria-label={t("proccfg.usecaseSpeakerN", { n: ordinal })}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO}>{t("proccfg.usecaseCameraAuto")}</SelectItem>
                  {withPicture.map((r) => <SelectItem key={r.nodeId} value={String(r.position)}>{t("proccfg.usecaseCameraN", { n: r.position })}</SelectItem>)}
                  <SelectItem value={WIDE}>{t("proccfg.usecaseCameraWide")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">{t("proccfg.usecaseWhoHint")}</p>
        </div>
      )}
    </div>
  )
}
