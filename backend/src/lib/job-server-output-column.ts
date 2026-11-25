/**
 * THE one place `server_output` (migration 695) is read (decided 2026-11-22):
 * `run` is the caller's query with the column list it is handed, `<base>,
 * server_output`. `server-output-reads.test.ts` fails any other string that
 * names the column. Nothing in this code writes it: every change to it is one
 * of the SQL functions of migrations 695 and 710 (decided 2026-11-25), and an
 * expunge leaves it as it is: `stored` entries a claim did not take,
 * `discarding` markers, the unpruned/pruned marks, a set clean-up's claim
 * mark and `rawExtensionUrl` — bookkeeping, never the runner's content. This code ships only once the
 * migration is live (decided 2026-11-24), so the column is always there.
 */
const COLUMN = "server_output"

export async function withServerOutput<R>(
  base: string,
  /** `columns` is the whole list; `suffix` is what this module adds to `base` (`", server_output"`), for a caller that spells its own list out. */
  run: (columns: string, suffix: string) => PromiseLike<R>,
): Promise<R> {
  const suffix = `, ${COLUMN}`
  return run(`${base}${suffix}`, suffix)
}

