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
  SettingData,
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
import { StylePicker } from "./style-picker"
import { SettingPicker } from "./setting-picker"
import { PersonPicker } from "./person-picker"
import { MOODS } from "@nodaro-shared/mood"
import { MoodEmoji } from "./mood-emoji"
import { DimensionTileGrid } from "./dimension-tile-grid"
import { POSES } from "@nodaro-shared/pose"
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
import { buildFramingHints } from "@nodaro-shared/framing"
import { getLensPromptHint } from "@nodaro-shared/lens"
import { getCameraFormatPromptHint } from "@nodaro-shared/camera-format"
import { buildLightingHints } from "@nodaro-shared/lighting"
import { getColorLookPromptHint } from "@nodaro-shared/color-look"
import { getAtmospherePromptHint } from "@nodaro-shared/atmosphere"
import { getStylePromptHint } from "@nodaro-shared/style"
import { getSettingPromptHint } from "@nodaro-shared/setting"
import { buildPersonHints } from "@nodaro-shared/person"
import { buildMoodHints } from "@nodaro-shared/mood"
import { buildPoseHints } from "@nodaro-shared/pose"
import { buildStylingHints } from "@nodaro-shared/styling"
import { buildTemporalHints } from "@nodaro-shared/temporal"
import { getMaterialPromptHint } from "@nodaro-shared/materials"
import { getAnimal } from "@nodaro-shared/animals"
import { getVehicle } from "@nodaro-shared/vehicles"
import { getWeapon } from "@nodaro-shared/weapons"
import { getPhotoGenrePromptHint } from "@nodaro-shared/photo-genre"
import { getBackdropPromptHint } from "@nodaro-shared/backdrop"
import { getHeldPropPromptHint } from "@nodaro-shared/held-prop"
import { getPhotographerPromptHint } from "@nodaro-shared/photographer"
import { buildAestheticHints } from "@nodaro-shared/aesthetic"
import { getEraPromptHint } from "@nodaro-shared/era"
import { buildExposureHints } from "@nodaro-shared/exposure-settings"
import { getRenderQualityPromptHint } from "@nodaro-shared/render-quality"
import { getCompositionEffectPromptHint } from "@nodaro-shared/composition-effects"
import { getPostProcessEffectPromptHint } from "@nodaro-shared/post-process-effects"
import { useLocaleDir } from "@/lib/locale-store"
import { LocalePicker } from "@/components/editor/locale-picker"
import type { ConfigProps } from "./types"

/**
 * Compact header row that mounts the locale picker at the top of each
 * parameter-node config panel. Lets the user switch the picker language
 * (English ↔ localized) for every i18n-aware picker in the panel below.
 */
function LocaleHeader() {
  return (
    <div className="flex items-center justify-end -mt-1 -mb-2">
      <LocalePicker />
    </div>
  )
}

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
  const dir = useLocaleDir()
  const maxItemsPerRow = data.maxItemsPerRow ?? 2
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
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
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
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
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
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
  const dir = useLocaleDir()
  const maxItemsPerRow = data.maxItemsPerRow ?? 2
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
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
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
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
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
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
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[getStylePromptHint(data.style)]} />
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
      <PromptInjectionPreview hints={[getSettingPromptHint(data.setting)]} />
      <Label>Setting</Label>
      <SettingPicker
        value={data.setting || "forest"}
        onValueChange={(v) => onUpdate({ setting: v })}
      />
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
          ethnicity: data.ethnicity,
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
        value={data.mood ?? "calm"}
        onChange={(v) => onUpdate({ mood: v ?? "calm" })}
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
      <PromptInjectionPreview hints={[getPhotographerPromptHint(data.photographer)]} />
      <Label>Photographer / Artist Style</Label>
      <PhotographerPicker
        value={data.photographer || "tim-walker"}
        onValueChange={(v) => onUpdate({ photographer: v })}
      />
    </div>
  )
}

export function AestheticConfig({ data, onUpdate }: ConfigProps<AestheticData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[buildAestheticHints(data.aesthetic)]} />
      <Label>Aesthetic / Microtrend (pick up to 2)</Label>
      <AestheticPicker
        value={data.aesthetic ?? "y2k"}
        onValueChange={(v) => onUpdate({ aesthetic: v ?? "y2k" })}
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
      <PromptInjectionPreview hints={[getEraPromptHint(data.era)]} />
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
          jewelry: data.jewelry,
          nails: data.nails,
          facePaint: data.facePaint,
          fabric: data.fabric,
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

export function MaterialConfig({ data, onUpdate }: ConfigProps<MaterialData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[getMaterialPromptHint(data.material)]} />
      <Label>Material</Label>
      <MaterialPicker
        value={data.material || "silk"}
        onValueChange={(v) => onUpdate({ material: v })}
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
      <PromptInjectionPreview hints={[hint]} />
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
      <PromptInjectionPreview hints={[hint]} />
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
      <PromptInjectionPreview hints={[hint]} />
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
      <PromptInjectionPreview hints={[getPhotoGenrePromptHint(data.photoGenre)]} />
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
      <PromptInjectionPreview hints={[getBackdropPromptHint(data.backdrop)]} />
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
      <PromptInjectionPreview hints={[getHeldPropPromptHint(data.heldProp)]} />
      <Label>Held Prop</Label>
      <HeldPropPicker
        value={data.heldProp || "smartphone"}
        onValueChange={(v) => onUpdate({ heldProp: v })}
      />
    </div>
  )
}

export function ExposureSettingsConfig({ data, onUpdate }: ConfigProps<ExposureSettingsData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={buildExposureHints(data)} />
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
      <PromptInjectionPreview hints={[getRenderQualityPromptHint(data.renderQuality)]} />
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
      <PromptInjectionPreview hints={[getCompositionEffectPromptHint(data.compositionEffect)]} />
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
      <PromptInjectionPreview hints={[getPostProcessEffectPromptHint(data.postProcess)]} />
      <Label>Post-Process Effect</Label>
      <PostProcessEffectsPicker
        value={data.postProcess || "vignette-soft"}
        onValueChange={(v) => onUpdate({ postProcess: v })}
      />
    </div>
  )
}
