/**
 * The cache keys the shared header reads in the app's OWN QueryClient (the
 * header is handed the app's client). Exact keys: an app query under one of
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
