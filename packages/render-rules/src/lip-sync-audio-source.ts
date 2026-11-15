import { LIP_SYNC_UNMEASURED_ESTIMATE_SECONDS, lipSyncEstimateSeconds, type LipSyncAudioRate } from "@nodaro/shared/credits"

/**
 * Which node's audio a Lip Sync run plays (decided 2026-11-13): the one rule
 * the server's estimate and the editor's estimate read, so an estimate prices
 * the audio its own engine's run plays. The two engines differ, and each run
 * stays as it is — unifying them would change which audio a saved workflow
 * plays on one of them:
 *
 *  - `server` (a workflow, app or API run; `input-resolver.ts`): the LAST
 *    wired `audio` edge (each wire's output overwrites the one before); with
 *    none wired, the dropdown-selected node (`selectedAudioNodeId`, its
 *    selected-node fallback).
 *  - `editor` (the editor's own Run of the node; `execute-node.ts`): the
 *    dropdown-selected node when it is on the canvas; else the LAST wired
 *    `audio` edge (the editor's input resolver overwrites the same way).
 *
 * `undefined` when the node plays no other node's audio: its estimate then
 * knows no length.
 */
export type LipSyncRunEngine = "server" | "editor"

export function lipSyncAudioSourceId(
  node: { readonly id?: string; readonly data?: unknown },
  nodes: ReadonlyArray<{ readonly id?: string }>,
  edges: ReadonlyArray<{ readonly source?: string; readonly target?: string; readonly targetHandle?: string | null }> | undefined,
  engine: LipSyncRunEngine,
): string | undefined {
  const wired = node.id === undefined
    ? undefined
    : (edges ?? []).filter((e) => e.target === node.id && e.targetHandle === "audio" && typeof e.source === "string").at(-1)?.source
  const raw = (node.data as { selectedAudioNodeId?: unknown } | null | undefined)?.selectedAudioNodeId
  const selected = typeof raw === "string" && raw !== "" && nodes.some((n) => n.id === raw) ? raw : undefined
  return engine === "server" ? wired ?? selected : selected ?? wired
}

/**
 * The length of audio a Lip Sync on a model charged per second of its audio
 * (OmniHuman 2.0) is QUOTED on, on every estimate — the editor's, the server's
 * run estimate, an app's listing and a continuation's credit check (decided
 * 2026-11-14: one minimum on both sides): the length the estimate reads off the
 * audio its run plays (`audioSec`: the measured walk, a voice made again in
 * the run at its take, a minimum); with no audio node to play at all
 * (`playsAudio` false), the length the node measured of its own audio at its
 * last run (`audioDurationSec`); else `undefined` — the
 * `LIP_SYNC_UNMEASURED_ESTIMATE_SECONDS` stand-in `lipSyncRateQuoteSeconds`
 * quotes, a MINIMUM: the run measures the real audio and charges it.
 */
export function lipSyncRateQuotedAudioSec(audioSec: number | undefined, playsAudio: boolean, data: unknown): number | undefined {
  if (playsAudio) return audioSec
  const own = (data as { audioDurationSec?: unknown } | null | undefined)?.audioDurationSec
  return typeof own === "number" && Number.isFinite(own) && own > 0 ? own : undefined
}

/** The seconds that quote prices ({@link lipSyncRateQuotedAudioSec}): the billed seconds of a known length, else the 15-second stand-in, a minimum. */
export function lipSyncRateQuoteSeconds(rate: LipSyncAudioRate, audioSec: number | undefined, playsAudio: boolean, data: unknown): number {
  return lipSyncEstimateSeconds(rate, lipSyncRateQuotedAudioSec(audioSec, playsAudio, data), LIP_SYNC_UNMEASURED_ESTIMATE_SECONDS)
}
