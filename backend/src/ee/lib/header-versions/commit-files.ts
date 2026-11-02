import type { GitHubReader } from "./github.js"
import { HEADER_REPO } from "./products.js"
import { packageNameOf } from "./read-version.js"

/** A file at a commit never changes; this bounds how many are kept. */
const FILES_KEPT = 200

/** Files read at a commit, each read once: a commit never changes. */
export interface CommitFiles {
  /** The file's text at `ref`, or `null` when the commit has no such file. */
  at(repo: string, path: string, ref: string): Promise<string | null>
  /** The header's package name, as its own repository's package.json gives it (`null`: unreadable). */
  headerPackage(): Promise<string | null>
}

/**
 * Callers asking at once share one read; a failed read is never kept, so it
 * is asked again next time; the oldest goes when the store is full. The
 * header's package name is read at `HEAD` once: a package does not change its
 * name.
 */
export function createCommitFiles(github: GitHubReader): CommitFiles {
  const kept = new Map<string, Promise<string | null>>()

  function at(repo: string, path: string, ref: string): Promise<string | null> {
    const key = `${repo}@${ref}:${path}`
    const known = kept.get(key)
    if (known) return known
    const loading = github.fileAt(repo, path, ref)
    kept.set(key, loading)
    loading.catch(() => kept.delete(key))
    if (kept.size > FILES_KEPT) kept.delete(kept.keys().next().value as string)
    return loading
  }

  return {
    at,
    async headerPackage() {
      return packageNameOf((await at(HEADER_REPO, "package.json", "HEAD")) ?? "")
    },
  }
}
