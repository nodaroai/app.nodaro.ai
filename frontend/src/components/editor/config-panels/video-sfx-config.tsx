"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Slider } from "@/components/ui/slider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { hasCredits } from "@/lib/edition"
import { MappableField } from "./mappable-field"
import { PromptHelperButton } from "./prompt-helper-button"
import type { VideoSfxNodeData } from "@/types/nodes"
import type { ConfigProps } from "./types"

/**
 * Settings panel for the Video SFX node — opens when the node is selected
 * and the user clicks its settings button.
 *
 * UI order (matches the Task 22 spec):
 *   1. Audio-replacement disclaimer (top, muted) — the single most common
 *      user confusion about this node is that it REPLACES the original
 *      audio track. Pin the warning at the top so it's seen before any
 *      knob is touched. Suggests Merge Video + Audio as the workaround.
 *   2. Prompt textarea (mappable) with inline AI helper button. The
 *      helper is gated behind `hasCredits()` so community/business builds
 *      don't render it.
 *   3. Negative prompt (single-line) with the default value `"music"`
 *      surfaced in the label so users understand why prompts like
 *      "epic orchestral score" produce silence — MMAudio's Replicate-
 *      side default actively suppresses music.
 *   4. Versions (1-4) — linear credit multiplier, mirrored by the quick
 *      toolbar's × selector.
 *   5. Advanced (collapsed by default):
 *        cfgStrength (1-10, default 4.5) — Slider
 *        numSteps (10-50, default 25) — Slider
 *        seed (blank/-1 = random) — number Input
 *
 * Note: `videoUrl` is NOT a configurable field — it's resolved at
 * execution time from the connected video edge (see VideoSfxNodeData
 * docblock in `frontend/src/types/nodes.ts`).
 *
 * Note: `provider` is NOT exposed in the panel — `replicate-mmaudio`
 * is the only supported model (and it's the data type's literal
 * default). The quick toolbar already shows it as a static pill.
 */
export function VideoSfxConfig({
  data,
  onUpdate,
  sources,
  fieldMappings,
  onMapField,
}: ConfigProps<VideoSfxNodeData>) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  const versions = Math.min(Math.max(1, data.versions ?? 1), 4)
  const cfgStrength = data.cfgStrength ?? 4.5
  const numSteps = data.numSteps ?? 25

  return (
    <div className="flex flex-col gap-3">
      {/* 1. Audio-replacement disclaimer — pinned at the top. The MMAudio
          model writes an entirely new audio track over the input video; any
          dialogue / music / ambient already there is lost. The user
          workaround is to mux the SFX back into the original via Merge
          Video + Audio downstream. */}
      <p className="text-xs text-muted-foreground leading-snug">
        Replaces the video's audio track with generated SFX. Pipe through
        <span className="font-medium text-foreground"> Merge Video + Audio </span>
        to preserve the original audio.
      </p>

      {/* 2. Prompt — mappable from upstream text nodes. The AI helper
          button is wired to `audio-prompt-styles` via `prompt-helper-styles.ts`
          and gated behind `hasCredits()` so community/business builds don't
          show it (the route requires credits to run). */}
      <MappableField
        field="prompt"
        label="Prompt"
        sources={sources}
        fieldMappings={fieldMappings}
        onMapField={onMapField}
        labelAction={
          hasCredits() ? (
            <PromptHelperButton
              nodeType="video-sfx"
              currentPrompt={data.prompt ?? ""}
              provider={data.provider}
              onAccept={(prompt) => onUpdate({ prompt })}
            />
          ) : undefined
        }
      >
        <Textarea
          rows={3}
          value={data.prompt ?? ""}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
          placeholder='e.g. "footsteps on dry leaves", "rain on a metal roof", "engine revving"'
          maxLength={2000}
        />
        <p className="text-xs text-muted-foreground mt-1">
          Leave blank for pure foley driven by the video alone.
        </p>
      </MappableField>

      {/* 3. Negative prompt — surface the default value `"music"` in the
          label so users don't get silent output from "epic orchestral score"-
          style prompts and not understand why. Max 500 chars (route Zod cap). */}
      <MappableField
        field="negativePrompt"
        label='Negative prompt (default: "music")'
        sources={sources}
        fieldMappings={fieldMappings}
        onMapField={onMapField}
      >
        <Input
          type="text"
          value={data.negativePrompt ?? "music"}
          onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
          placeholder="music"
          maxLength={500}
        />
        <p className="text-xs text-muted-foreground mt-1">
          MMAudio actively suppresses music by default. Clear this field if
          you want the model to generate music as the "SFX".
        </p>
      </MappableField>

      {/* 4. Versions — linear credit multiplier (1-4 takes per run).
          Same lever exposed in the hover quick toolbar. */}
      <MappableField
        field="versions"
        label="Versions"
        sources={sources}
        fieldMappings={fieldMappings}
        onMapField={onMapField}
      >
        <Select
          value={String(versions)}
          onValueChange={(v) => {
            const n = parseInt(v, 10)
            onUpdate({ versions: Number.isFinite(n) ? Math.min(Math.max(1, n), 4) : 1 })
          }}
        >
          <SelectTrigger aria-label="Versions"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} {n === 1 ? "take" : "takes"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          Generates N distinct SFX takes per run. Linear credit cost.
        </p>
      </MappableField>

      {/* 5. Advanced — collapsed by default. CFG / steps / seed are model-
          internal knobs most users never touch; hiding them keeps the panel
          uncluttered without removing access. Mirror the chevron-toggle
          pattern used by `TranscodeVideoConfig` and other config panels. */}
      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {showAdvanced ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Advanced
      </button>

      {showAdvanced && (
        <div className="flex flex-col gap-3 pl-1 border-l-2 border-muted-foreground/10 ml-1">
          {/* CFG strength — higher = closer to prompt, lower = more
              grounded in the video. Default 4.5 is MMAudio's reference. */}
          <div>
            <Label>CFG strength: {cfgStrength.toFixed(1)}</Label>
            <Slider
              min={1}
              max={10}
              step={0.1}
              value={[cfgStrength]}
              onValueChange={(vals) => onUpdate({ cfgStrength: vals[0] })}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>1 (loose)</span>
              <span>4.5 (default)</span>
              <span>10 (strict)</span>
            </div>
          </div>

          {/* Inference steps — more steps = cleaner SFX but slower (and
              hits the duration-bucketed credit cost the same either way). */}
          <div>
            <Label>Inference steps: {numSteps}</Label>
            <Slider
              min={10}
              max={50}
              step={1}
              value={[numSteps]}
              onValueChange={(vals) => onUpdate({ numSteps: vals[0] })}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>10 (fast)</span>
              <span>25 (default)</span>
              <span>50 (clean)</span>
            </div>
          </div>

          {/* Seed — int; blank or -1 = random per generation. The Zod
              schema in `backend/src/routes/video-sfx.ts` treats `seed`
              as optional, so we send `undefined` for both empty-string
              and -1 to match "random" intent without poking the backend
              with a sentinel it'd have to translate. */}
          <div>
            <Label>Seed</Label>
            <Input
              type="number"
              value={data.seed ?? ""}
              placeholder="blank or -1 = random"
              onChange={(e) => {
                const raw = e.target.value
                if (raw === "" || raw === "-1") {
                  onUpdate({ seed: undefined })
                  return
                }
                const n = parseInt(raw, 10)
                onUpdate({ seed: Number.isFinite(n) ? n : undefined })
              }}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Same seed + same inputs = deterministic output.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
