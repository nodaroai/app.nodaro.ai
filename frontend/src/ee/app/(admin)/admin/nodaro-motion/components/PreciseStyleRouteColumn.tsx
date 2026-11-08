// Admin → Nodaro Motion, Prism's Precise art-style route (the
// `nodaro_motion_precise_style_route` setting), beside the Precise art-style
// settings: whether a direct Precise run that carries an art style runs as Flex
// (On, the default when never saved) or stays Precise (Off), and the accounts'
// emails that skip it and run real Precise with a style, for testing, and the
// depth blur of a run it makes Flex (0, the default, is no blur; every other
// Flex run keeps the Motion masking's blur), and whether its shot list writer is
// told to describe the colours from the video (On by default), since the depth
// map it sends has none, and whether that depth map carries the face mesh (Off
// by default).
//
// The setting is shared by every environment, but only an engine that declares
// `castSwap.preciseStyleRoute` reads it; one without it runs such a run as
// Precise whatever this says, so nothing here waits for an engine: a note names
// the environments that do not route yet.
//
// Under the switch, how a Precise run with each art style is made
// (`styleRoutes`, StyleRoutesTable.tsx): the Flex way (the default), Precise, or
// Precise in black and white, style by style from the style catalog; a note
// names the environments whose engine does not read it yet. The older
// `photographicStyles: "precise"` reads as Precise for the photographic styles,
// and is never saved again.
//
// Beside what the routed face mesh draws, its lines on a depth face
// (`face-mesh-thumbnails.ts`): "As the Motion masking" shows the Flex masking's
// own lines (`flexMaskingLayers`), "Choose the layers" the switches' set.

import { useId } from "react"
import type { NodaroMotionPreciseStyleRoute, TrendEngineEnvironment } from "@/lib/api"
import { DEPTH_BLUR_BOUNDS } from "../../trends/model"
import { environmentsThatCannotDrawFaceMeshLayers, environmentsThatCannotRoutePreciseStyle } from "../../trends/clip-preparation"
import { videoFaceMeshLayersOfParts, type VideoFaceMeshLayers } from "@nodaro/shared/media"
import { layersDrawLines, layersOfSetting, savedFormOfLayers } from "../../trends/face-mesh-layers"
import { faceMeshLayersThumbnail, type FaceMeshThumbnail as Thumbnail } from "../../trends/face-mesh-thumbnails"
import { FaceMeshLayerSwitches } from "../../trends/components/FaceMeshLayerSwitches"
import { FaceMeshThumbnail } from "../../trends/components/FaceMeshThumbnail"
import { StyleRoutesTable, styleRoutesDraftOf, styleRoutesToSaved, type StyleRoute } from "./StyleRoutesTable"

export const PRECISE_STYLE_ROUTE_LEGEND = "Precise runs with an art style: run as Flex"

const ROUTINGS = [
  {
    value: "on",
    label: "On (default)",
    hint: "A direct Prism run that resolves to Precise and carries an art style runs as Flex, its estimate alike. The Precise settings below then serve only the accounts on the list, and the art styles kept Precise in the table below.",
  },
  { value: "off", label: "Off", hint: "Such a run stays Precise, with the settings below." },
] as const

export const PRECISE_STYLE_ROUTE_EMAILS_LABEL = "Accounts that skip this and run real Precise (test emails)"

const PRECISE_STYLE_ROUTE_EMAILS_HINT = "One per line or comma. Compared ignoring case against the account's email on the server."

export const PRECISE_STYLE_ROUTE_DEPTH_BLUR_LABEL = "Depth blur of routed runs"

const PRECISE_STYLE_ROUTE_DEPTH_BLUR_HINT = `Applies only to Precise runs with an art style that are routed to Flex; other Flex runs keep the Motion masking's blur. 0 means no blur (${DEPTH_BLUR_BOUNDS.min}–${DEPTH_BLUR_BOUNDS.max}).`

export const PRECISE_STYLE_ROUTE_COLOURS_LABEL = "Describe colours for routed runs"

const PRECISE_STYLE_ROUTE_COLOURS_HINT =
  "Applies only to Precise runs with an art style that are routed to Flex: the shot list writer is told to describe colours from the video (the depth map those runs send has none)."

export const PRECISE_STYLE_ROUTE_FACE_MESH_LABEL = "Face mesh for routed runs"

const PRECISE_STYLE_ROUTE_FACE_MESH_HINT =
  "Applies only to Precise runs with an art style that are routed to Flex. Off sends the depth map without the face mesh lines; it is the default."

export const PRECISE_STYLE_ROUTE_MESH_PARTS_LABEL = "What the routed face mesh draws"

const PRECISE_STYLE_ROUTE_MESH_PARTS_HINT =
  "Applies only to Precise runs with an art style that are routed to Flex, while their face mesh is on. Contours: the face outline, eyebrows, nose, eyes and lips, without the wireframe. Choose the layers: one switch per layer, any combination."

const MESH_PARTS_OPTIONS: ReadonlyArray<{ value: PreciseStyleRouteDraft["faceMeshParts"]; label: string }> = [
  { value: "", label: "As the Motion masking (today's)" },
  { value: "full", label: "The whole mesh" },
  { value: "features", label: "Eye and lip outlines" },
  { value: "mouth", label: "Lip outline" },
  { value: "contours", label: "Contours" },
  { value: "layers", label: "Choose the layers" },
]

export const PRECISE_STYLE_ROUTE_MESH_LAYERS_LEGEND = "Routed face mesh layers"

export const PRECISE_STYLE_ROUTE_MESH_WORDING_LABEL = "How the prompt words the routed face mesh"

const PRECISE_STYLE_ROUTE_MESH_WORDING_HINT =
  "Applies only to Precise runs with an art style that are routed to Flex, while their face mesh is on. Shape tells the engine the lines map the face's 3D shape; it is worded for the whole mesh in gray only, and any other case keeps the Motion wording."

const MESH_WORDING_OPTIONS: ReadonlyArray<{ value: PreciseStyleRouteDraft["faceMeshWording"]; label: string }> = [
  { value: "motion", label: "Motion (default)" },
  { value: "shape", label: "Shape" },
]

/**
 * The picture of what the routed face mesh draws (null with "Choose the layers": the switches show theirs): "As the
 * Motion masking" is the Flex masking's lines (`flexMaskingLayers`; the whole mesh when unknown).
 */
export function routedMeshThumbnail(parts: PreciseStyleRouteDraft["faceMeshParts"], flexMaskingLayers: VideoFaceMeshLayers | undefined): Thumbnail | null {
  if (parts === "layers") return null
  if (parts !== "") return faceMeshLayersThumbnail(videoFaceMeshLayersOfParts(parts))
  const t = faceMeshLayersThumbnail(flexMaskingLayers ?? layersOfSetting(undefined))
  return { ...t, alt: `As the Motion masking: ${t.alt.charAt(0).toLowerCase()}${t.alt.slice(1)}` }
}

/** Said when some environments' engines do not route yet (they never read this setting). */
export function preciseStyleRouteMissingNote(missing: readonly string[]): string {
  return `The Cast Swap engine of ${missing.join(", ")} does not route yet: its Precise runs with an art style stay Precise whatever this says.`
}

/** The draft: the emails and the blur as typed, so a half-typed value stays as it is. */
export interface PreciseStyleRouteDraft {
  routing: "on" | "off"
  /** How a Precise run with each art style is made: every catalog style (and any stored one the catalog lacks). */
  styleRoutes: Record<string, StyleRoute>
  emailsText: string
  depthBlurText: string
  describeColours: boolean
  faceMesh: boolean
  /** "" = as the Motion masking (nothing saved); "layers" = the switches (`faceMeshLayers`). */
  faceMeshParts: "" | "layers" | NonNullable<NodaroMotionPreciseStyleRoute["faceMeshParts"]>
  /** The switches' layers (read only with "layers"); they start from what is drawn. */
  faceMeshLayers: VideoFaceMeshLayers
  faceMeshWording: "motion" | "shape"
}

/** The draft of what is stored (null = never saved: on, nobody), one address per line. */
export function preciseStyleRouteDraftOf(saved: NodaroMotionPreciseStyleRoute | null | undefined): PreciseStyleRouteDraft {
  return { routing: saved?.routing === "off" ? "off" : "on", styleRoutes: styleRoutesDraftOf(saved), emailsText: (saved?.bypassEmails ?? []).join("\n"), depthBlurText: String(saved?.routedDepthBlur ?? 0), describeColours: saved?.describeColours !== false,
    faceMesh: saved?.faceMesh === true,
    faceMeshParts: saved?.faceMeshLayers ? "layers" : (saved?.faceMeshParts ?? ""),
    faceMeshLayers: layersOfSetting(saved),
    faceMeshWording: saved?.faceMeshWording === "shape" ? "shape" : "motion",
  }
}

/** The addresses in the draft, trimmed and lowercased, without repeats. */
function emailsOf(text: string): string[] {
  const all = text
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== "")
  return [...new Set(all)]
}

/** The blur as typed: a whole number in bounds, 0 when left empty; undefined when it is neither. */
function depthBlurOf(text: string): number | undefined {
  const t = text.trim()
  if (t === "") return 0
  if (!/^\d+$/.test(t)) return undefined
  const n = Number(t)
  return n >= DEPTH_BLUR_BOUNDS.min && n <= DEPTH_BLUR_BOUNDS.max ? n : undefined
}

/** The setting as it is saved (the server's own reading): `routing` only when "off", the styles not on the Flex way only, the list only when it is not empty, the blur only above 0; never `photographicStyles`. */
export function preciseStyleRouteToSaved(draft: PreciseStyleRouteDraft): NodaroMotionPreciseStyleRoute {
  const out: NodaroMotionPreciseStyleRoute = {}
  if (draft.routing === "off") out.routing = "off"
  const styleRoutes = styleRoutesToSaved(draft.styleRoutes)
  if (styleRoutes) out.styleRoutes = styleRoutes
  const emails = emailsOf(draft.emailsText)
  if (emails.length > 0) out.bypassEmails = emails
  const blur = depthBlurOf(draft.depthBlurText)
  if (blur !== undefined && blur > 0) out.routedDepthBlur = blur
  if (!draft.describeColours) out.describeColours = false
  if (draft.faceMesh) out.faceMesh = true
  // The layers are saved as the parts value that names them (the whole mesh too: it is not the default here).
  if (draft.faceMeshParts === "layers") Object.assign(out, savedFormOfLayers(draft.faceMeshLayers, ["full", "features", "mouth", "contours"], { fullIsDefault: false }))
  else if (draft.faceMeshParts !== "") out.faceMeshParts = draft.faceMeshParts
  if (draft.faceMeshWording === "shape") out.faceMeshWording = "shape"
  return out
}

/** What holds Save: anything on the list that is not an email, named. The server's own check is stricter, and its refusal is said in place. */
export function preciseStyleRouteIssues(draft: PreciseStyleRouteDraft): string[] {
  const bad = emailsOf(draft.emailsText).filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
  return [
    ...(bad.length > 0 ? [`Not an email: ${bad.join(", ")}`] : []),
    ...(depthBlurOf(draft.depthBlurText) === undefined ? [`The depth blur must be a whole number from ${DEPTH_BLUR_BOUNDS.min} to ${DEPTH_BLUR_BOUNDS.max}.`] : []),
    ...(draft.faceMeshParts === "layers" && !layersDrawLines(draft.faceMeshLayers) ? ["The routed face mesh layers draw nothing: turn on a layer other than Bold lines."] : []),
  ]
}

interface Props {
  readonly value: PreciseStyleRouteDraft
  readonly onChange: (next: PreciseStyleRouteDraft) => void
  /** Each environment's engine, as reported (unknown while loading). */
  readonly envs: readonly TrendEngineEnvironment[] | undefined
  /** Whether this environment's engine routes (the setting's GET). */
  readonly supported: boolean
  /** The last save's refusal, said in place. */
  readonly error?: string
  /** The lines the Flex masking draws (`layersOfSetting`): what "As the Motion masking" shows. */
  readonly flexMaskingLayers?: VideoFaceMeshLayers
}

export function PreciseStyleRouteColumn({ value, onChange, envs, supported, error, flexMaskingLayers }: Props) {
  const id = useId()
  const missing = environmentsThatCannotRoutePreciseStyle(envs)
  const issues = preciseStyleRouteIssues(value)
  // A set only layers name reaches only an engine that draws layers: elsewhere routed runs draw the Motion masking's lines.
  const onlyLayers = value.faceMeshParts === "layers" && savedFormOfLayers(value.faceMeshLayers, ["full", "features", "mouth", "contours"]).faceMeshLayers !== undefined
  const layersMissing = onlyLayers ? (environmentsThatCannotDrawFaceMeshLayers(envs)?.engine ?? []) : []
  const meshThumbnail = routedMeshThumbnail(value.faceMeshParts, flexMaskingLayers)
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 text-sm" data-testid="precise-style-route-column">
      <legend className="font-medium">{PRECISE_STYLE_ROUTE_LEGEND}</legend>
      {ROUTINGS.map((o) => {
        const optionId = `${id}-${o.value}`
        return (
          <div key={o.value} className="flex min-h-11 items-start gap-2">
            <input
              id={optionId}
              type="radio"
              name={`${id}-routing`}
              className="mt-1 h-4 w-4"
              checked={value.routing === o.value}
              aria-describedby={`${optionId}-hint`}
              onChange={() => onChange({ ...value, routing: o.value })}
            />
            <div className="flex min-w-0 flex-col">
              <label htmlFor={optionId} className="font-medium">
                {o.label}
              </label>
              <span id={`${optionId}-hint`} className="text-xs text-muted-foreground">
                {o.hint}
              </span>
            </div>
          </div>
        )
      })}
      <StyleRoutesTable value={value.styleRoutes} onChange={(styleRoutes) => onChange({ ...value, styleRoutes })} envs={envs} disabled={value.routing === "off"} />
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-emails`} className="font-medium">
          {PRECISE_STYLE_ROUTE_EMAILS_LABEL}
        </label>
        <textarea
          id={`${id}-emails`}
          rows={3}
          spellCheck={false}
          autoComplete="off"
          dir="ltr"
          className="w-full min-w-0 rounded-md border bg-background p-2 text-base sm:text-sm"
          aria-describedby={`${id}-emails-hint`}
          value={value.emailsText}
          onChange={(e) => onChange({ ...value, emailsText: e.target.value })}
        />
        <span id={`${id}-emails-hint`} className="text-xs text-muted-foreground">
          {PRECISE_STYLE_ROUTE_EMAILS_HINT}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-blur`} className="font-medium">
          {PRECISE_STYLE_ROUTE_DEPTH_BLUR_LABEL}
        </label>
        <input
          id={`${id}-blur`}
          type="number"
          inputMode="numeric"
          min={DEPTH_BLUR_BOUNDS.min}
          max={DEPTH_BLUR_BOUNDS.max}
          step={DEPTH_BLUR_BOUNDS.step}
          className="h-11 w-28 rounded-md border bg-background px-2 text-base sm:h-9 sm:text-sm"
          aria-describedby={`${id}-blur-hint`}
          value={value.depthBlurText}
          onChange={(e) => onChange({ ...value, depthBlurText: e.target.value })}
        />
        <span id={`${id}-blur-hint`} className="text-xs text-muted-foreground">
          {PRECISE_STYLE_ROUTE_DEPTH_BLUR_HINT}
        </span>
      </div>
      <div className="flex min-h-11 items-start gap-2">
        <input
          id={`${id}-colours`}
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={value.describeColours}
          aria-describedby={`${id}-colours-hint`}
          onChange={(e) => onChange({ ...value, describeColours: e.target.checked })}
        />
        <div className="flex min-w-0 flex-col">
          <label htmlFor={`${id}-colours`} className="font-medium">
            {PRECISE_STYLE_ROUTE_COLOURS_LABEL}
          </label>
          <span id={`${id}-colours-hint`} className="text-xs text-muted-foreground">
            {PRECISE_STYLE_ROUTE_COLOURS_HINT}
          </span>
        </div>
      </div>
      <div className="flex min-h-11 items-start gap-2">
        <input
          id={`${id}-mesh`}
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={value.faceMesh}
          aria-describedby={`${id}-mesh-hint`}
          onChange={(e) => onChange({ ...value, faceMesh: e.target.checked })}
        />
        <div className="flex min-w-0 flex-col">
          <label htmlFor={`${id}-mesh`} className="font-medium">
            {PRECISE_STYLE_ROUTE_FACE_MESH_LABEL}
          </label>
          <span id={`${id}-mesh-hint`} className="text-xs text-muted-foreground">
            {PRECISE_STYLE_ROUTE_FACE_MESH_HINT}
          </span>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-mesh-parts`} className="font-medium">
          {PRECISE_STYLE_ROUTE_MESH_PARTS_LABEL}
        </label>
        <div className="flex min-w-0 items-start gap-2">
          <select
            id={`${id}-mesh-parts`}
            className="h-11 w-full min-w-0 rounded-md border bg-background px-2 text-base sm:h-9 sm:w-auto sm:text-sm"
            aria-describedby={`${id}-mesh-parts-hint`}
            value={value.faceMeshParts}
            onChange={(e) => {
              const next = e.target.value as PreciseStyleRouteDraft["faceMeshParts"]
              // "Choose the layers" starts from the lines chosen before it (the whole mesh after "as the Motion masking").
              const from = value.faceMeshParts === "layers" ? value.faceMeshLayers : layersOfSetting({ faceMeshParts: value.faceMeshParts === "" ? undefined : value.faceMeshParts })
              onChange({ ...value, faceMeshParts: next, faceMeshLayers: from })
            }}
          >
            {MESH_PARTS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {meshThumbnail && <FaceMeshThumbnail thumbnail={meshThumbnail} />}
        </div>
        <span id={`${id}-mesh-parts-hint`} className="text-xs text-muted-foreground">
          {PRECISE_STYLE_ROUTE_MESH_PARTS_HINT}
        </span>
      </div>
      {value.faceMeshParts === "layers" && (
        <FaceMeshLayerSwitches
          legend={PRECISE_STYLE_ROUTE_MESH_LAYERS_LEGEND}
          value={value.faceMeshLayers}
          onChange={(faceMeshLayers) => onChange({ ...value, faceMeshLayers })}
        >
          {layersMissing.length > 0 && (
            <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
              {`The Cast Swap engine of ${layersMissing.join(", ")} does not draw face mesh layers yet: its routed runs draw the Motion masking's lines until it does.`}
            </span>
          )}
        </FaceMeshLayerSwitches>
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-mesh-wording`} className="font-medium">
          {PRECISE_STYLE_ROUTE_MESH_WORDING_LABEL}
        </label>
        <select
          id={`${id}-mesh-wording`}
          className="h-11 w-full min-w-0 rounded-md border bg-background px-2 text-base sm:h-9 sm:w-auto sm:text-sm"
          aria-describedby={`${id}-mesh-wording-hint`}
          value={value.faceMeshWording}
          onChange={(e) => onChange({ ...value, faceMeshWording: e.target.value === "shape" ? "shape" : "motion" })}
        >
          {MESH_WORDING_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span id={`${id}-mesh-wording-hint`} className="text-xs text-muted-foreground">
          {PRECISE_STYLE_ROUTE_MESH_WORDING_HINT}
        </span>
      </div>
      {missing && missing.length > 0 && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {preciseStyleRouteMissingNote(missing)}
        </p>
      )}
      {!supported && <p className="text-xs text-muted-foreground">This environment's engine does not route yet.</p>}
      {issues.map((issue) => (
        <p key={issue} role="alert" className="text-xs text-destructive">
          {issue}
        </p>
      ))}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  )
}
