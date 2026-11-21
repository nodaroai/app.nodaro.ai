// Admin → Video Remake, the shot lock (the `nodaro_motion_shot_lock`
// setting): whether the prompt of a run people start themselves carries one
// more line, which tells the engine to keep the clip's shot order and not add
// shots. Off for everything until it is turned on; there is no deployment
// default. A trend keeps its own prompt, and a 3D previz run never carries
// the line.
//
// Per engine, a switch per RUN TYPE:
// - Ordinary run: no art style;
// - Art style + roles: an art style on any run that is not style-only;
// - Art style alone: a style-only run (an art style and nothing to swap).
// And "Except styles": art styles (from the style catalog's video list, or
// "Custom style" for people's own words) whose own on/off wins over the run
// type's switch. An engine that takes no art style (Pulse) has the first
// switch alone; the other two rows read "n/a" and nothing is stored for them.
//
// The value of before run types, "on", is Ordinary run and Art style + roles
// on: it is shown so, and a draft that says exactly that is saved as "on"
// again (`shotLockToSaved`, the server's own stored form).
//
// Run types are read only by an engine that says so. While NO environment's
// engine does (`runTypes.offered` false), the two first switches move
// together (all "on" can say) and the rest is disabled, with the reason; once
// one does, everything is offered and a note names the environments where an
// entry by run type is not read yet (off there). The server refuses what
// nothing would read.
//
// Where this environment's engine does not write the line (`supported`
// false), the switches say that nothing reads them here yet.

import { useId } from "react"
import { STYLES, stylesForMedia } from "@nodaro/prompts/pickers"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { NodaroMotionEngine, NodaroMotionShotLock, NodaroMotionShotLockByRunType, NodaroMotionShotLockEntry, NodaroMotionShotLockValue, NodaroMotionShotLockView } from "@/lib/api"

export const SHOT_LOCK_HEADING = "Shot lock"

export const SHOT_LOCK_HINT =
  "Adds a line to the prompt that tells the engine to keep the clip's shot order and not add shots. Off by default, for runs people start themselves; set it per kind of run. Trends keep their own prompt, and a 3D previz run never carries the line."

/** The run types, in the order they are shown, each with its label and what it is. */
export const SHOT_LOCK_RUN_TYPES = [
  { key: "ordinary", label: "Ordinary run", hint: "A run with no art style." },
  { key: "styleWithRoles", label: "Art style + roles", hint: "A run with an art style together with roles or references: any art-style run that is not made style-only." },
  {
    key: "styleAlone",
    label: "Art style alone",
    hint: "A style-only run: an art style and nothing to swap, the clip itself restyled. New: the line was never sent on such a run before.",
  },
] as const
export type ShotLockRunType = (typeof SHOT_LOCK_RUN_TYPES)[number]["key"]

export const SHOT_LOCK_EXCEPTIONS_LABEL = "Except styles"
export const SHOT_LOCK_EXCEPTIONS_HINT = "A style listed here follows its own switch on every run with that style, whatever the two art-style rows say."
export const SHOT_LOCK_ADD_STYLE = "Add a style…"
/** The exceptions' key for a custom style (people's own words), and its name in the list. */
export const SHOT_LOCK_CUSTOM_STYLE = "custom"
export const SHOT_LOCK_CUSTOM_STYLE_LABEL = "Custom style (people's own words)"
/** What an art-style row reads on an engine that takes no art style. */
export const SHOT_LOCK_NOT_APPLICABLE = "n/a"
export const shotLockNoStyleHint = (engine: string) => `${engine} takes no art style.`

/** Said where this environment's engine does not write the line. */
export const SHOT_LOCK_UNSUPPORTED = "This environment's engine does not write the shot lock yet: nothing here is read until it does."
/** Said while no environment's engine reads the setting by run type. */
export const SHOT_LOCK_RUN_TYPES_UNOFFERED =
  "No environment's engine reads the shot lock by run type yet: Ordinary run and Art style + roles switch together, and the rest waits for the engine."
/** Said once some environment's engine does, for the ones that do not. */
export const shotLockRunTypesMissing = (envs: readonly string[]) =>
  `Not read by run type yet in: ${envs.join(", ")}. There the line is written only while Ordinary run and Art style + roles are both on with nothing else set; any other choice is off there.`

/** The engines that take an art style: only they have the two art-style rows and the exceptions (the server's own list). */
export const SHOT_LOCK_STYLE_ENGINES: readonly NodaroMotionEngine[] = ["nodaro-prism"]
const takesStyle = (engine: NodaroMotionEngine) => SHOT_LOCK_STYLE_ENGINES.includes(engine)

/** One engine's entry read whole: every switch said, the exceptions as listed. "on" is Ordinary run and Art style + roles. */
export interface ShotLockResolved {
  ordinary: boolean
  styleWithRoles: boolean
  styleAlone: boolean
  styles: Record<string, NodaroMotionShotLockValue>
}

export function shotLockResolved(entry: NodaroMotionShotLockEntry | undefined, engine: NodaroMotionEngine): ShotLockResolved {
  const style = takesStyle(engine)
  if (entry === "on") return { ordinary: true, styleWithRoles: style, styleAlone: false, styles: {} }
  if (!entry || typeof entry !== "object") return { ordinary: false, styleWithRoles: false, styleAlone: false, styles: {} }
  return {
    ordinary: entry.ordinary === "on",
    styleWithRoles: style && entry.styleWithRoles === "on",
    styleAlone: style && entry.styleAlone === "on",
    styles: style ? { ...(entry.styles ?? {}) } : {},
  }
}

const onOff = (on: boolean): NodaroMotionShotLockValue => (on ? "on" : "off")

/** A draft entry that says all of `r` (every switch written out), for the section to edit. */
function draftEntryOf(r: ShotLockResolved): NodaroMotionShotLockByRunType {
  return { ordinary: onOff(r.ordinary), styleWithRoles: onOff(r.styleWithRoles), styleAlone: onOff(r.styleAlone), styles: r.styles }
}

/**
 * The setting as it is saved (the server's own stored form): only the engines that turn something on; a switch that
 * is off left out; an entry that says exactly what "on" says (Ordinary run and Art style + roles, nothing else) as
 * "on"; an engine that takes no art style "on" or nothing. A new object.
 */
export function shotLockToSaved(draft: NodaroMotionShotLock | null | undefined): NodaroMotionShotLock {
  const out: NodaroMotionShotLock = {}
  // In the engines' own order, so two drafts that say the same read the same.
  for (const engine of (Object.keys(draft ?? {}) as NodaroMotionEngine[]).sort()) {
    const r = shotLockResolved(draft?.[engine], engine)
    const exceptions = Object.keys(r.styles).length > 0
    if (!r.ordinary && !r.styleWithRoles && !r.styleAlone && !Object.values(r.styles).includes("on")) continue
    if (!takesStyle(engine) || (r.ordinary && r.styleWithRoles && !r.styleAlone && !exceptions)) {
      out[engine] = "on"
      continue
    }
    out[engine] = {
      ...(r.ordinary ? { ordinary: "on" as const } : {}),
      ...(r.styleWithRoles ? { styleWithRoles: "on" as const } : {}),
      ...(r.styleAlone ? { styleAlone: "on" as const } : {}),
      ...(exceptions ? { styles: { ...r.styles } } : {}),
    }
  }
  return out
}

/** The styles an exception may name, in the catalog's order (the list a video style picker shows), then the custom style. */
export function shotLockStyleOptions(): Array<{ id: string; label: string }> {
  return [...stylesForMedia(STYLES, "video").map((s) => ({ id: s.id, label: s.label })), { id: SHOT_LOCK_CUSTOM_STYLE, label: SHOT_LOCK_CUSTOM_STYLE_LABEL }]
}

/** A style's name in the exceptions list: its catalog label, the custom style's, or its id when this build's catalog lacks it. */
export function shotLockStyleLabel(id: string): string {
  return shotLockStyleOptions().find((o) => o.id === id)?.label ?? id
}

interface Props {
  /** The live setting (its GET), with the engines it lists. */
  readonly view: NodaroMotionShotLockView
  /** The draft: one entry per engine, in either shape. */
  readonly value: NodaroMotionShotLock
  readonly onChange: (next: NodaroMotionShotLock) => void
  /** The last save's refusal, said under the switches. */
  readonly saveError: unknown
}

export function ShotLockSection({ view, value, onChange, saveError }: Props) {
  const id = useId()
  const hintId = `${id}-hint`
  const offered = view.runTypes?.offered === true
  const missingIn = view.runTypes?.missingIn ?? []
  const options = shotLockStyleOptions()

  const write = (engine: NodaroMotionEngine, entry: NodaroMotionShotLockEntry | undefined) => {
    const out: NodaroMotionShotLock = { ...value }
    if (entry === undefined) delete out[engine]
    else out[engine] = entry
    onChange(out)
  }
  const setType = (engine: NodaroMotionEngine, type: ShotLockRunType, on: boolean) => {
    // Until an engine reads run types, the setting is the value of before them: the first two rows together.
    if (!offered) return write(engine, on ? "on" : undefined)
    write(engine, draftEntryOf({ ...shotLockResolved(value[engine], engine), [type]: on }))
  }
  const setStyle = (engine: NodaroMotionEngine, style: string, to: NodaroMotionShotLockValue | null) => {
    const r = shotLockResolved(value[engine], engine)
    const styles = { ...r.styles }
    if (to === null) delete styles[style]
    else styles[style] = to
    write(engine, draftEntryOf({ ...r, styles }))
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 text-sm" data-testid="shot-lock">
      <p id={hintId} className="text-xs text-muted-foreground">
        {SHOT_LOCK_HINT}
      </p>
      {view.engines.map((engine) => {
        const r = shotLockResolved(value[engine.id], engine.id)
        const style = takesStyle(engine.id)
        const listed = Object.keys(r.styles)
        const addId = `${id}-${engine.id}-add`
        return (
          <fieldset key={engine.id} className="flex min-w-0 flex-col gap-2 rounded-md border p-3" aria-describedby={hintId}>
            <legend className="px-1 font-medium">{engine.name}</legend>
            {SHOT_LOCK_RUN_TYPES.map((type) => {
              const switchId = `${id}-${engine.id}-${type.key}`
              const typeHintId = `${switchId}-hint`
              const applies = type.key === "ordinary" || style
              // Without an engine that reads run types, only the first row is a control (it moves the second with it).
              const disabled = !offered && type.key !== "ordinary"
              return (
                <div key={type.key} className="flex min-w-0 items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <Label htmlFor={applies ? switchId : undefined} className="font-normal">
                      {type.label}
                    </Label>
                    <span id={typeHintId} className="text-xs text-muted-foreground">
                      {applies ? type.hint : shotLockNoStyleHint(engine.name)}
                    </span>
                  </div>
                  {applies ? (
                    <Switch
                      id={switchId}
                      aria-label={`${engine.name} ${type.label}`}
                      aria-describedby={typeHintId}
                      checked={r[type.key]}
                      disabled={disabled}
                      onCheckedChange={(on) => setType(engine.id, type.key, on)}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground" data-testid={`shot-lock-${engine.id}-${type.key}-na`}>
                      {SHOT_LOCK_NOT_APPLICABLE}
                    </span>
                  )}
                </div>
              )
            })}
            {style && (
              <div role="group" aria-label={`${engine.name} ${SHOT_LOCK_EXCEPTIONS_LABEL}`} className="flex min-w-0 flex-col gap-2 border-t pt-2">
                <span className="font-normal">{SHOT_LOCK_EXCEPTIONS_LABEL}</span>
                <span className="text-xs text-muted-foreground">{SHOT_LOCK_EXCEPTIONS_HINT}</span>
                {listed.length > 0 && (
                  <ul className="flex min-w-0 flex-col gap-1">
                    {listed.map((styleId) => {
                      const label = shotLockStyleLabel(styleId)
                      const exceptionId = `${id}-${engine.id}-style-${styleId}`
                      return (
                        <li key={styleId} className="flex min-w-0 items-center justify-between gap-2">
                          <Label htmlFor={exceptionId} className="min-w-0 truncate font-normal">
                            {label}
                          </Label>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="text-xs text-muted-foreground" aria-hidden="true">
                              {r.styles[styleId]}
                            </span>
                            <Switch
                              id={exceptionId}
                              aria-label={`${engine.name} ${SHOT_LOCK_EXCEPTIONS_LABEL}: ${label}`}
                              checked={r.styles[styleId] === "on"}
                              disabled={!offered}
                              onCheckedChange={(on) => setStyle(engine.id, styleId, onOff(on))}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-11 px-2 text-xs sm:h-9"
                              aria-label={`Remove ${label} from ${engine.name}'s ${SHOT_LOCK_EXCEPTIONS_LABEL.toLowerCase()}`}
                              onClick={() => setStyle(engine.id, styleId, null)}
                            >
                              Remove
                            </Button>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
                <label htmlFor={addId} className="sr-only">
                  {`${engine.name}: ${SHOT_LOCK_ADD_STYLE}`}
                </label>
                <select
                  id={addId}
                  className="h-11 min-w-0 rounded-md border bg-background px-2 text-base sm:h-9 sm:text-sm"
                  value=""
                  disabled={!offered}
                  onChange={(e) => {
                    // A style joins the list off: the line is left out for it until its own switch is turned on.
                    if (e.target.value) setStyle(engine.id, e.target.value, "off")
                  }}
                >
                  <option value="">{SHOT_LOCK_ADD_STYLE}</option>
                  {options
                    .filter((o) => !listed.includes(o.id))
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </fieldset>
        )
      })}
      {!view.supported && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {SHOT_LOCK_UNSUPPORTED}
        </p>
      )}
      {view.supported && !offered && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {SHOT_LOCK_RUN_TYPES_UNOFFERED}
        </p>
      )}
      {offered && missingIn.length > 0 && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {shotLockRunTypesMissing(missingIn)}
        </p>
      )}
      {saveError instanceof Error && (
        <p role="alert" className="text-xs text-destructive">
          {saveError.message}
        </p>
      )}
    </div>
  )
}
