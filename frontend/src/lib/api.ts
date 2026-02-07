const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  meta?: {
    total: number
    page: number
    limit: number
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      return {
        success: false,
        error: errorData?.error?.message || `Request failed with status ${response.status}`,
      }
    }

    const data = await response.json()
    return { success: true, data }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    }
  }
}

// --- Generate Image (E2E spike) ---

export async function generateImage(prompt: string, referenceImageUrls?: string[], provider?: string, characterDescriptions?: string[], aspectRatio?: string, userId?: string): Promise<{ jobId: string }> {
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
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/generate-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start image generation")
  }
  return res.json()
}

// --- Edit Image (KIE.ai only) ---

export async function editImage(
  imageUrl: string,
  prompt?: string,
  provider?: "recraft-upscale" | "recraft-remove-bg" | "nano-banana-edit",
  userId?: string
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
  const res = await fetch(`${API_BASE_URL}/v1/edit-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start image editing")
  }
  return res.json()
}

// --- Image to Image (transform image with prompt) ---

export async function imageToImage(
  imageUrl: string,
  prompt: string,
  provider?: "nano-banana" | "nano-banana-pro" | "flux-i2i" | "flux-pro-i2i" | "grok-i2i" | "gpt-image-i2i",
  userId?: string,
  referenceImageUrls?: string[]
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
  const res = await fetch(`${API_BASE_URL}/v1/image-to-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start image transformation")
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start character generation")
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start character asset generation")
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to save character")
  }
  return res.json()
}

export async function deleteCharacter(characterId: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE_URL}/v1/characters/${encodeURIComponent(characterId)}`, {
    method: "DELETE",
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to delete character")
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
  const url = new URL(`${API_BASE_URL}/v1/characters`)
  if (projectId) {
    url.searchParams.set("projectId", projectId)
  }
  if (userId) {
    url.searchParams.set("userId", userId)
  }
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to fetch characters")
  }
  return res.json()
}

export async function getCharacterById(characterId: string): Promise<DbCharacter | null> {
  const res = await fetch(`${API_BASE_URL}/v1/characters/${encodeURIComponent(characterId)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  })
  if (res.status === 404) {
    return null
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to fetch character")
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start object generation")
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start object asset generation")
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to save object")
  }
  return res.json()
}

export async function deleteObject(objectId: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE_URL}/v1/objects/${encodeURIComponent(objectId)}`, {
    method: "DELETE",
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to delete object")
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
  const url = new URL(`${API_BASE_URL}/v1/objects`)
  if (projectId) {
    url.searchParams.set("projectId", projectId)
  }
  if (userId) {
    url.searchParams.set("userId", userId)
  }
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to fetch objects")
  }
  return res.json()
}

export async function getObjectById(objectId: string): Promise<DbObject | null> {
  const res = await fetch(`${API_BASE_URL}/v1/objects/${encodeURIComponent(objectId)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  })
  if (res.status === 404) {
    return null
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to fetch object")
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start location generation")
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start location asset generation")
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to save location")
  }
  return res.json()
}

export async function deleteLocation(locationId: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE_URL}/v1/locations/${encodeURIComponent(locationId)}`, {
    method: "DELETE",
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to delete location")
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
  const url = new URL(`${API_BASE_URL}/v1/locations`)
  if (projectId) {
    url.searchParams.set("projectId", projectId)
  }
  if (userId) {
    url.searchParams.set("userId", userId)
  }
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to fetch locations")
  }
  return res.json()
}

export async function getLocationById(locationId: string): Promise<DbLocation | null> {
  const res = await fetch(`${API_BASE_URL}/v1/locations/${encodeURIComponent(locationId)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  })
  if (res.status === 404) {
    return null
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to fetch location")
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to split image")
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
    console.log(`[generateVideo] Sending request with provider: "${opts.provider ?? 'undefined (will default to minimax)'}"`)
    body = {
      imageUrl: opts.startFrameUrl,  // Backend still expects imageUrl for backward compat
      endFrameUrl: opts.endFrameUrl,
      audioUrl: opts.audioUrl,
      prompt: opts.prompt,
      provider: opts.provider,
      generateAudio: opts.generateAudio,
      duration: opts.duration,
    }
    if (opts.userId) {
      body.userId = opts.userId
    }
  } else {
    // Legacy signature for backward compatibility
    console.log(`[generateVideo] Sending request with provider: "${provider ?? 'undefined (will default to minimax)'}"`)
    body = { imageUrl: imageUrlOrOptions, prompt, provider, generateAudio, duration }
    if (userId) {
      body.userId = userId
    }
  }

  const res = await fetch(`${API_BASE_URL}/v1/generate-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start video generation")
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start video-to-video generation")
  }
  return res.json()
}

export async function textToVideo(prompt: string, provider?: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { prompt, provider }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/text-to-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start text-to-video generation")
  }
  return res.json()
}

export async function textToSpeech(text: string, voice?: string, provider?: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { text, voice, provider }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/text-to-speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start text-to-speech generation")
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start script generation")
  }
  return res.json()
}

export async function combineVideos(
  videoUrls: string[],
  transition: "cut" | "fade" | "dissolve" = "cut",
  transitionDuration: number = 0.5,
  userId?: string,
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrls, transition, transitionDuration }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/combine-videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start video combination")
  }
  return res.json()
}

export async function mergeVideoAudioApi(videoUrl: string, audioUrl: string, voiceoverVolume?: number, backgroundVolume?: number, keepOriginalAudio?: boolean, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, audioUrl, voiceoverVolume, backgroundVolume, keepOriginalAudio }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/merge-video-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start merge-video-audio")
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start extract-audio")
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start trim-video")
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start resize-video")
  }
  return res.json()
}

export async function adjustVolumeApi(audioUrl: string, volume?: number, normalize?: boolean, fadeIn?: number, fadeOut?: number, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { audioUrl, volume, normalize, fadeIn, fadeOut }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/adjust-volume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start adjust-volume")
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start add-captions")
  }
  return res.json()
}

export async function mixAudioApi(audioUrls: string[], userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { audioUrls }
  if (userId) {
    body.userId = userId
  }
  const res = await fetch(`${API_BASE_URL}/v1/mix-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start mix-audio")
  }
  return res.json()
}

export function getImageProxyUrl(url: string): string {
  return `${API_BASE_URL}/v1/image-proxy?url=${encodeURIComponent(url)}`
}

export async function uploadImage(file: File | Blob): Promise<{ url: string }> {
  const formData = new FormData()
  formData.append("file", file, file instanceof File ? file.name : "crop.png")
  const res = await fetch(`${API_BASE_URL}/v1/upload/image`, {
    method: "POST",
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to upload image")
  }
  return res.json()
}

export async function uploadAudio(file: File): Promise<{ url: string }> {
  const formData = new FormData()
  formData.append("file", file)
  const res = await fetch(`${API_BASE_URL}/v1/upload/audio`, {
    method: "POST",
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to upload audio file")
  }
  return res.json()
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

  const res = await fetch(`${API_BASE_URL}/v1/upload`, {
    method: "POST",
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    const message = err?.error?.message ?? "Upload failed"
    throw new Error(message)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function downloadYouTubeAudio(url: string): Promise<{ url: string; thumbnailUrl: string | null }> {
  const res = await fetch(`${API_BASE_URL}/v1/youtube-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to extract audio from video")
  }
  return res.json()
}

export async function textToAudioApi(prompt: string, provider?: string, duration?: number, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { prompt }
  if (provider) body.provider = provider
  if (duration !== undefined) body.duration = duration
  if (userId) body.userId = userId
  const res = await fetch(`${API_BASE_URL}/v1/text-to-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start audio generation")
  }
  return res.json()
}

export async function transcribeApi(audioUrl: string, provider?: string, language?: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { audioUrl }
  if (provider) body.provider = provider
  if (language) body.language = language
  if (userId) body.userId = userId
  const res = await fetch(`${API_BASE_URL}/v1/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start transcription")
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start lip sync generation")
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start music generation")
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start YouTube audio extraction")
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
}

export async function getJobStatus(jobId: string): Promise<Job> {
  const res = await fetch(`${API_BASE_URL}/v1/jobs/${jobId}`)
  if (!res.ok) throw new Error("Failed to get job status")
  const body = await res.json()
  return body.data
}

export async function getJobs(userId?: string, cursor?: string): Promise<{
  data: Job[]
  next: string | null
  previous: string | null
}> {
  const params = new URLSearchParams()
  if (userId) params.set("userId", userId)
  if (cursor) params.set("cursor", cursor)
  const url = params.toString() ? `/v1/jobs?${params.toString()}` : "/v1/jobs"
  const res = await fetch(`${API_BASE_URL}${url}`)
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to fetch jobs")
  }
  return res.json()
}

export async function deleteJob(jobId: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE_URL}/v1/jobs/${jobId}`, {
    method: "DELETE",
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to delete job")
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
    res = await fetch(`${API_BASE_URL}/v1/jobs/batch-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobIds }),
    })
  } catch {
    // Network error (backend not running) - return empty silently
    return []
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to fetch batch job status")
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

// --- Replicate Predictions API ---

export interface ReplicatePrediction {
  id: string
  model: string
  version: string
  input: Record<string, unknown>
  output: unknown
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled"
  error: string | null
  logs: string | null
  metrics: {
    predict_time?: number
    total_time?: number
  }
  created_at: string
  started_at: string | null
  completed_at: string | null
  urls: {
    get: string
    cancel: string
  }
  source: string
}

export async function getPredictions(cursor?: string): Promise<{
  data: ReplicatePrediction[]
  next: string | null
  previous: string | null
}> {
  const url = cursor ? `/v1/predictions?cursor=${encodeURIComponent(cursor)}` : "/v1/predictions"
  const res = await fetch(`${API_BASE_URL}${url}`)
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to fetch predictions")
  }
  return res.json()
}

export async function getPrediction(id: string): Promise<{ data: ReplicatePrediction }> {
  const res = await fetch(`${API_BASE_URL}/v1/predictions/${id}`)
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to fetch prediction")
  }
  return res.json()
}

export async function cancelPrediction(id: string): Promise<{ data: ReplicatePrediction }> {
  const res = await fetch(`${API_BASE_URL}/v1/predictions/${id}/cancel`, {
    method: "POST",
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to cancel prediction")
  }
  return res.json()
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start motion transfer")
  }
  return res.json()
}

export async function videoUpscaleApi(
  videoUrl: string,
  upscaleFactor?: "1" | "2" | "4",
  userId?: string
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl }
  if (upscaleFactor) body.upscaleFactor = upscaleFactor
  if (userId) body.userId = userId
  const res = await fetch(`${API_BASE_URL}/v1/video-upscale`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start video upscale")
  }
  return res.json()
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

  const res = await fetch(`${API_BASE_URL}/v1/stats?${params.toString()}`)
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to fetch stats")
  }
  return res.json()
}

// Cancel job functions
export async function cancelJob(jobId: string, userId?: string): Promise<{ success: boolean; cancelled: number }> {
  const res = await fetch(`${API_BASE_URL}/v1/jobs/${jobId}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to cancel job")
  }
  return res.json()
}

export async function cancelAllJobs(userId: string): Promise<{ success: boolean; cancelled: number }> {
  const res = await fetch(`${API_BASE_URL}/v1/jobs/cancel-all`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to cancel jobs")
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
}): Promise<{ data: LibraryAsset[]; nextCursor: string | null }> {
  const qs = new URLSearchParams({ userId: params.userId })
  if (params.type && params.type !== "all") qs.set("type", params.type)
  if (params.search) qs.set("search", params.search)
  if (params.limit) qs.set("limit", String(params.limit))
  if (params.cursor) qs.set("cursor", params.cursor)

  const res = await fetch(`${API_BASE_URL}/v1/library?${qs.toString()}`)
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to fetch library assets")
  }
  return res.json()
}

export async function deleteLibraryAsset(
  assetId: string,
  userId: string,
): Promise<{ success: boolean }> {
  const res = await fetch(
    `${API_BASE_URL}/v1/library/${assetId}?userId=${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  )
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to delete asset")
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    },
  )
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to promote asset")
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    },
  )
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to demote asset")
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to save to library")
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
  const res = await fetch(`${API_BASE_URL}/v1/user/credits?userId=${encodeURIComponent(userId)}`)
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to get credits")
  }
  return res.json()
}

export async function checkCredits(userId: string, model: string): Promise<{ data: CreditCheckResult }> {
  const res = await fetch(`${API_BASE_URL}/v1/credits/check?userId=${encodeURIComponent(userId)}&model=${encodeURIComponent(model)}`)
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to check credits")
  }
  return res.json()
}

export async function getModelCreditCost(model: string): Promise<{ data: { model: string; creditCost: number } }> {
  const res = await fetch(`${API_BASE_URL}/v1/credits/model-cost?model=${encodeURIComponent(model)}`)
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to get model cost")
  }
  return res.json()
}

export const api = {
  get: <T>(path: string, headers?: HeadersInit) =>
    request<T>(path, { method: 'GET', headers }),

  post: <T>(path: string, body?: unknown, headers?: HeadersInit) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body), headers }),

  patch: <T>(path: string, body?: unknown, headers?: HeadersInit) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body), headers }),

  delete: <T>(path: string, headers?: HeadersInit) =>
    request<T>(path, { method: 'DELETE', headers }),
}
