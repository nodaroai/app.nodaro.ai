import "@testing-library/jest-dom/vitest"

// Polyfill localStorage for the test environment. On newer Node (v26) jsdom no
// longer exposes a usable `localStorage` global, so tests that touch it see
// `undefined`. Install a simple in-memory implementation when one is missing or
// non-functional. (node-defaults.test.ts stubs this locally for the same reason.)
function hasWorkingLocalStorage(): boolean {
  try {
    const ls = globalThis.localStorage
    if (!ls || typeof ls.setItem !== "function") return false
    ls.setItem("__probe__", "1")
    ls.removeItem("__probe__")
    return true
  } catch {
    return false
  }
}
if (!hasWorkingLocalStorage()) {
  const store: Record<string, string> = {}
  const localStorageMock: Storage = {
    get length() {
      return Object.keys(store).length
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value)
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k]
    },
  }
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    writable: true,
    configurable: true,
  })
}

// Polyfill ResizeObserver for test environment
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver
}

// Polyfill ImageData for test environment (jsdom does not implement it)
if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData {
    readonly data: Uint8ClampedArray
    readonly width: number
    readonly height: number
    readonly colorSpace: PredefinedColorSpace = "srgb"
    constructor(widthOrData: number | Uint8ClampedArray, heightOrWidth: number, height?: number) {
      if (typeof widthOrData === "number") {
        this.width = widthOrData
        this.height = heightOrWidth
        this.data = new Uint8ClampedArray(this.width * this.height * 4)
      } else {
        this.data = widthOrData
        this.width = heightOrWidth
        this.height = height ?? widthOrData.length / 4 / heightOrWidth
      }
    }
  } as unknown as typeof globalThis.ImageData
}
