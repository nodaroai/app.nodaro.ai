import type { ResultKey } from "@nodaro/shared"

/** The two fields any result carries that could identify it. */
interface KeyableResult {
  readonly url: string
  readonly jobId?: string
}

/**
 * How a result is ADDRESSED — its job id when it has one, its url otherwise.
 *
 * Never a position. Two writers hold the same production open by design (the
 * editor and an agent), so an index is stale the moment either inserts a
 * result, and an operation that named one would land on the wrong image. The
 * job id is the natural identity; uploads and hand-attached frames have no job
 * row, which is why the url is the fallback rather than the key.
 */
export function resultKey(result: KeyableResult): ResultKey {
  return result.jobId ?? result.url
}

/**
 * Find the result a key names, or `undefined`.
 *
 * A duplicate key inside one shot resolves to the FIRST match, deliberately and
 * documented: it can only happen when the same job's output was appended twice,
 * the two entries are the same image, and picking the first makes the answer
 * stable across calls rather than dependent on insertion order.
 */
export function findResult<T extends KeyableResult>(
  results: ReadonlyArray<T>,
  key: ResultKey,
): T | undefined {
  return results.find((r) => resultKey(r) === key)
}
