import { createClient } from "@/lib/supabase"
import type { SubWorkflowRouteSnapshot } from "@/types/nodes"
import type { PresentationSettings } from "@/hooks/use-workflow-store"

export const API_BASE_URL = ''

/**
 * Get auth headers with the current session's JWT token.
 * Returns { Authorization: 'Bearer ...' } or {} if no session.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      return { Authorization: `Bearer ${session.access_token}` }
    }
  } catch {
    // Silently fall back to no auth header
  }
  return {}
}

async function getCurrentUserId(): Promise<string | undefined> {
  try {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session?.user?.id
  } catch {
    return undefined
  }
}

export class StorageExceededError extends Error {
  readonly usedBytes: number
  readonly quotaBytes: number
  readonly remainingBytes: number
  readonly tier: string

  constructor(message: string, usedBytes: number, quotaBytes: number, remainingBytes: number, tier: string) {
    super(message)
    this.name = "StorageExceededError"
    this.usedBytes = usedBytes
    this.quotaBytes = quotaBytes
    this.remainingBytes = remainingBytes
    this.tier = tier
  }
}

/**
 * Throws StorageExceededError if the parsed error JSON indicates storage_limit_exceeded.
 * Otherwise throws a plain Error with the message (or the given fallback).
 */
function throwApiError(errJson: Record<string, unknown> | null, fallback: string): never {
  const errObj = errJson?.error as Record<string, unknown> | undefined
  if (errObj?.code === "storage_limit_exceeded") {
    throw new StorageExceededError(
      (errObj.message as string) ?? fallback,
      (errObj.usedBytes as number) ?? 0,
      (errObj.quotaBytes as number) ?? 0,
      (errObj.remainingBytes as number) ?? 0,
      (errObj.tier as string) ?? "free",
    )
  }
  throw new Error((errObj?.message as string) ?? fallback)
}

// ---------------------------------------------------------------------------
// Workflow context — lets single-node runs tag jobs with a workflowId so they
// appear in the execution history list for that workflow.
// ---------------------------------------------------------------------------

let _currentWorkflowId: string | null = null

/** Call from WorkflowEditor on mount/change to set the active workflow. */
export function setCurrentWorkflowId(id: string | null) {
  _currentWorkflowId = id
}

/** Spread workflowId into a body object when inside a workflow editor. */
function withWorkflowId<T extends Record<string, unknown>>(body: T): T {
  if (_currentWorkflowId) {
    return { ...body, workflowId: _currentWorkflowId }
  }
  return body
}


// --- Generate Image (E2E spike) ---

export async function generateImage(
  prompt: string,
  referenceImageUrls?: string[],
  provider?: string,
  characterDescriptions?: string[],
  aspectRatio?: string,
  userId?: string,
  resolution?: string,
  quality?: string,
  negativePrompt?: string,
  seed?: number,
  renderingSpeed?: string,
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { prompt }
  if (referenceImageUrls && referenceImageUrls.length > 0) {
    body.referenceImageUrls = referenceImageUrls
  }
  if (characterDescriptions && characterDescriptions.length > 0) {
    body.characterDescriptions = characterDescriptions
  }
  if (provider) {
    body.provider = provider
  }
  if (aspectRatio) {
    body.aspectRatio = aspectRatio
  }
  if (resolution) {
    body.resolution = resolution
  }
  if (quality) {
    body.quality = quality
  }
  if (negativePrompt) {
    body.negativePrompt = negativePrompt
  }
  if (seed != null) {
    body.seed = seed
  }
  if (renderingSpeed) {
    body.renderingSpeed = renderingSpeed
  }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/generate-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start image generation")
  }
  return res.json()
}

// --- Edit Image (KIE.ai only) ---

export async function editImage(
  imageUrl: string,
  prompt?: string,
  provider?: string,
  userId?: string,
  options?: {
    upscaleFactor?: string
    aspectRatio?: string
    negativePrompt?: string
    style?: string
    seed?: number
    referenceImageUrls?: string[]
  }
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { imageUrl }
  if (prompt) {
    body.prompt = prompt
  }
  if (provider) {
    body.provider = provider
  }
  if (userId) {
    body.userId = userId
  }
  if (options?.upscaleFactor) {
    body.upscaleFactor = options.upscaleFactor
  }
  if (options?.aspectRatio) {
    body.aspectRatio = options.aspectRatio
  }
  if (options?.negativePrompt) {
    body.negativePrompt = options.negativePrompt
  }
  if (options?.style) {
    body.style = options.style
  }
  if (options?.seed != null) {
    body.seed = options.seed
  }
  if (options?.referenceImageUrls?.length) {
    body.referenceImageUrls = options.referenceImageUrls
  }
  const res = await fetch(`${API_BASE_URL}/v1/edit-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start image editing")
  }
  return res.json()
}

// --- Image to Image (transform image with prompt) ---

export async function imageToImage(
  imageUrl: string,
  prompt: string,
  provider?: string,
  userId?: string,
  referenceImageUrls?: string[],
  options?: {
    strength?: number
    aspectRatio?: string
    resolution?: string
    quality?: string
    negativePrompt?: string
    seed?: number
    renderingSpeed?: string
    guidanceScale?: number
  }
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { imageUrl, prompt }
  if (provider) {
    body.provider = provider
  }
  if (userId) {
    body.userId = userId
  }
  if (referenceImageUrls && referenceImageUrls.length > 0) {
    body.referenceImageUrls = referenceImageUrls
  }
  if (options?.strength != null) body.strength = options.strength
  if (options?.aspectRatio) body.aspectRatio = options.aspectRatio
  if (options?.resolution) body.resolution = options.resolution
  if (options?.quality) body.quality = options.quality
  if (options?.negativePrompt) body.negativePrompt = options.negativePrompt
  if (options?.seed != null) body.seed = options.seed
  if (options?.renderingSpeed) body.renderingSpeed = options.renderingSpeed
  if (options?.guidanceScale != null) body.guidanceScale = options.guidanceScale
  const res = await fetch(`${API_BASE_URL}/v1/image-to-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start image transformation")
  }
  return res.json()
}

export async function generateCharacter(data: {
  name: string
  description?: string
  gender?: string
  style?: string
  baseOutfit?: string
  sourceImageUrl?: string
  userId?: string
}): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/generate-character`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(data)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start character generation")
  }
  return res.json()
}

export async function generateCharacterAsset(data: {
  assetType: "expressions" | "poses" | "lighting" | "angles" | "custom"
  variant: string
  name: string
  description?: string
  gender?: string
  style?: string
  baseOutfit?: string
  sourceImageUrl?: string
  userId?: string
}): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/generate-character-asset`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(data)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start character asset generation")
  }
  return res.json()
}

export async function saveCharacter(data: {
  id?: string
  userId?: string
  nodeId: string
  workflowId?: string
  projectId?: string
  name: string
  description?: string
  gender?: string
  style?: string
  baseOutfit?: string
  sourceImageUrl?: string
  expressions?: { name: string; url: string }[]
  poses?: { name: string; url: string }[]
  lightingVariations?: { name: string; url: string }[]
}): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/characters`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(data)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to save character")
  }
  return res.json()
}

// Face DB API functions
export async function saveFace(data: {
  id?: string
  userId?: string
  nodeId: string
  workflowId?: string
  projectId?: string
  name: string
  description?: string
  style?: string
  sourceImageUrl?: string
  expressions?: { name: string; url: string }[]
}): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/faces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(data)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to save face")
  }
  return res.json()
}

export interface DbFace {
  id: string
  userId: string | null
  nodeId: string
  projectId: string | null
  name: string
  description: string | null
  style: string | null
  sourceImageUrl: string | null
  expressions: { name: string; url: string }[]
  createdAt: string
  updatedAt: string
}

export async function getFaces(projectId?: string, userId?: string): Promise<{ faces: DbFace[] }> {
  const params = new URLSearchParams()
  if (projectId) params.set("projectId", projectId)
  if (userId) params.set("userId", userId)
  const qs = params.toString()
  const res = await fetch(`${API_BASE_URL}/v1/faces${qs ? `?${qs}` : ""}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch faces")
  }
  return res.json()
}

export async function deleteFace(faceId: string): Promise<{ success: boolean }> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/v1/faces/${encodeURIComponent(faceId)}`, {
    method: "DELETE",
    headers: authHeaders,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to delete face")
  }
  return res.json()
}

export async function generateFace(data: {
  name: string
  description?: string
  style?: string
  prompt?: string
  sourceImageUrl?: string
  userId?: string
}): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/generate-face`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(data)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start face headshot generation")
  }
  return res.json()
}

export async function deleteCharacter(characterId: string): Promise<{ success: boolean }> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/v1/characters/${encodeURIComponent(characterId)}`, {
    method: "DELETE",
    headers: authHeaders,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to delete character")
  }
  return res.json()
}

export interface DbCharacter {
  id: string
  userId: string | null
  nodeId: string
  projectId: string | null
  name: string
  description: string | null
  gender: string | null
  style: string | null
  baseOutfit: string | null
  sourceImageUrl: string | null
  expressions: { name: string; url: string }[]
  poses: { name: string; url: string }[]
  lightingVariations: { name: string; url: string }[]
  createdAt: string
  updatedAt: string
}

export async function getCharacters(projectId?: string, userId?: string): Promise<{ characters: DbCharacter[] }> {
  const params = new URLSearchParams()
  if (projectId) params.set("projectId", projectId)
  if (userId) params.set("userId", userId)
  const qs = params.toString()
  const res = await fetch(`${API_BASE_URL}/v1/characters${qs ? `?${qs}` : ""}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch characters")
  }
  return res.json()
}

export async function getCharacterById(characterId: string): Promise<DbCharacter | null> {
  const res = await fetch(`${API_BASE_URL}/v1/characters/${encodeURIComponent(characterId)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
  })
  if (res.status === 404) {
    return null
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch character")
  }
  return res.json()
}

// Object API functions
export async function generateObject(data: {
  name: string
  description?: string
  category?: string
  style?: string
  sourceImageUrl?: string
  userId?: string
}): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/generate-object`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(data)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start object generation")
  }
  return res.json()
}

export async function generateObjectAsset(data: {
  assetType: "angles" | "materials" | "variations" | "custom"
  variant: string
  name: string
  description?: string
  category?: string
  style?: string
  sourceImageUrl: string
  userId?: string
}): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/generate-object-asset`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(data)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start object asset generation")
  }
  return res.json()
}

export async function saveObject(data: {
  id?: string
  userId?: string
  nodeId: string
  projectId?: string
  name: string
  description?: string
  category?: string
  style?: string
  sourceImageUrl?: string
  angles?: { name: string; url: string }[]
  materials?: { name: string; url: string }[]
  variations?: { name: string; url: string }[]
}): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/objects`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(data)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to save object")
  }
  return res.json()
}

export async function deleteObject(objectId: string): Promise<{ success: boolean }> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/v1/objects/${encodeURIComponent(objectId)}`, {
    method: "DELETE",
    headers: authHeaders,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to delete object")
  }
  return res.json()
}

export interface DbObject {
  id: string
  userId: string | null
  nodeId: string
  projectId: string | null
  name: string
  description: string | null
  category: string | null
  style: string | null
  sourceImageUrl: string | null
  angles: { name: string; url: string }[]
  materials: { name: string; url: string }[]
  variations: { name: string; url: string }[]
  createdAt: string
  updatedAt: string
}

export async function getObjects(projectId?: string, userId?: string): Promise<{ objects: DbObject[] }> {
  const params = new URLSearchParams()
  if (projectId) params.set("projectId", projectId)
  if (userId) params.set("userId", userId)
  const qs = params.toString()
  const res = await fetch(`${API_BASE_URL}/v1/objects${qs ? `?${qs}` : ""}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch objects")
  }
  return res.json()
}

export async function getObjectById(objectId: string): Promise<DbObject | null> {
  const res = await fetch(`${API_BASE_URL}/v1/objects/${encodeURIComponent(objectId)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
  })
  if (res.status === 404) {
    return null
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch object")
  }
  return res.json()
}

// Location API functions
export async function generateLocation(data: {
  name: string
  description?: string
  category?: string
  style?: string
  sourceImageUrl?: string
  userId?: string
}): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/generate-location`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(data)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start location generation")
  }
  return res.json()
}

export async function generateLocationAsset(data: {
  assetType: "timeOfDay" | "weather" | "angles" | "custom"
  variant: string
  name: string
  description?: string
  category?: string
  style?: string
  sourceImageUrl: string
  userId?: string
}): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/generate-location-asset`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(data)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start location asset generation")
  }
  return res.json()
}

export async function saveLocation(data: {
  id?: string
  userId?: string
  nodeId: string
  projectId?: string
  name: string
  description?: string
  category?: string
  style?: string
  sourceImageUrl?: string
  timeOfDay?: { name: string; url: string }[]
  weather?: { name: string; url: string }[]
  angles?: { name: string; url: string }[]
}): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/locations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(data)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to save location")
  }
  return res.json()
}

export async function deleteLocation(locationId: string): Promise<{ success: boolean }> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/v1/locations/${encodeURIComponent(locationId)}`, {
    method: "DELETE",
    headers: authHeaders,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to delete location")
  }
  return res.json()
}

export interface DbLocation {
  id: string
  userId: string | null
  nodeId: string
  projectId: string | null
  name: string
  description: string | null
  category: string | null
  style: string | null
  sourceImageUrl: string | null
  timeOfDay: { name: string; url: string }[]
  weather: { name: string; url: string }[]
  angles: { name: string; url: string }[]
  createdAt: string
  updatedAt: string
}

export async function getLocations(projectId?: string, userId?: string): Promise<{ locations: DbLocation[] }> {
  const params = new URLSearchParams()
  if (projectId) params.set("projectId", projectId)
  if (userId) params.set("userId", userId)
  const qs = params.toString()
  const res = await fetch(`${API_BASE_URL}/v1/locations${qs ? `?${qs}` : ""}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch locations")
  }
  return res.json()
}

export async function getLocationById(locationId: string): Promise<DbLocation | null> {
  const res = await fetch(`${API_BASE_URL}/v1/locations/${encodeURIComponent(locationId)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
  })
  if (res.status === 404) {
    return null
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch location")
  }
  return res.json()
}

export async function splitImage(data: {
  imageUrl: string
  gridCols: number
  gridRows: number
  names: string[]
}): Promise<{ images: { name: string; url: string }[] }> {
  const res = await fetch(`${API_BASE_URL}/v1/split-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(data)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to split image")
  }
  return res.json()
}

export interface GenerateVideoOptions {
  startFrameUrl: string
  endFrameUrl?: string     // Optional end frame (for providers that support it)
  audioUrl?: string        // Optional audio track to merge
  prompt?: string
  provider?: string
  generateAudio?: boolean
  duration?: number
  mode?: string            // Kling 3.0 quality mode (pro/std)
  sound?: boolean          // Kling 2.6 / 3.0 sound effects
  negativePrompt?: string  // Kling Turbo / Kling Master negative prompt
  cfgScale?: number        // Kling Turbo / Kling Master cfg_scale (0-1)
  aspectRatio?: string     // Kling 3.0 / Seedance aspect ratio
  multiShot?: boolean      // Kling 3.0 multi-shot mode
  shots?: Array<{ prompt: string; duration: number }>     // Kling 3.0 shot list
  elements?: Array<{ name: string; description: string; type: "image" | "video"; urls: string[] }>  // Kling 3.0 elements
  resolution?: string      // Video resolution (various providers)
  grokMode?: string        // Grok I2V mode: fun/normal/spicy
  videoSize?: string       // Sora2 Pro size: standard/high
  seed?: number            // Seed (Wan Turbo, Bytedance)
  cameraFixed?: boolean    // Camera fixed (Bytedance, Seedance)
  userId?: string
}

export async function generateVideo(options: GenerateVideoOptions): Promise<{ jobId: string }>
export async function generateVideo(imageUrl: string, prompt?: string, provider?: string, generateAudio?: boolean, duration?: number, userId?: string): Promise<{ jobId: string }>
export async function generateVideo(
  imageUrlOrOptions: string | GenerateVideoOptions,
  prompt?: string,
  provider?: string,
  generateAudio?: boolean,
  duration?: number,
  userId?: string
): Promise<{ jobId: string }> {
  let body: Record<string, unknown>

  // Handle both old and new API signatures
  if (typeof imageUrlOrOptions === "object") {
    const opts = imageUrlOrOptions
    body = {
      imageUrl: opts.startFrameUrl,  // Backend still expects imageUrl for backward compat
      endFrameUrl: opts.endFrameUrl,
      audioUrl: opts.audioUrl,
      prompt: opts.prompt,
      provider: opts.provider,
      generateAudio: opts.generateAudio,
      duration: opts.duration,
      mode: opts.mode,
      sound: opts.sound,
      negativePrompt: opts.negativePrompt,
      cfgScale: opts.cfgScale,
      aspectRatio: opts.aspectRatio,
      multiShot: opts.multiShot,
      shots: opts.shots,
      elements: opts.elements,
      resolution: opts.resolution,
      grokMode: opts.grokMode,
      videoSize: opts.videoSize,
      seed: opts.seed,
      cameraFixed: opts.cameraFixed,
    }
    if (opts.userId) {
      body.userId = opts.userId
    }
  } else {
    // Legacy signature for backward compatibility
    body = { imageUrl: imageUrlOrOptions, prompt, provider, generateAudio, duration }
    if (userId) {
      body.userId = userId
    }
  }

  const res = await fetch(`${API_BASE_URL}/v1/generate-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start video generation")
  }
  return res.json()
}

export async function videoToVideo(videoUrl: string, prompt?: string, provider?: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, prompt, provider }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/video-to-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start video-to-video generation")
  }
  return res.json()
}

export async function textToVideo(prompt: string, provider?: string, userId?: string, options?: {
  duration?: number
  mode?: string
  sound?: boolean
  negativePrompt?: string
  cfgScale?: number
  aspectRatio?: string
  multiShot?: boolean
  shots?: Array<{ prompt: string; duration: number }>
  elements?: Array<{ name: string; description: string; type: "image" | "video"; urls: string[] }>
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { prompt, provider, ...options }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/text-to-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start text-to-video generation")
  }
  return res.json()
}

export async function textToSpeech(
  text: string,
  voice?: string,
  provider?: string,
  userId?: string,
  options?: {
    stability?: number
    similarityBoost?: number
    style?: number
    speed?: number
    languageCode?: string
    voiceType?: "premade" | "custom" | "library"
  }
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { text, voice, provider }
  if (userId) body.userId = userId
  if (options?.stability != null) body.stability = options.stability
  if (options?.similarityBoost != null) body.similarityBoost = options.similarityBoost
  if (options?.style != null) body.style = options.style
  if (options?.speed != null) body.speed = options.speed
  if (options?.languageCode) body.languageCode = options.languageCode
  if (options?.voiceType) body.voiceType = options.voiceType
  const res = await fetch(`${API_BASE_URL}/v1/text-to-speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start text-to-speech generation")
  }
  return res.json()
}

export async function generateScriptApi(prompt: string, sceneCount?: number, tone?: string, targetDuration?: number, provider?: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { prompt }
  if (sceneCount !== undefined) body.sceneCount = sceneCount
  if (tone) body.tone = tone
  if (targetDuration !== undefined) body.targetDuration = targetDuration
  if (provider) body.provider = provider
  if (userId) body.userId = userId
  const res = await fetch(`${API_BASE_URL}/v1/generate-script`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start script generation")
  }
  return res.json()
}

export async function combineVideos(
  videoUrls: string[],
  transition: "cut" | "fade" | "dissolve" | "dip-to-black" | "dip-to-white" = "cut",
  transitionDuration: number = 0.5,
  audioMode: "keep" | "crossfade" | "remove" = "crossfade",
  userId?: string,
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrls, transition, transitionDuration, audioMode }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/combine-videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start video combination")
  }
  return res.json()
}

export async function mergeVideoAudioApi(
  videoUrl: string,
  audioTracks: { url: string; startTime: number; volume?: number; sourceType?: "audio" | "video" }[],
  backgroundVolume?: number,
  keepOriginalAudio?: boolean,
  userId?: string,
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, audioTracks, backgroundVolume, keepOriginalAudio }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/merge-video-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start merge-video-audio")
  }
  return res.json()
}

export async function extractAudioApi(videoUrl: string, audioFormat?: string, outputSilentVideo?: boolean, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, audioFormat, outputSilentVideo }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/extract-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start extract-audio")
  }
  return res.json()
}

export async function trimVideoApi(videoUrl: string, startTime: number, endTime?: number, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, startTime, endTime }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/trim-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start trim-video")
  }
  return res.json()
}

export async function transcodeVideoApi(videoUrl: string, codec?: string, crf?: number, resolution?: string, audioBitrate?: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, codec, crf, resolution, audioBitrate }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/transcode-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start transcode-video")
  }
  return res.json()
}

export async function speedRampApi(videoUrl: string, speed: number, adjustAudio: boolean, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, speed, adjustAudio }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/speed-ramp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start speed-ramp")
  }
  return res.json()
}

export async function loopVideoApi(videoUrl: string, mode: "repeat" | "duration", repeatCount?: number, targetDuration?: number, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, mode, repeatCount, targetDuration }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/loop-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start loop-video")
  }
  return res.json()
}

export async function fadeVideoApi(videoUrl: string, fadeIn: boolean, fadeInDuration: number, fadeOut: boolean, fadeOutDuration: number, color: "black" | "white", userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, fadeIn, fadeInDuration, fadeOut, fadeOutDuration, color }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/fade-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start fade-video")
  }
  return res.json()
}

export async function resizeVideoApi(videoUrl: string, targetAspect: string, method: string, padColor?: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, targetAspect, method, padColor }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/resize-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start resize-video")
  }
  return res.json()
}

export async function socialMediaFormatApi(
  mediaUrl: string,
  mediaType: "image" | "video",
  specKey: string,
  width: number,
  height: number,
  method: string,
  padColor?: string,
  userId?: string,
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { mediaUrl, mediaType, specKey, width, height, method, padColor }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/social-media-format`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start social-media-format")
  }
  return res.json()
}

export async function adjustVolumeApi(inputUrl: string, inputType: "audio" | "video", volume?: number, normalize?: boolean, fadeIn?: number, fadeOut?: number, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { volume, normalize, fadeIn, fadeOut }
  if (inputType === "video") {
    body.videoUrl = inputUrl
  } else {
    body.audioUrl = inputUrl
  }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/adjust-volume`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start adjust-volume")
  }
  return res.json()
}

export async function addCaptionsApi(videoUrl: string, text: string, style?: string, position?: string, fontSize?: number, color?: string, backgroundColor?: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, text, style, position, fontSize, color, backgroundColor }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/add-captions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start add-captions")
  }
  return res.json()
}

export async function mixAudioApi(audioUrls: string[], trackVolumes?: number[], userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { audioUrls }
  if (trackVolumes?.length) {
    body.trackVolumes = trackVolumes
  }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/mix-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start mix-audio")
  }
  return res.json()
}

export function getImageProxyUrl(url: string): string {
  return `${API_BASE_URL}/v1/image-proxy?url=${encodeURIComponent(url)}`
}

export async function uploadImage(file: File | Blob, userId?: string): Promise<{ url: string }> {
  const resolvedUserId = userId ?? await getCurrentUserId()
  const asFile = file instanceof File
    ? file
    : new File([file], "crop.png", { type: file.type || "image/png" })
  const result = await uploadFile(asFile, resolvedUserId)
  return { url: result.url }
}

export async function uploadAudio(file: File, userId?: string): Promise<{ url: string }> {
  const resolvedUserId = userId ?? await getCurrentUserId()
  const result = await uploadFile(file, resolvedUserId)
  return { url: result.url }
}

export interface UploadResult {
  readonly url: string
  readonly thumbnailUrl: string | null
  readonly assetId: string | null
  readonly category: "image" | "video" | "audio"
  readonly filename: string
  readonly mimeType: string
  readonly sizeBytes: number
  readonly metadata: {
    readonly width?: number
    readonly height?: number
    readonly format?: string
    readonly durationSeconds?: number
    readonly codec?: string
    readonly sampleRate?: number
  } | null
  readonly r2Key: string
}

export async function uploadFile(
  file: File,
  userId?: string,
): Promise<UploadResult> {
  const formData = new FormData()
  formData.append("file", file)
  if (userId) {
    formData.append("userId", userId)
  }

  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/v1/upload`, {
    method: "POST",
    headers: authHeaders,
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    if (err?.error?.code === "storage_limit_exceeded") {
      throw new StorageExceededError(
        err.error.message ?? "Storage limit exceeded",
        err.error.usedBytes ?? 0,
        err.error.quotaBytes ?? 0,
        err.error.remainingBytes ?? 0,
        err.error.tier ?? "free",
      )
    }
    const message = err?.error?.message ?? "Upload failed"
    throw new Error(message)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function downloadYouTubeAudio(url: string): Promise<{ url: string; thumbnailUrl: string | null }> {
  const res = await fetch(`${API_BASE_URL}/v1/youtube-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to extract audio from video")
  }
  return res.json()
}

export async function startVideoDownload(url: string): Promise<{ downloadId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/download-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start download. The video may be private or require login.")
  }
  return res.json()
}

export interface DownloadProgressEvent {
  phase: "downloading" | "processing" | "uploading" | "completed" | "failed"
  percent: number
  videoUrl?: string
  thumbnailUrl?: string
  error?: string
}

export function subscribeToDownloadProgress(
  downloadId: string,
  onProgress: (event: DownloadProgressEvent) => void,
): () => void {
  const url = `${API_BASE_URL}/v1/download-video/progress/${downloadId}`
  const eventSource = new EventSource(url)

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as DownloadProgressEvent
      onProgress(data)
      if (data.phase === "completed" || data.phase === "failed") {
        eventSource.close()
      }
    } catch {
      // Ignore parse errors
    }
  }

  eventSource.onerror = () => {
    eventSource.close()
    onProgress({ phase: "failed", percent: 0, error: "Connection lost" })
  }

  return () => eventSource.close()
}

export async function textToAudioApi(prompt: string, provider?: string, duration?: number, userId?: string, options?: { loop?: boolean; promptInfluence?: number }): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { prompt }
  if (provider) body.provider = provider
  if (duration !== undefined) body.duration = duration
  if (userId) body.userId = userId
  if (options?.loop != null) body.loop = options.loop
  if (options?.promptInfluence != null) body.promptInfluence = options.promptInfluence
  const res = await fetch(`${API_BASE_URL}/v1/text-to-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start audio generation")
  }
  return res.json()
}

export async function audioIsolationApi(audioUrl: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { audioUrl }
  if (userId) body.userId = userId
  const res = await fetch(`${API_BASE_URL}/v1/audio-isolation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start audio isolation")
  }
  return res.json()
}

export async function textToDialogueApi(
  dialogue: Array<{ text: string; voice: string }>,
  userId?: string,
  stability?: number,
  languageCode?: string,
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { dialogue }
  if (userId) body.userId = userId
  if (stability != null) body.stability = stability
  if (languageCode) body.languageCode = languageCode
  const res = await fetch(`${API_BASE_URL}/v1/text-to-dialogue`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start dialogue generation")
  }
  return res.json()
}

export async function voiceChangerApi(audioUrl: string, voiceId: string, userId?: string, stability?: number, similarityBoost?: number, removeBackgroundNoise?: boolean): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { audioUrl, voiceId }
  if (userId) body.userId = userId
  if (stability != null) body.stability = stability
  if (similarityBoost != null) body.similarityBoost = similarityBoost
  if (removeBackgroundNoise != null) body.removeBackgroundNoise = removeBackgroundNoise
  const res = await fetch(`${API_BASE_URL}/v1/voice-changer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start voice changer")
  }
  return res.json()
}

export async function dubbingApi(audioUrl: string, targetLanguage: string, userId?: string, sourceLanguage?: string, numSpeakers?: number): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { audioUrl, targetLanguage }
  if (userId) body.userId = userId
  if (sourceLanguage) body.sourceLanguage = sourceLanguage
  if (numSpeakers) body.numSpeakers = numSpeakers
  const res = await fetch(`${API_BASE_URL}/v1/dubbing`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start dubbing")
  }
  return res.json()
}

export async function voiceRemixApi(text: string, voiceDescription: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { text, voiceDescription }
  if (userId) body.userId = userId
  const res = await fetch(`${API_BASE_URL}/v1/voice-remix`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start voice remix")
  }
  return res.json()
}

export async function voiceDesignApi(
  text: string,
  voiceDescription: string,
  options?: {
    model?: string
    loudness?: number
    guidanceScale?: number
    seed?: number
    quality?: number
    shouldEnhance?: boolean
  },
  userId?: string,
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { text, voiceDescription, ...options }
  if (userId) body.userId = userId
  const res = await fetch(`${API_BASE_URL}/v1/voice-design`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start voice design")
  }
  return res.json()
}

export async function forcedAlignmentApi(audioUrl: string, transcript: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { audioUrl, transcript }
  if (userId) body.userId = userId
  const res = await fetch(`${API_BASE_URL}/v1/forced-alignment`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start forced alignment")
  }
  return res.json()
}

export async function sendWebhookOutput(data: { url: string; payload: Record<string, unknown> }): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE_URL}/v1/webhook-output/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to send webhook output")
  }
  return res.json()
}

export async function sunoGenerateApi(params: {
  prompt: string
  model?: string
  lyrics?: string
  style?: string
  title?: string
  negativeStyle?: string
  vocalGender?: string
  styleWeight?: number
  weirdnessConstraint?: number
  audioWeight?: number
  customMode?: boolean
  instrumental?: boolean
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { prompt: params.prompt }
  if (params.model) body.model = params.model
  if (params.lyrics) body.lyrics = params.lyrics
  if (params.style) body.style = params.style
  if (params.title) body.title = params.title
  if (params.negativeStyle) body.negativeStyle = params.negativeStyle
  if (params.vocalGender) body.vocalGender = params.vocalGender
  if (params.styleWeight != null) body.styleWeight = params.styleWeight
  if (params.weirdnessConstraint != null) body.weirdnessConstraint = params.weirdnessConstraint
  if (params.audioWeight != null) body.audioWeight = params.audioWeight
  body.customMode = params.customMode ?? false
  body.instrumental = params.instrumental ?? false
  if (params.userId) body.userId = params.userId
  const res = await fetch(`${API_BASE_URL}/v1/suno/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start Suno generation")
  }
  return res.json()
}

export async function sunoCoverApi(params: {
  prompt: string
  uploadUrl: string
  model?: string
  lyrics?: string
  style?: string
  title?: string
  negativeStyle?: string
  vocalGender?: string
  customMode?: boolean
  instrumental?: boolean
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { prompt: params.prompt, uploadUrl: params.uploadUrl }
  if (params.model) body.model = params.model
  if (params.lyrics) body.lyrics = params.lyrics
  if (params.style) body.style = params.style
  if (params.title) body.title = params.title
  if (params.negativeStyle) body.negativeStyle = params.negativeStyle
  if (params.vocalGender) body.vocalGender = params.vocalGender
  body.customMode = params.customMode ?? false
  body.instrumental = params.instrumental ?? false
  if (params.userId) body.userId = params.userId
  const res = await fetch(`${API_BASE_URL}/v1/suno/cover`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start Suno cover")
  }
  return res.json()
}

export async function sunoExtendApi(params: {
  audioId: string
  defaultParamFlag?: boolean
  prompt?: string
  model?: string
  style?: string
  title?: string
  continueAt?: number
  negativeStyle?: string
  vocalGender?: string
  styleWeight?: number
  weirdnessConstraint?: number
  audioWeight?: number
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = {
    audioId: params.audioId,
    defaultParamFlag: params.defaultParamFlag ?? true,
    model: params.model || "V5",
  }
  if (params.prompt) body.prompt = params.prompt
  if (params.style) body.style = params.style
  if (params.title) body.title = params.title
  if (params.continueAt != null) body.continueAt = params.continueAt
  if (params.negativeStyle) body.negativeStyle = params.negativeStyle
  if (params.vocalGender) body.vocalGender = params.vocalGender
  if (params.styleWeight != null) body.styleWeight = params.styleWeight
  if (params.weirdnessConstraint != null) body.weirdnessConstraint = params.weirdnessConstraint
  if (params.audioWeight != null) body.audioWeight = params.audioWeight
  if (params.userId) body.userId = params.userId
  const res = await fetch(`${API_BASE_URL}/v1/suno/extend`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start Suno extend")
  }
  return res.json()
}

export async function sunoLyricsApi(params: {
  prompt: string
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { prompt: params.prompt }
  if (params.userId) body.userId = params.userId
  const res = await fetch(`${API_BASE_URL}/v1/suno/lyrics`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start Suno lyrics generation")
  }
  return res.json()
}

export async function sunoSeparateApi(params: {
  taskId: string
  audioId: string
  type?: "separate_vocal" | "split_stem"
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { taskId: params.taskId, audioId: params.audioId }
  if (params.type) body.type = params.type
  if (params.userId) body.userId = params.userId
  const res = await fetch(`${API_BASE_URL}/v1/suno/separate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start Suno separate")
  }
  return res.json()
}

export async function sunoMusicVideoApi(params: {
  taskId: string
  audioId: string
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { taskId: params.taskId, audioId: params.audioId }
  if (params.userId) body.userId = params.userId
  const res = await fetch(`${API_BASE_URL}/v1/suno/music-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start Suno music video")
  }
  return res.json()
}

export async function transcribeApi(audioUrl: string, provider?: string, language?: string, userId?: string, diarize?: boolean, tagAudioEvents?: boolean): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { audioUrl }
  if (provider) body.provider = provider
  if (language) body.language = language
  if (userId) body.userId = userId
  if (diarize != null) body.diarize = diarize
  if (tagAudioEvents != null) body.tagAudioEvents = tagAudioEvents
  const res = await fetch(`${API_BASE_URL}/v1/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start transcription")
  }
  return res.json()
}

export async function imageToTextApi(
  imageUrl: string,
  detailLevel?: "brief" | "detailed" | "structured",
  customPrompt?: string,
  userId?: string,
): Promise<{ jobId: string; generatedText: string }> {
  const body: Record<string, unknown> = { imageUrl }
  if (detailLevel) body.detailLevel = detailLevel
  if (customPrompt) body.customPrompt = customPrompt
  if (userId) body.userId = userId
  const res = await fetch(`${API_BASE_URL}/v1/image-to-text/describe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to describe image")
  }
  return res.json()
}

export async function lipSyncApi(
  imageUrl: string,
  audioUrl: string,
  prompt?: string,
  provider?: string,
  resolution?: string,
  userId?: string
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { imageUrl, audioUrl }
  if (prompt) body.prompt = prompt
  if (provider) body.provider = provider
  if (resolution) body.resolution = resolution
  if (userId) body.userId = userId
  const res = await fetch(`${API_BASE_URL}/v1/lip-sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start lip sync generation")
  }
  return res.json()
}

export async function generateMusicApi(prompt: string, provider?: string, duration?: number, genre?: string, mood?: string, instrumental?: boolean, lyrics?: string, referenceAudioUrl?: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { prompt }
  if (provider) body.provider = provider
  if (duration !== undefined) body.duration = duration
  if (genre) body.genre = genre
  if (mood) body.mood = mood
  if (instrumental !== undefined) body.instrumental = instrumental
  if (lyrics) body.lyrics = lyrics
  if (referenceAudioUrl) body.referenceAudioUrl = referenceAudioUrl
  if (userId) body.userId = userId
  const res = await fetch(`${API_BASE_URL}/v1/generate-music`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start music generation")
  }
  return res.json()
}

export async function extractYouTubeAudioApi(youtubeUrl: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { youtubeUrl }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/extract-youtube-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start YouTube audio extraction")
  }
  return res.json()
}

export interface YouTubeOEmbedData {
  title: string
  thumbnail_url: string
  author_name: string
}

export async function fetchYouTubeOEmbed(url: string): Promise<YouTubeOEmbedData> {
  const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
  if (!res.ok) throw new Error("Failed to fetch YouTube metadata")
  return res.json()
}

export interface Job {
  id: string
  status: string
  progress: number
  input_data: {
    type?: string
    prompt?: string
    provider?: string
    referenceImageUrls?: string[]
    imageUrl?: string
    videoUrl?: string
    audioUrl?: string
    text?: string
    [key: string]: unknown
  }
  output_data?: {
    imageUrl?: string
    videoUrl?: string
    audioUrl?: string
    script?: unknown
    [key: string]: unknown
  }
  error_message?: string
  created_at: string
  started_at?: string
  completed_at?: string
  user_id?: string
  // Cost fields - returned differently based on edition:
  // SELF-HOSTED or admin: provider, provider_cost, display_cost
  // CLOUD regular user: only cost (= display_cost)
  provider?: string              // Which provider was used (self-hosted/admin only)
  provider_cost?: number         // Actual cost from API response (self-hosted/admin only)
  display_cost?: number          // provider_cost with markup (self-hosted/admin only)
  cost?: number                  // What user pays (cloud edition regular users)
  credits_estimated?: number | null // Credits charged (all editions)
  job_type?: string | null        // Job type (e.g. "generate-image")
}

export async function getJobStatus(jobId: string): Promise<Job> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/v1/jobs/${jobId}`, {
    headers: authHeaders,
  })
  if (!res.ok) throw new Error("Failed to get job status")
  const body = await res.json()
  return body.data
}

export async function getJobs(userId?: string, cursor?: string, limit?: number): Promise<{
  data: Job[]
  next: string | null
  previous: string | null
}> {
  const params = new URLSearchParams()
  if (userId) params.set("userId", userId)
  if (cursor) params.set("cursor", cursor)
  if (limit) params.set("limit", String(limit))
  const url = params.toString() ? `/v1/jobs?${params.toString()}` : "/v1/jobs"
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}${url}`, {
    headers: authHeaders,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch jobs")
  }
  return res.json()
}

export async function deleteJob(jobId: string): Promise<{ success: boolean }> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/v1/jobs/${jobId}`, {
    method: "DELETE",
    headers: authHeaders,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to delete job")
  }
  return { success: true }
}

export interface BatchJobStatus {
  id: string
  status: string
  output_data: { imageUrl?: string; videoUrl?: string; audioUrl?: string; script?: unknown } | null
  error_message: string | null
}

export async function getBatchJobStatus(jobIds: string[]): Promise<BatchJobStatus[]> {
  if (jobIds.length === 0) return []

  let res: Response
  try {
    const authHeaders = await getAuthHeaders()
    res = await fetch(`${API_BASE_URL}/v1/jobs/batch-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ jobIds }),
    })
  } catch {
    // Network error (backend not running) - return empty silently
    return []
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch batch job status")
  }
  const body = await res.json()
  return body.data
}

// --- Generic helpers ---

export interface WorkflowCharacterInfo {
  readonly workflowId: string
  readonly workflowName: string
  readonly characters: readonly CharacterDefinitionRaw[]
}

export interface CharacterDefinitionRaw {
  readonly id: string
  readonly name: string
  readonly type: "reference" | "description"
  readonly referenceImageUrl?: string
  readonly description?: string
}


export async function motionTransferApi(
  imageUrl: string,
  videoUrl: string,
  prompt?: string,
  characterOrientation?: "image" | "video",
  resolution?: "720p" | "1080p",
  userId?: string
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { imageUrl, videoUrl }
  if (prompt) body.prompt = prompt
  if (characterOrientation) body.characterOrientation = characterOrientation
  if (resolution) body.resolution = resolution
  if (userId) body.userId = userId
  const res = await fetch(`${API_BASE_URL}/v1/motion-transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start motion transfer")
  }
  return res.json()
}

export async function videoUpscaleApi(opts: {
  videoUrl?: string
  upscaleFactor?: "1" | "2" | "4"
  userId?: string
  provider?: "topaz" | "veo-1080p" | "veo-4k"
  kieTaskId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = {}
  if (opts.videoUrl) body.videoUrl = opts.videoUrl
  if (opts.upscaleFactor) body.upscaleFactor = opts.upscaleFactor
  if (opts.userId) body.userId = opts.userId
  if (opts.provider) body.provider = opts.provider
  if (opts.kieTaskId) body.kieTaskId = opts.kieTaskId
  const res = await fetch(`${API_BASE_URL}/v1/video-upscale`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(body)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start video upscale")
  }
  return res.json()
}

// --- Extend Video ---

export async function extendVideo(params: {
  kieTaskId: string
  prompt: string
  provider: string
  model?: string
  seeds?: number
  quality?: string
  userId?: string
}): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/extend-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(params)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start extend video")
  }
  return res.json()
}

// --- Render Video (Remotion) ---

export async function renderVideoWithSceneGraph(params: {
  sceneGraph: Record<string, unknown>
  userId?: string
}): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/render-video/scene-graph`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(params)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start scene graph video render")
  }
  return res.json()
}

export async function generateSceneGraph(params: {
  prompt: string
  assets: Array<{ id: string; type: "image" | "video" | "audio"; url: string; label?: string; durationSeconds?: number }>
  fps: number
  aspectRatio: string
  durationSeconds: number
  userId: string
}): Promise<{ jobId: string; sceneGraph: Record<string, unknown> }> {
  const res = await fetch(`${API_BASE_URL}/v1/scene-graph/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(params)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Scene graph generation failed")
  }
  return res.json()
}

// --- After Effects ---

export async function generateAfterEffects(params: {
  prompt: string
  inputVideoUrl: string
  fps: number
  width: number
  height: number
  durationSeconds: number
  userId: string
}): Promise<{ jobId: string; effectPlan: Record<string, unknown> }> {
  const res = await fetch(`${API_BASE_URL}/v1/after-effects/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(params)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "After effects generation failed")
  }
  return res.json()
}

export async function renderVideoWithPlan(params: {
  planType: string
  plan: Record<string, unknown>
  userId?: string
}): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/render-video/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(params)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to start plan-based video render")
  }
  return res.json()
}

// --- Lottie Overlay ---

export async function generateLottieOverlay(params: {
  prompt: string
  inputVideoUrl: string
  fps: number
  durationSeconds: number
  width?: number
  height?: number
  lottieAssets?: Array<{ id: string; url: string; name: string; durationSeconds?: number }>
  userId: string
}): Promise<{ jobId: string; overlayPlan: Record<string, unknown> }> {
  const res = await fetch(`${API_BASE_URL}/v1/lottie-overlay/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(params)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Lottie overlay generation failed")
  }
  return res.json()
}

// --- 3D Title ---

export async function generate3DTitle(params: {
  prompt: string
  fps: number
  aspectRatio?: string
  width?: number
  height?: number
  durationSeconds: number
  backgroundColor?: string
  backgroundMediaUrl?: string
  userId: string
}): Promise<{ jobId: string; titlePlan: Record<string, unknown> }> {
  const res = await fetch(`${API_BASE_URL}/v1/3d-title/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(params)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "3D title generation failed")
  }
  return res.json()
}

// --- Motion Graphics ---

export async function generateMotionGraphics(params: {
  prompt: string
  fps: number
  aspectRatio?: string
  width?: number
  height?: number
  durationSeconds: number
  backgroundColor?: string
  userId: string
}): Promise<{ jobId: string; motionPlan: Record<string, unknown> }> {
  const res = await fetch(`${API_BASE_URL}/v1/motion-graphics/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(params)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Motion graphics generation failed")
  }
  return res.json()
}

// --- AI Writer ---


export async function generateAIWriterStream(params: {
  systemPrompt: string
  userInput: string
  model: string
  temperature: number
  maxTokens: number
  userId: string
  onToken: (token: string) => void
  signal?: AbortSignal
}): Promise<{ jobId: string; generatedText: string }> {
  const { onToken, signal, ...body } = params
  let collectedText = ""
  let jobId = ""

  // SSE streaming must bypass the Next.js rewrite proxy (which buffers the
  // response body) and call the backend directly so tokens arrive in real-time.
  const sseBaseUrl = import.meta.env.VITE_API_URL || ""

  try {
    const { streamRequest } = await import("@/lib/sse-client")
    const authHeaders = await getAuthHeaders()

    for await (const event of streamRequest("/v1/ai-writer/generate-stream", {
      body: withWorkflowId(body),
      signal,
      baseUrl: sseBaseUrl || undefined,
      headers: authHeaders,
    })) {
      switch (event.type) {
        case "metadata":
          jobId = (event.data as Record<string, unknown>).jobId as string
          break
        case "token":
          collectedText += event.data as string
          onToken(event.data as string)
          break
        case "done": {
          const done = event.data as Record<string, unknown>
          return {
            jobId: (done.jobId as string) ?? jobId,
            generatedText: (done.generatedText as string) ?? collectedText,
          }
        }
        case "error": {
          const err = event.data as { code: string; message: string }
          throw new Error(err.message)
        }
      }
    }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { jobId, generatedText: collectedText }
    }
    throw err
  }

  throw new Error("Stream ended without completion")
}

// Stats types
export interface StatsResponse {
  totalExecutions: number
  successful: number
  failed: number
  cancelled: number
  pending: number
  processing: number
  failureRate: number
  avgImageTime: number | null
  avgVideoTime: number | null
}

export async function getStats(scope: "user" | "platform" = "user", userId?: string): Promise<{ data: StatsResponse }> {
  const params = new URLSearchParams()
  params.set("scope", scope)
  if (userId) params.set("userId", userId)

  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/v1/stats?${params.toString()}`, {
    headers: authHeaders,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch stats")
  }
  return res.json()
}

// Cost summary types
export interface CostBreakdownItem {
  readonly node_type: string
  readonly model: string
  readonly runs: number
  readonly successful: number
  readonly failed: number
  readonly total_credits: number
  readonly total_cost_usd: number
  readonly avg_credits_per_run: number
}

export interface CostSummary {
  readonly total_credits: number
  readonly total_cost_usd: number
  readonly total_jobs: number
  readonly breakdown: readonly CostBreakdownItem[]
}

export async function getWorkflowCostSummary(jobIds: readonly string[]): Promise<{ data: CostSummary }> {
  if (jobIds.length === 0) {
    return { data: { total_credits: 0, total_cost_usd: 0, total_jobs: 0, breakdown: [] } }
  }
  const res = await fetch(`${API_BASE_URL}/v1/jobs/cost-summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify({ jobIds }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch cost summary")
  }
  return res.json()
}

// Cancel job functions
export async function cancelJob(jobId: string, userId?: string): Promise<{ success: boolean; cancelled: number }> {
  const res = await fetch(`${API_BASE_URL}/v1/jobs/${jobId}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify({ userId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to cancel job")
  }
  return res.json()
}

export async function cancelAllJobs(userId: string): Promise<{ success: boolean; cancelled: number }> {
  const res = await fetch(`${API_BASE_URL}/v1/jobs/cancel-all`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify({ userId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to cancel jobs")
  }
  return res.json()
}

// ============================================================
// Media Library
// ============================================================

export interface LibraryAsset {
  id: string
  type: "image" | "video" | "audio"
  filename: string
  mimeType: string
  sizeBytes: number
  url: string
  thumbnailUrl: string | null
  metadata: Record<string, unknown>
  isLibraryItem: boolean
  uploadSource: string
  createdAt: string
}

export async function getLibraryAssets(params: {
  userId: string
  type?: string
  search?: string
  limit?: number
  cursor?: string
  owned?: boolean
}): Promise<{ data: LibraryAsset[]; nextCursor: string | null; totalCount?: number }> {
  const qs = new URLSearchParams({ userId: params.userId })
  if (params.type && params.type !== "all") qs.set("type", params.type)
  if (params.search) qs.set("search", params.search)
  if (params.limit) qs.set("limit", String(params.limit))
  if (params.cursor) qs.set("cursor", params.cursor)
  if (params.owned) qs.set("owned", "true")

  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/v1/library?${qs.toString()}`, {
    headers: authHeaders,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch library assets")
  }
  return res.json()
}

export async function deleteLibraryAsset(
  assetId: string,
  userId: string,
): Promise<{ success: boolean }> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(
    `${API_BASE_URL}/v1/library/${assetId}?userId=${encodeURIComponent(userId)}&permanent=true`,
    { method: "DELETE", headers: authHeaders },
  )
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to delete asset")
  }
  return res.json()
}

export async function removeLibraryAsset(
  assetId: string,
  userId: string,
): Promise<{ success: boolean }> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(
    `${API_BASE_URL}/v1/library/${assetId}?userId=${encodeURIComponent(userId)}`,
    { method: "DELETE", headers: authHeaders },
  )
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to remove from library")
  }
  return res.json()
}

export async function promoteToLibrary(
  assetId: string,
  userId: string,
): Promise<{ success: boolean }> {
  const res = await fetch(
    `${API_BASE_URL}/v1/library/${assetId}/promote`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
      body: JSON.stringify({ userId }),
    },
  )
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to promote asset")
  }
  return res.json()
}

export async function demoteFromLibrary(
  assetId: string,
  userId: string,
): Promise<{ success: boolean }> {
  const res = await fetch(
    `${API_BASE_URL}/v1/library/${assetId}/demote`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
      body: JSON.stringify({ userId }),
    },
  )
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to demote asset")
  }
  return res.json()
}

export async function saveGeneratedToLibrary(params: {
  userId: string
  url: string
  type: "image" | "video" | "audio"
  filename?: string
  metadata?: Record<string, unknown>
  isLibraryItem?: boolean
}): Promise<{ data: { id: string; isLibraryItem: boolean } }> {
  const res = await fetch(`${API_BASE_URL}/v1/library/save-generated`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(withWorkflowId(params)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to save to library")
  }
  return res.json()
}

// ============================================================
// Credits API
// ============================================================

export interface UserBalance {
  total: number
  subscription: number
  topup: number
  dailySpent: number
  dailyLimit: number | null
  monthlyAllocation: number
  tier: string
  features: Record<string, unknown>
  periodEnd: string | null
}

export interface CreditCheckResult {
  allowed: boolean
  error?: string
  balance?: number
  required?: number
  creditCost?: number
  dailyLimit?: number
  dailySpent?: number
}

export async function getUserCredits(userId: string): Promise<{ data: UserBalance }> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/v1/user/credits?userId=${encodeURIComponent(userId)}`, {
    headers: authHeaders,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to get credits")
  }
  return res.json()
}

export async function checkCredits(userId: string, model: string): Promise<{ data: CreditCheckResult }> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/v1/credits/check?userId=${encodeURIComponent(userId)}&model=${encodeURIComponent(model)}`, {
    headers: authHeaders,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to check credits")
  }
  return res.json()
}

export async function getModelCreditCost(model: string): Promise<{ data: { model: string; creditCost: number } }> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/v1/credits/model-cost?model=${encodeURIComponent(model)}`, {
    headers: authHeaders,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to get model cost")
  }
  return res.json()
}

export async function getBatchModelCreditCosts(models: string[]): Promise<Record<string, number>> {
  const res = await fetch(`${API_BASE_URL}/v1/credits/model-costs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ models }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to get model costs")
  }
  const body = await res.json()
  return body.data
}

// ============================================================
// Billing API
// ============================================================

export interface SubscriptionInfo {
  id: string
  paddle_subscription_id: string
  tier: string
  status: string
  paddle_price_id: string
  current_period_start: string | null
  current_period_end: string | null
  canceled_at: string | null
}

export interface TransactionRecord {
  id: string
  paddle_transaction_id: string
  type: "subscription" | "topup"
  amount_usd: number
  credits_granted: number
  tier: string | null
  created_at: string
}

export async function getSubscription(userId: string): Promise<SubscriptionInfo | null> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(
    `${API_BASE_URL}/v1/billing/subscription?userId=${encodeURIComponent(userId)}`,
    { headers: authHeaders }
  )
  if (!res.ok) return null
  const json = await res.json()
  return json.data ?? json ?? null
}

export async function getTransactions(userId: string): Promise<TransactionRecord[]> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(
    `${API_BASE_URL}/v1/billing/transactions?userId=${encodeURIComponent(userId)}`,
    { headers: authHeaders }
  )
  if (!res.ok) return []
  const json = await res.json()
  return json.data ?? json ?? []
}

export async function getManageSubscriptionUrl(userId: string): Promise<string | null> {
  const res = await fetch(`${API_BASE_URL}/v1/billing/manage-subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify({ userId }),
  })
  if (!res.ok) return null
  const json = await res.json()
  return json.data?.url ?? json.url ?? null
}

export async function changePlan(
  userId: string,
  newPriceId: string
): Promise<{ subscriptionId: string; tier: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/billing/change-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify({ userId, newPriceId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as Record<string, string>).error ?? "Failed to change plan")
  }
  const json = await res.json()
  return (json as Record<string, unknown>).data as { subscriptionId: string; tier: string }
}

// ============================================================
// Voices (ElevenLabs)
// ============================================================

export interface ElevenLabsVoice {
  voice_id: string
  name: string
  preview_url: string
  gender: string
  accent: string
  age: string
  description: string
  use_case: string
  category: string
}

export async function getVoices(): Promise<ElevenLabsVoice[]> {
  const res = await fetch(`${API_BASE_URL}/v1/voices`)
  if (!res.ok) {
    throw new Error("Failed to fetch voices")
  }
  const body = await res.json()
  return body.voices
}

// Voice Library (shared/community voices)

export interface SharedVoice {
  voice_id: string
  name: string
  preview_url: string
  gender: string
  accent: string
  age: string
  description: string
  use_case: string
  category: string
}

export interface VoiceLibraryParams {
  search?: string
  gender?: string
  age?: string
  accent?: string
  language?: string
  category?: string
  use_cases?: string
  descriptives?: string
  featured?: string
  sort?: string
  page?: number
  page_size?: number
}

export interface VoiceLibraryResponse {
  voices: SharedVoice[]
  hasMore: boolean
}

export async function searchVoiceLibrary(params: VoiceLibraryParams): Promise<VoiceLibraryResponse> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v))
  }
  const res = await fetch(`${API_BASE_URL}/v1/voices/library?${qs.toString()}`)
  if (!res.ok) {
    return { voices: [], hasMore: false }
  }
  return res.json()
}

// ─── Voice Clones (custom cloned voices) ───────────────────────────────

export interface VoiceClone {
  id: string
  name: string
  description?: string
  elevenlabsVoiceId: string
  sampleAudioUrl?: string
  previewUrl?: string
  gender?: string
  accent?: string
  createdAt: string
  updatedAt?: string
}

export async function getVoiceClones(): Promise<VoiceClone[]> {
  const res = await fetch(`${API_BASE_URL}/v1/voice-clones`, {
    headers: await getAuthHeaders(),
  })
  if (!res.ok) {
    return []
  }
  const body = await res.json()
  return body.voiceClones
}

export async function createVoiceClone(name: string, file: Blob): Promise<VoiceClone> {
  const formData = new FormData()
  formData.append("name", name)
  formData.append("file", file, "sample.webm")
  const res = await fetch(`${API_BASE_URL}/v1/voice-clones`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to clone voice")
  }
  return res.json()
}

export async function deleteVoiceClone(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/v1/voice-clones/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await getAuthHeaders(),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to delete voice clone")
  }
}

export async function renameVoiceClone(id: string, name: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/v1/voice-clones/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to rename voice clone")
  }
}

// --- Sub-Workflow APIs ---

interface CallableWorkflow {
  id: string
  name: string
  projectId: string
  projectName: string
  routes: SubWorkflowRouteSnapshot[]
}

export async function getCallableWorkflows(projectId?: string): Promise<CallableWorkflow[]> {
  const params = new URLSearchParams()
  if (projectId) params.set("projectId", projectId)
  const url = `${API_BASE_URL}/v1/workflows/callable${params.toString() ? `?${params}` : ""}`
  const res = await fetch(url, {
    headers: await getAuthHeaders(),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch callable workflows")
  }
  const json = await res.json()
  return json.data
}

export async function getWorkflowInterface(workflowId: string): Promise<{ routes: SubWorkflowRouteSnapshot[] }> {
  const res = await fetch(`${API_BASE_URL}/v1/workflows/${encodeURIComponent(workflowId)}/interface`, {
    headers: await getAuthHeaders(),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch workflow interface")
  }
  const json = await res.json()
  return json.data
}

// ---------------------------------------------------------------------------
// Workflow execution API
// ---------------------------------------------------------------------------

export interface WorkflowExecution {
  id: string
  workflowId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'stopping'
  triggerType: 'manual' | 'webhook' | 'schedule' | 'single-node'
  triggerData?: Record<string, unknown>
  nodeStates?: Record<string, unknown>
  totalNodes: number
  completedNodes: number
  failedNodes: number
  totalCreditsUsed: number
  errorMessage?: string
  startedAt?: string
  completedAt?: string
  createdAt: string
}

export interface WorkflowTrigger {
  id: string
  workflowId: string
  type: 'webhook' | 'schedule'
  config: Record<string, unknown>
  isActive: boolean
  webhookToken?: string
  webhookUrl?: string
  lastTriggeredAt?: string
  createdAt: string
}

/**
 * Internal helper for simple API requests that follow the standard
 * fetch -> check ok -> throwApiError -> return json pattern.
 */
async function apiRequest<T>(
  path: string,
  errorMessage: string,
  opts?: { method?: string; body?: unknown },
): Promise<T> {
  const headers: Record<string, string> = { ...(await getAuthHeaders()) }
  if (opts?.body !== undefined) headers["Content-Type"] = "application/json"

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: opts?.method ?? "GET",
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, errorMessage)
  }
  return res.json() as Promise<T>
}

export class WorkflowAlreadyRunningError extends Error {
  executionId: string
  constructor(executionId: string) {
    super("This workflow already has an active execution")
    this.name = "WorkflowAlreadyRunningError"
    this.executionId = executionId
  }
}

/** Run a workflow (creates execution, enqueues orchestrator). Optionally pass nodeIds for partial execution. */
export async function runWorkflow(workflowId: string, nodeIds?: string[]): Promise<{ executionId: string }> {
  const headers: Record<string, string> = { ...(await getAuthHeaders()) }
  let body: string | undefined
  if (nodeIds) {
    headers["Content-Type"] = "application/json"
    body = JSON.stringify({ nodeIds })
  }
  const res = await fetch(`${API_BASE_URL}/v1/workflows/${encodeURIComponent(workflowId)}/run`, {
    method: "POST",
    headers,
    body,
  })
  if (res.status === 409) {
    const body = await res.json().catch(() => null)
    const execId = (body as Record<string, unknown>)?.executionId as string | undefined
    if (execId) throw new WorkflowAlreadyRunningError(execId)
    throwApiError(body as Record<string, unknown> | null, "Failed to run workflow")
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to run workflow")
  }
  return res.json() as Promise<{ executionId: string }>
}

/** Get execution status + node states. */
export async function getWorkflowExecution(executionId: string): Promise<WorkflowExecution> {
  const json = await apiRequest<{ data: WorkflowExecution }>(
    `/v1/workflow-executions/${encodeURIComponent(executionId)}`,
    "Failed to fetch execution",
  )
  return json.data
}

/** Cancel an active execution immediately. */
export function cancelWorkflowExecution(executionId: string): Promise<void> {
  return apiRequest(
    `/v1/workflow-executions/${encodeURIComponent(executionId)}/cancel`,
    "Failed to cancel execution",
    { method: "POST" },
  )
}

/** Stop after the current node finishes (sets status to "stopping"). */
export function stopWorkflowExecution(executionId: string): Promise<void> {
  return apiRequest(
    `/v1/workflow-executions/${encodeURIComponent(executionId)}/cancel`,
    "Failed to stop execution",
    { method: "POST", body: { mode: "after_current" } },
  )
}

/** Node execution state from the backend orchestrator. */
interface ExecutionNodeState {
  status: "pending" | "running" | "completed" | "failed" | "skipped"
  output?: {
    imageUrl?: string
    videoUrl?: string
    audioUrl?: string
    text?: string
    script?: unknown
    generatedVoiceId?: string
    alignment?: unknown
    vocalUrl?: string
    instrumentalUrl?: string
    splitResults?: string[]
    combinedText?: string
  }
  error?: string
}

export interface StreamExecutionCallbacks {
  onNodeStatesChanged: (
    nodeStates: Record<string, ExecutionNodeState>,
    meta: { completedNodes?: number; failedNodes?: number; totalNodes?: number; totalCreditsUsed?: number },
  ) => void
  onCompleted: (data: Record<string, unknown>) => void
  onFailed: (data: Record<string, unknown>) => void
  onCancelled: (data: Record<string, unknown>) => void
}

/**
 * Stream workflow execution updates via SSE.
 * Bypasses Vite proxy (which buffers responses) and calls backend directly.
 */
export async function streamWorkflowExecution(
  executionId: string,
  callbacks: StreamExecutionCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const sseBaseUrl = import.meta.env.VITE_API_URL || ""
  const authHeaders = await getAuthHeaders()

  const { streamGet } = await import("@/lib/sse-client")

  for await (const event of streamGet(
    `/v1/workflow-executions/${encodeURIComponent(executionId)}/stream`,
    {
      signal,
      baseUrl: sseBaseUrl || undefined,
      headers: authHeaders,
    },
  )) {
    if (event.type === "metadata" || event.type === "execution") {
      const d = event.data as Record<string, unknown>
      const nodeStates = (d.nodeStates ?? {}) as Record<string, ExecutionNodeState>
      callbacks.onNodeStatesChanged(nodeStates, {
        completedNodes: d.completedNodes as number | undefined,
        failedNodes: d.failedNodes as number | undefined,
        totalNodes: d.totalNodes as number | undefined,
        totalCreditsUsed: d.totalCreditsUsed as number | undefined,
      })
    } else if (event.type === "done") {
      const d = event.data as Record<string, unknown>
      const nodeStates = (d.nodeStates ?? {}) as Record<string, ExecutionNodeState>
      const eventType = d.eventType as string | undefined
      // Always send the final nodeStates update first
      callbacks.onNodeStatesChanged(nodeStates, {
        completedNodes: d.completedNodes as number | undefined,
        failedNodes: d.failedNodes as number | undefined,
        totalNodes: d.totalNodes as number | undefined,
        totalCreditsUsed: d.totalCreditsUsed as number | undefined,
      })
      if (eventType === "execution:failed") {
        callbacks.onFailed(d)
      } else if (eventType === "execution:cancelled") {
        callbacks.onCancelled(d)
      } else {
        callbacks.onCompleted(d)
      }
      return
    } else if (event.type === "error") {
      const err = event.data as { code: string; message: string }
      throw new Error(err.message)
    }
  }
}

/** List executions for a workflow. */
export function listWorkflowExecutions(
  workflowId: string,
  opts?: { limit?: number; cursor?: string; status?: string },
): Promise<{ data: WorkflowExecution[]; nextCursor?: string }> {
  const params = new URLSearchParams()
  if (opts?.limit) params.set("limit", String(opts.limit))
  if (opts?.cursor) params.set("cursor", opts.cursor)
  if (opts?.status) params.set("status", opts.status)

  return apiRequest(
    `/v1/workflows/${encodeURIComponent(workflowId)}/executions?${params}`,
    "Failed to list executions",
  )
}

// --- Global Executions ---

export interface GlobalExecution extends WorkflowExecution {
  workflowName: string | null
  projectId: string | null
  ownerEmail?: string | null
}

/** List executions across all workflows. */
export function listAllExecutions(
  opts?: { limit?: number; cursor?: string; status?: string; viewAll?: boolean },
): Promise<{ data: GlobalExecution[]; nextCursor?: string }> {
  const params = new URLSearchParams()
  if (opts?.limit) params.set("limit", String(opts.limit))
  if (opts?.cursor) params.set("cursor", opts.cursor)
  if (opts?.status) params.set("status", opts.status)
  if (opts?.viewAll) params.set("viewAll", "true")

  return apiRequest(
    `/v1/executions?${params}`,
    "Failed to list executions",
  )
}

/** Create a workflow trigger (webhook or schedule). */
export async function createWorkflowTrigger(
  workflowId: string,
  type: "webhook" | "schedule",
  config?: Record<string, unknown>,
): Promise<WorkflowTrigger> {
  const json = await apiRequest<{ data: WorkflowTrigger }>(
    `/v1/workflow-triggers`,
    "Failed to create trigger",
    { method: "POST", body: { workflowId, type, config } },
  )
  return json.data
}

/** List triggers for a workflow. */
export async function listWorkflowTriggers(workflowId: string): Promise<WorkflowTrigger[]> {
  const json = await apiRequest<{ data: WorkflowTrigger[] }>(
    `/v1/workflows/${encodeURIComponent(workflowId)}/triggers`,
    "Failed to list triggers",
  )
  return json.data
}

/** Update a workflow trigger. */
export async function updateWorkflowTrigger(
  triggerId: string,
  updates: { isActive?: boolean; config?: Record<string, unknown> },
): Promise<WorkflowTrigger> {
  const json = await apiRequest<{ data: WorkflowTrigger }>(
    `/v1/workflow-triggers/${encodeURIComponent(triggerId)}`,
    "Failed to update trigger",
    { method: "PATCH", body: updates },
  )
  return json.data
}

/** Delete a workflow trigger. */
export function deleteWorkflowTrigger(triggerId: string): Promise<void> {
  return apiRequest(
    `/v1/workflow-triggers/${encodeURIComponent(triggerId)}`,
    "Failed to delete trigger",
    { method: "DELETE" },
  )
}

// ---------------------------------------------------------------------------
// Presentation mode
// ---------------------------------------------------------------------------

/** Enable sharing and get the share token. */
export async function shareWorkflow(workflowId: string): Promise<{ shareToken: string }> {
  const json = await apiRequest<{ shareToken: string }>(
    `/v1/workflows/${encodeURIComponent(workflowId)}/share`,
    "Failed to share workflow",
    { method: "POST" },
  )
  return json
}

/** Disable sharing / revoke share token. */
export function unshareWorkflow(workflowId: string): Promise<void> {
  return apiRequest(
    `/v1/workflows/${encodeURIComponent(workflowId)}/share`,
    "Failed to unshare workflow",
    { method: "DELETE" },
  )
}

/** Get shared workflow data by token. */
export async function getSharedWorkflow(token: string): Promise<{
  workflowId: string
  name: string
  nodes: unknown[]
  edges: unknown[]
  isOwner: boolean
  estimatedCost?: number
  presentationSettings?: PresentationSettings
}> {
  return apiRequest(
    `/v1/present/${encodeURIComponent(token)}`,
    "Failed to load shared workflow",
  )
}

/** Run a shared workflow with input overrides (viewer pays credits). */
export async function runSharedWorkflow(
  token: string,
  inputOverrides?: Record<string, Record<string, unknown>>,
  presentationSettings?: PresentationSettings,
): Promise<{ executionId: string; status: string }> {
  return apiRequest(
    `/v1/present/${encodeURIComponent(token)}/run`,
    "Failed to run shared workflow",
    { method: "POST", body: { inputOverrides, runTarget: presentationSettings?.runTarget, subWorkflowNodeId: presentationSettings?.subWorkflowNodeId } },
  )
}

/** Poll shared workflow execution status. */
export async function getSharedExecutionStatus(
  token: string,
  execId: string,
): Promise<{
  id: string
  status: string
  node_states: Record<string, unknown>
  total_nodes: number
  completed_nodes: number
  failed_nodes: number
  total_credits_used: number
  error_message: string | null
}> {
  return apiRequest(
    `/v1/present/${encodeURIComponent(token)}/status/${encodeURIComponent(execId)}`,
    "Failed to get execution status",
  )
}

// ---------------------------------------------------------------------------
// API Tokens
// ---------------------------------------------------------------------------

export interface ApiToken {
  id: string
  name: string
  prefix: string
  workflowIds: string[]
  rateLimit: number
  isActive: boolean
  lastUsedAt: string | null
  createdAt: string
}

export interface CreateApiTokenResult extends ApiToken {
  /** Plaintext token — shown only once at creation time */
  token: string
}

export async function listApiTokens(): Promise<{ data: ApiToken[] }> {
  return apiRequest("/v1/api-tokens", "Failed to list API tokens")
}

export async function createApiToken(params: {
  name: string
  workflowIds?: string[]
  rateLimit?: number
}): Promise<{ data: CreateApiTokenResult }> {
  return apiRequest("/v1/api-tokens", "Failed to create API token", {
    method: "POST",
    body: params,
  })
}

export async function updateApiToken(
  id: string,
  params: {
    name?: string
    workflowIds?: string[]
    rateLimit?: number
    isActive?: boolean
  },
): Promise<{ data: ApiToken }> {
  return apiRequest(`/v1/api-tokens/${encodeURIComponent(id)}`, "Failed to update API token", {
    method: "PATCH",
    body: params,
  })
}

export async function deleteApiToken(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/v1/api-tokens/${encodeURIComponent(id)}`, "Failed to delete API token", {
    method: "DELETE",
  })
}
