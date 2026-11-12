import type { FieldMappings, GeneratedResult } from "@/types/nodes"

/** A box on the base picture: its corners, x1/y1 the top left. */
export interface SplitLayerBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * One layer's data (the "Layer data" output, one entry per layer, in the
 * Layers output's order). A layer file is NOT in the base's pixels: it is cropped
 * to its element at about the size setting's pixel budget, at the element's own
 * shape — put it back in place by scaling it to its `box`.
 */
export interface SplitLayer {
  name?: string
  description?: string
  /** Stacking order: 1 sits on the base, higher is drawn above. */
  zIndex: number
  /** The layer file's own pixels. */
  width?: number
  height?: number
  /** Where it sits on the base picture, in the base's pixels. */
  box?: SplitLayerBox
  /** The same box on a 0–1000 scale of the base's width and height. */
  boxNormalized?: SplitLayerBox
  url: string
  /**
   * The base picture this layer was cut from, as its run stored it (that run's
   * Base). After a run once per picture, pair a layer with its base by this,
   * never by `row`: Base lists only the pictures that made a result.
   */
  baseUrl?: string
  /**
   * After a run once per picture, on the node's own Layer data only (each
   * take's carries none): the picture this layer came from, its 0-based place
   * among the pictures the node ran on (unit-batch-side-outputs.ts, `row`).
   */
  row?: number
}

/** Split into Layers: the node's data. Every field here is a node setting gen:skills documents. */
export type SplitIntoLayersData = {
  [key: string]: unknown
  label: string
  fieldMappings: FieldMappings
  /** The most layers a run makes, 1–99 (default 9); the base comes on top. More elements merge into fewer layers. */
  maxLayers?: number
  /** "1K" (default), "1.5K" or "2K" — a pixel budget per image — or "auto", the picture's own size (between 1K and 2K). */
  size?: "1K" | "1.5K" | "2K" | "auto"
  /** What to separate (optional, up to 2,000 characters; `<bbox>x1 y1 x2 y2</bbox>` marks on 0–1000). Empty: the main elements. */
  prompt?: string
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  currentJobProgress?: number
  currentJobId?: string
  /** Wired into the "image" input, or uploaded on the node. */
  imageUrl?: string
  /** The "base" output: the base picture (opaque). */
  generatedImageUrl?: string
  /** The "layers" output: each layer's file, bottom to top; null when the run made none. After a run once per picture, every picture's, picture by picture (each take holds its own). */
  generatedLayerUrls?: string[] | null
  /** The "layerData" output: one entry per layer, in the same order; null when the run made none. After a run once per picture, every picture's, each entry with its `row` (each take holds its own, without). */
  generatedLayerData?: SplitLayer[] | null
  /** How many layers the run made but could not store (each retried; one that still fails is dropped, and is not charged): 0 when every one was; null when the run reported none. Rides on each take too. After a run once per picture, the sum (each take its own). */
  layersNotSaved?: number | null
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}
