/**
 * The Lip Sync node's model-specific levers that a model may not take.
 *
 * OmniHuman 2.0 sits beside OmniHuman 1.5 but is not a superset of it: it has
 * no resolution choice (always 720p), no fast mode and no seed (decided
 * 2026-11-11). A node switched from 1.5 keeps those values in its data unless
 * something clears them, and a node written straight into workflow JSON, an
 * API body or an MCP call can carry them too. One table, read by every
 * surface: the config panel (its dropdown and fail-safe effect), the quick
 * strip's model switch, the lip-sync route and the workflow payload.
 *
 * Only models listed here lose anything: every other model's levers are left
 * exactly as they were.
 */

/** The generic levers the Lip Sync node carries beside its inputs and prompt. */
export const LIP_SYNC_MODEL_LEVERS = ["resolution", "fastMode", "seed"] as const
export type LipSyncModelLever = typeof LIP_SYNC_MODEL_LEVERS[number]

const LEVERS_NOT_TAKEN: Readonly<Record<string, readonly LipSyncModelLever[]>> = {
  "omnihuman-2-0": ["resolution", "fastMode", "seed"],
}

/** The levers `provider` does not take (none for a model this table does not list). */
export function lipSyncLeversNotTaken(provider: unknown): readonly LipSyncModelLever[] {
  return typeof provider === "string" && Object.prototype.hasOwnProperty.call(LEVERS_NOT_TAKEN, provider)
    ? LEVERS_NOT_TAKEN[provider]!
    : []
}

/** Does `provider` take this lever? */
export function lipSyncTakesLever(provider: unknown, lever: LipSyncModelLever): boolean {
  return !lipSyncLeversNotTaken(provider).includes(lever)
}

/**
 * A patch that clears every lever `provider` does not take and `data` still
 * holds (each written as `undefined`). Empty when there is nothing to clear,
 * so a caller can skip the write.
 */
export function lipSyncLeverClearPatch(
  provider: unknown,
  data: Readonly<Record<string, unknown>>,
): Partial<Record<LipSyncModelLever, undefined>> {
  const patch: Partial<Record<LipSyncModelLever, undefined>> = {}
  for (const lever of lipSyncLeversNotTaken(provider)) {
    if (data[lever] !== undefined) patch[lever] = undefined
  }
  return patch
}

/** `data` without the levers `provider` does not take: a copy when any was dropped, else `data` itself. */
export function withoutLipSyncLeversNotTaken<T extends Readonly<Record<string, unknown>>>(provider: unknown, data: T): T {
  const patch = lipSyncLeverClearPatch(provider, data)
  return Object.keys(patch).length === 0 ? data : { ...data, ...patch }
}
