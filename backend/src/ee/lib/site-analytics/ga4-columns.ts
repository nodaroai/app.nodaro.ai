/** A GA4 Data API answer, read by the names in its headers — never by the order the columns were asked for. */

export const GA_DATA_API = "https://analyticsdata.googleapis.com/v1beta"

export interface GaRow {
  dimensionValues?: Array<{ value?: string }>
  metricValues?: Array<{ value?: string }>
}

export interface GaAnswer {
  dimensionHeaders?: Array<{ name?: string }>
  metricHeaders?: Array<{ name?: string }>
  rows?: GaRow[]
  rowCount?: number
  metadata?: { timeZone?: string }
  propertyQuota?: { tokensPerDay?: QuotaBucket; tokensPerHour?: QuotaBucket; tokensPerProjectPerHour?: QuotaBucket }
}

/** One of Google's quota buckets. A zero is omitted from its JSON, so a bucket without `remaining` has none left. */
export interface QuotaBucket {
  consumed?: number
  remaining?: number
}

export interface Columns {
  readonly rows: readonly GaRow[]
  /** How many rows GA has in all — more than `rows` when it sent only the top ones. */
  readonly rowCount: number
  metric(row: GaRow | undefined, name: string): number
  dimension(row: GaRow | undefined, name: string): string
}

export function columns(answer: GaAnswer | undefined): Columns {
  const metricAt = new Map((answer?.metricHeaders ?? []).map((header, i) => [header.name ?? "", i]))
  const dimensionAt = new Map((answer?.dimensionHeaders ?? []).map((header, i) => [header.name ?? "", i]))
  return {
    rows: answer?.rows ?? [],
    rowCount: Number(answer?.rowCount) || 0,
    metric(row, name) {
      const i = metricAt.get(name)
      return i === undefined || !row ? 0 : Number(row.metricValues?.[i]?.value) || 0
    },
    dimension(row, name) {
      const i = dimensionAt.get(name)
      return i === undefined || !row ? "" : (row.dimensionValues?.[i]?.value ?? "")
    },
  }
}
