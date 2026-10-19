import { describe, it, expect, vi, beforeEach } from "vitest"

const m = vi.hoisted(() => ({ apiJson: vi.fn() }))
vi.mock("@/lib/api", () => ({ apiJson: m.apiJson }))

import { gifToVideoApi } from "../api"

beforeEach(() => { m.apiJson.mockReset().mockResolvedValue({ jobId: "job-1" }) })

const call = (body: Record<string, unknown>) => ["/v1/gif-to-video", { body, workflowId: true, label: "apiErr.startGifToVideo" }]

describe("gifToVideoApi", () => {
  it("POSTs the GIF, each setting that is given and the user to /v1/gif-to-video as a workflow job", async () => {
    await expect(gifToVideoApi("https://media.test/a.gif", { loopToMinimum: false, targetDuration: 6, interpolate: false, alphaBackground: "black" }, "user-1")).resolves.toEqual({ jobId: "job-1" })
    expect(m.apiJson).toHaveBeenCalledWith(...call({ gifUrl: "https://media.test/a.gif", loopToMinimum: false, targetDuration: 6, interpolate: false, alphaBackground: "black", userId: "user-1" }))
  })

  it("leaves out a setting that is not given (the route's defaults apply), and the user when there is none", async () => {
    await gifToVideoApi("https://media.test/a.gif")
    expect(m.apiJson).toHaveBeenLastCalledWith(...call({ gifUrl: "https://media.test/a.gif" }))
    await gifToVideoApi("https://media.test/a.gif", { targetDuration: 4 })
    expect(m.apiJson).toHaveBeenLastCalledWith(...call({ gifUrl: "https://media.test/a.gif", targetDuration: 4 }))
  })
})
