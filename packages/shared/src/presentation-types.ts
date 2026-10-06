export interface ExposableField {
  readonly key: string
  readonly label: string
  readonly type: "select" | "slider" | "toggle" | "text" | "aspect-ratio" | "color"
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
  | {
      type: "node"
      nodeId: string
      /**
       * For a node exposed whole whose input is text (a Text node): the most
       * characters the app user may enter — the same limit a `field` item carries
       * (a whole number, at least 1; ignored on a node that is not a text input).
       * Enforced when the app runs, and it caps the price a speech node fed by
       * this input is advertised at.
       */
      maxLength?: number
    }
  | {
      type: "field"
      id: string
      nodeId: string
      field: string
      allowedValues?: Array<string | number | boolean>
      /**
       * For a text input: the most characters the app user may enter (a whole
       * number, at least 1). Enforced when the app runs, and it caps the price a
       * speech node fed by this input is advertised at — without it, an exposed
       * speech text is priced at the model's per-request cap.
       */
      maxLength?: number
    }
  | { type: "output"; id: string; nodeId: string; outputKey: string }
  | { type: "richtext"; id: string; content: string }
  | { type: "group"; id: string; title: string; items: PresentationItem[]; showTitle?: boolean; showBackground?: boolean }
