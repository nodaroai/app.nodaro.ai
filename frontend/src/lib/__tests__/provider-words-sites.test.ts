// @test-watches frontend/src/**/*.{ts,tsx}
import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * A failed node shows two texts: the sentence the platform wrote (`errorMessage`) and, under it,
 * the provider's own words about that failure (`errorDetail`, from the job's `error_detail`).
 * These guards keep the words travelling with the sentence, so a failure never shows its sentence
 * without its words, or an earlier failure's words under a later sentence.
 *
 *  1. Where a failed job's sentence is read (`job.error_message`), its words are named nearby:
 *     a failure written onto a node takes both from the job (`errorDetail: job.error_detail`),
 *     and an error built from the sentence is built by `failedJobError` (lib/failed-job-error.ts).
 *  2. A rejection built from a failed job's sentence carries the words: never
 *     `new Error(job.error_message …)`, and never `new Error(errMsg)` whose `errMsg` was read
 *     from a job.
 *  3. A poll that writes nothing onto its node (the scrape, use-case text and URL polls) leaves
 *     the failure to its caller, so a catch that writes the failure's sentence reads the words
 *     back (`caughtErrorWords`). A catch that writes no sentence (a toast, a side status) has
 *     nothing to pair them with.
 *  4. A patch merged into a node's data by hand (`{ ...n.data, ...patch }`) is counted: the one
 *     merge (`mergeNodeData`, lib/node-data-merge.ts) is what lets an earlier failure's words go
 *     when a later sentence arrives, and a new funnel that merges by hand would skip it.
 *  5. A run's node state shows its sentence (`{state.error}` in a screen) with its words: through
 *     `NodeStateErrorText` (components/editor/node-state-error-text.tsx), or beside
 *     `state.errorDetail`.
 *
 * A line the rules cannot read right carries `// provider-words-ok: <reason>` on it or on one of
 * the three lines above. A file whose every hit is fine for one reason is listed below with the
 * number of hits, so a NEW site in a listed file still fails until it is looked at.
 *
 * What escapes the patterns: a sentence read by destructuring (`const { error_message } = job`),
 * a rejection whose sentence sits in a variable not named `errMsg`, a hand merge that is not
 * written into a `data:` literal (`const merged = { ...d, ...patch }`, or `Object.assign` onto a
 * copy, as the reopen of a run does) or one that names its keys after the spread
 * (`{ ...n.data, errorMessage }`). The behavioural tests of each lane cover those writes.
 */

const SRC = join(__dirname, "..", "..")

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : []
  })
}

interface Source {
  readonly rel: string
  readonly text: string
  readonly lines: readonly string[]
}

const SOURCES: readonly Source[] = sourceFiles(SRC).map((full) => {
  const text = readFileSync(full, "utf8")
  return { rel: relative(SRC, full).split(sep).join("/"), text, lines: text.split(/\r?\n/) }
})

const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line)
const MARKER = /\/\/ provider-words-ok: \S/
const marked = (lines: readonly string[], i: number) => lines.slice(Math.max(0, i - 3), i + 1).some((l) => MARKER.test(l))

/** Files that show a failed job's sentence in a place of their own, each for a stated reason. */
const SENTENCE_ELSEWHERE: Record<string, { readonly reads: number; readonly rejections: number; readonly reason: string }> = {
  "hooks/use-app-runner-store.ts": { reads: 2, rejections: 0, reason: "a published app's runner: the provider's words are the owner's, never the runner's" },
  "hooks/use-presentation-store.ts": { reads: 1, rejections: 0, reason: "a published app's run view: the provider's words are the owner's, never the runner's" },
  "ee/app/(admin)/admin/trends/components/FaceMaskPanel.tsx": { reads: 1, rejections: 0, reason: "a trend job: the job read withholds a trend run's words" },
  "ee/app/(admin)/admin/trends/components/SlotDefaultImages.tsx": { reads: 1, rejections: 0, reason: "a trend job: the job read withholds a trend run's words" },
  "ee/app/(admin)/admin/trends/components/UpscalePanel.tsx": { reads: 1, rejections: 0, reason: "a trend job: the job read withholds a trend run's words" },
  "ee/app/(admin)/admin/jobs/page.tsx": { reads: 2, rejections: 0, reason: "a list row's cut sentence; the job's dialog on the same page shows the words" },
  "ee/hooks/queries/use-admin-queries.ts": { reads: 1, rejections: 0, reason: "maps a list row; the job's dialog reads the whole job, words included" },
  "ee/app/(admin)/admin/app-reports/page.tsx": { reads: 3, rejections: 0, reason: "a report's job sentence; the report's full payload, shown below it, carries the words" },
  "components/editor/config-panels/refine-regions-section.tsx": { reads: 1, rejections: 1, reason: "region detection: the panel shows its own message, and the node does not fail" },
  "lib/youtube-audio-extraction.ts": { reads: 1, rejections: 1, reason: "a link's audio extraction: the node shows an extraction status, never the job's sentence" },
}

/**
 * Burn-down: a failure a person sees with its sentence but without the provider's words yet.
 * Entity pages, studios and sheets poll their own jobs and hold no canvas node. Only shrinks.
 */
const WORDS_NOT_SHOWN_YET: Record<string, { readonly reads: number; readonly rejections: number }> = {
  "components/editor/character-page-modal.tsx": { reads: 3, rejections: 3 },
  "components/editor/object-page-modal.tsx": { reads: 3, rejections: 3 },
  "components/editor/character-studio/use-character-studio-jobs.ts": { reads: 1, rejections: 1 },
  "components/editor/reference-sheet/poll-sheet-job.ts": { reads: 1, rejections: 1 },
  "components/editor/reference-sheet/sheet-tab-adapter.ts": { reads: 1, rejections: 1 },
  "components/editor/scene-editor-modal.tsx": { reads: 1, rejections: 1 },
  "components/editor/workflow-editor/scene-story-handlers.ts": { reads: 1, rejections: 1 },
  "routes/video-director-page.tsx": { reads: 1, rejections: 0 },
}

const READS_SENTENCE = /\b[A-Za-z_$][\w$]*\??\.error_message\b/
const NAMES_WORDS = /error_detail|failedJobError\(/
const WRITES_FAILURE = /\berrorMessage\s*:/
const WINDOW = 12

/** Rule 1: lines that read a failed job's sentence with no word of its words nearby. */
function sentenceReadsWithoutWords(lines: readonly string[]): readonly number[] {
  const hits: number[] = []
  lines.forEach((line, i) => {
    if (isComment(line) || !READS_SENTENCE.test(line)) return
    const window = lines.slice(i, i + WINDOW + 1).join("\n")
    // A failure written onto a node takes the job's words itself: the error the poll then ends
    // with goes to a caller that writes nothing. An error built alone carries them (failedJobError).
    if (WRITES_FAILURE.test(window) ? /error_detail/.test(window) : NAMES_WORDS.test(window)) return
    if (marked(lines, i)) return
    hits.push(i + 1)
  })
  return hits
}

const BUILT_FROM_SENTENCE = /new Error\(\s*(?:executionErrorText\(\s*)?[A-Za-z_$][\w$]*\??\.error_message\b/

/** Rule 2: rejections built from a failed job's sentence that carry nothing else. */
function rejectionsWithoutWords(lines: readonly string[]): readonly number[] {
  const hits: number[] = []
  lines.forEach((line, i) => {
    if (isComment(line) || marked(lines, i)) return
    if (BUILT_FROM_SENTENCE.test(line)) {
      hits.push(i + 1)
      return
    }
    if (!line.includes("new Error(errMsg)")) return
    for (let j = i; j >= Math.max(0, i - 80); j--) {
      if (!/\berrMsg\s*=/.test(lines[j]!)) continue
      if (lines.slice(j, j + 3).join(" ").includes(".error_message")) hits.push(i + 1)
      return
    }
  })
  return hits
}

const WORDLESS_POLL_CALL = /\b(?:pollScrapeJobOutput|pollJobOutputWithEnd|pollUseCaseTextJob|pollJobToCompletion)\(/
const WORDLESS_POLL_HOMES = new Set(["components/editor/workflow-editor/poll-job.ts", "components/editor/workflow-editor/use-case-text-poll.ts"])
const READS_WORDS_BACK = /caughtErrorWords\(|\.errorDetail\b/
/** A catch that writes a failure's sentence: the field itself, or a node's own failure patch (`applyWebScrapeFailure`). */
const WRITES_SENTENCE = /\berrorMessage\b|Failure\(/

/** Callers whose catch is not next to the call, each with the proof that it reads the words back. */
const WORDLESS_POLL_CALLERS: Record<string, { readonly calls: number; readonly reason: string; readonly proof: RegExp }> = {
  "components/editor/workflow-editor/ugc-execute.ts": {
    calls: 6,
    reason: "every UGC run ends in guardedRun, whose catch names the words from the caught error",
    proof: /errorDetail: \(err as \{ errorDetail\?: unknown \} \| null\)\?\.errorDetail/,
  },
}

/** Rule 3: calls of a poll that writes nothing onto its node, whose next catch writes a sentence and reads no words back. */
function pollCallsWithoutWordsBack(lines: readonly string[]): readonly number[] {
  const hits: number[] = []
  lines.forEach((line, i) => {
    if (isComment(line) || !WORDLESS_POLL_CALL.test(line) || /\bfunction\b/.test(line) || marked(lines, i)) return
    for (let k = i + 1; k <= Math.min(lines.length - 1, i + 60); k++) {
      if (isComment(lines[k]!) || !/\bcatch\b/.test(lines[k]!)) continue
      const handled = lines.slice(k, k + 26).join("\n")
      if (!WRITES_SENTENCE.test(handled) || READS_WORDS_BACK.test(handled)) return
      break
    }
    hits.push(i + 1)
  })
  return hits
}

/** Hand merges of a patch into a node's data, each for a stated reason. */
const HAND_MERGES: Record<string, { readonly count: number; readonly reason: string }> = {
  "components/editor/workflow-editor/execute-node.ts": { count: 1, reason: "builds a run's stand-in node for the inner execution; nothing is written" },
  "components/templates/read-only-canvas.tsx": { count: 1, reason: "a template preview's derived parts; read-only, never a run's failure" },
  "hooks/use-workflow-store.ts": { count: 1, reason: "an edge's data, not a node's" },
  "lib/add-face-tracking.ts": { count: 1, reason: "builds the inserted node from the frames node's own data; no failure is written" },
  "lib/entity-node-data.ts": { count: 1, reason: "builds the patch it hands to updateNodeData, which merges through the one merge" },
  "lib/replace-render-node.ts": { count: 1, reason: "a new node's own data; no failure is carried over" },
  "lib/use-case-audio-lock.ts": { count: 2, reason: "an audio-lock settings patch; it never writes a failure" },
}

const HAND_MERGE = /\.\.\.\(?\s*[A-Za-z_$][\w$]*(?:\??\.[\w$]+)*\??\.data\b(?:\s+as\s+[^,)}]+)?\s*\)?\s*,\s*\.\.\./g
/** The same merge from a local copy, written into a node's `data:` (`{ ...node, data: { ...d, ...patch } }`). */
const HAND_MERGE_FROM_COPY = /\bdata:\s*\{\s*\.\.\.\(?\s*[A-Za-z_$][\w$]*(?:\s+as\s+[^,)}]+)?\s*\)?\s*,\s*\.\.\./g

function handMerges(text: string): readonly number[] {
  return [...text.matchAll(HAND_MERGE), ...text.matchAll(HAND_MERGE_FROM_COPY)].map((m) => text.slice(0, m.index).split(/\r?\n/).length)
}

const SHOWS_STATE_SENTENCE = /\{\s*(?:node)?[sS]tate\.error\s*\}/
const STATE_WORDS_NEAR = 8

/** Rule 5: screen lines that show a node state's sentence with no word of its words nearby. */
function stateSentencesWithoutWords(lines: readonly string[]): readonly number[] {
  const hits: number[] = []
  lines.forEach((line, i) => {
    if (!SHOWS_STATE_SENTENCE.test(line) || marked(lines, i)) return
    const near = lines.slice(Math.max(0, i - STATE_WORDS_NEAR), i + STATE_WORDS_NEAR + 1).join("\n")
    if (!/errorDetail/.test(near)) hits.push(i + 1)
  })
  return hits
}

/** `{ file: [lines] }` for every file with a hit, so a failure names where to look. */
function census(find: (s: Source) => readonly number[]): Record<string, readonly number[]> {
  return Object.fromEntries(SOURCES.map((s) => [s.rel, find(s)] as const).filter(([, hits]) => hits.length > 0))
}

const known = (rel: string) => SENTENCE_ELSEWHERE[rel] ?? WORDS_NOT_SHOWN_YET[rel]

describe("a failed job's sentence travels with the provider's words", () => {
  it("the scan reaches the engine's polls (guard against a vacuous pass)", () => {
    const rels = new Set(SOURCES.map((s) => s.rel))
    for (const must of [
      "components/editor/workflow-editor/poll-job.ts",
      "components/editor/workflow-editor/execute-node.ts",
      "components/editor/workflow-editor/asset-executors.ts",
      "hooks/use-workflow-store.ts",
      "lib/failed-job-error.ts",
    ]) expect(rels, must).toContain(must)
  })

  it("1. a read of a failed job's sentence names its words nearby", () => {
    const unexplained = Object.fromEntries(Object.entries(census((s) => sentenceReadsWithoutWords(s.lines))).filter(([rel]) => !known(rel)))
    expect(
      unexplained,
      "a failure written from this sentence needs the job's words beside it (`errorDetail: job.error_detail ?? undefined`), and an error built from it needs `failedJobError` (lib/failed-job-error.ts)",
    ).toEqual({})
  })

  it("2. a rejection built from a failed job's sentence carries the words", () => {
    const unexplained = Object.fromEntries(Object.entries(census((s) => rejectionsWithoutWords(s.lines))).filter(([rel]) => !known(rel)))
    expect(unexplained, "build it with failedJobError(sentence, job) (lib/failed-job-error.ts), so whoever catches it can show the words").toEqual({})
  })

  it("3. a caller of a poll that writes nothing onto its node reads the words back in its catch", () => {
    const unexplained = Object.fromEntries(
      Object.entries(census((s) => (WORDLESS_POLL_HOMES.has(s.rel) || WORDLESS_POLL_CALLERS[s.rel] ? [] : pollCallsWithoutWordsBack(s.lines)))),
    )
    expect(unexplained, "the catch that writes this failure needs `...caughtErrorWords(err)` (lib/failed-job-error.ts)").toEqual({})
  })

  it("3b. a caller whose catch is elsewhere keeps the catch that reads the words, and its calls stay countable", () => {
    for (const [rel, { calls, proof }] of Object.entries(WORDLESS_POLL_CALLERS)) {
      const source = SOURCES.find((s) => s.rel === rel)
      expect(source, `${rel} is gone — drop it from WORDLESS_POLL_CALLERS`).toBeDefined()
      expect(proof.test(source!.text), `${rel} no longer reads the words back where its runs end`).toBe(true)
      const count = source!.lines.filter((l) => !isComment(l) && WORDLESS_POLL_CALL.test(l) && !/\bfunction\b/.test(l)).length
      expect(count, `${rel}: a new poll call — confirm its failure ends where the words are read, then update the count`).toBe(calls)
    }
  })

  it("4. a patch merged into a node's data by hand is one of the known ones", () => {
    const found = census((s) => handMerges(s.text))
    const unexplained = Object.fromEntries(Object.entries(found).filter(([rel, lines]) => HAND_MERGES[rel]?.count !== lines.length))
    expect(
      unexplained,
      "merge a node-data patch through mergeNodeData (lib/node-data-merge.ts), or, when it writes no failure, list the file in HAND_MERGES with its reason",
    ).toEqual({})
    for (const rel of Object.keys(HAND_MERGES)) expect(found[rel], `${rel} has no hand merge any more — drop it from HAND_MERGES`).toBeDefined()
  })

  it("5. a run's node state shows its sentence with its words", () => {
    const unexplained = census((s) => (s.rel.endsWith(".tsx") ? stateSentencesWithoutWords(s.lines) : []))
    expect(unexplained, "render a node state's error through NodeStateErrorText (components/editor/node-state-error-text.tsx), or show state.errorDetail beside it").toEqual({})
  })

  it("the files that show the sentence elsewhere, and the burn-down, stay countable and current", () => {
    const reads = census((s) => sentenceReadsWithoutWords(s.lines))
    const rejections = census((s) => rejectionsWithoutWords(s.lines))
    for (const [rel, entry] of [...Object.entries(SENTENCE_ELSEWHERE), ...Object.entries(WORDS_NOT_SHOWN_YET)]) {
      expect([reads[rel]?.length ?? 0, rejections[rel]?.length ?? 0], `${rel}: [reads, rejections] — a new site there needs its own look`).toEqual([entry.reads, entry.rejections])
    }
    for (const rel of Object.keys(WORDS_NOT_SHOWN_YET)) expect(SENTENCE_ELSEWHERE[rel], `${rel} is listed twice`).toBeUndefined()
  })
})
