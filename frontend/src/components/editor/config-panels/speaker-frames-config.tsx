import { useMemo } from "react"
import { SPEAKER_FRAMES_NOT_PRICED_MESSAGE, SPEAKER_FRAMES_PRICED } from "@nodaro/render-rules"
import { ScanFace } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useT } from "@/lib/i18n"
import { speakerFramesResultSummary, speakerFramesSourcesOf, toggleSpeakerFramesSource } from "@/lib/speaker-frames-panel"
import { speakerFramesUnnamedViews, speakerViewTranscript } from "@/lib/speaker-view-context"
import { openFraming, useFramingHostMounted } from "@/hooks/use-framing-open-store"
import type { SpeakerFramesNodeData } from "@/types/nodes"
import type { ConfigProps } from "./types"

/**
 * Speaker Frames' settings (P3.6): the cameras the wired edit samples, each
 * with its frame count and a tick (P3-5 (a): untick a camera a render shows
 * full frame), and the last result read after the node's manual corrections
 * (P3-18 (a)). The sampling rate is fixed and not shown (P3-31). Not priced
 * yet (P3.7): the panel says so, and a run is refused. When the result ties
 * no face to a speaker of the video-fed Speaker View it feeds, "Which face is
 * …?" opens that Speaker View's region editor (tap-first, decided 2026-10-13).
 */
export function SpeakerFramesConfig({ data, onUpdate, nodes, edges = [], nodeId }: ConfigProps<SpeakerFramesNodeData> & { readonly nodeId?: string }) {
  const t = useT()
  const sources = useMemo(() => (nodeId ? speakerFramesSourcesOf(nodeId, nodes, edges) : []), [nodeId, nodes, edges])
  // Names read through the rename map of the transcript wired into this node (decided 2026-10-10).
  const transcript = useMemo(() => (nodeId ? speakerViewTranscript(nodeId, nodes, edges) : undefined), [nodeId, nodes, edges])
  const result = useMemo(() => speakerFramesResultSummary(data.generatedJson, data.trackAssignments, transcript), [data.generatedJson, data.trackAssignments, transcript])
  const ask = useMemo(() => (nodeId ? speakerFramesUnnamedViews(nodeId, nodes, edges)[0] : undefined), [nodeId, nodes, edges])
  const canOpen = useFramingHostMounted()
  const ticked = sources.filter((s) => s.ticked)
  const frames = ticked.reduce((n, s) => n + s.frames, 0)

  return (
    <div className="flex flex-col gap-3" data-testid="speaker-frames-config">
      <p className="text-[11px] text-muted-foreground">{t("speakerFrames.hint")}</p>
      {!SPEAKER_FRAMES_PRICED && (
        <p role="status" data-testid="speaker-frames-not-priced" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400" title={SPEAKER_FRAMES_NOT_PRICED_MESSAGE}>
          {t("speakerFrames.notPriced")}
        </p>
      )}

      <section className="flex flex-col gap-2">
        <Label>{t("speakerFrames.section.cameras")}</Label>
        {sources.length === 0 ? (
          <p className="text-[11px] text-muted-foreground" data-testid="speaker-frames-no-edit">{t("speakerFrames.noEdit")}</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1.5">
              {sources.map((s) => (
                <li key={s.sourceId} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="truncate" title={s.sourceId}>{s.label}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="tabular-nums text-muted-foreground">{t("speakerFrames.frames", { count: s.frames })}</span>
                    <Switch
                      checked={s.ticked}
                      aria-label={t("speakerFrames.sampleCamera", { camera: s.label })}
                      onCheckedChange={(on) => onUpdate({ excludeSourceIds: toggleSpeakerFramesSource(data.excludeSourceIds, s.sourceId, on) })}
                    />
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground tabular-nums" data-testid="speaker-frames-total">
              {t("speakerFrames.total", { frames, cameras: ticked.length })}
            </p>
          </>
        )}
      </section>

      {result && (
        <section className="flex flex-col gap-1.5" data-testid="speaker-frames-result">
          <Label>{t("speakerFrames.section.result")}</Label>
          {result.sources.map((s) => {
            const label = (nodes.find((n) => n.id === s.sourceId)?.data as { label?: unknown } | undefined)?.label
            return (
              <p key={s.sourceId} className="text-[11px]">
                <span className="font-medium">{typeof label === "string" && label ? label : s.sourceId}</span>
                {": "}
                {t("speakerFrames.tracks", { count: s.tracks })}
                {s.speakers.length > 0 && ` · ${s.speakers.join(", ")}`}
                {s.unattributed > 0 && ` · ${t("speakerFrames.unattributed", { count: s.unattributed })}`}
              </p>
            )
          })}
          {ask && canOpen && (
            <Button type="button" size="sm" className="self-start h-7 text-xs" onClick={() => openFraming(ask.nodeId)} data-testid="speaker-frames-which-face">
              <ScanFace className="w-3.5 h-3.5 me-1" />
              {t("speakerView.framing.whichFace", { speaker: ask.unnamed[0]!.name })}
            </Button>
          )}
          {result.unmatched.length > 0 && (
            <p role="status" className="text-[11px] text-amber-700 dark:text-amber-400" data-testid="speaker-frames-unmatched">
              {t("speakerFrames.unmatched", { tracks: result.unmatched.map((a) => a.trackId).join(", ") })}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
