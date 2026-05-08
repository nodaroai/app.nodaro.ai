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
  ActionFxData,
  StyleData,
  SettingData,
  LoopSubjectData,
  PersonData,
  MoodData,
  PhotographerData,
  AestheticData,
  EraData,
  PoseData,
  StylingData,
  MaterialData,
  AnimalData,
  VehicleData,
  WeaponData,
  PhotoGenreData,
  BackdropData,
  HeldPropData,
  TemporalData,
  ExposureSettingsData,
  RenderQualityData,
  CompositionEffectsData,
  PostProcessEffectsData,
} from "@/types/nodes"
import { CameraMotionPicker } from "./camera-motion-picker"
import { FramingPicker } from "./framing-picker"
import { LensPicker } from "./lens-picker"
import { CameraFormatPicker } from "./camera-format-picker"
import { LightingPicker } from "./lighting-picker"
import { ColorLookPicker } from "./color-look-picker"
import { AtmospherePicker } from "./atmosphere-picker"
import { ActionFxPicker } from "./action-fx-picker"
import { StylePicker } from "./style-picker"
import { SettingPicker } from "./setting-picker"
import { LoopSubjectPicker } from "./loop-subject-picker"
import { PersonPicker } from "./person-picker"
import { MOODS } from "@nodaro/shared"
import { MoodEmoji } from "./mood-emoji"
import { DimensionTileGrid } from "./dimension-tile-grid"
import { POSES } from "@nodaro/shared"
import { PoseIcon } from "./pose-icon"
import { StylingPicker } from "./styling-picker"
import { TemporalPicker } from "./temporal-picker"
import { MaterialPicker } from "./material-picker"
import { AnimalPicker } from "./animal-picker"
import { VehiclePicker } from "./vehicle-picker"
import { WeaponPicker } from "./weapon-picker"
import { PhotoGenrePicker } from "./photo-genre-picker"
import { BackdropPicker } from "./backdrop-picker"
import { HeldPropPicker } from "./held-prop-picker"
import { ExposureSettingsPicker } from "./exposure-settings-picker"
import { RenderQualityPicker } from "./render-quality-picker"
import { CompositionEffectsPicker } from "./composition-effects-picker"
import { PostProcessEffectsPicker } from "./post-process-effects-picker"
import { PhotographerPicker } from "./photographer-picker"
import { AestheticPicker } from "./aesthetic-picker"
import { EraPicker } from "./era-picker"
import { PromptInjectionPreview } from "./prompt-injection-preview"
import { composeCameraMotionHintForNode } from "@/lib/cinematography-hints"
import { buildFramingHints } from "@nodaro/shared"
import { getLensPromptHint } from "@nodaro/shared"
import { getCameraFormatPromptHint } from "@nodaro/shared"
import { buildLightingHints } from "@nodaro/shared"
import { getColorLookPromptHint } from "@nodaro/shared"
import { buildAtmosphereHints } from "@nodaro/shared"
import { buildActionFxHints } from "@nodaro/shared"
import { getStylePromptHint } from "@nodaro/shared"
import { getSettingPromptHint, getLoopSubjectPromptHint } from "@nodaro/shared"
import { buildPersonHints } from "@nodaro/shared"
import { buildMoodHints } from "@nodaro/shared"
import { buildPoseHints } from "@nodaro/shared"
import { buildStylingHints } from "@nodaro/shared"
import { buildTemporalHints } from "@nodaro/shared"
import { buildMaterialHints } from "@nodaro/shared"
import { getAnimal } from "@nodaro/shared"
import { getVehicle } from "@nodaro/shared"
import { getWeapon } from "@nodaro/shared"
import { getPhotoGenrePromptHint } from "@nodaro/shared"
import { getBackdropPromptHint } from "@nodaro/shared"
import { buildHeldPropHints } from "@nodaro/shared"
import { buildPhotographerHints } from "@nodaro/shared"
import { buildAestheticHints } from "@nodaro/shared"
import { getEraPromptHint } from "@nodaro/shared"
import { buildExposureHints } from "@nodaro/shared"
import { getRenderQualityPromptHint } from "@nodaro/shared"
import { getCompositionEffectPromptHint } from "@nodaro/shared"
import { buildPostProcessHints } from "@nodaro/shared"
import { useLocaleDir } from "@/lib/locale-store"
import { LocaleHeader } from "./locale-header"
import { CustomTextRows } from "./custom-text-rows"
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
  const dir = useLocaleDir()
  const composed = composeCameraMotionHintForNode(
    data.cameraMotion,
    nodeId,
    nodes,
    edges ?? [],
  )
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, ...composed, data.postText].filter(Boolean) as string[]} />
      <p className="text-[10px] text-muted-foreground italic px-0.5">
        Connect parameter nodes to startState / endState input handles to add "beginning with…" / "ending with…" clauses to this preview.
      </p>
      <CustomTextRows
        idPrefix="camera-motion"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. starts handheld"
        postPlaceholder="e.g. settles to lock-off"
        onChange={onUpdate}
      />
      <Label>Camera Motion</Label>
      <CameraMotionPicker
        value={data.cameraMotion || "static"}
        onValueChange={(v) => onUpdate({ cameraMotion: v })}
      />
    </div>
  )
}

export function FramingConfig({ data, onUpdate }: ConfigProps<FramingData>) {
  const dir = useLocaleDir()
  const maxItemsPerRow = data.maxItemsPerRow ?? 2
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, ...buildFramingHints(data), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="framing"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. handheld feel"
        postPlaceholder="e.g. with subtle dolly-in"
        onChange={onUpdate}
      />
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
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getLensPromptHint(data.lens), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="lens"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. vintage"
        postPlaceholder="e.g. with chromatic aberration"
        onChange={onUpdate}
      />
      <Label>Lens</Label>
      <LensPicker
        value={data.lens || "normal-50mm"}
        onValueChange={(v) => onUpdate({ lens: v })}
      />
    </div>
  )
}

export function CameraFormatConfig({ data, onUpdate }: ConfigProps<CameraFormatData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getCameraFormatPromptHint(data.cameraFormat), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="camera-format"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. push-processed"
        postPlaceholder="e.g. with grain bloom"
        onChange={onUpdate}
      />
      <Label>Camera / Film</Label>
      <CameraFormatPicker
        value={data.cameraFormat || "35mm-film"}
        onValueChange={(v) => onUpdate({ cameraFormat: v })}
      />
    </div>
  )
}

export function LightingConfig({ data, onUpdate }: ConfigProps<LightingData>) {
  const dir = useLocaleDir()
  const maxItemsPerRow = data.maxItemsPerRow ?? 2
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, ...buildLightingHints(data), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="lighting"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. natural fill from window"
        postPlaceholder="e.g. with practical lights in frame"
        onChange={onUpdate}
      />
      <Label>Lighting</Label>
      <LightingPicker
        value={{
          timeOfDay: data.timeOfDay,
          lightingStyle: data.lightingStyle,
          lightingDirection: data.lightingDirection,
          lightingRatio: data.lightingRatio,
          colorTemperature: data.colorTemperature,
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
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getColorLookPromptHint(data.colorLook), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="color-look"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. heavy grain"
        postPlaceholder="e.g. with film burn at edges"
        onChange={onUpdate}
      />
      <Label>Color / Look</Label>
      <ColorLookPicker
        value={data.colorLook || "warm"}
        onValueChange={(v) => onUpdate({ colorLook: v })}
      />
    </div>
  )
}

export function AtmosphereConfig({ data, onUpdate }: ConfigProps<AtmosphereData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, ...buildAtmosphereHints(data.atmosphere), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="atmosphere"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. just before dawn"
        postPlaceholder="e.g. with dust suspended in beams"
        onChange={onUpdate}
      />
      <Label>Atmosphere (pick up to 2)</Label>
      <AtmospherePicker
        value={data.atmosphere}
        onValueChange={(v) => onUpdate({ atmosphere: v })}
        maxSelected={2}
      />
    </div>
  )
}

export function ActionFxConfig({ data, onUpdate }: ConfigProps<ActionFxData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, ...buildActionFxHints(data.actionFx), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="action-fx"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. mid-recoil"
        postPlaceholder="e.g. fading into smoke"
        onChange={onUpdate}
      />
      <Label>Action FX (pick up to 2)</Label>
      <ActionFxPicker
        value={data.actionFx}
        onValueChange={(v) => onUpdate({ actionFx: v })}
        maxSelected={2}
      />
    </div>
  )
}

export function StyleConfig({ data, onUpdate }: ConfigProps<StyleData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getStylePromptHint(data.style), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="style"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. wet plate aesthetic"
        postPlaceholder="e.g. with hand-printed edges"
        onChange={onUpdate}
      />
      <Label>Style</Label>
      <StylePicker
        value={data.style || "cinematic"}
        onValueChange={(v) => onUpdate({ style: v })}
      />
    </div>
  )
}

export function SettingConfig({ data, onUpdate }: ConfigProps<SettingData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getSettingPromptHint(data.setting), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="setting"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. abandoned"
        postPlaceholder="e.g. with mist creeping in"
        onChange={onUpdate}
      />
      <Label>Setting</Label>
      <SettingPicker
        value={data.setting || "forest"}
        onValueChange={(v) => onUpdate({ setting: v })}
      />
    </div>
  )
}

export function LoopSubjectConfig({ data, onUpdate }: ConfigProps<LoopSubjectData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getLoopSubjectPromptHint(data.loopSubject), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="loop-subject"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. with lightning flashes"
        postPlaceholder="e.g. seen from below"
        onChange={onUpdate}
      />
      <Label>Loop Subject</Label>
      <LoopSubjectPicker
        value={data.loopSubject || "tunnel"}
        onValueChange={(v) => onUpdate({ loopSubject: v })}
      />
      <p className="text-[10px] text-muted-foreground leading-snug">
        Wire this node&apos;s output into a Generate Image prompt input. Pair with
        Image-to-Video (VEO 3.1, same image at start AND end frame, loopTrim
        on) and the seal phrase &quot;Seamless loop: motion begins and ends in the
        exact same composition and lighting so the first and last frames match
        perfectly.&quot;
      </p>
    </div>
  )
}

export function PersonConfig({ data, onUpdate }: ConfigProps<PersonData>) {
  const dir = useLocaleDir()
  const maxItemsPerRow = data.maxItemsPerRow ?? 2
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={buildPersonHints(data)} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="person-pre-text" className="text-xs text-muted-foreground">
          Custom text (before)
        </Label>
        <Textarea
          id="person-pre-text"
          value={data.preText ?? ""}
          onChange={(e) => onUpdate({ preText: e.target.value })}
          placeholder="e.g. wet-haired, covered in paint"
          rows={2}
          className="text-xs resize-none"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="person-post-text" className="text-xs text-muted-foreground">
          Custom text (after)
        </Label>
        <Textarea
          id="person-post-text"
          value={data.postText ?? ""}
          onChange={(e) => onUpdate({ postText: e.target.value })}
          placeholder="e.g. wearing a leather jacket, with a silver necklace"
          rows={2}
          className="text-xs resize-none"
        />
      </div>
      <Label>Person</Label>
      <PersonPicker
        value={{
          type: data.type,
          age: data.age,
          customAge: data.customAge,
          ethnicity: data.ethnicity,
          regionalAesthetic: data.regionalAesthetic,
          build: data.build,
          bodyProportions: data.bodyProportions,
          faceShape: data.faceShape,
          jawline: data.jawline,
          eyeShape: data.eyeShape,
          nose: data.nose,
          lips: data.lips,
          lipState: data.lipState,
          hairColor: data.hairColor,
          hairBase: data.hairBase,
          eyebrows: data.eyebrows,
          skinTone: data.skinTone,
          skinTexture: data.skinTexture,
          eyeColor: data.eyeColor,
          eyeState: data.eyeState,
          facialHair: data.facialHair,
          distinctiveFeature: data.distinctiveFeature,
        }}
        onChange={(patch) => onUpdate(patch)}
      />
      <div className="flex items-center justify-between gap-2 pt-1">
        <Label htmlFor="person-max-items-per-row" className="text-xs text-muted-foreground">
          Items per row (node card)
        </Label>
        <input
          id="person-max-items-per-row"
          type="number"
          min={1}
          max={4}
          value={maxItemsPerRow}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isFinite(n)) return
            const clamped = Math.max(1, Math.min(4, Math.round(n)))
            onUpdate({ maxItemsPerRow: clamped })
          }}
          className="w-16 h-7 rounded-md border border-input bg-background px-2 text-xs text-right"
        />
      </div>
    </div>
  )
}

export function MoodConfig({ data, onUpdate }: ConfigProps<MoodData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={buildMoodHints(data)} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mood-pre-text" className="text-xs text-muted-foreground">
          Custom text (before)
        </Label>
        <Textarea
          id="mood-pre-text"
          value={data.preText ?? ""}
          onChange={(e) => onUpdate({ preText: e.target.value })}
          placeholder="e.g. trying to hide it"
          rows={2}
          className="text-xs resize-none"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mood-post-text" className="text-xs text-muted-foreground">
          Custom text (after)
        </Label>
        <Textarea
          id="mood-post-text"
          value={data.postText ?? ""}
          onChange={(e) => onUpdate({ postText: e.target.value })}
          placeholder="e.g. tears welling in eyes"
          rows={2}
          className="text-xs resize-none"
        />
      </div>
      <Label>Mood (pick up to 2)</Label>
      {/* Multi-pick (max 2): single → single mood hint; two → blended
          "with a X and Y expression". Numbered tile badges show pick order. */}
      <DimensionTileGrid
        entries={MOODS}
        value={data.mood}
        onChange={(v) => onUpdate({ mood: v })}
        renderIcon={(entry) => <MoodEmoji moodId={entry.id} className="size-full" />}
        searchPlaceholder="Search moods"
        gridClassName="grid grid-cols-3 gap-2"
        catalog="mood"
        maxSelected={2}
      />
    </div>
  )
}

export function PhotographerConfig({ data, onUpdate }: ConfigProps<PhotographerData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, buildPhotographerHints(data.photographer), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="photographer"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. early-career style"
        postPlaceholder="e.g. with the studio's signature lighting"
        onChange={onUpdate}
      />
      <Label>Photographer / Artist Style (pick up to 2)</Label>
      <PhotographerPicker
        value={data.photographer}
        onValueChange={(v) => onUpdate({ photographer: v })}
        maxSelected={2}
      />
    </div>
  )
}

export function AestheticConfig({ data, onUpdate }: ConfigProps<AestheticData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, buildAestheticHints(data.aesthetic), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="aesthetic"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. heavily stylized"
        postPlaceholder="e.g. with neon accents"
        onChange={onUpdate}
      />
      <Label>Aesthetic / Microtrend (pick up to 2)</Label>
      <AestheticPicker
        value={data.aesthetic}
        onValueChange={(v) => onUpdate({ aesthetic: v })}
        maxSelected={2}
      />
    </div>
  )
}

export function EraConfig({ data, onUpdate }: ConfigProps<EraData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getEraPromptHint(data.era), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="era"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. late summer"
        postPlaceholder="e.g. with VHS grain"
        onChange={onUpdate}
      />
      <Label>Era / Period</Label>
      <EraPicker
        value={data.era || "1990s-mall"}
        onValueChange={(v) => onUpdate({ era: v })}
      />
    </div>
  )
}

export function PoseConfig({ data, onUpdate }: ConfigProps<PoseData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={buildPoseHints(data)} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pose-pre-text" className="text-xs text-muted-foreground">
          Custom text (before)
        </Label>
        <Textarea
          id="pose-pre-text"
          value={data.preText ?? ""}
          onChange={(e) => onUpdate({ preText: e.target.value })}
          placeholder="e.g. about to spring"
          rows={2}
          className="text-xs resize-none"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pose-post-text" className="text-xs text-muted-foreground">
          Custom text (after)
        </Label>
        <Textarea
          id="pose-post-text"
          value={data.postText ?? ""}
          onChange={(e) => onUpdate({ postText: e.target.value })}
          placeholder="e.g. holding a sword overhead"
          rows={2}
          className="text-xs resize-none"
        />
      </div>
      <Label>Pose</Label>
      {/* Pose is a single-dimension node so the picker IS the whole node —
          render the tile grid inline instead of behind a modal trigger. */}
      <DimensionTileGrid
        entries={POSES}
        value={data.pose || "standing-upright"}
        onChange={(v) => onUpdate({ pose: v ?? "standing-upright" })}
        renderIcon={(entry) => <PoseIcon poseId={entry.id} className="size-full" />}
        searchPlaceholder="Search poses"
        gridClassName="grid grid-cols-3 gap-2"
        catalog="pose"
      />
    </div>
  )
}

export function StylingConfig({ data, onUpdate }: ConfigProps<StylingData>) {
  const dir = useLocaleDir()
  const maxItemsPerRow = data.maxItemsPerRow ?? 2
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={buildStylingHints(data)} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="styling-pre-text" className="text-xs text-muted-foreground">
          Custom text (before)
        </Label>
        <Textarea
          id="styling-pre-text"
          value={data.preText ?? ""}
          onChange={(e) => onUpdate({ preText: e.target.value })}
          placeholder="e.g. freshly retouched, magazine-cover quality"
          rows={2}
          className="text-xs resize-none"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="styling-post-text" className="text-xs text-muted-foreground">
          Custom text (after)
        </Label>
        <Textarea
          id="styling-post-text"
          value={data.postText ?? ""}
          onChange={(e) => onUpdate({ postText: e.target.value })}
          placeholder="e.g. with a ruby tennis bracelet, with rose-gold rings"
          rows={2}
          className="text-xs resize-none"
        />
      </div>
      <Label>Styling</Label>
      <StylingPicker
        value={{
          makeup: data.makeup,
          eyewear: data.eyewear,
          headwear: data.headwear,
          hairCut: data.hairCut,
          hairTreatment: data.hairTreatment,
          hairState: data.hairState,
          jewelry: data.jewelry,
          nails: data.nails,
          facePaint: data.facePaint,
          outfit: data.outfit,
          top: data.top,
          bottom: data.bottom,
          outerwear: data.outerwear,
          legwear: data.legwear,
          footwear: data.footwear,
          fabric: data.fabric,
          wardrobeState: data.wardrobeState,
        }}
        onChange={(patch) => onUpdate(patch)}
      />
      <div className="flex items-center justify-between gap-2 pt-1">
        <Label htmlFor="styling-max-items-per-row" className="text-xs text-muted-foreground">
          Items per row (node card)
        </Label>
        <input
          id="styling-max-items-per-row"
          type="number"
          min={1}
          max={4}
          value={maxItemsPerRow}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isFinite(n)) return
            const clamped = Math.max(1, Math.min(4, Math.round(n)))
            onUpdate({ maxItemsPerRow: clamped })
          }}
          className="w-16 h-7 rounded-md border border-input bg-background px-2 text-xs text-right"
        />
      </div>
    </div>
  )
}

export function TemporalConfig({ data, onUpdate }: ConfigProps<TemporalData>) {
  const dir = useLocaleDir()
  const maxItemsPerRow = data.maxItemsPerRow ?? 2
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, ...buildTemporalHints(data), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="temporal"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. ramping"
        postPlaceholder="e.g. with strobing flicker"
        onChange={onUpdate}
      />
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

export function MaterialConfig({ data, onUpdate }: ConfigProps<MaterialData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, buildMaterialHints(data.material), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="material"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. weather-beaten"
        postPlaceholder="e.g. with hairline cracks"
        onChange={onUpdate}
      />
      <Label>Material (pick up to 2)</Label>
      <MaterialPicker
        value={data.material}
        onValueChange={(v) => onUpdate({ material: v })}
        maxSelected={2}
      />
    </div>
  )
}

export function AnimalConfig({ data, onUpdate }: ConfigProps<AnimalData>) {
  const dir = useLocaleDir()
  const animal = getAnimal(data.animal)
  const hint = animal ? `featuring a ${animal.label.toLowerCase()}, ${animal.description}` : ""
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, hint, data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="animal"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. mid-leap"
        postPlaceholder="e.g. with fur catching the light"
        onChange={onUpdate}
      />
      <Label>Animal</Label>
      <AnimalPicker
        value={data.animal || "dog-golden-retriever"}
        onValueChange={(v) => onUpdate({ animal: v })}
      />
    </div>
  )
}

export function VehicleConfig({ data, onUpdate }: ConfigProps<VehicleData>) {
  const dir = useLocaleDir()
  const vehicle = getVehicle(data.vehicle)
  const hint = vehicle ? `featuring a ${vehicle.label.toLowerCase()}, ${vehicle.description}` : ""
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, hint, data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="vehicle"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. matte-black"
        postPlaceholder="e.g. with tire smoke"
        onChange={onUpdate}
      />
      <Label>Vehicle</Label>
      <VehiclePicker
        value={data.vehicle || "sedan"}
        onValueChange={(v) => onUpdate({ vehicle: v })}
      />
    </div>
  )
}

export function WeaponConfig({ data, onUpdate }: ConfigProps<WeaponData>) {
  const dir = useLocaleDir()
  const weapon = getWeapon(data.weapon)
  const hint = weapon ? `with a ${weapon.label.toLowerCase()}, ${weapon.description}` : ""
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, hint, data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="weapon"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. battle-worn"
        postPlaceholder="e.g. blood-stained"
        onChange={onUpdate}
      />
      <Label>Weapon</Label>
      <WeaponPicker
        value={data.weapon || "katana"}
        onValueChange={(v) => onUpdate({ weapon: v })}
      />
    </div>
  )
}

export function PhotoGenreConfig({ data, onUpdate }: ConfigProps<PhotoGenreData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getPhotoGenrePromptHint(data.photoGenre), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="photo-genre"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. mid-action"
        postPlaceholder="e.g. behind-the-scenes feel"
        onChange={onUpdate}
      />
      <Label>Photo Genre</Label>
      <PhotoGenrePicker
        value={data.photoGenre || "fashion-editorial"}
        onValueChange={(v) => onUpdate({ photoGenre: v })}
      />
    </div>
  )
}

export function BackdropConfig({ data, onUpdate }: ConfigProps<BackdropData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getBackdropPromptHint(data.backdrop), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="backdrop"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. softly lit"
        postPlaceholder="e.g. with subtle vignette"
        onChange={onUpdate}
      />
      <Label>Backdrop</Label>
      <BackdropPicker
        value={data.backdrop || "white-seamless"}
        onValueChange={(v) => onUpdate({ backdrop: v })}
      />
    </div>
  )
}

export function HeldPropConfig({ data, onUpdate }: ConfigProps<HeldPropData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, ...buildHeldPropHints(data.heldProp), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="held-prop"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. clutched tightly"
        postPlaceholder="e.g. with knuckles white"
        onChange={onUpdate}
      />
      <Label>Held Prop (pick up to 2)</Label>
      <HeldPropPicker
        value={data.heldProp}
        onValueChange={(v) => onUpdate({ heldProp: v })}
        maxSelected={2}
      />
    </div>
  )
}

export function ExposureSettingsConfig({ data, onUpdate }: ConfigProps<ExposureSettingsData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, ...buildExposureHints(data), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="exposure-settings"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. push +1 stop"
        postPlaceholder="e.g. with halation"
        onChange={onUpdate}
      />
      <Label>Exposure Settings</Label>
      <ExposureSettingsPicker
        value={{ aperture: data.aperture, shutterSpeed: data.shutterSpeed, isoValue: data.isoValue }}
        onChange={(patch) => onUpdate(patch)}
      />
    </div>
  )
}

export function RenderQualityConfig({ data, onUpdate }: ConfigProps<RenderQualityData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getRenderQualityPromptHint(data.renderQuality), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="render-quality"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. early ray-traced"
        postPlaceholder="e.g. with lens caustics"
        onChange={onUpdate}
      />
      <Label>Render Quality</Label>
      <RenderQualityPicker
        value={data.renderQuality || "raytracing"}
        onValueChange={(v) => onUpdate({ renderQuality: v })}
      />
    </div>
  )
}

export function CompositionEffectsConfig({ data, onUpdate }: ConfigProps<CompositionEffectsData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getCompositionEffectPromptHint(data.compositionEffect), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="composition-effects"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. subtle"
        postPlaceholder="e.g. layered"
        onChange={onUpdate}
      />
      <Label>Composition Effect</Label>
      <CompositionEffectsPicker
        value={data.compositionEffect || "bursting-through-frame"}
        onValueChange={(v) => onUpdate({ compositionEffect: v })}
      />
    </div>
  )
}

export function PostProcessEffectsConfig({ data, onUpdate }: ConfigProps<PostProcessEffectsData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, ...buildPostProcessHints(data.postProcess), data.postText].filter(Boolean) as string[]} />
      <CustomTextRows
        idPrefix="post-process-effects"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. light dose"
        postPlaceholder="e.g. plus subtle film grain"
        onChange={onUpdate}
      />
      <Label>Post-Process Effect (pick up to 2)</Label>
      <PostProcessEffectsPicker
        value={data.postProcess}
        onValueChange={(v) => onUpdate({ postProcess: v })}
        maxSelected={2}
      />
    </div>
  )
}
