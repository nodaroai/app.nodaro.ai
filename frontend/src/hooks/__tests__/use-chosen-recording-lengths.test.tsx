/**
 * The app runner reads the length of each recording the user chose (decided
 * 2026-10-07), keyed by url, and both runner surfaces price the live estimate
 * and the Run button with it.
 */
import { describe, it, expect, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { useChosenRecordingLengths } from "../use-chosen-recording-lengths"

const nodes = [{ id: "v", type: "upload-video" }, { id: "a", type: "upload-audio" }, { id: "t", type: "text-prompt" }]

describe("useChosenRecordingLengths", () => {
  it("reads each chosen recording once, as video or audio, and keys it by url", async () => {
    const read = vi.fn(async (url: string, _kind: "video" | "audio") => (url.endsWith(".mp4") ? 2700 : 1800))
    const inputValues = { v: { url: "https://cdn/ep.mp4" }, a: { url: "https://cdn/ep.mp3" }, t: { text: "hi" } }
    const { result, rerender } = renderHook(() => useChosenRecordingLengths(nodes, inputValues, read))
    await waitFor(() => expect(result.current.size).toBe(2))
    expect(result.current.get("https://cdn/ep.mp4")).toBe(2700)
    expect(result.current.get("https://cdn/ep.mp3")).toBe(1800)
    expect(read.mock.calls.map((c) => c[1]).sort()).toEqual(["audio", "video"])
    rerender()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it("reads nothing before a recording is chosen, and keeps an unreadable one unknown", async () => {
    const read = vi.fn(async () => undefined)
    const { result } = renderHook(() => useChosenRecordingLengths(nodes, { v: { url: "https://cdn/broken.mp4" } }, read))
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    expect(result.current.size).toBe(0)
  })
})

describe("both runner surfaces price the chosen recordings' lengths", () => {
  const SRC = resolve(__dirname, "../..")
  for (const rel of ["components/presentation/presentation-view.tsx", "components/app-runner/mobile-app-shell.tsx"]) {
    it(rel, () => {
      const text = readFileSync(resolve(SRC, rel), "utf8")
      expect(text).toMatch(/useChosenRecordingLengths\(/)
      expect(text).toMatch(/mediaLengths: chosenRecordingLengths/)
      expect(text).toMatch(/runCostLabel\(/)
      expect(text).toMatch(/recordingLengthPending\(/)
    })
  }
})
