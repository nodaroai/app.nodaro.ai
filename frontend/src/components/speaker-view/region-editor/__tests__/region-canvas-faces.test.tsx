/**
 * The tracked faces on the region editor's frame (P3.9): a face sits inside its
 * speaker's box, so its chip must be on top of the boxes to be clickable, and
 * it must stay inside the frame (which clips) near the bottom edge.
 */
import { createRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { RegionCanvas, type CanvasFace } from "../region-canvas"

afterEach(() => cleanup())

function canvas(faces: CanvasFace[], onFacePick = vi.fn(), onDragStart = vi.fn()) {
  render(
    <RegionCanvas
      media={{ kind: "none" }}
      videoRef={createRef<HTMLVideoElement>()}
      imageRef={createRef<HTMLImageElement>()}
      boxes={[{ key: "host", label: "Host", color: "#f00", region: { x: 0, y: 0, w: 0.5, h: 1 } }]}
      selectedKey="host"
      onSelect={() => {}}
      onDragStart={onDragStart}
      onChange={() => {}}
      onVideoMeta={() => {}}
      onImageSize={() => {}}
      onMediaError={() => {}}
      emptyLabel="none"
      faces={faces}
      onFacePick={onFacePick}
    />,
  )
  return { onFacePick, onDragStart }
}

const face = (key: string, y: number, h = 0.2): CanvasFace => ({ key, label: key, color: "#0f0", region: { x: 0.1, y, w: 0.2, h } })

describe("RegionCanvas — tracked faces", () => {
  it("draws the faces after the boxes, on a higher layer", () => {
    canvas([face("t1", 0.2)])
    const frame = screen.getByTestId("region-frame")
    const kids = [...frame.children]
    expect(kids.indexOf(screen.getByTestId("region-face-t1"))).toBeGreaterThan(kids.indexOf(screen.getByTestId("region-box-Host")))
    expect(screen.getByTestId("region-face-t1").className).toMatch(/\bz-20\b/)
  })

  it("a click on a chip picks the face and never starts a box drag", () => {
    const { onFacePick, onDragStart } = canvas([face("t1", 0.2)])
    const chip = screen.getByTestId("region-face-t1").querySelector("button")!
    fireEvent.pointerDown(chip)
    fireEvent.click(chip)
    expect(onFacePick).toHaveBeenCalledWith("t1")
    expect(onDragStart).not.toHaveBeenCalled()
  })

  it("hangs the chip below the face, or inside it near the frame's bottom edge (the frame clips)", () => {
    canvas([face("high", 0.2), face("low", 0.75, 0.22)])
    expect(screen.getByTestId("region-face-high").querySelector("button")!.dataset.chipPlacement).toBe("below")
    expect(screen.getByTestId("region-face-low").querySelector("button")!.dataset.chipPlacement).toBe("inside")
  })
})
