/**
 * The routed-node estimators (ee/billing/video-route-admission.ts), registered by
 * that module when it loads and read by the price table (credits.ts
 * `getChargedPriceTable`) — injected through this leaf, so credits.ts never
 * imports the routing modules that import it (an import cycle). Unregistered
 * (a process that never loaded admission): the price table keeps the listing,
 * the safe figure.
 */
export type RoutedNodeEstimate = { kind: "route"; credits: number } | { kind: "default" } | { kind: "listed" } | null

// The settings and route view are passed through as the caller holds them (typed loosely: this leaf imports nothing).
export interface RoutedNodeEstimators {
  estimateRoutedNode(args: { nodeType: string; data: Record<string, unknown>; priceId: string; referenceVideoDurationsSec?: readonly number[]; settings: unknown; view: unknown }): RoutedNodeEstimate
  listedRoutedNode(args: { nodeType: string; priceId: string; settings: unknown }): RoutedNodeEstimate
}

let registered: RoutedNodeEstimators | undefined

export function registerRoutedNodeEstimators(estimators: RoutedNodeEstimators): void {
  registered = estimators
}

export function registeredRoutedNodeEstimators(): RoutedNodeEstimators | undefined {
  return registered
}
