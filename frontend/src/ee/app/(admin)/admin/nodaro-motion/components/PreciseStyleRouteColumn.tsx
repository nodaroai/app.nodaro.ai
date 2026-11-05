// Admin → Nodaro Motion, Prism's Precise art-style route (the
// `nodaro_motion_precise_style_route` setting), beside the Precise art-style
// settings: whether a direct Precise run that carries an art style runs as Flex
// (On, the default when never saved) or stays Precise (Off), and the accounts'
// emails that skip it and run real Precise with a style, for testing.
//
// The setting is shared by every environment, but only an engine that declares
// `castSwap.preciseStyleRoute` reads it; one without it runs such a run as
// Precise whatever this says, so nothing here waits for an engine: a note names
// the environments that do not route yet.

import { useId } from "react"
import type { NodaroMotionPreciseStyleRoute, TrendEngineEnvironment } from "@/lib/api"
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

/** Said when some environments' engines do not route yet (they never read this setting). */
export function preciseStyleRouteMissingNote(missing: readonly string[]): string {
  return `The Cast Swap engine of ${missing.join(", ")} does not route yet: its Precise runs with an art style stay Precise whatever this says.`
}

/** The draft: the emails as typed, so a half-typed line stays as it is. */
export interface PreciseStyleRouteDraft {
  routing: "on" | "off"
  emailsText: string
}

/** The draft of what is stored (null = never saved: on, nobody), one address per line. */
export function preciseStyleRouteDraftOf(saved: NodaroMotionPreciseStyleRoute | null | undefined): PreciseStyleRouteDraft {
  return { routing: saved?.routing === "off" ? "off" : "on", emailsText: (saved?.bypassEmails ?? []).join("\n") }
}

/** The addresses in the draft, trimmed and lowercased, without repeats. */
function emailsOf(text: string): string[] {
  const all = text
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== "")
  return [...new Set(all)]
}

/** The setting as it is saved (the server's own reading): `routing` only when "off", the list only when it is not empty. */
export function preciseStyleRouteToSaved(draft: PreciseStyleRouteDraft): NodaroMotionPreciseStyleRoute {
  const out: NodaroMotionPreciseStyleRoute = {}
  if (draft.routing === "off") out.routing = "off"
  const emails = emailsOf(draft.emailsText)
  if (emails.length > 0) out.bypassEmails = emails
  return out
}

/** What holds Save: anything on the list that is not an email, named. The server's own check is stricter, and its refusal is said in place. */
export function preciseStyleRouteIssues(draft: PreciseStyleRouteDraft): string[] {
  const bad = emailsOf(draft.emailsText).filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
  return bad.length > 0 ? [`Not an email: ${bad.join(", ")}`] : []
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
