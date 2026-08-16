/**
 * The install path as the OS's own file picker wants to see it.
 *
 * Compose passes `${PWD}` of the shell that ran it, so a Windows install
 * shows up as `C:/Users/...` (Git Bash) or `/c/Users/...` (Git Bash on some
 * setups) — Explorer's "Folder:" box does not navigate to those reliably.
 * The browser's directory picker cannot be told where to open (only
 * well-known folders or a previously granted handle), so the path goes to
 * the clipboard for the user to paste; this makes the pasted value land.
 */
export function installFolderForClipboard(raw: string | null | undefined): string | null {
  const path = (raw ?? "").trim()
  if (!path) return null
  // Git-Bash mount form: /c/Users/... -> C:\Users\...
  const mount = /^\/([a-zA-Z])\/(.*)$/.exec(path)
  if (mount) return `${mount[1].toUpperCase()}:\\${mount[2].replace(/\//g, "\\")}`
  // Drive path with forward slashes: C:/Users/... -> C:\Users\...
  if (/^[a-zA-Z]:\//.test(path)) return path.replace(/\//g, "\\")
  return path
}

/**
 * Why the browser would refuse to grant access to `raw`, or null if it
 * would not. Chromium's File System Access blocklist (kBlockedPaths) refuses
 * "sensitive" locations outright — the user navigates there and then gets
 * "can't open this folder, it contains system files". An install unpacked
 * under %TEMP% (inside AppData) hit exactly that (2026-08-16). Knowing up
 * front lets the setup screen steer to COPY .ENV TEMPLATE instead of
 * offering a picker that cannot succeed. Patterns cover the common blocked
 * roots on Windows, macOS and Linux; anything else is assumed fine.
 */
export function browserBlockedFolderReason(raw: string | null | undefined): string | null {
  const path = (raw ?? "").trim().replace(/\\/g, "/")
  if (!path) return null
  const rules: ReadonlyArray<{ test: RegExp; reason: string }> = [
    { test: /\/AppData(\/|$)/i, reason: "it is inside AppData (Windows keeps browsers out of it)" },
    { test: /\/Program Files( \(x86\))?(\/|$)/i, reason: "it is inside Program Files" },
    { test: /^[a-z]:\/Windows(\/|$)/i, reason: "it is inside the Windows folder" },
    { test: /^\/Users\/[^/]+\/Library(\/|$)/, reason: "it is inside ~/Library (macOS keeps browsers out of it)" },
    { test: /\/\.(ssh|gnupg)(\/|$)/, reason: "it is inside ~/.ssh or ~/.gnupg" },
    { test: /^\/(etc|usr|bin|sbin|boot|dev|proc|sys|System)(\/|$)/, reason: "it is a system folder" },
  ]
  const hit = rules.find((r) => r.test.test(path))
  return hit ? hit.reason : null
}
