"use client"

/**
 * Speaker View's region editor (U4, U4b; SV8 a, SV9 a + d): one crop per
 * (camera, speaker) drawn over a frame of the camera itself, in the full-size
 * inspector. The original plays in `<video preload=metadata>`; a camera the
 * browser cannot play falls back to its upload's thumbnail.
 */
import { useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { ChevronLeft, ChevronRight, Crop } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InspectorShell } from "@/components/inspector/inspector-shell"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { segmentColor } from "@/lib/segment-colors"
import { cn } from "@/lib/utils"
import { RegionCanvas, type CanvasBox, type FrameMedia } from "./region-canvas"
import { RegionList, formatMasterMs, type RegionListRow } from "./region-list"
import { RegionOutputPreview } from "./region-output-preview"
import { DiscardFramingDialog, RegionTransport } from "./region-transport"
import { jumpSeekMs, masterToSourceMs, nudgeRegion, type Region } from "./region-geometry"
import { pairKey, type FramingCamera, type FramingShowAs } from "./region-model"
import { rawLabelOf, speakerQuote } from "./region-quote"
import { containerOf, useRegionEditor } from "./use-region-editor"

const LAYOUT_KEY: Record<string, "speakerView.layout.single" | "speakerView.layout.sideBySide" | "speakerView.layout.stacked" | "speakerView.layout.grid" | "speakerView.layout.pip"> = {
  single: "speakerView.layout.single",
  "side-by-side": "speakerView.layout.sideBySide",
  stacked: "speakerView.layout.stacked",
  grid: "speakerView.layout.grid",
  pip: "speakerView.layout.pip",
}

/** Focus is in a field that owns its keys (text, the scrubber, a menu). */
const ownsKeys = (el: EventTarget | null) => el instanceof HTMLElement && el.closest("input, textarea, select, [contenteditable=true]") !== null

export function RegionEditorDialog({ nodeId, label, onClose }: { readonly nodeId: string; readonly label: string; readonly onClose: () => void }) {
  const t = useT()
  const ed = useRegionEditor(nodeId)
  const wide = useMediaQuery("(min-width: 640px)", true)
  const flip = useAppDir() === "rtl" ? "-scale-x-100" : ""
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [timeMs, setTimeMs] = useState(0)
  const [frameTick, setFrameTick] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const { camera, frame, pair } = ed

  const requestClose = useCallback(() => (ed.dirty ? setConfirming(true) : onClose()), [ed.dirty, onClose])

  const showAsLabel = (s: FramingShowAs) => {
    const layout = t(LAYOUT_KEY[s.layout] ?? "speakerView.layout.single")
    const which = s.layout === "pip" ? ` · ${t(s.slotIndex === 0 ? "speakerView.framing.pipMain" : "speakerView.framing.pipInset")}` : s.layout === "grid" ? ` ${s.slots}` : ""
    return `${layout}${which} ${s.aspect}`
  }

  const rowsOf = useCallback(
    (c: FramingCamera): RegionListRow[] =>
      c.pairs.map((p, i) => {
        const seek = jumpSeekMs(ed.model.turns, p.speaker, { offsetMs: c.offsetMs, durationMs: ed.frameOf(c).durationMs })
        return {
          key: pairKey(p.source, p.speaker),
          speaker: p.speaker,
          color: segmentColor(i),
          atMs: seek !== undefined ? seek + (c.offsetMs ?? 0) : p.firstMs,
          hasBox: ed.regionOf(c, p.speaker) !== null,
        }
      }),
    [ed],
  )

  const boxes: CanvasBox[] = camera
    ? camera.pairs.flatMap((p, i) => {
        const region = ed.regionOf(camera, p.speaker)
        const key = pairKey(p.source, p.speaker)
        if (!region || (!wide && key !== ed.selectedKey)) return []
        return [{ key, label: p.speaker, color: segmentColor(i), region }]
      })
    : []

  const media: FrameMedia = !camera
    ? { kind: "none" }
    : !frame.failed
      ? { kind: "video", src: camera.url }
      : ed.upload.thumbnailUrl
        ? { kind: "image", src: ed.upload.thumbnailUrl }
        : { kind: "none" }

  const seekTo = (sourceMs: number) => {
    const v = videoRef.current
    if (v) v.currentTime = Math.max(0, sourceMs / 1000)
  }
  const onTime = () => {
    const v = videoRef.current
    if (v && camera) setTimeMs(v.currentTime * 1000 + (camera.offsetMs ?? 0))
    setFrameTick((n) => n + 1)
  }

  const cycle = (dir: 1 | -1) => {
    if (!camera || camera.pairs.length === 0) return
    const keys = camera.pairs.map((p) => pairKey(p.source, p.speaker))
    const at = Math.max(0, keys.indexOf(ed.selectedKey ?? ""))
    ed.select(camera.id, keys[(at + dir + keys.length) % keys.length]!)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && (e.key === "z" || e.key === "Z" || e.key === "y")) {
      e.preventDefault()
      ed.dispatch({ type: e.shiftKey || e.key === "y" ? "redo" : "undo" })
      return
    }
    // Tab is left to the browser: the boxes are tab stops (focus selects), so it cycles them and moves on (U4).
    if (ownsKeys(e.target) || mod || e.altKey) return
    if (e.key === "f" || e.key === "F") {
      e.preventDefault()
      ed.fullFrame()
      return
    }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const step = arrows[e.key]
    const region = camera && pair ? ed.regionOf(camera, pair.speaker) : null
    if (!step || !region || !frame.size || !ed.selectedKey) return
    e.preventDefault()
    const by = e.shiftKey ? 10 : 1
    ed.setBox(ed.selectedKey, nudgeRegion(region, step[0] * by, step[1] * by, frame.size))
  }

  const quoteFor = () => {
    if (!camera || !pair) return undefined
    const seek = jumpSeekMs(ed.model.turns, pair.speaker, { offsetMs: camera.offsetMs, durationMs: frame.durationMs })
    const from = seek !== undefined ? seek + (camera.offsetMs ?? 0) : pair.firstMs
    const text = speakerQuote(ed.transcript, pair.speaker, from, ed.names, (id) => ed.model.cameras.find((c) => c.id === id)?.offsetMs ?? 0)
    if (!text) return undefined
    const raw = rawLabelOf(pair.speaker, ed.names)
    return { text, who: raw ? `${raw} (${pair.speaker})` : pair.speaker }
  }

  const cameraLine = camera
    ? [camera.id, frame.size ? `${frame.size.width}×${frame.size.height}` : undefined, formatMasterMs(timeMs)].filter(Boolean).join(" · ")
    : ""

  const showAsPicker = ed.showAs.length > 0 && (
    <div role="radiogroup" aria-label={t("speakerView.framing.showAs")} className="flex flex-wrap items-center gap-1 text-xs">
      <span className="text-muted-foreground">{t("speakerView.framing.showAs")}</span>
      {ed.showAs.map((s, i) => (
        <button
          key={`${s.layout}-${s.slots}-${s.slotIndex}`}
          type="button"
          role="radio"
          aria-checked={i === ed.showAsIndex}
          className={cn("rounded-full border px-2 py-0.5", i === ed.showAsIndex ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}
          onClick={() => ed.setShowAsIndex(i)}
        >
          {showAsLabel(s)}
        </button>
      ))}
    </div>
  )

  const footer = (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-[11px] text-muted-foreground me-auto hidden sm:block">{t("speakerView.framing.footnote")}</p>
      <Button variant="outline" size="sm" onClick={ed.resetToThirds} disabled={ed.model.cameras.length === 0}>{t("speakerView.framing.reset")}</Button>
      <Button variant="ghost" size="sm" onClick={requestClose}>{t("common.cancel")}</Button>
      <Button size="sm" onClick={() => { ed.save(); onClose() }} disabled={ed.model.cameras.length === 0 || ed.readOnly}>{t("speakerView.framing.save")}</Button>
    </div>
  )

  const empty = ed.model.cameras.length === 0
  const container = camera ? containerOf(camera.url) : undefined
  const fallbackNote = !ed.upload.thumbnailUrl
    ? t("speakerView.framing.noFrame")
    : container
      ? t("speakerView.framing.thumbnailFallbackExt", { ext: container })
      : t("speakerView.framing.thumbnailFallback")
  const output = pair && ed.slot && (
    <RegionOutputPreview
      speaker={pair.speaker}
      crop={ed.crop}
      slot={ed.slot}
      source={() => (media.kind === "video" ? videoRef.current : media.kind === "image" ? imageRef.current : null)}
      frameTick={frameTick}
    />
  )

  return (
    <>
      <InspectorShell
        open
        size="full"
        icon={<Crop />}
        title={t("speakerView.framing.title", { label })}
        actions={wide ? showAsPicker : undefined}
        copyValue={empty ? undefined : ed.rows}
        onClose={requestClose}
        onEscapeKeyDown={(e) => { if (ed.dirty) { e.preventDefault(); setConfirming(true) } }}
        onKeyDown={onKeyDown}
        footer={footer}
        bodyClassName="p-0 flex-1 min-h-0 overflow-auto"
      >
        {empty ? (
          <p className="p-6 text-sm text-muted-foreground" data-testid="region-editor-empty">{t("speakerView.framing.noEdit")}</p>
        ) : (
          <div className={cn("grid gap-4 p-4", wide ? "grid-cols-[minmax(10rem,14rem)_1fr_minmax(9rem,12rem)]" : "grid-cols-1")}>
            {wide ? (
              <RegionList cameras={ed.model.cameras} rowsOf={rowsOf} cameraId={camera?.id ?? ""} selectedKey={ed.selectedKey} onSelect={ed.select} quote={quoteFor()} />
            ) : (
              <select
                aria-label={t("speakerView.framing.cameras")}
                className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                value={camera?.id}
                onChange={(e) => {
                  const c = ed.model.cameras.find((x) => x.id === e.target.value)
                  const first = c?.pairs[0]
                  if (c && first) ed.select(c.id, pairKey(first.source, first.speaker))
                }}
              >
                {ed.model.cameras.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
              </select>
            )}
            <div className="flex min-w-0 flex-col gap-2">
              <span className="text-xs text-muted-foreground tabular-nums" dir="ltr">{cameraLine}</span>
              {frame.failed && (
                <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px]" data-testid="region-no-frame">
                  {fallbackNote}
                </p>
              )}
              <RegionCanvas
                media={media}
                videoRef={videoRef}
                imageRef={imageRef}
                size={frame.size}
                boxes={boxes}
                selectedKey={ed.selectedKey}
                coverCrop={ed.crop && frame.size ? { x: ed.crop.x / frame.size.width, y: ed.crop.y / frame.size.height, w: ed.crop.w / frame.size.width, h: ed.crop.h / frame.size.height } : undefined}
                onSelect={(key) => camera && ed.select(camera.id, key)}
                onDragStart={() => ed.dispatch({ type: "checkpoint" })}
                onChange={(key: string, region: Region) => ed.dispatch({ type: "live", key, region })}
                onVideoMeta={(size, durationMs) => camera && ed.noteFrame(camera.id, { size, ...(durationMs > 0 ? { durationMs } : {}) })}
                onImageSize={(size) => {
                  if (camera && !ed.frameOf(camera).size) ed.noteFrame(camera.id, { size })
                  setFrameTick((n) => n + 1)
                }}
                onMediaError={() => camera && ed.noteFrame(camera.id, { failed: true })}
                onTime={onTime}
                emptyLabel={t("speakerView.framing.noFrame")}
              />
              {camera && (
                <RegionTransport
                  camera={camera}
                  timeMs={timeMs}
                  durationMs={frame.durationMs}
                  playable={media.kind === "video"}
                  turns={ed.model.turns}
                  onSeekMaster={(masterMs) => seekTo(masterToSourceMs(masterMs, camera.offsetMs))}
                  onSeekSource={seekTo}
                  canSwap={camera.pairs.length === 2 && frame.size !== undefined}
                  onSwap={ed.swap}
                  onFull={ed.fullFrame}
                  hasBox={pair ? ed.regionOf(camera, pair.speaker) !== null : false}
                  onDraw={() => {
                    if (!ed.selectedKey) return
                    const s = ed.slot && frame.size ? ed.slot.width / ed.slot.height / (frame.size.width / frame.size.height) : 0.5
                    const w = Math.min(1, Math.max(0.1, s))
                    ed.setBox(ed.selectedKey, { x: (1 - w) / 2, y: 0, w, h: 1 })
                  }}
                />
              )}
              {!wide && camera && pair && (
                <div className="flex items-center justify-center gap-2 text-sm">
                  <Button variant="ghost" size="icon" aria-label={t("speakerView.framing.prevBox")} onClick={() => cycle(-1)}><ChevronLeft className={cn("w-4 h-4", flip)} /></Button>
                  <span className="font-medium">{pair.speaker}</span>
                  <Button variant="ghost" size="icon" aria-label={t("speakerView.framing.nextBox")} onClick={() => cycle(1)}><ChevronRight className={cn("w-4 h-4", flip)} /></Button>
                </div>
              )}
              {!wide && showAsPicker}
            </div>
            {output}
          </div>
        )}
      </InspectorShell>
      <DiscardFramingDialog open={confirming} onKeep={() => setConfirming(false)} onDiscard={() => { setConfirming(false); onClose() }} />
    </>
  )
}
