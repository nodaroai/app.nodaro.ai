import { describe, it, expect } from "vitest"
import { installFolderForClipboard, browserBlockedFolderReason } from "@/lib/install-folder-path"

// The browser's directory picker cannot be told to open at an arbitrary
// path (only well-known folders or a previously granted handle), so the
// install path is put on the clipboard for the user to paste into the
// picker's Folder box. Compose reports the path in the shell's own form —
// Git Bash / WSL give `C:/Users/...` — which the Windows picker box will not
// navigate to reliably; hand it back in the form the OS expects.
describe("installFolderForClipboard", () => {
  it("turns a forward-slash Windows drive path into backslashes", () => {
    expect(installFolderForClipboard("C:/Users/pc1/nodaro")).toBe("C:\\Users\\pc1\\nodaro")
    expect(installFolderForClipboard("d:/x/y")).toBe("d:\\x\\y")
  })

  it("leaves POSIX paths alone", () => {
    expect(installFolderForClipboard("/home/asaf/nodaro")).toBe("/home/asaf/nodaro")
    expect(installFolderForClipboard("/Users/asaf/nodaro")).toBe("/Users/asaf/nodaro")
  })

  it("maps a Git-Bash /c/... path to the drive form Explorer understands", () => {
    expect(installFolderForClipboard("/c/projects/nodaro")).toBe("C:\\projects\\nodaro")
  })

  it("trims and returns null for an empty value", () => {
    expect(installFolderForClipboard("  C:/x  ")).toBe("C:\\x")
    expect(installFolderForClipboard("")).toBeNull()
    expect(installFolderForClipboard(undefined)).toBeNull()
  })
})

// Chromium refuses File System Access grants inside "sensitive" locations
// (its kBlockedPaths): AppData / Library, Program Files, the Windows dir,
// ~/.ssh, system roots. An install that lives there — e.g. one unpacked
// under %TEMP% — hits "can't open this folder, it contains system files"
// AFTER navigating to it (2026-08-16). Detect it up front and steer to COPY.
describe("browserBlockedFolderReason", () => {
  it("flags the locations Chromium blocks, in either slash form", () => {
    expect(browserBlockedFolderReason("C:/Users/pc1/AppData/Local/Temp/nodaro")).toMatch(/AppData/)
    expect(browserBlockedFolderReason("C:\\Users\\pc1\\AppData\\Roaming\\x")).toMatch(/AppData/)
    expect(browserBlockedFolderReason("C:/Program Files/Nodaro")).toMatch(/Program Files/)
    expect(browserBlockedFolderReason("C:/Program Files (x86)/Nodaro")).toMatch(/Program Files/)
    expect(browserBlockedFolderReason("C:/Windows/Temp/nodaro")).toMatch(/Windows/)
    expect(browserBlockedFolderReason("/Users/asaf/Library/Application Support/nodaro")).toMatch(/Library/)
    expect(browserBlockedFolderReason("/home/asaf/.ssh/nodaro")).toMatch(/\.ssh/)
    expect(browserBlockedFolderReason("/etc/nodaro")).toMatch(/system/i)
    expect(browserBlockedFolderReason("/usr/local/nodaro")).toMatch(/system/i)
  })

  it("does not flag ordinary install locations", () => {
    for (const p of [
      "C:/projects/nodaro",
      "C:/Users/pc1/nodaro",
      "C:/Users/pc1/Documents/nodaro",
      "/home/asaf/nodaro",
      "/Users/asaf/nodaro",
      "/opt/nodaro",
      "/srv/nodaro",
    ]) {
      expect(browserBlockedFolderReason(p)).toBeNull()
    }
  })

  it("is null for unknown/empty input", () => {
    expect(browserBlockedFolderReason("")).toBeNull()
    expect(browserBlockedFolderReason(undefined)).toBeNull()
  })
})
