/**
 * Picker art — the picture of every picker option that has one, and the round
 * icons of the Person / Styling topics. The single source for the editor
 * (picker-ui reads these maps) and the API (the catalog projections attach
 * absolute `imageUrl`s from them).
 */
export * from "./sound-art-types.js"
export { SOUND_ART } from "./sound-art-map.js"
export { SOUND_ART_FILES } from "./sound-art-files.generated.js"
export { CHARACTER_ART_FILES } from "./character-art-files.generated.js"
export { LOOK_PREVIEW_SETS, type LookPreviewSet, type LookPreviewSets } from "./look-preview-sets.js"
export * from "./paths.js"
export * from "./images.js"
