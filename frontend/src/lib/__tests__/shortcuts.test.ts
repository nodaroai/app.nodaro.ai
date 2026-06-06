import { describe, it, expect } from "vitest"
import {
  SHORTCUTS,
  matchShortcut,
  formatBinding,
  type ShortcutDef,
  type Binding,
} from "@/lib/shortcuts"

// Build a minimal KeyboardEvent-like object. matchShortcut only reads
// code/key/{ctrl,meta,shift,alt}Key, so a partial cast is sufficient and avoids
// jsdom KeyboardEvent quirks.
function ev(p: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    code: "",
    key: "",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...p,
  } as KeyboardEvent
}

describe("matchShortcut — Hebrew/Arabic regression (the bug)", () => {
  it("Ctrl+D fires under Hebrew (physical KeyD → key 'ג')", () => {
    expect(matchShortcut(ev({ code: "KeyD", key: "ג", ctrlKey: true }), SHORTCUTS.duplicate)).toBe(true)
  })
  it("Cmd+C fires under Hebrew (key 'ב')", () => {
    expect(matchShortcut(ev({ code: "KeyC", key: "ב", metaKey: true }), SHORTCUTS.copy)).toBe(true)
  })
  it("Ctrl+S (Save) fires under Hebrew (key 'ד')", () => {
    expect(matchShortcut(ev({ code: "KeyS", key: "ד", ctrlKey: true }), SHORTCUTS.save)).toBe(true)
  })
  it("Latin Ctrl+D still fires", () => {
    expect(matchShortcut(ev({ code: "KeyD", key: "d", ctrlKey: true }), SHORTCUTS.duplicate)).toBe(true)
  })
  it("a Hebrew Save event matches ONLY save (no Latin-key collision)", () => {
    const e = ev({ code: "KeyS", key: "ד", ctrlKey: true })
    const hits = (Object.values(SHORTCUTS) as ShortcutDef[]).filter((d) => !d.contextual && matchShortcut(e, d))
    expect(hits.map((d) => d.id)).toEqual(["save"])
  })
})

describe("matchShortcut — Latin physically-swapped layouts (audit A)", () => {
  it("QWERTZ: pressing 'Z' (physical KeyY) → undo, not redo", () => {
    const e = ev({ code: "KeyY", key: "z", metaKey: true })
    expect(matchShortcut(e, SHORTCUTS.undo)).toBe(true)
    expect(matchShortcut(e, SHORTCUTS.redo)).toBe(false)
  })
  it("QWERTZ: pressing 'Y' (physical KeyZ) → redo, not undo", () => {
    const e = ev({ code: "KeyZ", key: "y", metaKey: true })
    expect(matchShortcut(e, SHORTCUTS.redo)).toBe(true)
    expect(matchShortcut(e, SHORTCUTS.undo)).toBe(false)
  })
})

describe("matchShortcut — Alt+letter cross-platform (audit B)", () => {
  it("Windows Alt+F → resultPreview (key path)", () => {
    expect(matchShortcut(ev({ code: "KeyF", key: "f", altKey: true }), SHORTCUTS.resultPreview)).toBe(true)
  })
  it("macOS Alt+F → resultPreview (code fallback; Option composes 'ƒ')", () => {
    expect(matchShortcut(ev({ code: "KeyF", key: "ƒ", altKey: true }), SHORTCUTS.resultPreview)).toBe(true)
  })
  it("macOS Alt+T → tidyUp (Option composes '†') — fixes today's macOS bug", () => {
    expect(matchShortcut(ev({ code: "KeyT", key: "†", altKey: true }), SHORTCUTS.tidyUp)).toBe(true)
  })
})

describe("matchShortcut — modifiers exact", () => {
  it("no modifier → not duplicate", () => {
    expect(matchShortcut(ev({ code: "KeyD", key: "d" }), SHORTCUTS.duplicate)).toBe(false)
  })
  it("extra shift → not duplicate", () => {
    expect(matchShortcut(ev({ code: "KeyD", key: "d", ctrlKey: true, shiftKey: true }), SHORTCUTS.duplicate)).toBe(false)
  })
  it("⌘⇧A → alignmentGuides, not selectAll; ⌘A → selectAll", () => {
    expect(matchShortcut(ev({ code: "KeyA", key: "a", metaKey: true, shiftKey: true }), SHORTCUTS.alignmentGuides)).toBe(true)
    expect(matchShortcut(ev({ code: "KeyA", key: "a", metaKey: true, shiftKey: true }), SHORTCUTS.selectAll)).toBe(false)
    expect(matchShortcut(ev({ code: "KeyA", key: "a", metaKey: true }), SHORTCUTS.selectAll)).toBe(true)
  })
  it("⌘S → save not stickyNote; ⇧S → stickyNote not save", () => {
    expect(matchShortcut(ev({ code: "KeyS", key: "s", metaKey: true }), SHORTCUTS.save)).toBe(true)
    expect(matchShortcut(ev({ code: "KeyS", key: "s", metaKey: true }), SHORTCUTS.stickyNote)).toBe(false)
    expect(matchShortcut(ev({ code: "KeyS", key: "s", shiftKey: true }), SHORTCUTS.stickyNote)).toBe(true)
    expect(matchShortcut(ev({ code: "KeyS", key: "s", shiftKey: true }), SHORTCUTS.save)).toBe(false)
  })
  it("Pan needs literal Control, not Command", () => {
    expect(matchShortcut(ev({ code: "ArrowLeft", ctrlKey: true, altKey: true }), SHORTCUTS.pan)).toBe(true)
    expect(matchShortcut(ev({ code: "ArrowLeft", metaKey: true, altKey: true }), SHORTCUTS.pan)).toBe(false)
  })
})

describe("matchShortcut — help '?' (both routes)", () => {
  it("plain '?' opens help", () => {
    expect(matchShortcut(ev({ key: "?" }), SHORTCUTS.help)).toBe(true)
  })
  it("Shift+Slash (physical) opens help on any layout", () => {
    expect(matchShortcut(ev({ code: "Slash", key: "?", shiftKey: true }), SHORTCUTS.help)).toBe(true)
    expect(matchShortcut(ev({ code: "Slash", key: "ש", shiftKey: true }), SHORTCUTS.help)).toBe(true)
  })
  it("Ctrl+? does NOT open help (ctrl/meta/alt still enforced for symbols)", () => {
    expect(matchShortcut(ev({ key: "?", ctrlKey: true }), SHORTCUTS.help)).toBe(false)
  })
})

describe("registry invariants (drift guard)", () => {
  const defs = Object.values(SHORTCUTS) as ShortcutDef[]
  const KNOWN_CATEGORIES = new Set([
    "General", "Editing", "View", "Selection & Canvas", "Picker (fullscreen config)",
  ])
  const asArr = (v?: string | readonly string[]) => (v === undefined ? [] : Array.isArray(v) ? v : [v])

  it("ids are unique and match their map key", () => {
    for (const [k, d] of Object.entries(SHORTCUTS)) expect(d.id).toBe(k)
  })
  it("every def has at least one binding and a known category", () => {
    for (const d of defs) {
      expect(d.bindings.length).toBeGreaterThan(0)
      expect(KNOWN_CATEGORIES.has(d.category)).toBe(true)
    }
  })
  it("letter completeness: any letter reference carries BOTH the letter code and letter key", () => {
    for (const d of defs) {
      for (const b of d.bindings as Binding[]) {
        const codes = asArr(b.code)
        const keys = asArr(b.key)
        const refsLetter =
          codes.some((c) => /^Key[A-Z]$/.test(c)) || keys.some((k) => /^[a-z]$/i.test(k))
        if (!refsLetter) continue
        const letterCode = codes.find((c) => /^Key[A-Z]$/.test(c))
        const letterKey = keys.find((k) => /^[a-z]$/i.test(k))
        expect(letterCode, `${d.id}: missing letter code`).toBeTruthy()
        expect(letterKey, `${d.id}: missing letter key`).toBeTruthy()
        expect(letterCode!.slice(3).toLowerCase()).toBe(letterKey!.toLowerCase())
      }
    }
  })
  it("no two non-contextual defs collide on identical (code|key, mods)", () => {
    const seen = new Map<string, string>()
    for (const d of defs) {
      if (d.contextual) continue
      for (const b of d.bindings as Binding[]) {
        const sig = JSON.stringify({
          code: [...asArr(b.code)].sort(),
          key: [...asArr(b.key)].map((k) => k.toLowerCase()).sort(),
          mods: [...(b.mods ?? [])].sort(),
        })
        if (seen.has(sig)) throw new Error(`collision: ${d.id} vs ${seen.get(sig)} on ${sig}`)
        seen.set(sig, d.id)
      }
    }
    expect(seen.size).toBeGreaterThan(0)
  })
})

describe("formatBinding", () => {
  it("duplicate → ⌘D (mac) / Ctrl+D (win)", () => {
    expect(formatBinding(SHORTCUTS.duplicate.bindings[0], true)).toBe("⌘D")
    expect(formatBinding(SHORTCUTS.duplicate.bindings[0], false)).toBe("Ctrl+D")
  })
  it("pan → ⌃⌥ + arrows on mac", () => {
    expect(formatBinding(SHORTCUTS.pan.bindings[0], true)).toBe("⌃⌥↑↓←→")
  })
  it("help primary shows '?'; delete shows ⌫; addNode shows ⇥", () => {
    expect(formatBinding(SHORTCUTS.help.bindings[0], true)).toBe("?")
    expect(formatBinding(SHORTCUTS.delete.bindings[0], true)).toBe("⌫")
    expect(formatBinding(SHORTCUTS.addNode.bindings[0], true)).toBe("⇥")
  })
  it("redo → ⌘⇧Z (mac) / Ctrl+Shift+Z (win)", () => {
    expect(formatBinding(SHORTCUTS.redo.bindings[0], true)).toBe("⌘⇧Z")
    expect(formatBinding(SHORTCUTS.redo.bindings[0], false)).toBe("Ctrl+Shift+Z")
  })
})
