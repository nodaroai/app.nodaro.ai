/**
 * The `{image:N}` / `{image:N:label}` reference-token grammar — one pattern for
 * the image prompt assembly (`prompt-builder.ts`) and for the preset metadata
 * that reads which references a template names (`factory-presets/references.ts`).
 *
 * Group 1 = position (1-based), group 2 = optional label. The label allows
 * spaces (multi-word labels like "clothes and shoes") but never a newline or
 * `}`, so a match can't run away across lines or token boundaries.
 *
 * Global on purpose (callers use `.replace` / `.matchAll`, which never leave a
 * `lastIndex` behind); never call `.test` / `.exec` on it.
 */
export const IMAGE_TOKEN_PATTERN = /\{image:(\d+)(?::([^}\n]+))?\}/gi
