import {
  freeVideoDurationLock,
  freeVideoModelLock,
  freeVideoResolutionLock,
  nodeModelLevers,
  type FreeVideoLimits,
  type FreeVideoLock,
  type FreeVideoModelLockOptions,
} from "@nodaro/render-rules"
import { tx } from "@/lib/i18n"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { getCachedUserId } from "@/hooks/use-auth"
import type { UserBalance } from "@/lib/api"

/**
 * The editor's half of the free-credit video limits: which video options to
 * LOCK (shown greyed, with the reason, never removed and never snapped) for an
 * account that never paid. The rule is `@nodaro/render-rules`, the same
 * function the server's credit preflight refuses with, so a locked option is
 * exactly an option the server would refuse.
 *
 * Whether the limits apply comes from the server: the balance carries
 * `freeVideoLimits` only for an account they apply to. Null = no locks.
 */
export type { FreeVideoLimits }

/** UI provider values that differ from the catalog id the rule reads. */
const UI_TO_CATALOG: Readonly<Record<string, string>> = { topaz: "topaz-video" }

function catalogId(provider: string): string {
  return UI_TO_CATALOG[provider] ?? provider
}

/** The limits as last read with the balance (no fetch). For non-React option builders. */
export function cachedFreeVideoLimits(): FreeVideoLimits | null {
  const userId = getCachedUserId()
  if (!userId) return null
  const balance = queryClient.getQueryData<UserBalance>(queryKeys.credits.balance(userId))
  return balance?.freeVideoLimits ?? null
}

/** The reason a lock shows, in the interface language. */
export function freeVideoLockText(lock: FreeVideoLock): string {
  switch (lock.kind) {
    case "model":
      return tx("vidcfg.freeLockModel")
    case "upscale":
      return tx("vidcfg.freeLockUpscale")
    case "extend":
      return tx("vidcfg.freeLockExtend")
    case "shortest":
      return tx("vidcfg.freeLockShortest", { max: lock.max, shortest: lock.shortest })
    case "auto":
      return tx("vidcfg.freeLockAuto", { max: lock.max })
    case "duration":
      return tx("vidcfg.freeLockDuration", { max: lock.max })
    case "resolution":
      return tx("vidcfg.freeLockResolution", { lowest: lock.lowest })
    case "size":
      return tx("vidcfg.freeLockSize")
  }
}

/**
 * Why a video MODEL option is locked, or null. `opts`: how the option runs,
 * where its id cannot say it — a menu's lever carries it (`lockAs`: every
 * Extend Video row is an extension).
 */
export function lockedVideoModel(limits: FreeVideoLimits | null, provider: string | undefined, opts?: FreeVideoModelLockOptions): string | null {
  if (!limits || !provider) return null
  const lock = freeVideoModelLock(catalogId(provider), limits, opts)
  return lock ? freeVideoLockText(lock) : null
}

/**
 * How an Extend Video model row is judged: as an extension, whatever its model
 * — its menu lever says so (`lockAs`, `@nodaro/render-rules`), the one the
 * server's new-node judge reads too, so LTX 2.3 Pro (which extends under its
 * generation id) is locked on every editor surface exactly as the server
 * refuses it. Pass it to {@link lockedVideoModel} for an Extend Video row.
 */
export const EXTEND_VIDEO_ROW_LOCK: FreeVideoModelLockOptions | undefined =
  nodeModelLevers("extend-video").find((lever) => lever.field === "provider")?.lockAs

/** Why a DURATION option of this model is locked, or null. */
export function lockedVideoDuration(limits: FreeVideoLimits | null, provider: string | undefined, duration: number | string | undefined): string | null {
  if (!limits || !provider || duration === undefined || duration === "") return null
  const lock = freeVideoDurationLock(catalogId(provider), duration, limits)
  return lock ? freeVideoLockText(lock) : null
}

/** Why a RESOLUTION option of this model is locked, or null. */
export function lockedVideoResolution(limits: FreeVideoLimits | null, provider: string | undefined, resolution: string | undefined): string | null {
  if (!limits || !provider || !resolution) return null
  const lock = freeVideoResolutionLock(catalogId(provider), resolution, limits)
  return lock ? freeVideoLockText(lock) : null
}

/**
 * The value a panel's fail-safe should WRITE when it has to pick one (a
 * provider switch, an unset default): the first candidate the limits leave
 * open, else the first candidate. Without it a fail-safe stored a value the
 * server refuses (Wan 3.0's 720p / 5 s, MiniMax H3's "2K") on a node the user
 * never touched. A value the user already chose is never rewritten by this.
 */
export function openVideoResolution(limits: FreeVideoLimits | null, provider: string, candidates: ReadonlyArray<string | undefined>): string | undefined {
  const list = candidates.filter((v): v is string => typeof v === "string" && v.length > 0)
  return list.find((v) => !lockedVideoResolution(limits, provider, v)) ?? list[0]
}

/** Same as {@link openVideoResolution}, for a duration. */
export function openVideoDuration(limits: FreeVideoLimits | null, provider: string, candidates: ReadonlyArray<number | undefined>): number | undefined {
  const list = candidates.filter((v): v is number => typeof v === "number")
  return list.find((v) => !lockedVideoDuration(limits, provider, v)) ?? list[0]
}
