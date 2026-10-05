import { useBillingSurface } from "@/hooks/use-billing-surface"

/**
 * Track A: is this a deployment where one account pays for everyone?
 *
 * On such a deployment an admin is NOT a billing role (spec §9.2): the Nodaro
 * credit columns are the deployment's own money, the server withholds them, and
 * the top-up controls have no meaning because no admin can grant anything —
 * only the billing account can, on its own page. What an admin sees instead is
 * each user's deployment allowance, read-only.
 *
 * False on mainline (and while the surface loads), so every branch below is the
 * page exactly as it is today.
 */
export function useDeploymentPayerMode(): { readonly payerMode: boolean; readonly ready: boolean } {
  const { surface, isLoading } = useBillingSurface()
  return { payerMode: surface.deploymentPayer === true, ready: !isLoading }
}

/**
 * A figure the server sent in display units, or an em dash.
 *
 * `null`/`undefined` mean "not available" — enforcement is not on yet, or the
 * read failed — and must NOT collapse to 0, which on an allowance means
 * "exhausted, this person cannot generate".
 */
export function unitsOrDash(v: number | null | undefined): string {
  return v == null ? "—" : v.toLocaleString()
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB"
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB"
}
