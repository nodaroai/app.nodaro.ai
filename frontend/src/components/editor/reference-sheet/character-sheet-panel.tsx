import { useMemo, useState } from "react"
import { toast } from "sonner"
import { SHEET_PRESETS, ALA_CARTE_BOARDS, SHEET_SKINS, SHEET_ASPECTS, MAX_PANELS_PER_SHEET, estimateSheetCost, type ReferenceSheet, type SheetAspect, type SheetFlavour, type SheetPresetId, type SheetPreset, type SheetSection, type SheetSkin } from "@nodaro/shared"
import { generateReferenceSheet, getJobStatusLean } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import type { SheetTabAdapter } from "./sheet-tab-adapter"
import { SheetGallery } from "./sheet-gallery"

/**
 * Character-only Sheet panel: named, explained, live-costed presets
 * (Studio·Main / Studio·Extended) + optional à-la-carte boards, then a two-step
 * ① Prepare angles → ② Compose flow. Curated panel subsets ride the shared
 * `entries` field; cost is the existing per-angle + assembly price, gated behind
 * hasCredits(). Object/Location keep the classic chip UI (see reference-sheet-tab).
 */

const SHEET_POLL_MS = 2000
const SHEET_POLL_MAX_ATTEMPTS = 180 // ~6 min ceiling

type Status = "idle" | "preparing" | "composing" | "done" | "error"
type Bucket = Record<string, Array<{ name?: string; url?: string }> | undefined>

interface Props {
  readonly adapter: SheetTabAdapter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque pass-through to the adapter
  readonly studio: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque pass-through to the adapter
  readonly jobs: any
  readonly accent: string
}

export function CharacterSheetPanel({ adapter, studio, jobs, accent }: Props) {
  const staged = adapter.getStaged(studio)
  const hc = hasCredits()

  const [presetId, setPresetId] = useState<SheetPresetId>("studio-main")
  const [boards, setBoards] = useState<Set<string>>(() => new Set())
  const [skin, setSkin] = useState<SheetSkin>("studio")
  const [aspect, setAspect] = useState<SheetAspect>("landscape")
  const [withText, setWithText] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [status, setStatus] = useState<Status>("idle")
  const [progressLine, setProgressLine] = useState("")
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [prepared, setPrepared] = useState<Record<string, Array<{ name: string; url: string }>>>({})

  const busy = status === "preparing" || status === "composing"
  const sourceImageUrl: string | undefined = staged?.sourceImageUrl
  const name: string = staged?.characterName || staged?.name || "Subject"
  const existingSheets: ReferenceSheet[] = useMemo(
    () => (Array.isArray(staged?.sheets) ? (staged!.sheets as ReferenceSheet[]) : []),
    [staged],
  )
  const preset = SHEET_PRESETS.find((p) => p.id === presetId)!

  // Entity buckets + the panels prepared THIS session. The studio refetches only
  // on open and `awaitJob` never updates `staged`, so without this local merge the
  // `missing` set never shrinks → Compose never enables (Pass-2 audit fix). Keyed
  // by DB column (snake_case) — the same shape planSheetGeneration consumes.
  const mergedBuckets: Bucket = useMemo(() => {
    const base = staged ? (adapter.bucketsByColumn(staged) as Bucket) : {}
    const out: Bucket = { ...base }
    for (const [col, items] of Object.entries(prepared)) out[col] = [...(base[col] ?? []), ...items]
    return out
  }, [adapter, staged, prepared])

  const sections: SheetSection[] = useMemo(() => {
    const boardSecs = ALA_CARTE_BOARDS.filter((b) => boards.has(b.id)).map((b) => ({ ...b.section }))
    return [...preset.baseSections.map((s) => ({ ...s })), ...boardSecs]
  }, [preset, boards])

  const flavour: SheetFlavour = { outputFormat: "still", withText, showLabels, aspect, background: "grey", presetId, sections }
  const cost = estimateSheetCost("character", sections, flavour, mergedBuckets, name, adapter.perPanelCost, adapter.assemblyCost)

  /** Base cost of a preset (no boards) — shown on each card. */
  function baseCost(p: SheetPreset) {
    return estimateSheetCost("character", p.baseSections, { ...flavour, sections: p.baseSections }, mergedBuckets, name, adapter.perPanelCost, adapter.assemblyCost)
  }

  /** Would toggling board `id` ON push the plan past MAX_PANELS? */
  function wouldOverflow(id: string): boolean {
    if (boards.has(id)) return false
    const next = [...preset.baseSections, ...ALA_CARTE_BOARDS.filter((b) => boards.has(b.id) || b.id === id).map((b) => b.section)]
    const e = estimateSheetCost("character", next.map((s) => ({ ...s })), flavour, mergedBuckets, name, adapter.perPanelCost, adapter.assemblyCost)
    return e.overflow || e.present + e.missing.length > MAX_PANELS_PER_SHEET
  }

  function toggleBoard(id: string): void {
    setBoards((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function pollSheet(jobId: string): Promise<{ imageUrl: string; panelUrls: string[] }> {
    for (let attempt = 0; attempt < SHEET_POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise((r) => setTimeout(r, SHEET_POLL_MS))
      let job: Awaited<ReturnType<typeof getJobStatusLean>> | undefined
      try { job = await getJobStatusLean(jobId) } catch { continue }
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

  async function onPrepare(): Promise<void> {
    if (!sourceImageUrl) { toast.error("Approve a main image first"); return }
    setStatus("preparing"); setProgressLine("Preparing…")
    try {
      const dbId = await adapter.ensureSaved(studio)
      const missing = cost.missing
      for (let i = 0; i < missing.length; i++) {
        const req = missing[i]
        setProgressLine(`Preparing ${i + 1}/${missing.length} — ${req.variant}…`)
        // Sequential: don't slam the credit guard; await each panel + record it so `missing` shrinks.
        const { jobId } = await adapter.generateAsset(dbId, { ...req, name: `${name} – ${req.variant}`, sourceImageUrl })
        const url = await adapter.awaitJob(jobs, jobId, req.assetType, req.variant)
        setPrepared((p) => ({ ...p, [req.attachToColumn]: [...(p[req.attachToColumn] ?? []), { name: req.attachName, url }] }))
      }
      setStatus("idle"); setProgressLine(""); toast.success("Angles prepared")
    } catch (e) {
      setStatus("error"); setProgressLine(""); toast.error(e instanceof Error ? e.message : "Prepare failed")
    }
  }

  async function onCompose(): Promise<void> {
    if (!sourceImageUrl) { toast.error("Approve a main image first"); return }
    setStatus("composing"); setResultUrl(null); setProgressLine("Composing sheet…")
    try {
      const dbId = await adapter.ensureSaved(studio)
      const { jobId } = await generateReferenceSheet({ type: preset.type, skin, entityKind: "character", entityDbId: dbId, flavour })
      const { imageUrl: url, panelUrls } = await pollSheet(jobId)
      setResultUrl(url)
      // Mirror the worker's persisted record (carry presetId for labeling) so the
      // grid updates immediately and a later hydration dedupes by url.
      const newSheet = { name: preset.label, url, type: preset.type, skin, flavour, source: "node", panelUrls } as unknown as ReferenceSheet
      studio.patch({ sheets: [...(staged?.sheets ?? []), newSheet] })
      setPrepared({}); setStatus("done"); setProgressLine(""); toast.success("Reference sheet generated")
    } catch (e) {
      setStatus("error"); setProgressLine(""); toast.error(e instanceof Error ? e.message : "Compose failed")
    }
  }

  function onSetThumbnail(url: string, label: string): void {
    adapter.setThumbnail(studio, url, label)
    toast.success("Set as node thumbnail")
  }

  const chip = (active: boolean, disabled = false) =>
    `px-3 py-1 text-[11px] rounded border transition-colors ${
      disabled ? "opacity-40 cursor-not-allowed bg-[#1a1d27] border-[#1e293b] text-slate-500"
      : active ? "text-white border-transparent"
      : "bg-[#1a1d27] hover:bg-[#1e293b] border-[#1e293b] text-slate-300"
    }`
  const chipStyle = (active: boolean) => (active ? { backgroundColor: accent } : undefined)

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Preset cards */}
      <div className="space-y-1.5">
        <div className="text-[9px] uppercase tracking-widest text-slate-600">Preset</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SHEET_PRESETS.map((p) => {
            const active = p.id === presetId
            const bc = hc ? baseCost(p) : null
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPresetId(p.id)}
                disabled={busy}
                className="text-left p-3 rounded border transition-colors disabled:opacity-60"
                style={{ borderColor: active ? accent : "#1e293b", backgroundColor: active ? `${accent}14` : "#0e1117" }}
              >
                <div className="text-[12px] font-medium text-slate-200">{p.label}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">{p.description}</div>
                {bc && (
                  <div className="text-[10px] text-slate-500 mt-1.5">
                    {bc.present > 0 ? `reuses ${bc.present} · ` : ""}{bc.missing.length} to generate → ~{bc.total} cr
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* À-la-carte boards */}
      <div className="space-y-1.5">
        <div className="text-[9px] uppercase tracking-widest text-slate-600">Add boards</div>
        <div className="flex flex-wrap gap-2">
          {ALA_CARTE_BOARDS.map((b) => {
            const active = boards.has(b.id)
            const overflow = !active && wouldOverflow(b.id)
            const disabled = busy || overflow
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => toggleBoard(b.id)}
                disabled={disabled}
                title={overflow ? "Would exceed 24 panels — remove a board" : undefined}
                className={chip(active, disabled)}
                style={chipStyle(active)}
              >
                {b.label}{b.panelCount > 0 ? ` +${b.panelCount}` : ""}
              </button>
            )
          })}
        </div>
      </div>

      {/* Style row */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="space-y-1.5">
          <div className="text-[9px] uppercase tracking-widest text-slate-600">Skin</div>
          <div className="flex flex-wrap gap-2">
            {SHEET_SKINS.map((s) => (
              <button key={s} type="button" onClick={() => setSkin(s)} disabled={busy} className={chip(skin === s)} style={chipStyle(skin === s)}>{s}</button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="text-[9px] uppercase tracking-widest text-slate-600">Aspect</div>
          <div className="flex gap-2">
            {SHEET_ASPECTS.map((a) => (
              <button key={a} type="button" onClick={() => setAspect(a)} disabled={busy} className={chip(aspect === a)} style={chipStyle(aspect === a)}>{a}</button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
          <input type="checkbox" checked={withText} onChange={(e) => setWithText(e.target.checked)} disabled={busy} style={{ accentColor: accent }} />
          Title / metadata
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
          <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} disabled={busy} style={{ accentColor: accent }} />
          Panel labels
        </label>
      </div>

      {/* Cost + two-step actions */}
      {!sourceImageUrl && <div className="text-[11px] text-amber-300">Approve a main image first</div>}
      {hc && sourceImageUrl && (
        <div className="text-[11px] text-slate-400">
          {cost.overflow
            ? <span className="text-amber-300">Too many panels — remove a board.</span>
            : <>Reuses {cost.present} existing · {cost.missing.length} missing → Prepare ~{cost.prepareCost} cr · Compose {cost.assemblyCost} cr</>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void onPrepare()}
          disabled={busy || !sourceImageUrl || cost.overflow || cost.missing.length === 0}
          className="px-4 py-2 text-[12px] rounded text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ backgroundColor: accent }}
        >
          {status === "preparing" ? "Preparing…" : `① Prepare ${cost.missing.length} angle${cost.missing.length === 1 ? "" : "s"}`}
        </button>
        <button
          type="button"
          onClick={() => void onCompose()}
          disabled={busy || !sourceImageUrl || cost.overflow || cost.missing.length > 0}
          className="px-4 py-2 text-[12px] rounded font-medium border bg-transparent disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ borderColor: accent, color: accent }}
        >
          {status === "composing" ? "Composing…" : "② Compose sheet"}
        </button>
        {!busy && cost.missing.length > 0 && !cost.overflow && (
          <span className="text-[11px] text-slate-500">Prepare {cost.missing.length} angle{cost.missing.length === 1 ? "" : "s"} first</span>
        )}
        {busy && progressLine && <span className="text-[11px] text-slate-400">{progressLine}</span>}
      </div>

      <SheetGallery
        result={resultUrl ? { url: resultUrl, label: preset.label } : null}
        sheets={existingSheets}
        onSetThumbnail={onSetThumbnail}
        accent={accent}
      />
    </div>
  )
}

export default CharacterSheetPanel
