import "@testing-library/jest-dom/vitest"

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
