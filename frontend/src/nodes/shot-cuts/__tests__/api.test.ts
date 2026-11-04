import { describe, it, expect, vi, beforeEach } from "vitest"

const m = vi.hoisted(() => ({ apiJson: vi.fn() }))
vi.mock("@/lib/api", () => ({ apiJson: m.apiJson }))

import { shotCutsApi } from "../api"

beforeEach(() => m.apiJson.mockReset().mockResolvedValue({ jobId: "job-1" }))

describe("shotCutsApi", () => {
  it("POSTs { videoUrl, frames } to /v1/shot-cuts in the workflow's name, with the user when there is one", async () => {
    await expect(shotCutsApi({ videoUrl: "https://media.test/a.mp4", frames: true }, "user-1")).resolves.toEqual({ jobId: "job-1" })
    expect(m.apiJson).toHaveBeenCalledWith("/v1/shot-cuts", { body: { videoUrl: "https://media.test/a.mp4", frames: true, userId: "user-1" }, workflowId: true, label: "apiErr.startShotCuts" })
  })

  it("no user: no userId key", async () => {
    await shotCutsApi({ videoUrl: "https://media.test/a.mp4", frames: false })
    expect(m.apiJson.mock.calls[0]![1].body).toEqual({ videoUrl: "https://media.test/a.mp4", frames: false })
  })
})
