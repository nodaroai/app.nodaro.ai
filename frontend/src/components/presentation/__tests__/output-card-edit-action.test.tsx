import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

/**
 * The "Edit" action on a presentation / app-runner output card (the ••• menu
 * and the mobile action bar), bound for every card by `resolveCardActions`.
 *
 * A video card's Edit opens the embedded video editor, so it is offered only
 * where that editor is on: an install with it switched off (`FREECUT_URL=off`)
 * offers no Edit on a video card. Image and audio cards are untouched by that:
 * images use the built-in image editor, and an audio card offers Edit in every
 * state of `AUDIOMASS_URL` (nothing set, an operator's own editor, or `off`,
 * which reads the same as unset), as it always has; what an Edit with no audio
 * editor then does is the presentation view's own handling (the editor modal
 * explains what to set).
 */

vi.mock("@/components/audio-player", () => ({ WaveformAudioPlayer: () => null }))
vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: ({ src }: { src: string }) => <img src={src} alt="" />,
}))

import { resolveCardActions } from "../output-cards/shared"
import { VideoOutputCard } from "../output-cards/video-output-card"
import { AudioOutputCard } from "../output-cards/audio-output-card"
import { ImageOutputCard } from "../output-cards/image-output-card"

const VIDEO = "https://cdn.example/out/clip.mp4"
const AUDIO = "https://cdn.example/out/voice.mp3"
const IMAGE = "https://cdn.example/out/still.png"

afterEach(() => { delete window.__NODARO_RUNTIME__ })

// The action bar is the card's always-rendered row (the ••• menu opens on a pointer gesture).
const editButton = () => screen.queryByRole("button", { name: /^edit$/i })

describe("output cards with both editors configured", () => {
  const configure = () => {
    window.__NODARO_RUNTIME__ = { freecutUrl: "https://freecut.example.internal", audiomassUrl: "https://audiomass.example.internal" }
  }

  it("binds Edit for video, audio and image", () => {
    configure()
    const onEdit = vi.fn()
    for (const [type, url] of [["video", VIDEO], ["audio", AUDIO], ["image", IMAGE]] as const) {
      const bound = resolveCardActions({ onEdit }, "N1", type, url)
      expect(bound.onEdit, type).toBeTypeOf("function")
      bound.onEdit!()
      expect(onEdit).toHaveBeenLastCalledWith("N1", type, url)
    }
  })

  it("a video card shows Edit and hands the node and its video to the handler", () => {
    configure()
    const onEdit = vi.fn()
    render(<VideoOutputCard label="Clip" status="completed" url={VIDEO} nodeId="N1" actions={{ onEdit }} />)
    fireEvent.click(editButton()!)
    expect(onEdit).toHaveBeenCalledWith("N1", "video", VIDEO)
  })

  it("an audio card shows Edit", () => {
    configure()
    const onEdit = vi.fn()
    render(<AudioOutputCard label="Voice" status="completed" url={AUDIO} nodeId="N1" actions={{ onEdit }} />)
    fireEvent.click(editButton()!)
    expect(onEdit).toHaveBeenCalledWith("N1", "audio", AUDIO)
  })

  it("an image card shows Edit", () => {
    configure()
    const onEdit = vi.fn()
    render(<ImageOutputCard label="Still" status="completed" url={IMAGE} nodeId="N1" actions={{ onEdit }} />)
    fireEvent.click(editButton()!)
    expect(onEdit).toHaveBeenCalledWith("N1", "image", IMAGE)
  })
})

describe("a video card on an install that sets nothing", () => {
  it("shows Edit (the hosted video editor is the default)", () => {
    window.__NODARO_RUNTIME__ = {}
    const onEdit = vi.fn()
    render(<VideoOutputCard label="Clip" status="completed" url={VIDEO} nodeId="N1" actions={{ onEdit }} />)
    expect(editButton()).not.toBeNull()
  })
})

describe("output cards with the video editor switched off", () => {
  it.each(["off", "none", "false", "disabled"])("FREECUT_URL=%j binds no Edit for video; audio and image keep it", (value) => {
    window.__NODARO_RUNTIME__ = { freecutUrl: value }
    const onEdit = vi.fn()
    expect(resolveCardActions({ onEdit }, "N1", "video", VIDEO).onEdit).toBeUndefined()
    expect(resolveCardActions({ onEdit }, "N1", "audio", AUDIO).onEdit).toBeTypeOf("function")
    expect(resolveCardActions({ onEdit }, "N1", "image", IMAGE).onEdit).toBeTypeOf("function")
  })

  it("a video card shows no Edit, and keeps its other actions", () => {
    window.__NODARO_RUNTIME__ = { freecutUrl: "off" }
    render(<VideoOutputCard label="Clip" status="completed" url={VIDEO} nodeId="N1" actions={{ onEdit: vi.fn(), onHide: vi.fn() }} />)
    expect(editButton()).toBeNull()
    expect(screen.getByRole("button", { name: /^hide$/i })).toBeTruthy()
  })

  it("an audio card and an image card still show Edit", () => {
    window.__NODARO_RUNTIME__ = { freecutUrl: "off" }
    const onEdit = vi.fn()
    render(<AudioOutputCard label="Voice" status="completed" url={AUDIO} nodeId="N1" actions={{ onEdit }} />)
    fireEvent.click(editButton()!)
    expect(onEdit).toHaveBeenLastCalledWith("N1", "audio", AUDIO)
    render(<ImageOutputCard label="Still" status="completed" url={IMAGE} nodeId="N1" actions={{ onEdit }} />)
    expect(screen.getAllByRole("button", { name: /^edit$/i })).toHaveLength(2)
  })
})

describe.each([
  ["nothing set (no hosted audio editor exists)", {}],
  ["an operator's own audio editor", { audiomassUrl: "https://audiomass.example.internal" }],
  ["AUDIOMASS_URL=off (read the same as unset)", { audiomassUrl: "off" }],
] as const)("an audio card with %s", (_label, runtime) => {
  it("offers Edit and hands the node and its audio to the handler, as it always has", () => {
    window.__NODARO_RUNTIME__ = { ...runtime }
    const onEdit = vi.fn()
    expect(resolveCardActions({ onEdit }, "N1", "audio", AUDIO).onEdit).toBeTypeOf("function")
    render(<AudioOutputCard label="Voice" status="completed" url={AUDIO} nodeId="N1" actions={{ onEdit }} />)
    fireEvent.click(editButton()!)
    expect(onEdit).toHaveBeenCalledWith("N1", "audio", AUDIO)
  })
})
