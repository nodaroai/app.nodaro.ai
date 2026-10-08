import { describe, it, expect, vi, beforeEach } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

// `workflow_executions.video_link_files` (migration 487, decided 2026-10-08): the
// files a run fetched from Video URL post links, kept on its execution so a
// continuation (Render final) or a re-pick of the execution reuses them instead
// of fetching again. Until the migration reaches the shared database (staging
// runs dev against it, and migrations apply only at dev→main) the column does
// not exist.

const db = vi.hoisted(() => ({
  writes: [] as Array<{ row: Record<string, unknown>; id: unknown }>,
  reads: [] as Array<{ columns: string; filters: Array<[string, unknown]> }>,
  writeError: null as { code?: string; message: string } | null,
  readResult: { data: null, error: null } as { data: unknown; error: { code?: string; message: string } | null },
}))
vi.mock("../supabase.js", () => ({
  supabase: {
    from: (table: string) => ({
      update: (row: Record<string, unknown>) => ({
        eq: async (_column: string, id: unknown) => {
          if (table === "workflow_executions") db.writes.push({ row, id })
          return { data: null, error: db.writeError }
        },
      }),
      select: (columns: string) => {
        const read = { columns, filters: [] as Array<[string, unknown]> }
        db.reads.push(read)
        const chain = {
          eq: (column: string, value: unknown) => {
            read.filters.push([column, value])
            return chain
          },
          maybeSingle: async () => db.readResult,
        }
        return chain
      },
    }),
  },
}))

import {
  loadExecutionVideoLinkFiles,
  mergeVideoLinkFiles,
  noteVideoLinkFilesColumnError,
  parseVideoLinkFiles,
  resetVideoLinkFilesColumnForTests,
  saveExecutionVideoLinkFiles,
  videoLinkFilesCleared,
  videoLinkFilesColumnAbsent,
} from "../execution-video-link-files.js"
import {
  noteInputOverridesColumnError,
  inputOverridesColumnAbsent,
  resetInputOverridesColumnForTests,
} from "../execution-input-overrides.js"

const YT = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
const FILE = "https://cdn.nodaro.ai/videos/yt-1.mp4"
const AUDIO = "https://cdn.nodaro.ai/audios/a-1.mp3"

beforeEach(() => {
  resetVideoLinkFilesColumnForTests()
  resetInputOverridesColumnForTests()
  db.writes.length = 0
  db.reads.length = 0
  db.writeError = null
  db.readResult = { data: null, error: null }
})

describe("the video_link_files column guard", () => {
  it("a missing-column error is remembered, by code (42703 / PGRST204)", () => {
    expect(videoLinkFilesColumnAbsent()).toBe(false)
    expect(noteVideoLinkFilesColumnError({ code: "42703", message: 'column "video_link_files" does not exist' })).toBe(true)
    expect(videoLinkFilesColumnAbsent()).toBe(true)
    resetVideoLinkFilesColumnForTests()
    expect(noteVideoLinkFilesColumnError({ code: "PGRST204", message: "Could not find the 'video_link_files' column of 'workflow_executions' in the schema cache" })).toBe(true)
    resetVideoLinkFilesColumnForTests()
    for (const other of [{ code: "23505" }, { code: null }, {}, null, undefined]) {
      expect(noteVideoLinkFilesColumnError(other)).toBe(false)
    }
  })

  it("an error that names ANOTHER column is not this column's: input_overrides stays usable when only video_link_files is missing, and the other way round", () => {
    const missingMine = { code: "42703", message: "column workflow_executions.video_link_files does not exist" }
    const missingPin = { code: "PGRST204", message: "Could not find the 'input_overrides' column of 'workflow_executions' in the schema cache" }
    expect(noteInputOverridesColumnError(missingMine)).toBe(false)
    expect(inputOverridesColumnAbsent()).toBe(false)
    expect(noteVideoLinkFilesColumnError(missingPin)).toBe(false)
    expect(videoLinkFilesColumnAbsent()).toBe(false)
    expect(noteInputOverridesColumnError(missingPin)).toBe(true)
    expect(noteVideoLinkFilesColumnError(missingMine)).toBe(true)
  })

  it("the cleared patch names the column until it is known missing", () => {
    expect(videoLinkFilesCleared()).toEqual({ video_link_files: null })
    noteVideoLinkFilesColumnError({ code: "42703" })
    expect(videoLinkFilesCleared()).toEqual({})
  })
})

describe("parseVideoLinkFiles: the stored record is read defensively", () => {
  it("keeps a well-formed entry", () => {
    const raw = { src: { link: YT, data: { downloadedVideoUrl: FILE, downloadedFromUrl: YT, downloadStatus: "completed", downloadedSection: null } } }
    expect(parseVideoLinkFiles(raw)).toEqual(raw)
  })

  it("is empty for anything that is not a node-keyed map", () => {
    for (const bad of [null, undefined, "x", 3, [], [{ link: YT }]]) expect(parseVideoLinkFiles(bad)).toEqual({})
  })

  it("drops an entry with no link, no data, or no http(s) file url; keeps only the fields the fetch writes", () => {
    const parsed = parseVideoLinkFiles({
      noLink: { data: { downloadedVideoUrl: FILE } },
      noData: { link: YT },
      badUrl: { link: YT, data: { downloadedVideoUrl: "javascript:alert(1)" } },
      private: { link: YT, data: { downloadedVideoUrl: FILE, label: "x", youtubeUrl: "https://evil.example/a.mp4", sectionStartSec: 3 } },
    })
    expect(Object.keys(parsed)).toEqual(["private"])
    // Not a field the fetch writes: a record can never smuggle one onto a node.
    expect(parsed.private!.data).toEqual({ downloadedVideoUrl: FILE })
  })

  it("keeps the audio track and a part as stored", () => {
    const parsed = parseVideoLinkFiles({
      a: { link: YT, data: { downloadedAudioUrl: AUDIO, audioDownloadStatus: "completed" } },
      b: { link: YT, data: { downloadedVideoUrl: FILE, downloadedSection: { startSec: 5, endSec: 9 } } },
      c: { link: YT, data: { downloadedVideoUrl: FILE, downloadedSection: { startSec: "x" } } },
    })
    expect(parsed.a!.data).toEqual({ downloadedAudioUrl: AUDIO, audioDownloadStatus: "completed" })
    expect(parsed.b!.data.downloadedSection).toEqual({ startSec: 5, endSec: 9 })
    expect(parsed.c!.data.downloadedSection).toBeUndefined()
  })
})

describe("mergeVideoLinkFiles: a node's record grows by what was fetched for the same link", () => {
  const video = { link: YT, data: { downloadedVideoUrl: FILE } }
  const audio = { link: YT, data: { downloadedAudioUrl: AUDIO } }

  it("video then audio for one link: one entry holding both", () => {
    expect(mergeVideoLinkFiles({ src: video }, { src: audio })).toEqual({ src: { link: YT, data: { downloadedVideoUrl: FILE, downloadedAudioUrl: AUDIO } } })
  })

  it("a different link replaces the node's entry — an old file never rides a new link", () => {
    const other = "https://youtu.be/BBBBBBBBBBB"
    expect(mergeVideoLinkFiles({ src: video }, { src: { link: other, data: { downloadedAudioUrl: AUDIO } } })).toEqual({
      src: { link: other, data: { downloadedAudioUrl: AUDIO } },
    })
  })

  it("keeps other nodes' entries and mutates nothing", () => {
    const prev = { keep: video }
    const out = mergeVideoLinkFiles(prev, { src: audio })
    expect(Object.keys(out).sort()).toEqual(["keep", "src"])
    expect(prev).toEqual({ keep: video })
    expect(out).not.toBe(prev)
  })
})

describe("saveExecutionVideoLinkFiles: what a run fetched, on its execution", () => {
  const files = { src: { link: YT, data: { downloadedVideoUrl: FILE } } }

  it("writes the record on that execution", async () => {
    await saveExecutionVideoLinkFiles("exec-1", files)
    expect(db.writes).toEqual([{ row: { video_link_files: files }, id: "exec-1" }])
  })

  it("an empty record writes nothing — NULL means 'nothing fetched'", async () => {
    await saveExecutionVideoLinkFiles("exec-1", {})
    expect(db.writes).toEqual([])
  })

  it("before the column exists: remembered quietly, and later saves write nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    db.writeError = { code: "PGRST204", message: "Could not find the 'video_link_files' column of 'workflow_executions'" }
    await saveExecutionVideoLinkFiles("exec-1", files)
    await saveExecutionVideoLinkFiles("exec-2", files)
    expect(db.writes).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("any other error is logged, never thrown", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    db.writeError = { message: "transient" }
    await expect(saveExecutionVideoLinkFiles("exec-1", files)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe("loadExecutionVideoLinkFiles: the owner's execution only", () => {
  it("reads that execution's record, filtered to the user who started it", async () => {
    db.readResult = { data: { video_link_files: { src: { link: YT, data: { downloadedVideoUrl: FILE } } } }, error: null }
    const files = await loadExecutionVideoLinkFiles("exec-0", "user-1")
    expect(files).toEqual({ src: { link: YT, data: { downloadedVideoUrl: FILE } } })
    expect(db.reads).toEqual([{ columns: "video_link_files", filters: [["id", "exec-0"], ["user_id", "user-1"]] }])
  })

  it("someone else's (or a missing) execution reads as no record", async () => {
    db.readResult = { data: null, error: null }
    expect(await loadExecutionVideoLinkFiles("exec-0", "user-2")).toEqual({})
  })

  it("a NULL column is no record", async () => {
    db.readResult = { data: { video_link_files: null }, error: null }
    expect(await loadExecutionVideoLinkFiles("exec-0", "user-1")).toEqual({})
  })

  it("before the column exists: no record, remembered, and the next load does not even ask", async () => {
    db.readResult = { data: null, error: { code: "42703", message: 'column workflow_executions.video_link_files does not exist' } }
    expect(await loadExecutionVideoLinkFiles("exec-0", "user-1")).toEqual({})
    expect(videoLinkFilesColumnAbsent()).toBe(true)
    await loadExecutionVideoLinkFiles("exec-0", "user-1")
    expect(db.reads).toHaveLength(1)
  })

  it("any other error is logged and reads as no record — a refetch, never a failed run", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    db.readResult = { data: null, error: { message: "timeout" } }
    expect(await loadExecutionVideoLinkFiles("exec-0", "user-1")).toEqual({})
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe("every site that names the column goes through the guard", () => {
  const SRC = join(__dirname, "..", "..")
  const ALLOWED = new Set(["lib/execution-video-link-files.ts"])
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        if (name === "__tests__" || name === "node_modules") continue
        walk(full, out)
      } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
        out.push(full)
      }
    }
    return out
  }
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")

  it("no backend file but the guard module names `video_link_files` in code", () => {
    const offenders = walk(SRC)
      .map((f) => relative(SRC, f).split("\\").join("/"))
      .filter((rel) => !ALLOWED.has(rel) && code(readFileSync(join(SRC, rel), "utf8")).includes("video_link_files"))
    expect(offenders).toEqual([])
  })
})
