import { getAuthHeaders } from "@/lib/api"
import type {
  ClusterAxis,
  ClustersResponse,
  FreeGrantRow,
  RelatedResponse,
} from "./types"
import { PAGE_LIMIT } from "./types"

/**
 * Plain `fetch` + `getAuthHeaders()`, the same shape the rest of the admin
 * panel uses. Every call surfaces the server's own message when it has one so
 * an operator sees the refusal, not a generic failure.
 */

async function errorFrom(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  return new Error(body?.error?.message ?? fallback)
}

export async function fetchWithheld(
  offset: number,
): Promise<{ data: FreeGrantRow[]; total: number }> {
  const res = await fetch(
    `/v1/admin/free-grants?state=withheld&limit=${PAGE_LIMIT}&offset=${offset}`,
    { headers: await getAuthHeaders() },
  )
  if (!res.ok) throw await errorFrom(res, "Failed to load withheld grants")
  return (await res.json()) as { data: FreeGrantRow[]; total: number }
}

export async function restoreGrant(userId: string): Promise<void> {
  const res = await fetch(`/v1/admin/free-grants/${encodeURIComponent(userId)}/activate`, {
    method: "POST",
    headers: await getAuthHeaders(),
  })
  if (!res.ok) throw await errorFrom(res, "Failed to restore the grant")
}

export async function fetchClusters(
  axis: ClusterAxis,
  offset: number,
): Promise<ClustersResponse> {
  const res = await fetch(
    `/v1/admin/free-grants/clusters?axis=${axis}&limit=${PAGE_LIMIT}&offset=${offset}`,
    { headers: await getAuthHeaders() },
  )
  if (!res.ok) throw await errorFrom(res, "Failed to load shared signals")
  return (await res.json()) as ClustersResponse
}

export async function fetchRelated(userId: string): Promise<RelatedResponse["data"]> {
  const res = await fetch(`/v1/admin/free-grants/${encodeURIComponent(userId)}/related`, {
    headers: await getAuthHeaders(),
  })
  if (!res.ok) throw await errorFrom(res, "Failed to load related accounts")
  return ((await res.json()) as RelatedResponse).data
}
