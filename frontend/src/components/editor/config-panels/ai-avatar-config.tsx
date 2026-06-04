"use client"

import { useEffect } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { AvatarPicker } from "@/components/heygen/avatar-picker"
import { VoicePicker } from "@/components/heygen/voice-picker"
import type { HeygenAvatar, HeygenVoice } from "@/lib/api"
import type { AiAvatarData } from "@/types/nodes"
import type { ConfigProps } from "./types"

// Valid options for each field — kept here so the fail-safe useEffect can
// snap to them in one place.
const ENGINE_OPTIONS = ["avatar-v", "avatar-iv"] as const
const RESOLUTION_OPTIONS_FOR_ENGINE: Record<string, string[]> = {
  "avatar-v":  ["720p", "1080p", "4k"],
  "avatar-iv": ["720p", "1080p", "4k"],
}
const ASPECT_RATIO_OPTIONS_FOR_ENGINE: Record<string, string[]> = {
  "avatar-v":  ["16:9", "9:16"],
  "avatar-iv": ["16:9", "9:16"],
}

export function AiAvatarConfig({
  data,
  onUpdate,
}: ConfigProps<AiAvatarData>) {
  const engine = data.engine ?? "avatar-v"

  // ── Provider-aware fail-safe (step 12b) ──────────────────────────────────
  // When the engine changes, snap stale resolution / aspectRatio to the first
  // valid option for the new engine. Currently both engines support the same
  // set, so in practice this guard never fires — it exists so that adding a
  // future engine with a narrower capability set can't silently leave stale
  // values that the backend Zod enum would reject.
  useEffect(() => {
    const updates: Partial<AiAvatarData> = {}
    const resOpts = RESOLUTION_OPTIONS_FOR_ENGINE[engine] ?? RESOLUTION_OPTIONS_FOR_ENGINE["avatar-v"]!
    const arOpts  = ASPECT_RATIO_OPTIONS_FOR_ENGINE[engine] ?? ASPECT_RATIO_OPTIONS_FOR_ENGINE["avatar-v"]!

    if (data.resolution && !resOpts.includes(data.resolution)) {
      updates.resolution = resOpts[0] as AiAvatarData["resolution"]
    }
    if (data.aspectRatio && !arOpts.includes(data.aspectRatio)) {
      updates.aspectRatio = arOpts[0] as AiAvatarData["aspectRatio"]
    }
    if (Object.keys(updates).length > 0) {
      onUpdate(updates)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])

  // ── Avatar selection ─────────────────────────────────────────────────────
  function handleAvatarSelect(a: HeygenAvatar) {
    onUpdate({
      avatarId:         a.avatarId,
      avatarName:       a.name,
      avatarPreviewUrl: a.previewImageUrl,
      avatarGroupId:    a.groupId ?? undefined,
      // Pre-fill voice from avatar's default only if the user hasn't already
      // picked a voice (so re-selecting the same avatar doesn't clobber their
      // voice choice).
      voiceId:     data.voiceId ?? a.defaultVoiceId ?? undefined,
      aspectRatio: a.preferredOrientation === "portrait" ? "9:16" : "16:9",
    })
  }

  // ── Voice selection ───────────────────────────────────────────────────────
  function handleVoiceSelect(v: HeygenVoice) {
    onUpdate({ voiceId: v.voiceId, voiceName: v.name })
  }

  const speechMode = data.speechMode ?? "text"

  return (
    <div className="flex flex-col gap-4">
      {/* ── Speech Mode ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Speech Mode</Label>
        <RadioGroup
          value={speechMode}
          onValueChange={(v) => onUpdate({ speechMode: v as "text" | "audio" })}
          className="flex gap-4"
        >
          <div className="flex items-center gap-1.5">
            <RadioGroupItem value="text"  id="sm-text"  />
            <label htmlFor="sm-text"  className="text-xs cursor-pointer">Text (TTS)</label>
          </div>
          <div className="flex items-center gap-1.5">
            <RadioGroupItem value="audio" id="sm-audio" />
            <label htmlFor="sm-audio" className="text-xs cursor-pointer">Wired Audio</label>
          </div>
        </RadioGroup>
      </div>

      {/* ── Avatar Picker ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">
          Avatar
          {data.avatarName && (
            <span className="ml-1.5 text-[#ff0073] font-normal">— {data.avatarName}</span>
          )}
        </Label>
        <AvatarPicker
          value={data.avatarId}
          onSelect={handleAvatarSelect}
        />
      </div>

      {/* ── Text mode only: Voice + Script + Speed ───────────────────────── */}
      {speechMode === "text" && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">
              Voice
              {data.voiceName && (
                <span className="ml-1.5 text-[#ff0073] font-normal">— {data.voiceName}</span>
              )}
            </Label>
            <VoicePicker
              value={data.voiceId}
              onSelect={handleVoiceSelect}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Script</Label>
            <Textarea
              value={data.script ?? ""}
              onChange={(e) => onUpdate({ script: e.target.value || undefined })}
              placeholder="What the avatar will say…"
              className="min-h-[100px] text-sm resize-y"
              maxLength={5000}
            />
            {(data.script?.length ?? 0) > 0 && (
              <p className="text-[10px] text-muted-foreground text-right">
                {data.script?.length ?? 0} / 5000
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Voice Speed</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {(data.voiceSpeed ?? 1).toFixed(2)}×
              </span>
            </div>
            <Slider
              value={[data.voiceSpeed ?? 1]}
              min={0.5}
              max={1.5}
              step={0.05}
              onValueChange={([v]) => onUpdate({ voiceSpeed: v })}
              className="w-full"
            />
            <div className="flex justify-between text-[9px] text-muted-foreground/60">
              <span>0.5×</span>
              <span>1.5×</span>
            </div>
          </div>
        </>
      )}

      {/* ── Engine ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Engine</Label>
        <Select
          value={engine}
          onValueChange={(v) => onUpdate({ engine: v as AiAvatarData["engine"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {ENGINE_OPTIONS.map((e) => (
              <SelectItem key={e} value={e}>
                {e === "avatar-v" ? "Avatar V" : "Avatar IV"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Resolution ───────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Resolution</Label>
        <Select
          value={data.resolution ?? "720p"}
          onValueChange={(v) => onUpdate({ resolution: v as AiAvatarData["resolution"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {(RESOLUTION_OPTIONS_FOR_ENGINE[engine] ?? []).map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Aspect Ratio ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Aspect Ratio</Label>
        <Select
          value={data.aspectRatio ?? "16:9"}
          onValueChange={(v) => onUpdate({ aspectRatio: v as AiAvatarData["aspectRatio"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {(ASPECT_RATIO_OPTIONS_FOR_ENGINE[engine] ?? []).map((ar) => (
              <SelectItem key={ar} value={ar}>{ar}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Captions ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="ai-avatar-captions"
          checked={data.caption ?? false}
          onCheckedChange={(v) => onUpdate({ caption: v === true })}
        />
        <label htmlFor="ai-avatar-captions" className="text-xs cursor-pointer">
          Generate captions (SRT)
        </label>
      </div>
    </div>
  )
}
