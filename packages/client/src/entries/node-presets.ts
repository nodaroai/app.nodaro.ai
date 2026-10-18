/**
 * `@nodaro/sdk/node-presets` — the `node-presets` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { PresetsResource } from "../resources/node-presets.js"

export type {
  NodePreset,
  NodePresetGroup,
  FactoryPresetEntry,
  FactoryPresetsResult,
  CreateNodePresetInput,
  UpdateNodePresetInput,
  ImportNodePresetInput,
  ReorderNodePresetsInput,
  NodePresetFavoriteInput,
  CreateNodePresetGroupInput,
  UpdateNodePresetGroupInput,
} from "../resources/node-presets.js"
