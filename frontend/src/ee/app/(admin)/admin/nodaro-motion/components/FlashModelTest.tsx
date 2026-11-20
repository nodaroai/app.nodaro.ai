// Admin → Video Remake, the flash-model test (the `nodaro_motion_flash_model`
// setting): a test switch per engine, off by default. While an engine's is
// on, a new run of that engine STARTED BY AN ADMIN ACCOUNT is made on the
// faster, lower-cost model of the same family instead of the engine's own, so
// the two can be compared on the same pipeline. Every other account's runs
// are unchanged: the server reads the account's role itself.
//
// It is kept apart from the page's settings on purpose: its block is closed
// until opened (nothing is read before), each switch saves by itself (it is
// not part of the page's Save), and it is not one of the settings a stored
// settings set holds, so loading a set never turns a test on.
//
// The setting is shared by every environment on this database: the block
// names the environments whose engine reads it. The server refuses "on"
// while no environment's engine does.

import { useId, useState } from "react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useNodaroMotionFlashModel, useSaveNodaroMotionFlashModel } from "@/ee/hooks/queries/use-nodaro-motion-flash-model"
import type { NodaroMotionEngine, NodaroMotionFlashModel, NodaroMotionFlashModelValue } from "@/lib/api"

export const FLASH_MODEL_TEST_HEADING = "Test switches"
export const FLASH_MODEL_TEST_NAME = "Flash model test"

export const FLASH_MODEL_TEST_HINT =
  "For testing only. It affects only runs started by admin accounts: while an engine's switch is on, a new run of that engine by an admin account is made on the faster, lower-cost model of the same family instead of the engine's own. Everyone else's runs are unchanged. An admin's run that model cannot take is refused, and such a run has no Full Quality. A switch saves as soon as it is changed: turn it off when the test is done."

/** Said where this environment's engine does not run the test. */
export const FLASH_MODEL_TEST_UNSUPPORTED = "This environment's engine does not run this test yet: nothing here is read by it until it does."

/** The sentence that names where an "on" is read. */
export function flashModelTestReadBy(environments: readonly string[]): string {
  return environments.length > 0 ? `Read by: ${environments.join(", ")}. The setting is shared by every environment listed, for admin accounts' runs in each.` : "No environment's engine reads this yet."
}

/** The setting as it is saved: each engine that is on; one that is off is left out. A new object. */
export function flashModelToSaved(setting: NodaroMotionFlashModel | null | undefined): NodaroMotionFlashModel {
  const out: NodaroMotionFlashModel = {}
  for (const [id, value] of Object.entries(setting ?? {}) as Array<[NodaroMotionEngine, NodaroMotionFlashModelValue | undefined]>) {
    if (value === "on") out[id] = "on"
  }
  return out
}

export function FlashModelTest() {
  const id = useId()
  const panelId = `${id}-panel`
  const hintId = `${id}-hint`
  const [open, setOpen] = useState(false)
  const query = useNodaroMotionFlashModel(open)
  const save = useSaveNodaroMotionFlashModel()
  const stored = flashModelToSaved(query.data?.flashModel)

  const set = (engine: NodaroMotionEngine, on: boolean) => {
    const next: NodaroMotionFlashModel = { ...stored }
    if (on) next[engine] = "on"
    else delete next[engine]
    save.mutate(next)
  }

  return (
    <div className="mt-8 rounded-lg border border-dashed p-4" data-testid="flash-model-test">
      <button type="button" className="text-sm font-semibold underline-offset-2 hover:underline" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
        {FLASH_MODEL_TEST_HEADING}
      </button>
      {open && (
        <div id={panelId} role="group" aria-label={FLASH_MODEL_TEST_NAME} className="mt-3 flex min-w-0 flex-col gap-3 text-sm">
          <h2 className="text-base font-semibold">{FLASH_MODEL_TEST_NAME}</h2>
          <p id={hintId} className="text-xs text-muted-foreground">
            {FLASH_MODEL_TEST_HINT}
          </p>
          {query.data ? (
            <>
              {query.data.engines.map((engine) => {
                const switchId = `${id}-${engine.id}`
                return (
                  <div key={engine.id} className="flex items-center justify-between gap-3">
                    <Label htmlFor={switchId} className="font-medium">
                      {engine.name}
                    </Label>
                    <Switch id={switchId} checked={stored[engine.id] === "on"} disabled={save.isPending} onCheckedChange={(on) => set(engine.id, on)} aria-describedby={hintId} />
                  </div>
                )
              })}
              <p className="text-xs text-muted-foreground">{flashModelTestReadBy(query.data.environments)}</p>
              {!query.data.supported && (
                <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
                  {FLASH_MODEL_TEST_UNSUPPORTED}
                </p>
              )}
            </>
          ) : query.error ? (
            <p className="text-xs text-destructive">{query.error.message}</p>
          ) : (
            <p className="text-xs text-muted-foreground">Loading…</p>
          )}
          {save.error instanceof Error && (
            <p role="alert" className="text-xs text-destructive">
              {save.error.message}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
