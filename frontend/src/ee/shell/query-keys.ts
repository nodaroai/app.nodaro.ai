/**
 * The cache keys the white-label header (the npm package; the hosted header
 * keeps its own cache) reads in the app's OWN QueryClient: it is handed the
 * app's client. Exact keys: an app query under one of
 * them would share — and fight over — the header's entry, which is why
 * `__tests__/header-query-keys.test.ts` fails any app query that uses one.
 * `contract/` holds each to the package's exported key.
 */
export const HEADER_QUERY_KEYS = Object.freeze({
  credits: ["credits"],
  me: ["me"],
  plans: ["billing-plans"],
  connectedApps: ["connected-apps"],
} as const)
