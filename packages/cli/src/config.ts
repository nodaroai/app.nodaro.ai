import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// ~/.config/nodaro/config.json — XDG-spec compliant location.
// Token is stored here; we chmod 0600 so other users on the box can't read it.
// The path is computed on each call so tests can override NODARO_CONFIG_DIR
// after the module is loaded.

function configDir(): string {
  return process.env.NODARO_CONFIG_DIR ?? join(homedir(), ".config", "nodaro")
}

export function configPath(): string {
  return join(configDir(), "config.json")
}

export interface Profile {
  baseUrl: string
  token: string
}

export interface Config {
  default: string
  profiles: Record<string, Profile>
}

// Always return a fresh object so callers can safely mutate it without
// leaking state across calls. (An earlier version with a module-scope
// EMPTY constant + shallow spread caused setProfile to mutate the shared
// reference, surfacing as cross-test contamination in unit tests.)
function emptyConfig(): Config {
  return { default: "production", profiles: {} }
}

export function loadConfig(): Config {
  const file = configPath()
  if (!existsSync(file)) return emptyConfig()
  try {
    const raw = readFileSync(file, "utf8")
    const parsed = JSON.parse(raw) as Partial<Config>
    return {
      default: parsed.default ?? "production",
      profiles: parsed.profiles ?? {},
    }
  } catch {
    // Corrupt or unreadable — return empty rather than crashing the CLI.
    return emptyConfig()
  }
}

export function saveConfig(config: Config): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 })
  const file = configPath()
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 })
  // Re-chmod in case the file already existed with looser permissions.
  chmodSync(file, 0o600)
}

export function getProfile(name?: string): { name: string; profile: Profile | undefined } {
  const config = loadConfig()
  const resolved = name ?? config.default
  return { name: resolved, profile: config.profiles[resolved] }
}

export function setProfile(name: string, profile: Profile): void {
  const config = loadConfig()
  config.profiles[name] = profile
  if (Object.keys(config.profiles).length === 1) {
    config.default = name
  }
  saveConfig(config)
}

export function deleteProfile(name: string): boolean {
  const config = loadConfig()
  if (!(name in config.profiles)) return false
  delete config.profiles[name]
  if (config.default === name) {
    const remaining = Object.keys(config.profiles)
    config.default = remaining[0] ?? "production"
  }
  saveConfig(config)
  return true
}
