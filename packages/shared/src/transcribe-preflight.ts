import {
  DEFAULT_TRANSCRIBE_NODE_PROVIDER,
  TRANSCRIBE_TARGET_LANGUAGES,
  transcribeLaneSupportsTranslation,
  transcribeLaneSupportsWordTimestamps,
  transcribeProvidersWithTranslation,
  transcribeProvidersWithWordTimestamps,
} from "./model-constants.js"
import { renderTranscriptOutputOf } from "./render-nodes.js"

/**
 * Pre-run checks for the transcribe → captions chain.
 *
 * A transcription lane that cannot return per-word timings (`whisper`) still
 * RUNS and BILLS — it just hands back phrase segments with `words: []`. Anything
 * downstream that needs words then fails AFTER the transcription was paid for.
 * These helpers let every run surface (the editor's DAG, the backend
 * orchestrator, single-node Run) refuse BEFORE any spend, with one message.
 * Pure: no I/O, no framework types — callers pass plain nodes/edges.
 */

/** A transcription's target language as data carries it: a non-empty string, else `undefined` (no translation). */
export function transcribeTargetLanguageOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

/** The refusal for a request that can't return word timings; `null` when it can.
 *  An absent provider resolves to the transcribe NODE default. A translation
 *  (`targetLanguage`) never carries word timings, whatever the engine: KIE
 *  refuses Nemotron's `target_language` together with `timestamps`. */
export function transcribeWordTimestampsRefusal(
  provider: string | null | undefined,
  targetLanguage?: unknown,
): string | null {
  const lane = provider || DEFAULT_TRANSCRIBE_NODE_PROVIDER
  if (!transcribeLaneSupportsWordTimestamps(lane)) {
    return `the "${lane}" engine does not return word timings — pick ${transcribeProvidersWithWordTimestamps().join(" or ")}`
  }
  if (transcribeTargetLanguageOf(targetLanguage) !== undefined) {
    return "a translation carries no word timings — clear the target language to get a transcript with word timings"
  }
  return null
}

/**
 * The refusal for a translation request (`targetLanguage`) that cannot run;
 * `null` when there is none to refuse (no target language, or a valid one on
 * an engine that translates, without word timings). One message for every run
 * surface: the route, the workflow run, the editor's Run and MCP.
 *  - only Nemotron 3.5 Transcribe translates;
 *  - only into a language KIE lists (`TRANSCRIBE_TARGET_LANGUAGES`);
 *  - never together with word timings (KIE refuses the pair).
 * An absent provider resolves to the transcribe NODE default.
 */
export function transcribeTranslationRefusal(
  provider: string | null | undefined,
  targetLanguage: unknown,
  wordTimestamps?: boolean,
): string | null {
  const target = transcribeTargetLanguageOf(targetLanguage)
  if (target === undefined) return null
  const lane = provider || DEFAULT_TRANSCRIBE_NODE_PROVIDER
  if (!transcribeLaneSupportsTranslation(lane)) {
    return `the "${lane}" engine does not translate — pick ${transcribeProvidersWithTranslation().join(" or ")} to translate, or clear the target language`
  }
  if (!(TRANSCRIBE_TARGET_LANGUAGES as readonly string[]).includes(target)) {
    return `"${target}" is not a language the "${lane}" engine translates into — pick one of ${TRANSCRIBE_TARGET_LANGUAGES.join(", ")}`
  }
  if (wordTimestamps === true) {
    return "word timings and a translation cannot be asked for together — turn word timings off, or clear the target language"
  }
  return null
}

export interface PreflightGraphNode {
  readonly id: string
  readonly type?: string | null
  readonly data?: Record<string, unknown> | null
}
export interface PreflightGraphEdge {
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

export interface WordlessTranscriptFeed {
  readonly transcribeNodeId: string
  /** The add-captions node that would receive a transcript with no words. */
  readonly consumerNodeId: string
  readonly provider: string
  readonly message: string
}

// Handle ids (generated map: backend/src/lib/mcp/generated/node-handles.ts).
const TRANSCRIBE_JSON_OUT = "json"
const TRANSCRIPT_IN = "transcript"

/**
 * Every transcribe node on a word-INCAPABLE lane (or one set to translate, whose
 * transcript is a translation with no word timings) whose `json` output reaches an
 * add-captions `transcript` input — directly, or through apply-edl, which remaps
 * the transcript and re-emits it on its own `json` handle (or any render, by
 * its registry `transcriptOutput`: Speaker View's `transcript`). add-captions rejects a
 * transcript with no words, so such a run can only fail, after paying for the
 * transcription. Skipped nodes are ignored on both ends.
 *
 * The engine is read from node data and nothing else can change it: `provider`
 * is not a mappable field on transcribe, so what this check sees IS what runs.
 * add-captions' own "transcript has no words" guard stays as defence in depth
 * for a transcript that arrives from anywhere other than a transcribe node.
 */
export function findWordlessTranscriptFeeds(
  nodes: readonly PreflightGraphNode[],
  edges: readonly PreflightGraphEdge[],
): WordlessTranscriptFeed[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const isSkipped = (n: PreflightGraphNode | undefined): boolean => !n || n.data?.skipped === true
  const out: WordlessTranscriptFeed[] = []

  for (const node of nodes) {
    if (node.type !== "transcribe" || isSkipped(node)) continue
    const provider = (typeof node.data?.provider === "string" && node.data.provider) || DEFAULT_TRANSCRIBE_NODE_PROVIDER
    // A translating node is as wordless as an incapable lane: its transcript is
    // the translation, with no word timings.
    const refusal = transcribeWordTimestampsRefusal(provider, node.data?.targetLanguage)
    if (!refusal) continue

    // Walk the transcript's path: transcribe.json → [render.transcript → its transcript output]* → add-captions.transcript,
    // out of every render on the pip its registry names (RENDER_NODE_TYPES transcriptOutput)
    const seen = new Set<string>()
    const frontier: Array<{ id: string; outHandle: string }> = [{ id: node.id, outHandle: TRANSCRIBE_JSON_OUT }]
    while (frontier.length > 0) {
      const { id, outHandle } = frontier.pop()!
      for (const e of edges) {
        if (e.source !== id || (e.sourceHandle ?? null) !== outHandle || e.targetHandle !== TRANSCRIPT_IN) continue
        const target = byId.get(e.target)
        if (isSkipped(target)) continue
        if (target!.type === "add-captions") {
          out.push({
            transcribeNodeId: node.id,
            consumerNodeId: target!.id,
            provider,
            message: `Captions need word timings, but ${refusal}.`,
          })
        } else if (!seen.has(target!.id)) {
          const remapped = renderTranscriptOutputOf(target!.type)
          if (remapped) {
            seen.add(target!.id)
            frontier.push({ id: target!.id, outHandle: remapped.handle })
          }
        }
      }
    }
  }
  return out
}
