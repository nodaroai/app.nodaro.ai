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

import { useId } from "react"
import type { NodaroMotionPreciseStyleRoute, TrendEngineEnvironment } from "@/lib/api"
import { DEPTH_BLUR_BOUNDS } from "../../trends/model"
import { environmentsThatCannotRoutePreciseStyle } from "../../trends/clip-preparation"

export const PRECISE_STYLE_ROUTE_LEGEND = "Precise runs with an art style: run as Flex"

const ROUTINGS = [
  {
    value: "on",
    label: "On (default)",
    hint: "A direct Prism run that resolves to Precise and carries an art style runs as Flex, its estimate alike. The Precise settings below then serve only the accounts on the list.",
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

/** Said when some environments' engines do not route yet (they never read this setting). */
export function preciseStyleRouteMissingNote(missing: readonly string[]): string {
  return `The Cast Swap engine of ${missing.join(", ")} does not route yet: its Precise runs with an art style stay Precise whatever this says.`
}

/** The draft: the emails and the blur as typed, so a half-typed value stays as it is. */
export interface PreciseStyleRouteDraft {
  routing: "on" | "off"
  emailsText: string
  depthBlurText: string
  describeColours: boolean
  faceMesh: boolean
}

/** The draft of what is stored (null = never saved: on, nobody), one address per line. */
export function preciseStyleRouteDraftOf(saved: NodaroMotionPreciseStyleRoute | null | undefined): PreciseStyleRouteDraft {
  return { routing: saved?.routing === "off" ? "off" : "on", emailsText: (saved?.bypassEmails ?? []).join("\n"), depthBlurText: String(saved?.routedDepthBlur ?? 0), describeColours: saved?.describeColours !== false, faceMesh: saved?.faceMesh === true }
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

/** The setting as it is saved (the server's own reading): `routing` only when "off", the list only when it is not empty, the blur only above 0. */
export function preciseStyleRouteToSaved(draft: PreciseStyleRouteDraft): NodaroMotionPreciseStyleRoute {
  const out: NodaroMotionPreciseStyleRoute = {}
  if (draft.routing === "off") out.routing = "off"
  const emails = emailsOf(draft.emailsText)
  if (emails.length > 0) out.bypassEmails = emails
  const blur = depthBlurOf(draft.depthBlurText)
  if (blur !== undefined && blur > 0) out.routedDepthBlur = blur
  if (!draft.describeColours) out.describeColours = false
  if (draft.faceMesh) out.faceMesh = true
  return out
}

/** What holds Save: anything on the list that is not an email, named. The server's own check is stricter, and its refusal is said in place. */
export function preciseStyleRouteIssues(draft: PreciseStyleRouteDraft): string[] {
  const bad = emailsOf(draft.emailsText).filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
  return [
    ...(bad.length > 0 ? [`Not an email: ${bad.join(", ")}`] : []),
    ...(depthBlurOf(draft.depthBlurText) === undefined ? [`The depth blur must be a whole number from ${DEPTH_BLUR_BOUNDS.min} to ${DEPTH_BLUR_BOUNDS.max}.`] : []),
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
}

export function PreciseStyleRouteColumn({ value, onChange, envs, supported, error }: Props) {
  const id = useId()
  const missing = environmentsThatCannotRoutePreciseStyle(envs)
  const issues = preciseStyleRouteIssues(value)
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
