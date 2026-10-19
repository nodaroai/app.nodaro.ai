/**
 * A use-case node's continuation refused before any work, as a run on the
 * canvas lands it (decided 2026-10-18; the refusals and what they leave are
 * `usecaseRefusedBeforeWorkPatch`, lib/use-case-run-result.ts): no failed run —
 * the node is put back as it was, with its Preview, and the refusal is said
 * once per run as a passing error. Every repaint of that run after the first
 * finds it handled and writes nothing (the node no longer reads failed, so the
 * failed branch is entered on each one).
 */
import { toast } from "sonner"
import { nodeStateErrorText } from "@/lib/execution-error-text"
import { usecaseRefusedBeforeWorkPatch } from "@/lib/use-case-run-result"

/** The runs × nodes whose refusal was already said (bounded: only the latest few matter). */
const said = new Set<string>()
const SAID_CAP = 200

/**
 * What the canvas writes on `node` for its failed run state `state`: the
 * patch that puts it back (said once), `null` when this run's refusal was
 * already landed (write nothing), `undefined` when it is no such refusal.
 */
export function usecaseRefusalOnCanvas(
  node: { readonly id: string; readonly type?: string | null },
  state: { readonly error?: string | null; readonly errorCode?: string | null },
  data: Readonly<Record<string, unknown>>,
  runId: string | undefined,
): Record<string, unknown> | null | undefined {
  const patch = usecaseRefusedBeforeWorkPatch(node.type, state.errorCode, data)
  if (!patch) return undefined
  const key = runId ? `${runId}\u0000${node.id}` : undefined
  if (key && said.has(key)) return null
  if (key) {
    if (said.size >= SAID_CAP) said.clear()
    said.add(key)
  }
  // One toast per node: a repaint with no run id replaces it rather than stacking.
  toast.error(nodeStateErrorText(state, node.type), { id: `use-case-refused-${node.id}` })
  return patch
}
