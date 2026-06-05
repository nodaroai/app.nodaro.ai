"use client"

import { useEffect, useState } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { AlertTriangle, Upload, Loader2, X } from "lucide-react"
import { AvatarPicker } from "@/components/heygen/avatar-picker"
import { VoicePicker } from "@/components/heygen/voice-picker"
import { useFileUpload } from "@/hooks/use-file-upload"
import { optimizedImageUrl } from "@/lib/image"
import type { HeygenAvatar, HeygenVoice } from "@/lib/api"
import type { AiAvatarData } from "@/types/nodes"
import type { ConfigProps } from "./types"
import {
  AI_AVATAR_ENGINE_OPTIONS,
  AI_AVATAR_RESOLUTION_OPTIONS,
  getAiAvatarResolutionValues,
} from "@/components/editor/config-panels/model-options"

const ASPECT_RATIO_OPTIONS_FOR_ENGINE: Record<string, string[]> = {
  "avatar-v":  ["16:9", "9:16"],
  "avatar-iv": ["16:9", "9:16"],
}

export function AiAvatarConfig({
  data,
  onUpdate,
}: ConfigProps<AiAvatarData>) {
  const engine = data.engine ?? "avatar-iv"
  const avatarSource = data.avatarSource ?? "avatar"
  const [showAdvanced, setShowAdvanced] = useState(false)
  const { upload, isUploading } = useFileUpload()

  // ── Provider-aware fail-safe (step 12b) ──────────────────────────────────
  // When the engine changes, snap stale resolution / aspectRatio to the first
  // valid option for the new engine. Currently both engines support the same
  // set, so in practice this guard never fires — it exists so that adding a
  // future engine with a narrower capability set can't silently leave stale
  // values that the backend Zod enum would reject.
  useEffect(() => {
    const updates: Partial<AiAvatarData> = {}
    const resOpts = getAiAvatarResolutionValues(engine)
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

  // ── Motion lever fail-safe (step 12b) ────────────────────────────────────
  // `motionPrompt` and `expressiveness` only apply when supportsMotion is true
  // (avatar-iv engine, OR image-source mode). When the user switches to avatar-v
  // with avatar source, clear any stale values so the backend Zod schema never
  // sees them and the hidden fields leave no ghost state in the workflow.
  // We intentionally use `engine` and `avatarSource` in the dep array (not
  // the derived `supportsMotion`) so the effect re-runs on each relevant change.
  useEffect(() => {
    const currentSupportsMotion = avatarSource === "image" || engine === "avatar-iv"
    if (!currentSupportsMotion) {
      const updates: Partial<AiAvatarData> = {}
      if (data.motionPrompt !== undefined) updates.motionPrompt = undefined
      if (data.expressiveness !== undefined) updates.expressiveness = undefined
      if (Object.keys(updates).length > 0) {
        onUpdate(updates)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, avatarSource])

  // ── Avatar selection ─────────────────────────────────────────────────────
  function handleAvatarSelect(a: HeygenAvatar) {
    // FIX 4 — store whether this avatar supports Avatar V so the engine
    // section can show an inline warning when the combo is unsupported.
    // `supportedEngines` uses underscore ("avatar_v") per HeyGen's API.
    const supportsV =
      a.supportedEngines != null
        ? a.supportedEngines.includes("avatar_v")
        : undefined // catalog didn't provide engine metadata — don't warn
    onUpdate({
      avatarId:         a.avatarId,
      avatarName:       a.name,
      avatarPreviewUrl: a.previewImageUrl,
      avatarGroupId:    a.groupId ?? undefined,
      avatarSupportsV:  supportsV,
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

  // ── Image-source upload ─────────────────────────────────────────────────────
  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = "" // reset so re-selecting the same file fires onChange
    if (!file) return
    try {
      const result = await upload(file)
      onUpdate({ imageUrl: result.url })
    } catch {
      // useFileUpload surfaces the error state; nothing else to do here.
    }
  }

  const speechMode = data.speechMode ?? "text"

  // ── TTS engine helpers ─────────────────────────────────────────────────────
  // Stored discriminator is `engine_type`; "default" means no override (HeyGen
  // picks its own engine). Switching engines replaces the whole sub-object so we
  // never carry stale fields from a different engine into the backend body.
  const ttsEngineType = data.ttsEngine?.engine_type ?? "default"
  const elevenlabs =
    data.ttsEngine?.engine_type === "elevenlabs" ? data.ttsEngine : undefined
  const fish = data.ttsEngine?.engine_type === "fish" ? data.ttsEngine : undefined

  function handleTtsEngineChange(next: string) {
    if (next === "default") {
      onUpdate({ ttsEngine: undefined })
    } else if (next === "elevenlabs") {
      onUpdate({ ttsEngine: { engine_type: "elevenlabs" } })
    } else if (next === "fish") {
      onUpdate({ ttsEngine: { engine_type: "fish" } })
    } else if (next === "starfish") {
      onUpdate({ ttsEngine: { engine_type: "starfish" } })
    }
  }

  function updateElevenlabs(patch: Partial<NonNullable<typeof elevenlabs>>) {
    onUpdate({
      ttsEngine: { engine_type: "elevenlabs", ...elevenlabs, ...patch },
    })
  }

  function updateFish(patch: Partial<NonNullable<typeof fish>>) {
    onUpdate({ ttsEngine: { engine_type: "fish", ...fish, ...patch } })
  }

  // ── Background helpers ─────────────────────────────────────────────────────
  const backgroundType = data.background?.type ?? "none"

  function handleBackgroundTypeChange(next: string) {
    if (next === "none") {
      onUpdate({ background: undefined })
    } else if (next === "color") {
      onUpdate({ background: { type: "color", value: data.background?.value } })
    } else if (next === "image") {
      onUpdate({ background: { type: "image", url: data.background?.url } })
    }
  }

  // motion_prompt + expressiveness are Avatar IV only (backend drops them for V).
  // Image-source mode is IV-class (its own engine), so motion controls apply there too.
  const supportsMotion = avatarSource === "image" || engine === "avatar-iv"

  // FIX 4 — Avatar V eligibility warning.
  // The backend already falls back V→IV silently, but surface the mismatch so
  // the user understands why the output might differ from their expectation.
  // `avatarSupportsV` is stored by handleAvatarSelect from the picked avatar's
  // `supportedEngines`; it's `undefined` until an avatar with engine metadata is
  // picked, so the warning only fires once we know the combo is unsupported.
  const showAvatarVWarning =
    engine === "avatar-v" &&
    !!data.avatarId &&
    data.avatarSupportsV === false

  return (
    <div className="flex flex-col gap-4">
      {/* ── Source ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Source</Label>
        <RadioGroup
          value={avatarSource}
          onValueChange={(v) => onUpdate({ avatarSource: v as "avatar" | "image" })}
          className="flex gap-4"
        >
          <div className="flex items-center gap-1.5">
            <RadioGroupItem value="avatar" id="src-avatar" />
            <label htmlFor="src-avatar" className="text-xs cursor-pointer">Avatar</label>
          </div>
          <div className="flex items-center gap-1.5">
            <RadioGroupItem value="image" id="src-image" />
            <label htmlFor="src-image" className="text-xs cursor-pointer">Image</label>
          </div>
        </RadioGroup>
        {avatarSource === "image" && (
          <p className="text-[10px] text-muted-foreground/70 leading-snug">
            Animate a raw image — no avatar creation needed.
          </p>
        )}
      </div>

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
        {speechMode === "audio" && (
          <p className="text-[10px] text-muted-foreground/70 leading-snug">
            Audio is capped at 10 minutes — longer clips are automatically trimmed to 600s.
          </p>
        )}
      </div>

      {/* ── Avatar Picker (avatar source only) ───────────────────────────── */}
      {avatarSource === "avatar" && (
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
      )}

      {/* ── Source Image (image source only) ─────────────────────────────── */}
      {avatarSource === "image" && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Source Image</Label>
          <p className="text-[10px] text-muted-foreground/70 leading-snug">
            Wire an image into the node&apos;s Image input, paste a URL, or upload one.
          </p>
          {data.imageUrl ? (
            <div className="relative w-full overflow-hidden rounded-lg border border-muted-foreground/15">
              <img
                src={optimizedImageUrl(data.imageUrl)}
                alt="Source"
                className="w-full max-h-40 object-contain bg-black/20"
              />
              <button
                type="button"
                aria-label="Remove image"
                className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                onClick={() => onUpdate({ imageUrl: undefined })}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/30 py-3 text-xs text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground transition-colors">
              {isUploading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…
                </>
              ) : (
                <>
                  <Upload className="h-3.5 w-3.5" /> Upload image
                </>
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={isUploading}
                onChange={handleImageUpload}
              />
            </label>
          )}
          <Input
            value={data.imageUrl ?? ""}
            onChange={(e) => onUpdate({ imageUrl: e.target.value || undefined })}
            placeholder="https://…"
          />
        </div>
      )}

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

      {/* ── Engine (avatar source only — image mode has its own engine) ──── */}
      {avatarSource === "avatar" && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Engine</Label>
          <Select
            value={engine}
            onValueChange={(v) => onUpdate({ engine: v as AiAvatarData["engine"] })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {AI_AVATAR_ENGINE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* FIX 4 — warn when the selected avatar doesn't support Avatar V */}
          {showAvatarVWarning && (
            <div className="flex items-start gap-1.5 text-[10.5px] text-amber-600 dark:text-amber-400 leading-snug" role="status">
              <AlertTriangle className="size-3 shrink-0 mt-0.5" aria-hidden />
              This avatar doesn&apos;t support Avatar V — it&apos;ll fall back to Avatar IV.
            </div>
          )}
        </div>
      )}

      {/* ── Resolution ───────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Resolution</Label>
        <Select
          value={data.resolution ?? "720p"}
          onValueChange={(v) => onUpdate({ resolution: v as AiAvatarData["resolution"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {(AI_AVATAR_RESOLUTION_OPTIONS[engine] ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
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

      {/* ── Advanced ─────────────────────────────────────────────────────── */}
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
        onClick={() => setShowAdvanced((s) => !s)}
      >
        {showAdvanced ? "Hide" : "Show"} Advanced
      </button>

      {showAdvanced && (
        <div className="flex flex-col gap-4 border-t pt-3 border-muted-foreground/10">
          {/* ── Voice tuning (text mode only) ──────────────────────────────── */}
          {speechMode === "text" && (
            <>
              <p className="text-[11px] font-medium text-muted-foreground/80">Voice tuning</p>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Pitch</Label>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {data.pitch ?? 0}
                  </span>
                </div>
                <Slider
                  value={[data.pitch ?? 0]}
                  min={-50}
                  max={50}
                  step={1}
                  onValueChange={([v]) => onUpdate({ pitch: v })}
                  className="w-full"
                />
                <div className="flex justify-between text-[9px] text-muted-foreground/60">
                  <span>-50</span>
                  <span>+50</span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Volume</Label>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {(data.volume ?? 1).toFixed(2)}
                  </span>
                </div>
                <Slider
                  value={[data.volume ?? 1]}
                  min={0}
                  max={1}
                  step={0.05}
                  onValueChange={([v]) => onUpdate({ volume: v })}
                  className="w-full"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Locale (optional)</Label>
                <Input
                  value={data.locale ?? ""}
                  onChange={(e) => onUpdate({ locale: e.target.value || undefined })}
                  placeholder="e.g. en-US"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">TTS Engine</Label>
                <Select value={ttsEngineType} onValueChange={handleTtsEngineChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">HeyGen default</SelectItem>
                    <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                    <SelectItem value="fish">Fish</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {ttsEngineType === "elevenlabs" && (
                <div className="flex flex-col gap-3 pl-2 border-l-2 border-muted-foreground/10">
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">Model</Label>
                    <Select
                      value={elevenlabs?.model ?? "eleven_multilingual_v2"}
                      onValueChange={(v) =>
                        updateElevenlabs({ model: v as NonNullable<typeof elevenlabs>["model"] })
                      }
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="eleven_multilingual_v2">Multilingual v2</SelectItem>
                        <SelectItem value="eleven_turbo_v2_5">Turbo v2.5</SelectItem>
                        <SelectItem value="eleven_flash_v2_5">Flash v2.5</SelectItem>
                        <SelectItem value="eleven_v3">v3</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Stability ({(elevenlabs?.stability ?? 0.5).toFixed(2)})
                    </Label>
                    <Slider
                      value={[elevenlabs?.stability ?? 0.5]}
                      min={0}
                      max={1}
                      step={0.05}
                      onValueChange={([v]) => updateElevenlabs({ stability: v })}
                      className="w-full"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Similarity ({(elevenlabs?.similarityBoost ?? 0.75).toFixed(2)})
                    </Label>
                    <Slider
                      value={[elevenlabs?.similarityBoost ?? 0.75]}
                      min={0}
                      max={1}
                      step={0.05}
                      onValueChange={([v]) => updateElevenlabs({ similarityBoost: v })}
                      className="w-full"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Style ({(elevenlabs?.style ?? 0).toFixed(2)})
                    </Label>
                    <Slider
                      value={[elevenlabs?.style ?? 0]}
                      min={0}
                      max={1}
                      step={0.05}
                      onValueChange={([v]) => updateElevenlabs({ style: v })}
                      className="w-full"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="ai-avatar-speaker-boost"
                      checked={elevenlabs?.useSpeakerBoost ?? false}
                      onCheckedChange={(v) => updateElevenlabs({ useSpeakerBoost: v === true })}
                    />
                    <label htmlFor="ai-avatar-speaker-boost" className="text-xs cursor-pointer">
                      Speaker boost
                    </label>
                  </div>
                </div>
              )}

              {ttsEngineType === "fish" && (
                <div className="flex flex-col gap-3 pl-2 border-l-2 border-muted-foreground/10">
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">Model</Label>
                    <Select
                      value={fish?.model ?? "s1"}
                      onValueChange={(v) =>
                        updateFish({ model: v as NonNullable<typeof fish>["model"] })
                      }
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="s1">S1</SelectItem>
                        <SelectItem value="s2-pro">S2 Pro</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Stability ({(fish?.stability ?? 0.5).toFixed(2)})
                    </Label>
                    <Slider
                      value={[fish?.stability ?? 0.5]}
                      min={0}
                      max={1}
                      step={0.05}
                      onValueChange={([v]) => updateFish({ stability: v })}
                      className="w-full"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Similarity ({(fish?.similarity ?? 0.75).toFixed(2)})
                    </Label>
                    <Slider
                      value={[fish?.similarity ?? 0.75]}
                      min={0}
                      max={1}
                      step={0.05}
                      onValueChange={([v]) => updateFish({ similarity: v })}
                      className="w-full"
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Video ──────────────────────────────────────────────────────── */}
          <p className="text-[11px] font-medium text-muted-foreground/80">Video</p>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Background</Label>
            <Select value={backgroundType} onValueChange={handleBackgroundTypeChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="color">Color</SelectItem>
                <SelectItem value="image">Image</SelectItem>
              </SelectContent>
            </Select>
            {backgroundType === "color" && (
              <Input
                value={data.background?.value ?? ""}
                onChange={(e) =>
                  onUpdate({ background: { type: "color", value: e.target.value || undefined } })
                }
                placeholder="#000000"
              />
            )}
            {backgroundType === "image" && (
              <Input
                value={data.background?.url ?? ""}
                onChange={(e) =>
                  onUpdate({ background: { type: "image", url: e.target.value || undefined } })
                }
                placeholder="https://…"
              />
            )}
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="ai-avatar-remove-bg"
              checked={data.removeBackground ?? false}
              onCheckedChange={(v) => onUpdate({ removeBackground: v === true })}
            />
            <label htmlFor="ai-avatar-remove-bg" className="text-xs cursor-pointer">
              Remove background
            </label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="ai-avatar-caption-burn"
              checked={data.captionStyle === "default"}
              onCheckedChange={(v) =>
                onUpdate({
                  captionStyle: v === true ? "default" : undefined,
                  // burn-in implies captions are generated
                  caption: v === true ? true : data.caption,
                })
              }
            />
            <label htmlFor="ai-avatar-caption-burn" className="text-xs cursor-pointer">
              Burn captions into video
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Output Format</Label>
            <Select
              value={data.outputFormat ?? "mp4"}
              onValueChange={(v) => onUpdate({ outputFormat: v as AiAvatarData["outputFormat"] })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mp4">MP4</SelectItem>
                <SelectItem value="webm">WebM</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Fit</Label>
            <Select
              value={data.fit ?? "cover"}
              onValueChange={(v) => onUpdate({ fit: v as AiAvatarData["fit"] })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cover">Cover</SelectItem>
                <SelectItem value="contain">Contain</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* ── Motion / Expressiveness (Avatar IV only) ───────────────────── */}
          {supportsMotion && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Motion Prompt (optional)</Label>
                <Textarea
                  value={data.motionPrompt ?? ""}
                  onChange={(e) => onUpdate({ motionPrompt: e.target.value || undefined })}
                  placeholder="Describe the avatar's motion…"
                  className="min-h-[64px] text-sm resize-y"
                  maxLength={1000}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Expressiveness</Label>
                <Select
                  value={data.expressiveness ?? "low"}
                  onValueChange={(v) =>
                    onUpdate({ expressiveness: v as AiAvatarData["expressiveness"] })
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
