// Face masking for every run of the trend (hidden from users): Off, Always
// (the faces in the clip are covered before the video model sees it), or Auto
// (only when the video model refuses the clip, one retry with them covered;
// a full run whose preview needed it is masked from the start). The settings
// are the platform's Cast Swap ones; a field left empty takes the engine's
// default, shown as its placeholder and never written into the draft.
// Margins: left out, the engine leaves 10 % at the left and right (shown as
// placeholders); the first margin typed writes the whole default zone with it,
// so what is saved is what the fields show; "No margins" saves `zone: null`.
// Covers: the whole head (the default: also hides the hair and people seen from
// behind) or the face alone (the hair stays visible); shown as Head when left out.
//
// A trend's clip preparation (`source`, chosen above it: ClipPreparationSelect)
// decides which fields apply. Faces hidden: all of them. Full depth: none (it
// always runs, and nothing else is read). Keep people: always runs, no fill;
// what is kept is the whole person by default (Body, offered only there), the
// head or the face. Admin → Nodaro Motion's Precise setting masks faces only
// and passes none; its Motion setting may pass Full depth.
//
// Full depth shows where the run's scene comes from (FullDepthSceneSelect):
// a description (the default), the original clip, or none.

import { useId } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  TrendEngineEnvironment,
  AdminTrendFaceMasking,
  AdminTrendFaceMaskingFill,
  AdminTrendFaceMaskingMode,
  AdminTrendFaceMaskingSource,
  AdminTrendFaceMaskingTarget,
  AdminTrendFaceMaskingZone,
} from "@/lib/api"
import { FACE_MASKING_BOUNDS, FACE_MASKING_DEFAULTS, ZONE_SIDES, maskingUsesBlur } from "../model"
import { defaultTargetFor, isDepthPreparation } from "../clip-preparation"
import { FullDepthSceneSelect } from "./FullDepthSceneSelect"

const MODES: ReadonlyArray<{ value: AdminTrendFaceMaskingMode; label: string; hint: string }> = [
  { value: "off", label: "Off", hint: "Runs as before: the clip goes to the video model as it is." },
  { value: "always", label: "Always", hint: "Every run covers the faces in the clip first (it costs more)." },
  {
    value: "auto",
    label: "Auto",
    hint: "Only when the video model refuses the clip: one retry with the faces covered, charged only then. A full run whose preview needed it is covered from the start.",
  },
]

const TARGETS: ReadonlyArray<{ value: AdminTrendFaceMaskingTarget; label: string; hint: string }> = [
  { value: "head", label: "Head (default)", hint: "Covers the whole head: also hides the hair and people seen from behind (a bigger mask)." },
  { value: "face", label: "Face", hint: "Covers the face only: the hair stays visible, and people turned away are not covered." },
]

/** Keep people: what stays as filmed (the rest becomes depth). */
const KEEP_TARGETS: ReadonlyArray<{ value: AdminTrendFaceMaskingTarget; label: string; hint: string }> = [
  { value: "body", label: "Whole person (default)", hint: "Keeps each whole person as filmed; everything around them becomes depth." },
  { value: "head", label: "Head", hint: "Keeps only the heads as filmed (hair included); the bodies become depth with the rest." },
  { value: "face", label: "Face", hint: "Keeps only the faces as filmed; everything else becomes depth." },
]

const FILLS: ReadonlyArray<{ value: AdminTrendFaceMaskingFill; label: string }> = [
  { value: "blur", label: "Blur (default)" },
  { value: "depth", label: "Depth colors" },
]

const ZONE_LABELS: Readonly<Record<keyof AdminTrendFaceMaskingZone, string>> = {
  leftPct: "Left",
  rightPct: "Right",
  topPct: "Top",
  bottomPct: "Bottom",
}

interface Props {
  /** As stored; undefined = the draft has none (off). */
  readonly value: AdminTrendFaceMasking | undefined
  readonly onChange: (next: AdminTrendFaceMasking | undefined) => void
  /**
   * The line under Auto, where it differs from a trend's (Admin → Nodaro
   * Motion: a direct run has no preview that carries over).
   */
  readonly autoHint?: string
  /** The trend's clip preparation (left out: Faces hidden, the only one Admin → Nodaro Motion has). */
  readonly source?: AdminTrendFaceMaskingSource
  /**
   * The targets some environment's engine declares (`castSwap.faceMaskTargets`);
   * unknown when left out. Keep people's whole person is offered greyed out
   * while no engine declares it.
   */
  readonly supportedTargets?: readonly AdminTrendFaceMaskingTarget[]
  /** The source clip's length, when known: Full depth's original scene takes up to 27.5 s. */
  readonly clipSec?: number
  /** Each environment's engine, as reported (Full depth's scene names those that can't take it). */
  readonly envs?: readonly TrendEngineEnvironment[]
}

export function FaceMaskingEditor({ value, onChange, autoHint, source = "faces", supportedTargets, clipSec, envs }: Props) {
  const depth = isDepthPreparation(source)
  const keepPeople = source === "keep-people"
  const mode = depth ? "always" : (value?.mode ?? "off")
  // A key set to undefined (a field emptied, "No margins" unticked) is removed, never kept as
  // `key: undefined`, so the draft holds only what is set.
  const set = (patch: Partial<AdminTrendFaceMasking>) => onChange(definedOnly({ ...(value ?? { mode: "off" }), ...patch }))
  // A zone with any margin set: its empty margins are 0. None set: the default margins.
  const zoneGiven = !!value?.zone && ZONE_SIDES.some((side) => typeof value.zone?.[side] === "number")
  const noMargins = value?.zone === null
  // The first margin typed into the default zone keeps the default's other margins, as shown.
  // Every margin emptied is the zone left out again (the default), with no `zone` key kept.
  const setZone = (side: keyof AdminTrendFaceMaskingZone, v: number | undefined) => {
    const zone: AdminTrendFaceMaskingZone = { ...(zoneGiven ? value?.zone : FACE_MASKING_DEFAULTS.zone), [side]: v }
    set({ zone: ZONE_SIDES.some((s) => typeof zone[s] === "number") ? zone : undefined })
  }
  const setMode = (m: AdminTrendFaceMaskingMode) => {
    // Off with nothing else set is the same as no setting: keep the draft as it was.
    if (m === "off" && (!value || Object.keys(definedOnly(value)).length === 1)) onChange(undefined)
    else set({ mode: m })
  }
  const hint = depth
    ? "Always: the clip is prepared once, approved and stored, and every run uses it."
    : mode === "auto" && autoHint
      ? autoHint
      : MODES.find((m) => m.value === mode)?.hint
  // A fill left out is the engine's default. The blur strength belongs to the blur fill only: hidden
  // otherwise, and then neither checked nor saved (`maskingUsesBlur`), so it never holds Save.
  const fill = value?.fill ?? FACE_MASKING_DEFAULTS.fill
  // A target left out is the engine's default (the head; Keep people's: the whole person), shown as such.
  const targets = keepPeople ? KEEP_TARGETS : TARGETS
  const target = value?.target ?? (keepPeople ? defaultTargetFor(source) : FACE_MASKING_DEFAULTS.target)
  const targetHint = targets.find((t) => t.value === target)?.hint
  // Only the whole person is ever greyed out: the head is every engine's, and the face is held at publish.
  const bodyUnsupported = keepPeople && !!supportedTargets && !supportedTargets.includes("body")
  const word = keepPeople ? "person" : "face"
  const id = useId()
  const modeId = `${id}-mode`
  const fillId = `${id}-fill`
  const hintId = `${id}-hint`
  const targetId = `${id}-target`
  const targetHintId = `${id}-target-hint`
  const noMarginsId = `${id}-no-margins`

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {!depth && (
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={modeId} className="font-medium">
            Mode
          </label>
          <Select value={mode} onValueChange={(m) => setMode(m as AdminTrendFaceMaskingMode)}>
            <SelectTrigger id={modeId} className="h-9" aria-describedby={hint ? hintId : undefined}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        )}
        {mode !== "off" && !depth && (
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={fillId} className="font-medium">
              Fill
            </label>
            <Select value={fill} onValueChange={(f) => set({ fill: f as AdminTrendFaceMaskingFill })}>
              <SelectTrigger id={fillId} className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILLS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}

      {source === "full-depth" && (
        <FullDepthSceneSelect value={value?.scene} clipSec={clipSec} envs={envs} onChange={(scene) => set({ scene })} />
      )}

      {mode !== "off" && source !== "full-depth" && (
        <>
          <div className="flex flex-col gap-1 text-sm sm:w-1/2 sm:pr-1.5">
            <label htmlFor={targetId} className="font-medium">
              {keepPeople ? "Keeps" : "Covers"}
            </label>
            <Select value={target} onValueChange={(t) => set({ target: t as AdminTrendFaceMaskingTarget })}>
              <SelectTrigger id={targetId} className="h-9" aria-describedby={targetHint ? targetHintId : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {targets.map((t) => (
                  <SelectItem key={t.value} value={t.value} disabled={t.value === "body" && bodyUnsupported && target !== "body"}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {targetHint && (
              <span id={targetHintId} className="text-xs text-muted-foreground">
                {targetHint}
              </span>
            )}
            {bodyUnsupported && (
              <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
                No environment's Cast Swap engine keeps whole people yet: the engine is out of date.
              </span>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField
              label={`Smallest ${word} height (%)`}
              help={keepPeople ? "Only people at least this tall are kept as filmed." : "Only faces at least this tall are covered."}
              value={value?.minFaceHeightPct}
              placeholder={FACE_MASKING_DEFAULTS.minFaceHeightPct}
              bounds={FACE_MASKING_BOUNDS.faceHeightPct}
              step={1}
              onChange={(v) => set({ minFaceHeightPct: v })}
            />
            <NumberField
              label={`Largest ${word} height (%)`}
              help="0 = no limit."
              value={value?.maxFaceHeightPct}
              placeholder={FACE_MASKING_DEFAULTS.maxFaceHeightPct}
              bounds={FACE_MASKING_BOUNDS.faceHeightPct}
              step={1}
              onChange={(v) => set({ maxFaceHeightPct: v })}
            />
            {!keepPeople && maskingUsesBlur({ fill }) && (
              <NumberField
                label="Blur strength (%)"
                help="Of the frame's width, for the blur fill."
                value={value?.blurStrengthPct}
                placeholder={FACE_MASKING_DEFAULTS.blurStrengthPct}
                bounds={FACE_MASKING_BOUNDS.blurStrengthPct}
                step={0.1}
                onChange={(v) => set({ blurStrengthPct: v })}
              />
            )}
            <NumberField
              label="Detection threshold"
              help={keepPeople ? "Lower finds more people." : "Lower finds more faces."}
              value={value?.threshold}
              placeholder={FACE_MASKING_DEFAULTS.threshold}
              bounds={FACE_MASKING_BOUNDS.threshold}
              step={0.05}
              onChange={(v) => set({ threshold: v })}
            />
          </div>
          <fieldset className="flex flex-col gap-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Margins (%)</legend>
            <p className="text-xs text-muted-foreground">
              {keepPeople
                ? `A person centred inside a margin becomes depth with the rest. Left empty: ${FACE_MASKING_DEFAULTS.zone.leftPct} % at the left and right (the default), so people at the edges of the frame are not kept.`
                : `A face centred inside a margin is left as it is. Left empty: ${FACE_MASKING_DEFAULTS.zone.leftPct} % at the left and right (the default), so people at the edges of the frame are not covered.`}
            </p>
            <div className="flex min-h-11 items-center gap-2 text-sm">
              <Checkbox
                id={noMarginsId}
                checked={noMargins}
                onCheckedChange={(checked) => set({ zone: checked === true ? null : undefined })}
              />
              <label htmlFor={noMarginsId}>{keepPeople ? "No margins: keep people anywhere in the frame" : "No margins: cover faces anywhere in the frame"}</label>
            </div>
            {!noMargins && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {ZONE_SIDES.map((side) => (
                  <NumberField
                    key={side}
                    label={ZONE_LABELS[side]}
                    value={value?.zone?.[side]}
                    placeholder={zoneGiven ? FACE_MASKING_DEFAULTS.zonePct : FACE_MASKING_DEFAULTS.zone[side]}
                    bounds={FACE_MASKING_BOUNDS.zonePct}
                    step={1}
                    onChange={(v) => setZone(side, v)}
                  />
                ))}
              </div>
            )}
          </fieldset>
        </>
      )}
    </div>
  )
}

/** The setting without its undefined keys (`zone: null`, "no margins", is kept). */
function definedOnly(m: AdminTrendFaceMasking): AdminTrendFaceMasking {
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)) as AdminTrendFaceMasking
}

interface NumberFieldProps {
  readonly label: string
  readonly help?: string
  readonly value: number | undefined
  readonly placeholder: number
  readonly bounds: readonly [number, number]
  readonly step: number
  readonly onChange: (v: number | undefined) => void
}

/** Empty = the engine's default (never NaN). */
function NumberField({ label, help, value, placeholder, bounds: [min, max], step, onChange }: NumberFieldProps) {
  const invalid = value !== undefined && !(value >= min && value <= max)
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <Input
        id={id}
        aria-describedby={help ? `${id}-help` : undefined}
        type="number"
        inputMode="decimal"
        className="h-9"
        min={min}
        max={max}
        step={step}
        value={value ?? ""}
        placeholder={String(placeholder)}
        aria-invalid={invalid}
        onChange={(e) => {
          const raw = e.target.value
          const n = raw === "" ? undefined : Number(raw)
          onChange(n === undefined || Number.isNaN(n) ? undefined : n)
        }}
      />
      {help && (
        <span id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </span>
      )}
    </div>
  )
}
