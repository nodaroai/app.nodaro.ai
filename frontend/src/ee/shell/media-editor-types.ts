import type { ComponentType } from "react"

/**
 * The shared media editor's parts as this app uses them — a subset of the
 * package's own types, declared here so the app typechecks without the
 * package (it is installed on cloud images only). `contract/props.contract.ts`
 * holds this subset to the real types in an internal-only CI job, both ways
 * where a value crosses back (a player adapter, a range, a box).
 *
 * Grows with the wiring: only what the app passes or reads belongs here.
 */

/** A picture's or a video frame's size, in natural pixels. */
export type Size = {
  readonly width: number
  readonly height: number
}

/** A box in natural pixels. */
export type Rect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A crop ratio: the picture's own shape, a free box, or `"<w>:<h>"`. */
export type RatioId = "original" | "custom" | `${number}:${number}`

/** The part of a clip that is kept, in seconds. */
export type TrimRange = {
  readonly start: number
  readonly end: number
}

/**
 * What the trim strip drives: any player behind one small interface (a
 * `<video>`, or an embedded player the app adapts itself). Times in seconds;
 * `subscribe` is called on every change of play state, seek or length.
 */
export interface PlayerAdapter {
  duration(): number
  currentTime(): number
  seek(sec: number): void
  play(): void
  pause(): void
  isPlaying(): boolean
  subscribe(onChange: () => void): () => void
}

export interface TrimPanelProps {
  readonly player: PlayerAdapter
  readonly range: TrimRange
  readonly onRangeChange: (range: TrimRange) => void
  /** The shortest selection, in seconds; held while dragging. */
  readonly minSec?: number
  /** The longest selection, in seconds; held while dragging. */
  readonly maxSec?: number
  /** Play the selection over and over (the package's default: true). */
  readonly loop?: boolean
}

/** The crop's picture: an image, or the host's own playing `<video>` (the panel is then an overlay for its positioned parent). */
export type CropSource =
  | { readonly kind: "image"; readonly url: string }
  | { readonly kind: "video"; readonly element: HTMLVideoElement }

export interface CropPanelProps {
  readonly source: CropSource
  readonly natural: Size
  readonly ratio: RatioId
  readonly rect: Rect
  readonly onRectChange: (rect: Rect) => void
  readonly onRatioChange?: (id: RatioId) => void
}

export interface RatioPickerProps {
  readonly ratios?: readonly RatioId[]
  readonly value: RatioId
  readonly onChange: (id: RatioId) => void
  readonly wrap?: boolean
  readonly className?: string
  readonly disabled?: boolean
}

/** The parts, each present only where the build resolved the real editor. */
export interface MediaEditorParts {
  readonly TrimPanel: ComponentType<TrimPanelProps>
  readonly CropPanel: ComponentType<CropPanelProps>
  readonly RatioPicker: ComponentType<RatioPickerProps>
  readonly htmlMediaAdapter: (el: HTMLMediaElement) => PlayerAdapter
  readonly defaultRange: (duration: number, maxSec?: number) => TrimRange
  readonly clampRange: (next: TrimRange, duration: number, minSec?: number, maxSec?: number, moved?: "start" | "end" | "both") => TrimRange
  readonly formatTime: (sec: number) => string
  readonly fullRect: (natural: Size, ratio: RatioId) => Rect
  readonly isWholeFrame: (rect: Rect, natural: Size) => boolean
}
