// Admin → Nodaro Motion → the Precise art-style route's per-style table
// (`styleRoutes` of `nodaro_motion_precise_style_route`): how a Precise run
// with each art style is made while the route is on — the Flex way (the
// default, never saved), Precise, or Precise in black and white
// ("precise-gray"). One select per style a video style list shows
// (`stylesForMedia(STYLES, "video")`), grouped by its medium
// (`getStyleMedium`), each group with a "Set all to…" menu of its own: an
// action, so moving through it changes nothing until an item is chosen.
//
// The draft holds every such style, and also any stored entry for a style
// this build's catalog lacks (environments share the row but may run another
// catalog): it is not shown, and saved back as it was. The older
// `photographicStyles: "precise"` reads as Precise for the photographic styles
// without an entry of their own; it is never saved again.
//
// An environment routes by the map only when its engine declares
// `castSwap.preciseStyleRoutePerStyle` and its platform claims it; nothing
// waits for one, and a note names those that route (`castSwap.preciseStyleRoute`)
// but not yet per style. Their engine ignores the map: every style is made the
// Flex way there, except that, while every Filmed style is Precise in the
// draft, one that takes the photographic path (`preciseStyleRoutePhotographic`,
// engine and platform) and whose platform claims the Filmed fallback
// (`preciseStyleRouteFilmedFallback`: it sends the photographic path in the
// map's place, backend `styleRoutesForEngine`) makes its Filmed styles
// Precise; the note says which. One that does not route at all has the
// column's own note (its runs stay Precise).

import { useId } from "react"
import { ChevronDown } from "lucide-react"
import { STYLES, getStyleMedium, stylesForMedia, type StyleMedium } from "@nodaro/prompts/pickers"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { NodaroMotionPreciseStyleRoute, TrendEngineEnvironment } from "@/lib/api"
import { environmentsThatCannotRoutePreciseStyle, environmentsThatCannotRouteStyles, environmentsThatCannotSendFilmedFallback } from "../../trends/clip-preparation"

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

/**
 * The groups, one per medium of the catalog (a new medium fails typecheck here), in this order, with their headings;
 * drawn and rendered styles come back real on the Precise route.
 */
const GROUPS = {
  "2d": { heading: "Drawn", warn: true },
  "3d": { heading: "Rendered", warn: true },
  photo: { heading: "Filmed", warn: false },
} as const satisfies Record<StyleMedium, { readonly heading: string; readonly warn: boolean }>

/** The order the groups are shown in: the order they are written in above. */
const GROUP_MEDIUMS = Object.keys(GROUPS) as StyleMedium[]

/** The styles a video style list shows, in catalog order: what the table lists. A new array. */
function tableStyles() {
  return stylesForMedia(STYLES, "video")
}

/** The styles of one group, in catalog order. A new array. */
function stylesOfMedium(medium: StyleMedium) {
  return tableStyles().filter((s) => getStyleMedium(s.id) === medium)
}

/**
 * The Filmed styles' ids, in catalog order: the Filmed group's styles. The same expression as the backend's
 * `filmedStyleIds` (lib/nodaro-motion-precise-style-route-engine.ts), which answers an engine that cannot route per style;
 * a test on each side pins both to one list. A new array.
 */
export function filmedStyleIds(): string[] {
  return stylesOfMedium("photo").map((s) => s.id)
}

/** Whether every Filmed style is "precise" in the draft ("precise-gray" is not): what an engine that cannot route per style can still be told. */
export function everyFilmedStylePrecise(draft: Readonly<Record<string, StyleRoute>>): boolean {
  const filmed = filmedStyleIds()
  return filmed.length > 0 && filmed.every((id) => draft[id] === "precise")
}

/** Said when some visible style is not the Flex way and some environments that route do not route per style, nor are told the photographic path. */
export function styleRoutesMissingNote(missing: readonly string[]): string {
  return `${missing.join(", ")} cannot route per style yet; there every style is made the Flex way.`
}

/** Said, while every Filmed style is Precise, for the environments that route but not per style, take the photographic path, and whose platform sends it in the map's place. */
export function styleRoutesFilmedPreciseNote(missing: readonly string[]): string {
  return `${missing.join(", ")} cannot route per style yet; there the Filmed styles are made Precise and every other style the Flex way.`
}

const isRoute = (v: unknown): v is StyleRoute => ROUTE_OPTIONS.some((o) => o.value === v)

/**
 * The draft of the stored map: every style the table lists, in the catalog's order (a style without an entry is the
 * Flex way, or Precise when photographic and `photographicStyles` is "precise"), then any stored entry for a style the
 * table lacks, by id.
 */
export function styleRoutesDraftOf(saved: NodaroMotionPreciseStyleRoute | null | undefined): Record<string, StyleRoute> {
  const stored = saved?.styleRoutes ?? {}
  const legacyPhoto = saved?.photographicStyles === "precise"
  const listed = tableStyles()
  const catalog = listed.map((s): [string, StyleRoute] => {
    const own = stored[s.id]
    if (isRoute(own)) return [s.id, own]
    return [s.id, legacyPhoto && getStyleMedium(s.id) === "photo" ? "precise" : "flex"]
  })
  const known = new Set(listed.map((s) => s.id))
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
  // Only the listed styles count: a hidden entry for a style this build lacks is not a choice made here.
  const anyKept = tableStyles().some((s) => (value[s.id] ?? "flex") !== "flex")
  const notRouting = new Set(environmentsThatCannotRoutePreciseStyle(envs) ?? [])
  const cannotPerStyle = anyKept ? (environmentsThatCannotRouteStyles(envs, "preciseStyleRoutePerStyle") ?? []).filter((env) => !notRouting.has(env)) : []
  // The Filmed note needs the photographic path (engine and platform) AND a platform that sends it in the map's place.
  const noPhotographic = new Set(environmentsThatCannotRouteStyles(envs, "preciseStyleRoutePhotographic") ?? [])
  const noFallback = new Set(environmentsThatCannotSendFilmedFallback(envs) ?? [])
  const filmedPrecise = everyFilmedStylePrecise(value) ? cannotPerStyle.filter((env) => !noPhotographic.has(env) && !noFallback.has(env)) : []
  const everyFlex = cannotPerStyle.filter((env) => !filmedPrecise.includes(env))
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 ps-6" disabled={disabled} aria-describedby={`${id}-hint ${id}-on-hint`}>
      <legend className="font-medium">{STYLE_ROUTES_LEGEND}</legend>
      <span id={`${id}-hint`} className="text-xs text-muted-foreground">
        {STYLE_ROUTES_HINT}
      </span>
      {GROUP_MEDIUMS.map((medium) => {
        const g = GROUPS[medium]
        const styles = stylesOfMedium(medium)
        if (styles.length === 0) return null
        const groupId = `${id}-${medium}`
        return (
          <fieldset key={medium} className="flex min-w-0 flex-col gap-1 rounded-md border p-2">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.heading}</legend>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              {g.warn ? (
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">{COMES_BACK_REAL}</span>
              ) : (
                <span className="flex-1" />
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild disabled={disabled}>
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={`${g.heading}: ${SET_ALL}`}
                    className="h-11 min-w-0 px-2 text-base font-normal sm:h-9 sm:text-sm"
                  >
                    {SET_ALL}
                    <ChevronDown aria-hidden="true" className="opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {ROUTE_OPTIONS.map((o) => (
                    <DropdownMenuItem key={o.value} onSelect={() => onChange({ ...value, ...Object.fromEntries(styles.map((s) => [s.id, o.value])) })}>
                      {o.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
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
      {filmedPrecise.length > 0 && (
        <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {styleRoutesFilmedPreciseNote(filmedPrecise)}
        </span>
      )}
      {everyFlex.length > 0 && (
        <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {styleRoutesMissingNote(everyFlex)}
        </span>
      )}
    </fieldset>
  )
}
