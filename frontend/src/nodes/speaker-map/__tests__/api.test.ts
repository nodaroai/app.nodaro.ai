import { describe, it, expect, vi, beforeEach } from "vitest"

const m = vi.hoisted(() => ({ apiJson: vi.fn() }))
vi.mock("@/lib/api", () => ({ apiJson: m.apiJson }))

import { speakerMapApi } from "../api"

const body = { sources: [{ id: "cam1", url: "https://media.test/cam1.mp4", kind: "video" as const }, { id: "cam2", url: "https://media.test/cam2.mp4", kind: "video" as const }], transcript: { words: [] }, marginDb: 3 }

beforeEach(() => m.apiJson.mockReset().mockResolvedValue({ jobId: "job-1" }))

describe("speakerMapApi", () => {
  it("POSTs the run's body to /v1/speaker-map in the workflow's name, with the user when there is one", async () => {
    await expect(speakerMapApi(body, "user-1")).resolves.toEqual({ jobId: "job-1" })
    expect(m.apiJson).toHaveBeenCalledWith("/v1/speaker-map", { body: { ...body, userId: "user-1" }, workflowId: true, label: "apiErr.startSpeakerMap" })
  })

  it("no user: no userId key (the route takes only a uuid there)", async () => {
    await speakerMapApi(body)
    expect(m.apiJson.mock.calls[0]![1].body).toEqual(body)
  })
})
