/**
 * `@nodaro/sdk/oauth` — the `oauth` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { OAuthResource } from "../resources/oauth.js"

export type {
  ExchangeCodeInput,
  AccessTokenResponse,
  OAuthAppInfo,
} from "../resources/oauth.js"
