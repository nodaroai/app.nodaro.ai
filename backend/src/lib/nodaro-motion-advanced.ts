/**
 * Whether a Nodaro Motion page shows its Advanced options — Prepare
 * references and the pre-prompt (`prepareReferences`, `prePrompt`). One
 * switch for the whole page, not per engine. Set by an admin for the whole
 * deployment, never by the person running it.
 *
 * The `app_settings` row `nodaro_motion_advanced`: `{ "show": boolean }`.
 *
 * - No row, or a value this app does not know: `{ show: false }`, the
 *   options hidden.
 * - `{ show: true }`: a page shows them.
 *
 * A page option only. Nothing about a run or a quote reads it: the API, the
 * SDK and MCP take `prepareReferences` and `prePrompt` exactly as before,
 * whatever it says, and no engine is told about it. Who reads it: the public
 * `GET /v1/cast-swap/advanced` (ee/routes/cast-swap-advanced.ts), through the
 * settings cache. Written only by `PUT /v1/admin/nodaro-motion/advanced`
 * (ee/routes), through `nodaro-motion-advanced-store.ts`. This module is pure
 * (no database).
 */
import { z } from "zod"

export const NODARO_MOTION_ADVANCED_KEY = "nodaro_motion_advanced"

/** The saved setting: whether a Nodaro Motion page shows its Advanced options. */
export interface NodaroMotionAdvanced {
  show: boolean
}

/** What an admin saves: strict (one boolean; a missing, mistyped or extra key is refused). */
export const nodaroMotionAdvancedSchema: z.ZodType<NodaroMotionAdvanced> = z.strictObject({ show: z.boolean() })

/** The stored row's read: a key this app does not know yet is left out, the switch kept. */
const storedSchema = z.object({ show: z.boolean() })

/**
 * The tolerant read of the stored row: `{ show }` when it holds a boolean
 * `show`, else null (read as never saved: hidden) with a warning.
 */
export function parseNodaroMotionAdvanced(
  value: unknown,
  warn: (msg: string) => void = (msg) => console.warn(msg),
): NodaroMotionAdvanced | null {
  const parsed = storedSchema.safeParse(value)
  if (parsed.success) return { show: parsed.data.show }
  warn(`[${NODARO_MOTION_ADVANCED_KEY}] not { show: boolean }; read as never saved (hidden)`)
  return null
}

/** What clients are answered (a new object): shown only once an admin saved `show: true`. */
export function advancedShown(setting: NodaroMotionAdvanced | null | undefined): NodaroMotionAdvanced {
  return { show: setting?.show === true }
}
