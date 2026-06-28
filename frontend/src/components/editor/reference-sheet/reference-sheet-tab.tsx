import { useMemo, useState } from "react"
import { toast } from "sonner"
import {
  DEFAULT_SECTIONS,
  SHEET_SKINS,
  SHEET_TYPES,
  SHEET_ASPECTS,
  planSheetGeneration,
  type ReferenceSheet,
  type SheetAspect,
  type SheetFlavour,
  type SheetSection,
  type SheetSkin,
  type SheetType,
} from "@nodaro/shared"
import { generateReferenceSheet, getJobStatusLean } from "@/lib/api"
import type { SheetTabAdapter } from "./sheet-tab-adapter"
import { CharacterSheetPanel } from "./character-sheet-panel"
import { SheetGallery } from "./sheet-gallery"

/**
 * Shared "Sheet" tab for the Character / Object / Location studio modals.
 *
 * Orchestrates the two-stage reference-sheet flow:
 *   Stage A — `planSheetGeneration` (pure, @nodaro/shared) splits the chosen
 *     sheet type's panels into already-present vs missing. Each missing panel is
 *     fired via the entity's `generate-*-asset` route (through the adapter) and
 *     awaited to completion so the worker has auto-attached it to the entity
 *     row's bucket BEFORE compose.
 *   Stage B — `generateReferenceSheet` composes the sheet; we poll the job to
 *     completion and surface the result image.
 *
 * The three studio hooks are non-symmetric; everything entity-specific is
 * funnelled through `adapter` (see `sheet-tab-adapter.ts`). `studio`/`jobs` are
 * `any` ONLY as opaque pass-through to the adapter — no field is read off them
 * directly here.
 */

type Status = "idle" | "generating" | "done" | "error"

const SHEET_POLL_MS = 2000
const SHEET_POLL_MAX_ATTEMPTS = 180 // ~6 min ceiling

interface ReferenceSheetTabProps {
  readonly adapter: SheetTabAdapter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque pass-through to the adapter
  readonly studio: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque pass-through to the adapter
  readonly jobs: any
  /** Studio accent (character #3b82f6; object/location #22d3ee). */
  readonly accent?: string
}

/** Classic chip UI (object/location). Character uses CharacterSheetPanel. */
function ClassicSheetPanel({ adapter, studio, jobs, accent = "#22d3ee" }: ReferenceSheetTabProps) {
  const staged = adapter.getStaged(studio)

  const [type, setType] = useState<SheetType>("full-reference")
  const [skin, setSkin] = useState<SheetSkin>("studio")
  const [aspect, setAspect] = useState<SheetAspect>("landscape")
  const [withText, setWithText] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [status, setStatus] = useState<Status>("idle")
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [progressLine, setProgressLine] = useState<string>("")

  const sourceImageUrl: string | undefined = staged?.sourceImageUrl
  const name: string =
    staged?.characterName || staged?.objectName || staged?.locationName || staged?.name || "Subject"
  const existingSheets: ReferenceSheet[] = useMemo(
    () => (Array.isArray(staged?.sheets) ? (staged!.sheets as ReferenceSheet[]) : []),
    [staged],
  )

  const isGenerating = status === "generating"
  const canGenerate = Boolean(sourceImageUrl) && !isGenerating

  async function pollSheet(jobId: string): Promise<{ imageUrl: string; panelUrls: string[] }> {
    for (let attempt = 0; attempt < SHEET_POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise((r) => setTimeout(r, SHEET_POLL_MS))
      // Fetch the latest status. A transient network failure is swallowed and
      // retried next tick; a TERMINAL job status (completed/failed/cancelled) is
      // handled outside the catch so the loop always exits on it — never waits
      // for the timeout just because a `failed` job's `error_message` didn't
      // match some message pattern.
      let job: Awaited<ReturnType<typeof getJobStatusLean>> | undefined
      try {
        job = await getJobStatusLean(jobId)
      } catch {
        continue // transient fetch failure — retry
      }
      if (job.status === "completed") {
        const out = job.output_data as { imageUrl?: string; panelUrls?: string[] } | undefined
        if (out?.imageUrl) return { imageUrl: out.imageUrl, panelUrls: out.panelUrls ?? [] }
        throw new Error("Sheet completed without an image URL")
      }
      if (job.status === "failed" || job.status === "cancelled") {
        throw new Error(job.error_message ?? `sheet ${job.status}`)
      }
    }
    throw new Error("sheet generation timed out")
  }

  async function onGenerate(): Promise<void> {
    if (!sourceImageUrl) {
      toast.error("Approve a main image first")
      return
    }
    setStatus("generating")
    setResultUrl(null)
    setProgressLine("Preparing…")
    try {
      const dbId = await adapter.ensureSaved(studio)

      // Clone the preset stack to a mutable SheetSection[] so the flavour owns it.
      const sections: SheetSection[] = (DEFAULT_SECTIONS[adapter.entityKind][type] ?? []).map((s) => ({ ...s }))
      const flavour: SheetFlavour = { outputFormat: "still", withText, showLabels, aspect, background: "grey", sections }

      // Stage A — split present vs missing, then generate the missing panels and
      // await each so the worker has attached them to the row before compose.
      const { missing } = planSheetGeneration(
        adapter.entityKind,
        sections,
        flavour,
        adapter.bucketsByColumn(staged),
        name,
      )
      const total = missing.length
      for (let i = 0; i < total; i++) {
        const req = missing[i]
        setProgressLine(`Generating panels ${i + 1}/${total} — ${req.variant}…`)
        // eslint-disable-next-line no-await-in-loop -- panels generated sequentially so the credit guard isn't slammed
        const { jobId } = await adapter.generateAsset(dbId, {
          ...req,
          name: `${name} – ${req.variant}`,
          sourceImageUrl,
        })
        // eslint-disable-next-line no-await-in-loop -- await each panel before compose
        await adapter.awaitJob(jobs, jobId, req.assetType, req.variant)
      }

      // Stage B — compose the sheet from the (now complete) entity buckets.
      setProgressLine(total > 0 ? `Composing sheet… (${total} panels)` : "Composing sheet…")
      const { jobId } = await generateReferenceSheet({
        type,
        skin,
        entityKind: adapter.entityKind,
        entityDbId: dbId,
        flavour,
      })
      const { imageUrl: url, panelUrls } = await pollSheet(jobId)
      setResultUrl(url)

      // Append the new sheet to staged so the "Existing sheets" grid + the
      // sidebar badges update immediately, without waiting for a refetch. Shape
      // mirrors the record the worker persists into the `sheets` column
      // (`attachSheet` in workers/handlers/reference-sheet.ts) so a later
      // hydration dedupes against this entry by url instead of duplicating it.
      const newSheet = {
        name: `${type} · ${skin}`,
        url,
        type,
        skin,
        flavour,
        source: "node",
        panelUrls,
      } as unknown as ReferenceSheet
      studio.patch({ sheets: [...(staged?.sheets ?? []), newSheet] })

      setStatus("done")
      setProgressLine("")
      toast.success("Reference sheet generated")
    } catch (e) {
      setStatus("error")
      setProgressLine("")
      toast.error(e instanceof Error ? e.message : "Sheet generation failed")
    }
  }

  function onSetThumbnail(url: string, label: string): void {
    adapter.setThumbnail(studio, url, label)
    toast.success("Set as node thumbnail")
  }

  const chip = (active: boolean) =>
    `px-3 py-1 text-[11px] rounded border transition-colors ${
      active
        ? "text-white border-transparent"
        : "bg-[#1a1d27] hover:bg-[#1e293b] border-[#1e293b] text-slate-300"
    }`
  const chipStyle = (active: boolean) => (active ? { backgroundColor: accent } : undefined)

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Type picker */}
      <div className="space-y-1.5">
        <div className="text-[9px] uppercase tracking-widest text-slate-600">Sheet type</div>
        <div className="flex flex-wrap gap-2">
          {SHEET_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              disabled={isGenerating}
              className={chip(type === t)}
              style={chipStyle(type === t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Skin picker */}
      <div className="space-y-1.5">
        <div className="text-[9px] uppercase tracking-widest text-slate-600">Skin</div>
        <div className="flex flex-wrap gap-2">
          {SHEET_SKINS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSkin(s)}
              disabled={isGenerating}
              className={chip(skin === s)}
              style={chipStyle(skin === s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Aspect + text toggles */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="space-y-1.5">
          <div className="text-[9px] uppercase tracking-widest text-slate-600">Aspect</div>
          <div className="flex gap-2">
            {SHEET_ASPECTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAspect(a)}
                disabled={isGenerating}
                className={chip(aspect === a)}
                style={chipStyle(aspect === a)}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={withText}
            onChange={(e) => setWithText(e.target.checked)}
            disabled={isGenerating}
            style={{ accentColor: accent }}
          />
          Title / metadata
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={showLabels}
            onChange={(e) => setShowLabels(e.target.checked)}
            disabled={isGenerating}
            style={{ accentColor: accent }}
          />
          Panel labels
        </label>
      </div>

      {/* Generate */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void onGenerate()}
          disabled={!canGenerate}
          className="px-4 py-2 text-[12px] rounded text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ backgroundColor: accent }}
        >
          {isGenerating ? "Generating…" : "Generate sheet"}
        </button>
        {!sourceImageUrl && (
          <span className="text-[11px] text-amber-300">Approve a main image first</span>
        )}
        {isGenerating && progressLine && (
          <span className="text-[11px] text-slate-400">{progressLine}</span>
        )}
      </div>

      {/* Result + existing sheets (fullscreen + copy-URL) */}
      <SheetGallery
        result={resultUrl ? { url: resultUrl, label: `${type} sheet` } : null}
        sheets={existingSheets}
        onSetThumbnail={onSetThumbnail}
        accent={accent}
      />
    </div>
  )
}

/**
 * Shared "Sheet" tab dispatcher. Character gets the named-preset two-step UI;
 * object/location keep the classic chip UI (their boards have no head/body
 * turnaround, so presets don't apply). No hooks here — the branch is on the
 * fixed `adapter.entityKind`, so each mounted instance renders one panel.
 */
export function ReferenceSheetTab(props: ReferenceSheetTabProps) {
  if (props.adapter.entityKind === "character") {
    return <CharacterSheetPanel adapter={props.adapter} studio={props.studio} jobs={props.jobs} accent={props.accent ?? "#3b82f6"} />
  }
  return <ClassicSheetPanel {...props} />
}

export default ReferenceSheetTab
