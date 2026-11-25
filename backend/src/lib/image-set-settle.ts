/**
 * Settling a SET of images (Kling Image 4.0's series mode): one job asks the
 * provider for 2 to 10 images and is held at the row for the images it asked
 * (`…:x<C>`, `klingImage4CreditId`). It is charged for the images it really
 * stored: the same row with that many images (`:x<N>`, no suffix for one).
 * The Split into Layers precedent: hold for the most, settle on what returned,
 * reading the ROW (`creditIdBaseCredits`) so an administrator's reprice holds
 * for both.
 *
 * The held id is recorded on the job when it is planned (`input_data.
 * setHoldCreditId`: the route's planner and the workflow payload builder), so
 * the worker, the reconcile cron and a held job's approve replay all settle
 * from the row, never from a request rebuilt later.
 */
import { creditIdBaseCredits } from "./credit-id-base.js"

const SET_SUFFIX = /:x(\d+)$/

/**
 * The id a set settles on when it stored `imagesStored` images, or `undefined`
 * when it commits its hold: not a set, nothing stored, or at least the images
 * it asked for (a provider that returns more is never charged above the hold).
 */
export function imageSetSettledCreditId(heldId: unknown, imagesStored: number): string | undefined {
  if (typeof heldId !== "string") return undefined
  const m = SET_SUFFIX.exec(heldId)
  if (!m) return undefined
  const asked = Number(m[1])
  const stored = Math.trunc(imagesStored)
  if (!Number.isFinite(stored) || stored < 1 || stored >= asked) return undefined
  const base = heldId.slice(0, m.index)
  return stored === 1 ? base : `${base}:x${stored}`
}

/**
 * The BASE credits a set job settles at, from its recorded hold and the images
 * it stored, or `undefined` (commit the hold; community and business have no
 * credits). Handed to the commit as `meteredBaseCredits`.
 */
export async function imageSetSettledBase(
  inputData: Record<string, unknown> | null | undefined,
  imagesStored: number,
): Promise<number | undefined> {
  const settled = imageSetSettledCreditId(inputData?.setHoldCreditId, imagesStored)
  if (settled === undefined) return undefined
  console.warn(`[image-set-settle] a set held at ${String(inputData?.setHoldCreditId)} stored ${imagesStored} image(s): settling at ${settled}`)
  return creditIdBaseCredits(settled)
}
