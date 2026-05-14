import { create } from "zustand"

export interface SubWorkflowStackFrame {
  readonly workflowId: string
  readonly workflowName: string
  readonly sourceNodeId: string | null  // The sub-workflow node in the parent that opened this child
}

interface SubWorkflowStackState {
  readonly stack: readonly SubWorkflowStackFrame[]
  push: (frame: SubWorkflowStackFrame) => void
  pop: () => void
  popTo: (workflowId: string) => void
  clear: () => void
}

export const useSubWorkflowStack = create<SubWorkflowStackState>((set) => ({
  stack: [],
  push: (frame) => set((s) => ({ stack: [...s.stack, frame] })),
  pop:  () => set((s) => ({ stack: s.stack.slice(0, -1) })),
  popTo: (workflowId) =>
    set((s) => {
      const idx = s.stack.findIndex((f) => f.workflowId === workflowId)
      if (idx === -1) return s
      return { stack: s.stack.slice(0, idx + 1) }
    }),
  clear: () => set({ stack: [] }),
}))
