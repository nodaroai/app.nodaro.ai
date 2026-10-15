// @test-watches backend/src/**/*.ts
import { describe, it, expect } from "vitest"
import ts from "typescript"
import { eachSourceFile, SCAN_TIMEOUT_MS, walk } from "./source-scan.js"

/**
 * Every server path that writes an `assets` row (the allow proof, decided
 * 2026-10-15).
 *
 * `lib/key-ownership.ts` takes a user's own `assets` row as their record of
 * having made the object it names — the only record a key with no maker in its
 * name has (`uploads/<kind>s/<uuid>.<ext>`, a social download, a scraped
 * video) — unless the row only RECORDED a url someone named
 * (`isRecordedReference`). Since migration 528 that answer is
 * `assets.recorded_reference`, which the DATABASE computes from every inserted
 * row (`asset_recorded_reference_by_shape`, whatever path wrote it, upserts
 * included) and which no update may change afterwards — nor the row's user or
 * key (LOW 4 of the 2026-10-15 review: an update cannot launder a row, so
 * updates need no census). The classification is still only as good as the
 * shapes it knows: a new writer that files a caller's url in a row shaped like
 * a storing path's would turn any url into "the caller made it". So every
 * insert or upsert into `assets` is listed below as one of the two kinds, with
 * why; a new one fails until it is.
 *
 * (The scan reads `.insert(…)` / `.upsert(…)` called on a `.from("assets")`
 * chain, as every writer spells it today.)
 */
const STORING_PATHS: Readonly<Record<string, string>> = {
  "routes/upload.ts": "stores the uploaded bytes under a key it mints (`uploads/<kind>s/<uuid>.<ext>`) and records them for the uploader",
  "lib/media-import.ts": "stores fetched bytes under a key it mints (`uploads/images/<uuid>.<ext>`) and records them for the importer",
  "lib/media-portability.ts": "re-hosts a bundle's media under a key it mints (`uploads/<kind>s/<uuid>.<ext>`) for the importer",
  "lib/media-url-import.ts": "fetches a recording by url and stores it under a key it mints (`uploads/<kind>s/<uuid>.<ext>`)",
  "lib/scraped-media.ts": "streams a scraped video under a key it mints (`videos/<prefix>-<id>-<job8>.mp4`), filed under the scrape job",
  "lib/asset-records.ts": "records the social download it just stored (`videos/yt-<uuid>.mp4`)",
  "routes/media-process.ts": "stores the processed output under a key it mints (`uploads/<kind>/<uuid>.<ext>`)",
  "workers/shared.ts":
    "createAssetFromJob files a completed job's output urls; such a row vouches only for its own job's key family (528 flags any other key a recorded reference, and the worker records no size for it), never for a url the output repeated",
  "ee/pipelines/_freecut-timeline.ts": "stores the export it just wrote (`exports/<userId>/…`, `pipelines/<id>/exports/…`)",
  "ee/pipelines/services/pipeline-final-merge.ts": "records the final merge its own job just rendered",
}

const RECORDING_PATHS: Readonly<Record<string, string>> = {
  "routes/library.ts":
    "save-generated records a url a caller names: an object of ours only after judgeUrlForRecording proved it the caller's, and its rows (`generated`, no job, no size) are a recorded reference",
  "ee/pipelines/entity-description.ts":
    "a pipeline entity's attached image: an object of ours only after judgeUrlForRecording proved it the caller's, and its rows (`manual_upload` pointing at an entity) are a recorded reference",
}

/** Does `call` insert into `assets` (an `.insert(…)` or `.upsert(…)` on a `.from("assets")` chain)? */
function insertsIntoAssets(call: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(call.expression)) return false
  if (call.expression.name.text !== "insert" && call.expression.name.text !== "upsert") return false
  let e: ts.Expression = call.expression.expression
  for (;;) {
    if (ts.isCallExpression(e)) {
      const arg = e.arguments[0]
      if (
        ts.isPropertyAccessExpression(e.expression) &&
        e.expression.name.text === "from" &&
        arg !== undefined &&
        ts.isStringLiteralLike(arg) &&
        arg.text === "assets"
      ) {
        return true
      }
      e = e.expression
    } else if (ts.isPropertyAccessExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) {
      e = e.expression
    } else if (ts.isAsExpression(e)) {
      e = e.expression
    } else {
      return false
    }
  }
}

function assetWriters(): Set<string> {
  const writers = new Set<string>()
  eachSourceFile(['"assets"'], (sf, rel) => {
    walk(sf, (n) => {
      if (ts.isCallExpression(n) && insertsIntoAssets(n)) writers.add(rel)
    })
  })
  return writers
}

describe("assets writers census: every row that names a key is classified", { timeout: SCAN_TIMEOUT_MS }, () => {
  const found = assetWriters()

  it("finds the writers (the scan works)", () => {
    expect(found.has("routes/upload.ts")).toBe(true)
    expect(found.has("routes/library.ts")).toBe(true)
  })

  it("every file that inserts into assets is listed as a storing path or a recording path", () => {
    const unlisted = [...found].filter((f) => !(f in STORING_PATHS) && !(f in RECORDING_PATHS))
    expect(unlisted, "classify these in asset-writers-census.test.ts (and in isRecordedReference if they record a caller's url)").toEqual([])
  })

  it("no file is listed as both", () => {
    expect(Object.keys(STORING_PATHS).filter((f) => f in RECORDING_PATHS)).toEqual([])
  })

  it("every listed file still inserts into assets (a stale entry would excuse a future writer)", () => {
    const stale = [...Object.keys(STORING_PATHS), ...Object.keys(RECORDING_PATHS)].filter((f) => !found.has(f))
    expect(stale).toEqual([])
  })

  it("every entry says why", () => {
    for (const [file, why] of Object.entries({ ...STORING_PATHS, ...RECORDING_PATHS })) {
      expect(why.length, file).toBeGreaterThan(30)
    }
  })

  it("the scan sees through the spellings in use", () => {
    const calls = (text: string) => {
      const sf = ts.createSourceFile("x.ts", text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
      let n = 0
      walk(sf, (node) => {
        if (ts.isCallExpression(node) && insertsIntoAssets(node)) n++
      })
      return n
    }
    const inAsync = (body: string) => calls(`async function f() { ${body} }`)
    expect(inAsync(`await supabase.from("assets").insert({})`)).toBe(1)
    expect(inAsync(`await supabase\n  .from("assets")\n  .insert({ a: 1 })\n  .select("id")\n  .single()`)).toBe(1)
    expect(inAsync(`await (supabase.from("assets") as any).insert({})`)).toBe(1)
    expect(inAsync(`await supabase.from("assets").upsert({}, { onConflict: "id" })`)).toBe(1)
    expect(inAsync(`await supabase.from("assets").update({ in_library: true })`)).toBe(0)
    expect(inAsync(`await supabase.from("jobs").insert({})`)).toBe(0)
    expect(inAsync(`await supabase.from("app_reports" as "assets").insert({})`)).toBe(0)
  })
})
