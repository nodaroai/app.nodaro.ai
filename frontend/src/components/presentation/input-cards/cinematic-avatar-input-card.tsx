"use client"

// frontend/src/components/presentation/input-cards/cinematic-avatar-input-card.tsx
//
// Published-app input card for the `cinematic-avatar` (HeyGen cinematic_avatar)
// node. Parity with AiAvatarInputCard: gives app users the same generative
// prompt + multi-select avatar-look picker + duration / aspect-ratio /
// resolution / enhance-prompt levers as the editor, with optional per-field
// editability controlled by a `appInputFields` meta stored in the node's data
// by the workflow author.
//
// Unlike ai-avatar there is NO voice / script / audio here — cinematic-avatar
// is avatar-referenced text-to-video (Seedance) driven by a generative prompt
// and 1–3 avatar "looks".
//
// Value resolution follows the same fullscreen vs. canvas pattern used by
// every other input card: in fullscreen (app-runner) mode, `inputValues`
// overrides take precedence; in canvas mode the live node.data values are
// read directly (and updated via the store).

import { useCallback } from "react"
import { Clapperboard, X } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { cn } from "@/lib/utils"
import type { InputCardProps } from "../input-card"
import { GlassCard } from "../output-cards/shared"
import { AvatarPicker } from "@/components/heygen/avatar-picker"
import type { HeygenAvatar } from "@/lib/api"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import {
  CINEMATIC_ASPECT_RATIO_OPTIONS,
  CINEMATIC_RESOLUTION_OPTIONS,
} from "@/components/editor/config-panels/model-options"
import { INPUT_CLS } from "./shared"

const MAX_LOOKS = 3

const LABEL_CLS =
  "text-xs font-medium text-muted-foreground uppercase tracking-wider"

// ---------------------------------------------------------------------------
// AppInputFields — per-sub-control visibility flag stored by the app author in
// node.data.appInputFields. All default to true when absent.
// ---------------------------------------------------------------------------
interface AppInputFields {
  prompt?: boolean
  avatar?: boolean
  duration?: boolean
  aspectRatio?: boolean
  resolution?: boolean
  enhancePrompt?: boolean
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className={cn(LABEL_CLS, "mb-2")}>{children}</p>
}

// ---------------------------------------------------------------------------
// CinematicAvatarInputCard
// ---------------------------------------------------------------------------

/**
 * Input card for the `cinematic-avatar` node in published apps and presentation
 * mode. Mirrors AiAvatarInputCard's value-resolution + per-field gating.
 *
 * Levers (each gated by `appInputFields.{prompt,avatar,duration,aspectRatio,resolution,enhancePrompt}`):
 * - `prompt`        — generative prompt textarea (1–10000 chars)
 * - `avatar`        — multi-select avatar-look picker (1–3 looks)
 * - `duration`      — auto-duration toggle + 4–15s slider
 * - `aspectRatio`   — 16:9 / 9:16 / 1:1
 * - `resolution`    — 720p / 1080p
 * - `enhancePrompt` — enhance-prompt checkbox
 *
 * Per-field editability: set `node.data.appInputFields.<field> = false` to
 * hide/disable a sub-control. The full card is still rendered; omitted fields
 * simply don't appear so the card stays clean even when only one lever is
 * exposed.
 */
export function CinematicAvatarInputCard({
  node,
  isFullscreen,
  inputValues,
  onUpdateInput,
  readOnly,
}: InputCardProps) {
  const data = node.data as Record<string, unknown>

  // Determine which sub-controls the app author wants to expose.
  const fields = (data.appInputFields ?? {}) as AppInputFields
  const showPrompt = fields.prompt !== false
  const showAvatar = fields.avatar !== false
  const showDuration = fields.duration !== false
  const showAspectRatio = fields.aspectRatio !== false
  const showResolution = fields.resolution !== false
  const showEnhancePrompt = fields.enhancePrompt !== false

  // ---- Resolve current values (fullscreen: inputValues first, else data) ----
  const nodeOverrides = isFullscreen ? (inputValues[node.id] ?? {}) : {}

  const read = useCallback(
    <T,>(key: string, fallback: T): T => {
      const override = nodeOverrides[key]
      if (override !== undefined) return override as T
      const fromData = data[key]
      return (fromData === undefined ? fallback : fromData) as T
    },
    [nodeOverrides, data],
  )

  const prompt = String(read("prompt", ""))
  const avatarLooks = read<string[]>("avatarLooks", [])
  const avatarLookNames = read<string[]>("avatarLookNames", [])
  const autoDuration = read<boolean>("autoDuration", false)
  const duration = read<number>("duration", 10)
  const aspectRatio = read<string>("aspectRatio", "16:9")
  const resolution = read<string>("resolution", "720p")
  const enhancePrompt = read<boolean>("enhancePrompt", false)

  // ---- Writer (fullscreen → onUpdateInput, canvas → store) ------------------
  const write = useCallback(
    (key: string, value: unknown) => {
      if (isFullscreen) {
        onUpdateInput(node.id, key, value)
      } else {
        useWorkflowStore.getState().updateNodeData(node.id, { [key]: value })
      }
    },
    [isFullscreen, node.id, onUpdateInput],
  )

  // ---- Avatar-look multi-select (keep ids + names index-aligned, never mutate) ----
  const handleToggleLook = useCallback(
    (a: HeygenAvatar) => {
      if (readOnly) return
      const idx = avatarLooks.indexOf(a.avatarId)
      if (idx >= 0) {
        write("avatarLooks", avatarLooks.filter((id) => id !== a.avatarId))
        write("avatarLookNames", avatarLookNames.filter((_, i) => i !== idx))
        return
      }
      if (avatarLooks.length >= MAX_LOOKS) return // cap (picker also disables)
      write("avatarLooks", [...avatarLooks, a.avatarId])
      write("avatarLookNames", [...avatarLookNames, a.name])
    },
    [readOnly, avatarLooks, avatarLookNames, write],
  )

  const handleRemoveLook = useCallback(
    (id: string) => {
      if (readOnly) return
      const idx = avatarLooks.indexOf(id)
      if (idx < 0) return
      write("avatarLooks", avatarLooks.filter((x) => x !== id))
      write("avatarLookNames", avatarLookNames.filter((_, i) => i !== idx))
    },
    [readOnly, avatarLooks, avatarLookNames, write],
  )

  const handlePromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (readOnly) return
      write("prompt", e.target.value.slice(0, 10000))
    },
    [readOnly, write],
  )

  // ---- Render ----------------------------------------------------------------

  const nothingVisible =
    !showPrompt &&
    !showAvatar &&
    !showDuration &&
    !showAspectRatio &&
    !showResolution &&
    !showEnhancePrompt

  if (nothingVisible) {
    return (
      <GlassCard>
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Clapperboard className="size-4 shrink-0" />
          <span>Cinematic Avatar (no editable fields)</span>
        </div>
      </GlassCard>
    )
  }

  return (
    <GlassCard>
      <div className={cn("flex flex-col gap-4", readOnly && "opacity-70 pointer-events-none")}>

        {/* ---- Prompt ---- */}
        {showPrompt && (
          <div>
            <SectionLabel>Prompt</SectionLabel>
            <textarea
              value={prompt}
              onChange={handlePromptChange}
              placeholder="Describe the cinematic scene the avatar should perform…"
              rows={4}
              maxLength={10000}
              className={cn(INPUT_CLS, "resize-none max-h-[40vh] overflow-y-auto")}
              aria-label="Cinematic avatar prompt"
            />
            {prompt.length > 0 && (
              <p className="mt-1 text-right text-[10px] text-muted-foreground">
                {prompt.length}/10000
              </p>
            )}
          </div>
        )}

        {/* ---- Avatar looks (multi-select 1–3) ---- */}
        {showAvatar && (
          <div>
            <SectionLabel>
              Avatar Looks
              <span className="ml-1.5 normal-case tracking-normal text-muted-foreground/60 font-normal">
                (pick 1–{MAX_LOOKS})
              </span>
            </SectionLabel>

            {avatarLooks.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {avatarLooks.map((id, i) => (
                  <span
                    key={id}
                    className="flex items-center gap-1 rounded-full bg-[#ff0073]/10 border border-[#ff0073]/40 px-2 py-0.5 text-[10.5px] text-[#ff0073]"
                  >
                    {avatarLookNames[i] ?? id}
                    {!readOnly && (
                      <button
                        type="button"
                        aria-label={`Remove ${avatarLookNames[i] ?? id}`}
                        onClick={() => handleRemoveLook(id)}
                        className="hover:text-[#ff0073]/70"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}

            <AvatarPicker
              multiple
              selected={avatarLooks}
              onToggle={handleToggleLook}
              max={MAX_LOOKS}
              onSelect={handleToggleLook}
            />
          </div>
        )}

        {/* ---- Duration ---- */}
        {showDuration && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`cinematic-input-auto-duration-${node.id}`}
                checked={autoDuration}
                disabled={readOnly}
                onCheckedChange={(v) => write("autoDuration", v === true)}
              />
              <label
                htmlFor={`cinematic-input-auto-duration-${node.id}`}
                className="text-xs cursor-pointer"
              >
                Auto duration (let HeyGen decide)
              </label>
            </div>

            {!autoDuration && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <SectionLabel>Duration</SectionLabel>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {duration}s
                  </span>
                </div>
                <Slider
                  value={[duration]}
                  min={4}
                  max={15}
                  step={1}
                  disabled={readOnly}
                  onValueChange={([v]) => write("duration", v)}
                  className="w-full"
                  aria-label="Duration"
                />
                <div className="flex justify-between text-[9px] text-muted-foreground/60">
                  <span>4s</span>
                  <span>15s</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---- Aspect Ratio ---- */}
        {showAspectRatio && (
          <div>
            <SectionLabel>Aspect Ratio</SectionLabel>
            <Select
              value={aspectRatio}
              onValueChange={(v) => write("aspectRatio", v)}
              disabled={readOnly}
            >
              <SelectTrigger aria-label="Aspect ratio"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CINEMATIC_ASPECT_RATIO_OPTIONS.map((ar) => (
                  <SelectItem key={ar.value} value={ar.value}>{ar.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* ---- Resolution ---- */}
        {showResolution && (
          <div>
            <SectionLabel>Resolution</SectionLabel>
            <Select
              value={resolution}
              onValueChange={(v) => write("resolution", v)}
              disabled={readOnly}
            >
              <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CINEMATIC_RESOLUTION_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* ---- Enhance prompt ---- */}
        {showEnhancePrompt && (
          <div className="flex items-center gap-2">
            <Checkbox
              id={`cinematic-input-enhance-prompt-${node.id}`}
              checked={enhancePrompt}
              disabled={readOnly}
              onCheckedChange={(v) => write("enhancePrompt", v === true)}
            />
            <label
              htmlFor={`cinematic-input-enhance-prompt-${node.id}`}
              className="text-xs cursor-pointer"
            >
              Enhance prompt
            </label>
          </div>
        )}

      </div>
    </GlassCard>
  )
}
