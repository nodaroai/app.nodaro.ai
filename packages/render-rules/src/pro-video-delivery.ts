/** Public media fields of a Pro result. Forward only the ordered, playable copies. */
export interface DeliveredVideoClip { readonly segment: number; readonly url: string }

export function deliveredVideoClips(output: unknown): readonly DeliveredVideoClip[] {
  const raw = (output as { unassembledClips?: unknown } | null)?.unassembledClips
  if (!Array.isArray(raw)) return []
  const clips: DeliveredVideoClip[] = []
  for (const [i, part] of raw.entries()) {
    if (part?.segment !== i + 1 || typeof part.url !== "string" || !/^https?:\/\//i.test(part.url)) return []
    clips.push({ segment: part.segment, url: part.url })
  }
  return clips
}

export interface VideoRepairSource { jobId: string; first: string }
export interface VideoRepair extends VideoRepairSource { url: string }

export function videoRepairSource(jobId: unknown, url: unknown, output: unknown): VideoRepairSource | undefined {
  const first = deliveredVideoClips(output)[0]?.url
  if (typeof jobId === "string" && jobId && first && url === first) return { jobId, first }
}

export function replacementVideoUrl(jobId: unknown, url: unknown, repairs: readonly VideoRepair[]): string | undefined {
  return repairs.find(repair => repair.jobId === jobId && repair.first === url)?.url
}

type Fields = Record<string, unknown>

export function savedVideoSources(data: Fields): VideoRepairSource[] {
  return Array.isArray(data.generatedResults) ? data.generatedResults.flatMap(take =>
    take ? videoRepairSource(take.jobId, take.url, take) ?? [] : []) : []
}

/** Update only the still-filed first clip from this job. Preserve history,
 * selection and edits; replace the metadata measured from the old file. */
export function repairedCanvasTake(data: Fields, repairs: readonly VideoRepair[]): Fields | undefined {
  const previous = data.generatedResults
  if (!Array.isArray(previous)) return
  let changed = false
  const changedTakes: VideoRepair[] = []
  const rows = previous.map(take => {
    const url = take && replacementVideoUrl(take.jobId, take.url, repairs)
    if (!url || !videoRepairSource(take.jobId, take.url, take)) return take
    changed = true
    changedTakes.push({ jobId: take.jobId, first: take.url, url })
    const { duration: _duration, width: _width, height: _height, ...rest } = take
    return { ...rest, url }
  })
  if (!changed) return
  const index = typeof data.activeResultIndex === "number" ? data.activeResultIndex : 0
  const primary = previous[index]
  const list = Array.isArray(data.__listResults) ? data.__listResults : undefined
  const stamps = Array.isArray(data.__listResultStamps) ? data.__listResultStamps : undefined
  const updatedList = list?.map((url, i) => {
    if (stamps) return replacementVideoUrl(stamps[i]?.jobId, url, changedTakes) ?? url
    // Rows saved before stamps existed can be paired only when both sides
    // name this URL exactly once. A repeated address might be another job's.
    if (list.indexOf(url) !== list.lastIndexOf(url)) return url
    const matching = previous.filter(take => take?.url === url)
    return matching.length === 1 ? replacementVideoUrl(matching[0].jobId, url, changedTakes) ?? url : url
  })
  return {
    generatedResults: rows,
    ...(primary && rows[index] !== primary && data.generatedVideoUrl === primary.url ? { generatedVideoUrl: rows[index].url } : {}),
    ...(updatedList?.some((url, i) => url !== list?.[i]) ? { __listResults: updatedList } : {}),
  }
}
