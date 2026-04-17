/**
 * Hook that auto-executes an inline node when its config fields change.
 * Debounced at 300ms. Skips on initial mount and workflow load.
 */

import { useEffect, useRef } from "react"
import { useWorkflowStore, EXECUTION_DATA_KEYS } from "@/hooks/use-workflow-store"
import { autoExecuteNode } from "@/components/editor/workflow-editor/auto-execute"

/** Keys that are NOT config — changes to these should NOT trigger auto-execute. */
const IGNORE_KEYS = new Set([
  ...EXECUTION_DATA_KEYS,
  // Extra output keys not in the undo set
  "generatedJson", "__listInputs",
  // Node-specific outputs
  "combinedText", "splitResults", "extractedText", "listResults",
  // Meta fields
  "label", "presentationInput", "presentationOutput", "skipped", "__expandedClone",
])

function configSnapshot(data: Record<string, unknown>): string {
  const config: Record<string, unknown> = {}
  for (const key of Object.keys(data)) {
    if (!IGNORE_KEYS.has(key)) config[key] = data[key]
  }
  return JSON.stringify(config)
}

/**
 * Watches a node's config fields and triggers auto-execution on change.
 * @param nodeId  The node to auto-execute
 * @param data    The full node data object (from React Flow props)
 */
export function useAutoExecute(nodeId: string, data: Record<string, unknown>): void {
  const loadGen = useWorkflowStore((s) => s.loadGeneration)
  const prevSnapshot = useRef<string>("")
  const prevLoadGen = useRef(loadGen)
  const mounted = useRef(false)

  const snapshot = configSnapshot(data)

  useEffect(() => {
    // Skip first render (initial mount)
    if (!mounted.current) {
      mounted.current = true
      prevSnapshot.current = snapshot
      prevLoadGen.current = loadGen
      return
    }

    // Skip when workflow was just loaded/switched (loadGeneration changed)
    if (loadGen !== prevLoadGen.current) {
      prevLoadGen.current = loadGen
      prevSnapshot.current = snapshot
      return
    }

    // Skip if config didn't actually change
    if (snapshot === prevSnapshot.current) return
    prevSnapshot.current = snapshot

    const timer = setTimeout(() => {
      autoExecuteNode(nodeId)
    }, 300)

    return () => clearTimeout(timer)
  }, [snapshot, nodeId, loadGen])
}
