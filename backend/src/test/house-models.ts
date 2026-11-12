/**
 * A deployment that serves every house model the catalog has
 * (docs/design/house-models.md), for a test that really builds or runs one.
 * Without it the shipped catalog's house model is unserved, as on every
 * community and business install: it withholds only itself, so a test of the
 * stock deployment about any other model needs no plugin.
 */
import { setPluginServices } from "../lib/private-plugins/services-registry.js"
import { ownLabelModelIds } from "../lib/house-models-served.js"

/** Publishes a fake plugin service that serves every own-label model; nothing is ever run through it. */
export function serveEveryHouseModel(): void {
  setPluginServices({
    houseModels: {
      ids: () => [...ownLabelModelIds()],
      plan: () => ({ providerCostUsd: 0 }),
      start: async () => ({ taskRef: "never" }),
      poll: async () => ({ state: "running" }),
    },
  })
}

/** Undoes {@link serveEveryHouseModel}: no plugin service published. */
export function serveNoHouseModel(): void {
  setPluginServices({})
}
