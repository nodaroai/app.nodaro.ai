// The deployment's own wording for this app's UI strings: `strings.flow` in
// the surface profile, carried by /config.js. The backend has already checked
// every entry against the dictionary (the key exists, the locale is offered,
// the text is plain and keeps its {placeholders}); this module only looks
// them up.
//
// /config.js is a classic script that runs before the app's module entry, so
// the overrides are in place before the first string renders. Each lookup
// reads `window.__NODARO_RUNTIME__` afresh and re-parses only when that object
// changes, so a deployment that sets none pays one property read per string.
//
// Imports no dictionary on purpose: `localeText` in ./index.ts lays these
// over the dictionaries, and that module is the one place dictionaries are
// read for every component (see tools/test-select/i18n-keys.mjs).
import {
  parseRuntimeStrings,
  surfaceStringOverride,
  type RuntimeSurfaceStrings,
  type UiStringProduct,
} from "@nodaro/shared/runtime-config"

/** This app's namespace in `surface.strings`. */
export const FLOW_STRINGS_PRODUCT: UiStringProduct = "flow"

const NONE: RuntimeSurfaceStrings = Object.freeze({})

let source: unknown
let parsed: RuntimeSurfaceStrings = NONE

function deploymentStrings(): RuntimeSurfaceStrings {
  const raw = typeof window === "undefined" ? undefined : window.__NODARO_RUNTIME__?.surface?.strings
  if (raw !== source) {
    source = raw
    parsed = raw === undefined ? NONE : parseRuntimeStrings(raw)
  }
  return parsed
}

/** The deployment's text for `key` in `locale`, or undefined when it set none. */
export function stringOverride(locale: string, key: string): string | undefined {
  return surfaceStringOverride(deploymentStrings(), FLOW_STRINGS_PRODUCT, locale, key)
}
