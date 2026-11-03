// Admin → Nodaro Motion, one engine's Motion column: how a run people start
// themselves with the Flex style (internally "motion") prepares its clip and
// words its prompt (the `nodaro_motion_motion` setting's entry for the engine).
//
// Two rules, by what every environment's Cast Swap engine declares (the
// setting is shared by every environment):
//
// - The shot list (`castSwap.shotList` in every environment): Flex is Full
//   depth with a shot list. The engine reads any other masking as its default
//   (Full depth, the scene from a description), so the column offers Full
//   depth alone, its scene a description or a description + the original.
//   "Same as Precise" and "Faces hidden" do nothing for these runs: a stored
//   one is shown with that reason and a button to set Full depth instead.
// - Before it (any environment's engine without it, or unknown): the masking
//   is "Same as Precise" (left out: the engine's Precise masking, on one
//   video), Faces hidden (its own face mask, the trend editor's controls), or
//   Full depth (the whole clip as depth, with where the scene comes from).
//
// Keep people is a trend's alone. Prompt style: left out = Flexible; Precise
// with Full depth stays allowed.
//
// What this environment's Cast Swap engine cannot do yet of the column's
// setting (`supports`, from the setting's GET; `motionEngineGaps`) is said
// under it: the engine plugin is out of date.
//
// Two controls are this column's alone (the trend editor and the Precise
// column have neither): Full depth's depth blur (0–40, 0 = off) and what the
// face mesh draws (Full, Eyes and mouth, Mouth only), each naming the
// environments whose engine cannot do it yet (the setting is shared). Full
// depth's face mesh also takes the smallest face with mesh lines here, as in
// a trend's editor (the Precise column is never Full depth). The
// Precise column's own Faces hidden choices — the fill None and a blur on the
// depth fill — are never offered here: a direct Motion run does not draw them
// (the server refuses them on this setting).

import { useId } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { VideoDepthColormap, VideoDepthModelSize } from "@nodaro/shared/media"
import type { AdminTrendFaceMasking, AdminTrendFullDepthScene, NodaroMotionEngineSupports, NodaroMotionMotionEntry, TrendEngineEnvironment } from "@/lib/api"
import { FaceMaskingEditor } from "../../trends/components/FaceMaskingEditor"
import { PromptStyleSelect } from "../../trends/components/PromptStyleSelect"
import { clipPreparationOf, environmentsThatCannotTakeShotList, withClipPreparation, type FaceMeshMinFaceHeightMissing } from "../../trends/clip-preparation"
import { motionEngineGaps } from "../model"
import { FULL_DEPTH_SCENES, sceneOf } from "../../trends/prompt-style"

type MaskingChoice = "same" | "faces" | "full-depth"

const MASKING_CHOICES: ReadonlyArray<{ value: MaskingChoice; label: string; hint: string }> = [
  { value: "same", label: "Same as Precise", hint: "The Precise column's masking, on one video: no clip preparation of its own." },
  { value: "faces", label: "Faces hidden", hint: "Its own face masking (the settings below)." },
  { value: "full-depth", label: "Full depth", hint: "The whole clip becomes one depth video on every run (charged as clip preparation); the scene comes from below." },
]

/** The scenes a Flex run with a shot list takes: the shot list alone, or beside the original. */
export const SHOT_LIST_SCENES: readonly AdminTrendFullDepthScene[] = ["description", "description-and-original"]

/**
 * The scene a Flex run with a shot list uses for a stored one that makes no shot list (the engine's reading):
 * "original" → "description-and-original", "none" → "description"; null when it already makes one.
 */
export function shotListSceneOf(scene: AdminTrendFullDepthScene): AdminTrendFullDepthScene | null {
  if (scene === "original") return "description-and-original"
  if (scene === "none") return "description"
  return null
}

const sceneLabel = (scene: AdminTrendFullDepthScene) => FULL_DEPTH_SCENES.find((s) => s.value === scene)?.label ?? scene

/** Full depth, its scene from a description: what the engine runs Flex with when nothing usable is set. */
const FLEX_DEFAULT_MASKING: AdminTrendFaceMasking = { mode: "always", source: "full-depth" }

/** What the column's masking select shows for the entry's masking. */
export function maskingChoiceOf(m: AdminTrendFaceMasking | undefined): MaskingChoice {
  if (!m) return "same"
  return clipPreparationOf(m) === "full-depth" ? "full-depth" : "faces"
}

/** The entry with its masking chosen another way (a new object; empty keys left out). */
export function withMaskingChoice(entry: NodaroMotionMotionEntry | undefined, choice: MaskingChoice): NodaroMotionMotionEntry {
  const { masking, ...rest } = entry ?? {}
  if (choice === "same") return rest
  if (choice === "faces") return { ...rest, masking: withClipPreparation(masking, "faces").masking ?? { mode: "off" } }
  return { ...rest, masking: withClipPreparation(masking, "full-depth").masking }
}

/**
 * Whether the column follows the shot list's rule (Flex = Full depth + shot list): every environment's
 * engine declares `castSwap.shotList`. Unknown environments (undefined): the rule before it.
 */
export function flexIsFullDepth(envs: readonly TrendEngineEnvironment[] | undefined): boolean {
  const missing = environmentsThatCannotTakeShotList(envs)
  return missing !== undefined && missing.length === 0
}

interface Props {
  readonly value: NodaroMotionMotionEntry | undefined
  readonly onChange: (next: NodaroMotionMotionEntry) => void
  /** This environment's engine (unknown when left out: nothing is said). */
  readonly supports?: NodaroMotionEngineSupports
  /** The environments whose engine cannot hide whole people (`environmentsThatCannotHideBodies`); unknown when left out. */
  readonly bodyMissingIn?: readonly string[]
  /** The environments whose engine cannot draw the face mesh (`environmentsThatCannotDrawFaceMesh`); unknown when left out. */
  readonly faceMeshMissingIn?: readonly string[]
  /** Each environment's engine, as reported (decides the shot list's rule; unknown when left out: the rule before it). */
  readonly envs?: readonly TrendEngineEnvironment[]
  /** For each depth colormap, the environments whose engine cannot draw it (`environmentsThatCannotDrawColormaps`); unknown when left out. */
  readonly depthColormapsMissingIn?: Readonly<Record<VideoDepthColormap, readonly string[]>>
  /** For each depth model size, the environments whose engine cannot draw with it (`environmentsThatCannotDrawModelSizes`); unknown when left out. */
  readonly depthModelSizesMissingIn?: Readonly<Record<VideoDepthModelSize, readonly string[]>>
  /** The environments whose engine cannot blur a Full depth's map (`environmentsThatCannotBlurDepth`); unknown when left out (no control). */
  readonly depthBlurMissingIn?: readonly string[]
  /** For each face mesh part but the full mesh, the environments whose engine cannot draw it (`environmentsThatCannotDrawFaceMeshParts`); unknown when left out (no control). */
  readonly faceMeshPartsMissingIn?: Readonly<Record<"features" | "mouth", readonly string[]>>
  /**
   * The environments that cannot take Full depth's smallest face with mesh lines yet, by their engine and by their
   * platform (`faceMeshMinFaceHeightMissing`: the setting is shared, and an older platform drops an entry that carries
   * it); unknown when left out (no control).
   */
  readonly faceMeshMinFaceHeightMissing?: FaceMeshMinFaceHeightMissing
}

export function MotionColumn({
  value,
  onChange,
  supports,
  bodyMissingIn,
  faceMeshMissingIn,
  envs,
  depthColormapsMissingIn,
  depthModelSizesMissingIn,
  depthBlurMissingIn,
  faceMeshPartsMissingIn,
  faceMeshMinFaceHeightMissing,
}: Props) {
  const shotList = flexIsFullDepth(envs)
  return (
    <div className="flex flex-col gap-3">
      {shotList ? (
        <FullDepthMasking
          value={value}
          onChange={onChange}
          faceMeshMissingIn={faceMeshMissingIn}
          envs={envs}
          depthColormapsMissingIn={depthColormapsMissingIn}
          depthModelSizesMissingIn={depthModelSizesMissingIn}
          depthBlurMissingIn={depthBlurMissingIn}
          faceMeshPartsMissingIn={faceMeshPartsMissingIn}
          faceMeshMinFaceHeightMissing={faceMeshMinFaceHeightMissing}
        />
      ) : (
        <ChoiceMasking
          value={value}
          onChange={onChange}
          bodyMissingIn={bodyMissingIn}
          faceMeshMissingIn={faceMeshMissingIn}
          depthColormapsMissingIn={depthColormapsMissingIn}
          depthModelSizesMissingIn={depthModelSizesMissingIn}
          depthBlurMissingIn={depthBlurMissingIn}
          faceMeshPartsMissingIn={faceMeshPartsMissingIn}
          faceMeshMinFaceHeightMissing={faceMeshMinFaceHeightMissing}
        />
      )}
      <PromptStyleSelect
        label="Motion prompt style"
        value={value?.promptStyle}
        faceMasking={value?.masking ?? (shotList ? FLEX_DEFAULT_MASKING : undefined)}
        defaultStyle="flexible"
        onChange={(promptStyle) => {
          const rest: NodaroMotionMotionEntry = { ...(value ?? {}) }
          delete rest.promptStyle
          onChange(promptStyle ? { ...rest, promptStyle } : rest)
        }}
      />
      <MotionGaps value={value} supports={supports} />
    </div>
  )
}

type MaskingProps = Pick<
  Props,
  | "value"
  | "onChange"
  | "bodyMissingIn"
  | "faceMeshMissingIn"
  | "envs"
  | "depthColormapsMissingIn"
  | "depthModelSizesMissingIn"
  | "depthBlurMissingIn"
  | "faceMeshPartsMissingIn"
  | "faceMeshMinFaceHeightMissing"
>

/** The shot list's rule: Full depth alone, its scene a description or a description + the original. */
function FullDepthMasking({
  value,
  onChange,
  faceMeshMissingIn,
  envs,
  depthColormapsMissingIn,
  depthModelSizesMissingIn,
  depthBlurMissingIn,
  faceMeshPartsMissingIn,
  faceMeshMinFaceHeightMissing,
}: MaskingProps) {
  const m = value?.masking
  const full = !!m && m.mode !== "off" && clipPreparationOf(m) === "full-depth"
  const runsAs = full ? shotListSceneOf(sceneOf(m)) : null
  return (
    <>
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Motion masking</span>
        <span className="text-xs text-muted-foreground">
          Full depth with a shot list: the whole clip becomes one depth video on every run (charged as clip preparation), and the scene is
          described shot by shot.
        </span>
      </div>
      {m && !full && (
        <div role="status" className="flex flex-col items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
          <span>
            The saved Motion masking ({m.mode === "off" ? "Off" : "Faces hidden"}) no longer does anything: Flex runs are Full depth with a shot
            list, so they use the default (the scene from a description) until Full depth is set here.
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => onChange(withMaskingChoice(value, "full-depth"))}>
            Set Full depth
          </Button>
        </div>
      )}
      {runsAs && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          The saved scene ({sceneLabel(sceneOf(m))}) always gets a shot list now: Flex runs it as {sceneLabel(runsAs)}. Choose that scene to save
          it as it runs.
        </p>
      )}
      <FaceMaskingEditor
        value={full ? m : FLEX_DEFAULT_MASKING}
        source="full-depth"
        faceMeshMissingIn={faceMeshMissingIn}
        depthColormapsMissingIn={depthColormapsMissingIn}
        depthModelSizesMissingIn={depthModelSizesMissingIn}
        depthBlurMissingIn={depthBlurMissingIn}
        faceMeshPartsMissingIn={faceMeshPartsMissingIn}
        faceMeshMinFaceHeightMissing={faceMeshMinFaceHeightMissing}
        envs={envs}
        scenes={SHOT_LIST_SCENES}
        // A change sets the engine's own Full depth (left unset, the default is the same setting).
        onChange={(next) => onChange({ ...value, masking: next ?? FLEX_DEFAULT_MASKING })}
      />
      {!m && !value?.promptStyle && <p className="text-xs text-muted-foreground">Full depth, the scene from a description, Flexible prompt.</p>}
    </>
  )
}

/** The rule before the shot list: Same as Precise, Faces hidden or Full depth. */
function ChoiceMasking({
  value,
  onChange,
  bodyMissingIn,
  faceMeshMissingIn,
  depthColormapsMissingIn,
  depthModelSizesMissingIn,
  depthBlurMissingIn,
  faceMeshPartsMissingIn,
  faceMeshMinFaceHeightMissing,
}: MaskingProps) {
  const id = useId()
  const choice = maskingChoiceOf(value?.masking)
  const hint = MASKING_CHOICES.find((c) => c.value === choice)?.hint
  const empty = !value?.masking && !value?.promptStyle
  return (
    <>
      <div className="flex flex-col gap-1 text-sm sm:w-1/2 sm:pr-1.5">
        <label htmlFor={id} className="font-medium">
          Motion masking
        </label>
        <Select value={choice} onValueChange={(v) => onChange(withMaskingChoice(value, v as MaskingChoice))}>
          <SelectTrigger id={id} className="h-9" aria-describedby={`${id}-hint`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MASKING_CHOICES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </span>
      </div>
      {value?.masking && (
        <FaceMaskingEditor
          value={value.masking}
          source={choice === "full-depth" ? "full-depth" : "faces"}
          bodyMissingIn={bodyMissingIn}
          faceMeshMissingIn={faceMeshMissingIn}
          depthColormapsMissingIn={depthColormapsMissingIn}
          depthModelSizesMissingIn={depthModelSizesMissingIn}
          depthBlurMissingIn={depthBlurMissingIn}
          faceMeshPartsMissingIn={faceMeshPartsMissingIn}
          faceMeshMinFaceHeightMissing={faceMeshMinFaceHeightMissing}
          // No `envs`: a scene only some engines declare is never offered on this shared setting
          // (the server refuses it until every environment's engine lists it).
          // Off is kept as Off ({ mode: "off" }), never read as "Same as Precise".
          onChange={(m) => onChange({ ...value, masking: m ?? { mode: "off" } })}
        />
      )}
      {empty && <p className="text-xs text-muted-foreground">Same as Precise, Flexible prompt.</p>}
    </>
  )
}

function MotionGaps({ value, supports }: Pick<Props, "value" | "supports">) {
  const gaps = motionEngineGaps(value, supports)
  if (gaps.length === 0) return null
  return (
    <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
      This environment's Cast Swap engine plugin is out of date: it cannot run {gaps.join(", ")} yet. Until it is updated, runs here do not follow
      that part of the setting.
    </p>
  )
}
