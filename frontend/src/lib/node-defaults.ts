import {
  NODE_DEFAULT_TYPES,
  type NodeDefaultType,
  type QualityLevel,
  type SemanticAspectRatio,
  mapQuality,
  mapAspectRatio,
  deriveLinkedFields,
  supportedDefaultDimensions,
  getTargetField,
  getValidValues,
} from "@nodaro/shared"

export interface AdminDefault {
  node_type: string
  provider: string
  quality_level: QualityLevel | null
  aspect_ratio: SemanticAspectRatio | null
}

export type ConcreteSnapshot = Record<string, unknown>

const MEMORY_KEY_PREFIX = "nodaro:nodeMemory:v1:"

function memoryKey(userId: string): string {
  return `${MEMORY_KEY_PREFIX}${userId}`
}

// ──────────────────────────────────────────────────────────────────────────
// User memory (localStorage)
// ──────────────────────────────────────────────────────────────────────────

export function readMemory(userId: string): Record<string, ConcreteSnapshot> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(memoryKey(userId))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

export function rememberSelection(
  userId: string,
  nodeType: string,
  snapshot: ConcreteSnapshot,
): void {
  if (typeof window === "undefined") return
  const all = readMemory(userId)
  all[nodeType] = snapshot
  try {
    window.localStorage.setItem(memoryKey(userId), JSON.stringify(all))
  } catch {
    // localStorage full / disabled — silently drop
  }
}

export function clearMemory(userId: string): void {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(memoryKey(userId))
}

// ──────────────────────────────────────────────────────────────────────────
// Per-node-type "relevant fields" snapshot — what we capture to memory
// ──────────────────────────────────────────────────────────────────────────

const RELEVANT_FIELDS: Record<string, readonly string[]> = {
  "generate-image":   ["provider", "model", "aspectRatio", "resolution", "quality"],
  "image-to-image":   ["provider", "model", "aspectRatio", "resolution", "quality"],
  "edit-image":       ["provider", "model"],
  "upscale-image":    ["provider"],
  "text-to-video":    ["provider", "aspectRatio", "duration", "resolution"],
  "image-to-video":   ["provider", "aspectRatio", "duration", "resolution"],
  "lip-sync":         ["provider"],
  "text-to-speech":   ["provider", "voiceId"],
  "generate-music":   ["provider", "modelVersion"],
  "voice-design":     ["model"],
  "ai-writer":        ["model"],
  "llm-chat":         ["model"],
  "lottie-overlay":   ["model"],
  "3d-title":         ["model"],
  "motion-graphics":  ["model"],
  "image-to-text":    ["model"],
  "qa-check":         ["model"],
}

export function pickRelevantFields(
  nodeType: string,
  data: Record<string, unknown>,
): ConcreteSnapshot {
  const fields = RELEVANT_FIELDS[nodeType] ?? ["provider", "model"]
  const out: ConcreteSnapshot = {}
  for (const f of fields) {
    if (data[f] !== undefined) out[f] = data[f]
  }
  return out
}

export function isNodeDefaultType(value: string): value is NodeDefaultType {
  return (NODE_DEFAULT_TYPES as readonly string[]).includes(value)
}

// ──────────────────────────────────────────────────────────────────────────
// Resolver
// ──────────────────────────────────────────────────────────────────────────

interface ResolveInput<T extends Record<string, unknown>> {
  nodeType: string
  factory: T
  adminDefaults: readonly AdminDefault[]
  userId?: string
}

/**
 * Compose factory ← admin ← user memory. Called at addNode() time.
 *
 * For node types not in NODE_DEFAULT_TYPES, returns the factory unchanged.
 * For node types with no admin row and no user memory, returns the factory unchanged.
 *
 * Drops user memory entries whose `provider`/`model` value is no longer valid
 * (e.g. model removed) — defense-in-depth against schema drift.
 */
export function resolveNodeDefaults<T extends Record<string, unknown>>(
  input: ResolveInput<T>,
): T {
  const { nodeType, factory, adminDefaults, userId } = input
  if (!isNodeDefaultType(nodeType)) return factory

  let result: Record<string, unknown> = { ...factory }
  const targetField = getTargetField(nodeType)

  // Layer 2: admin
  const admin = adminDefaults.find((d) => d.node_type === nodeType)
  if (admin) {
    result[targetField] = admin.provider
    Object.assign(result, deriveLinkedFields(nodeType, admin.provider))
    const dims = supportedDefaultDimensions(nodeType)
    if (dims.quality && admin.quality_level) {
      const mapped = mapQuality(admin.provider, admin.quality_level)
      if (mapped !== undefined) {
        // Write to ONLY the field this provider actually uses. Setting both
        // poisons whichever field the provider doesn't expose, e.g. writing
        // "medium" into `resolution` for gpt-image trips the route's
        // resolution enum (1K|2K|4K) at generate-time.
        result[mapped.field] = mapped.value
      }
    }
    if (dims.aspectRatio && admin.aspect_ratio) {
      const mapped = mapAspectRatio(admin.provider, admin.aspect_ratio)
      if (mapped !== undefined) {
        result.aspectRatio = mapped
        result.aspect_ratio = mapped
      }
    }
  }

  // Layer 3: user memory — overrides everything if present and still valid
  if (userId) {
    const memory = readMemory(userId)[nodeType]
    if (memory) {
      const validated = validateMemorySnapshot(nodeType, memory)
      if (validated) {
        Object.assign(result, validated)
      }
    }
  }

  return result as T
}

/**
 * Returns the snapshot if the primary value (provider or model) is still in
 * the valid set. Returns null if the entry is stale.
 */
function validateMemorySnapshot(
  nodeType: NodeDefaultType,
  snapshot: ConcreteSnapshot,
): ConcreteSnapshot | null {
  const targetField = getTargetField(nodeType)
  const value = snapshot[targetField]
  if (typeof value !== "string") return null
  const valid = getValidValues(nodeType)
  if (!valid.includes(value)) return null
  return snapshot
}
