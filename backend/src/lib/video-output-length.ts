/**
 * How long the video a node passes on is, before anything has run — the length
 * rule of EVERY video producer, so a listing can price a length-priced step
 * (Trim, Loop, Combine Videos, Video SFX) on any chain of them and never quote
 * below what a run of that chain is charged (decided 2026-10-07).
 *
 * The rules themselves are `@nodaro/render-rules`' (`VIDEO_LENGTH_RULES`,
 * video-output-length.ts there): the one table the listing, the server's run
 * estimate and the editor's read, the last two through the measured walk of a
 * step whose run measures its input (`measuredWireLengthSec`). This module adds
 * what only the server has: the rows of the node units with the
 * "length:unknown" capability (composed from the unit descriptors), the
 * listing's floor ({@link floorLength}), the deployment's Generate Video Pro
 * cap, and the generated-voice readings (`generatedVoiceLength`).
 *
 * A rule is an UPPER BOUND on what the node delivers. What a rule cannot bound
 * is `"unknown"`, and says why in {@link UNBOUNDED_LENGTH_REASONS}: the listing
 * then lists a length-priced step at the run's own stand-in (Trim, Loop and
 * Combine Videos: the estimators' 8-second fallback; Video SFX: its 300-second
 * row, the most it accepts).
 *
 * The length a run of the NEXT step reads off a node is its recorded or
 * configured duration, else the estimators' fallback (`extractVideoDurationFromNode`
 * ?? `VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS`, input-resolver.ts), so a
 * length is never listed below that either ({@link floorLength}).
 *
 * The registry is keyed by node type and guarded: `video-output-length.test.ts`
 * fails when a member of `VIDEO_PRODUCER_TYPES` has no rule.
 */
import {
  VIDEO_UTIL_PRICING,
  estimateScriptDurationSec,
} from "@nodaro/shared/credits"
import {
  extractVideoDurationFromNode,
} from "@nodaro/shared/video"
import {
  seedanceEditChargedLength,
  VIDEO_LENGTH_RULES,
  VIDEO_LENGTH_UNBOUNDED_REASONS,
  type InputLength,
  type OutputLengthNode,
  type OutputLengthRule,
  type OutputWireInput,
  type OutputWireLength,
} from "@nodaro/render-rules"
import { generateVideoProCapSec } from "./generate-video-pro-length.js"
// @registry-enumerates VIDEO_OUTPUT_LENGTH_RULES and UNBOUNDED_LENGTH_REASONS carry every node unit with the "length:unknown" capability, and the rules every use-case node whose spec declares an outputLength
import { UNIT_NODE_DESCRIPTORS } from "./unit-descriptors.js"
import { composeRecord, unitsWith } from "./unit-compose.js"
import type { UnitDescriptor } from "../nodes/kit.js"

export {
  DYNAMIC_VIDEO_OUTPUT_TYPES,
  PASS_THROUGH_VIDEO_TYPES,
  SLIDESHOW_MAX_IMAGES,
  knownOutputLength as knownLength,
  longestCatalogVideoSec,
  motionTransferCeilingSec,
  usecaseLength,
  wireKindOf,
  type InputLength,
  type OutputWireKind as WireKind,
} from "@nodaro/render-rules"

/**
 * What a listing knows of a wire's video (or audio): its length; that it cannot
 * be bounded (`"unknown"`); or nothing (`undefined`). `@nodaro/render-rules`'
 * `OutputWireLength`.
 */
export type WireLength = OutputWireLength
/** One wire into a node, with the length of what it carries. */
export type WireInput = OutputWireInput
export type LengthNode = OutputLengthNode
/** How a node's output length is decided. */
export type { OutputLengthRule }

const fixed = (sec: number): InputLength => ({ fixedSec: Math.max(0, sec), perEpisodeSec: 0 })

/** A node no rule can bound: the rule every node unit with the "length:unknown" capability gets (the hand-written unbounded nodes have the same). */
const unboundedRule: OutputLengthRule = { via: "rule", run: () => "unknown" }

/**
 * The rows the node units with the "length:unknown" capability add (tools/units/README.md):
 * the unbounded rule in {@link VIDEO_OUTPUT_LENGTH_RULES} and, in
 * {@link UNBOUNDED_LENGTH_REASONS}, the reason its manifest states
 * (`lengthUnknownReason`, required with the capability), so a unit no rule can
 * bound is named like every hand-written one. Pure over the descriptors, so a
 * fixture unit proves it; a unit with the capability and no reason throws at
 * load (the validator refuses that manifest first).
 */
export function unitUnknownLengths(units: ReadonlyArray<UnitDescriptor>): {
  readonly rules: Readonly<Record<string, OutputLengthRule>>
  readonly reasons: Readonly<Record<string, string>>
} {
  const types = unitsWith(units, "length:unknown")
  return {
    rules: Object.fromEntries(types.map((t) => [t, unboundedRule])),
    reasons: Object.fromEntries(units.filter((u) => types.includes(u.type)).map((u) => {
      if (!u.lengthUnknownReason) throw new Error(`${u.type}: the "length:unknown" capability needs lengthUnknownReason in its unit.json (tools/units/README.md)`)
      return [u.type, u.lengthUnknownReason]
    })),
  }
}
const UNIT_UNKNOWN_LENGTHS = unitUnknownLengths(UNIT_NODE_DESCRIPTORS)

/** Why a node's output cannot always be bounded, for the nodes that declare it: the hand-written ones (`VIDEO_LENGTH_UNBOUNDED_REASONS`) ∪ the "length:unknown" node units. */
export const UNBOUNDED_LENGTH_REASONS: Readonly<Record<string, string>> = composeRecord("UNBOUNDED_LENGTH_REASONS", { ...VIDEO_LENGTH_UNBOUNDED_REASONS }, UNIT_UNKNOWN_LENGTHS.reasons)

/**
 * The length rule of every node that delivers a video. Every member of
 * `VIDEO_PRODUCER_TYPES` is a key (guarded), plus the dual-mode steps that can
 * deliver one: `@nodaro/render-rules`' `VIDEO_LENGTH_RULES` (the hand-written
 * rules and the use-case nodes whose spec declares an `outputLength`) ∪ the
 * node units with the "length:unknown" capability ({@link unitUnknownLengths});
 * a unit with a "length:pass-video" / "length:exact-video" capability arrives
 * through `LENGTH_KEEPING_VIDEO_TYPES`.
 */
export const VIDEO_OUTPUT_LENGTH_RULES: Readonly<Record<string, OutputLengthRule>> = composeRecord("VIDEO_OUTPUT_LENGTH_RULES", { ...VIDEO_LENGTH_RULES }, UNIT_UNKNOWN_LENGTHS.rules)

/** The longest a generated voice is listed at: past it the listing stops following the script. */
export const GENERATED_VOICE_MAX_SEC = 300

/**
 * Characters a second a logographic or syllabic script is spoken at (Chinese,
 * Japanese, Korean): the slow end of their real range (about 4 to 6), so a
 * listing is biased high, as the Latin rate is. Decided 2026-10-07.
 */
export const SLOW_SCRIPT_CHARS_PER_SEC = 4
/** The Latin rate `estimateScriptDurationSec` reads: 12 characters a second at normal speed. */
const LATIN_CHARS_PER_SEC = 12
/** The slowest a Text to Speech node speaks (its speed slider's floor): what an unreadable or mapped speed is listed at. */
export const SLOWEST_VOICE_SPEED = 0.7

/** Han, kana and Hangul: the scripts spoken slower than {@link SLOW_SCRIPT_CHARS_PER_SEC}'s Latin rate allows for. */
const SLOW_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu

/** How many characters of `text` are in a slow script. */
export function slowScriptChars(text: string): number {
  return text.match(SLOW_SCRIPT)?.length ?? 0
}

/**
 * What a speech estimate (`speechEstimateChars`) says of a generated voice's
 * script: its character count, whether that is the literal text the run sends,
 * and the model's per-request cap (what an unreadable text is counted at). With
 * the traits that change how long it takes to speak: the node's speed (1 when
 * unset) and how many of the characters are in a slow script.
 */
export interface SpokenScript {
  readonly chars: number
  readonly exact: boolean
  readonly cap: number
  /** The voice's speed, 0.7 to 1.2; absent = 1. */
  readonly speed?: number
  /** Of `chars`, those in a slow script (counted from a literal text only). */
  readonly slowChars?: number
  /**
   * `chars` is an upper bound on a script an LLM writes at run time (the tokens
   * its node can write x 8 characters, `llmScriptChars`), not the literal text:
   * the listing follows it even when it reaches the model's cap.
   */
  readonly bounded?: boolean
}

/**
 * How long a generated voice (Text to Speech, Text to Dialogue) is listed at
 * (decided 2026-10-07): the seconds its script takes to read, at most
 * {@link GENERATED_VOICE_MAX_SEC}. The rate is `estimateScriptDurationSec`'s
 * (12 characters a second at normal speed, biased high: the AI Avatar reserve's
 * own), the one characters-to-seconds rule the platform has, at the node's own
 * speed (a slower voice runs longer: an unreadable speed is the slider's floor,
 * 0.7), with each character of a slow script (Chinese, Japanese, Korean) counted
 * at {@link SLOW_SCRIPT_CHARS_PER_SEC}. A script is counted when it is the literal
 * text the run sends, or when an exposed input's character limit bounds it below
 * the model's cap. A script written at run time by anything else (a wired text)
 * is counted at the cap, which is no bound: `undefined`, so the step after it is
 * listed as it was before any voice rule (Lip Sync at its provider's cap, Merge
 * Video Audio and the length-priced steps at their own stand-ins). A script an
 * LLM node writes is the exception (decided 2026-10-07): it is bounded at what
 * that node can write, `maxTokens` x 8 characters (`bounded`), read at the same
 * rate and the same 300-second ceiling.
 */
export function generatedVoiceLength(script: SpokenScript): InputLength | undefined {
  if (!script.exact && !script.bounded && script.chars >= script.cap) return undefined
  const chars = Math.max(0, script.chars)
  const slow = Math.min(chars, Math.max(0, script.slowChars ?? 0))
  // A slow character takes as long as (12 / 4) Latin ones: one count the shared estimate reads.
  const equivalent = chars - slow + Math.ceil(slow * (LATIN_CHARS_PER_SEC / SLOW_SCRIPT_CHARS_PER_SEC))
  return fixed(Math.min(GENERATED_VOICE_MAX_SEC, estimateScriptDurationSec("x".repeat(equivalent), script.speed ?? 1)))
}

/**
 * A fixed length is never listed below the length a run reads off this node
 * (`extractVideoDurationFromNode`, else the estimators' fallback): that is what
 * the step after it is charged at. A length that follows the episode is left
 * to its per-minute figure.
 */
export function floorLength(length: WireLength, data: unknown): WireLength {
  if (typeof length !== "object" || length.perEpisodeSec > 0) return length
  const read = extractVideoDurationFromNode(data as Record<string, unknown> | undefined) ?? VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS
  return length.fixedSec >= read ? length : fixed(read)
}

/**
 * The length a node delivers as a step CHARGED by the length it is handed
 * (Trim, Loop, Combine Videos) reads it, where that differs from its rule:
 * the Video to Video node's Seedance edit runs at an automatic length and
 * records the length it makes (decided 2026-11-11), at most its run's bound
 * (`lengthFollowingBoundSec`), and such a step is charged by that record — so
 * it is never listed below that bound, nor below the input's length.
 * `undefined` for every other node, and for every other reader (a step that
 * measures the clip it is given): the rule ({@link videoOutputLength}) stands,
 * so an edit whose input the listing does not know stays `"unknown"`.
 */
export function chargedVideoOutputLength(node: LengthNode, inputs: readonly WireInput[]): WireLength | undefined {
  const length = seedanceEditChargedLength(node, inputs)
  return length === undefined ? undefined : floorLength(length, node.data)
}

/**
 * The length a node delivers: its rule (above), floored. `undefined` when the
 * node has no rule or reads its length off a recording or a render, which the
 * caller decides.
 */
export function videoOutputLength(node: LengthNode, inputs: readonly WireInput[]): WireLength | "no-rule" {
  const rule = VIDEO_OUTPUT_LENGTH_RULES[node.type]
  if (!rule || rule.via !== "rule" || !rule.run) return "no-rule"
  return floorLength(rule.run(node, inputs, { generateVideoProCapSec: generateVideoProCapSec() }), node.data)
}
