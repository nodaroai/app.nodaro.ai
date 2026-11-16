/**
 * The credit ids of the two nodes whose shared resolver (`@nodaro/shared`)
 * takes a probed length as a body field — AI Avatar's audio seconds
 * (`resolveAiAvatarCreditId`, `__probedDurationSec`) and SwitchX's frame count
 * (`resolveSwitchXCreditId`, `__probedFrameCount`) — built from what the
 * SERVER measured, never from a field a request or a node's data carries
 * (decided 2026-11-14: a body field is one a client can set itself). Any copy
 * of the field in the body is dropped here, and the server's own measure, when
 * there is one, is put in its place. The route's guard and its reservation,
 * the workflow run's reservation, the server's estimate and the editor's chip
 * all read through these, so a node's data cannot set a probed length on any
 * of them.
 */
import { resolveAiAvatarCreditId, resolveSwitchXCreditId } from "@nodaro/shared/credits"

/** The field the AI Avatar resolver reads its probed audio seconds from. */
export const AI_AVATAR_PROBED_FIELD = "__probedDurationSec"
/** The fields SwitchX's preflight once stashed on the body: the probed frame count, and the frames the worker trims to. */
export const SWITCHX_PROBED_FIELD = "__probedFrameCount"
export const SWITCHX_TRIM_FIELD = "__trimSourceToFrames"

/** `body` without `keys`: a copy, the caller's object untouched. */
function without(body: Readonly<Record<string, unknown>> | undefined, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(body ?? {}) }
  for (const key of keys) delete out[key]
  return out
}

/**
 * An AI Avatar's credit id: its settings from `body`, and in audio mode the
 * audio seconds the server measured (`measuredSec`; none, the resolver's
 * 120-second fallback) — never a length the body carries.
 */
export function aiAvatarCreditIdOf(body: Readonly<Record<string, unknown>> | undefined, measuredSec?: number): string {
  const settings = without(body, [AI_AVATAR_PROBED_FIELD])
  return resolveAiAvatarCreditId(measuredSec === undefined ? settings : { ...settings, [AI_AVATAR_PROBED_FIELD]: measuredSec })
}

/**
 * A SwitchX relight's credit id: its settings from `body`, and the frame count
 * the server probed (`measuredFrames`; none, the resolver's 240-frame top tier)
 * — never a count the body carries.
 */
export function switchXCreditIdOf(body: Readonly<Record<string, unknown>> | undefined, measuredFrames?: number): string {
  const settings = without(body, [SWITCHX_PROBED_FIELD, SWITCHX_TRIM_FIELD])
  return resolveSwitchXCreditId(measuredFrames === undefined ? settings : { ...settings, [SWITCHX_PROBED_FIELD]: measuredFrames })
}

/** The frame size a SwitchX node runs at, as every lane reads its `maxResolution`: 720 only for 720, else the 1080 default. */
export function switchXMaxResolutionOf(data: Readonly<Record<string, unknown>> | undefined): 720 | 1080 {
  return data?.maxResolution === 720 ? 720 : 1080
}

/**
 * The id a SwitchX node is quoted at before its run (the editor's chip and
 * Run button, the server's run estimate, the credit check before a run, an
 * app's listing) and a workflow run holds — no frames are counted before the
 * run, so the 240-frame worst-case tier at the node's frame size, the most a
 * run can hold. The route measures the clip and holds its own tier, at most
 * this.
 */
export function switchXQuoteCreditId(data: Readonly<Record<string, unknown>> | undefined): string {
  return switchXCreditIdOf({ maxResolution: switchXMaxResolutionOf(data) })
}
