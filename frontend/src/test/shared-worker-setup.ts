// Setup for the shared-worker project only (src/test/test-projects.ts), run
// after setup.ts for every file, before the test file itself is imported.
//
// A shared worker keeps the previous file's global state: Vitest 4 only calls
// vi.resetConfig() and vi.restoreAllMocks() between files. So this file does
// three things isolation did for free:
//  1. resets the surfaces a file commonly leaves behind and that can be reset
//     generically (storage contents, the DOM, timers and the mocked clock);
//  2. re-registers what libraries register once per module evaluation, i.e.
//     once per worker here (Testing Library's cleanup and act environment);
//  3. fails the file that leaves behind what cannot be reset generically — a
//     global added or replaced, an env var, the locale, a moved clock, DOM
//     left in the body — so a polluter is caught by the file that pollutes,
//     not by whichever file happens to run after it.
// Measured 2026-10-14: seedance-reference-tip's second test found its first
// test's render still mounted ("Found multiple elements") without (2), and
// five listed-then-dropped files left a locale, an <html lang>, a <head>
// element or an IntersectionObserver global behind for the next file.
import { afterAll, afterEach, beforeAll, vi } from "vitest"
import { domTrapsInstalled } from "./node-env-dom-trap"

const inJsdom = !domTrapsInstalled()

// 1. Reset. Fake timers and vi.setSystemTime are undone by useRealTimers.
vi.useRealTimers()
if (inJsdom) {
  globalThis.localStorage.clear()
  globalThis.sessionStorage.clear()
  const { documentElement, head, body } = globalThis.document
  head.replaceChildren()
  body.replaceChildren()
  for (const element of [documentElement, body]) {
    for (const { name } of [...element.attributes]) element.removeAttribute(name)
  }
}

// Bundler/runtime helpers (tslib's __assign, zod's __zod_globalConfig, Vitest's
// own __vitest_* state) appear on the global the first time a module needs
// them — in whichever file first imports it. Not state a test leaves behind.
const isRuntimeHelper = (key: string) => key.startsWith("__")
const ACT_ENVIRONMENT = "IS_REACT_ACT_ENVIRONMENT"
const CLOCK_TOLERANCE_MS = 1_000

type LocaleState = () => string
const localeOf: LocaleState | undefined = inJsdom
  ? await import("@/lib/locale-store").then(({ useLocaleStore }) => () => useLocaleStore.getState().locale)
  : undefined

interface Fingerprint {
  globals: Map<string, unknown>
  env: Map<string, string | undefined>
  locale: string | undefined
}

function fingerprint(): Fingerprint {
  const globals = new Map<string, unknown>()
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (isRuntimeHelper(key) || key === ACT_ENVIRONMENT) continue
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    globals.set(key, descriptor?.get ?? descriptor?.value)
  }
  return { globals, env: new Map(Object.entries(process.env)), locale: localeOf?.() }
}

/**
 * What this file left behind that the next file in the worker would see.
 * `imported` is the state once the file's imports ran: a global a module
 * creates on first import (`globalThis.dataLayer ||= []`) appears in whichever
 * file first imports it — in a fresh worker every file — so a global ADDED
 * during import and untouched since is tolerated. One REPLACED at import (a
 * file redefining localStorage at its top level) is not, nor anything added
 * or replaced while the tests ran.
 */
function leaks(before: Fingerprint, imported: Fingerprint): string[] {
  const after = fingerprint()
  const found: string[] = []
  for (const [key, value] of after.globals) {
    if (!before.globals.has(key)) {
      const addedAtImport = imported.globals.has(key) && Object.is(imported.globals.get(key), value)
      if (!addedAtImport) found.push(`added the global \`${key}\``)
    } else if (!Object.is(before.globals.get(key), value)) found.push(`replaced the global \`${key}\``)
  }
  for (const key of before.globals.keys()) if (!after.globals.has(key)) found.push(`deleted the global \`${key}\``)
  for (const [key, value] of after.env) {
    if (before.env.get(key) !== value) found.push(`${before.env.has(key) ? "changed" : "set"} process.env.${key}`)
  }
  for (const key of before.env.keys()) if (!after.env.has(key)) found.push(`deleted process.env.${key}`)
  if (after.locale !== before.locale) found.push(`left the locale on "${after.locale}" (was "${before.locale}")`)
  if (vi.isFakeTimers()) found.push("left fake timers installed")
  const drift = Date.now() - (performance.timeOrigin + performance.now())
  if (Math.abs(drift) > CLOCK_TOLERANCE_MS) found.push(`left Date ${Math.round(drift / 1000)} s away from the real clock`)
  if (inJsdom && globalThis.document.body.childElementCount > 0) {
    found.push(`left ${globalThis.document.body.childElementCount} element(s) in <body> after cleanup`)
  }
  return found
}

// 3. Registered first, so it runs last: after the file's own afterAll hooks
// and after the restores below.
const before = fingerprint()
// beforeAll runs after the file's imports: the state they left.
let imported = before
beforeAll(() => {
  imported = fingerprint()
})
afterAll(() => {
  // Vitest restores vi.spyOn spies right after this hook, between files; do it
  // now so a spied global (vi.spyOn(globalThis, "fetch")) is not read as replaced.
  vi.restoreAllMocks()
  const found = leaks(before, imported)
  if (found.length > 0) {
    throw new Error(
      `This file runs in a shared worker (src/test/no-isolate-files.json) and ${found.join("; ")}. ` +
        "The next file in the worker would inherit it: restore it in afterAll/afterEach, or take the file out of the manifest.",
    )
  }
})

// 2. Once per file, as each library does once per isolated file.
if (inJsdom) {
  const { cleanup } = await import("@testing-library/react")
  afterEach(cleanup)

  const g = globalThis as Record<string, unknown>
  const hadAct = Object.prototype.hasOwnProperty.call(g, ACT_ENVIRONMENT)
  const previousAct = g[ACT_ENVIRONMENT]
  beforeAll(() => {
    g[ACT_ENVIRONMENT] = true
  })
  afterAll(() => {
    if (hadAct) g[ACT_ENVIRONMENT] = previousAct
    else delete g[ACT_ENVIRONMENT]
  })
}
