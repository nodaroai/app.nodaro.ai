export interface ExposableField {
  readonly key: string
  readonly label: string
  readonly type: "select" | "slider" | "toggle" | "text"
  readonly options?: ReadonlyArray<{ value: string; label: string }>
  readonly min?: number
  readonly max?: number
  readonly step?: number
  readonly defaultValue?: unknown
}

export interface ExposableOutput {
  readonly key: string
  readonly label: string
  readonly outputType: "image" | "video" | "audio" | "text" | "data"
}

export type PresentationItem =
  | { type: "node"; nodeId: string }
  | { type: "field"; id: string; nodeId: string; field: string; allowedValues?: Array<string | number | boolean> }
  | { type: "output"; id: string; nodeId: string; outputKey: string }
  | { type: "richtext"; id: string; content: string }
  | { type: "group"; id: string; title: string; items: PresentationItem[] }
