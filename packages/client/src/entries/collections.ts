/**
 * `@nodaro/sdk/collections` — the `collections` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export type {
  // Collections (`client.collections`): where a workflow's records live.
  Collection,
  CollectionRecord,
  CollectionMedia,
  CollectionMediaType,
  CollectionRecordSource,
  CollectionFieldValue,
  CollectionCaps,
  CollectionLimits,
  ListCollectionsResult,
  CreateCollectionInput,
  UpdateCollectionInput,
  ListCollectionRecordsParams,
  ListCollectionRecordsResult,
  AddCollectionRecordInput,
  AddCollectionRecordResult,
  CollectionWriteOutcome,
  CollectionExportFormat,
  CollectionDigestFormat,
} from "@nodaro/shared/nodes"

export { CollectionsResource } from "../resources/collections.js"
