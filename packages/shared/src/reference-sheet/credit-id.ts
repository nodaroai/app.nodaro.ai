import type { OutputFormat } from "./types.js"
/** The credit identifier for a sheet by output format (single source of truth —
 *  mirrors resolveCinematicCreditId). Used by the route guard, the orchestrator
 *  payload-builder, and the node's credit display. */
export function referenceSheetCreditId(flavour: { outputFormat?: OutputFormat | string } | undefined): string {
  return flavour?.outputFormat === "motion" ? "reference-sheet:assembly-motion" : "reference-sheet:assembly"
}
