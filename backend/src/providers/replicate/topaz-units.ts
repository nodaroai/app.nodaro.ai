/**
 * The Topaz units a Replicate prediction reports (`metrics.unspecified_billing_metric`)
 * — a leaf, so the reconcile lane reads them without the provider's import graph.
 */
export function topazBilledUnits(metrics: Record<string, unknown> | undefined): number | undefined {
  const units = metrics?.unspecified_billing_metric
  return typeof units === "number" && Number.isFinite(units) && units >= 0 ? units : undefined
}
