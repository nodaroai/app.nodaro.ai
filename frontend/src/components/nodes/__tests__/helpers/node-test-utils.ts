/**
 * Shared test utilities for node component tests.
 *
 * Provides mock implementations and helpers that every node test file
 * can reference to avoid duplicating boilerplate.
 */

import React from "react"

// ---------------------------------------------------------------------------
// Mock BaseNode
// ---------------------------------------------------------------------------

export function MockBaseNode({
  children,
  label,
  category,
  credits,
  id,
  isRunning,
}: {
  children?: React.ReactNode
  label?: string
  category?: string
  credits?: number
  id?: string
  isRunning?: boolean
  [key: string]: unknown
}) {
  return React.createElement(
    "div",
    {
      "data-testid": "base-node",
      "data-label": label,
      "data-category": category,
      "data-credits": credits,
      "data-id": id,
      "data-is-running": isRunning,
    },
    children,
  )
}

// ---------------------------------------------------------------------------
// @xyflow/react mock object
// ---------------------------------------------------------------------------

export const XYFLOW_MOCK = {
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, position, id }: { type: string; position: string; id: string }) =>
    React.createElement("div", {
      "data-testid": `handle-${id}`,
      "data-type": type,
      "data-position": position,
    }),
  NodeResizer: () => null,
  useStore: () => 1,
  useNodeId: () => "test-node",
  useUpdateNodeInternals: () => () => {},
}

// ---------------------------------------------------------------------------
// lucide-react proxy mock factory
// ---------------------------------------------------------------------------

export const LUCIDE_MOCK = new Proxy(
  {},
  {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined
      // Return a component function for any icon name
      return function MockIcon(props: Record<string, unknown>) {
        return React.createElement("span", {
          "data-testid": `icon-${prop}`,
          ...props,
        })
      }
    },
  },
)

// ---------------------------------------------------------------------------
// Workflow store mock factory
// ---------------------------------------------------------------------------

export function createWorkflowStoreMock(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    updateNodeData: () => {},
    runSingleNode: () => {},
    selectNode: () => {},
    duplicateNode: () => {},
    newNodeIds: new Set(),
    clearNewNode: () => {},
    nodes: [],
    edges: [],
    characterDefinitions: [],
    addCharacterDefinition: () => {},
    autoOpenEditorNodeId: null,
    setAutoOpenEditorNodeId: () => {},
    videoAutoplay: false,
    ...overrides,
  }

  // Support Zustand selector pattern: useWorkflowStore((s) => s.foo)
  return (selector: (s: Record<string, unknown>) => unknown) => selector(defaults)
}

// ---------------------------------------------------------------------------
// Common component mocks
// ---------------------------------------------------------------------------

export function MockRunNodeButton(props: Record<string, unknown>) {
  return React.createElement("div", {
    "data-testid": "run-node-button",
    "data-credits": props.credits,
    "data-node-id": props.nodeId,
  })
}

export function MockMediaPreviewModal() {
  return null
}

export function MockDeleteConfirmationDialog() {
  return null
}

export function MockCachedImage(props: Record<string, unknown>) {
  return React.createElement("img", {
    "data-testid": "cached-image",
    src: props.src as string,
    alt: props.alt as string,
  })
}

export function MockSaveToLibraryButton() {
  return null
}

export function MockImageLightbox() {
  return null
}

export function MockStorageExceededModal() {
  return null
}

// ---------------------------------------------------------------------------
// useFileUpload mock factory
// ---------------------------------------------------------------------------

export function createFileUploadMock(overrides: Record<string, unknown> = {}) {
  return () => ({
    upload: async () => ({}),
    isUploading: false,
    uploadError: null,
    clearError: () => {},
    storageExceeded: { exceeded: false, usedBytes: 0, quotaBytes: 0, tier: "" },
    clearStorageExceeded: () => {},
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// useModelCredits mock factory
// ---------------------------------------------------------------------------

export function createModelCreditsMock(returnValue = 1) {
  return () => returnValue
}

// ---------------------------------------------------------------------------
// Node render helper
// ---------------------------------------------------------------------------

export function createNodeProps(
  id: string,
  data: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    data,
    selected: false,
    type: "test",
    zIndex: 0,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    dragging: false,
    ...overrides,
  } as any
}
