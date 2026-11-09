/**
 * Whether this process has a content guard (lib/content-guard.ts). Asked by
 * dynamic import of a module this file does not depend on at build time, so a
 * deployment without the guard module reads as "no guard": loosening a provider
 * filter stays locked. Never throws.
 */
const CONTENT_GUARD_MODULE = "./content-guard.js"

export async function contentGuardRegistered(): Promise<boolean> {
  try {
    const mod = (await import(/* @vite-ignore */ CONTENT_GUARD_MODULE)) as { hasContentGuard?: () => boolean }
    return typeof mod.hasContentGuard === "function" && mod.hasContentGuard()
  } catch {
    return false
  }
}
