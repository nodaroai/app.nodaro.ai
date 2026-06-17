// frontend/src/hooks/__tests__/inline-prompt-mode-store.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { useWorkflowStore } from "../use-workflow-store"
import { INLINE_PROMPT_MODE_KEY } from "@/lib/inline-prompt-pref"

describe("workflow store: inlinePromptMode", () => {
  beforeEach(() => localStorage.removeItem(INLINE_PROMPT_MODE_KEY))

  it("exposes inlinePromptMode and a setter", () => {
    const s = useWorkflowStore.getState()
    expect(typeof s.inlinePromptMode).toBe("boolean")
    expect(typeof s.setInlinePromptMode).toBe("function")
  })

  it("setInlinePromptMode updates state and persists the pref", () => {
    useWorkflowStore.getState().setInlinePromptMode(false)
    expect(useWorkflowStore.getState().inlinePromptMode).toBe(false)
    expect(localStorage.getItem(INLINE_PROMPT_MODE_KEY)).toBe("0")
    useWorkflowStore.getState().setInlinePromptMode(true)
    expect(useWorkflowStore.getState().inlinePromptMode).toBe(true)
    expect(localStorage.getItem(INLINE_PROMPT_MODE_KEY)).toBe("1")
  })

  it("does not flip the dirty flag when toggled", () => {
    useWorkflowStore.setState({ isDirty: false })
    useWorkflowStore.getState().setInlinePromptMode(false)
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })
})
