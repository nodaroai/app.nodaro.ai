import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../index.js"
import type { DescribedReference } from "../index.js"

/**
 * `describedReferences` + the rail captions on the typed node params. A
 * described reference has no url, so it attaches nothing and claims no
 * `@image_N` seat — the route renders it as a `<Name> — <description>.` line so
 * a name left in the prompt prose reaches the model as a described subject.
 */

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}

const described: DescribedReference[] = [
  { name: "Natalie", description: "a tall woman in a red coat" },
]

/** The JSON body of the most recent request. */
function sentBody(calls: readonly unknown[][]): Record<string, unknown> {
  const init = calls.at(-1)![1] as { body: string }
  return JSON.parse(init.body) as Record<string, unknown>
}

describe("nodes.run — describedReferences", () => {
  it("sends them on the image lane with no other reference channel", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j1" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.nodes.run("generate-image", {
      prompt: "Natalie walks down the pier.",
      describedReferences: described,
    })
    expect(sentBody(fetchMock.mock.calls).describedReferences).toEqual(described)
  })

  it("sends them on the video lane alongside index-aligned rail captions", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j2" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.nodes.run("generate-video", {
      prompt: "Natalie reacts.",
      describedReferences: described,
      referenceVideoUrls: ["https://cdn.example/clip.mp4"],
      referenceVideoCaptions: ["the establishing drone shot"],
    })
    const body = sentBody(fetchMock.mock.calls)
    expect(body.describedReferences).toEqual(described)
    expect(body.referenceVideoCaptions).toEqual(["the establishing drone shot"])
  })

  it("sends a per-use descriptionOverride on a connected reference", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j3" }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.nodes.run("generate-image", {
      prompt: "Kira walks.",
      connectedReferences: [
        {
          id: "c1",
          defaultName: "Kira",
          source: "wired-character",
          url: "https://cdn.example/kira.png",
          descriptionOverride: "a woman with a shaved head and a scar",
        },
      ],
    })
    const refs = sentBody(fetchMock.mock.calls).connectedReferences as Array<Record<string, unknown>>
    expect(refs[0].descriptionOverride).toBe("a woman with a shaved head and a scar")
  })
})
