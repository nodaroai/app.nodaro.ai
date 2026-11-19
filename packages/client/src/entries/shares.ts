/**
 * `@nodaro/sdk/shares` — the `shares` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { SharesResource } from "../resources/shares.js"

export type {
  ShareKind,
  Share,
  GetShareParams,
  SetShareInput,
  SharedSettingValue,
  SharedReference,
  SharedJob,
  SharedSession,
  SharedProject,
  PublicShare,
  PublicShareItemsParams,
  PublicShareItemsPage,
} from "../resources/shares.js"
