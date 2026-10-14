// Node-environment test files (`// @vitest-environment node` on line 1) earned
// the opt-out by touching no DOM global. This keeps it that way loudly: in the
// node environment, reading one of these throws instead of quietly taking a
// module's non-browser path (`typeof window === "undefined"` included — a
// getter runs even under `typeof`). The test runner's own type probes
// (vitest, @vitest/*, chai's inspect: `val === window`, `typeof Node`, …) only
// matter for DOM values and keep seeing `undefined`. A test that assigns one of
// these globals itself gets back what it assigned.
// `navigator` is left alone: Node has it natively and zod reads it at import.
// Static twin: src/__tests__/node-environment-tests-are-dom-free.test.ts.
//
// Safe without isolation (`--no-isolate`, where every file in a worker shares
// one global): the traps are recorded on a registry keyed by a global symbol,
// installing is idempotent, and `removeDomTraps` puts back exactly what was
// there before — setup.ts calls it first (a trap a crashed file left behind
// must not trip the next file's setup) and again after every file.

const NODE_ENV_DOM_TRAPS = [
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "location",
  "self",
  "HTMLElement",
  "Element",
  "Node",
] as const

const TEST_RUNNER_FRAME = /[\\/]node_modules[\\/](?:vitest|@vitest[\\/][^\\/]+|chai)[\\/]/

/** What each trapped name held before the trap (undefined: it did not exist), and the trap's getter. */
type TrapRegistry = Map<string, { original: PropertyDescriptor | undefined; get: () => unknown }>

const REGISTRY = Symbol.for("nodaro.test.node-env-dom-trap")

function registry(): TrapRegistry | undefined {
  return (globalThis as Record<symbol, TrapRegistry | undefined>)[REGISTRY]
}

/**
 * The frame that read the global: [0] the message, [1] this function, [2] the
 * getter, [3] the reader. The limit is raised for the capture so a test that
 * lowered `Error.stackTraceLimit` cannot hide the reader (no frame = trapped).
 */
function readerFrame(): string {
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = Math.max(limit, 4)
  try {
    return new Error().stack?.split("\n")[3] ?? ""
  } finally {
    Error.stackTraceLimit = limit
  }
}

/** True while this file's DOM traps are installed — i.e. it runs in the node environment. */
export function domTrapsInstalled(): boolean {
  return registry() !== undefined
}

/** Puts every trapped global back as it was. Idempotent; a no-op when no trap is installed. */
export function removeDomTraps(): void {
  const traps = registry()
  if (!traps) return
  for (const [name, { original, get }] of traps) {
    // A test may have replaced the global itself (vi.stubGlobal redefines it); leave that alone.
    if (Object.getOwnPropertyDescriptor(globalThis, name)?.get !== get) continue
    if (original) Object.defineProperty(globalThis, name, original)
    else delete (globalThis as Record<string, unknown>)[name]
  }
  delete (globalThis as Record<symbol, unknown>)[REGISTRY]
}

/**
 * Traps the DOM globals when this file runs in the node environment. Call it
 * with every trap removed; the environment is read from the descriptor, so it
 * never reads a trapped global.
 */
export function installDomTrapsInNodeEnvironment(): void {
  if (registry()) return
  if (Object.getOwnPropertyDescriptor(globalThis, "document")) return // jsdom: it defines document

  const traps: TrapRegistry = new Map()
  for (const name of NODE_ENV_DOM_TRAPS) {
    let assigned = false
    let value: unknown
    const original = Object.getOwnPropertyDescriptor(globalThis, name)
    const get = () => {
      if (assigned) return value
      if (TEST_RUNNER_FRAME.test(readerFrame())) return undefined
      throw new ReferenceError(
        `${name} is a DOM global, and this file runs in the node environment (@vitest-environment node); remove the docblock if it needs the DOM`,
      )
    }
    Object.defineProperty(globalThis, name, {
      configurable: true,
      enumerable: false,
      get,
      set(next) {
        assigned = true
        value = next
      },
    })
    traps.set(name, { original, get })
  }
  ;(globalThis as Record<symbol, TrapRegistry>)[REGISTRY] = traps
}
