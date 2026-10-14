/**
 * `@nodaro/shared/catalogs` — Parameter-node dimensions (animals, furniture, vehicles, weapons, character facets, seasons) and the parameter-node value gate.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/shared`.
 */
export {
  OBJECT_PICKER_NODE_TYPES,
} from "../object-picker-types.js"
export { SEASONS } from "../seasons.js"
export type { Season } from "../seasons.js"
export {
  LOCATION_PRESET_TO_CATALOG,
  LOCATION_BUCKET_TO_CATALOG_ID,
  resolveLocationPresetCatalog,
} from "../location-preset-catalog-map.js"
export type { LocationCatalogRef } from "../location-preset-catalog-map.js"
export {
  PARAMETER_NODE_TYPES,
  HINT_EXEMPT_PARAMETER_TYPES,
  VIDEO_ONLY_PARAMETER_NODE_TYPES,
  EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES,
  getParameterValue,
  setRegisteredPersonPackFields,
} from "../parameter-node-value.js"
// Parameter-node dimensions (frontend pickers + backend hints)

export {
  ANIMALS,
  ANIMAL_SUBCATEGORY_LABELS,
  ANIMAL_SUBCATEGORY_ORDER,
  getAnimal,
  getAnimalLabel,
  getAnimalPromptHint,
  getAnimalTerm,
} from "../animals.js"
export type { Animal, AnimalSubcategory } from "../animals.js"
export {
  FURNITURE,
  FURNITURE_SUBCATEGORY_LABELS,
  FURNITURE_SUBCATEGORY_ORDER,
  getFurniture,
  getFurnitureLabel,
} from "../furniture.js"
export type { Furniture, FurnitureSubcategory } from "../furniture.js"
export * from "../character-facets.js"
export {
  VEHICLES,
  VEHICLE_SUBCATEGORY_LABELS,
  VEHICLE_SUBCATEGORY_ORDER,
  getVehicle,
  getVehicleLabel,
} from "../vehicles.js"
export type { Vehicle, VehicleSubcategory } from "../vehicles.js"
export {
  WEAPONS,
  WEAPON_SUBCATEGORY_LABELS,
  WEAPON_SUBCATEGORY_ORDER,
  getWeapon,
  getWeaponLabel,
} from "../weapons.js"
export type { Weapon, WeaponSubcategory } from "../weapons.js"
// Multi-pick utilities
export { pickIds, togglePick } from "../multi-pick.js"
