// Admin → Nodaro Motion → the Precise art-style route's per-style table
// (`styleRoutes` of `nodaro_motion_precise_style_route`): how a Precise run
// with each art style is made while the route is on — the Flex way (the
// default, never saved), Precise, or Precise in black and white
// ("precise-gray"). One select per style of the catalog, grouped by its medium
// (`getStyleMedium`), each group with a "Set all to…" of its own.
//
// The draft holds every catalog style, and also any stored entry for a style
// this build's catalog lacks (environments share the row but may run another
// catalog): it is not shown, and saved back as it was. The older
// `photographicStyles: "precise"` reads as Precise for the photographic styles
// without an entry of their own; it is never saved again.
//
// An environment routes by the map only when its engine declares
// `castSwap.preciseStyleRoutePerStyle` and its platform claims it; nothing
// waits for one, and a note names those that route (`castSwap.preciseStyleRoute`)
// but not yet per style. One that does not route at all has the column's own
// note (its runs stay Precise).

import { useId } from "react"
import { STYLES, getStyleMedium } from "@nodaro/prompts/pickers"
import type { NodaroMotionPreciseStyleRoute, TrendEngineEnvironment } from "@/lib/api"
import { environmentsThatCannotRoutePerStyle, environmentsThatCannotRoutePreciseStyle } from "../../trends/clip-preparation"

/** A style's route: "flex" is the default and is never saved. */
export type StyleRoute = "flex" | NonNullable<NodaroMotionPreciseStyleRoute["styleRoutes"]>[string]

export const STYLE_ROUTES_LEGEND = "Route per art style (Precise runs only)"

const STYLE_ROUTES_HINT = "How a Precise run with this art style is made. A Flex run is always made the Flex way."

const ROUTE_OPTIONS: ReadonlyArray<{ value: StyleRoute; label: string }> = [
  { value: "flex", label: "Flex way (depth)" },
  { value: "precise", label: "Precise" },
  { value: "precise-gray", label: "Precise, in black and white" },
]

const SET_ALL = "Set all to…"

const COMES_BACK_REAL = "These come back real on the Precise route; keep them on the Flex way."

/** The groups, in this order, with their headings; drawn and rendered styles come back real on the Precise route. */
const GROUPS = [
  { medium: "2d", heading: "Drawn", warn: true },
  { medium: "3d", heading: "Rendered", warn: true },
  { medium: "photo", heading: "Filmed", warn: false },
] as const

/** Said when some visible style is not the Flex way and some environments that route do not route per style. */
export function styleRoutesMissingNote(missing: readonly string[]): string {
  return `${missing.join(", ")} cannot route per style yet; there every style is made the Flex way.`
}

const isRoute = (v: unknown): v is StyleRoute => ROUTE_OPTIONS.some((o) => o.value === v)

/**
 * The draft of the stored map: every catalog style, in the catalog's order (a style without an entry is the Flex way,
 * or Precise when photographic and `photographicStyles` is "precise"), then any stored entry for a style the catalog
 * lacks, by id.
 */
export function styleRoutesDraftOf(saved: NodaroMotionPreciseStyleRoute | null | undefined): Record<string, StyleRoute> {
  const stored = saved?.styleRoutes ?? {}
  const legacyPhoto = saved?.photographicStyles === "precise"
  const catalog = STYLES.map((s): [string, StyleRoute] => {
    const own = stored[s.id]
    if (isRoute(own)) return [s.id, own]
    return [s.id, legacyPhoto && getStyleMedium(s.id) === "photo" ? "precise" : "flex"]
  })
  const known = new Set(STYLES.map((s) => s.id))
  const others = Object.entries(stored)
    .filter(([id, route]) => !known.has(id) && isRoute(route))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return Object.fromEntries([...catalog, ...others])
}

/** The map as it is saved: only the styles not on the Flex way; undefined when there are none. */
export function styleRoutesToSaved(draft: Readonly<Record<string, StyleRoute>>): NodaroMotionPreciseStyleRoute["styleRoutes"] {
  const kept = Object.entries(draft).filter((e): e is [string, Exclude<StyleRoute, "flex">] => e[1] !== "flex")
  return kept.length > 0 ? Object.fromEntries(kept) : undefined
}

interface Props {
  readonly value: Readonly<Record<string, StyleRoute>>
  readonly onChange: (next: Record<string, StyleRoute>) => void
  /** Each environment's engine, as reported (unknown while loading). */
  readonly envs: readonly TrendEngineEnvironment[] | undefined
  /** The table cannot be changed (the route is off); the choices are kept. */
  readonly disabled: boolean
}

export function StyleRoutesTable({ value, onChange, envs, disabled }: Props) {
  const id = useId()
  // Only the catalog's styles count: a hidden entry for a style this build lacks is not a choice made here.
  const anyKept = STYLES.some((s) => (value[s.id] ?? "flex") !== "flex")
  const notRouting = new Set(environmentsThatCannotRoutePreciseStyle(envs) ?? [])
  const missing = anyKept ? (environmentsThatCannotRoutePerStyle(envs) ?? []).filter((env) => !notRouting.has(env)) : []
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 ps-6" disabled={disabled} aria-describedby={`${id}-hint ${id}-on-hint`}>
      <legend className="font-medium">{STYLE_ROUTES_LEGEND}</legend>
      <span id={`${id}-hint`} className="text-xs text-muted-foreground">
        {STYLE_ROUTES_HINT}
      </span>
      {GROUPS.map((g) => {
        const styles = STYLES.filter((s) => getStyleMedium(s.id) === g.medium)
        if (styles.length === 0) return null
        const groupId = `${id}-${g.medium}`
        return (
          <fieldset key={g.medium} className="flex min-w-0 flex-col gap-1 rounded-md border p-2">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.heading}</legend>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              {g.warn ? (
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">{COMES_BACK_REAL}</span>
              ) : (
                <span className="flex-1" />
              )}
              <select
                aria-label={`${g.heading}: ${SET_ALL}`}
                className="h-11 min-w-0 rounded-md border bg-background px-2 text-base sm:h-9 sm:text-sm"
                value=""
                onChange={(e) => {
                  const route = e.target.value
                  if (!isRoute(route)) return
                  onChange({ ...value, ...Object.fromEntries(styles.map((s) => [s.id, route])) })
                }}
              >
                <option value="" disabled>
                  {SET_ALL}
                </option>
                {ROUTE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
              {styles.map((s) => {
                const selectId = `${groupId}-${s.id}`
                return (
                  <div key={s.id} className="contents">
                    <label htmlFor={selectId} className="min-w-0 truncate">
                      {s.label}
                    </label>
                    <select
                      id={selectId}
                      className="h-11 min-w-0 rounded-md border bg-background px-2 text-base sm:h-9 sm:text-sm"
                      value={value[s.id] ?? "flex"}
                      onChange={(e) => {
                        const route = e.target.value
                        if (isRoute(route)) onChange({ ...value, [s.id]: route })
                      }}
                    >
                      {ROUTE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>
          </fieldset>
        )
      })}
      <span id={`${id}-on-hint`} className="text-xs text-muted-foreground">
        Applies only while the switch is On.
      </span>
      {missing.length > 0 && (
        <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {styleRoutesMissingNote(missing)}
        </span>
      )}
    </fieldset>
  )
}
