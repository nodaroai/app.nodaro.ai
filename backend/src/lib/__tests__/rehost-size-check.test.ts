/**
 * `checkRehostSizes` (SV12, decided 2026-10-06): a self-host relays Speaker
 * View to nodaro.ai and re-hosts every private source of the edit, buffering
 * each up to the 500 MB cap. A camera over the cap is refused BEFORE anything
 * is charged, naming the source and its size — one helper, read by the route,
 * the orchestrator's up-front scan and the relay itself.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("../../providers/nodaro/client.js", () => ({ rehostByteSize: vi.fn(async () => undefined) }))

import { checkRehostSizes, rehostSizeMessage, formatMediaBytes } from "../rehost-size-check.js"
import { MAX_REHOST_BYTES } from "../../providers/nodaro/rehost-limit.js"

const edl = (sources: Array<{ id: string; url: string; kind?: string }>) => ({
  version: 1,
  clock: "master",
  sources: sources.map((s) => ({ kind: "video", ...s })),
  segments: [{ id: "s0", inMs: 0, outMs: 1000, video: sources[0]?.id }],
})

describe("checkRehostSizes", () => {
  it("names every source over the cap, with its size, in source order", async () => {
    const sizes: Record<string, number | undefined> = {
      "http://minio:9000/a.mp4": 3_100_000_000,
      "http://minio:9000/b.mp4": 120_000_000,
      "http://minio:9000/mic.wav": 2_200_000_000,
    }
    const hits = await checkRehostSizes(
      edl([
        { id: "camA", url: "http://minio:9000/a.mp4" },
        { id: "camB", url: "http://minio:9000/b.mp4" },
        { id: "mic", url: "http://minio:9000/mic.wav", kind: "audio" },
      ]),
      { probe: async (url) => sizes[url] },
    )
    expect(hits).toEqual([
      { sourceId: "camA", bytes: 3_100_000_000 },
      { sourceId: "mic", bytes: 2_200_000_000 },
    ])
  })

  it("passes a source exactly at the cap, and one whose size is unknown (the in-rehost cap is the backstop)", async () => {
    const hits = await checkRehostSizes(
      edl([
        { id: "atCap", url: "http://minio:9000/a.mp4" },
        { id: "unknown", url: "http://minio:9000/u.mp4" },
      ]),
      { probe: async (url) => (url.endsWith("a.mp4") ? MAX_REHOST_BYTES : undefined) },
    )
    expect(hits).toEqual([])
  })

  it("asks once per distinct url", async () => {
    const probe = vi.fn(async () => 600_000_000)
    const hits = await checkRehostSizes(
      edl([
        { id: "camA", url: "http://minio:9000/a.mp4" },
        { id: "camA-wide", url: "http://minio:9000/a.mp4" },
      ]),
      { probe },
    )
    expect(probe).toHaveBeenCalledTimes(1)
    expect(hits.map((h) => h.sourceId)).toEqual(["camA", "camA-wide"])
  })

  it("reads a JSON-string edit, and is empty for anything that is not one edit with sources", async () => {
    const probe = vi.fn(async () => 9_000_000_000)
    expect(await checkRehostSizes(JSON.stringify(edl([{ id: "camA", url: "http://minio:9000/a.mp4" }])), { probe })).toEqual([
      { sourceId: "camA", bytes: 9_000_000_000 },
    ])
    for (const notAnEdit of [undefined, null, "not json", 42, [], { sources: "x" }, { sources: [null, { id: 1 }, { id: "x" }] }]) {
      expect(await checkRehostSizes(notAnEdit, { probe })).toEqual([])
    }
  })

  it("never throws: a probe that throws reads as an unknown size", async () => {
    const hits = await checkRehostSizes(edl([{ id: "camA", url: "http://minio:9000/a.mp4" }]), {
      probe: async () => {
        throw new Error("store down")
      },
    })
    expect(hits).toEqual([])
  })

  it("defaults to the relay's own probe (rehostByteSize), which sizes only what it would re-host", async () => {
    const { rehostByteSize } = await import("../../providers/nodaro/client.js")
    vi.mocked(rehostByteSize).mockResolvedValueOnce(700_000_000)
    expect(await checkRehostSizes(edl([{ id: "camA", url: "http://minio:9000/a.mp4" }]))).toEqual([
      { sourceId: "camA", bytes: 700_000_000 },
    ])
    expect(rehostByteSize).toHaveBeenCalledWith("http://minio:9000/a.mp4")
  })
})

describe("rehostSizeMessage", () => {
  it("names the node, the source and its size against the limit, and says what to do", () => {
    expect(rehostSizeMessage("Speaker View", [{ sourceId: "camA", bytes: 3_100_000_000 }])).toBe(
      'Speaker View sends each source of the edit to nodaro.ai; "camA" is 3.1 GB, over the 500 MB limit. Use a public URL or a smaller file.',
    )
    expect(
      rehostSizeMessage("Speaker View", [
        { sourceId: "camA", bytes: 3_100_000_000 },
        { sourceId: "mic", bytes: 812_000_000 },
      ]),
    ).toBe(
      'Speaker View sends each source of the edit to nodaro.ai; "camA" is 3.1 GB and "mic" is 812 MB, over the 500 MB limit. Use a public URL or a smaller file.',
    )
  })

  it("formats sizes in decimal units, as the cap itself is written", () => {
    expect(formatMediaBytes(500_000_000)).toBe("500 MB")
    expect(formatMediaBytes(999_400_000)).toBe("999 MB")
    expect(formatMediaBytes(1_000_000_000)).toBe("1.0 GB")
    expect(formatMediaBytes(12_345_000_000)).toBe("12.3 GB")
  })
})
