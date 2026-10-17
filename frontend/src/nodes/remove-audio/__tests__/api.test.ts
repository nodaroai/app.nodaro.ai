import { describe, it, expect, vi, beforeEach } from "vitest"

const m = vi.hoisted(() => ({ apiJson: vi.fn() }))
vi.mock("@/lib/api", () => ({ apiJson: m.apiJson }))

import { removeAudioApi } from "../api"

beforeEach(() => { m.apiJson.mockReset().mockResolvedValue({ jobId: "job-1" }) })

describe("removeAudioApi", () => {
  it("POSTs the video (and the user, when given) to /v1/remove-audio as a workflow job", async () => {
    await expect(removeAudioApi("https://media.test/v.mp4", "user-1")).resolves.toEqual({ jobId: "job-1" })
    expect(m.apiJson).toHaveBeenCalledWith("/v1/remove-audio", { body: { videoUrl: "https://media.test/v.mp4", userId: "user-1" }, workflowId: true, label: "apiErr.startRemoveAudio" })
    await removeAudioApi("https://media.test/v.mp4")
    expect(m.apiJson).toHaveBeenLastCalledWith("/v1/remove-audio", { body: { videoUrl: "https://media.test/v.mp4" }, workflowId: true, label: "apiErr.startRemoveAudio" })
  })
})
