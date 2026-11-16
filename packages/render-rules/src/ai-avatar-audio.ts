/**
 * What an AI Avatar in audio mode is quoted on before a run: the length of the
 * audio its run plays, as the measured walk reads it — the one rule the
 * editor's chip and Run button, the server's run estimate, the credit check
 * before a run and an app's listing share. The run measures that audio before
 * it holds anything (the route's preHandler, and a workflow run's stamp: both
 * `measureAiAvatarAudio`), and holds the duration bucket of the seconds it
 * measured (`aiAvatarCreditIdOf`), up to the 600-second bucket.
 *
 * A length the graph knows (an upload at the length recorded for it, a node
 * outside the run at the take it hands on, audio a node makes in the run at
 * its planned length plus {@link AI_AVATAR_PLANNED_CLIP_SLACK_SEC}) is quoted
 * at its bucket, the bucket the run holds for it. A length nothing knows
 * before the run (a voice made again in the run, a link, the node's own audio
 * link, a recording an app's user replaces) is quoted at the 120-second
 * default: a MINIMUM, not the price — the run measures the audio and holds its
 * bucket, so a longer audio needs that balance when the run reaches the node.
 */
import { aiAvatarCreditIdOf } from "./probed-credit-ids"
import { MADE_CLIP_OVERSHOOT_SEC } from "./made-clip-overshoot"

/**
 * The slack an AI Avatar's quote adds to audio a node makes in the run: its
 * run holds every started second of the sound it measures, with no grace, so
 * the whole of how far a made file can run past its planned length
 * ({@link MADE_CLIP_OVERSHOOT_SEC}, the container's 0.15 s).
 */
export const AI_AVATAR_PLANNED_CLIP_SLACK_SEC = MADE_CLIP_OVERSHOOT_SEC.container

/**
 * Which node's audio an AI Avatar run plays, by the engine that runs it: the
 * server (a workflow, app or API run; `input-resolver.ts`) the LAST wired
 * `audio` edge, else the dropdown-selected node (`selectedAudioNodeId`); the
 * editor's own Run of the node (`execute-node.ts`) the last wired `audio`
 * edge only. `undefined`: it plays no other node's audio (its own link, or
 * none), whose length nothing knows before the run.
 */
export function aiAvatarAudioSourceId(
  node: { readonly id?: string; readonly data?: unknown },
  nodes: ReadonlyArray<{ readonly id?: string }>,
  edges: ReadonlyArray<{ readonly source?: string; readonly target?: string; readonly targetHandle?: string | null }> | undefined,
  engine: "server" | "editor",
): string | undefined {
  const wired = node.id === undefined
    ? undefined
    : (edges ?? []).filter((e) => e.target === node.id && e.targetHandle === "audio" && typeof e.source === "string").at(-1)?.source
  if (engine === "editor") return wired
  const raw = (node.data as { selectedAudioNodeId?: unknown } | null | undefined)?.selectedAudioNodeId
  const selected = typeof raw === "string" && raw !== "" && nodes.some((n) => n.id === raw) ? raw : undefined
  return wired ?? selected
}

/** Does this AI Avatar run on audio (`speechMode: "audio"`, the mode its run measures its audio in)? */
export function aiAvatarPlaysAudio(data: unknown): boolean {
  return (data as { speechMode?: unknown } | null | undefined)?.speechMode === "audio"
}

/**
 * The credit id an estimate quotes an AI Avatar at: its settings, and in audio
 * mode the length of its audio as the measured walk read it (`audioSec`;
 * unknown, the 120-second default, a minimum) — the bucket its run holds for
 * that length. Text mode is priced by its script, as before.
 */
export function aiAvatarQuoteCreditId(data: Readonly<Record<string, unknown>> | undefined, audioSec: number | undefined): string {
  const known = aiAvatarPlaysAudio(data) && audioSec !== undefined && Number.isFinite(audioSec) && audioSec > 0 ? audioSec : undefined
  return aiAvatarCreditIdOf(data, known)
}
