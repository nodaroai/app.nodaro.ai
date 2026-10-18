/**
 * `@nodaro/sdk/palettes` — the `palettes` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { PalettesResource } from "../resources/palettes.js"

export type {
  ColorPalette,
  CreatePaletteInput,
  UpdatePaletteInput,
  ListPalettesParams,
  PalettePage,
} from "../resources/palettes.js"

export { PALETTE_DIRECTION_PREFIX, paletteDirectionId } from "../resources/palettes.js"
