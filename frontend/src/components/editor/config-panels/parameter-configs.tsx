"use client"

import { useT, tx } from "@/lib/i18n"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
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
  FurnitureData,
  PhotoGenreData,
  BackdropData,
  HeldPropData,
  TemporalData,
  ExposureSettingsData,
  RenderQualityData,
  CompositionEffectsData,
  PostProcessEffectsData,
  TransitionData,
  TransitionPosition,
  TransitionDuration,
  TransitionIntensity,
  CharacterFxData,
} from "@/types/nodes"
import { CameraMotionPicker, useCuratedEntries } from "@/lib/picker-ui"
import { FramingPicker } from "@/lib/picker-ui"
import { LensPicker } from "@/lib/picker-ui"
import { CameraFormatPicker } from "@/lib/picker-ui"
import { LightingPicker } from "@/lib/picker-ui"
import { ColorLookPicker } from "@/lib/picker-ui"
import { AtmospherePicker } from "@/lib/picker-ui"
import { ActionFxPicker } from "@/lib/picker-ui"
import { StylePicker } from "@/lib/picker-ui"
import { SettingPicker } from "@/lib/picker-ui"
import { LoopSubjectPicker } from "@/lib/picker-ui"
import { PersonPicker } from "@/lib/picker-ui"
import { MOODS as BASE_MOODS, POSES as BASE_POSES, buildFramingHints, getLensPromptHint, getCameraFormatPromptHint, buildLightingHints, getColorLookPromptHint, buildAtmosphereHints, buildActionFxHints, getStylePromptHint, getSettingPromptHint, getLoopSubjectPromptHint, buildMoodHints, buildPoseHints, buildStylingHints, buildTemporalHints, buildMaterialHints, getPhotoGenrePromptHint, getBackdropPromptHint, buildHeldPropHints, buildPhotographerHints, buildAestheticHints, getEraPromptHint, buildExposureHints, getRenderQualityPromptHint, getCompositionEffectPromptHint, buildPostProcessHints, buildPersonHints, TRANSITION_POSITIONS, TRANSITION_DURATIONS, TRANSITION_INTENSITIES, CHARACTER_FX_POSITIONS, CHARACTER_FX_DURATIONS, CHARACTER_FX_INTENSITIES } from "@nodaro/prompts"
import { getAnimal, getVehicle, getWeapon, getFurniture } from "@nodaro/shared"
import { MoodEmoji } from "@/lib/picker-ui"
import { DimensionTileGrid } from "@/lib/picker-ui"
import { PoseIcon } from "@/lib/picker-ui"
import { StylingPicker } from "@/lib/picker-ui"
import { TemporalPicker } from "@/lib/picker-ui"
import { MaterialPicker } from "@/lib/picker-ui"
import { AnimalPicker } from "@/lib/picker-ui"
import { VehiclePicker } from "@/lib/picker-ui"
import { WeaponPicker } from "@/lib/picker-ui"
import { FurniturePicker } from "@/lib/picker-ui"
import { PhotoGenrePicker } from "@/lib/picker-ui"
import { BackdropPicker } from "@/lib/picker-ui"
import { HeldPropPicker } from "@/lib/picker-ui"
import { ExposureSettingsPicker } from "@/lib/picker-ui"
import { RenderQualityPicker } from "@/lib/picker-ui"
import { CompositionEffectsPicker } from "@/lib/picker-ui"
import { PostProcessEffectsPicker } from "@/lib/picker-ui"
import { TransitionPicker } from "@/lib/picker-ui"
import { CharacterFxPicker } from "@/lib/picker-ui"
import { PhotographerPicker } from "@/lib/picker-ui"
import { AestheticPicker } from "@/lib/picker-ui"
import { EraPicker } from "@/lib/picker-ui"
import { PromptInjectionPreview } from "./prompt-injection-preview"
import { composeCameraMotionHintForNode, composeTransitionHintForNode, composeCharacterFxHintForNode } from "@/lib/cinematography-hints"
import { usePickerDir } from "@/lib/locale-store"
import { LocaleHeader } from "./locale-header"
import { CustomTextRows } from "./custom-text-rows"
import type { ConfigProps } from "./types"

export function ToneConfig({ data, onUpdate }: ConfigProps<ToneData>) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="tone-value">{t("paramcfg.tone")}</Label>
        <Input
          id="tone-value"
          value={data.tone}
          onChange={(e) => onUpdate({ tone: e.target.value })}
          placeholder={t("paramcfg.eGDramaticPlayfulDark")}
        />
      </div>
    </div>
  )
}

export function StyleGuideConfig({ data, onUpdate }: ConfigProps<StyleGuideData>) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="style-text">{t("paramcfg.styleDescription")}</Label>
        <Textarea
          id="style-text"
          rows={3}
          value={data.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          placeholder={t("paramcfg.eGStudioGhibliWatercolor")}
        />
      </div>
    </div>
  )
}

export function ProviderConfig({ data, onUpdate }: ConfigProps<ProviderData>) {
  const t = useT()
  const category = data.category as ProviderCategory
  const providers = getProviders(category)
  const models = getModels(category, data.provider)

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>{t("apps.categoryLabel")}</Label>
        <Select
          value={data.category}
          onValueChange={(v) => {
            const cat = v as ProviderCategory
            const firstProvider = getFirstProvider(cat)
            const firstModel = getFirstModel(cat, firstProvider)
            onUpdate({ category: cat, provider: firstProvider, model: firstModel })
          }}
        >
          <SelectTrigger aria-label={t("apps.categoryLabel")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="image">{t("common.image")}</SelectItem>
            <SelectItem value="video">{t("common.video")}</SelectItem>
            <SelectItem value="voice">{t("field.voice")}</SelectItem>
            <SelectItem value="script">{t("node.script")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>{t("field.provider")}</Label>
        <Select
          value={data.provider}
          onValueChange={(v) => {
            const firstModel = getFirstModel(category, v)
            onUpdate({ provider: v, model: firstModel })
          }}
        >
          <SelectTrigger aria-label={t("field.provider")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p} value={p}>{getProviderLabel(category, p)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>{t("field.model")}</Label>
        <Select
          value={data.model}
          onValueChange={(v) => onUpdate({ model: v })}
        >
          <SelectTrigger aria-label={t("field.model")}><SelectValue /></SelectTrigger>
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
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="scene-count-val">{t("paramcfg.numberOfScenes")}</Label>
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
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="duration-seconds">{t("field.durationSeconds")}</Label>
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
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>{t("field.aspectRatio")}</Label>
        <Select
          value={data.ratio}
          onValueChange={(v) => onUpdate({ ratio: v as AspectRatioData["ratio"] })}
        >
          <SelectTrigger aria-label={t("paramcfg.aspectRatio")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1:1">{t("paramcfg.11Square")}</SelectItem>
            <SelectItem value="16:9">{t("paramcfg.169Landscape")}</SelectItem>
            <SelectItem value="9:16">{t("paramcfg.916Portrait")}</SelectItem>
            <SelectItem value="4:3">4:3</SelectItem>
            <SelectItem value="4:5">4:5</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export function MotionConfig({ data, onUpdate }: ConfigProps<MotionData>) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>{t("field.motion")}</Label>
        <Select
          value={data.motion}
          onValueChange={(v) => onUpdate({ motion: v as MotionData["motion"] })}
        >
          <SelectTrigger aria-label={t("field.motion")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="subtle">{t("vidcfg.subtle")}</SelectItem>
            <SelectItem value="moderate">{t("vidcfg.moderate")}</SelectItem>
            <SelectItem value="dynamic">{t("vidcfg.dynamic")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export function CameraMotionConfig({ data, onUpdate, nodes, edges, nodeId }: ConfigProps<CameraMotionData> & { nodeId?: string }) {
  const t = useT()
  const dir = usePickerDir()
  const composed = composeCameraMotionHintForNode(
    data.cameraMotion,
    nodeId,
    nodes,
    edges ?? [],
  )
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, composed, data.postText]} />
      <p className="text-[10px] text-muted-foreground italic px-0.5">
        {t("paramcfg.connectParameterNodesToStartstateEndstat")}
      </p>
      <CustomTextRows
        idPrefix="camera-motion"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGStartsHandheld")}
        postPlaceholder={t("paramcfg.eGSettlesToLockOff")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.cameraMotion")}</Label>
      <CameraMotionPicker
        value={data.cameraMotion || "static"}
        onValueChange={(v) => onUpdate({ cameraMotion: v })}
      />
    </div>
  )
}

export function FramingConfig({ data, onUpdate }: ConfigProps<FramingData>) {
  const t = useT()
  const dir = usePickerDir()
  const maxItemsPerRow = data.maxItemsPerRow ?? 2
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, buildFramingHints(data), data.postText]} />
      <CustomTextRows
        idPrefix="framing"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGHandheldFeel")}
        postPlaceholder={t("paramcfg.eGWithSubtleDollyIn")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.framing")}</Label>
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
          {t("paramcfg.itemsPerRowNodeCard")}
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
          className="w-16 h-8 rounded-md border border-input bg-transparent px-2 text-xs text-end"
        />
      </div>
    </div>
  )
}

export function LensConfig({ data, onUpdate }: ConfigProps<LensData>) {
  const t = useT()
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getLensPromptHint(data.lens), data.postText]} />
      <CustomTextRows
        idPrefix="lens"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGVintage")}
        postPlaceholder={t("paramcfg.eGWithChromaticAberration")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.lens")}</Label>
      <LensPicker
        value={data.lens || "normal-50mm"}
        onValueChange={(v) => onUpdate({ lens: v })}
      />
    </div>
  )
}

export function CameraFormatConfig({ data, onUpdate }: ConfigProps<CameraFormatData>) {
  const t = useT()
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getCameraFormatPromptHint(data.cameraFormat), data.postText]} />
      <CustomTextRows
        idPrefix="camera-format"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGPushProcessed")}
        postPlaceholder={t("paramcfg.eGWithGrainBloom")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.cameraFilm")}</Label>
      <CameraFormatPicker
        value={data.cameraFormat || "35mm-film"}
        onValueChange={(v) => onUpdate({ cameraFormat: v })}
      />
    </div>
  )
}

export function LightingConfig({ data, onUpdate }: ConfigProps<LightingData>) {
  const t = useT()
  const dir = usePickerDir()
  const maxItemsPerRow = data.maxItemsPerRow ?? 2
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, buildLightingHints(data), data.postText]} />
      <CustomTextRows
        idPrefix="lighting"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGNaturalFillFromWindow")}
        postPlaceholder={t("paramcfg.eGWithPracticalLightsIn")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.lighting")}</Label>
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
          {t("paramcfg.itemsPerRowNodeCard")}
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
          className="w-16 h-8 rounded-md border border-input bg-transparent px-2 text-xs text-end"
        />
      </div>
    </div>
  )
}

export function ColorLookConfig({ data, onUpdate }: ConfigProps<ColorLookData>) {
  const t = useT()
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getColorLookPromptHint(data.colorLook), data.postText]} />
      <CustomTextRows
        idPrefix="color-look"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGHeavyGrain")}
        postPlaceholder={t("paramcfg.eGWithFilmBurnAt")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.colorLook")}</Label>
      <ColorLookPicker
        value={data.colorLook || "warm"}
        onValueChange={(v) => onUpdate({ colorLook: v })}
      />
    </div>
  )
}

export function AtmosphereConfig({ data, onUpdate }: ConfigProps<AtmosphereData>) {
  const t = useT()
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, buildAtmosphereHints(data.atmosphere), data.postText]} />
      <CustomTextRows
        idPrefix="atmosphere"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGJustBeforeDawn")}
        postPlaceholder={t("paramcfg.eGWithDustSuspendedIn")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.atmospherePickUpTo2")}</Label>
      <AtmospherePicker
        value={data.atmosphere}
        onValueChange={(v) => onUpdate({ atmosphere: v })}
        maxSelected={2}
      />
    </div>
  )
}

export function ActionFxConfig({ data, onUpdate }: ConfigProps<ActionFxData>) {
  const t = useT()
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, buildActionFxHints(data.actionFx), data.postText]} />
      <CustomTextRows
        idPrefix="action-fx"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGMidRecoil")}
        postPlaceholder={t("paramcfg.eGFadingIntoSmoke")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.actionFxPickUpTo2")}</Label>
      <ActionFxPicker
        value={data.actionFx}
        onValueChange={(v) => onUpdate({ actionFx: v })}
        maxSelected={2}
      />
    </div>
  )
}

export function StyleConfig({ data, onUpdate }: ConfigProps<StyleData>) {
  const t = useT()
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getStylePromptHint(data.style), data.postText]} />
      <CustomTextRows
        idPrefix="style"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGWetPlateAesthetic")}
        postPlaceholder={t("paramcfg.eGWithHandPrintedEdges")}
        onChange={onUpdate}
      />
      <Label>{t("field.style")}</Label>
      <StylePicker
        value={data.style || "cinematic"}
        onValueChange={(v) => onUpdate({ style: v })}
      />
    </div>
  )
}

export function SettingConfig({ data, onUpdate }: ConfigProps<SettingData>) {
  const t = useT()
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getSettingPromptHint(data.setting), data.postText]} />
      <CustomTextRows
        idPrefix="setting"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGAbandoned")}
        postPlaceholder={t("paramcfg.eGWithMistCreepingIn")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.setting")}</Label>
      <SettingPicker
        value={data.setting || "forest"}
        onValueChange={(v) => onUpdate({ setting: v })}
      />
    </div>
  )
}

export function LoopSubjectConfig({ data, onUpdate }: ConfigProps<LoopSubjectData>) {
  const t = useT()
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getLoopSubjectPromptHint(data.loopSubject), data.postText]} />
      <CustomTextRows
        idPrefix="loop-subject"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGWithLightningFlashes")}
        postPlaceholder={t("paramcfg.eGSeenFromBelow")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.loopSubject")}</Label>
      <LoopSubjectPicker
        value={data.loopSubject || "tunnel"}
        onValueChange={(v) => onUpdate({ loopSubject: v })}
      />
      <p className="text-[10px] text-muted-foreground leading-snug">
        {t("paramcfg.wireThisNodeSOutputInto")}
      </p>
    </div>
  )
}

export function PersonConfig({ data, onUpdate }: ConfigProps<PersonData>) {
  const t = useT()
  const dir = usePickerDir()
  const maxItemsPerRow = data.maxItemsPerRow ?? 2
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={buildPersonHints(data)} />
      <div className="flex flex-col gap-2 rounded-md border border-border/60 p-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="person-apply-mode" className="text-xs text-muted-foreground">
            {t("paramcfg.whenImageJsonIsInjected")}
          </Label>
        </div>
        <Select
          value={data.applyMode ?? "override"}
          onValueChange={(v) => onUpdate({ applyMode: v as PersonData["applyMode"] })}
        >
          <SelectTrigger id="person-apply-mode" aria-label={t("paramcfg.applyMode")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="override">{t("paramcfg.fullOverrideClearUndetected")}</SelectItem>
            <SelectItem value="overwrite-detected">{t("paramcfg.overwriteDetectedKeepRest")}</SelectItem>
            <SelectItem value="fill-empty">{t("paramcfg.fillEmptyOnly")}</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="person-auto-apply" className="text-xs text-muted-foreground">
            {t("paramcfg.autoApplyOnChange")}
          </Label>
          <Switch
            id="person-auto-apply"
            checked={data.autoApplyInjected ?? false}
            onCheckedChange={(c) => onUpdate({ autoApplyInjected: c })}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="person-pre-text" className="text-xs text-muted-foreground">
          {t("paramcfg.customTextBefore")}
        </Label>
        <Textarea
          id="person-pre-text"
          value={data.preText ?? ""}
          onChange={(e) => onUpdate({ preText: e.target.value })}
          placeholder={t("paramcfg.eGWetHairedCoveredIn")}
          rows={2}
          className="text-xs resize-none"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="person-post-text" className="text-xs text-muted-foreground">
          {t("paramcfg.customTextAfter")}
        </Label>
        <Textarea
          id="person-post-text"
          value={data.postText ?? ""}
          onChange={(e) => onUpdate({ postText: e.target.value })}
          placeholder={t("paramcfg.eGWearingALeatherJacket")}
          rows={2}
          className="text-xs resize-none"
        />
      </div>
      <Label>{t("paramcfg.person")}</Label>
      {/* PersonData is a superset of PersonValue (every dimension field, plus
          node-only extras like preText/maxItemsPerRow that the picker ignores),
          so forward it whole. A hand-listed subset silently drops any newly-added
          dimension's field — that drift caused the facial-geometry fields
          (eye-spacing, cheekbones, …) to persist but never read back as selected. */}
      <PersonPicker value={data} onChange={(patch) => onUpdate(patch)} />
      <div className="flex items-center justify-between gap-2 pt-1">
        <Label htmlFor="person-max-items-per-row" className="text-xs text-muted-foreground">
          {t("paramcfg.itemsPerRowNodeCard")}
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
          className="w-16 h-7 rounded-md border border-input bg-background px-2 text-xs text-end"
        />
      </div>
    </div>
  )
}

export function MoodConfig({ data, onUpdate }: ConfigProps<MoodData>) {
  const t = useT()
  const MOODS = useCuratedEntries("mood", BASE_MOODS)
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={buildMoodHints(data)} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mood-pre-text" className="text-xs text-muted-foreground">
          {t("paramcfg.customTextBefore")}
        </Label>
        <Textarea
          id="mood-pre-text"
          value={data.preText ?? ""}
          onChange={(e) => onUpdate({ preText: e.target.value })}
          placeholder={t("paramcfg.eGTryingToHideIt")}
          rows={2}
          className="text-xs resize-none"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mood-post-text" className="text-xs text-muted-foreground">
          {t("paramcfg.customTextAfter")}
        </Label>
        <Textarea
          id="mood-post-text"
          value={data.postText ?? ""}
          onChange={(e) => onUpdate({ postText: e.target.value })}
          placeholder={t("paramcfg.eGTearsWellingInEyes")}
          rows={2}
          className="text-xs resize-none"
        />
      </div>
      <Label>{t("paramcfg.moodPickUpTo2")}</Label>
      {/* Multi-pick (max 2): single → single mood hint; two → blended
          "with a X and Y expression". Numbered tile badges show pick order. */}
      <DimensionTileGrid
        entries={MOODS}
        value={data.mood}
        onChange={(v) => onUpdate({ mood: v })}
        renderIcon={(entry) => <MoodEmoji moodId={entry.id} className="size-full" />}
        searchPlaceholder={t("paramcfg.searchMoods")}
        gridClassName="grid grid-cols-3 gap-2"
        catalog="mood"
        maxSelected={2}
      />
    </div>
  )
}

export function PhotographerConfig({ data, onUpdate }: ConfigProps<PhotographerData>) {
  const t = useT()
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, buildPhotographerHints(data.photographer), data.postText]} />
      <CustomTextRows
        idPrefix="photographer"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGEarlyCareerStyle")}
        postPlaceholder={t("paramcfg.eGWithTheStudioS")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.photographerArtistStylePickUpTo")}</Label>
      <PhotographerPicker
        value={data.photographer}
        onValueChange={(v) => onUpdate({ photographer: v })}
        maxSelected={2}
      />
    </div>
  )
}

export function AestheticConfig({ data, onUpdate }: ConfigProps<AestheticData>) {
  const t = useT()
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, buildAestheticHints(data.aesthetic), data.postText]} />
      <CustomTextRows
        idPrefix="aesthetic"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGHeavilyStylized")}
        postPlaceholder={t("paramcfg.eGWithNeonAccents")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.aestheticMicrotrendPickUpTo2")}</Label>
      <AestheticPicker
        value={data.aesthetic}
        onValueChange={(v) => onUpdate({ aesthetic: v })}
        maxSelected={2}
      />
    </div>
  )
}

export function EraConfig({ data, onUpdate }: ConfigProps<EraData>) {
  const t = useT()
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getEraPromptHint(data.era), data.postText]} />
      <CustomTextRows
        idPrefix="era"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGLateSummer")}
        postPlaceholder={t("paramcfg.eGWithVhsGrain")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.eraPeriod")}</Label>
      <EraPicker
        value={data.era || "1990s-mall"}
        onValueChange={(v) => onUpdate({ era: v })}
      />
    </div>
  )
}

export function PoseConfig({ data, onUpdate }: ConfigProps<PoseData>) {
  const t = useT()
  const POSES = useCuratedEntries("pose", BASE_POSES)
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={buildPoseHints(data)} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pose-pre-text" className="text-xs text-muted-foreground">
          {t("paramcfg.customTextBefore")}
        </Label>
        <Textarea
          id="pose-pre-text"
          value={data.preText ?? ""}
          onChange={(e) => onUpdate({ preText: e.target.value })}
          placeholder={t("paramcfg.eGAboutToSpring")}
          rows={2}
          className="text-xs resize-none"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pose-post-text" className="text-xs text-muted-foreground">
          {t("paramcfg.customTextAfter")}
        </Label>
        <Textarea
          id="pose-post-text"
          value={data.postText ?? ""}
          onChange={(e) => onUpdate({ postText: e.target.value })}
          placeholder={t("paramcfg.eGHoldingASwordOverhead")}
          rows={2}
          className="text-xs resize-none"
        />
      </div>
      <Label>{t("paramcfg.pose")}</Label>
      {/* Pose is a single-dimension node so the picker IS the whole node —
          render the tile grid inline instead of behind a modal trigger. */}
      <DimensionTileGrid
        entries={POSES}
        value={data.pose || "standing-upright"}
        onChange={(v) => onUpdate({ pose: v ?? "standing-upright" })}
        renderIcon={(entry) => <PoseIcon poseId={entry.id} className="size-full" />}
        searchPlaceholder={t("paramcfg.searchPoses")}
        gridClassName="grid grid-cols-3 gap-2"
        catalog="pose"
      />
    </div>
  )
}

export function StylingConfig({ data, onUpdate }: ConfigProps<StylingData>) {
  const t = useT()
  const dir = usePickerDir()
  const maxItemsPerRow = data.maxItemsPerRow ?? 2
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={buildStylingHints(data)} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="styling-pre-text" className="text-xs text-muted-foreground">
          {t("paramcfg.customTextBefore")}
        </Label>
        <Textarea
          id="styling-pre-text"
          value={data.preText ?? ""}
          onChange={(e) => onUpdate({ preText: e.target.value })}
          placeholder={t("paramcfg.eGFreshlyRetouchedMagazineCover")}
          rows={2}
          className="text-xs resize-none"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="styling-post-text" className="text-xs text-muted-foreground">
          {t("paramcfg.customTextAfter")}
        </Label>
        <Textarea
          id="styling-post-text"
          value={data.postText ?? ""}
          onChange={(e) => onUpdate({ postText: e.target.value })}
          placeholder={t("paramcfg.eGWithARubyTennis")}
          rows={2}
          className="text-xs resize-none"
        />
      </div>
      <Label>{t("paramcfg.styling")}</Label>
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
          {t("paramcfg.itemsPerRowNodeCard")}
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
          className="w-16 h-7 rounded-md border border-input bg-background px-2 text-xs text-end"
        />
      </div>
    </div>
  )
}

export function TemporalConfig({ data, onUpdate }: ConfigProps<TemporalData>) {
  const t = useT()
  const dir = usePickerDir()
  const maxItemsPerRow = data.maxItemsPerRow ?? 2
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, buildTemporalHints(data), data.postText]} />
      <CustomTextRows
        idPrefix="temporal"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGRamping")}
        postPlaceholder={t("paramcfg.eGWithStrobingFlicker")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.temporal")}</Label>
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
          {t("paramcfg.itemsPerRowNodeCard")}
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
          className="w-16 h-8 rounded-md border border-input bg-transparent px-2 text-xs text-end"
        />
      </div>
    </div>
  )
}

export function MaterialConfig({ data, onUpdate }: ConfigProps<MaterialData>) {
  const t = useT()
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, buildMaterialHints(data.material), data.postText]} />
      <CustomTextRows
        idPrefix="material"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGWeatherBeaten")}
        postPlaceholder={t("paramcfg.eGWithHairlineCracks")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.materialPickUpTo2")}</Label>
      <MaterialPicker
        value={data.material}
        onValueChange={(v) => onUpdate({ material: v })}
        maxSelected={2}
      />
    </div>
  )
}

export function AnimalConfig({ data, onUpdate }: ConfigProps<AnimalData>) {
  const t = useT()
  const dir = usePickerDir()
  const animal = getAnimal(data.animal)
  const hint = animal ? `featuring a ${animal.label.toLowerCase()}, ${animal.description}` : ""
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, hint, data.postText]} />
      <CustomTextRows
        idPrefix="animal"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGMidLeap")}
        postPlaceholder={t("paramcfg.eGWithFurCatchingThe")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.animal")}</Label>
      <AnimalPicker
        value={data.animal || "dog-golden-retriever"}
        onValueChange={(v) => onUpdate({ animal: v })}
      />
    </div>
  )
}

export function VehicleConfig({ data, onUpdate }: ConfigProps<VehicleData>) {
  const t = useT()
  const dir = usePickerDir()
  const vehicle = getVehicle(data.vehicle)
  const hint = vehicle ? `featuring a ${vehicle.label.toLowerCase()}, ${vehicle.description}` : ""
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, hint, data.postText]} />
      <CustomTextRows
        idPrefix="vehicle"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGMatteBlack")}
        postPlaceholder={t("paramcfg.eGWithTireSmoke")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.vehicle")}</Label>
      <VehiclePicker
        value={data.vehicle || "sedan"}
        onValueChange={(v) => onUpdate({ vehicle: v })}
      />
    </div>
  )
}

export function WeaponConfig({ data, onUpdate }: ConfigProps<WeaponData>) {
  const t = useT()
  const dir = usePickerDir()
  const weapon = getWeapon(data.weapon)
  const hint = weapon ? `with a ${weapon.label.toLowerCase()}, ${weapon.description}` : ""
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, hint, data.postText]} />
      <CustomTextRows
        idPrefix="weapon"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGBattleWorn")}
        postPlaceholder={t("paramcfg.eGBloodStained")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.weapon")}</Label>
      <WeaponPicker
        value={data.weapon || "katana"}
        onValueChange={(v) => onUpdate({ weapon: v })}
      />
    </div>
  )
}

export function FurnitureConfig({ data, onUpdate }: ConfigProps<FurnitureData>) {
  const t = useT()
  const dir = usePickerDir()
  const furniture = getFurniture(data.furniture)
  const hint = furniture ? `featuring ${furniture.label.toLowerCase()}, ${furniture.description}` : ""
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, hint, data.postText]} />
      <CustomTextRows
        idPrefix="furniture"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGMidCentury")}
        postPlaceholder={t("paramcfg.eGInWalnut")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.furniture")}</Label>
      <FurniturePicker
        value={data.furniture || "sofa"}
        onValueChange={(v) => onUpdate({ furniture: v })}
      />
    </div>
  )
}

export function PhotoGenreConfig({ data, onUpdate }: ConfigProps<PhotoGenreData>) {
  const t = useT()
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getPhotoGenrePromptHint(data.photoGenre), data.postText]} />
      <CustomTextRows
        idPrefix="photo-genre"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGMidAction")}
        postPlaceholder={t("paramcfg.eGBehindTheScenesFeel")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.photoGenre")}</Label>
      <PhotoGenrePicker
        value={data.photoGenre || "fashion-editorial"}
        onValueChange={(v) => onUpdate({ photoGenre: v })}
      />
    </div>
  )
}

export function BackdropConfig({ data, onUpdate }: ConfigProps<BackdropData>) {
  const t = useT()
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getBackdropPromptHint(data.backdrop), data.postText]} />
      <CustomTextRows
        idPrefix="backdrop"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGSoftlyLit")}
        postPlaceholder={t("paramcfg.eGWithSubtleVignette")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.backdrop")}</Label>
      <BackdropPicker
        value={data.backdrop || "white-seamless"}
        onValueChange={(v) => onUpdate({ backdrop: v })}
      />
    </div>
  )
}

export function HeldPropConfig({ data, onUpdate }: ConfigProps<HeldPropData>) {
  const t = useT()
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, buildHeldPropHints(data.heldProp), data.postText]} />
      <CustomTextRows
        idPrefix="held-prop"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGClutchedTightly")}
        postPlaceholder={t("paramcfg.eGWithKnucklesWhite")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.heldPropPickUpTo2")}</Label>
      <HeldPropPicker
        value={data.heldProp}
        onValueChange={(v) => onUpdate({ heldProp: v })}
        maxSelected={2}
      />
    </div>
  )
}

export function ExposureSettingsConfig({ data, onUpdate }: ConfigProps<ExposureSettingsData>) {
  const t = useT()
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, buildExposureHints(data), data.postText]} />
      <CustomTextRows
        idPrefix="exposure-settings"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGPush1Stop")}
        postPlaceholder={t("paramcfg.eGWithHalation")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.exposureSettings")}</Label>
      <ExposureSettingsPicker
        value={{ aperture: data.aperture, shutterSpeed: data.shutterSpeed, isoValue: data.isoValue }}
        onChange={(patch) => onUpdate(patch)}
      />
    </div>
  )
}

export function RenderQualityConfig({ data, onUpdate }: ConfigProps<RenderQualityData>) {
  const t = useT()
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getRenderQualityPromptHint(data.renderQuality), data.postText]} />
      <CustomTextRows
        idPrefix="render-quality"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGEarlyRayTraced")}
        postPlaceholder={t("paramcfg.eGWithLensCaustics")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.renderQuality")}</Label>
      <RenderQualityPicker
        value={data.renderQuality || "raytracing"}
        onValueChange={(v) => onUpdate({ renderQuality: v })}
      />
    </div>
  )
}

export function CompositionEffectsConfig({ data, onUpdate }: ConfigProps<CompositionEffectsData>) {
  const t = useT()
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, getCompositionEffectPromptHint(data.compositionEffect), data.postText]} />
      <CustomTextRows
        idPrefix="composition-effects"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGSubtle")}
        postPlaceholder={t("paramcfg.eGLayered")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.compositionEffect")}</Label>
      <CompositionEffectsPicker
        value={data.compositionEffect || "none"}
        onValueChange={(v) => onUpdate({ compositionEffect: v })}
      />
    </div>
  )
}

export function PostProcessEffectsConfig({ data, onUpdate }: ConfigProps<PostProcessEffectsData>) {
  const t = useT()
  const dir = usePickerDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, buildPostProcessHints(data.postProcess), data.postText]} />
      <CustomTextRows
        idPrefix="post-process-effects"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGLightDose")}
        postPlaceholder={t("paramcfg.eGPlusSubtleFilmGrain")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.postProcessEffectPickUpTo")}</Label>
      <PostProcessEffectsPicker
        value={data.postProcess}
        onValueChange={(v) => onUpdate({ postProcess: v })}
        maxSelected={2}
      />
    </div>
  )
}

// Built from the catalogs the API also serves, so the editor and an id-only
// client (Studio, SDK, MCP) can never show different labels for the same value.
// A hand-written copy here had already drifted on all three duration rows.
//
// One constant per node, never shared: the transition and character-fx scales
// carry the same ids but deliberately different wording (a transition occurs
// and spans the clip; an effect manifests and persists), and each panel must
// render — and tooltip — its own node's rows.
type TimingKey = Parameters<typeof tx>[0]
/** Option LABELS are shared by both families (same ids); descriptions differ. */
const TIMING_LABEL_KEYS: Record<string, TimingKey> = {
  auto: "paramcfg.timingAuto", start: "paramcfg.timingStart", middle: "paramcfg.timingMiddle", end: "paramcfg.timingEnd", full: "paramcfg.timingFull",
  instant: "paramcfg.timingInstant", short: "paramcfg.timingShort", medium: "paramcfg.timingMedium", long: "paramcfg.timingLong",
  subtle: "paramcfg.timingSubtle", natural: "paramcfg.timingNatural", dynamic: "paramcfg.timingDynamic", crazy: "paramcfg.timingCrazy",
}
const INTENSITY_DESC_KEYS: Record<string, TimingKey> = {
  subtle: "paramcfg.intSubtleDesc", natural: "paramcfg.intNaturalDesc", dynamic: "paramcfg.intDynamicDesc", crazy: "paramcfg.intCrazyDesc",
}
const TRANSITION_DESC_KEYS: Record<string, Record<string, TimingKey>> = {
  position: { auto: "paramcfg.trPosAutoDesc", start: "paramcfg.trPosStartDesc", middle: "paramcfg.trPosMiddleDesc", end: "paramcfg.trPosEndDesc", full: "paramcfg.trPosFullDesc" },
  duration: { auto: "paramcfg.trDurAutoDesc", instant: "paramcfg.trDurInstantDesc", short: "paramcfg.trDurShortDesc", medium: "paramcfg.trDurMediumDesc", long: "paramcfg.trDurLongDesc" },
  intensity: { auto: "paramcfg.trIntAutoDesc", ...INTENSITY_DESC_KEYS },
}
const CHARACTER_FX_DESC_KEYS: Record<string, Record<string, TimingKey>> = {
  position: { auto: "paramcfg.fxPosAutoDesc", start: "paramcfg.fxPosStartDesc", middle: "paramcfg.fxPosMiddleDesc", end: "paramcfg.fxPosEndDesc", full: "paramcfg.fxPosFullDesc" },
  duration: { auto: "paramcfg.fxDurAutoDesc", instant: "paramcfg.fxDurInstantDesc", short: "paramcfg.fxDurShortDesc", medium: "paramcfg.fxDurMediumDesc", long: "paramcfg.fxDurLongDesc" },
  intensity: { auto: "paramcfg.fxIntAutoDesc", ...INTENSITY_DESC_KEYS },
}
/** The option row's copy for the locale; an id the maps do not know falls back to the table's English. */
function timingOptionCopy(descKeys: Record<string, TimingKey>, opt: { id: string; label: string; description: string }) {
  const labelKey = TIMING_LABEL_KEYS[opt.id]
  const descKey = descKeys[opt.id]
  return { label: labelKey ? tx(labelKey) : opt.label, description: descKey ? tx(descKey) : opt.description }
}

function TRANSITION_TIMING_SELECTS() {
  return [
  { key: "position",  label: tx("paramcfg.position"),  options: TRANSITION_POSITIONS, descKeys: TRANSITION_DESC_KEYS.position },
  { key: "duration",  label: tx("field.duration"),  options: TRANSITION_DURATIONS, descKeys: TRANSITION_DESC_KEYS.duration },
  { key: "intensity", label: tx("paramcfg.intensity"), options: TRANSITION_INTENSITIES, descKeys: TRANSITION_DESC_KEYS.intensity },
] as const
}

function CHARACTER_FX_TIMING_SELECTS() {
  return [
  { key: "position",  label: tx("paramcfg.position"),  options: CHARACTER_FX_POSITIONS, descKeys: CHARACTER_FX_DESC_KEYS.position },
  { key: "duration",  label: tx("field.duration"),  options: CHARACTER_FX_DURATIONS, descKeys: CHARACTER_FX_DESC_KEYS.duration },
  { key: "intensity", label: tx("paramcfg.intensity"), options: CHARACTER_FX_INTENSITIES, descKeys: CHARACTER_FX_DESC_KEYS.intensity },
] as const
}

export function TransitionConfig({ data, onUpdate }: ConfigProps<TransitionData>) {
  const t = useT()
  const dir = usePickerDir()
  const composed = composeTransitionHintForNode(data)

  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, composed, data.postText]} />
      <CustomTextRows
        idPrefix="transition"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGHardCutFromAction")}
        postPlaceholder={t("paramcfg.eGIntoEstablishingShot")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.transition")}</Label>
      <TransitionPicker
        value={data.transition}
        onValueChange={(v) => onUpdate({ transition: v as string | string[] | undefined })}
        maxSelected={2}
      />

      <div className="grid grid-cols-3 gap-2">
        {TRANSITION_TIMING_SELECTS().map(({ key, label: labelText, options, descKeys }) => (
          <div key={key} className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase">{labelText}</Label>
            <Select
              value={(data[key] as string) ?? "auto"}
              onValueChange={(v) => onUpdate({ [key]: v })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {options.map((opt) => {
                  const copy = timingOptionCopy(descKeys, opt)
                  return (
                  <SelectItem key={opt.id} value={opt.id} title={copy.description}>
                    {copy.label}
                  </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CharacterFxConfig({ data, onUpdate }: ConfigProps<CharacterFxData>) {
  const t = useT()
  const dir = usePickerDir()
  const composed = composeCharacterFxHintForNode(data)

  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={[data.preText, composed, data.postText]} />
      <CustomTextRows
        idPrefix="character-fx"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder={t("paramcfg.eGMidTransformation")}
        postPlaceholder={t("paramcfg.eGWithSmokeTrailingBehind")}
        onChange={onUpdate}
      />
      <Label>{t("paramcfg.characterFxPickUpTo2")}</Label>
      <CharacterFxPicker
        value={data.characterFx}
        onValueChange={(v) => onUpdate({ characterFx: v as string | string[] | undefined })}
        maxSelected={2}
      />

      <div className="grid grid-cols-3 gap-2">
        {CHARACTER_FX_TIMING_SELECTS().map(({ key, label: labelText, options, descKeys }) => (
          <div key={key} className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase">{labelText}</Label>
            <Select
              value={(data[key] as string) ?? "auto"}
              onValueChange={(v) => onUpdate({ [key]: v })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {options.map((opt) => {
                  const copy = timingOptionCopy(descKeys, opt)
                  return (
                  <SelectItem key={opt.id} value={opt.id} title={copy.description}>
                    {copy.label}
                  </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
  )
}
