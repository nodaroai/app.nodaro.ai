// Face masking for every run of the trend (hidden from users): Off, Always
// (the faces in the clip are covered before the video model sees it), or Auto
// (only when the video model refuses the clip, one retry with them covered;
// a full run whose preview needed it is masked from the start). The settings
// are the platform's Cast Swap ones; a field left empty takes the engine's
// default, shown as its placeholder and never written into the draft.
// Margins: left out, the engine leaves 10 % at the left and right (shown as
// placeholders); the first margin typed writes the whole default zone with it,
// so what is saved is what the fields show; "No margins" saves `zone: null`.
// Covers: the whole head (the default: also hides the hair and people seen from
// behind) or the face alone (the hair stays visible); shown as Head when left out.
//
// A trend's clip preparation (`source`, chosen above it: ClipPreparationSelect)
// decides which fields apply. Faces hidden: all of them. Full depth: none (it
// always runs, and nothing else is read). Keep people: always runs, no fill;
// what is kept is the whole person by default (Body, offered only there), the
// head or the face. Admin → Nodaro Motion's Precise setting masks faces only
// and passes none; its Motion setting may pass Full depth.
//
// Full depth shows where the run's scene comes from (FullDepthSceneSelect):
// a description (the default), the original clip, or none.
//
// The face mesh (Faces hidden and Full depth, never Keep people): thin face
// lines drawn on the masked heads, so the video model keeps the mouth and the
// blinks. Offered once the engine draws it: a trend's, some environment's
// engine; Admin → Nodaro Motion's (a setting every environment shares), shown
// but greyed out, naming the environments that lack it. Off is no key.
//
// Full depth's face mesh, while it is on (decided 2026-11-03): the smallest
// face with mesh lines, a % of the frame's height (0–100, steps of 1). Empty
// is the engine's default (10, shown as the placeholder; no key); 0 and 10
// are values (0: no size minimum, the side margins still apply). Offered
// where the page passes the environments that lack it
// (`faceMeshMinFaceHeightMissing`: the Motion column and a trend's editor;
// the Precise column is never Full depth): greyed out while any environment's
// engine cannot draw it OR its platform (the app itself) does not take it yet
// — every environment shares one database, so an older platform would refuse
// the value — each named apart; one already set stays, to be emptied.
//
// Role outlines (a trend's, Faces hidden only: `offerRoleOutlines`): the stored
// face mask rings each person role's masked region in that role's colour, the
// region told by the role's boxes on the mask, so a run can say who is who in
// every shot. Offered once some environment's engine draws them; a depth fill
// is then drawn gray. Off is no key.
//
// Depth colormap (wherever the setting draws depth: Full depth, Keep people, a
// Faces hidden depth fill): the depth map's colormap, of the depth provider's
// (grayscale, turbo, inferno, magma, viridis). The default (grayscale; turbo
// for a depth fill) is no key, exactly as before the choice existed. A map is
// offered once the engine draws it (a trend's: some environment's engine;
// Admin → Nodaro Motion's: every environment's, naming those that lack it);
// with none offered the select is greyed out and says why. While role
// outlines are on, a depth fill is fixed at grayscale, and says so.
//
// Depth model (wherever the setting draws depth, role outlines or not): the
// size of the model that draws the depth (small, base, large). Large, the
// default, is no key, exactly as before the choice existed. A size is offered
// as a colormap is (a trend's: some environment's engine; Admin → Nodaro
// Motion's: every environment's, naming those that lack it); with none
// offered the select is greyed out and says why. A size already chosen
// stays, to be set back to the default.
//
// Admin → Nodaro Motion's Precise column only (never a trend's, nor the Motion
// column's Faces hidden): a third fill,
// None — the faces are found as for the other fills but kept as filmed, and
// only the face mesh is drawn on them. Choosing it turns the face mesh on,
// which then stays on (and says why) while None is chosen; no depth is drawn,
// so no colormap, depth model or depth blur. Offered once every environment's
// engine draws it, greyed out naming those that cannot. The depth blur is
// offered on its depth fill too (its own engine declaration, apart from Full
// depth's).

import { useId } from "react"
import { ROLE_OUTLINE_PALETTE } from "@nodaro/render-rules"
import { resolveVideoDepthModelSize, type VideoDepthColormap, type VideoDepthModelSize } from "@nodaro/shared/media"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  TrendEngineEnvironment,
  AdminFaceMeshParts,
  AdminTrendFaceMasking,
  AdminTrendFaceMaskingFill,
  AdminTrendFaceMaskingMode,
  AdminTrendFaceMaskingSource,
  AdminTrendFaceMaskingTarget,
  AdminTrendFaceMaskingZone,
  AdminTrendFullDepthScene,
} from "@/lib/api"
import { DEPTH_BLUR_BOUNDS, FACE_MASKING_BOUNDS, FACE_MASKING_DEFAULTS, ZONE_SIDES, maskingUsesBlur } from "../model"
import {
  DEPTH_COLORMAPS,
  DEPTH_MODEL_SIZES,
  DEPTH_MODEL_SIZE_DEFAULT,
  defaultTargetFor,
  depthBlurKindOf,
  depthColormapApplies,
  depthColormapDefaultFor,
  depthColormapsSomeEngineDraws,
  depthModelSizesSomeEngineDraws,
  FACE_MESH_MIN_FACE_HEIGHT_DEFAULT_PCT,
  isDepthPreparation,
  someEngineDrawsFaceMesh,
  someEngineDrawsRoleOutlines,
  type FaceMeshMinFaceHeightMissing,
} from "../clip-preparation"
import { FullDepthSceneSelect } from "./FullDepthSceneSelect"

const MODES: ReadonlyArray<{ value: AdminTrendFaceMaskingMode; label: string; hint: string }> = [
  { value: "off", label: "Off", hint: "Runs as before: the clip goes to the video model as it is." },
  { value: "always", label: "Always", hint: "Every run covers the faces in the clip first (it costs more)." },
  {
    value: "auto",
    label: "Auto",
    hint: "Only when the video model refuses the clip: one retry with the faces covered, charged only then. A full run whose preview needed it is covered from the start.",
  },
]

const TARGETS: ReadonlyArray<{ value: AdminTrendFaceMaskingTarget; label: string; hint: string }> = [
  { value: "head", label: "Head (default)", hint: "Covers the whole head: also hides the hair and people seen from behind (a bigger mask)." },
  { value: "face", label: "Face", hint: "Covers the face only: the hair stays visible, and people turned away are not covered." },
  { value: "body", label: "Body", hint: "Covers the whole person: everyone in the clip is hidden, body and head (the biggest mask)." },
]

/** Keep people: what stays as filmed (the rest becomes depth). */
const KEEP_TARGETS: ReadonlyArray<{ value: AdminTrendFaceMaskingTarget; label: string; hint: string }> = [
  { value: "body", label: "Whole person (default)", hint: "Keeps each whole person as filmed; everything around them becomes depth." },
  { value: "head", label: "Head", hint: "Keeps only the heads as filmed (hair included); the bodies become depth with the rest." },
  { value: "face", label: "Face", hint: "Keeps only the faces as filmed; everything else becomes depth." },
]

const FILLS: ReadonlyArray<{ value: AdminTrendFaceMaskingFill; label: string }> = [
  { value: "blur", label: "Blur (default)" },
  { value: "depth", label: "Depth colors" },
  // Admin → Nodaro Motion only (`fillNoneMissingIn`): never offered in a trend's editor.
  { value: "none", label: "None (faces as filmed, face mesh only)" },
]

/** What the face mesh draws (`faceMeshParts`; the full mesh is the default, saved as no key). */
const FACE_MESH_PARTS: ReadonlyArray<{ value: AdminFaceMeshParts; label: string; name: string }> = [
  { value: "full", label: "Full (default)", name: "the full face mesh" },
  { value: "features", label: "Eyes and mouth", name: "only the eyes and mouth" },
  { value: "mouth", label: "Mouth only", name: "only the mouth" },
]

const COLORMAP_LABELS: Readonly<Record<VideoDepthColormap, string>> = {
  grayscale: "Grayscale",
  turbo: "Turbo",
  inferno: "Inferno",
  magma: "Magma",
  viridis: "Viridis",
}

const MODEL_SIZE_LABELS: Readonly<Record<VideoDepthModelSize, string>> = {
  small: "Small",
  base: "Base",
  large: "Large",
}

const ZONE_LABELS: Readonly<Record<keyof AdminTrendFaceMaskingZone, string>> = {
  leftPct: "Left",
  rightPct: "Right",
  topPct: "Top",
  bottomPct: "Bottom",
}

interface Props {
  /** As stored; undefined = the draft has none (off). */
  readonly value: AdminTrendFaceMasking | undefined
  readonly onChange: (next: AdminTrendFaceMasking | undefined) => void
  /**
   * The line under Auto, where it differs from a trend's (Admin → Nodaro
   * Motion: a direct run has no preview that carries over).
   */
  readonly autoHint?: string
  /** The trend's clip preparation (left out: Faces hidden, the only one Admin → Nodaro Motion has). */
  readonly source?: AdminTrendFaceMaskingSource
  /**
   * The targets some environment's engine masks under this source
   * (`supportedTargetsFor`: Faces hidden reads `castSwap.faceMaskHideTargets`,
   * Keep people `castSwap.faceMaskTargets`); unknown when left out. The whole
   * person (Body) is offered greyed out while no engine declares it.
   */
  readonly supportedTargets?: readonly AdminTrendFaceMaskingTarget[]
  /**
   * Admin → Nodaro Motion (a setting every environment shares): the
   * environments whose engine cannot hide whole people
   * (`environmentsThatCannotHideBodies`). When given it decides Body instead
   * of `supportedTargets`: greyed out, naming them, while any is listed.
   */
  readonly bodyMissingIn?: readonly string[]
  /**
   * Admin → Nodaro Motion (a setting every environment shares): the
   * environments whose engine cannot draw the face mesh
   * (`environmentsThatCannotDrawFaceMesh`). When given, the switch is shown,
   * greyed out and naming them while any is listed; left out, it is offered
   * once some environment's engine in `envs` draws it.
   */
  readonly faceMeshMissingIn?: readonly string[]
  /**
   * Admin → Nodaro Motion (a setting every environment shares): for each
   * depth colormap, the environments whose engine cannot draw it
   * (`environmentsThatCannotDrawColormaps`). When given, a map is offered only
   * while its list is empty; left out, once some environment's engine in
   * `envs` draws it.
   */
  readonly depthColormapsMissingIn?: Readonly<Record<VideoDepthColormap, readonly string[]>>
  /**
   * Admin → Nodaro Motion (a setting every environment shares): for each
   * depth model size, the environments whose engine cannot draw with it
   * (`environmentsThatCannotDrawModelSizes`). When given, a size is offered
   * only while its list is empty; left out, once some environment's engine in
   * `envs` draws with it.
   */
  readonly depthModelSizesMissingIn?: Readonly<Record<VideoDepthModelSize, readonly string[]>>
  /**
   * Admin → Nodaro Motion's Motion column (a setting every environment
   * shares): offer Full depth's depth blur, naming the environments whose
   * engine cannot blur the map (`environmentsThatCannotBlurDepth`). Left out
   * (a trend's editor, the Precise column): no such control.
   */
  readonly depthBlurMissingIn?: readonly string[]
  /**
   * Admin → Nodaro Motion's Motion column: offer what the face mesh draws
   * (Full, Eyes and mouth, Mouth only) while it is on, with, for each part but
   * the full mesh, the environments whose engine cannot draw it
   * (`environmentsThatCannotDrawFaceMeshParts`). Left out: no such control.
   */
  readonly faceMeshPartsMissingIn?: Readonly<Record<"features" | "mouth", readonly string[]>>
  /**
   * Admin → Nodaro Motion's Motion column and a trend's editor: offer Full
   * depth's smallest face with mesh lines while the face mesh is on, with the
   * environments that cannot take it yet (`faceMeshMinFaceHeightMissing`): by
   * their engine, and by their platform (the app itself; the database is
   * shared, so an older one refuses what carries the field). Greyed out while
   * either lists one, each named apart. Left out (the Precise column, never
   * Full depth; or the environments still loading): no such control, unless
   * one is set.
   */
  readonly faceMeshMinFaceHeightMissing?: FaceMeshMinFaceHeightMissing
  /**
   * Admin → Nodaro Motion's Precise column: offer the fill None (the faces kept as filmed,
   * only the face mesh drawn), naming the environments whose engine cannot
   * draw it (`environmentsThatCannotFillNone`). Left out (a trend's editor):
   * not offered.
   */
  readonly fillNoneMissingIn?: readonly string[]
  /**
   * Admin → Nodaro Motion's Precise column: offer the depth blur on a depth
   * fill, naming the environments whose engine cannot blur a depth fill
   * (`environmentsThatCannotBlurDepthFill`). Left out (a trend's editor): no
   * such control.
   */
  readonly depthFillBlurMissingIn?: readonly string[]
  /** The source clip's length, when known: Full depth's original scene takes up to 27.5 s. */
  readonly clipSec?: number
  /** Each environment's engine, as reported (Full depth's scene names those that can't take it). */
  readonly envs?: readonly TrendEngineEnvironment[]
  /** A trend's editor: offer role outlines (Faces hidden only; Admin → Nodaro Motion never does). */
  readonly offerRoleOutlines?: boolean
  /** Full depth's scenes offered (left out: every one the environments allow); Admin → Nodaro Motion's Flex column narrows them. */
  readonly scenes?: readonly AdminTrendFullDepthScene[]
}

export function FaceMaskingEditor({
  value,
  onChange,
  autoHint,
  source = "faces",
  supportedTargets,
  bodyMissingIn,
  faceMeshMissingIn,
  depthColormapsMissingIn,
  depthModelSizesMissingIn,
  depthBlurMissingIn,
  faceMeshPartsMissingIn,
  faceMeshMinFaceHeightMissing,
  fillNoneMissingIn,
  depthFillBlurMissingIn,
  clipSec,
  envs,
  offerRoleOutlines = false,
  scenes,
}: Props) {
  const depth = isDepthPreparation(source)
  const keepPeople = source === "keep-people"
  const mode = depth ? "always" : (value?.mode ?? "off")
  // A key set to undefined (a field emptied, "No margins" unticked) is removed, never kept as
  // `key: undefined`, so the draft holds only what is set.
  const set = (patch: Partial<AdminTrendFaceMasking>) => onChange(definedOnly({ ...(value ?? { mode: "off" }), ...patch }))
  // A zone with any margin set: its empty margins are 0. None set: the default margins.
  const zoneGiven = !!value?.zone && ZONE_SIDES.some((side) => typeof value.zone?.[side] === "number")
  const noMargins = value?.zone === null
  // The first margin typed into the default zone keeps the default's other margins, as shown.
  // Every margin emptied is the zone left out again (the default), with no `zone` key kept.
  const setZone = (side: keyof AdminTrendFaceMaskingZone, v: number | undefined) => {
    const zone: AdminTrendFaceMaskingZone = { ...(zoneGiven ? value?.zone : FACE_MASKING_DEFAULTS.zone), [side]: v }
    set({ zone: ZONE_SIDES.some((s) => typeof zone[s] === "number") ? zone : undefined })
  }
  const setMode = (m: AdminTrendFaceMaskingMode) => {
    // Off with nothing else set is the same as no setting: keep the draft as it was.
    if (m === "off" && (!value || Object.keys(definedOnly(value)).length === 1)) onChange(undefined)
    else set({ mode: m })
  }
  const hint = depth
    ? "Always: the clip is prepared once, approved and stored, and every run uses it."
    : mode === "auto" && autoHint
      ? autoHint
      : MODES.find((m) => m.value === mode)?.hint
  // A fill left out is the engine's default. The blur strength belongs to the blur fill only: hidden
  // otherwise, and then neither checked nor saved (`maskingUsesBlur`), so it never holds Save.
  const fill = value?.fill ?? FACE_MASKING_DEFAULTS.fill
  // A target left out is the engine's default (the head; Keep people's: the whole person), shown as such.
  const targets = keepPeople ? KEEP_TARGETS : TARGETS
  const target = value?.target ?? (keepPeople ? defaultTargetFor(source) : FACE_MASKING_DEFAULTS.target)
  const targetHint = targets.find((t) => t.value === target)?.hint
  // Only the whole person is ever greyed out: the head is every engine's, and the face is held at publish.
  // Admin → Nodaro Motion names the environments that lack it (every one must have it there).
  const bodyUnsupported = bodyMissingIn ? bodyMissingIn.length > 0 : !!supportedTargets && !supportedTargets.includes("body")
  const missingIn = bodyMissingIn && bodyMissingIn.length > 0 ? `: ${bodyMissingIn.join(", ")}` : ""
  const word = keepPeople ? "person" : "face"
  // The face mesh: never Keep people's. A switch already on stays shown (and can be turned off) whatever
  // the engines say; one off is offered once the engine draws it.
  const meshOn = value?.faceMesh === true
  const meshUnsupported = faceMeshMissingIn ? faceMeshMissingIn.length > 0 : !someEngineDrawsFaceMesh(envs)
  const meshShown = mode !== "off" && !keepPeople && (meshOn || faceMeshMissingIn !== undefined || !meshUnsupported)
  // The fill None (Admin → Nodaro Motion's Faces hidden): the face mesh is all it draws, so the mesh stays on with it.
  // Offered once every environment's engine draws it; one already chosen stays shown, to be set back.
  const fillNone = source === "faces" && fill === "none"
  const fillNoneShown = source === "faces" && (fillNoneMissingIn !== undefined || fill === "none")
  const fillNoneUnsupported = (fillNoneMissingIn?.length ?? 0) > 0
  const fills = FILLS.filter((f) => f.value !== "none" || fillNoneShown)
  // Role outlines: a trend's, Faces hidden only. One already on stays shown (and can be turned off).
  const outlinesOn = value?.roleOutlines === true
  const outlinesUnsupported = !someEngineDrawsRoleOutlines(envs)
  const outlinesShown = offerRoleOutlines && mode !== "off" && source === "faces" && (outlinesOn || !outlinesUnsupported)
  // Depth colormap: wherever depth is drawn. Under role outlines a depth fill is fixed at grayscale.
  const colormapShown = mode !== "off" && depthColormapApplies({ source, fill })
  const colormapForced = outlinesOn && source === "faces" && fill === "depth"
  const defaultColormap = depthColormapDefaultFor(source)
  const colormap: VideoDepthColormap = colormapForced ? "grayscale" : (value?.depthColormap ?? defaultColormap)
  const drawnSomewhere = depthColormapsSomeEngineDraws(envs)
  const colormapOffered = (c: VideoDepthColormap) =>
    c === defaultColormap || (depthColormapsMissingIn ? depthColormapsMissingIn[c].length === 0 : drawnSomewhere.includes(c))
  const noColormapOffered = DEPTH_COLORMAPS.every((c) => c === defaultColormap || !colormapOffered(c))
  const colormapUnsupported = !colormapForced && !colormapOffered(colormap)
  const colormapLacking = depthColormapsMissingIn
    ? [...new Set(DEPTH_COLORMAPS.filter((c) => c !== defaultColormap).flatMap((c) => depthColormapsMissingIn[c]))]
    : []
  // Depth model: wherever depth is drawn, role outlines or not (they fix the colours, not the model).
  // An off-list stored value (not one the schema takes) reads as Large, as the server's normaliser reads it.
  const modelSize: VideoDepthModelSize = resolveVideoDepthModelSize(value?.depthModelSize)
  const modelSizesDrawnSomewhere = depthModelSizesSomeEngineDraws(envs)
  const modelSizeOffered = (s: VideoDepthModelSize) =>
    s === DEPTH_MODEL_SIZE_DEFAULT || (depthModelSizesMissingIn ? depthModelSizesMissingIn[s].length === 0 : modelSizesDrawnSomewhere.includes(s))
  const noModelSizeOffered = DEPTH_MODEL_SIZES.every((s) => s === DEPTH_MODEL_SIZE_DEFAULT || !modelSizeOffered(s))
  const modelSizeUnsupported = !modelSizeOffered(modelSize)
  const modelSizeLacking = depthModelSizesMissingIn
    ? [...new Set(DEPTH_MODEL_SIZES.filter((s) => s !== DEPTH_MODEL_SIZE_DEFAULT).flatMap((s) => depthModelSizesMissingIn[s]))]
    : []
  // The depth blur (Admin → Nodaro Motion): Full depth's (the Motion column) and a Faces hidden depth fill's (the
  // Precise column), each its own engine declaration. One already set stays shown (and can be set back to 0) whatever the
  // engines say; 0 is off, saved as no key.
  const depthBlur = value?.depthBlur
  const depthBlurOn = typeof depthBlur === "number" && depthBlur > 0
  const blurKind = mode !== "off" ? depthBlurKindOf({ source, fill }) : null
  const blurMissingIn = blurKind === "full-depth" ? depthBlurMissingIn : blurKind === "depth-fill" ? depthFillBlurMissingIn : undefined
  const depthBlurShown = blurKind !== null && (blurMissingIn !== undefined || depthBlurOn)
  const depthBlurUnsupported = (blurMissingIn?.length ?? 0) > 0
  const blurred = blurKind === "depth-fill" ? "depth fill" : "depth map"
  // What the face mesh draws (Admin → Nodaro Motion's Motion column), under its switch while it is on.
  const meshParts: AdminFaceMeshParts = value?.faceMeshParts ?? "full"
  const meshPartsShown = meshOn && !keepPeople && (faceMeshPartsMissingIn !== undefined || meshParts !== "full")
  const meshPartOffered = (p: AdminFaceMeshParts) => p === "full" || (faceMeshPartsMissingIn ? faceMeshPartsMissingIn[p].length === 0 : false)
  const meshPartsUnsupported = !meshPartOffered(meshParts)
  const noMeshPartOffered = FACE_MESH_PARTS.every((p) => p.value === "full" || !meshPartOffered(p.value))
  const meshPartsLacking = faceMeshPartsMissingIn ? [...new Set([...faceMeshPartsMissingIn.features, ...faceMeshPartsMissingIn.mouth])] : []
  // Full depth's smallest face with mesh lines, under the switch while it is on. One already set stays shown (and can be
  // emptied) whatever the engines say; empty is the engine's default, saved as no key.
  const minFace = value?.faceMeshMinFaceHeightPct
  const minFaceSet = typeof minFace === "number"
  const minFaceShown = meshOn && source === "full-depth" && (faceMeshMinFaceHeightMissing !== undefined || minFaceSet)
  // Greyed out while an environment's engine cannot draw it OR its platform does not take it yet (each named apart).
  const minFaceEngineLacking = faceMeshMinFaceHeightMissing?.engine ?? []
  const minFacePlatformLacking = faceMeshMinFaceHeightMissing?.platform ?? []
  const minFaceUnsupported = minFaceEngineLacking.length > 0 || minFacePlatformLacking.length > 0
  const id = useId()
  const modeId = `${id}-mode`
  const fillId = `${id}-fill`
  const hintId = `${id}-hint`
  const targetId = `${id}-target`
  const targetHintId = `${id}-target-hint`
  const noMarginsId = `${id}-no-margins`
  const faceMeshId = `${id}-face-mesh`
  const outlinesId = `${id}-role-outlines`
  const colormapId = `${id}-depth-colormap`
  const modelSizeId = `${id}-depth-model-size`
  const meshPartsId = `${id}-face-mesh-parts`

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {!depth && (
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={modeId} className="font-medium">
            Mode
          </label>
          <Select value={mode} onValueChange={(m) => setMode(m as AdminTrendFaceMaskingMode)}>
            <SelectTrigger id={modeId} className="h-9" aria-describedby={hint ? hintId : undefined}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        )}
        {mode !== "off" && !depth && (
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={fillId} className="font-medium">
              Fill
            </label>
            <Select
              value={fill}
              // None draws only the face mesh: choosing it turns the mesh on (the server refuses None without it).
              onValueChange={(f) => set(f === "none" ? { fill: "none", faceMesh: true } : { fill: f as AdminTrendFaceMaskingFill })}
            >
              <SelectTrigger id={fillId} className="h-9" aria-describedby={fillNone ? `${fillId}-hint` : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fills.map((f) => (
                  <SelectItem key={f.value} value={f.value} disabled={f.value === "none" && fillNoneUnsupported && !fillNone}>
                    {f.value === "none" && fillNoneUnsupported && !fillNone ? `${f.label} (not supported yet: ${fillNoneMissingIn!.join(", ")})` : f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fillNone && (
              <span id={`${fillId}-hint`} className="text-xs text-muted-foreground">
                The faces are found as for the other fills but kept as filmed: only the face mesh is drawn on them.
              </span>
            )}
            {fillNone && fillNoneUnsupported && (
              <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
                {`The Cast Swap engine of ${fillNoneMissingIn!.join(", ")} cannot keep the faces as filmed with only the face mesh yet, and this setting is shared by every environment: choose Blur or Depth colors to save.`}
              </span>
            )}
          </div>
        )}
      </div>
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}

      {colormapShown && (
        <div className="flex flex-col gap-1 text-sm sm:w-1/2 sm:pr-1.5">
          <label htmlFor={colormapId} className="font-medium">
            Depth colormap
          </label>
          <Select
            value={colormap}
            disabled={colormapForced || (noColormapOffered && colormap === defaultColormap)}
            // The default is no key: a setting without a colormap is saved exactly as before the choice existed.
            onValueChange={(c) => set({ depthColormap: c === defaultColormap ? undefined : (c as VideoDepthColormap) })}
          >
            <SelectTrigger id={colormapId} className="h-9" aria-describedby={`${colormapId}-hint`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEPTH_COLORMAPS.map((c) => (
                <SelectItem key={c} value={c} disabled={!colormapOffered(c) && c !== colormap}>
                  {COLORMAP_LABELS[c]}
                  {c === defaultColormap ? " (default)" : !colormapOffered(c) ? " (not supported yet)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span id={`${colormapId}-hint`} className="text-xs text-muted-foreground">
            {colormapForced
              ? "Role outlines draw the depth fill in grayscale, so every outline colour reads: turn them off to choose another colormap."
              : `The colors the depth map is drawn in; the prompt describes the depth by them.${offerRoleOutlines ? " Make the face mask again after a change." : ""}`}
          </span>
          {!colormapForced && colormapUnsupported && (
            <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
              {depthColormapsMissingIn
                ? `The Cast Swap engine of ${depthColormapsMissingIn[colormap].join(", ")} cannot draw the depth in ${COLORMAP_LABELS[colormap]} yet, and this setting is shared by every environment: choose the default to save.`
                : `No environment's Cast Swap engine draws the depth in ${COLORMAP_LABELS[colormap]} yet: the engine is out of date.`}
            </span>
          )}
          {!colormapForced && !colormapUnsupported && noColormapOffered && (
            <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
              {depthColormapsMissingIn
                ? `The Cast Swap engine of ${colormapLacking.join(", ")} cannot draw other depth colormaps yet, and this setting is shared by every environment.`
                : "No environment's Cast Swap engine draws other depth colormaps yet: the engine is out of date."}
            </span>
          )}
        </div>
      )}

      {colormapShown && (
        <div className="flex flex-col gap-1 text-sm sm:w-1/2 sm:pr-1.5">
          <label htmlFor={modelSizeId} className="font-medium">
            Depth model
          </label>
          <Select
            value={modelSize}
            disabled={noModelSizeOffered && modelSize === DEPTH_MODEL_SIZE_DEFAULT}
            // Large (the default) is no key: a setting without a size is saved exactly as before the choice existed.
            onValueChange={(s) => set({ depthModelSize: s === DEPTH_MODEL_SIZE_DEFAULT ? undefined : (s as VideoDepthModelSize) })}
          >
            <SelectTrigger id={modelSizeId} className="h-9" aria-describedby={`${modelSizeId}-hint`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEPTH_MODEL_SIZES.map((s) => (
                <SelectItem key={s} value={s} disabled={!modelSizeOffered(s) && s !== modelSize}>
                  {MODEL_SIZE_LABELS[s]}
                  {s === DEPTH_MODEL_SIZE_DEFAULT ? " (default)" : !modelSizeOffered(s) ? " (not supported yet)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span id={`${modelSizeId}-hint`} className="text-xs text-muted-foreground">
            {`The size of the model that draws the depth map: Large is the model every clip used until now; Small and Base are smaller models.${offerRoleOutlines ? " Make the face mask again after a change." : ""}`}
          </span>
          {modelSizeUnsupported && (
            <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
              {depthModelSizesMissingIn
                ? `The Cast Swap engine of ${depthModelSizesMissingIn[modelSize].join(", ")} cannot draw the depth with the ${MODEL_SIZE_LABELS[modelSize]} model yet, and this setting is shared by every environment: choose the default to save.`
                : `No environment's Cast Swap engine draws the depth with the ${MODEL_SIZE_LABELS[modelSize]} model yet: the engine is out of date.`}
            </span>
          )}
          {!modelSizeUnsupported && noModelSizeOffered && (
            <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
              {depthModelSizesMissingIn
                ? `The Cast Swap engine of ${modelSizeLacking.join(", ")} cannot draw the depth with other model sizes yet, and this setting is shared by every environment.`
                : "No environment's Cast Swap engine draws the depth with other model sizes yet: the engine is out of date."}
            </span>
          )}
        </div>
      )}

      {depthBlurShown && (
        <div className="flex flex-col gap-1 sm:w-1/2 sm:pr-1.5">
          <NumberField
            label="Depth blur"
            help={`Blurs the ${blurred} before its colours and the face mesh are drawn on it. 0 is off; the number is the blur's strength at 1080p (it scales with the clip's height), ${DEPTH_BLUR_BOUNDS.min}–${DEPTH_BLUR_BOUNDS.max}.`}
            value={depthBlur}
            placeholder={DEPTH_BLUR_BOUNDS.min}
            bounds={[DEPTH_BLUR_BOUNDS.min, DEPTH_BLUR_BOUNDS.max]}
            step={DEPTH_BLUR_BOUNDS.step}
            disabled={depthBlurUnsupported && !depthBlurOn}
            // 0 (or emptied) removes the key: a setting without the blur is saved exactly as before it existed.
            onChange={(v) => set({ depthBlur: v === undefined || v === 0 ? undefined : v })}
          />
          {depthBlurUnsupported && (
            <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
              {`The Cast Swap engine of ${blurMissingIn!.join(", ")} cannot blur the ${blurred} yet, and this setting is shared by every environment${depthBlurOn ? ": set it to 0 to save" : ""}.`}
            </span>
          )}
        </div>
      )}

      {source === "full-depth" && (
        <FullDepthSceneSelect value={value?.scene} clipSec={clipSec} envs={envs} only={scenes} onChange={(scene) => set({ scene })} />
      )}

      {meshShown && (
        <div className="flex flex-col gap-1 text-sm">
          <div className="flex min-h-11 items-center gap-2">
            <Checkbox
              id={faceMeshId}
              checked={meshOn}
              // None draws only the face mesh: it cannot be turned off while None is the fill.
              disabled={(meshUnsupported && !meshOn) || (fillNone && meshOn)}
              aria-describedby={`${faceMeshId}-hint`}
              // Off removes the key (and what the mesh draws, and its smallest face): a setting without the mesh is saved
              // exactly as before it existed.
              onCheckedChange={(checked) =>
                set(checked === true ? { faceMesh: true } : { faceMesh: undefined, faceMeshParts: undefined, faceMeshMinFaceHeightPct: undefined })
              }
            />
            <label htmlFor={faceMeshId} className="font-medium">
              Face mesh
            </label>
          </div>
          <span id={`${faceMeshId}-hint`} className="text-xs text-muted-foreground">
            Draws thin face lines (mesh, lips, eyes) on the {source === "full-depth" ? "faces in the depth clip" : fillNone ? "faces found, kept as filmed" : "masked heads"} so the
            video model keeps the mouth movements and the blinks (it costs a little more).
            {fillNone && meshOn ? " The fill None draws only the face mesh, so it stays on: choose Blur or Depth colors to turn it off." : ""}
          </span>
          {meshUnsupported && (
            <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
              {faceMeshMissingIn
                ? `The Cast Swap engine of ${faceMeshMissingIn.join(", ")} cannot draw the face mesh yet, and this setting is shared by every environment${meshOn ? ": turn it off to save" : ""}.`
                : "No environment's Cast Swap engine draws the face mesh yet: the engine is out of date."}
            </span>
          )}
          {meshPartsShown && (
            <div className="flex flex-col gap-1 sm:w-1/2 sm:pr-1.5">
              <label htmlFor={meshPartsId} className="font-medium">
                Face mesh lines
              </label>
              <Select
                value={meshParts}
                disabled={noMeshPartOffered && meshParts === "full"}
                // The full mesh is no key: a setting without the choice is saved exactly as before it existed.
                onValueChange={(p) => set({ faceMeshParts: p === "full" ? undefined : (p as AdminFaceMeshParts) })}
              >
                <SelectTrigger id={meshPartsId} className="h-9" aria-describedby={`${meshPartsId}-hint`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FACE_MESH_PARTS.map((p) => (
                    <SelectItem key={p.value} value={p.value} disabled={!meshPartOffered(p.value) && p.value !== meshParts}>
                      {p.label}
                      {!meshPartOffered(p.value) ? " (not supported yet)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span id={`${meshPartsId}-hint`} className="text-xs text-muted-foreground">
                What is drawn on each face: the full mesh, only the eye and lip outlines, or only the lip outline. The prompt names only what is drawn.
              </span>
              {meshPartsUnsupported && (
                <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
                  {`The Cast Swap engine of ${faceMeshPartsMissingIn ? faceMeshPartsMissingIn[meshParts as "features" | "mouth"].join(", ") : "an environment"} cannot draw ${FACE_MESH_PARTS.find((p) => p.value === meshParts)!.name} of the face mesh yet, and this setting is shared by every environment: choose Full to save.`}
                </span>
              )}
              {!meshPartsUnsupported && noMeshPartOffered && meshPartsLacking.length > 0 && (
                <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
                  {`The Cast Swap engine of ${meshPartsLacking.join(", ")} cannot draw only parts of the face mesh yet, and this setting is shared by every environment.`}
                </span>
              )}
            </div>
          )}
          {minFaceShown && (
            <div className="flex flex-col gap-1 sm:w-1/2 sm:pr-1.5">
              <NumberField
                label="Smallest face with mesh lines"
                help={`% of the frame's height; faces smaller than this, or centred in the outer 10 % at the left and right, get no lines; 0 = no size minimum (the side margins still apply)${offerRoleOutlines ? ". Make the face mask again after a change." : ""}`}
                value={minFace}
                placeholder={FACE_MESH_MIN_FACE_HEIGHT_DEFAULT_PCT}
                bounds={FACE_MASKING_BOUNDS.faceHeightPct}
                step={1}
                disabled={minFaceUnsupported && !minFaceSet}
                // Emptied removes the key: the engine's default, saved exactly as before the choice existed.
                onChange={(v) => set({ faceMeshMinFaceHeightPct: v })}
              />
              {minFaceEngineLacking.length > 0 && (
                <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
                  {offerRoleOutlines
                    ? `The Cast Swap engine of ${minFaceEngineLacking.join(", ")} cannot set the smallest face with mesh lines yet${minFaceSet ? ": a face mask made there is refused while it is set" : ""}.`
                    : `The Cast Swap engine of ${minFaceEngineLacking.join(", ")} cannot set the smallest face with mesh lines yet, and this setting is shared by every environment${minFaceSet ? ": empty it to save" : ""}.`}
                </span>
              )}
              {/* The platform (the app itself): the database is shared, and an older one refuses what carries the field. */}
              {minFacePlatformLacking.length > 0 && (
                <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
                  {`The platform in ${minFacePlatformLacking.join(", ")} does not take the smallest face with mesh lines yet, and ${offerRoleOutlines ? "trends are" : "this setting is"} shared by every environment${minFaceSet ? ": empty it to save" : ""}.`}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {outlinesShown && (
        <div className="flex flex-col gap-1 text-sm">
          <div className="flex min-h-11 items-center gap-2">
            <Checkbox
              id={outlinesId}
              checked={outlinesOn}
              disabled={outlinesUnsupported && !outlinesOn}
              aria-describedby={`${outlinesId}-hint`}
              // Off removes the key: a setting without outlines is saved exactly as before they existed.
              onCheckedChange={(checked) => set({ roleOutlines: checked === true ? true : undefined })}
            />
            <label htmlFor={outlinesId} className="font-medium">
              Role outlines
            </label>
          </div>
          <span id={`${outlinesId}-hint`} className="text-xs text-muted-foreground">
            Draws a coloured outline around each masked person, one colour per person slot ({ROLE_OUTLINE_PALETTE.map((c) => c.name).join(", ")}, in
            slot order), so the video model knows who is who after every cut. Each person&apos;s boxes on the face mask
            say whose outline a region gets, required people included. A depth fill is then drawn in gray. Make the face mask
            again after turning it on or moving a box.
          </span>
          {outlinesUnsupported && (
            <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
              No environment&apos;s Cast Swap engine draws role outlines yet: the engine is out of date.
            </span>
          )}
        </div>
      )}

      {mode !== "off" && source !== "full-depth" && (
        <>
          <div className="flex flex-col gap-1 text-sm sm:w-1/2 sm:pr-1.5">
            <label htmlFor={targetId} className="font-medium">
              {keepPeople ? "Keeps" : "Covers"}
            </label>
            <Select value={target} onValueChange={(t) => set({ target: t as AdminTrendFaceMaskingTarget })}>
              <SelectTrigger id={targetId} className="h-9" aria-describedby={targetHint ? targetHintId : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {targets.map((t) => (
                  <SelectItem key={t.value} value={t.value} disabled={t.value === "body" && bodyUnsupported && target !== "body"}>
                    {t.value === "body" && bodyUnsupported && target !== "body" && !keepPeople ? `${t.label} (not supported yet${missingIn})` : t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {targetHint && (
              <span id={targetHintId} className="text-xs text-muted-foreground">
                {targetHint}
              </span>
            )}
            {bodyUnsupported && (keepPeople || target === "body") && (
              <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
                {keepPeople
                  ? "No environment's Cast Swap engine keeps whole people yet: the engine is out of date."
                  : bodyMissingIn
                    ? `The Cast Swap engine of ${bodyMissingIn.join(", ")} cannot hide whole people yet, and this setting is shared by every environment: choose Head or Face.`
                    : "No environment's Cast Swap engine hides whole people yet: the engine is out of date."}
              </span>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField
              label={`Smallest ${word} height (%)`}
              help={keepPeople ? "Only people at least this tall are kept as filmed." : fillNone ? "Only faces at least this tall get the face mesh." : "Only faces at least this tall are covered."}
              value={value?.minFaceHeightPct}
              placeholder={FACE_MASKING_DEFAULTS.minFaceHeightPct}
              bounds={FACE_MASKING_BOUNDS.faceHeightPct}
              step={1}
              onChange={(v) => set({ minFaceHeightPct: v })}
            />
            <NumberField
              label={`Largest ${word} height (%)`}
              help="0 = no limit."
              value={value?.maxFaceHeightPct}
              placeholder={FACE_MASKING_DEFAULTS.maxFaceHeightPct}
              bounds={FACE_MASKING_BOUNDS.faceHeightPct}
              step={1}
              onChange={(v) => set({ maxFaceHeightPct: v })}
            />
            {!keepPeople && maskingUsesBlur({ fill }) && (
              <NumberField
                label="Blur strength (%)"
                help="Of the frame's width, for the blur fill."
                value={value?.blurStrengthPct}
                placeholder={FACE_MASKING_DEFAULTS.blurStrengthPct}
                bounds={FACE_MASKING_BOUNDS.blurStrengthPct}
                step={0.1}
                onChange={(v) => set({ blurStrengthPct: v })}
              />
            )}
            <NumberField
              label="Detection threshold"
              help={keepPeople ? "Lower finds more people." : "Lower finds more faces."}
              value={value?.threshold}
              placeholder={FACE_MASKING_DEFAULTS.threshold}
              bounds={FACE_MASKING_BOUNDS.threshold}
              step={0.05}
              onChange={(v) => set({ threshold: v })}
            />
          </div>
          <fieldset className="flex flex-col gap-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Margins (%)</legend>
            <p className="text-xs text-muted-foreground">
              {keepPeople
                ? `A person centred inside a margin becomes depth with the rest. Left empty: ${FACE_MASKING_DEFAULTS.zone.leftPct} % at the left and right (the default), so people at the edges of the frame are not kept.`
                : `A face centred inside a margin is left as it is. Left empty: ${FACE_MASKING_DEFAULTS.zone.leftPct} % at the left and right (the default), so people at the edges of the frame ${fillNone ? "do not get the face mesh" : "are not covered"}.`}
            </p>
            <div className="flex min-h-11 items-center gap-2 text-sm">
              <Checkbox
                id={noMarginsId}
                checked={noMargins}
                onCheckedChange={(checked) => set({ zone: checked === true ? null : undefined })}
              />
              <label htmlFor={noMarginsId}>
                {keepPeople
                  ? "No margins: keep people anywhere in the frame"
                  : fillNone
                    ? "No margins: draw the face mesh on faces anywhere in the frame"
                    : "No margins: cover faces anywhere in the frame"}
              </label>
            </div>
            {!noMargins && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {ZONE_SIDES.map((side) => (
                  <NumberField
                    key={side}
                    label={ZONE_LABELS[side]}
                    value={value?.zone?.[side]}
                    placeholder={zoneGiven ? FACE_MASKING_DEFAULTS.zonePct : FACE_MASKING_DEFAULTS.zone[side]}
                    bounds={FACE_MASKING_BOUNDS.zonePct}
                    step={1}
                    onChange={(v) => setZone(side, v)}
                  />
                ))}
              </div>
            )}
          </fieldset>
        </>
      )}
    </div>
  )
}

/** The setting without its undefined keys (`zone: null`, "no margins", is kept). */
function definedOnly(m: AdminTrendFaceMasking): AdminTrendFaceMasking {
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)) as AdminTrendFaceMasking
}

interface NumberFieldProps {
  readonly label: string
  readonly help?: string
  readonly value: number | undefined
  readonly placeholder: number
  readonly bounds: readonly [number, number]
  readonly step: number
  readonly disabled?: boolean
  readonly onChange: (v: number | undefined) => void
}

/** Empty = the engine's default (never NaN). */
function NumberField({ label, help, value, placeholder, bounds: [min, max], step, disabled, onChange }: NumberFieldProps) {
  const invalid = value !== undefined && !(value >= min && value <= max)
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <Input
        id={id}
        aria-describedby={help ? `${id}-help` : undefined}
        type="number"
        inputMode="decimal"
        className="h-9"
        min={min}
        max={max}
        step={step}
        value={value ?? ""}
        placeholder={String(placeholder)}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(e) => {
          const raw = e.target.value
          const n = raw === "" ? undefined : Number(raw)
          onChange(n === undefined || Number.isNaN(n) ? undefined : n)
        }}
      />
      {help && (
        <span id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </span>
      )}
    </div>
  )
}
