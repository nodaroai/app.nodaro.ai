/**
 * Context + hook that exposes the editor's `navigateWithGuard` to descendants.
 *
 * `WorkflowEditor` constructs a `navigateWithGuard(href)` callback that prompts
 * via `UnsavedChangesDialog` when `useWorkflowStore.isDirty === true`, then
 * navigates. The editor's own breadcrumb and toolbar use it directly; this
 * context is the way for nodes (rendered inside React Flow) and config panels
 * (rendered inside `ConfigPanel`) to consume the same guard so they don't
 * silently discard unsaved edits.
 *
 * Default is `null`. Consumers fall back to react-router's raw `useNavigate`
 * when there's no provider (e.g. in unit tests that render a node in isolation
 * without the full editor shell — matches previous behavior).
 */
"use client"

import { createContext, useContext } from "react"
import { useNavigate } from "react-router-dom"

export type NavigateWithGuardFn = (href: string) => void

export const NavigateWithGuardContext = createContext<NavigateWithGuardFn | null>(null)

/**
 * Returns the editor's guarded navigation function when used inside
 * `WorkflowEditor`. Falls back to `useNavigate()` when no provider is present,
 * so callers always get a working `(href: string) => void`.
 */
export function useNavigateWithGuard(): NavigateWithGuardFn {
  const ctx = useContext(NavigateWithGuardContext)
  const rawNavigate = useNavigate()
  return ctx ?? rawNavigate
}
