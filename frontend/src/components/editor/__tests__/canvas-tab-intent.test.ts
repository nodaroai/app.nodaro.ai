// @test-watches frontend/src/components/editor/workflow-canvas.tsx frontend/src/components/editor/add-node-popup.tsx
import { describe, it, expect, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { tabOpensAddNode, trackCanvasPointer } from "../canvas-tab-intent"

/**
 * Tab opens Add Node only for someone working on the canvas; everywhere else
 * it moves focus (WCAG 2.1.1 / 2.1.2). Before this, a keyboard user on any
 * toolbar or sidebar button of the editor could not Tab anywhere.
 */

function setup() {
  document.body.innerHTML = `
    <button id="toolbar">Run</button>
    <div class="react-flow"><div class="react-flow__pane" id="pane"></div><div class="react-flow__node" id="node" tabindex="0"></div></div>
    <aside><button id="sidebar">Projects</button></aside>`
  return (id: string) => document.getElementById(id)!
}

afterEach(() => {
  document.body.innerHTML = ""
})

describe("tabOpensAddNode", () => {
  it("opens Add Node on the canvas after a pointer press there", () => {
    const $ = setup()
    expect(tabOpensAddNode($("node"), true)).toBe(true)
    expect(tabOpensAddNode($("pane"), true)).toBe(true)
  })

  it("lets a keyboard user Tab through the canvas: no pointer press, no Add Node", () => {
    const $ = setup()
    expect(tabOpensAddNode($("node"), false)).toBe(false)
    expect(tabOpensAddNode($("pane"), false)).toBe(false)
  })

  it("moves focus from a toolbar or sidebar button", () => {
    const $ = setup()
    expect(tabOpensAddNode($("toolbar"), true)).toBe(false)
    expect(tabOpensAddNode($("sidebar"), true)).toBe(false)
  })

  it("with focus on the page, follows the last pointer press", () => {
    setup()
    expect(tabOpensAddNode(document.body, true)).toBe(true)
    expect(tabOpensAddNode(document.body, false)).toBe(false)
  })
})

describe("trackCanvasPointer", () => {
  it("remembers a press on the canvas and forgets it on a press or focus elsewhere", () => {
    const $ = setup()
    const tracker = trackCanvasPointer(document)
    expect(tracker.onCanvas()).toBe(false)
    $("pane").dispatchEvent(new Event("pointerdown", { bubbles: true }))
    expect(tracker.onCanvas()).toBe(true)
    $("toolbar").dispatchEvent(new Event("pointerdown", { bubbles: true }))
    expect(tracker.onCanvas()).toBe(false)
    $("pane").dispatchEvent(new Event("pointerdown", { bubbles: true }))
    $("sidebar").dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    expect(tracker.onCanvas()).toBe(false)
    tracker.dispose()
  })
})

/**
 * What a browser does on a click on the empty pane: the pane is not
 * focusable, so focus goes to its nearest focusable ancestor, the skip
 * link's `<main tabindex="-1">`. Tab then arrives with `main` as its target.
 * Treating `main` as "outside the canvas" broke Tab for every mouse user.
 */
function setupEditorPage() {
  document.body.innerHTML = `
    <button id="sidebar">Projects</button>
    <main id="main" tabindex="-1">
      <button id="toolbar">Run</button>
      <div class="react-flow"><div class="react-flow__pane" id="pane"></div><div class="react-flow__node" id="node" tabindex="0"></div></div>
    </main>
    <div data-canvas-tab-scope=""><input id="popup-search" /><button id="popup-item">Generate Image</button></div>`
  return (id: string) => document.getElementById(id)!
}

const press = (el: Element) => el.dispatchEvent(new Event("pointerdown", { bubbles: true }))
const focusOn = (el: HTMLElement) => {
  el.focus()
  el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
}

describe("a mouse user on the editor page", () => {
  it("click on the empty canvas, focus moves to main, Tab opens Add Node", () => {
    const $ = setupEditorPage()
    const tracker = trackCanvasPointer(document)
    press($("pane"))
    focusOn($("main"))
    expect(tracker.onCanvas()).toBe(true)
    expect(tabOpensAddNode(document.activeElement, tracker.onCanvas())).toBe(true)
    tracker.dispose()
  })

  it("Tab still opens Add Node after picking from the popup", () => {
    const $ = setupEditorPage()
    const tracker = trackCanvasPointer(document)
    press($("pane"))
    focusOn($("popup-search"))
    press($("popup-item"))
    expect(tracker.onCanvas()).toBe(true)
    // The popup closes: focus falls back to the page.
    focusOn($("main"))
    expect(tabOpensAddNode(document.activeElement, tracker.onCanvas())).toBe(true)
    tracker.dispose()
  })

  it("a keyboard user who skip-links to main still Tabs forward", () => {
    const $ = setupEditorPage()
    const tracker = trackCanvasPointer(document)
    focusOn($("main"))
    expect(tabOpensAddNode($("main"), tracker.onCanvas())).toBe(false)
    tracker.dispose()
  })

  it("a toolbar button inside main is still outside the canvas", () => {
    const $ = setupEditorPage()
    const tracker = trackCanvasPointer(document)
    press($("pane"))
    focusOn($("toolbar"))
    expect(tracker.onCanvas()).toBe(false)
    expect(tabOpensAddNode($("toolbar"), true)).toBe(false)
    tracker.dispose()
  })
})

describe("the canvas wires it in", () => {
  it("the Add Node popup is marked as canvas scope", () => {
    const src = readFileSync(resolve(__dirname, "../add-node-popup.tsx"), "utf8")
    expect(src).toMatch(/ref=\{popupRef\}[\s\S]{0,200}data-canvas-tab-scope=""/)
  })

  it("the Add Node shortcut asks tabOpensAddNode before taking Tab", () => {
    const src = readFileSync(resolve(__dirname, "../workflow-canvas.tsx"), "utf8")
    const at = src.indexOf("matchShortcut(e, SHORTCUTS.addNode)")
    expect(at).toBeGreaterThan(-1)
    expect(src.slice(at, at + 600)).toMatch(/tabOpensAddNode\(e\.target, canvasPointer/)
    expect(src).toMatch(/trackCanvasPointer\(document\)/)
  })
})
