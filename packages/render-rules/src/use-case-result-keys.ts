/**
 * What a use-case node's last run leaves on the node beyond its failure code,
 * by the node's result kind (decided 2026-10-18): what a list kind could not
 * deliver. Keyed by kind, so a node of a kind that already exists needs no
 * entry, and a new kind does not typecheck until it has one. run-result-keys.ts
 * reads it for every use-case node type. Pure.
 */
import type { UseCaseResultKind } from "./use-case-graph"

/** The node fields a use-case node's last run leaves, beyond errorCode, by its result kind: what a list kind could not deliver. */
export const USE_CASE_RESULT_KEYS: { readonly [K in UseCaseResultKind]: readonly string[] } = Object.freeze({
  episode: [],
  chapters: [],
  formats: ["failedFormats"],
  clips: ["failedClips"],
  layout: [],
})
