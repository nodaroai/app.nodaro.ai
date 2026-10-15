import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The ALLOW proof (decided 2026-10-15): a stored object is the user's only when
 * the platform recorded the user as its maker.
 *
 * The deny-proof before it ("is this key claimed by another user?") answered
 * NO for every object no row claims — operator files, plugin artifacts and
 * caches, objects whose rows are gone — so a library row that merely NAMED
 * such a key made it deletable. `POST /v1/library/save-generated` wrote such a
 * row for any url on our storage. Ingestion (the writers that record a url a
 * caller names) and deletion (every path that deletes an object a row names)
 * now ask the same question, through the functions below.
 */

vi.mock("../supabase.js", () => ({ supabase: { from: vi.fn() } }))

const relayGate = vi.hoisted(() => ({ on: false }))
vi.mock("../relay-possible.js", () => ({ relayPossible: () => relayGate.on }))

const configMock = vi.hoisted(() => ({
  config: {
    R2_PUBLIC_URL: "https://cdn.test" as string | undefined,
    R2_PUBLIC_FALLBACK_DOMAIN: "fallback.test" as string | undefined,
  },
}))
vi.mock("../config.js", () => configMock)

import { supabase } from "../supabase.js"
import {
  isCanonicalObjectKey,
  isRecordedReference,
  keysHeldByOtherLibraryRows,
  judgeAssetRows,
  recordedReferenceByShape,
  _resetRecordedReferenceColumnForTests,
  judgeKeys,
  judgeKeyEntries,
  keysProvablyOwnedBy,
  keysUserMayDelete,
  ownKeysOnly,
  judgeUrlForRecording,
  judgeAssetRowDelete,
} from "../key-ownership.js"

// ---------------------------------------------------------------------------
// An in-memory `jobs` + `assets` pair that records every read it answers.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
interface Db {
  jobs: Row[]
  assets: Row[]
  fail?: Partial<Record<"jobs" | "assets", string>>
  /** A database migration 528 has not reached yet: no `recorded_reference` column. */
  noFlagColumn?: boolean
}
type Read = { table: string; select: string; filters: Array<[string, string, unknown]>; range?: [number, number]; limit?: number }

/** PostgREST's `max_rows` (supabase/config.toml): a read returns at most this many rows. */
const MAX_ROWS = 1000

let reads: Read[] = []

function useDb(db: Db): void {
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const read: Read = { table, select: "", filters: [] }
    reads.push(read)
    const tests: Array<(r: Row) => boolean> = []
    let ordered = false
    const chain: Record<string, unknown> = {
      select(cols: string) {
        read.select = cols
        return chain
      },
      eq(col: string, v: unknown) {
        read.filters.push(["eq", col, v])
        tests.push((r) => r[col] === v)
        return chain
      },
      in(col: string, vs: unknown[]) {
        read.filters.push(["in", col, vs])
        tests.push((r) => vs.includes(r[col]))
        return chain
      },
      gt(col: string, v: unknown) {
        read.filters.push(["gt", col, v])
        tests.push((r) => String(r[col]) > String(v))
        return chain
      },
      order() {
        ordered = true
        return chain
      },
      range(from: number, to: number) {
        read.range = [from, to]
        return chain
      },
      limit(n: number) {
        read.limit = n
        return chain
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        const failure = db.fail?.[table as "jobs" | "assets"]
        const missingColumn = db.noFlagColumn && table === "assets" && read.select.includes("recorded_reference")
        let rows = ((db[table as "jobs" | "assets"] ?? []) as Row[]).filter((r) => tests.every((t) => t(r)))
        if (ordered) rows = [...rows].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0))
        rows = read.range ? rows.slice(read.range[0], read.range[1] + 1) : rows
        rows = read.limit !== undefined ? rows.slice(0, read.limit) : rows
        rows = rows.slice(0, MAX_ROWS)
        const strip = (r: Row): Row => {
          if (!db.noFlagColumn) return r
          const { recorded_reference: _flag, ...rest } = r
          return rest
        }
        const result = failure
          ? { data: null, error: { message: failure } }
          : missingColumn
            ? { data: null, error: { code: "42703", message: "column assets.recorded_reference does not exist" } }
            : { data: rows.map(strip), error: null }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return chain
  }) as never)
}

const SELF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const SELF_JOB = "11111111-1111-4111-8111-111111111111"
const OTHER_JOB = "22222222-2222-4222-8222-222222222222"
const GONE_JOB = "33333333-3333-4333-8333-333333333333"
const UPLOAD_ID = "44444444-4444-4444-8444-444444444444"

const SELF_OUTPUT = `images/${SELF_JOB}.png`
const SELF_STEM_OUTPUT = `audios/${SELF_JOB}-vocals.mp3`
const OTHER_OUTPUT = `videos/${OTHER_JOB}.mp4`
const ORPHAN_OUTPUT = `images/${GONE_JOB}.png`
const UPLOAD_KEY = `uploads/images/${UPLOAD_ID}.png`
const OPERATOR_KEY = "brand/makers/acme.svg"

const JOBS: Row[] = [
  { id: SELF_JOB, user_id: SELF, relay_job_id: null },
  { id: OTHER_JOB, user_id: OTHER, relay_job_id: null },
]

/**
 * The row `POST /v1/library/save-generated` wrote: no job, no size — and, as
 * migration 528's insert trigger stamps every such row, `recorded_reference`.
 */
const saveRow = (user: string, key: string, id = `save-${key}`): Row => ({
  id,
  r2_key: key,
  user_id: user,
  upload_source: "generated",
  job_id: null,
  size_bytes: 0,
  pipeline_id: null,
  pipeline_entity_id: null,
  relay_job_id: null,
  recorded_reference: true,
})
/** The row `POST /v1/upload` wrote when it stored the bytes (an origin row). */
const uploadRow = (user: string, key: string, id = `upload-${key}`): Row => ({
  id,
  r2_key: key,
  user_id: user,
  upload_source: "manual_upload",
  job_id: null,
  size_bytes: 2048,
  pipeline_id: null,
  pipeline_entity_id: null,
  relay_job_id: null,
  recorded_reference: false,
})

beforeEach(() => {
  vi.clearAllMocks()
  reads = []
  relayGate.on = false
  configMock.config.R2_PUBLIC_URL = "https://cdn.test"
  configMock.config.R2_PUBLIC_FALLBACK_DOMAIN = "fallback.test"
  _resetRecordedReferenceColumnForTests()
})

// ---------------------------------------------------------------------------

describe("isCanonicalObjectKey — the one spelling a key may have", () => {
  it.each([
    [SELF_OUTPUT],
    [UPLOAD_KEY],
    [`uploads/image/${SELF}/${UPLOAD_ID}.png`],
    ["videos/yt-0f1e2d3c-aaaa-4bbb-8ccc-0123456789ab.mp4"],
    [OPERATOR_KEY],
  ])("accepts %s", (key) => {
    expect(isCanonicalObjectKey(key)).toBe(true)
  })

  it.each([
    ["the empty key", ""],
    ["a leading slash", `/${SELF_OUTPUT}`],
    ["a trailing slash", "images/"],
    ["an empty segment", `images//${SELF_JOB}.png`],
    ["a parent segment", `images/../${OPERATOR_KEY}`],
    ["a current segment", `./${SELF_OUTPUT}`],
    ["a lone parent", ".."],
    ["a backslash", `images\\${SELF_JOB}.png`],
    ["a percent escape", "images/%2e%2e/brand.svg"],
    ["a query", `${SELF_OUTPUT}?v=1`],
    ["a fragment", `${SELF_OUTPUT}#x`],
    ["a NUL", `images/${SELF_JOB}\u0000.png`],
    ["a newline", `images/\n${SELF_JOB}.png`],
    ["an overlong key", `images/${"a".repeat(1100)}.png`],
  ])("refuses %s", (_name, key) => {
    expect(isCanonicalObjectKey(key)).toBe(false)
  })
})

describe("isRecordedReference — the stored flag decides, never the columns that can change", () => {
  it("reads `assets.recorded_reference` when the row carries it", () => {
    expect(isRecordedReference(saveRow(SELF, OPERATOR_KEY))).toBe(true)
    expect(isRecordedReference(uploadRow(SELF, UPLOAD_KEY))).toBe(false)
  })

  it("HIGH: a pipeline image row whose entity was since deleted (its pointer NULLed) stays a reference", () => {
    // `pipeline_entity_id` is ON DELETE SET NULL; the flag was written at insert.
    const orphanedAttach = { ...uploadRow(SELF, OPERATOR_KEY), pipeline_entity_id: null, size_bytes: 5_000_000_000, recorded_reference: true }
    expect(isRecordedReference(orphanedAttach)).toBe(true)
  })

  it("an admin's promote/demote rewriting upload_source cannot turn a reference into an origin", () => {
    expect(isRecordedReference({ ...saveRow(SELF, OPERATOR_KEY), upload_source: "manual_upload", size_bytes: 10 })).toBe(true)
  })
})

/**
 * The classification migration 528 runs on every insert (and ran once over
 * every existing row) — `public.asset_recorded_reference_by_shape` — and its
 * JS twin, used only while a database lacks the column (staging runs dev code
 * before main applies 528). `supabase/tests/assets-recorded-reference.behavior.sql`
 * inserts the same rows and asserts the same answers.
 */
describe("recordedReferenceByShape — migration 528's classification, row by row", () => {
  const J = SELF_JOB
  /** A job id with letters in it, for the case rows. */
  const LJ = "abcdef01-abcd-4abc-8abc-abcdefabcdef"
  const row = (over: Row): Row => ({
    upload_source: "manual_upload", job_id: null, size_bytes: 10, pipeline_id: null, pipeline_entity_id: null, relay_job_id: null, ...over,
  })
  it.each([
    ["a library save", row({ upload_source: "generated", size_bytes: 0, r2_key: `images/${OTHER_JOB}.png` }), true],
    ["a pipeline entity's attached image", row({ pipeline_entity_id: "e1", r2_key: UPLOAD_KEY }), true],
    ["a pipeline image row (pipeline pointer only)", row({ pipeline_id: "p1", r2_key: UPLOAD_KEY }), true],
    ["an attach row whose entity is gone, naming an operator file", row({ size_bytes: 5_000_000_000, r2_key: OPERATOR_KEY }), true],
    ["an upload (POST /v1/upload)", row({ r2_key: UPLOAD_KEY }), false],
    ["a legacy-route upload key nobody's row stored", row({ r2_key: `uploads/${UPLOAD_ID}.png` }), true],
    ["a relayed output", row({ upload_source: "generated", job_id: J, relay_job_id: "far-1", r2_key: `images/${GONE_JOB}.png` }), true],
    ["a generation's own output", row({ upload_source: "generated", job_id: J, size_bytes: 0, r2_key: SELF_OUTPUT }), false],
    ["a generation's suffixed side file", row({ upload_source: "generated", job_id: J, r2_key: SELF_STEM_OUTPUT }), false],
    ["a generation's row for an operator url its output repeated", row({ upload_source: "generated", job_id: J, r2_key: OPERATOR_KEY }), true],
    ["a generation's row for another job's output", row({ upload_source: "generated", job_id: J, r2_key: OTHER_OUTPUT }), true],
    ["a generation's row whose job was deleted (size recorded)", row({ upload_source: "generated", size_bytes: 4096, r2_key: ORPHAN_OUTPUT }), false],
    ["MEDIUM 2: an orphaned generation row naming a UUID-named key outside the output folders", row({ upload_source: "generated", size_bytes: 4096, r2_key: `uploads/${UPLOAD_ID}.png` }), true],
    ["a url saved off our storage", row({ upload_source: "generated", size_bytes: 0, r2_key: "https://example.com/cat.png" }), true],
    ["a scraped video (filed under its job)", row({ upload_source: "url_import", job_id: J, size_bytes: 0, r2_key: "videos/scrape-123-11111111.mp4" }), false],
    ["a url import", row({ upload_source: "url_import", r2_key: `uploads/images/${UPLOAD_ID}.jpg` }), false],
    ["a social download", row({ upload_source: "social_download", r2_key: `videos/yt-${UPLOAD_ID}.mp4` }), false],
    ["a processed file", row({ upload_source: "media_process", r2_key: `uploads/video/${UPLOAD_ID}.mp4` }), false],
    ["a timeline export", row({ upload_source: "job", r2_key: `exports/${SELF}/timeline-${UPLOAD_ID}.json` }), false],
    ["a final merge (filed under its job and pipeline, no size)", row({ upload_source: "job", job_id: J, size_bytes: 0, pipeline_id: "p1", r2_key: `${J}.mp4` }), false],
    ["a timeline export filed under its pipeline", row({ upload_source: "job", pipeline_id: "p1", r2_key: `pipelines/p1/exports/timeline-${UPLOAD_ID}.json` }), false],
    ["a generation's output later linked to a pipeline entity", row({ upload_source: "generated", job_id: J, pipeline_id: "p1", pipeline_entity_id: "e1", r2_key: SELF_OUTPUT }), false],
    ["a data upload", row({ r2_key: `uploads/datas/${UPLOAD_ID}.csv` }), false],
    ["an upload key spelled in upper case (the shape is case-blind)", row({ r2_key: `uploads/images/${UPLOAD_ID.toUpperCase()}.PNG` }), false],
    ["a generation's row naming its job id in upper case (the family is not)", row({ upload_source: "generated", job_id: LJ, r2_key: `images/${LJ.toUpperCase()}.png` }), true],
    ["an orphaned generation row, its output spelled in upper case", row({ upload_source: "generated", size_bytes: 4096, r2_key: `images/${LJ.toUpperCase()}.png` }), false],
    ["a row of unknown provenance (legacy api)", row({ upload_source: "api", r2_key: `images/${GONE_JOB}.png` }), true],
    ["a promoted row (library)", row({ upload_source: "library", r2_key: UPLOAD_KEY }), true],
    ["a row with no upload_source", row({ upload_source: null, r2_key: UPLOAD_KEY }), true],
    ["a size-less row with no job, whatever its source", row({ upload_source: "url_import", size_bytes: 0, r2_key: UPLOAD_KEY }), true],
    ["a row naming no key", row({ upload_source: "generated", size_bytes: 0, r2_key: null }), false],
  ])("%s", (_name, r, expected) => {
    expect(recordedReferenceByShape(r as never)).toBe(expected)
  })
})

describe("judgeKeys — whose object", () => {
  it("ATTACK: a generation's row naming a url its output merely repeated proves nothing", async () => {
    // e.g. an output that hands its input url straight back: the worker files
    // it, and 528's insert trigger flags it.
    useDb({
      jobs: JOBS,
      assets: [{ ...saveRow(SELF, OPERATOR_KEY), job_id: SELF_JOB, size_bytes: 9000 }],
    })
    expect((await judgeKeys(SELF, [OPERATOR_KEY])).get(OPERATOR_KEY)).toEqual({ owned: false, claimedByOthers: false })
  })

  it("HIGH: a pipeline image row whose entity was deleted is still no proof, and refunds nothing", async () => {
    const orphanedAttach = { ...uploadRow(SELF, OPERATOR_KEY, "p9"), size_bytes: 5_000_000_000, recorded_reference: true }
    useDb({ jobs: JOBS, assets: [orphanedAttach] })
    expect((await judgeKeys(SELF, [OPERATOR_KEY])).get(OPERATOR_KEY)).toEqual({ owned: false, claimedByOthers: false })
    expect(await judgeAssetRowDelete(SELF, { id: "p9", r2_key: OPERATOR_KEY })).toEqual({
      owned: false,
      deleteObject: false,
      refundable: false,
    })
  })

  it("MEDIUM 2: an orphaned generation row naming a UUID-named operator key outside its family is no proof", async () => {
    const legacyKey = `uploads/${UPLOAD_ID}.png`
    const orphan = { ...saveRow(SELF, legacyKey, "o9"), size_bytes: 4096, recorded_reference: true }
    useDb({ jobs: JOBS, assets: [orphan] })
    expect((await judgeKeys(SELF, [legacyKey])).get(legacyKey)).toEqual({ owned: false, claimedByOthers: false })
    // ...nor before 528, read by the twin.
    useDb({ jobs: JOBS, assets: [orphan], noFlagColumn: true })
    _resetRecordedReferenceColumnForTests()
    expect((await judgeKeys(SELF, [legacyKey])).get(legacyKey)).toEqual({ owned: false, claimedByOthers: false })
  })

  it("own job's output (and its suffixed siblings): owned, nobody else's", async () => {
    useDb({ jobs: JOBS, assets: [] })
    const v = await judgeKeys(SELF, [SELF_OUTPUT, SELF_STEM_OUTPUT])
    expect(v.get(SELF_OUTPUT)).toEqual({ owned: true, claimedByOthers: false })
    expect(v.get(SELF_STEM_OUTPUT)).toEqual({ owned: true, claimedByOthers: false })
  })

  it("another user's job output: not owned, claimed — even with the caller's own origin-looking row", async () => {
    useDb({ jobs: JOBS, assets: [uploadRow(SELF, OTHER_OUTPUT)] })
    expect((await judgeKeys(SELF, [OTHER_OUTPUT])).get(OTHER_OUTPUT)).toEqual({ owned: false, claimedByOthers: true })
  })

  it("the caller's upload namespace: owned without asking jobs; another's: claimed", async () => {
    useDb({ jobs: JOBS, assets: [] })
    const mine = `uploads/image/${SELF}/${UPLOAD_ID}.png`
    const handoff = `uploads/handoff/video/${SELF}/${UPLOAD_ID}`
    const theirs = `uploads/image/${OTHER}/${UPLOAD_ID}.png`
    const v = await judgeKeys(SELF, [mine, handoff, theirs])
    expect(v.get(mine)).toEqual({ owned: true, claimedByOthers: false })
    expect(v.get(handoff)).toEqual({ owned: true, claimedByOthers: false })
    expect(v.get(theirs)).toEqual({ owned: false, claimedByOthers: true })
  })

  it("the other per-user folders the server mints: community clones and timeline exports", async () => {
    useDb({ jobs: JOBS, assets: [] })
    const clone = `user-clones/${SELF}/${UPLOAD_ID}/${UPLOAD_ID}.png`
    const exported = `exports/${SELF}/timeline-${UPLOAD_ID}.json`
    const theirs = `user-clones/${OTHER}/${UPLOAD_ID}/${UPLOAD_ID}.png`
    const v = await judgeKeys(SELF, [clone, exported, theirs])
    expect(v.get(clone)).toEqual({ owned: true, claimedByOthers: false })
    expect(v.get(exported)).toEqual({ owned: true, claimedByOthers: false })
    expect(v.get(theirs)).toEqual({ owned: false, claimedByOthers: true })
  })

  it("the row the upload wrote is the proof for a key that names no maker", async () => {
    useDb({ jobs: JOBS, assets: [uploadRow(SELF, UPLOAD_KEY)] })
    expect((await judgeKeys(SELF, [UPLOAD_KEY])).get(UPLOAD_KEY)).toEqual({ owned: true, claimedByOthers: false })
    // ...and claims it against everyone else.
    expect((await judgeKeys(OTHER, [UPLOAD_KEY])).get(UPLOAD_KEY)).toEqual({ owned: false, claimedByOthers: true })
  })

  it("ATTACK: an operator file the caller merely saved to their library is not theirs", async () => {
    useDb({ jobs: JOBS, assets: [saveRow(SELF, OPERATOR_KEY)] })
    expect((await judgeKeys(SELF, [OPERATOR_KEY])).get(OPERATOR_KEY)).toEqual({ owned: false, claimedByOthers: false })
    expect(await keysUserMayDelete(SELF, [OPERATOR_KEY])).toEqual(new Set())
  })

  it("ATTACK: a pipeline attach row naming an operator file is not proof either", async () => {
    useDb({
      jobs: JOBS,
      assets: [{ ...uploadRow(SELF, OPERATOR_KEY), pipeline_entity_id: "entity-1", size_bytes: 5_000_000_000, recorded_reference: true }],
    })
    expect((await judgeKeys(SELF, [OPERATOR_KEY])).get(OPERATOR_KEY)).toEqual({ owned: false, claimedByOthers: false })
  })

  it("a key no row and no job names is nobody's — never deletable", async () => {
    useDb({ jobs: JOBS, assets: [] })
    expect((await judgeKeys(SELF, [OPERATOR_KEY])).get(OPERATOR_KEY)).toEqual({ owned: false, claimedByOthers: false })
  })

  it("own object another user's library also holds: owned, but claimed (kept on delete, savable)", async () => {
    useDb({ jobs: JOBS, assets: [uploadRow(SELF, UPLOAD_KEY), saveRow(OTHER, UPLOAD_KEY)] })
    expect((await judgeKeys(SELF, [UPLOAD_KEY])).get(UPLOAD_KEY)).toEqual({ owned: true, claimedByOthers: true })
    expect(await keysProvablyOwnedBy(SELF, [UPLOAD_KEY])).toEqual(new Set([UPLOAD_KEY]))
    expect(await keysUserMayDelete(SELF, [UPLOAD_KEY])).toEqual(new Set())
  })

  it("an output whose job was deleted from history: the worker's row (size recorded) still proves it", async () => {
    useDb({ jobs: JOBS, assets: [{ ...saveRow(SELF, ORPHAN_OUTPUT), size_bytes: 4096, recorded_reference: false }] })
    expect((await judgeKeys(SELF, [ORPHAN_OUTPUT])).get(ORPHAN_OUTPUT)).toEqual({ owned: true, claimedByOthers: false })
  })

  it("...but a size-less row cannot be told from a library save, so the object is kept", async () => {
    useDb({ jobs: JOBS, assets: [saveRow(SELF, ORPHAN_OUTPUT)] })
    expect((await judgeKeys(SELF, [ORPHAN_OUTPUT])).get(ORPHAN_OUTPUT)).toEqual({ owned: false, claimedByOthers: false })
  })

  it("a non-canonical key is never owned, and is never sent to the database", async () => {
    useDb({ jobs: JOBS, assets: [uploadRow(SELF, `images/../${OPERATOR_KEY}`)] })
    const bad = `images/../${OPERATOR_KEY}`
    expect((await judgeKeys(SELF, [bad])).get(bad)).toEqual({ owned: false, claimedByOthers: false })
    expect(reads).toEqual([])
  })

  it("asks jobs only for job-id-shaped stems, and the library once", async () => {
    useDb({ jobs: JOBS, assets: [uploadRow(SELF, UPLOAD_KEY)] })
    await judgeKeys(SELF, [UPLOAD_KEY, "videos/yt-abc.mp4", OPERATOR_KEY])
    // `uploads/images/<uuid>.png` has a uuid stem: one jobs read, one assets read.
    expect(reads.map((r) => r.table)).toEqual(["jobs", "assets"])
    reads = []
    await judgeKeys(SELF, ["videos/yt-abc.mp4", OPERATOR_KEY])
    expect(reads.map((r) => r.table)).toEqual(["assets"])
  })

  it("throws when it cannot ask jobs, or the library — a caller that cannot tell must not act", async () => {
    useDb({ jobs: JOBS, assets: [], fail: { jobs: "jobs timeout" } })
    await expect(judgeKeys(SELF, [SELF_OUTPUT])).rejects.toThrow(/jobs timeout/)
    useDb({ jobs: JOBS, assets: [], fail: { assets: "assets timeout" } })
    await expect(judgeKeys(SELF, [SELF_OUTPUT])).rejects.toThrow(/assets timeout/)
  })

  it("asks nothing for no keys", async () => {
    useDb({ jobs: JOBS, assets: [] })
    expect(await judgeKeys(SELF, [])).toEqual(new Map())
    expect(reads).toEqual([])
  })
})

describe("judgeKeys — a relaying instance (shared bucket)", () => {
  const FAR = "99999999-9999-4999-8999-999999999999"
  const FAR_KEY = `images/${FAR}.png`

  it("the caller's relayed job made the far end's key: owned", async () => {
    relayGate.on = true
    useDb({ jobs: [...JOBS, { id: SELF_JOB.replace("1111", "5555"), user_id: SELF, relay_job_id: FAR }], assets: [] })
    expect((await judgeKeys(SELF, [FAR_KEY])).get(FAR_KEY)).toEqual({ owned: true, claimedByOthers: false })
    expect((await judgeKeys(OTHER, [FAR_KEY])).get(FAR_KEY)).toEqual({ owned: false, claimedByOthers: true })
  })

  it("asks no relay question with the gate closed", async () => {
    useDb({ jobs: [{ id: "x", user_id: SELF, relay_job_id: FAR }], assets: [] })
    expect((await judgeKeys(SELF, [FAR_KEY])).get(FAR_KEY)).toEqual({ owned: false, claimedByOthers: false })
    expect(reads.some((r) => r.filters.some(([, col]) => col === "relay_job_id"))).toBe(false)
  })
})

describe("judgeKeyEntries — a batch spanning users (the reapers)", () => {
  it("judges each entry for its own owner, in input order, with one read per table", async () => {
    useDb({ jobs: JOBS, assets: [uploadRow(OTHER, UPLOAD_KEY), saveRow(SELF, OPERATOR_KEY)] })
    const verdicts = await judgeKeyEntries([
      { owner: SELF, key: SELF_OUTPUT },
      { owner: OTHER, key: SELF_OUTPUT },
      { owner: OTHER, key: UPLOAD_KEY },
      { owner: SELF, key: OPERATOR_KEY },
    ])
    expect(verdicts).toEqual([
      { owned: true, claimedByOthers: false },
      { owned: false, claimedByOthers: true },
      { owned: true, claimedByOthers: false },
      { owned: false, claimedByOthers: false },
    ])
    expect(reads.map((r) => r.table)).toEqual(["jobs", "assets"])
  })
})

describe("ownKeysOnly — what an interactive delete may remove", () => {
  it("keeps every key the user cannot prove, and every key someone else holds", async () => {
    useDb({ jobs: JOBS, assets: [uploadRow(SELF, UPLOAD_KEY), saveRow(OTHER, UPLOAD_KEY), saveRow(SELF, OPERATOR_KEY)] })
    expect(await ownKeysOnly(SELF, [SELF_OUTPUT, OTHER_OUTPUT, UPLOAD_KEY, OPERATOR_KEY], "test")).toEqual([SELF_OUTPUT])
  })

  it("keeps everything when it cannot ask", async () => {
    useDb({ jobs: JOBS, assets: [], fail: { assets: "down" } })
    expect(await ownKeysOnly(SELF, [SELF_OUTPUT], "test")).toEqual([])
  })
})

describe("judgeUrlForRecording — a url a caller names, before a row records it", () => {
  beforeEach(() => useDb({ jobs: JOBS, assets: [uploadRow(SELF, UPLOAD_KEY)] }))

  it("a url off our storage is external: recorded as it is, nothing asked", async () => {
    expect(await judgeUrlForRecording(SELF, "https://example.com/images/cat.png")).toEqual({ kind: "external" })
    expect(reads).toEqual([])
  })

  it("everything is external when this install publishes no storage url", async () => {
    configMock.config.R2_PUBLIC_URL = undefined
    configMock.config.R2_PUBLIC_FALLBACK_DOMAIN = undefined
    expect(await judgeUrlForRecording(SELF, `https://cdn.test/${OPERATOR_KEY}`)).toEqual({ kind: "external" })
  })

  it("own job output: the canonical key and url (a query is dropped)", async () => {
    expect(await judgeUrlForRecording(SELF, `https://cdn.test/${SELF_OUTPUT}?v=2`)).toEqual({
      kind: "owned",
      key: SELF_OUTPUT,
      url: `https://cdn.test/${SELF_OUTPUT}`,
    })
  })

  it("own upload (proved by the upload's own row)", async () => {
    expect(await judgeUrlForRecording(SELF, `https://cdn.test/${UPLOAD_KEY}`)).toMatchObject({ kind: "owned", key: UPLOAD_KEY })
  })

  it("the fallback host and the http spelling name the same object", async () => {
    expect(await judgeUrlForRecording(SELF, `https://fallback.test/${SELF_OUTPUT}`)).toEqual({
      kind: "owned",
      key: SELF_OUTPUT,
      url: `https://cdn.test/${SELF_OUTPUT}`,
    })
    expect(await judgeUrlForRecording(SELF, `http://cdn.test/${OTHER_OUTPUT}`)).toEqual({ kind: "refused" })
  })

  it.each([
    ["another user's output", `https://cdn.test/${OTHER_OUTPUT}`],
    ["an operator file", `https://cdn.test/${OPERATOR_KEY}`],
    ["a key that does not exist", "https://cdn.test/images/never-made.png"],
    ["an encoded traversal", `https://cdn.test/images%2F..%2F..%2Fbrand%2Fmakers%2Facme.svg`],
    ["an encoded own key", `https://cdn.test/images%2F${SELF_JOB}.png`],
    ["a dot-segment path (the url parser resolves it)", `https://cdn.test/images/../${OPERATOR_KEY}`],
    ["a doubled slash", `https://cdn.test//${SELF_OUTPUT}`],
    ["the bare host", "https://cdn.test/"],
  ])("refuses %s — the same answer whether or not the object exists", async (_name, url) => {
    expect(await judgeUrlForRecording(SELF, url)).toEqual({ kind: "refused" })
  })

  it("self-host: the storage subtree behind the app origin is judged, the rest of that origin refused", async () => {
    configMock.config.R2_PUBLIC_URL = "http://localhost:3000/storage/nodaro-assets"
    configMock.config.R2_PUBLIC_FALLBACK_DOMAIN = undefined
    expect(await judgeUrlForRecording(SELF, `http://localhost:3000/storage/nodaro-assets/${SELF_OUTPUT}`)).toEqual({
      kind: "owned",
      key: SELF_OUTPUT,
      url: `http://localhost:3000/storage/nodaro-assets/${SELF_OUTPUT}`,
    })
    expect(await judgeUrlForRecording(SELF, `http://localhost:3000/storage/nodaro-assets/${OPERATOR_KEY}`)).toEqual({ kind: "refused" })
    expect(await judgeUrlForRecording(SELF, "http://localhost:3000/v1/library")).toEqual({ kind: "refused" })
  })

  it("throws when the lookup fails", async () => {
    useDb({ jobs: JOBS, assets: [], fail: { jobs: "down" } })
    await expect(judgeUrlForRecording(SELF, `https://cdn.test/${SELF_OUTPUT}`)).rejects.toThrow(/down/)
  })
})

describe("judgeAssetRowDelete — the object, and the refund, of one library row", () => {
  it("own upload: delete the object and refund the row", async () => {
    const row = uploadRow(SELF, UPLOAD_KEY, "a1")
    useDb({ jobs: JOBS, assets: [row] })
    expect(await judgeAssetRowDelete(SELF, { id: "a1", r2_key: UPLOAD_KEY })).toEqual({
      owned: true,
      deleteObject: true,
      refundable: true,
    })
  })

  it("a library save of the caller's own output: delete the object, refund nothing (the save was never charged)", async () => {
    useDb({ jobs: JOBS, assets: [saveRow(SELF, SELF_OUTPUT, "s1")] })
    expect(await judgeAssetRowDelete(SELF, { id: "s1", r2_key: SELF_OUTPUT })).toEqual({
      owned: true,
      deleteObject: true,
      refundable: false,
    })
  })

  it("ATTACK: a save naming an operator file keeps the object and refunds nothing", async () => {
    useDb({ jobs: JOBS, assets: [saveRow(SELF, OPERATOR_KEY, "s2")] })
    expect(await judgeAssetRowDelete(SELF, { id: "s2", r2_key: OPERATOR_KEY })).toEqual({
      owned: false,
      deleteObject: false,
      refundable: false,
    })
  })

  it("an attach row on the caller's own upload: owned, but its caller-chosen size is never refunded", async () => {
    const attach = { ...uploadRow(SELF, UPLOAD_KEY, "p1"), pipeline_entity_id: "entity-1", size_bytes: 9_999_999, recorded_reference: true }
    useDb({ jobs: JOBS, assets: [uploadRow(SELF, UPLOAD_KEY, "u1"), attach] })
    expect(await judgeAssetRowDelete(SELF, { id: "p1", r2_key: UPLOAD_KEY })).toEqual({
      owned: true,
      deleteObject: true,
      refundable: false,
    })
  })

  it("judges the row as stored, not as the caller described it", async () => {
    useDb({ jobs: JOBS, assets: [saveRow(SELF, OPERATOR_KEY, "s3")] })
    expect(
      await judgeAssetRowDelete(SELF, { id: "s3", r2_key: OPERATOR_KEY, upload_source: "manual_upload", size_bytes: 10 }),
    ).toMatchObject({ owned: false, refundable: false })
  })

  it("a generation's row for a url its output repeated is never refunded, even on an object the caller owns", async () => {
    // The caller's own upload (owned through its upload row), also filed by a
    // job whose output repeated its url: that row's size was never a charge.
    const echo = { ...saveRow(SELF, UPLOAD_KEY, "w1"), job_id: SELF_JOB, size_bytes: 2048 }
    useDb({ jobs: JOBS, assets: [uploadRow(SELF, UPLOAD_KEY, "u9"), echo] })
    expect(await judgeAssetRowDelete(SELF, { id: "w1", r2_key: UPLOAD_KEY })).toEqual({
      owned: true,
      deleteObject: true,
      refundable: false,
    })
  })

  it("own object another user's library still holds: keep the object, refund the owner's row", async () => {
    useDb({ jobs: JOBS, assets: [uploadRow(SELF, UPLOAD_KEY, "u2"), saveRow(OTHER, UPLOAD_KEY)] })
    expect(await judgeAssetRowDelete(SELF, { id: "u2", r2_key: UPLOAD_KEY })).toEqual({
      owned: true,
      deleteObject: false,
      refundable: true,
    })
  })

  it("a row naming no object: nothing to delete, nothing proven to refund", async () => {
    useDb({ jobs: JOBS, assets: [] })
    expect(await judgeAssetRowDelete(SELF, { id: "n1", r2_key: null })).toEqual({
      owned: false,
      deleteObject: false,
      refundable: false,
    })
    expect(reads).toEqual([])
  })
})

/**
 * LOW 5: a library read is capped at PostgREST's `max_rows` (1000 here). One
 * `.in("r2_key", <100 keys>)` can name more rows than that, and a claim cut
 * off the page would let a deleter remove an object another user's library
 * still uses. A full page is read again page by page until a short one.
 */
describe("the library read is never truncated", () => {
  it("finds another user's claim past the first 1000 rows naming a key", async () => {
    const mine = Array.from({ length: 1200 }, (_, i) =>
      ({ ...saveRow(SELF, UPLOAD_KEY, `a-${String(i).padStart(5, "0")}`) }),
    )
    const theirs = { ...saveRow(OTHER, UPLOAD_KEY, "z-their-save") }
    useDb({ jobs: JOBS, assets: [uploadRow(SELF, UPLOAD_KEY, "a-origin"), ...mine, theirs] })

    expect((await judgeKeys(SELF, [UPLOAD_KEY])).get(UPLOAD_KEY)).toEqual({ owned: true, claimedByOthers: true })
    // The capped first read, then pages keyed by id (never by offset, which a
    // concurrent delete would shift) until a short one.
    const libraryReads = reads.filter((r) => r.table === "assets")
    expect(libraryReads.map((r) => r.filters.filter(([op]) => op === "gt").map(([, , v]) => v))).toEqual([
      [],
      [],
      ["a-00999"],
    ])
    expect(libraryReads.slice(1).every((r) => r.limit === 1000 && r.range === undefined)).toBe(true)
    expect(await keysUserMayDelete(SELF, [UPLOAD_KEY])).toEqual(new Set())
  })

  it("keysHeldByOtherLibraryRows pages the same way", async () => {
    const own = Array.from({ length: 1100 }, (_, i) => ({ id: `a-${String(i).padStart(5, "0")}`, r2_key: SELF_OUTPUT, job_id: SELF_JOB }))
    useDb({ jobs: JOBS, assets: [...own, { id: "z-save", r2_key: SELF_OUTPUT, job_id: null }] })
    const held = await keysHeldByOtherLibraryRows([SELF_OUTPUT], (_key, jobId) => jobId === SELF_JOB)
    expect(held).toEqual(new Set([SELF_OUTPUT]))
  })
})

/**
 * Staging runs dev code against the shared database before main applies
 * migration 528. Until the column exists the reads fall back to its JS twin
 * (`recordedReferenceByShape`) instead of failing every ownership question.
 */
describe("before migration 528 reaches a database", () => {
  it("reads without the column and classifies each row by its shape", async () => {
    useDb({
      jobs: JOBS,
      assets: [uploadRow(SELF, UPLOAD_KEY), saveRow(SELF, OPERATOR_KEY)],
      noFlagColumn: true,
    })
    const v = await judgeKeys(SELF, [UPLOAD_KEY, OPERATOR_KEY])
    expect(v.get(UPLOAD_KEY)).toEqual({ owned: true, claimedByOthers: false })
    expect(v.get(OPERATOR_KEY)).toEqual({ owned: false, claimedByOthers: false })
    // Remembered: the next judgment does not ask for the missing column again.
    reads = []
    await judgeKeys(SELF, [UPLOAD_KEY])
    expect(reads.filter((r) => r.table === "assets").every((r) => !r.select.includes("recorded_reference"))).toBe(true)
  })

  it("any other read failure still throws", async () => {
    useDb({ jobs: JOBS, assets: [], fail: { assets: "statement timeout" } })
    await expect(judgeKeys(SELF, [UPLOAD_KEY])).rejects.toThrow(/statement timeout/)
  })
})

describe("judgeAssetRows — a reaper's batch of rows, each judged for its own user", () => {
  it("answers per row id: delete, keep (not provably theirs), or keep-and-refund (claimed by another)", async () => {
    useDb({
      jobs: JOBS,
      assets: [
        uploadRow(SELF, UPLOAD_KEY, "u1"),
        saveRow(OTHER, UPLOAD_KEY, "o1"),
        saveRow(SELF, OPERATOR_KEY, "s1"),
        uploadRow(OTHER, `uploads/videos/${UPLOAD_ID}.mp4`, "u2"),
      ],
    })
    const verdicts = await judgeAssetRows([
      { id: "u1", user_id: SELF, r2_key: UPLOAD_KEY },
      { id: "s1", user_id: SELF, r2_key: OPERATOR_KEY },
      { id: "u2", user_id: OTHER, r2_key: `uploads/videos/${UPLOAD_ID}.mp4` },
      { id: "g1", user_id: SELF, r2_key: SELF_OUTPUT },
    ])
    expect(verdicts.get("u1")).toEqual({ owned: true, deleteObject: false, refundable: true, claimedByOthers: true })
    expect(verdicts.get("s1")).toEqual({ owned: false, deleteObject: false, refundable: false, claimedByOthers: false })
    expect(verdicts.get("u2")).toEqual({ owned: true, deleteObject: true, refundable: true, claimedByOthers: false })
    // A job-family key with no row of its own: owned and deletable; nothing recorded a charge.
    expect(verdicts.get("g1")).toEqual({ owned: true, deleteObject: true, refundable: false, claimedByOthers: false })
    expect(reads.map((r) => r.table)).toEqual(["jobs", "assets"])
  })
})
