import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mock @wavesurfer/react — jsdom has no <canvas>/AudioContext, so we stand in a
// fake player that reports "ready" on mount and exposes the props it received so
// tests can drive lifecycle events (onReady / onError / onTimeupdate).
// ---------------------------------------------------------------------------
const { fakeWs, mockState } = vi.hoisted(() => ({
  fakeWs: {
    playPause: vi.fn(),
    stop: vi.fn(),
    seekTo: vi.fn(),
    exportPeaks: vi.fn(() => [[0, 1, 0]]),
    getDuration: vi.fn(() => 30),
  },
  mockState: { lastProps: null as Record<string, (...a: unknown[]) => void> | null },
}))

vi.mock("@wavesurfer/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react")
  return {
    default: (props: Record<string, (...a: unknown[]) => void>) => {
      mockState.lastProps = props
      React.useEffect(() => {
        props.onReady?.(fakeWs, 30)
      }, [])
      return React.createElement("div", { "data-testid": "wavesurfer" })
    },
  }
})

import { WaveformAudioPlayer } from "../waveform-audio-player"

const URL = "https://cdn.example.com/clip.mp3"

beforeEach(() => {
  vi.clearAllMocks()
  mockState.lastProps = null
})

async function renderReady(props: Partial<Parameters<typeof WaveformAudioPlayer>[0]> = {}) {
  // findBy waits out the Suspense boundary around the lazily-imported player.
  const utils = render(<WaveformAudioPlayer url={URL} {...props} />)
  await screen.findByTestId("wavesurfer")
  return utils
}

describe("WaveformAudioPlayer", () => {
  it("compact: renders play/stop/download and a decoded time readout", async () => {
    await renderReady({ variant: "compact" })
    expect(screen.getByLabelText("Play")).toBeInTheDocument()
    expect(screen.getByLabelText("Stop")).toBeInTheDocument()
    expect(screen.getByLabelText("Download")).toBeInTheDocument()
    // Time text appears after the onReady state flush — await it.
    expect(await screen.findByText("0:00 / 0:30")).toBeInTheDocument()
  })

  it("play button drives wavesurfer.playPause()", async () => {
    await renderReady({ variant: "compact" })
    fireEvent.click(screen.getByLabelText("Play"))
    expect(fakeWs.playPause).toHaveBeenCalledTimes(1)
  })

  it("stop button drives wavesurfer.stop() (pause + seek to 0)", async () => {
    await renderReady({ variant: "compact" })
    fireEvent.click(screen.getByLabelText("Stop"))
    expect(fakeWs.stop).toHaveBeenCalledTimes(1)
  })

  it("mini: hides stop, time and download (play only)", async () => {
    await renderReady({ variant: "mini" })
    expect(screen.getByLabelText("Play")).toBeInTheDocument()
    expect(screen.queryByLabelText("Stop")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Download")).not.toBeInTheDocument()
    expect(screen.queryByText(/0:00/)).not.toBeInTheDocument()
  })

  it("caches decoded peaks via exportPeaks on decode", async () => {
    await renderReady({ variant: "compact" })
    act(() => { mockState.lastProps?.onDecode?.(fakeWs, 30) })
    expect(fakeWs.exportPeaks).toHaveBeenCalled()
  })

  it("falls back to a native <audio> element when wavesurfer errors", async () => {
    const { container } = await renderReady({ variant: "compact" })
    expect(container.querySelector("audio")).toBeNull()
    act(() => { mockState.lastProps?.onError?.(new Error("decode failed")) })
    const audio = container.querySelector("audio")
    expect(audio).not.toBeNull()
    expect(audio?.getAttribute("src")).toBe(URL)
  })
})
