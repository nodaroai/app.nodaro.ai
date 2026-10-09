import type { NodaroClient } from "../client.js"
import type {
  AddCollectionRecordInput,
  AddCollectionRecordResult,
  BulkCollectionRecordsInput,
  BulkCollectionRecordsResult,
  Collection,
  CollectionExportFormat,
  CollectionRecord,
  CollectionRecordSource,
  CollectionUsage,
  CreateCollectionInput,
  ListCollectionRecordsParams,
  ListCollectionRecordsResult,
  ListCollectionsResult,
  UpdateCollectionInput,
} from "@nodaro/shared"

/**
 * Collections — where a workflow's records live.
 *
 * A collection is a named set of records (a title, a text, a link, media
 * links, extra fields) that the Save to Collection node writes one record per
 * item into and the Read Collection node reads back; this resource browses,
 * searches, adds, removes and exports them from code. Text and links only,
 * never files. The same link saved twice is one record. Past the plan's cap the
 * oldest records are evicted after a write (the answer says how many).
 * OAuth app tokens need `assets:read` for reads and `assets:write` for writes.
 */
export class CollectionsResource {
  constructor(private client: NodaroClient) {}

  /** `GET /v1/collections` → your collections with their record counts, whether the server has collections at all, and your caps. */
  list(): Promise<ListCollectionsResult> {
    return this.client.request<ListCollectionsResult>("GET", "/v1/collections")
  }

  /** `GET /v1/collections/:id` → one collection. */
  get(id: string): Promise<Collection> {
    return this.client.request<Collection>("GET", `/v1/collections/${encodeURIComponent(id)}`)
  }

  /** `POST /v1/collections` → a new collection (`409 name_taken` when you have one by that name, `403 collection_limit_reached` at your cap). */
  create(input: CreateCollectionInput): Promise<Collection> {
    return this.client.request<Collection>("POST", "/v1/collections", { body: input })
  }

  /** `PATCH /v1/collections/:id` → rename or re-describe a collection. */
  update(id: string, input: UpdateCollectionInput): Promise<Collection> {
    return this.client.request<Collection>("PATCH", `/v1/collections/${encodeURIComponent(id)}`, { body: input })
  }

  /** `DELETE /v1/collections/:id` → remove a collection and every record in it. */
  async delete(id: string): Promise<void> {
    await this.client.request<{ success: true }>("DELETE", `/v1/collections/${encodeURIComponent(id)}`)
  }

  /**
   * `GET /v1/collections/:id/records` → the records, newest first (`order: "oldest"`
   * flips it). Narrow with `q` (words), `since` / `until` (ISO) and `usage`
   * (`all`, `unused` — not used yet — or `used`); page with `cursor` / `limit`
   * (1-100, default 50). Each record carries `usedAt` / `usedBy`, and its
   * `source` the saving workflow's name and project when it is yours.
   */
  records(id: string, params: ListCollectionRecordsParams = {}): Promise<ListCollectionRecordsResult> {
    return this.client.request<ListCollectionRecordsResult>("GET", `/v1/collections/${encodeURIComponent(id)}/records`, {
      query: {
        q: params.q,
        since: params.since,
        until: params.until,
        usage: params.usage,
        status: params.status,
        order: params.order,
        cursor: params.cursor,
        offset: params.offset,
        limit: params.limit,
      },
    })
  }

  /** `POST /v1/collections/:id/records/:recordId/restore` → bring a record back from the Trash; the record. */
  restoreRecord(id: string, recordId: string): Promise<CollectionRecord> {
    return this.client.request<CollectionRecord>("POST", `/v1/collections/${encodeURIComponent(id)}/records/${encodeURIComponent(recordId)}/restore`)
  }

  /** `POST /v1/collections/:id/records/bulk` → move up to 100 records to the Trash, bring them back, or delete records already in the Trash for good, in one call. */
  bulkRecords(id: string, input: BulkCollectionRecordsInput): Promise<BulkCollectionRecordsResult> {
    return this.client.request<BulkCollectionRecordsResult>("POST", `/v1/collections/${encodeURIComponent(id)}/records/bulk`, { body: input })
  }

  /**
   * `PATCH /v1/collections/:id/records/:recordId` → mark a record used (or not
   * used again). `source` says who is marking it (defaults to the API). A
   * server before the usage release answers `503 not_available`.
   */
  setUsed(id: string, recordId: string, used: boolean, source?: CollectionRecordSource): Promise<CollectionRecord> {
    return this.client.request<CollectionRecord>("PATCH", `/v1/collections/${encodeURIComponent(id)}/records/${encodeURIComponent(recordId)}`, {
      body: { used, ...(source ? { source } : {}) },
    })
  }

  /**
   * `POST /v1/collections/:id/records` → save one record. Give the fields, or
   * `item` (any JSON — a feed post, a search result) and let the server map it;
   * explicit fields win. `outcome` is `inserted`, `duplicate` (the same link or
   * dedupe key is already there — the existing record comes back) or `replayed`
   * (a write with the same `idempotencyKey` already happened).
   */
  addRecord(id: string, input: AddCollectionRecordInput, opts: { idempotencyKey?: string } = {}): Promise<AddCollectionRecordResult> {
    return this.client.request<AddCollectionRecordResult>("POST", `/v1/collections/${encodeURIComponent(id)}/records`, {
      body: input,
      ...(opts.idempotencyKey ? { headers: { "Idempotency-Key": opts.idempotencyKey } } : {}),
    })
  }

  /**
   * `DELETE /v1/collections/:id/records/:recordId` → the record moves to the
   * collection's Trash (`restoreRecord` brings it back; `deleteRecordForever`
   * removes it for good).
   */
  async deleteRecord(id: string, recordId: string): Promise<void> {
    await this.client.request<{ success: true }>("DELETE", `/v1/collections/${encodeURIComponent(id)}/records/${encodeURIComponent(recordId)}`)
  }

  /** `DELETE /v1/collections/:id/records/:recordId/permanent` → a record already in the Trash is deleted for good (`409 not_in_trash` for a live one). */
  async deleteRecordForever(id: string, recordId: string): Promise<void> {
    await this.client.request<{ success: true }>("DELETE", `/v1/collections/${encodeURIComponent(id)}/records/${encodeURIComponent(recordId)}/permanent`)
  }

  /** `GET /v1/collections/:id/export` → the whole collection as CSV (default) or JSON text, newest first; `since`, `until`, `usage` and `q` narrow it. */
  export(id: string, params: { format?: CollectionExportFormat; since?: string; until?: string; usage?: CollectionUsage; q?: string } = {}): Promise<string> {
    return this.client.requestText("GET", `/v1/collections/${encodeURIComponent(id)}/export`, {
      query: { format: params.format, since: params.since, until: params.until, usage: params.usage, q: params.q },
    })
  }
}
