import { beforeEach, expect, it, vi } from "vitest"
const db = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), in: vi.fn(), is: vi.fn() }))
vi.mock("../supabase.js", () => ({ supabase: db }))
import { withRepairedProVideoTakes } from "../repaired-pro-video-takes.js"

const id = "00000000-0000-4000-8000-000000000716"
const first = "https://clips.test/first"
const full = "https://clips.test/assembled"
const take = { jobId: id, url: first, unassembledClips: [{segment: 1, url: first}] }

beforeEach(() => {
  vi.clearAllMocks()
  for (const method of [db.from, db.select, db.eq, db.in, db.is]) method.mockReturnValue(db)
  db.is.mockReturnValueOnce(db).mockReturnValueOnce(db).mockResolvedValueOnce({ data: [{ id, first, url: full }] })
})

it("a server-only downstream run resolves a saved first clip to the filed full video", async () => {
  const saved = { id: "source", type: "generate-video-pro", data: { generatedVideoUrl: first, generatedResults: [take], __listResults: [first] } }
  const [resolved] = await withRepairedProVideoTakes([saved], "runner")
  expect(db.eq).toHaveBeenCalledWith("user_id", "runner")
  expect(db.is).toHaveBeenCalledWith("restricted_at", null)
  expect(db.is).toHaveBeenCalledWith("deleted_at", null)
  expect(db.is).toHaveBeenCalledWith("parent_job_id", null)
  expect(resolved?.data).toMatchObject({ generatedVideoUrl: full, generatedResults: [{ ...take, url: full }], __listResults: [full] })
  expect(saved.data.generatedVideoUrl).toBe(first)
})

it("a manually replaced or already repaired source requires no lookup", async () => {
  const saved = [{ id: "n", type: "edit-video-pro", data: { generatedResults: [{ ...take, url: "https://manual" }] } }]
  expect(await withRepairedProVideoTakes(saved, "runner")).toBe(saved)
  expect(db.from).not.toHaveBeenCalled()
})
