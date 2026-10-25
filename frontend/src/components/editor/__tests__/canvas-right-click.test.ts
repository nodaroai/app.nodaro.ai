// @test-watches frontend/src/components/editor/workflow-canvas.tsx
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * A right-click on the empty canvas opens the full Add Node popup at the
 * cursor, the same one Tab opens. It used to open a short menu first, where
 * the popup sat behind "More nodes…".
 */
describe("right-click on the canvas", () => {
  const src = readFileSync(resolve(__dirname, "../workflow-canvas.tsx"), "utf8")

  it("opens the Add Node popup at the cursor", () => {
    const at = src.indexOf("const handlePaneContextMenu = useCallback(")
    expect(at).toBeGreaterThan(-1)
    expect(src.slice(at, at + 600)).toMatch(/handleOpenAddNodePopup\(\{ x: event\.clientX, y: event\.clientY \}\)/)
    expect(src).toMatch(/onPaneContextMenu=\{isMobile \? undefined : handlePaneContextMenu\}/)
  })

  it("opens unbound: a node a Tab bound the popup to earlier is forgotten", () => {
    const at = src.indexOf("const handleOpenAddNodePopup = useCallback(")
    const end = src.indexOf("}, [getViewportCenter])", at)
    expect(at).toBeGreaterThan(-1)
    expect(src.slice(at, end)).toMatch(/setAutoConnectCtx\(null\)/)
  })

  it("no longer opens a short menu in between", () => {
    expect(src).not.toMatch(/CanvasContextMenu/)
  })
})
