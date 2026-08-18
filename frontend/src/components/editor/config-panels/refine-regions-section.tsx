"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, ScanSearch, Wand2 } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { getJobStatusLean, grokRegionEdit, grokSegmentMap } from "@/lib/api"
import { pollImageRefineToNode } from "../workflow-editor/poll-job"
import type { GenerateImageData, GeneratedResult, GrokSegmentInfo } from "@/types/nodes"

/**
 * "Refine regions" — grok-2's task-chained region editing, in the Generate
 * Image panel. One free segment-map call turns the active result into named
 * region tiles; the user ticks regions and runs a prompt edit restricted to
 * them (or leaves none ticked for a whole-image edit). The edit lands as a
 * new version in the node's result strip, carrying its own kieTaskId so it
 * can itself be segmented and refined again.
 *
 * Grok's segment `maskUrl`s are NOT full-frame masks — they are ~128×128 RGB
 * CUTOUT previews of each region (bounding-box crop on white), so they render
 * as tile thumbnails; there is no geometry to overlay them on the result.
 * Segment `index` values pass through verbatim (0-based in production).
 *
 * Only mounted for provider `grok-2` (the edit endpoint references a prior
 * grok-2 generation's KIE task id — it cannot edit arbitrary images), and
 * only useful once the active result carries a `kieTaskId`.
 */

/** ~3 min at 2s ticks — the segment map usually completes in seconds. */
const SEGMENT_POLL_INTERVAL_MS = 2000
const SEGMENT_POLL_MAX_TICKS = 90

interface RefineRegionsSectionProps {
  readonly nodeId: string
  readonly data: GenerateImageData
  readonly onUpdate: (updates: Partial<GenerateImageData>) => void
}

/** Zip the job's order-aligned cutout URLs + {index,name} pairs into GrokSegmentInfo[]. */
function segmentsFromOutput(od: Record<string, unknown>): GrokSegmentInfo[] {
  const meta = Array.isArray(od.segments) ? (od.segments as { index?: unknown; name?: unknown }[]) : []
  const primary = typeof od.imageUrl === "string" ? [od.imageUrl] : []
  const urls = Array.isArray(od.imageUrls)
    ? (od.imageUrls.filter((u) => typeof u === "string") as string[])
    : primary
  const count = Math.min(meta.length, urls.length)
  const out: GrokSegmentInfo[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      index: typeof meta[i].index === "number" ? (meta[i].index as number) : i,
      name: typeof meta[i].name === "string" ? (meta[i].name as string) : `Region ${i + 1}`,
      maskUrl: urls[i],
    })
  }
  return out
}

export function RefineRegionsSection({ nodeId, data, onUpdate }: RefineRegionsSectionProps) {
  const [detecting, setDetecting] = useState(false)
  const [detectError, setDetectError] = useState<string | undefined>()
  const [applying, setApplying] = useState(false)
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
      const { jobId } = await grokSegmentMap(taskId)
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
          {/* Segment tiles — each shows Grok's cutout preview of the region */}
          {segments ? (
            <div className="grid grid-cols-3 gap-1.5" data-testid="region-chip-list">
              {segments.map((seg) => {
                const isSelected = selected.includes(seg.index)
                return (
                  <button
                    key={seg.index}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => toggleSegment(seg.index)}
                    title={seg.name || `Region ${seg.index}`}
                    className={cn(
                      "flex flex-col items-stretch rounded-lg border overflow-hidden transition-colors text-left",
                      isSelected
                        ? "border-[#ff0073] ring-1 ring-[#ff0073] bg-[#ff0073]/10"
                        : "hover:bg-muted border-border dark:border-[#2D2D2D]",
                    )}
                  >
                    <span className="bg-white aspect-square w-full overflow-hidden">
                      <img
                        src={seg.maskUrl}
                        alt={seg.name || `Region ${seg.index}`}
                        loading="lazy"
                        className="w-full h-full object-contain"
                      />
                    </span>
                    <span
                      className={cn(
                        "px-1.5 py-1 text-[10px] leading-tight truncate",
                        isSelected ? "text-foreground font-medium" : "text-muted-foreground",
                      )}
                    >
                      {seg.name || `Region ${seg.index}`}
                    </span>
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
