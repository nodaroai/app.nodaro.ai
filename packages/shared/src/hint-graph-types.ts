/** Structural node/edge/graph shapes used by hint + aggregation helpers. */
export interface HintNodeLike {
  readonly id: string
  readonly type?: string
  readonly data?: unknown
}

export interface HintEdgeLike {
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

export interface HintGraphContext {
  readonly nodes: ReadonlyArray<HintNodeLike>
  readonly edges: ReadonlyArray<HintEdgeLike>
}
