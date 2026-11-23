// Admin → Video Remake, Offer Flash (the `nodaro_motion_flash_offer` setting):
// a switch per engine, off by default. While an engine's is on, EVERY user
// sees that engine's Flash choice beside it — Prism Flash beside Nodaro
// Prism, Pulse Flash beside Nodaro Pulse — at its own (lower) price, and picks
// per run; a Flash choice is the engine's run on the faster, lower-cost model
// of the same family, with that model's limits. While off, the two engines
// only.
//
// It replaces the retired admin-only flash-model test (a switch that moved
// admin accounts' runs to the Flash model behind their back): nothing reads
// that one any more, so a run's model is always the one its person picked.
//
// One of the page's settings (decided 2026-11-22): its switches change the
// page's draft, which the page's Save saves, and the stored settings sets
// save, load, export and import it (use-flash-offer-section.tsx). The server
// refuses "on" while no environment's engine runs the Flash choices, a save
// and a loaded set alike.
//
// The setting is shared by every environment on this database: the block
// names the environments whose engine reads it.

import { useId } from "react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { NodaroMotionEngine, NodaroMotionFlashOffer, NodaroMotionFlashOfferValue, NodaroMotionFlashOfferView } from "@/lib/api"

export const FLASH_OFFER_HEADING = "Offer Flash"

export const FLASH_OFFER_HINT =
  "While an engine's switch is on, every user sees its Flash choice next to it (Prism Flash beside Nodaro Prism, Pulse Flash beside Nodaro Pulse) at its own lower price, and picks it per run. A Flash run is the engine's run on the faster, lower-cost model of the same family: no 1080p, no draft and no Full Quality; Prism Flash takes at most 10 images, Pulse Flash at most 20 seconds. Off, the two engines only. Saved with the page's Save, and part of the stored settings sets."

/** Said where this environment's engine does not run the Flash choices. */
export const FLASH_OFFER_UNSUPPORTED = "This environment's engine does not run the Flash choices yet: nothing here is offered by it until it does."

/** The sentence that names where an "on" is read. */
export function flashOfferReadBy(environments: readonly string[]): string {
  return environments.length > 0
    ? `Read by: ${environments.join(", ")}. The setting is shared by every environment listed: turning a switch on offers that Flash choice to every user of each.`
    : "No environment's engine reads this yet."
}

/** The setting as it is saved: each engine that is on; one that is off is left out. A new object. */
export function flashOfferToSaved(setting: NodaroMotionFlashOffer | null | undefined): NodaroMotionFlashOffer {
  const out: NodaroMotionFlashOffer = {}
  for (const [id, value] of Object.entries(setting ?? {}) as Array<[NodaroMotionEngine, NodaroMotionFlashOfferValue | undefined]>) {
    if (value === "on") out[id] = "on"
  }
  return out
}

/** A switch's label: "Offer Prism Flash (beside Nodaro Prism)". */
export const flashOfferSwitchLabel = (engine: { name: string; flashName: string }): string => `Offer ${engine.flashName} (beside ${engine.name})`

interface Props {
  readonly view: NodaroMotionFlashOfferView
  /** The page's draft. */
  readonly value: NodaroMotionFlashOffer
  readonly onChange: (next: NodaroMotionFlashOffer) => void
  readonly saveError: unknown
  readonly headingId: string
}

export function FlashOfferSection({ view, value, onChange, saveError, headingId }: Props) {
  const id = useId()
  const hintId = `${id}-hint`
  const set = (engine: NodaroMotionEngine, on: boolean) => {
    const next: NodaroMotionFlashOffer = { ...flashOfferToSaved(value) }
    if (on) next[engine] = "on"
    else delete next[engine]
    onChange(next)
  }
  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm" aria-labelledby={headingId}>
      <p id={hintId} className="text-xs text-muted-foreground">
        {FLASH_OFFER_HINT}
      </p>
      {view.engines.map((engine) => {
        const switchId = `${id}-${engine.id}`
        return (
          <div key={engine.id} className="flex items-center justify-between gap-3">
            <Label htmlFor={switchId} className="font-medium">
              {flashOfferSwitchLabel(engine)}
            </Label>
            <Switch id={switchId} checked={value[engine.id] === "on"} onCheckedChange={(on) => set(engine.id, on)} aria-describedby={hintId} />
          </div>
        )
      })}
      <p className="text-xs text-muted-foreground">{flashOfferReadBy(view.environments)}</p>
      {!view.supported && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {FLASH_OFFER_UNSUPPORTED}
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
