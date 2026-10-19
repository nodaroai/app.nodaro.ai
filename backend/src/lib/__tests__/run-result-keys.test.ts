// @test-watches frontend/src/nodes/** backend/src/nodes/**
/**
 * What a use-case node's last run leaves on it, by its result kind (decided
 * 2026-10-18): every one its failure code; a type that takes several
 * recordings its cameras report (`useCaseCameras`, decided 2026-10-17); a list
 * kind also what it could not deliver (a Trailer's failed formats, a clip
 * set's failed clips). The table
 * below is written out literally, never re-derived from the keys module, so a
 * wrong row there fails here; and it is typed over every result kind, so a new
 * kind does not typecheck until its keys are written here and in
 * USE_CASE_RESULT_KEYS.
 */
import { describe, it, expect } from "vitest"
import {
  RUN_RESULT_TYPE_KEYS,
  USE_CASE_NODE_TYPES,
  USE_CASE_RESULT_KEYS,
  isRunResultKey,
  usecaseDescriptor,
  type UseCaseResultKind,
} from "@nodaro/render-rules"

/** The types that take several recordings (written out): their cameras report is their last run's too. */
const MULTICAM_TYPES: ReadonlySet<string> = new Set(["tighten-episode"])

const EXPECTED: { readonly [K in UseCaseResultKind]: readonly string[] } = {
  episode: ["errorCode"],
  chapters: ["errorCode"],
  formats: ["errorCode", "failedFormats"],
  clips: ["errorCode", "failedClips"],
}

describe("a use-case node's run-result keys follow its result kind", () => {
  it("the keys of each kind, beyond the failure code", () => {
    expect(USE_CASE_RESULT_KEYS).toEqual({ episode: [], chapters: [], formats: ["failedFormats"], clips: ["failedClips"] })
  })

  it("there is a use-case node to check", () => {
    expect(USE_CASE_NODE_TYPES.length).toBeGreaterThan(0)
  })

  for (const type of USE_CASE_NODE_TYPES) {
    const d = usecaseDescriptor(type)
    const kind = d.resultKind
    const expected = [EXPECTED[kind][0]!, ...(MULTICAM_TYPES.has(type) ? ["useCaseCameras"] : []), ...EXPECTED[kind].slice(1)]
    it(`${type} (${kind}): its last run's keys are exactly its kind's${MULTICAM_TYPES.has(type) ? ", and its cameras report" : ""}`, () => {
      expect(RUN_RESULT_TYPE_KEYS[type]).toEqual(expected)
      for (const key of expected) expect(isRunResultKey(key, type), key).toBe(true)
    })
  }

  it("the cameras report is a key of exactly the types that take several recordings", () => {
    expect(USE_CASE_NODE_TYPES.filter((t) => usecaseDescriptor(t).maxRecordings > 1).sort()).toEqual([...MULTICAM_TYPES].sort())
    expect(isRunResultKey("useCaseCameras", "episode-chapters")).toBe(false)
    expect(isRunResultKey("useCaseCameras", "generate-image")).toBe(false)
  })

  it("Trailer's failed formats are a key of its last run (written out, not read off its kind)", () => {
    expect(isRunResultKey("failedFormats", "episode-trailer")).toBe(true)
    expect(isRunResultKey("failedClips", "episode-trailer")).toBe(false)
  })

  it("a list kind's key is that type's only, never a key cleared on every node", () => {
    expect(isRunResultKey("failedFormats", "generate-image")).toBe(false)
    expect(isRunResultKey("failedClips", "generate-image")).toBe(false)
    expect(isRunResultKey("failedFormats", null)).toBe(false)
  })
})
