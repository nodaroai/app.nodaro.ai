import type { SupportedFontName } from "./supported-fonts.js"

export interface ShotTextElement {
  readonly id: string
  readonly type: "text"
  readonly text: string
  readonly fontFamily?: SupportedFontName
  readonly fontSize: number
  readonly fontWeight?: 300 | 400 | 700 | 900
  readonly color?: string
  readonly x: number
  readonly y: number
  readonly letterSpacing?: number
  readonly opacity?: number
  readonly dir?: "rtl" | "ltr"
}
export interface ShotShapeElement {
  readonly id: string
  readonly type: "shape"
  readonly shape: "rectangle" | "circle" | "line"
  readonly fill?: string
  readonly stroke?: string
  readonly strokeWidth?: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly cornerRadius?: number
  readonly opacity?: number
}
export interface ShotImageElement {
  readonly id: string
  readonly type: "image"
  readonly src: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly fit?: "contain" | "cover"
  readonly radius?: number
  readonly opacity?: number
}
export type ShotElement = ShotTextElement | ShotShapeElement | ShotImageElement
