import { create } from "zustand"

export interface SubWorkflowStackFrame {
  readonly workflowId: string
  readonly workflowName: string
}

interface SubWorkflowStackState {
  readonly rootFrame: SubWorkflowStackFrame | null
  readonly stack: readonly SubWorkflowStackFrame[]
  setRoot: (frame: SubWorkflowStackFrame | null) => void
  push: (frame: SubWorkflowStackFrame) => void
  pop: () => void
  popTo: (workflowId: string) => void
  clear: () => void
}

export const useSubWorkflowStack = create<SubWorkflowStackState>((set) => ({
  rootFrame: null,
  stack: [],
  // Idempotent: only sets if rootFrame is null. First push wins.
  // Pass null to force-reset (clear() does this).
  setRoot: (frame) =>
    set((s) => {
      if (frame === null) return { rootFrame: null }
      if (s.rootFrame !== null) return s
      return { rootFrame: frame }
    }),
  push: (frame) => set((s) => ({ stack: [...s.stack, frame] })),
  pop:  () => set((s) => ({ stack: s.stack.slice(0, -1) })),
  popTo: (workflowId) =>
    set((s) => {
      const idx = s.stack.findIndex((f) => f.workflowId === workflowId)
      if (idx === -1) return s
      return { stack: s.stack.slice(0, idx + 1) }
    }),
  clear: () => set({ stack: [], rootFrame: null }),
}))
