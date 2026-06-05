"use client"

// frontend/src/components/editor/config-panels/cinematic-avatar-config.tsx
//
// Config panel for the `cinematic-avatar` node (HeyGen type:"cinematic_avatar").
//
// Unlike `ai-avatar` (whose `script` is verbatim — deliberately kept off the
// wizard + FieldMappings), the `cinematic-avatar` prompt IS a generative
// prompt. So it uses a MappableField + TagTextarea (node-refs) + the
// PromptHelperButton, exactly like the generative video/image nodes.
//
// Source = 1–3 avatar "looks" picked via the shared AvatarPicker in
// multi-select mode (persisted as `avatarLooks` ids + `avatarLookNames`).
// There is NO speech / voice / audio / engine here — it's avatar-referenced
// text-to-video (Seedance).

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import { X } from "lucide-react"
import { AvatarPicker } from "@/components/heygen/avatar-picker"
import type { HeygenAvatar } from "@/lib/api"
import type { CinematicAvatarData } from "@/types/nodes"
import type { ConfigProps } from "./types"
import { MappableField } from "./mappable-field"
import { TagTextarea } from "./tag-textarea"
import { PromptHelperButton } from "./prompt-helper-button"

const MAX_LOOKS = 3
const ASPECT_RATIO_OPTIONS: CinematicAvatarData["aspectRatio"][] = ["16:9", "9:16", "1:1"]
const RESOLUTION_OPTIONS: CinematicAvatarData["resolution"][] = ["720p", "1080p"]

export function CinematicAvatarConfig({
  data,
  onUpdate,
  sources,
  fieldMappings,
  onMapField,
  nodeRefs,
  refMap,
  variableDisplayMode,
}: ConfigProps<CinematicAvatarData>) {
  const looks = data.avatarLooks ?? []
  const lookNames = data.avatarLookNames ?? []
  const autoDuration = data.autoDuration ?? false

  // ── Multi-select avatar-look toggle ──────────────────────────────────────
  // Keep `avatarLooks` (ids) and `avatarLookNames` (display) index-aligned.
  // Never mutate — always build fresh arrays.
  function handleToggleLook(a: HeygenAvatar) {
    const idx = looks.indexOf(a.avatarId)
    if (idx >= 0) {
      onUpdate({
        avatarLooks: looks.filter((id) => id !== a.avatarId),
        avatarLookNames: lookNames.filter((_, i) => i !== idx),
      })
      return
    }
    if (looks.length >= MAX_LOOKS) return // cap enforced (picker also disables)
    onUpdate({
      avatarLooks: [...looks, a.avatarId],
      avatarLookNames: [...lookNames, a.name],
    })
  }

  function handleRemoveLook(id: string) {
    const idx = looks.indexOf(id)
    if (idx < 0) return
    onUpdate({
      avatarLooks: looks.filter((x) => x !== id),
      avatarLookNames: lookNames.filter((_, i) => i !== idx),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Prompt (generative — wizard + FieldMappings OK) ─────────────────── */}
      <MappableField
        field="prompt"
        label="Prompt"
        sources={sources}
        fieldMappings={fieldMappings}
        onMapField={onMapField}
        labelAction={
          <PromptHelperButton
            nodeType="cinematic-avatar"
            currentPrompt={data.prompt || ""}
            provider={data.provider}
            onAccept={(prompt) => onUpdate({ prompt })}
          />
        }
      >
        <TagTextarea
          value={data.prompt ?? ""}
          onChange={(v) => onUpdate({ prompt: v.slice(0, 10000) })}
          placeholder="Describe the cinematic scene the avatar should perform…"
          rows={4}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
        {(data.prompt?.length ?? 0) > 0 && (
          <span className="text-[10px] text-muted-foreground text-right block">
            {data.prompt?.length ?? 0} / 10000
          </span>
        )}
      </MappableField>

      {/* ── Avatar looks (multi-select 1–3) ─────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">
          Avatar Looks
          <span className="ml-1.5 text-muted-foreground/60 font-normal">
            (pick 1–{MAX_LOOKS})
          </span>
        </Label>

        {/* Selected chips */}
        {looks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {looks.map((id, i) => (
              <span
                key={id}
                className="flex items-center gap-1 rounded-full bg-[#ff0073]/10 border border-[#ff0073]/40 px-2 py-0.5 text-[10.5px] text-[#ff0073]"
              >
                {lookNames[i] ?? id}
                <button
                  type="button"
                  aria-label={`Remove ${lookNames[i] ?? id}`}
                  onClick={() => handleRemoveLook(id)}
                  className="hover:text-[#ff0073]/70"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <AvatarPicker
          multiple
          selected={looks}
          onToggle={handleToggleLook}
          max={MAX_LOOKS}
          onSelect={handleToggleLook}
        />
      </div>

      {/* ── Duration ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id="cinematic-auto-duration"
            checked={autoDuration}
            onCheckedChange={(v) => onUpdate({ autoDuration: v === true })}
          />
          <label htmlFor="cinematic-auto-duration" className="text-xs cursor-pointer">
            Auto duration (let HeyGen decide)
          </label>
        </div>

        {!autoDuration && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Duration</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {data.duration ?? 10}s
              </span>
            </div>
            <Slider
              value={[data.duration ?? 10]}
              min={4}
              max={15}
              step={1}
              onValueChange={([v]) => onUpdate({ duration: v })}
              className="w-full"
            />
            <div className="flex justify-between text-[9px] text-muted-foreground/60">
              <span>4s</span>
              <span>15s</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Aspect Ratio ────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Aspect Ratio</Label>
        <Select
          value={data.aspectRatio ?? "16:9"}
          onValueChange={(v) => onUpdate({ aspectRatio: v as CinematicAvatarData["aspectRatio"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {ASPECT_RATIO_OPTIONS.map((ar) => (
              <SelectItem key={ar} value={ar}>{ar}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Resolution ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Resolution</Label>
        <Select
          value={data.resolution ?? "720p"}
          onValueChange={(v) => onUpdate({ resolution: v as CinematicAvatarData["resolution"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {RESOLUTION_OPTIONS.map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Enhance prompt ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="cinematic-enhance-prompt"
          checked={data.enhancePrompt ?? false}
          onCheckedChange={(v) => onUpdate({ enhancePrompt: v === true })}
        />
        <label htmlFor="cinematic-enhance-prompt" className="text-xs cursor-pointer">
          Enhance prompt
        </label>
      </div>
    </div>
  )
}
