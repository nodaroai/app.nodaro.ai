// Admin → Nodaro Motion, one engine's Motion column: how a run people start
// themselves with the Flex style (internally "motion") prepares its clip and
// words its prompt (the `nodaro_motion_motion` setting's entry for the engine).
//
// Flex is Full depth with a shot list on every engine that runs it (the Cast
// Swap engine from 0.425.0, which declares `castSwap.shotList`; every
// environment the setting is shared by runs one). The engine reads any other
// masking as its default (Full depth, the scene from a description), so the
// column offers Full depth alone, its scene a description or a description +
// the original, whatever the environments report, and while they load or
// cannot be read.
//
// A masking saved before that rule — "Same as Precise" (an entry with no
// masking), Faces hidden, or Off — is never rewritten on its own: the column
// says it is saved and ignored, with a button that clears it to Full depth,
// and Save sends it back as it is until then. A prompt style chosen on an
// engine with nothing saved is saved with Full depth beside it, so a new save
// never stores a masking the engine ignores.
//
// Keep people is a trend's alone. Prompt style: left out = Flexible; Precise
// with Full depth stays allowed.
//
// What this environment's Cast Swap engine cannot do yet of the column's
// setting (`supports`, from the setting's GET; `motionEngineGaps`) is said
// under it: the engine plugin is out of date.
//
// Full depth's depth blur (0–40, 0 = off) and what its face mesh draws (Full,
// Eyes and mouth, Mouth only) are set here, each naming the environments whose
// engine cannot do it yet (the setting is shared), as is the smallest face
// with mesh lines, as in a trend's editor. The Precise column's own Faces
// hidden choices — the fill None and a blur on the depth fill — are never
// offered here: a direct Flex run is never Faces hidden.

import { Button } from "@/components/ui/button"
import type { VideoDepthColormap, VideoDepthModelSize } from "@nodaro/shared/media"
import type { AdminTrendFaceMasking, AdminTrendFullDepthScene, NodaroMotionEngineSupports, NodaroMotionMotionEntry, TrendEngineEnvironment } from "@/lib/api"
import { FaceMaskingEditor } from "../../trends/components/FaceMaskingEditor"
import { PromptStyleSelect } from "../../trends/components/PromptStyleSelect"
import { clipPreparationOf, type FaceMeshMinFaceHeightMissing } from "../../trends/clip-preparation"
import { motionEngineGaps } from "../model"
import { FULL_DEPTH_SCENES, sceneOf } from "../../trends/prompt-style"

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
export const FLEX_DEFAULT_MASKING: AdminTrendFaceMasking = { mode: "always", source: "full-depth" }

/** Whether a masking is one a Flex run uses: Full depth, switched on. */
export function isFlexMasking(m: AdminTrendFaceMasking | undefined): m is AdminTrendFaceMasking {
  return !!m && m.mode !== "off" && clipPreparationOf(m) === "full-depth"
}

/**
 * What a saved entry holds that the engine ignores, by the name the column used to give it: "Same as Precise" (an
 * entry with no masking), "Off" (switched off, Full depth too) or "Faces hidden"; null for an entry Flex runs as
 * saved, or nothing saved.
 */
export function ignoredMaskingOf(entry: NodaroMotionMotionEntry | undefined): "Same as Precise" | "Off" | "Faces hidden" | null {
  if (!entry || Object.keys(entry).length === 0) return null
  const m = entry.masking
  if (!m) return "Same as Precise"
  if (m.mode === "off") return "Off"
  return clipPreparationOf(m) === "full-depth" ? null : "Faces hidden"
}

/** The entry with its masking cleared to Flex's default, Full depth (a new object; the prompt style kept). */
export function withFlexDefaultMasking(entry: NodaroMotionMotionEntry | undefined): NodaroMotionMotionEntry {
  return { ...entry, masking: FLEX_DEFAULT_MASKING }
}

interface Props {
  readonly value: NodaroMotionMotionEntry | undefined
  readonly onChange: (next: NodaroMotionMotionEntry) => void
  /** This environment's engine (unknown when left out: nothing is said). */
  readonly supports?: NodaroMotionEngineSupports
  /** The environments whose engine cannot draw the face mesh (`environmentsThatCannotDrawFaceMesh`); unknown when left out. */
  readonly faceMeshMissingIn?: readonly string[]
  /** Each environment's engine, as reported (the scenes and controls offered; unknown when left out). */
  readonly envs?: readonly TrendEngineEnvironment[]
  /** For each depth colormap, the environments whose engine cannot draw it (`environmentsThatCannotDrawColormaps`); unknown when left out. */
  readonly depthColormapsMissingIn?: Readonly<Record<VideoDepthColormap, readonly string[]>>
  /** For each depth model size, the environments whose engine cannot draw with it (`environmentsThatCannotDrawModelSizes`); unknown when left out. */
  readonly depthModelSizesMissingIn?: Readonly<Record<VideoDepthModelSize, readonly string[]>>
  /** The environments whose engine cannot blur a Full depth's map (`environmentsThatCannotBlurDepth`); unknown when left out (no control). */
  readonly depthBlurMissingIn?: readonly string[]
  /** For each face mesh part but the full mesh, the environments whose engine cannot draw it (`environmentsThatCannotDrawFaceMeshParts`); unknown when left out (no control). */
  readonly faceMeshPartsMissingIn?: Readonly<Record<"features" | "mouth", readonly string[]>>
  /** The environments that cannot take a set of face mesh layers no parts value names, by engine and by platform (`environmentsThatCannotDrawFaceMeshLayers`); unknown when left out (no "Choose the layers"). */
  readonly faceMeshLayersMissing?: { readonly engine: readonly string[]; readonly platform: readonly string[] }
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
  faceMeshMissingIn,
  envs,
  depthColormapsMissingIn,
  depthModelSizesMissingIn,
  depthBlurMissingIn,
  faceMeshPartsMissingIn,
  faceMeshLayersMissing,
  faceMeshMinFaceHeightMissing,
}: Props) {
  const m = value?.masking
  const full = isFlexMasking(m)
  const ignored = ignoredMaskingOf(value)
  const runsAs = full ? shotListSceneOf(sceneOf(m)) : null
  const empty = !value || Object.keys(value).length === 0
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Motion masking</span>
        <span className="text-xs text-muted-foreground">
          Full depth with a shot list: the whole clip becomes one depth video on every run (charged as clip preparation), and the scene is
          described shot by shot.
        </span>
      </div>
      {ignored && (
        <div role="status" className="flex flex-col items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
          <span>
            Saved: {ignored} — ignored: every Flex run is Full depth with a shot list, so this engine's Flex runs use the default below until it
            is cleared.
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => onChange(withFlexDefaultMasking(value))}>
            Clear it (Full depth)
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
        faceMeshLayersMissing={faceMeshLayersMissing}
        faceMeshMinFaceHeightMissing={faceMeshMinFaceHeightMissing}
        envs={envs}
        scenes={SHOT_LIST_SCENES}
        // A change sets the engine's own Full depth (left unset, the default is the same setting).
        onChange={(next) => onChange({ ...value, masking: next ?? FLEX_DEFAULT_MASKING })}
      />
      {empty && <p className="text-xs text-muted-foreground">Full depth, the scene from a description, Flexible prompt.</p>}
      <PromptStyleSelect
        label="Motion prompt style"
        value={value?.promptStyle}
        faceMasking={full ? m : FLEX_DEFAULT_MASKING}
        defaultStyle="flexible"
        onChange={(promptStyle) => {
          const rest: NodaroMotionMotionEntry = { ...(value ?? {}) }
          delete rest.promptStyle
          if (!promptStyle) return onChange(rest)
          // Nothing saved yet: the prompt style is saved with Full depth beside it (an entry with no masking is one the engine ignores).
          onChange(empty ? { masking: FLEX_DEFAULT_MASKING, promptStyle } : { ...rest, promptStyle })
        }}
      />
      <MotionGaps value={value} supports={supports} />
    </div>
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
