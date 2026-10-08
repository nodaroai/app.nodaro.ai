/**
 * The most bytes the relay re-hosts per media file (matched to nodaro.ai's
 * upload route cap). A dependency-free leaf, so the size refusal that reads it
 * before anything is relayed (`lib/rehost-size-check.ts`) and the re-host
 * itself (`client.ts`) share one number.
 */
export const MAX_REHOST_BYTES = 500 * 1_000_000
