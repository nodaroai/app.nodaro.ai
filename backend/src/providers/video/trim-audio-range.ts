/**
 * Why Trim Audio cannot cut a range, or undefined when it can: an end at or
 * before its start (each is optional, and either alone is a range). It fails
 * every format, so the route refuses it before a job or a hold is made, and
 * `trimAudio` refuses it again (as a deterministic error, before anything is
 * downloaded) for a run that reached the worker some other way. Pure; no
 * imports, so the route loads nothing of the trim itself.
 */
export function trimRangeRefusal(startTime?: number, endTime?: number): string | undefined {
  return startTime != null && endTime != null && !(endTime > startTime) ? "The end time must be after the start time." : undefined
}
