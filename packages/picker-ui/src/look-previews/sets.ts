// The rendered look previews live in @nodaro/prompts (picker-art/), the single
// source the editor registers (Cloud only, frontend/src/lib/look-previews-bootstrap.ts)
// and the API serves as picture URLs (Cloud only). Re-exported here so every
// existing import of the package keeps working. SOUND_RENDER_SETS (the music /
// voice pickers' pictures) rides the same registry, under its catalog ids.
export { LOOK_PREVIEW_SETS, SOUND_RENDER_SETS } from "@nodaro/prompts/picker-art"
