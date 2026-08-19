"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, ScanSearch, Wand2 } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { optimizedImageUrl } from "@/lib/image"
import { getJobStatusLean, grokRegionEdit, grokSegmentMap } from "@/lib/api"
import { pollImageRefineToNode } from "../workflow-editor/poll-job"
import type { GenerateImageData, GeneratedResult, GrokSegmentInfo } from "@/types/nodes"

/**
 * "Refine regions" — grok-2's task-chained region editing, in the Generate
 * Image panel. One free segment-map call turns the active result into named
 * regions; hovering or selecting a region OUTLINES it on the result preview,
 * and a prompt edit restricted to the ticked regions (or the whole image when
 * none) lands as a new version in the node's result strip — which carries its
 * own kieTaskId, so it can itself be segmented and refined again.
 *
 * How the outlines work: Grok returns each segment as a ~128×128 RGBA CUTOUT
 * (the region's own pixels, alpha-masked to its shape, cropped to its
 * bounding box) with NO geometry. The backend recovers each cutout's
 * placement by template-matching it against the source image and persists a
 * normalized `bbox` per segment plus `tile`, the content sub-rect inside the
 * padded tile (see backend/src/lib/grok-segment-placement.ts). Here the
 * cutout's ALPHA channel becomes a CSS mask positioned at that bbox, with the
 * tile's aspect-fit padding mapped OUTSIDE the box (tileFrameStyle) — a
 * shape-accurate silhouette outline. Segments without a confident placement
 * degrade to chips without an on-image outline.
 *
 * Segment `index` values pass through verbatim (0-based in production). Only
 * mounted for provider `grok-2` — the edit endpoint references a prior grok-2
 * generation's KIE task id and cannot edit arbitrary images.
 */

/** Distinct overlay tints, cycled by segment position. Brand pink first. */
const SEGMENT_COLORS = [
  "#ff0073",
  "#38bdf8",
  "#34d399",
  "#fbbf24",
  "#a78bfa",
  "#fb923c",
  "#22d3ee",
  "#f472b6",
] as const

const segmentColor = (position: number) => SEGMENT_COLORS[position % SEGMENT_COLORS.length]

/** ~3 min at 2s ticks — the segment map usually completes in seconds. */
const SEGMENT_POLL_INTERVAL_MS = 2000
const SEGMENT_POLL_MAX_TICKS = 90

interface RefineRegionsSectionProps {
  readonly nodeId: string
  readonly data: GenerateImageData
  readonly onUpdate: (updates: Partial<GenerateImageData>) => void
}

/** Validate an {x,y,w,h} box coming off the wire. */
function readBox(raw: unknown): { x: number; y: number; w: number; h: number } | undefined {
  const b = raw as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | undefined
  return b &&
    typeof b.x === "number" &&
    typeof b.y === "number" &&
    typeof b.w === "number" &&
    typeof b.h === "number"
    ? { x: b.x, y: b.y, w: b.w, h: b.h }
    : undefined
}

/** Zip the job's order-aligned cutout URLs + {index,name,bbox?,tile?} into GrokSegmentInfo[]. */
function segmentsFromOutput(od: Record<string, unknown>): GrokSegmentInfo[] {
  const meta = Array.isArray(od.segments)
    ? (od.segments as { index?: unknown; name?: unknown; bbox?: unknown; tile?: unknown }[])
    : []
  const primary = typeof od.imageUrl === "string" ? [od.imageUrl] : []
  const urls = Array.isArray(od.imageUrls)
    ? (od.imageUrls.filter((u) => typeof u === "string") as string[])
    : primary
  const count = Math.min(meta.length, urls.length)
  const out: GrokSegmentInfo[] = []
  for (let i = 0; i < count; i++) {
    const bbox = readBox(meta[i].bbox)
    const tile = readBox(meta[i].tile)
    out.push({
      index: typeof meta[i].index === "number" ? (meta[i].index as number) : i,
      name: typeof meta[i].name === "string" ? (meta[i].name as string) : `Region ${i + 1}`,
      maskUrl: urls[i],
      ...(bbox ? { bbox } : {}),
      ...(tile ? { tile } : {}),
    })
  }
  return out
}

const pct = (n: number) => `${(n * 100).toFixed(2)}%`

/**
 * The cutout tile carries transparent aspect-fit PADDING around the actual
 * region content, but `bbox` describes the CONTENT box. Stretching the whole
 * tile over the bbox therefore draws the silhouette shrunken (by the padding
 * ratio) and centered — the "regions render too small / off" bug. This frame
 * over-extends the mask surface so the tile's content sub-rect (`tile`)
 * lands exactly on the bbox; the padding maps outside it, where the mask is
 * transparent anyway. Maps stored before `tile` shipped fall back to the
 * whole tile (pre-existing behavior until a free re-detect).
 */
function tileFrameStyle(tile: GrokSegmentInfo["tile"]): React.CSSProperties {
  if (!tile || tile.w <= 0 || tile.h <= 0) return { position: "absolute", inset: 0 }
  return {
    position: "absolute",
    left: `${((-tile.x / tile.w) * 100).toFixed(2)}%`,
    top: `${((-tile.y / tile.h) * 100).toFixed(2)}%`,
    width: `${((1 / tile.w) * 100).toFixed(2)}%`,
    height: `${((1 / tile.h) * 100).toFixed(2)}%`,
  }
}

/**
 * Shape-accurate OUTLINE ring: two layers of the same alpha mask — one
 * dilated by a constant few px (calc), one exact — composited with
 * `exclude`/`xor` so only the rim of the shape shows color. A ring keeps the
 * image visible (the earlier offset-stack approach read as a solid sticker).
 */
function ringStyle(seg: GrokSegmentInfo, color: string): React.CSSProperties {
  const m = `url("${seg.maskUrl}")`
  return {
    position: "absolute",
    inset: 0,
    backgroundColor: color,
    WebkitMaskImage: `${m}, ${m}`,
    maskImage: `${m}, ${m}`,
    WebkitMaskSize: "calc(100% + 6px) calc(100% + 6px), 100% 100%",
    maskSize: "calc(100% + 6px) calc(100% + 6px), 100% 100%",
    WebkitMaskPosition: "center, center",
    maskPosition: "center, center",
    WebkitMaskRepeat: "no-repeat, no-repeat",
    maskRepeat: "no-repeat, no-repeat",
    WebkitMaskComposite: "xor",
    maskComposite: "exclude",
  }
}

/** Soft interior fill so region coverage stays readable under the ring. */
function fillStyle(seg: GrokSegmentInfo, color: string, opacity: number): React.CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    backgroundColor: color,
    opacity,
    WebkitMaskImage: `url("${seg.maskUrl}")`,
    maskImage: `url("${seg.maskUrl}")`,
    WebkitMaskSize: "100% 100%",
    maskSize: "100% 100%",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
  }
}

export function RefineRegionsSection({ nodeId, data, onUpdate }: RefineRegionsSectionProps) {
  const [detecting, setDetecting] = useState(false)
  const [detectError, setDetectError] = useState<string | undefined>()
  const [applying, setApplying] = useState(false)
  const [hoveredIndex, setHoveredIndex] = useState<number | undefined>()
  // Cancels the detect poll loop if the panel unmounts mid-flight.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const activeResult: GeneratedResult | undefined =
    data.generatedResults?.[data.activeResultIndex ?? 0]
  const imageUrl = activeResult?.url ?? data.generatedImageUrl
  // Prefer the ACTIVE result's task id (edits target the version on screen);
  // node-level kieTaskId covers results from before per-result capture.
  const taskId = activeResult?.kieTaskId ?? (data.kieTaskId as string | undefined)

  if (!imageUrl) return null

  // Boolean(taskId) guard matters: with no taskId AND no stored map,
  // `undefined === undefined` would otherwise read as "fresh".
  const segmentsFresh = Boolean(taskId) && data.grokSegments?.taskId === taskId
  const segments = segmentsFresh ? data.grokSegments!.segments : undefined
  const selected = segmentsFresh ? (data.grokSelectedSegments ?? []) : []
  const nodeRunning = data.executionStatus === "running"
  const prompt = data.grokRegionPrompt ?? ""

  async function handleDetect() {
    if (!taskId || detecting) return
    setDetecting(true)
    setDetectError(undefined)
    try {
      const { jobId } = await grokSegmentMap(taskId, imageUrl)
      for (let tick = 0; tick < SEGMENT_POLL_MAX_TICKS; tick++) {
        await new Promise((r) => setTimeout(r, SEGMENT_POLL_INTERVAL_MS))
        if (!aliveRef.current) return
        const job = await getJobStatusLean(jobId)
        if (job.status === "completed") {
          const found = segmentsFromOutput((job.output_data ?? {}) as Record<string, unknown>)
          if (!found.length) throw new Error("No regions detected in this image")
          onUpdate({
            grokSegments: { taskId, segments: found },
            grokSelectedSegments: [],
          })
          return
        }
        if (job.status === "failed") {
          throw new Error(job.error_message ?? "Region detection failed")
        }
      }
      throw new Error("Region detection timed out")
    } catch (err) {
      if (aliveRef.current) {
        setDetectError(err instanceof Error ? err.message : "Region detection failed")
      }
    } finally {
      if (aliveRef.current) setDetecting(false)
    }
  }

  function toggleSegment(index: number) {
    const next = selected.includes(index)
      ? selected.filter((i) => i !== index)
      : [...selected, index]
    onUpdate({ grokSelectedSegments: next })
  }

  async function handleApply() {
    if (!taskId || !prompt.trim() || applying || nodeRunning) return
    setApplying(true)
    const maskIndexes = selected.length ? [...selected].sort((a, b) => a - b) : undefined
    try {
      await pollImageRefineToNode(
        nodeId,
        () => grokRegionEdit(taskId, prompt.trim(), maskIndexes),
        "Region edit",
      )
      // New active result = the edit, with its own kieTaskId — the stored
      // segment map no longer matches it, so the section resets to Detect.
      onUpdate({ grokSelectedSegments: [] })
    } catch {
      // pollImageRefineToNode already surfaced the failure on the node + toast.
    } finally {
      if (aliveRef.current) setApplying(false)
    }
  }

  // Regions outlined on the preview: every selected one, plus the hovered one.
  const outlined = (segments ?? []).filter(
    (seg) => seg.bbox && (selected.includes(seg.index) || hoveredIndex === seg.index),
  )
  // Maps stored before placement shipped (or whose matching failed wholesale)
  // have no geometry at all — offer a free re-detect to upgrade them.
  const noneLocated = Boolean(segments?.length) && segments!.every((seg) => !seg.bbox)

  return (
    <div className="pt-1" data-testid="refine-regions-section">
      <Separator className="mb-3" />
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Refine Regions
      </label>

      {!taskId ? (
        <p className="text-[10px] text-muted-foreground mt-2">
          Run this node again to enable region editing — older results don&apos;t carry the
          Grok task reference the editor needs.
        </p>
      ) : (
        <div className="flex flex-col gap-2 mt-2">
          {/* Result preview — selected/hovered regions are outlined in place */}
          {segments && (
            <div className="relative rounded overflow-hidden border border-border dark:border-[#2D2D2D]">
              <img src={optimizedImageUrl(imageUrl)} alt="Active result" className="w-full h-auto block" />
              {outlined.map((seg) => {
                const position = segments.indexOf(seg)
                const color = segmentColor(position)
                const box = seg.bbox!
                const emphasized = hoveredIndex === seg.index
                return (
                  <div
                    key={seg.index}
                    data-testid={`region-outline-${seg.index}`}
                    className="absolute pointer-events-none"
                    style={{ left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h) }}
                  >
                    {/* Maps the tile's content sub-rect onto the bbox — see tileFrameStyle. */}
                    <div data-testid={`region-tile-frame-${seg.index}`} style={tileFrameStyle(seg.tile)}>
                      <div style={ringStyle(seg, color)} />
                      <div style={fillStyle(seg, color, emphasized ? 0.3 : 0.16)} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Region chips — tiny cutout thumbnail + name; toggling outlines + selects */}
          {segments ? (
            <div className="flex flex-wrap gap-1.5" data-testid="region-chip-list">
              {segments.map((seg, position) => {
                const isSelected = selected.includes(seg.index)
                return (
                  <button
                    key={seg.index}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => toggleSegment(seg.index)}
                    onMouseEnter={() => setHoveredIndex(seg.index)}
                    onMouseLeave={() => setHoveredIndex((h) => (h === seg.index ? undefined : h))}
                    title={seg.bbox ? undefined : "Couldn't locate this region on the image — selectable, but no outline"}
                    className={cn(
                      "flex items-center gap-1.5 pl-1 pr-2 py-1 text-[10px] rounded-full border transition-colors",
                      isSelected
                        ? "border-[#ff0073] bg-[#ff0073]/10 text-foreground"
                        : "hover:bg-muted text-muted-foreground",
                      !seg.bbox && "border-dashed",
                    )}
                  >
                    <span
                      className="w-4 h-4 rounded-full overflow-hidden shrink-0 ring-1"
                      style={{ backgroundColor: "#fff", ["--tw-ring-color" as string]: segmentColor(position) }}
                    >
                      <img src={seg.maskUrl} alt="" loading="lazy" className="w-full h-full object-contain" />
                    </span>
                    {seg.name || `Region ${seg.index}`}
                  </button>
                )
              })}
            </div>
          ) : (
            <button
              type="button"
              onClick={handleDetect}
              disabled={detecting}
              className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-md border border-dashed hover:bg-muted transition-colors disabled:opacity-60"
            >
              {detecting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Detecting regions…
                </>
              ) : (
                <>
                  <ScanSearch className="w-3.5 h-3.5" /> Detect regions
                  <span className="text-muted-foreground">(free)</span>
                </>
              )}
            </button>
          )}
          {/* ALWAYS offered while a map exists — placement quality improves
              server-side over time, and a stored map keeps its old geometry
              until re-detected. Gating this on noneLocated stranded every map
              that had (wrong) outlines with no way to recompute them. */}
          {segments && (
            <button
              type="button"
              onClick={handleDetect}
              disabled={detecting}
              className="self-start text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-60"
            >
              {detecting
                ? "Re-detecting…"
                : noneLocated
                  ? "Outlines unavailable for this map — re-detect (free)"
                  : "Re-detect regions (free)"}
            </button>
          )}
          {detectError && <p className="text-[10px] text-destructive">{detectError}</p>}

          {/* Edit prompt + apply */}
          <Textarea
            rows={2}
            value={prompt}
            onChange={(e) => onUpdate({ grokRegionPrompt: e.target.value })}
            placeholder={
              selected.length
                ? "Describe the change for the selected regions…"
                : "Describe the change (whole image unless regions are selected)…"
            }
            className="text-xs"
            aria-label="Region edit prompt"
          />
          <button
            type="button"
            onClick={handleApply}
            disabled={!prompt.trim() || applying || nodeRunning}
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-md bg-[#ff0073] text-white hover:bg-[#ff0073]/90 transition-colors disabled:opacity-50"
          >
            {applying ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Applying edit…
              </>
            ) : (
              <>
                <Wand2 className="w-3.5 h-3.5" />
                {selected.length ? `Edit ${selected.length} region${selected.length > 1 ? "s" : ""}` : "Edit whole image"}
              </>
            )}
          </button>
          <p className="text-[10px] text-muted-foreground">
            The edit becomes a new version in this node&apos;s results — and can itself be
            segmented and refined again.
          </p>
        </div>
      )}
    </div>
  )
}
