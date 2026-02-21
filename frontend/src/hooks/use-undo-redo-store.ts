import { create } from "zustand"
import type { WorkflowNode, WorkflowEdge, CharacterDefinition } from "@/types/nodes"

export interface WorkflowSnapshot {
  readonly nodes: WorkflowNode[]
  readonly edges: WorkflowEdge[]
  readonly characterDefinitions: CharacterDefinition[]
  readonly flowPromptTemplates: Record<string, string>
  readonly workflowName: string
}

const MAX_HISTORY = 50

interface UndoRedoState {
  readonly past: WorkflowSnapshot[]
  readonly future: WorkflowSnapshot[]
  readonly pushSnapshot: (snapshot: WorkflowSnapshot) => void
  readonly undo: (current: WorkflowSnapshot) => WorkflowSnapshot | null
  readonly redo: (current: WorkflowSnapshot) => WorkflowSnapshot | null
  readonly clear: () => void
}

export const useUndoRedoStore = create<UndoRedoState>((set, get) => ({
  past: [],
  future: [],

  pushSnapshot: (snapshot) =>
    set((state) => ({
      past: [...state.past, snapshot].slice(-MAX_HISTORY),
      future: [],
    })),

  undo: (current) => {
    const { past } = get()
    if (past.length === 0) return null
    const previous = past[past.length - 1]
    set((state) => ({
      past: state.past.slice(0, -1),
      future: [current, ...state.future],
    }))
    return previous
  },

  redo: (current) => {
    const { future } = get()
    if (future.length === 0) return null
    const next = future[0]
    set((state) => ({
      past: [...state.past, current],
      future: state.future.slice(1),
    }))
    return next
  },

  clear: () => set({ past: [], future: [] }),
}))
