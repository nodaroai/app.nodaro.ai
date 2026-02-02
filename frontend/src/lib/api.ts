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

export async function generateImage(prompt: string, referenceImageUrls?: string[], provider?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { prompt }
  if (referenceImageUrls && referenceImageUrls.length > 0) {
    body.referenceImageUrls = referenceImageUrls
  }
  if (provider) {
    body.provider = provider
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

export async function generateVideo(imageUrl: string, prompt?: string, provider?: string, generateAudio?: boolean): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/generate-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl, prompt, provider, generateAudio }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start video generation")
  }
  return res.json()
}

export async function videoToVideo(videoUrl: string, prompt?: string, provider?: string): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/video-to-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoUrl, prompt, provider }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start video-to-video generation")
  }
  return res.json()
}

export async function textToVideo(prompt: string, provider?: string): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/text-to-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, provider }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start text-to-video generation")
  }
  return res.json()
}

export async function textToSpeech(text: string, voice?: string, provider?: string): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/text-to-speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice, provider }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start text-to-speech generation")
  }
  return res.json()
}

export async function generateScriptApi(prompt: string, sceneCount?: number, tone?: string, targetDuration?: number, provider?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { prompt }
  if (sceneCount !== undefined) body.sceneCount = sceneCount
  if (tone) body.tone = tone
  if (targetDuration !== undefined) body.targetDuration = targetDuration
  if (provider) body.provider = provider
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
): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/combine-videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoUrls, transition, transitionDuration }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start video combination")
  }
  return res.json()
}

export async function mergeVideoAudioApi(videoUrl: string, audioUrl: string, voiceoverVolume?: number, backgroundVolume?: number, keepOriginalAudio?: boolean): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/merge-video-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoUrl, audioUrl, voiceoverVolume, backgroundVolume, keepOriginalAudio }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start merge-video-audio")
  }
  return res.json()
}

export async function extractAudioApi(videoUrl: string, audioFormat?: string, outputSilentVideo?: boolean): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/extract-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoUrl, audioFormat, outputSilentVideo }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start extract-audio")
  }
  return res.json()
}

export async function trimVideoApi(videoUrl: string, startTime: number, endTime?: number): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/trim-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoUrl, startTime, endTime }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start trim-video")
  }
  return res.json()
}

export async function resizeVideoApi(videoUrl: string, targetAspect: string, method: string, padColor?: string): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/resize-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoUrl, targetAspect, method, padColor }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start resize-video")
  }
  return res.json()
}

export async function adjustVolumeApi(audioUrl: string, volume?: number, normalize?: boolean, fadeIn?: number, fadeOut?: number): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/adjust-volume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audioUrl, volume, normalize, fadeIn, fadeOut }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start adjust-volume")
  }
  return res.json()
}

export async function addCaptionsApi(videoUrl: string, text: string, style?: string, position?: string, fontSize?: number, color?: string, backgroundColor?: string): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/add-captions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoUrl, text, style, position, fontSize, color, backgroundColor }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start add-captions")
  }
  return res.json()
}

export async function mixAudioApi(audioUrls: string[]): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/mix-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audioUrls }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start mix-audio")
  }
  return res.json()
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

export async function downloadYouTubeAudio(url: string): Promise<{ url: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/youtube-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to download YouTube audio")
  }
  return res.json()
}

export async function textToAudioApi(prompt: string, provider?: string, duration?: number): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { prompt }
  if (provider) body.provider = provider
  if (duration !== undefined) body.duration = duration
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

export async function generateMusicApi(prompt: string, provider?: string, duration?: number, genre?: string, mood?: string, instrumental?: boolean, lyrics?: string, referenceAudioUrl?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { prompt }
  if (provider) body.provider = provider
  if (duration !== undefined) body.duration = duration
  if (genre) body.genre = genre
  if (mood) body.mood = mood
  if (instrumental !== undefined) body.instrumental = instrumental
  if (lyrics) body.lyrics = lyrics
  if (referenceAudioUrl) body.referenceAudioUrl = referenceAudioUrl
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

export async function extractYouTubeAudioApi(youtubeUrl: string): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/extract-youtube-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ youtubeUrl }),
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

export async function getJobStatus(jobId: string): Promise<{
  id: string
  status: string
  output_data?: { imageUrl?: string; videoUrl?: string; audioUrl?: string; script?: unknown }
  error_message?: string
}> {
  const res = await fetch(`${API_BASE_URL}/v1/jobs/${jobId}`)
  if (!res.ok) throw new Error("Failed to get job status")
  const body = await res.json()
  return body.data
}

// --- Generic helpers ---

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
