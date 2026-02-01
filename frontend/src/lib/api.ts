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

export async function generateImage(prompt: string, referenceImageUrl?: string): Promise<{ jobId: string }> {
  const body: Record<string, string> = { prompt }
  if (referenceImageUrl) {
    body.referenceImageUrl = referenceImageUrl
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

export async function generateVideo(imageUrl: string, prompt?: string): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/generate-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl, prompt }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start video generation")
  }
  return res.json()
}

export async function videoToVideo(videoUrl: string, prompt?: string): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/video-to-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoUrl, prompt }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Failed to start video-to-video generation")
  }
  return res.json()
}

export async function getJobStatus(jobId: string): Promise<{
  id: string
  status: string
  output_data?: { imageUrl?: string; videoUrl?: string }
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
