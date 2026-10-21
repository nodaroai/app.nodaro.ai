// Getting a picture or clip into a trend.
//
// A local file goes through the app's own upload (`uploadFile`, `/v1/upload`,
// the same one nodes and the library use) for an https URL. A trend's source
// clip and fixed reference pictures are then COPIED into the trend's own
// storage (`POST /v1/admin/trends/:id/media`), so a trend never points at an
// admin's library file. Test-run pictures are plain uploads: a run is the
// admin's own job, like any other.

import { getCurrentUserId, uploadFile } from "@/lib/api"

export async function uploadLocalFile(file: File): Promise<string> {
  return (await uploadFile(file, await getCurrentUserId())).url
}

/** A pasted address worth sending (the server checks the rest). */
export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s.trim())
    return u.protocol === "https:" || u.protocol === "http:"
  } catch {
    return false
  }
}
