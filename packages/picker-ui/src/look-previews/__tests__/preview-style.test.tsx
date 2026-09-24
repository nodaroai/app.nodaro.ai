/**
 * Guards for the real / illustration choice.
 *
 * - Every rendered set is classified: it either has a drawing to switch to
 *   (ILLUSTRATED_LOOK_PICKERS) or has none (RENDER_ONLY_LOOK_PICKERS). A new
 *   set in neither fails here, so nobody ships a render without deciding.
 * - Under an illustration scope LookArt draws; a picker with nothing to draw
 *   (fallback null, or a render-only picker) keeps its render instead of
 *   going blank. With no scope everything stays real.
 * - The switch is offered only where it can do something: registered renders
 *   (never on a self-hosted install), a drawing, and an editable scope.
 */
import { afterEach, describe, expect, it } from "vitest"
import { render, renderHook, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { LookArt } from "../look-art"
import { registerLookPreviews, resetLookPreviewsForTests } from "../registry"
import { LOOK_PREVIEW_SETS } from "../sets"
import {
  ILLUSTRATED_LOOK_PICKERS,
  LookPreviewStyleProvider,
  RENDER_ONLY_LOOK_PICKERS,
  readLookPreviewStyle,
  useCanSwitchLookPreviewStyle,
  useShowsLookRenders,
  type LookPreviewStyle,
} from "../preview-style"

afterEach(() => resetLookPreviewsForTests())

const RENDER = "https://cdn.nodaro.ai/images/abc.png"
const drawn = <span data-testid="drawn">drawn</span>

function scope(style: LookPreviewStyle, onChange?: (s: LookPreviewStyle) => void) {
  return ({ children }: { children: ReactNode }) => (
    <LookPreviewStyleProvider style={style} onChange={onChange}>{children}</LookPreviewStyleProvider>
  )
}

describe("preview style classification", () => {
  it("every rendered set is either illustrated or render-only, never both", () => {
    const keys = Object.keys(LOOK_PREVIEW_SETS)
    const unclassified = keys.filter((k) => !ILLUSTRATED_LOOK_PICKERS.has(k) && !RENDER_ONLY_LOOK_PICKERS.has(k))
    const both = keys.filter((k) => ILLUSTRATED_LOOK_PICKERS.has(k) && RENDER_ONLY_LOOK_PICKERS.has(k))
    expect(unclassified).toEqual([])
    expect(both).toEqual([])
  })

  it("names no picker that has no rendered set", () => {
    const keys = new Set(Object.keys(LOOK_PREVIEW_SETS))
    const stale = [...ILLUSTRATED_LOOK_PICKERS, ...RENDER_ONLY_LOOK_PICKERS].filter((k) => !keys.has(k))
    expect(stale).toEqual([])
  })
})

describe("readLookPreviewStyle", () => {
  it("is illustration only when saved so; absent or unknown is real", () => {
    expect(readLookPreviewStyle({ previewStyle: "illustration" })).toBe("illustration")
    expect(readLookPreviewStyle({ previewStyle: "real" })).toBe("real")
    expect(readLookPreviewStyle({})).toBe("real")
    expect(readLookPreviewStyle({ previewStyle: "photo" })).toBe("real")
    expect(readLookPreviewStyle(undefined)).toBe("real")
  })
})

describe("LookArt under a preview style", () => {
  it("shows the render with no scope, and under a real scope", () => {
    registerLookPreviews({ style: { anime: RENDER } })
    const { container, unmount } = render(<LookArt pickerKey="style" id="anime" fallback={drawn} />)
    expect(container.querySelector("img")).not.toBeNull()
    unmount()
    render(<LookArt pickerKey="style" id="anime" fallback={drawn} />, { wrapper: scope("real") })
    expect(screen.queryByTestId("drawn")).toBeNull()
  })

  it("draws under an illustration scope", () => {
    registerLookPreviews({ style: { anime: RENDER } })
    const { container } = render(<LookArt pickerKey="style" id="anime" fallback={drawn} />, { wrapper: scope("illustration") })
    expect(screen.getByTestId("drawn")).toBeInTheDocument()
    expect(container.querySelector("img")).toBeNull()
  })

  it("keeps the clip away under an illustration scope (camera motion draws its diagram)", () => {
    registerLookPreviews({ "camera-motion": { "dolly-in": "https://cdn.nodaro.ai/videos/abc.mp4" } })
    const { container } = render(<LookArt pickerKey="camera-motion" id="dolly-in" fallback={drawn} />, { wrapper: scope("illustration") })
    expect(screen.getByTestId("drawn")).toBeInTheDocument()
    expect(container.querySelector("img")).toBeNull()
  })

  it("keeps the render when there is nothing to draw", () => {
    registerLookPreviews({ style: { anime: RENDER }, era: { "1920s": RENDER } })
    const { container, unmount } = render(<LookArt pickerKey="style" id="anime" fallback={null} />, { wrapper: scope("illustration") })
    expect(container.querySelector("img")).not.toBeNull()
    unmount()
    // A render-only picker keeps its render even if a caller passes a fallback.
    const era = render(<LookArt pickerKey="era" id="1920s" fallback={drawn} />, { wrapper: scope("illustration") })
    expect(era.container.querySelector("img")).not.toBeNull()
    expect(screen.queryByTestId("drawn")).toBeNull()
  })
})

describe("useShowsLookRenders", () => {
  it("is true only with registered renders and a real scope", () => {
    expect(renderHook(() => useShowsLookRenders("mood")).result.current).toBe(false)
    registerLookPreviews({ mood: { calm: RENDER } })
    expect(renderHook(() => useShowsLookRenders("mood")).result.current).toBe(true)
    expect(renderHook(() => useShowsLookRenders("mood"), { wrapper: scope("illustration") }).result.current).toBe(false)
  })
})

describe("useCanSwitchLookPreviewStyle", () => {
  const onChange = () => {}

  it("needs registered renders — never offered on a self-hosted install", () => {
    expect(renderHook(() => useCanSwitchLookPreviewStyle("style"), { wrapper: scope("real", onChange) }).result.current).toBe(false)
    registerLookPreviews({ style: { anime: RENDER } })
    expect(renderHook(() => useCanSwitchLookPreviewStyle("style"), { wrapper: scope("real", onChange) }).result.current).toBe(true)
  })

  it("needs an editable scope — never offered on a read-only surface", () => {
    registerLookPreviews({ style: { anime: RENDER } })
    expect(renderHook(() => useCanSwitchLookPreviewStyle("style"), { wrapper: scope("real") }).result.current).toBe(false)
    expect(renderHook(() => useCanSwitchLookPreviewStyle("style")).result.current).toBe(false)
  })

  it("needs a drawing — never offered for a render-only picker", () => {
    registerLookPreviews({ era: { "1920s": RENDER } })
    expect(renderHook(() => useCanSwitchLookPreviewStyle("era"), { wrapper: scope("real", onChange) }).result.current).toBe(false)
  })
})
