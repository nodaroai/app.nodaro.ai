import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mock @wavesurfer/react — jsdom has no <canvas>/AudioContext, so we stand in a
// fake player that reports "ready" on mount and exposes the props it received so
// tests can drive lifecycle events (onReady / onError / onTimeupdate).
// ---------------------------------------------------------------------------
const { fakeWs, mockState } = vi.hoisted(() => ({
  fakeWs: {
    play: vi.fn(() => Promise.resolve()),
    playPause: vi.fn(),
    stop: vi.fn(),
    seekTo: vi.fn(),
    getDuration: vi.fn(() => 30),
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockState: { lastProps: null as any },
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

  it("autoPlay starts playback on ready, NOT via the wavesurfer autoplay option", async () => {
    // Regression: the autoplay option + @wavesurfer/react's recreate-on-option-change
    // left a detached, playing media element (ghost audio) you couldn't stop. We must
    // never hand wavesurfer `autoplay`; we call play() once the instance is ready.
    await renderReady({ variant: "compact", autoPlay: true })
    expect(mockState.lastProps?.autoplay).toBeFalsy()
    expect(fakeWs.play).toHaveBeenCalledTimes(1)
  })

  it("does not auto-play when autoPlay is not set", async () => {
    await renderReady({ variant: "compact" })
    expect(fakeWs.play).not.toHaveBeenCalled()
  })

  it("never passes churning options (peaks/autoplay) that would rebuild the instance", async () => {
    await renderReady({ variant: "compact" })
    // peaks must not be fed reactively (undefined→array churn rebuilt the instance).
    expect(mockState.lastProps?.peaks).toBeUndefined()
    expect(mockState.lastProps?.autoplay).toBeFalsy()
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
