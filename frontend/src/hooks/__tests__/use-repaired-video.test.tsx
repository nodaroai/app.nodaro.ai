import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { repairedCanvasTake } from "@nodaro/render-rules"
import { useRepairedVideoStates } from "../use-repaired-video"
import { queryClient } from "@/lib/query-client"
import { getJobStatusBatch } from "@/lib/api"
vi.mock("@/lib/api", () => ({ getJobStatusBatch: vi.fn() }))
const auth = vi.hoisted(() => ({ user: undefined as string | undefined }))
vi.mock("../use-auth", () => ({ useCachedUserId: () => auth.user, getCachedUserId: () => auth.user }))
vi.mock("../use-workflow-store", () => ({ useWorkflowStore: vi.fn() }))

const first = "https://clips/first"
const full = "https://clips/full"
const clips = [{ segment: 1, url: first }, { segment: 2, url: "https://clips/second" }]
const out = { clipJobId: "job-1", videoUrl: first, unassembledClips: clips }
const repair = { jobId: "job-1", first, url: full }

beforeEach(() => { queryClient.clear(); vi.clearAllMocks(); auth.user = "owner" })

it("refreshes the exact run and fan-out take after landing, preserving a runner's replacement", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof getJobStatusBatch>>) => void
  vi.mocked(getJobStatusBatch).mockImplementation(() => new Promise(done => { resolve = done }))
  const states = { n: { output: { ...out, listResults: [first, "https://manual"], listResultStamps: [out, out] } } }
  const { result, rerender } = renderHook(({ edited }) => useRepairedVideoStates(edited ? { n: { output: { ...states.n.output, videoUrl: "https://manual" } } } : states), { initialProps: { edited: false } })
  expect(result.current.n.output.videoUrl).toBe(first)
  rerender({ edited: true })
  await act(async () => resolve({ jobs: [{ id: "job-1", status: "completed", output_data: { ...out, deliveryMode: "simple_cuts", videoUrl: full } }] }))
  await waitFor(() => expect(result.current.n.output.listResults).toEqual([full, "https://manual"]))
  expect(result.current.n.output.videoUrl).toBe("https://manual")
  rerender({ edited: false })
  await waitFor(() => expect(result.current.n.output.videoUrl).toBe(full))
  expect(result.current.n.output.unassembledClips).toEqual(clips)
  expect(getJobStatusBatch).toHaveBeenCalledTimes(1)
})

it("updates saved downstream fields only for the still-filed take", () => {
  const take = { jobId: repair.jobId, url: first, duration: 5, unassembledClips: clips }
  const other = { jobId: "other", url: "https://other" }
  const data = { generatedResults: [take, other], activeResultIndex: 1, generatedVideoUrl: other.url, __listResults: [first, other.url] }
  expect(repairedCanvasTake(data, [repair])).toEqual({
    generatedResults: [{ jobId: repair.jobId, url: full, unassembledClips: clips }, other], __listResults: [full, other.url],
  })
  expect(repairedCanvasTake({ ...data, activeResultIndex: 0, generatedVideoUrl: first }, [repair])).toHaveProperty("generatedVideoUrl", full)
  expect(repairedCanvasTake({ ...data, generatedResults: [{ ...take, url: "https://edited" }] }, [repair])).toBeUndefined()
})

it("requires this account's own batch result after switching account or signing out", async () => {
  const states = { n: { output: out } }
  vi.mocked(getJobStatusBatch).mockResolvedValueOnce({ jobs: [
    { id: "job-1", status: "completed", output_data: { ...out, deliveryMode: "simple_cuts", videoUrl: full } },
  ] }).mockResolvedValue({ jobs: [] })
  const { result, rerender } = renderHook(() => useRepairedVideoStates(states))
  await waitFor(() => expect(result.current.n.output.videoUrl).toBe(full))
  auth.user = "other"
  rerender()
  expect(result.current.n.output.videoUrl).toBe(first)
  await waitFor(() => expect(getJobStatusBatch).toHaveBeenCalledTimes(2))
  auth.user = undefined
  rerender()
  expect(result.current.n.output.videoUrl).toBe(first)
  expect(getJobStatusBatch).toHaveBeenCalledTimes(2)
})

it("keeps a late response out of the cache when the active account changed in flight", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof getJobStatusBatch>>) => void
  vi.mocked(getJobStatusBatch).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const { result, rerender } = renderHook(() => useRepairedVideoStates({ n: { output: out } }))
  auth.user = undefined
  rerender()
  await act(async () => resolve({ jobs: [
    { id: "job-1", status: "completed", output_data: { ...out, deliveryMode: "simple_cuts", videoUrl: full } },
  ] }))
  expect(result.current.n.output.videoUrl).toBe(first)
  expect(queryClient.getQueryCache().getAll().map(query => query.state.data)).toEqual([null])
})

it("replaces only the stamped job's row when two continuations reused the first clip", () => {
  const take = { jobId: repair.jobId, url: first, unassembledClips: clips }
  const second = { jobId: "job-2", first, url: "https://clips/second-full" }
  const data = { generatedResults: [take, { ...take, jobId: second.jobId }], __listResults: [first, first, first] }
  const stamped = { ...data, __listResultStamps: [{ jobId: second.jobId }, take, { jobId: "other" }] }
  expect(repairedCanvasTake(stamped, [repair, second])?.__listResults).toEqual([second.url, full, first])
  expect(repairedCanvasTake(data, [repair, second])).not.toHaveProperty("__listResults")
})
