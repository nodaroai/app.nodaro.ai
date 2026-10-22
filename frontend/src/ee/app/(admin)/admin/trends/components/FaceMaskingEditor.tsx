// Face masking for every run of the trend (hidden from users): Off, Always
// (the faces in the clip are covered before the video model sees it), or Auto
// (only when the video model refuses the clip, one retry with them covered;
// a full run whose preview needed it is masked from the start). The settings
// are the platform's Cast Swap ones; a field left empty takes the engine's
// default, shown as its placeholder and never written into the draft.

import { useId } from "react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  AdminTrendFaceMasking,
  AdminTrendFaceMaskingFill,
  AdminTrendFaceMaskingMode,
  AdminTrendFaceMaskingZone,
} from "@/lib/api"
import { FACE_MASKING_BOUNDS, FACE_MASKING_DEFAULTS, ZONE_SIDES } from "../model"

const MODES: ReadonlyArray<{ value: AdminTrendFaceMaskingMode; label: string; hint: string }> = [
  { value: "off", label: "Off", hint: "Runs as before: the clip goes to the video model as it is." },
  { value: "always", label: "Always", hint: "Every run covers the faces in the clip first (it costs more)." },
  {
    value: "auto",
    label: "Auto",
    hint: "Only when the video model refuses the clip: one retry with the faces covered, charged only then. A full run whose preview needed it is covered from the start.",
  },
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
}

export function FaceMaskingEditor({ value, onChange }: Props) {
  const mode = value?.mode ?? "off"
  const set = (patch: Partial<AdminTrendFaceMasking>) => onChange({ ...(value ?? { mode: "off" }), ...patch })
  const setZone = (side: keyof AdminTrendFaceMaskingZone, v: number | undefined) =>
    set({ zone: { ...value?.zone, [side]: v } })
  const setMode = (m: AdminTrendFaceMaskingMode) => {
    // Off with nothing else set is the same as no setting: keep the draft as it was.
    if (m === "off" && (!value || Object.keys(value).length === 1)) onChange(undefined)
    else set({ mode: m })
  }
  const hint = MODES.find((m) => m.value === mode)?.hint
  const id = useId()
  const modeId = `${id}-mode`
  const fillId = `${id}-fill`
  const hintId = `${id}-hint`

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
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
        {mode !== "off" && (
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={fillId} className="font-medium">
              Fill
            </label>
            <Select value={value?.fill ?? "blur"} onValueChange={(f) => set({ fill: f as AdminTrendFaceMaskingFill })}>
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

      {mode !== "off" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField
              label="Smallest face height (%)"
              help="Only faces at least this tall are covered."
              value={value?.minFaceHeightPct}
              placeholder={FACE_MASKING_DEFAULTS.minFaceHeightPct}
              bounds={FACE_MASKING_BOUNDS.faceHeightPct}
              step={1}
              onChange={(v) => set({ minFaceHeightPct: v })}
            />
            <NumberField
              label="Largest face height (%)"
              help="0 = no limit."
              value={value?.maxFaceHeightPct}
              placeholder={FACE_MASKING_DEFAULTS.maxFaceHeightPct}
              bounds={FACE_MASKING_BOUNDS.faceHeightPct}
              step={1}
              onChange={(v) => set({ maxFaceHeightPct: v })}
            />
            <NumberField
              label="Blur strength (%)"
              help="Of the frame's width, for the blur fill."
              value={value?.blurStrengthPct}
              placeholder={FACE_MASKING_DEFAULTS.blurStrengthPct}
              bounds={FACE_MASKING_BOUNDS.blurStrengthPct}
              step={0.1}
              onChange={(v) => set({ blurStrengthPct: v })}
            />
            <NumberField
              label="Detection threshold"
              help="Lower finds more faces."
              value={value?.threshold}
              placeholder={FACE_MASKING_DEFAULTS.threshold}
              bounds={FACE_MASKING_BOUNDS.threshold}
              step={0.05}
              onChange={(v) => set({ threshold: v })}
            />
          </div>
          <fieldset className="flex flex-col gap-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Margins (%)</legend>
            <p className="text-xs text-muted-foreground">A face centred inside a margin is left as it is.</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {ZONE_SIDES.map((side) => (
                <NumberField
                  key={side}
                  label={ZONE_LABELS[side]}
                  value={value?.zone?.[side]}
                  placeholder={FACE_MASKING_DEFAULTS.zonePct}
                  bounds={FACE_MASKING_BOUNDS.zonePct}
                  step={1}
                  onChange={(v) => setZone(side, v)}
                />
              ))}
            </div>
          </fieldset>
        </>
      )}
    </div>
  )
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
