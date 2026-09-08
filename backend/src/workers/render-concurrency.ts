/** Bound scene renders independently of the host's advertised core count.
 * Each WebGL tab owns renderer threads; several jobs can exhaust a container's
 * process limit even while CPU and memory are available. */
export function remotionConcurrencyFor(compositionId: string, configured: number | null | undefined): number | undefined {
  return configured ?? (compositionId === "3d-scene" ? 2 : undefined)
}
