import { useMemo } from "react"
import { useSurfaceAvailability } from "@/lib/surface-availability"
import { withoutDeniedModels, type ModelMenuOwner } from "./model-options"

/**
 * The rows of a `*_MODELS` registry a config-panel menu may offer: the
 * deployment's hidden models dropped (`withoutDeniedModels`, each row judged as
 * the model it makes `menu`'s node run), the node's
 * stored model kept, and the component SUBSCRIBED to availability — an
 * admin's switch flips the menu while the panel is open, instead of on the
 * next mount. Every config-panel model menu renders through this (or the
 * filter itself); `__tests__/model-menus-offered.test.ts` fails a menu that
 * maps a registry straight into its items.
 */
export function useOfferedModels<T extends { value: string }>(models: readonly T[], menu: ModelMenuOwner, keep?: string): readonly T[] {
  const version = useSurfaceAvailability()
  const { nodeType, field, data } = menu
  // `version` is the subscription: it changes when availability arrives or
  // an admin flips a switch, which is exactly when the list must be re-read.
  return useMemo(() => withoutDeniedModels(models, { nodeType, field, data }, keep), [models, nodeType, field, data, keep, version])
}
