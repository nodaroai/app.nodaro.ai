"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  getProviders,
  getProviderLabel,
  getModels,
  getFirstProvider,
  getFirstModel,
  type ProviderCategory,
} from "@/lib/providers-config"
import type {
  ToneData,
  StyleGuideData,
  ProviderData,
  SceneCountData,
  DurationData,
  AspectRatioData,
  MotionData,
  CameraMotionData,
  FramingData,
  LensData,
  CameraFormatData,
  LightingData,
  ColorLookData,
  AtmosphereData,
  StyleData,
  TemporalData,
} from "@/types/nodes"
import { CameraMotionPicker } from "./camera-motion-picker"
import { FramingPicker } from "./framing-picker"
import { LensPicker } from "./lens-picker"
import { CameraFormatPicker } from "./camera-format-picker"
import { LightingPicker } from "./lighting-picker"
import { ColorLookPicker } from "./color-look-picker"
import { AtmospherePicker } from "./atmosphere-picker"
import { StylePicker } from "./style-picker"
import { TemporalPicker } from "./temporal-picker"
import { PromptInjectionPreview } from "./prompt-injection-preview"
import { composeCameraMotionHintForNode } from "@/lib/cinematography-hints"
import { buildFramingHints } from "@nodaro-shared/framing"
import { getLensPromptHint } from "@nodaro-shared/lens"
import { getCameraFormatPromptHint } from "@nodaro-shared/camera-format"
import { buildLightingHints } from "@nodaro-shared/lighting"
import { getColorLookPromptHint } from "@nodaro-shared/color-look"
import { getAtmospherePromptHint } from "@nodaro-shared/atmosphere"
import { getStylePromptHint } from "@nodaro-shared/style"
import { buildTemporalHints } from "@nodaro-shared/temporal"
import type { ConfigProps } from "./types"

export function ToneConfig({ data, onUpdate }: ConfigProps<ToneData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="tone-value">Tone</Label>
        <Input
          id="tone-value"
          value={data.tone}
          onChange={(e) => onUpdate({ tone: e.target.value })}
          placeholder="e.g. dramatic, playful, dark"
        />
      </div>
    </div>
  )
}

export function StyleGuideConfig({ data, onUpdate }: ConfigProps<StyleGuideData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="style-text">Style Description</Label>
        <Textarea
          id="style-text"
          rows={3}
          value={data.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          placeholder="e.g. Studio Ghibli watercolor..."
        />
      </div>
    </div>
  )
}

export function ProviderConfig({ data, onUpdate }: ConfigProps<ProviderData>) {
  const category = data.category as ProviderCategory
  const providers = getProviders(category)
  const models = getModels(category, data.provider)

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Category</Label>
        <Select
          value={data.category}
          onValueChange={(v) => {
            const cat = v as ProviderCategory
            const firstProvider = getFirstProvider(cat)
            const firstModel = getFirstModel(cat, firstProvider)
            onUpdate({ category: cat, provider: firstProvider, model: firstModel })
          }}
        >
          <SelectTrigger aria-label="Category"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="image">Image</SelectItem>
            <SelectItem value="video">Video</SelectItem>
            <SelectItem value="voice">Voice</SelectItem>
            <SelectItem value="script">Script</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Provider</Label>
        <Select
          value={data.provider}
          onValueChange={(v) => {
            const firstModel = getFirstModel(category, v)
            onUpdate({ provider: v, model: firstModel })
          }}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p} value={p}>{getProviderLabel(category, p)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Model</Label>
        <Select
          value={data.model}
          onValueChange={(v) => onUpdate({ model: v })}
        >
          <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export function SceneCountConfig({ data, onUpdate }: ConfigProps<SceneCountData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="scene-count-val">Number of Scenes</Label>
        <Input
          id="scene-count-val"
          type="number"
          min={1}
          max={20}
          value={data.count ?? ""}
          onChange={(e) => onUpdate({ count: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
        />
      </div>
    </div>
  )
}

export function DurationConfig({ data, onUpdate }: ConfigProps<DurationData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="duration-seconds">Duration (seconds)</Label>
        <Input
          id="duration-seconds"
          type="number"
          min={1}
          max={600}
          value={data.seconds ?? ""}
          onChange={(e) => onUpdate({ seconds: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
        />
      </div>
    </div>
  )
}

export function AspectRatioConfig({ data, onUpdate }: ConfigProps<AspectRatioData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Aspect Ratio</Label>
        <Select
          value={data.ratio}
          onValueChange={(v) => onUpdate({ ratio: v as AspectRatioData["ratio"] })}
        >
          <SelectTrigger aria-label="Aspect ratio"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1:1">1:1 (Square)</SelectItem>
            <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
            <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
            <SelectItem value="4:3">4:3</SelectItem>
            <SelectItem value="4:5">4:5</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export function MotionConfig({ data, onUpdate }: ConfigProps<MotionData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Motion</Label>
        <Select
          value={data.motion}
          onValueChange={(v) => onUpdate({ motion: v as MotionData["motion"] })}
        >
          <SelectTrigger aria-label="Motion"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="subtle">Subtle</SelectItem>
            <SelectItem value="moderate">Moderate</SelectItem>
            <SelectItem value="dynamic">Dynamic</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export function CameraMotionConfig({ data, onUpdate, nodes, edges, nodeId }: ConfigProps<CameraMotionData> & { nodeId?: string }) {
  const composed = composeCameraMotionHintForNode(
    data.cameraMotion,
    nodeId,
    nodes,
    edges ?? [],
  )
  return (
    <div className="flex flex-col gap-3">
      <PromptInjectionPreview hints={composed} />
      <p className="text-[10px] text-muted-foreground italic px-0.5">
        Connect parameter nodes to startState / endState input handles to add "beginning with…" / "ending with…" clauses to this preview.
      </p>
      <Label>Camera Motion</Label>
      <CameraMotionPicker
        value={data.cameraMotion || "static"}
        onValueChange={(v) => onUpdate({ cameraMotion: v })}
      />
    </div>
  )
}

export function FramingConfig({ data, onUpdate }: ConfigProps<FramingData>) {
  const maxItemsPerRow = data.maxItemsPerRow ?? 2
  return (
    <div className="flex flex-col gap-3">
      <PromptInjectionPreview hints={buildFramingHints(data)} />
      <Label>Framing</Label>
      <FramingPicker
        value={{
          shotSize: data.shotSize,
          angle: data.angle,
          coverage: data.coverage,
          composition: data.composition,
          vantage: data.vantage,
        }}
        onChange={(patch) => onUpdate(patch)}
      />
      <div className="flex items-center justify-between gap-2 pt-1">
        <Label htmlFor="framing-max-items-per-row" className="text-xs text-muted-foreground">
          Items per row (node card)
        </Label>
        <input
          id="framing-max-items-per-row"
          type="number"
          min={1}
          max={5}
          value={maxItemsPerRow}
          onChange={(e) => {
            const next = Number.parseInt(e.target.value, 10)
            if (!Number.isFinite(next)) return
            const clamped = Math.max(1, Math.min(5, next))
            onUpdate({ maxItemsPerRow: clamped })
          }}
          className="w-16 h-8 rounded-md border border-input bg-transparent px-2 text-xs text-right"
        />
      </div>
    </div>
  )
}

export function LensConfig({ data, onUpdate }: ConfigProps<LensData>) {
  return (
    <div className="flex flex-col gap-3">
      <PromptInjectionPreview hints={[getLensPromptHint(data.lens)]} />
      <Label>Lens</Label>
      <LensPicker
        value={data.lens || "normal-50mm"}
        onValueChange={(v) => onUpdate({ lens: v })}
      />
    </div>
  )
}

export function CameraFormatConfig({ data, onUpdate }: ConfigProps<CameraFormatData>) {
  return (
    <div className="flex flex-col gap-3">
      <PromptInjectionPreview hints={[getCameraFormatPromptHint(data.cameraFormat)]} />
      <Label>Camera / Film</Label>
      <CameraFormatPicker
        value={data.cameraFormat || "35mm-film"}
        onValueChange={(v) => onUpdate({ cameraFormat: v })}
      />
    </div>
  )
}

export function LightingConfig({ data, onUpdate }: ConfigProps<LightingData>) {
  const maxItemsPerRow = data.maxItemsPerRow ?? 2
  return (
    <div className="flex flex-col gap-3">
      <PromptInjectionPreview hints={buildLightingHints(data)} />
      <Label>Lighting</Label>
      <LightingPicker
        value={{
          timeOfDay: data.timeOfDay,
          lightingStyle: data.lightingStyle,
          lightingDirection: data.lightingDirection,
        }}
        onChange={(patch) => onUpdate(patch)}
      />
      <div className="flex items-center justify-between gap-2 pt-1">
        <Label htmlFor="lighting-max-items-per-row" className="text-xs text-muted-foreground">
          Items per row (node card)
        </Label>
        <input
          id="lighting-max-items-per-row"
          type="number"
          min={1}
          max={3}
          value={maxItemsPerRow}
          onChange={(e) => {
            const next = Number.parseInt(e.target.value, 10)
            if (!Number.isFinite(next)) return
            const clamped = Math.max(1, Math.min(3, next))
            onUpdate({ maxItemsPerRow: clamped })
          }}
          className="w-16 h-8 rounded-md border border-input bg-transparent px-2 text-xs text-right"
        />
      </div>
    </div>
  )
}

export function ColorLookConfig({ data, onUpdate }: ConfigProps<ColorLookData>) {
  return (
    <div className="flex flex-col gap-3">
      <PromptInjectionPreview hints={[getColorLookPromptHint(data.colorLook)]} />
      <Label>Color / Look</Label>
      <ColorLookPicker
        value={data.colorLook || "warm"}
        onValueChange={(v) => onUpdate({ colorLook: v })}
      />
    </div>
  )
}

export function AtmosphereConfig({ data, onUpdate }: ConfigProps<AtmosphereData>) {
  return (
    <div className="flex flex-col gap-3">
      <PromptInjectionPreview hints={[getAtmospherePromptHint(data.atmosphere)]} />
      <Label>Atmosphere</Label>
      <AtmospherePicker
        value={data.atmosphere || "clear"}
        onValueChange={(v) => onUpdate({ atmosphere: v })}
      />
    </div>
  )
}

export function StyleConfig({ data, onUpdate }: ConfigProps<StyleData>) {
  return (
    <div className="flex flex-col gap-3">
      <PromptInjectionPreview hints={[getStylePromptHint(data.style)]} />
      <Label>Style</Label>
      <StylePicker
        value={data.style || "cinematic"}
        onValueChange={(v) => onUpdate({ style: v })}
      />
    </div>
  )
}

export function TemporalConfig({ data, onUpdate }: ConfigProps<TemporalData>) {
  const maxItemsPerRow = data.maxItemsPerRow ?? 2
  return (
    <div className="flex flex-col gap-3">
      <PromptInjectionPreview hints={buildTemporalHints(data)} />
      <Label>Temporal</Label>
      <TemporalPicker
        value={{
          temporalSpeed: data.temporalSpeed,
          temporalFreeze: data.temporalFreeze,
          temporalDirection: data.temporalDirection,
          temporalShutter: data.temporalShutter,
        }}
        onChange={(patch) => onUpdate(patch)}
      />
      <div className="flex items-center justify-between gap-2 pt-1">
        <Label htmlFor="temporal-max-items-per-row" className="text-xs text-muted-foreground">
          Items per row (node card)
        </Label>
        <input
          id="temporal-max-items-per-row"
          type="number"
          min={1}
          max={4}
          value={maxItemsPerRow}
          onChange={(e) => {
            const next = Number.parseInt(e.target.value, 10)
            if (!Number.isFinite(next)) return
            const clamped = Math.max(1, Math.min(4, next))
            onUpdate({ maxItemsPerRow: clamped })
          }}
          className="w-16 h-8 rounded-md border border-input bg-transparent px-2 text-xs text-right"
        />
      </div>
    </div>
  )
}
