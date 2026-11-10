import type { NodeState } from "./execution-utils"

/**
 * A failed node state's sentence and, under it, the provider's own words about that failure
 * (`errorDetail`, display only). One rendering for every run history tooltip, so a list of runs
 * never shows the sentence without its words.
 */
export function NodeStateErrorText({ state }: { readonly state: Pick<NodeState, "error" | "errorDetail"> }) {
  const words = typeof state.errorDetail === "string" && state.errorDetail !== "" ? state.errorDetail : null
  return (
    <>
      <p className="text-xs">{state.error}</p>
      {words && (
        <p data-testid="node-state-provider-words" className="mt-1 text-[11px] text-muted-foreground break-words">
          {words}
        </p>
      )}
    </>
  )
}
