/**
 * `@nodaro/shared/runtime-config` — The deployment runtime config contract: `/config.js`'s keys and their shapes, a lenient parser, and the worlds a deployment can offer.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/shared`.
 */
export {
  WORLD_IDS,
  WORLD_REQUIRED_NODE_TYPES,
  isWorldId,
  worldAllowed,
  orderWorlds,
  type WorldId,
  type SurfaceWorlds,
} from "../runtime-config/worlds.js"
export {
  RUNTIME_CONFIG_GLOBAL,
  RUNTIME_CONFIG_KEYS,
  SURFACE_HEADER_MODES,
  SURFACE_CATALOG_IMAGES,
  RUNTIME_SURFACE_DEFAULT,
  UI_STRING_PRODUCTS,
  isSsoOnly,
  surfaceRequiresSignIn,
  isBrandLogoRef,
  isSameSitePath,
  isHttpsOrigin,
  resolveRuntimeApiBase,
  resolveRuntimeSupabaseUrl,
  parseRuntimeSurface,
  parseRuntimeStrings,
  parseRuntimeConfig,
  readRuntimeConfig,
  surfaceStringOverride,
  surfaceUnitLabel,
  uiStringManifestFile,
  uiStringPlaceholders,
  buildUiStringManifest,
  type UiStringManifest,
  type RuntimeConfigKey,
  type SurfaceHeaderMode,
  type SurfaceCatalogImages,
  type RuntimeSurfaceSibling,
  type RuntimeSurfaceBrand,
  type RuntimeSurfaceBilling,
  type RuntimeSurfaceStrings,
  type RuntimeSurface,
  type UiStringProduct,
  type NodaroRuntimeConfig,
} from "../runtime-config/contract.js"
