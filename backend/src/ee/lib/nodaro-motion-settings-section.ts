/**
 * One setting on the Admin → Nodaro Motion page, as the stored settings sets
 * (`admin-nodaro-motion-settings-sets.ts`) see it: the body its save route
 * takes, and the parts of that route's save that read no other setting.
 *
 * Each section is declared by its own route module, beside the PUT it
 * describes, and that PUT runs through the same `body`, `prepare` and
 * `engineRefusal`: a stored set, an imported file and a save are checked by
 * ONE implementation. What a section leaves to its route alone is what needs
 * the request and the other settings (the engine's prompt checks); those are
 * met when the set is saved, through the route.
 *
 * `NODARO_MOTION_SETTINGS_SECTIONS` (admin-nodaro-motion.ts) lists them, and
 * `nodaro-motion-settings-sections.test.ts` fails when a Nodaro Motion admin
 * route saves something that list does not include.
 */
import type { z } from "zod"

/** A save refused before anything is written: the status and the `error` body the route answers. */
export interface NodaroMotionSaveRefusal {
  status: number
  error: {
    code: string
    message: string
    /** Each problem of a 400, at its path in the body. */
    issues?: ReadonlyArray<{ path: string; message: string }>
    /** The environments whose engine (or platform) a 409 or 422 waits for. */
    envs?: readonly string[]
  }
}

export interface NodaroMotionSettingsSection<B> {
  /** The section's id in a stored set and in an exported file (never renamed: older files name it). */
  key: string
  /** The route that saves it (PUT) and reads it (GET). */
  path: string
  /** What the admin page calls it, for the lists of problems and results. */
  label: string
  /** The PUT's body: the very schema the route parses. */
  body: z.ZodType<B>
  /**
   * The body as the route stores it (its own rewrites: defaults left out, canonical forms), or the route's own 400
   * after the body parsed (a value the store would never hold). Reads nothing. A new object.
   */
  prepare(body: B): { value: B } | { refusal: NodaroMotionSaveRefusal }
  /**
   * The route's refusal for the environments' engines (409 `engine_unsupported`, a 422 platform hold, a 503 for this
   * environment's engine), the first one, or null. `before` is the stored body (null: never saved). Writes nothing.
   */
  engineRefusal?(value: B, before: B | null): Promise<NodaroMotionSaveRefusal | null>
  /** The stored setting as the PUT's body, read fresh; null = never saved. */
  readLive(): Promise<B | null>
  /**
   * Fields of the body that hold people's data (dot paths), left out of an exported file (which names them in its
   * `omitted`). Loading such a file keeps the live value of each, so saving it never clears them.
   */
  privateFields?: readonly string[]
}

/** A section with its body's type forgotten: what the list of every section holds. */
export type AnyNodaroMotionSettingsSection = NodaroMotionSettingsSection<unknown>

/** Declare a section, typed against its own body (the list of every section holds it as `AnyNodaroMotionSettingsSection`). */
export function defineNodaroMotionSettingsSection<B>(section: NodaroMotionSettingsSection<B>): NodaroMotionSettingsSection<B> {
  return section
}

/** The route's answer to a refusal. */
export function sendRefusal(reply: { status(code: number): { send(body: unknown): unknown } }, refusal: NodaroMotionSaveRefusal) {
  return reply.status(refusal.status).send({ error: refusal.error })
}
