/**
 * The ANIMATED CLIP half of a shot — the {@link ShotClip} shape (one
 * generate-video node holding the shot's take history), the pure readers over
 * it, {@link buildClip}'s shape invariant, and the {@link ShotPendingClip}
 * resume marker a long render survives a reload on.
 *
 * Extracted from `shot.ts` (which re-exports every name here) — same frozen
 * contract. The still mirror lives in `shot-still.ts`.
 */
import type { ConnectedReference } from "@nodaro/shared"
import type {
  DirectionFields,
  StructuredPromptFields,
  SubjectFields,
} from "@nodaro/prompts"

import {
  directionSpread,
  structuredSpread,
  subjectSpread,
} from "./shot-direction"

import type { RecastPlan } from "./recast"
import type { VoiceDirection } from "./voice-direction"

import type { ShotClipResult } from "./shot-results"
import { shotDisplayName } from "./shot-still"
import type { LookSelectionMap, Shot, ShotBeat, ShotTransition } from "./shot"

/**
 * An animated clip — ONE generate-video node holding the shot's clip results
 * list (the video mirror of {@link ShotStill}: every directing candidate appends
 * a {@link ShotClipResult}; `activeIndex` picks the current clip). `url` mirrors
 * the ACTIVE result so every existing reader (export, card label) keeps working.
 * Wired AFTER its still.
 */
export interface ShotClip {
  /** Persisted generate-video node id (`generate-video-${jobId}`). */
  readonly nodeId: string
  /** The ACTIVE result's URL (= `results[activeIndex].url`) — the ordered `combine-videos` input. */
  readonly url: string
  /** Catalog video model id that produced it. */
  readonly provider: string
  /** The directing prompt persisted on the node (plain, no assembly). */
  readonly prompt: string
  /** Clip length in seconds (for the card label + `combine-videos` cost hint). */
  readonly duration?: number
  /**
   * All generations for this shot's clip → the canvas node's `generatedResults`.
   * One per directing candidate. Optional for back-compat: absent ⇒ a single
   * legacy result (`[{ url }]`); use {@link clipResults} to read it normalized.
   */
  readonly results?: ReadonlyArray<ShotClipResult>
  /** Index into {@link results} of the active clip; absent ⇒ 0. */
  readonly activeIndex?: number
  /**
   * When the clip was produced via the Character-Voice REVOICE (a `voice-changer`
   * follow-up job that demuxes the native audio, runs speech-to-speech, and remuxes),
   * the target ElevenLabs voice it was revoiced into. The voice-changer job is
   * TRANSIENT (not persisted as a node — audio is a studio-layer concern): only the
   * FINAL revoiced video is the clip, and these carry which voice it speaks in for
   * relabel/restore. Absent for a plain (un-revoiced) animate.
   */
  readonly revoicedVoiceId?: string
  /** Display name of the {@link revoicedVoiceId} voice (for the card label). */
  readonly revoicedVoiceName?: string
  /**
   * The cinematic direction this clip's `prompt` was generated with, as PLATFORM
   * catalog ids — the video mirror of {@link ShotStill.direction}, same INV-D
   * (rebased with `prompt`, cleared by an unmarked result), same "key presence
   * is the marker" rule.
   *
   * STORED, NOT YET HONORED: the platform's canvas video executors do not read
   * node-data direction yet (only `generate-image` does). Unknown node-data keys
   * persist verbatim, so this is inert-but-correct today — and the day the
   * platform follow-up lands, every already-saved production is right with no
   * migration.
   */
  readonly direction?: DirectionFields
  /** The {@link ShotStill.subject} mirror — same symmetry, same rebase. */
  readonly subject?: SubjectFields
  /** The {@link ShotStill.structured} mirror — the same canvas passthrough. */
  readonly structured?: StructuredPromptFields
}

/**
 * Marks a clip result produced by the embedded editor rather than by a model.
 * Result-level PROVENANCE only: the clips rail badges the take with it, but the
 * clip-level `provider` (the canvas node's model) deliberately never carries it
 * — the node must keep a REAL, runnable model id. Lives here (domain) so
 * {@link buildClip}'s mirror can honor that rule; re-exported by
 * `apply-edited-clip` for its writers/readers.
 */
export const EDITED_CLIP_PROVIDER = "freecut-edit"

/**
 * A shot clip's results list, normalized over the legacy single-`url` shape.
 * The synthesized legacy result carries the clip-level CONTEXT (prompt /
 * provider / duration) — those fields mirror the active result by
 * construction, and consumers key real behavior off them: the clips rail's
 * per-take Extend gate reads `result.provider` (a bare `{url}` made every
 * single-take clip silently un-extendable), and the extend/restore flows read
 * the prompt + duration.
 */
export function clipResults(clip: ShotClip): ReadonlyArray<ShotClipResult> {
  return clip.results && clip.results.length > 0
    ? clip.results
    : [
        {
          url: clip.url,
          // Empty strings carry no restore value — omit rather than synthesize
          // a hollow field (jobId has no clip-level mirror at all, so the
          // legacy take never carries one).
          ...(clip.prompt ? { prompt: clip.prompt } : {}),
          ...(clip.provider ? { provider: clip.provider } : {}),
          ...(clip.duration !== undefined ? { duration: clip.duration } : {}),
        },
      ]
}

/**
 * The resolved display NAME for a clip take — the user's custom {@link
 * ShotClipResult.name} when set, else a positional `Take N` (1-based `index`).
 * ONE derivation shared by the clips rail's tooltip and the rename UI, so the
 * two can't drift (the video mirror of {@link stillDisplayName}).
 */
export function clipTakeDisplayName(
  result: { readonly name?: string },
  index: number,
): string {
  return result.name?.trim() || `Take ${index + 1}`
}

/**
 * EVERY clip (video) URL the production has generated, in shot → result order,
 * DE-DUPED by URL — the video mirror of {@link productionStills}. The source for
 * the FreeCut import picker's "From Production" tab: each shot contributes its
 * WHOLE clip history (via {@link clipResults}), not just its active clip, so any
 * video you made while experimenting is importable. `jobId` keys a generation; a
 * legacy clip (no jobId) falls back to a per-shot index. Pure; returns fresh
 * `{ id, url }` rows — never exposes the store shots.
 */
export function productionClips(
  shots: ReadonlyArray<Shot>,
): ReadonlyArray<{ readonly id: string; readonly url: string }> {
  return productionVideoRefs(shots).map(({ id, url }) => ({ id, url }))
}

/**
 * The same walk as {@link productionClips}, with what a PICKER needs to show a
 * take: a resolved display name and a poster frame. The name leads with the
 * scene ("Scene 2 · Take 1") because these rows are read project-wide, where
 * "Take 1" alone identifies nothing — a custom take name still wins outright.
 * The poster is the frame the take was animated FROM, which is also its first
 * frame. The video mirror of {@link productionImageRefs}; `productionClips` is
 * the narrow projection of this, so the two can never disagree about which
 * takes a production has.
 */
export function productionVideoRefs(shots: ReadonlyArray<Shot>): ReadonlyArray<{
  readonly id: string
  readonly url: string
  readonly name: string
  readonly posterUrl: string | null
  readonly shotId: string
}> {
  const seen = new Set<string>()
  const out: Array<{
    id: string
    url: string
    name: string
    posterUrl: string | null
    shotId: string
  }> = []
  shots.forEach((s, shotIndex) => {
    if (!s.clip) return
    clipResults(s.clip).forEach((r, i) => {
      if (seen.has(r.url)) return
      seen.add(r.url)
      out.push({
        id: r.jobId ?? `${s.id}:${i}`,
        url: r.url,
        name:
          r.name?.trim() ||
          `${shotDisplayName(s, shotIndex + 1)} · ${clipTakeDisplayName(r, i)}`,
        posterUrl: r.startFrameUrl ?? null,
        shotId: s.id,
      })
    })
  })
  return out
}

/**
 * Build a {@link ShotClip} enforcing the SHAPE invariant in one place (mirrors
 * {@link buildStill}): a lone result collapses to the minimal legacy shape (no
 * `results`/`activeIndex`) so single-clip productions round-trip byte-identical;
 * >1 carries the list and its `activeIndex`. `url` always mirrors the ACTIVE
 * result so every reader (export, card label) keeps working. The re-voice
 * provenance fields on `base` are PRESERVED. Callers pass the already-built
 * results array + the chosen active index.
 */
export function buildClip(
  base: {
    nodeId: string
    provider?: string
    prompt?: string
    duration?: number
    revoicedVoiceId?: string
    revoicedVoiceName?: string
    direction?: DirectionFields
    subject?: SubjectFields
    structured?: StructuredPromptFields
  },
  results: ReadonlyArray<ShotClipResult>,
  activeIndex: number,
): ShotClip {
  const active = results[activeIndex]
  // The clip level MIRRORS the ACTIVE result — exactly like `url`. The timeline
  // card's length badge, the filmstrip seconds and the export/NodarCut hand-off
  // all read clip-level `duration`, so it must follow the take that's actually
  // on screen: trimming a 5s take to 1.9s in the editor showed 1.9s on the rail
  // but the card stayed "5s" while this preferred the stale base. Falls back to
  // `base` for a legacy result that carries no per-result value.
  const duration = active.duration ?? base.duration
  // `provider` mirrors too (a model-switch take relabels the card) with ONE
  // exception: the edited-take marker is result-level provenance — the clip
  // keeps the last REAL model so the canvas node stays runnable.
  const provider =
    (active.provider !== EDITED_CLIP_PROVIDER ? active.provider : undefined) ??
    base.provider ??
    ""
  const core: ShotClip = {
    nodeId: base.nodeId,
    url: active.url,
    provider,
    prompt: base.prompt ?? "",
    // Preserve the optional clip-level fields (duration + re-voice provenance)
    // only when present, so an un-revoiced single clip stays byte-identical.
    ...(duration !== undefined ? { duration } : {}),
    ...(base.revoicedVoiceId ? { revoicedVoiceId: base.revoicedVoiceId } : {}),
    ...(base.revoicedVoiceName ? { revoicedVoiceName: base.revoicedVoiceName } : {}),
    // The cinematic channel travels WITH `prompt` (INV-D) — see buildStill.
    ...directionSpread(base.direction),
    ...subjectSpread(base.subject),
    // The canvas's own Path-1 fields, handed straight back (see ShotStill).
    ...structuredSpread(base.structured),
  }
  // Keep the results list for >1 generation OR when the lone result carries the
  // FRAMES it was animated from, the REFERENCES rail it was sent with, bound
  // `@`-entity chips, `/` voice-direction chips, the SHOTS it was authored from,
  // the SCENE PROMPT it was made under, the WAY OUT it was folded with, a
  // FreeCut project url, OR a custom take name — collapsing to the bare shape
  // would DROP them (they live
  // per-result, and unlike `provider`/`duration` the clip level mirrors none of
  // them), so a single frames take would reload with no start/end frame, a
  // single references take with an empty rail, and a single clip with chips (or
  // a single FreeCut-edited clip, the common first-edit case, or a take the
  // user renamed) would lose them on reload/shot-select. A truly bare lone
  // result (legacy) still collapses byte-identical.
  const keepList =
    results.length > 1 ||
    results.some(
      (r) =>
        r.startFrameUrl ||
        r.endFrameUrl ||
        r.referenceImageUrls?.length ||
        r.referenceVideoUrls?.length ||
        r.referenceAudioUrls?.length ||
        r.references?.length ||
        r.directions?.length ||
        r.beats?.length ||
        r.scenePrompt ||
        r.endTransition ||
        r.freecutProjectUrl ||
        r.negativePrompt ||
        r.aspectRatio ||
        r.resolution ||
        r.name ||
        // Same argument as buildStill's — see the marker's doc on ShotClipResult.
        r.promptFormat !== undefined ||
        r.look ||
        r.filmLook ||
        r.sceneLook ||
        r.subject,
    )
  return keepList ? { ...core, results, activeIndex } : core
}

/**
 * An IN-FLIGHT directing (animate) job, persisted so a long video render survives
 * a page reload. The client-side job registry (`useShotJobs`) is TRANSIENT
 * (in-memory), so without this a reload during the minutes-long render orphans the
 * result — it completes on the provider but Studio is no longer polling it (the
 * symptom: "the clip is in the provider's logs but never shows up"). A shot keeps
 * ONE MARKER PER IN-FLIGHT JOB (`Shot.pendingClips` — animates run concurrently,
 * non-blocking editor): each completion/failure removes ITS marker by jobId, so a
 * render never orphans a concurrent sibling. On reload Studio RE-REGISTERS every
 * recent marker to resume polling; stale ones (older than the resume window) are
 * dropped. Studio-layer markers in `settings.studio`, NOT canvas nodes.
 */
export interface ShotPendingClip {
  /** The `generate-video` job id to resume polling on reload. */
  readonly jobId: string
  /** Echoed onto the resulting clip (card label + clip metadata) on completion. */
  readonly provider: string
  readonly prompt: string
  /** The negative prompt this render was sent with — resume context, echoed
   *  onto the finished clip like {@link prompt} (a reload mid-render must not
   *  lose it, or the clip restores without the negative it was made with). */
  readonly negativePrompt?: string
  readonly duration?: number
  /** Epoch ms when the animate started — gates the reload-resume staleness window. */
  readonly startedAt: number
  /** Character Voice intent: the speaker-ordered recast PLAN to apply to this native
   *  clip once it finishes (voice-changer-pro, chained in `onDirectingDone`). Present
   *  on the generate-video marker; drives the chain on completion AND on reload-resume. */
  readonly revoiceTo?: RecastPlan
  /** Revoice PROVENANCE on the voice-changer FOLLOW-UP marker — the voice this clip
   *  was revoiced into. Echoed onto the resulting clip (card label + restore). */
  readonly revoicedVoiceId?: string
  readonly revoicedVoiceName?: string
  /**
   * The finished NATIVE render's url, carried on the voice-changer FOLLOW-UP
   * marker as the FALLBACK: if the recast job fails (the classic trigger — a
   * clip with no dialogue → "No speech detected"), the shell appends THIS clip
   * with its native voice instead of dropping the whole take. Without it a
   * failed recast silently discarded the paid generate-video result (the
   * "generation completed but no video ever appeared" bug). Persisted, so the
   * fallback survives a reload mid-recast too.
   */
  readonly nativeVideoUrl?: string
  /**
   * The `/` voice-direction chips of the in-flight prompt (the marker's
   * `prompt` holds their neutral `[text]` form). Resume context: the
   * in-memory per-job capture dies with the page, so a reload mid-render
   * recovers the directions from HERE and still persists them on the
   * finished clip (chips rebuild instead of degrading to bracket text).
   */
  readonly directions?: ReadonlyArray<VoiceDirection>
  /**
   * The timed SHOTS the take was submitted from — captured HERE, at submit,
   * not read off the shot at completion: the editor is non-blocking, so the
   * shots can be rewritten while the clip renders, and the take would then
   * come back claiming shots it was never made from.
   */
  readonly beats?: ReadonlyArray<ShotBeat>
  /**
   * The scene's GENERIC PROMPT the take was submitted under — captured HERE
   * for the same reason as {@link beats}: the textarea is non-blocking, so the
   * scene description can be rewritten while the clip renders.
   */
  readonly scenePrompt?: string
  /**
   * The scene's WAY OUT the take was submitted under — captured HERE for the
   * same reason as {@link scenePrompt} (the pill is non-blocking too), and
   * stamped onto the finished take so the seed can strip the clause its prose
   * carries baked in. A render resumed after a reload has nothing else left to
   * read it from.
   */
  readonly endTransition?: ShotTransition
  /**
   * The aspect ratio + resolution tier submitted — echoed onto the finished
   * take so it records what it was rendered at. On the MARKER for the same
   * reason as {@link beats}: the levers can move while the clip renders, and a
   * render resumed after a reload has nothing else left to read them from.
   */
  readonly aspectRatio?: string
  readonly resolution?: string
  /**
   * The bound `@`-entity chips of the in-flight prompt — the SAME resume
   * contract as {@link directions}, and for the same reason: the in-memory
   * per-job capture dies with the page, so a render that finishes after a
   * reload would land a clip with no references and the chips would degrade to
   * plain text (only the direction chips survived — that asymmetry is what made
   * it look like "the @ references vanished by themselves"). Read as the
   * fallback at completion so the finished clip always carries its bindings.
   */
  readonly references?: ReadonlyArray<ConnectedReference>
  /**
   * The prompt-format marker + the look ids this render went out with — the
   * SAME resume contract as {@link references}/{@link beats}: the marker is all
   * a reload-resumed render has left to stamp onto the finished clip, and
   * without them a resumed take would land knowing less than a fresh one
   * (it would read back as legacy and gag the pickers on restore).
   */
  readonly promptFormat?: 2
  readonly look?: LookSelectionMap
  /**
   * The layer split behind {@link look} (D-A1), on the marker for the same
   * reason as the marker's `look`: it is the only channel a reload-resumed
   * render has left, so a resumed take lands knowing exactly what a fresh one
   * does. See {@link ShotStillResult.filmLook} for the discriminator contract.
   */
  readonly filmLook?: LookSelectionMap
  readonly sceneLook?: LookSelectionMap
  readonly subject?: SubjectFields
}
