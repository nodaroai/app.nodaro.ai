import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { classifyZeroRowSave, hasSavableChanges, isSaveRefused } from "../workflow-save-refusal"

/**
 * A compare-and-swap UPDATE that matches zero rows has more than one cause,
 * and the editor used to report all of them as "updated on another device".
 * The row is re-read right after the miss, and that read decides.
 */
describe("classifyZeroRowSave", () => {
  it("is a REFUSAL when the row still sits at the version this tab sent", () => {
    // The token matched, so nobody else wrote — the row policy turned the
    // write away (a platform admin looking at somebody else's workflow).
    expect(
      classifyZeroRowSave({ version: 20, updatedAt: "T20" }, { version: 20, updated_at: "T20" }),
    ).toBe("refused")
  })

  it("stays a refusal when only updated_at moved — a thumbnail write changes no content", () => {
    expect(
      classifyZeroRowSave({ version: 20, updatedAt: "T20" }, { version: 20, updated_at: "T20-later" }),
    ).toBe("refused")
  })

  it("is a CONFLICT when the version moved past the one this tab sent", () => {
    expect(
      classifyZeroRowSave({ version: 20, updatedAt: "T20" }, { version: 21, updated_at: "T21" }),
    ).toBe("conflict")
  })

  it("compares updated_at when no version was sent (the rollout fallback CAS)", () => {
    expect(classifyZeroRowSave({ version: null, updatedAt: "T1" }, { updated_at: "T1" })).toBe("refused")
    expect(classifyZeroRowSave({ version: null, updatedAt: "T1" }, { updated_at: "T2" })).toBe("conflict")
  })

  it("is a refusal when nothing was compared at all and the row is still there", () => {
    // No token means a plain `WHERE id = …`: the only way that matches zero
    // rows while the row is readable is that it is not writable.
    expect(classifyZeroRowSave({ version: null, updatedAt: null }, { version: 3, updated_at: "T3" })).toBe("refused")
  })

  it("is UNKNOWN when the re-read found no row — deleted, or the read itself failed", () => {
    expect(classifyZeroRowSave({ version: 20, updatedAt: "T20" }, null)).toBe("unknown")
    expect(classifyZeroRowSave({ version: 20, updatedAt: "T20" }, undefined)).toBe("unknown")
  })

  it("never calls a miss a refusal on a row that carries no comparable token", () => {
    // A version was sent but the re-read row has none to compare: claiming
    // "refused" would stop somebody's own canvas from saving, on a guess.
    expect(classifyZeroRowSave({ version: 20, updatedAt: "T20" }, { updated_at: "T20" })).toBe("conflict")
    expect(classifyZeroRowSave({ version: 20, updatedAt: "T20" }, { version: "20", updated_at: "T20" })).toBe("conflict")
  })
})

describe("isSaveRefused", () => {
  it("is true only for the workflow the refusal was reached for", () => {
    expect(isSaveRefused({ workflowId: "a", saveRefusedFor: "a" })).toBe(true)
    expect(isSaveRefused({ workflowId: "b", saveRefusedFor: "a" })).toBe(false)
  })

  it("is false with nothing refused, and on a store slice that predates the field", () => {
    expect(isSaveRefused({ workflowId: "a", saveRefusedFor: null })).toBe(false)
    expect(isSaveRefused({ workflowId: "a" })).toBe(false)
  })

  it("never matches a canvas that has no workflow yet", () => {
    expect(isSaveRefused({ workflowId: null, saveRefusedFor: null })).toBe(false)
  })
})

describe("hasSavableChanges", () => {
  it("is the dirty flag while saves work", () => {
    expect(hasSavableChanges({ workflowId: "a", saveRefusedFor: null, isDirty: true, isReadOnly: false })).toBe(true)
    expect(hasSavableChanges({ workflowId: "a", saveRefusedFor: null, isDirty: false, isReadOnly: false })).toBe(false)
  })

  it("is false once this workflow's saves are refused — there is nothing a Save could keep", () => {
    expect(hasSavableChanges({ workflowId: "a", saveRefusedFor: "a", isDirty: true, isReadOnly: false })).toBe(false)
  })

  it("ignores a refusal that belongs to another workflow", () => {
    expect(hasSavableChanges({ workflowId: "b", saveRefusedFor: "a", isDirty: true, isReadOnly: false })).toBe(true)
  })

  it("is false on a dirty read-only canvas whose saves are NOT refused — its save writes nothing", () => {
    // A Studio workflow, or a `view` load whose access check failed: dragging
    // a node dirties it, and its save answers success without writing (the
    // save suite pins that), so a Save offered on leaving would keep nothing.
    expect(hasSavableChanges({ workflowId: "a", saveRefusedFor: null, isDirty: true, isReadOnly: true })).toBe(false)
  })
})

/**
 * The editor's three leave-the-page paths. Structural, like the realtime
 * wiring guard beside it: each is one line inside a 1,500-line component no
 * unit test mounts, and that one line is where the regression would live.
 */
describe("workflow-editor-main honours a refused save", () => {
  const source = readFileSync(
    join(__dirname, "..", "..", "components", "editor", "workflow-editor", "workflow-editor-main.tsx"),
    "utf8",
  )

  it("asks hasSavableChanges before the in-app dialog — its Save button could not save", () => {
    const guard = source.slice(source.indexOf("const navigateWithGuard"), source.indexOf("setShowUnsavedDialog(true)"))
    expect(guard).toMatch(/if \(!hasSavableChanges\(useWorkflowStore\.getState\(\)\)\)/)
  })

  // Both beforeunload handlers live in unload-save.ts (so a test can run them);
  // unload-save.test.tsx pins that the component calls them.
  const unload = readFileSync(
    join(__dirname, "..", "..", "components", "editor", "workflow-editor", "unload-save.ts"),
    "utf8",
  )

  it("keeps the browser's tab-close prompt on plain isDirty — the last guard on results a copy could keep", () => {
    const start = unload.indexOf("export function unloadNeedsPrompt")
    const prompt = unload.slice(start)
    expect(prompt).toMatch(/useWorkflowStore\.getState\(\)\.isDirty/)
    expect(prompt).not.toMatch(/hasSavableChanges\(/)
  })

  it("skips the unload flush — a keepalive PATCH that would only be refused again", () => {
    const start = unload.indexOf("export function unloadSaveRequest")
    const flush = unload.slice(start, unload.indexOf("keepalive: true", start))
    expect(flush).toMatch(/if \(isSaveRefused\(state\)\) return null/)
  })

  it("offers Clone & Remix beside Run", () => {
    expect(source).toMatch(/\{saveRefused && \(\s*<Button[\s\S]{0,400}?setRemixOpen\(true\)/)
  })
})
