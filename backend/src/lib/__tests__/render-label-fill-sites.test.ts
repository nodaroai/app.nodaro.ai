/**
 * The backend half of the Preview label census (decided 2026-10-05; the
 * frontend half is components/render/__tests__/preview-label-census.test.ts).
 *
 * A render recorded before its label was stored names none, so every reader the
 * editor or a library shows a render through fills it from the order, by the one
 * rule (`jobRowStamp`). A reader added later fails here until it says whether it
 * does — or is listed with why it does not.
 */
import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..", "..")
const read = (where: string) => readFileSync(join(SRC, where), "utf8")
const count = (text: string, re: RegExp) => (text.match(re) ?? []).length

/** Strip comment lines so a note that names a call is not mistaken for one. */
const code = (where: string) => read(where).split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n")

describe("every job read that returns output_data fills the Preview label", () => {
  const jobs = code("routes/jobs.ts")

  it("each select of output_data is paired with a fill, and each lean one adds the order's columns", () => {
    const selects = jobs.match(/\.select\((?:`[^`]*`|"[^"]*")/g)?.filter((s) => s.includes("output_data")) ?? []
    // GET /v1/jobs/status, /v1/jobs/:id, /v1/jobs/:id/status, /v1/jobs, POST /v1/jobs/batch-status
    expect(selects).toHaveLength(5)
    expect(count(jobs, /\bfillJobs?RenderQuality\(/g)).toBe(5)
    // The lean routes do not select input_data: they must ask for the order's quality.
    expect(selects.filter((s) => !s.includes("input_data") && !s.includes("${ORDER_QUALITY_COLUMNS}"))).toEqual([])
  })

  it("the lean answers drop the helper columns (the routes stay lean)", () => {
    expect(count(jobs, /dropJobType: true/g)).toBe(3)
  })
})

describe("every library list fills the label an old render lacks", () => {
  it("My Library / the editor library (GET /v1/library) and MCP browse_uploads", () => {
    expect(code("routes/library.ts")).toMatch(/await fillAssetRenderQuality\(/)
    expect(code("routes/library.ts")).toMatch(/created_at, job_id"/)
    expect(code("lib/mcp/tools/gallery.ts")).toMatch(/await fillAssetRenderQuality\(storedRows\)/)
    expect(code("lib/mcp/tools/gallery.ts")).toMatch(/created_at, job_id"/)
  })
})

describe("every MCP job read fills the label an old render lacks (round 2, decided 2026-10-06)", () => {
  it("get_job and wait_for_job fill the one row they read; list_jobs fills its page (its behaviour is tested in jobs.test.ts)", () => {
    const jobs = code("lib/mcp/tools/jobs.ts")
    expect(count(jobs, /\bfillJobRenderQuality\(/g)).toBe(2)
    // list_jobs lists Apply EDL renders on its video and audio kinds (round 3,
    // decided 2026-10-06), so this fill is live; jobs.test.ts tests what it fills.
    expect(count(jobs, /\bfillJobsRenderQuality\(/g)).toBe(1)
  })

  it("get_asset and display_asset fill the one job they read, and the envelopes mark a Preview", () => {
    const gallery = code("lib/mcp/tools/gallery.ts")
    // get_asset, display_asset
    expect(count(gallery, /\bfillJobRenderQuality\(/g)).toBe(2)
    // get_asset's three envelopes (held, failed, final) and display_asset's
    expect(count(gallery, /\.\.\.previewField\b/g)).toBe(3)
    expect(count(gallery, /\bisPreviewRender\(/g)).toBe(2)
  })

  it("the job envelope marks a Preview from the (filled) output's quality", () => {
    expect(code("lib/mcp/tools/_job-view.ts")).toMatch(/isPreviewRender\(row\.job_type, out\?\.quality\)/)
  })

  it("every jobs select those tools fill from carries the order (input_data) and the job type", () => {
    const selects = code("lib/mcp/tools/jobs.ts").match(/"id, status, progress, input_data, output_data[^"]*"/g) ?? []
    // list_jobs, get_job, wait_for_job's final read
    expect(selects).toHaveLength(3)
    for (const s of selects) expect(s).toContain("job_type")
  })
})

/**
 * The owner's own gallery view (/v1/gallery with the owner's id, its favorites,
 * MCP browse_gallery scope=mine, list_favorites, list_jobs scope=mine) lists
 * Apply EDL renders, a Preview marked (round 3, decided 2026-10-06). A Preview is
 * `force_private`, but a final by a user whose outputs are public is `is_public`
 * too, so no PUBLIC view may list one: each listing gates Apply EDL on the owner.
 *
 * This pins exactly the allowlists that may name it, and the gate each keeps.
 * Behaviour (what is listed, what the public never sees) is tested in
 * gallery-listing-apply-edl.test.ts, mcp/tools/__tests__/gallery.test.ts and
 * jobs.test.ts; this fails when a NEW allowlist starts naming it.
 */
describe("exactly these listings name the renders, and each gates them on the owner", () => {
  // A render is named only through the registry (RENDER_NODE_TYPES, SV18): the
  // owner-only set is OWNER_ONLY_RENDER_JOBS (lib/render-listing.ts), never a literal.
  const named = (where: string) => count(code(where), /\bOWNER_ONLY_RENDER_JOBS\b/g)
  const literal = (where: string) => count(code(where), /["']apply-edl["']/g)

  it("the REST gallery's shared allowlists (IMAGE/VIDEO/AUDIO_JOBS) do not; its owner-only set does, once", () => {
    const src = code("lib/gallery-listing.ts")
    for (const set of ["IMAGE_JOBS", "VIDEO_JOBS", "AUDIO_JOBS"]) {
      const block = src.slice(src.indexOf(`const ${set} = new Set`), src.indexOf("])", src.indexOf(`const ${set} = new Set`)))
      expect(block, `${set} names apply-edl: the public gallery would list it`).not.toMatch(/["']apply-edl["']/)
    }
    expect(src).toMatch(/const OWNER_ONLY_JOBS: ReadonlySet<string> = OWNER_ONLY_RENDER_JOBS\n/)
    expect(literal("lib/gallery-listing.ts")).toBe(0)
    // the import and the one set
    expect(named("lib/gallery-listing.ts")).toBe(2)
    // The owner is the one read of one person's work BY that person — the flag alone is not it.
    expect(src).toMatch(/const ownerView = q\.includePrivate && !!q\.userId/)
    expect(src).toMatch(/OWNER_ONLY_JOBS\.has\(job\.job_type\) && !\(ownerView && job\.user_id === q\.userId\)/)
  })

  it("the MCP gallery's shared allowlists do not; its owner-only set does, once, and is added only for scope=mine", () => {
    const src = code("lib/mcp/tools/gallery.ts")
    for (const set of ["IMAGE_JOBS", "VIDEO_JOBS", "AUDIO_JOBS"]) {
      const block = src.slice(src.indexOf(`const ${set} = new Set`), src.indexOf("])", src.indexOf(`const ${set} = new Set`)))
      expect(block, `${set} names apply-edl: the public scope would list it`).not.toMatch(/["']apply-edl["']/)
    }
    expect(src).toMatch(/const OWNER_ONLY_JOBS: ReadonlySet<string> = OWNER_ONLY_RENDER_JOBS\n/)
    expect(literal("lib/mcp/tools/gallery.ts")).toBe(0)
    expect(named("lib/mcp/tools/gallery.ts")).toBe(2)
    expect(src).toMatch(/jobNamesForKind\(k, scope === "mine"\)/)
    // list_favorites' hydration admits other people's public rows: the owner check is the guard.
    expect(src).toMatch(/OWNER_ONLY_JOBS\.has\(row\.job_type\) && row\.user_id !== viewerUserId\) return null/)
  })

  it("list_jobs names them on the video and audio kinds only (two entries), and lists an owner-only one only in scope mine", () => {
    const src = code("lib/mcp/tools/jobs.ts")
    expect(literal("lib/mcp/tools/jobs.ts")).toBe(0)
    expect(count(src, /\.\.\.RENDER_NODE_TYPE_IDS\b/g)).toBe(2)
    expect(src).toMatch(/if \(renderMedium\) return scope === "mine" \|\| !OWNER_ONLY_RENDER_JOBS\.has\(type\) \? \[renderMedium\] : \[\]/)
  })

  it("no other listing names them", () => {
    for (const where of ["routes/gallery.ts", "ee/routes/admin-gallery-moderation.ts"]) {
      expect(literal(where)).toBe(0)
      expect(named(where)).toBe(0)
    }
  })
})

/**
 * Readers of a render that do NOT fill the label, and why.
 */
const NOT_FILLED: Record<string, string> = {
  "routes/gallery.ts": "lists through lib/gallery-listing.ts, which marks the owner view's Preview renders itself (readGalleryPage reads the order from the rows it already holds, so no separate fill)",
}

describe("readers that do not fill the label are listed", () => {
  it("each listed file exists and still does not fill (when one does, remove it here)", () => {
    for (const where of Object.keys(NOT_FILLED)) {
      expect(existsSync(join(SRC, where)), `${where} no longer exists: update the census`).toBe(true)
      expect(read(where), `${where} fills the label now: remove it from NOT_FILLED`).not.toMatch(/render-label-fill/)
    }
  })
})
