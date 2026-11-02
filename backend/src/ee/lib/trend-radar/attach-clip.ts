/**
 * After an approval: the candidate's top post, downloaded through the same
 * path the editor's Video URL node uses (as the approving admin, into their
 * library), copied into the new draft trend's storage as its source clip,
 * and saved on the draft — so the trend page opens with the clip in place.
 *
 * Best-effort and never throws: a post that cannot be downloaded (a private
 * post, a clip outside the 4–30 s a trend takes, a provider refusal) leaves
 * the draft without a source, exactly as a hand-made one starts, and the
 * candidate's history says why. The admin uploads the clip by hand then.
 */
import { downloadVideoForRun } from "../../../lib/video-download.js"
import { isAllowedSocialVideoUrl } from "../../../lib/url-validator.js"
import { TREND_SOURCE_SECONDS, TrendMediaError, copyToTrendStorage } from "../trends/media.js"
import { getDraftState, saveDraft } from "../trends/store.js"
import type { TrendVersionData } from "../trends/types.js"
import { updateCandidate } from "./store.js"
import type { TrendCandidatePost } from "./types.js"

/** The longest one clip's download may take before the draft is left without it. */
export const ATTACH_CLIP_MAX_MS = 15 * 60 * 1000

export interface AttachClipDeps {
  download: (url: string, userId: string) => Promise<{ videoUrl: string }>
  copy: (trendId: string, videoUrl: string) => Promise<{ url: string; durationSec?: number; width?: number; height?: number; display?: TrendVersionData["source"] extends infer S ? (S extends { display?: infer D } ? D : never) : never; sha256?: string }>
  readDraft: (trendId: string) => Promise<{ data: TrendVersionData; revision: string } | null>
  saveDraft: (trendId: string, data: TrendVersionData, expectedRevision: string) => Promise<unknown>
  note: (candidateId: string, event: string, detail: string | null) => Promise<unknown>
}

const DEFAULT_DEPS: AttachClipDeps = {
  download: (url, userId) => downloadVideoForRun({ url, userId, maxHeight: 1080, maxMs: ATTACH_CLIP_MAX_MS }),
  copy: (trendId, videoUrl) => copyToTrendStorage(trendId, videoUrl, "video", { durationSec: TREND_SOURCE_SECONDS, display: true }),
  readDraft: async (trendId) => {
    const state = await getDraftState(trendId)
    return state ? { data: state.data, revision: state.revision } : null
  },
  saveDraft: (trendId, data, expectedRevision) => saveDraft(trendId, data, { expectedRevision }),
  note: (candidateId, event, detail) => updateCandidate(candidateId, { event: { event, detail } }),
}

export interface AttachClipInput {
  trendId: string
  candidateId: string
  post: Pick<TrendCandidatePost, "url" | "author" | "platform">
  userId: string
}

export type AttachClipResult = { ok: true; durationSec: number } | { ok: false; why: string }

function reason(e: unknown): string {
  if (e instanceof TrendMediaError) return `${e.code}: ${e.message}`
  return e instanceof Error ? e.message : String(e)
}

/** Downloads the post, stores it as the draft's source and notes the outcome on the candidate. */
export async function attachTopPostClip(input: AttachClipInput, deps: AttachClipDeps = DEFAULT_DEPS): Promise<AttachClipResult> {
  const fail = async (why: string): Promise<AttachClipResult> => {
    await deps.note(input.candidateId, "source_failed", why.slice(0, 300)).catch(() => undefined)
    return { ok: false, why }
  }
  if (!isAllowedSocialVideoUrl(input.post.url)) return fail("the top post's link is not one the downloader reads")
  try {
    const { videoUrl } = await deps.download(input.post.url, input.userId)
    const stored = await deps.copy(input.trendId, videoUrl)
    if (typeof stored.durationSec !== "number") return fail("the clip's length could not be read")
    const draft = await deps.readDraft(input.trendId)
    if (!draft) return fail("the draft trend is gone")
    if (draft.data.source) return fail("the draft already has a source clip")
    const source: NonNullable<TrendVersionData["source"]> = {
      videoUrl: stored.url,
      durationSec: stored.durationSec,
      ...(stored.width !== undefined ? { width: stored.width } : {}),
      ...(stored.height !== undefined ? { height: stored.height } : {}),
      ...(stored.display ? { display: stored.display } : {}),
      ...(stored.sha256 ? { sha256: stored.sha256 } : {}),
    }
    await deps.saveDraft(input.trendId, { ...draft.data, source }, draft.revision)
    await deps.note(input.candidateId, "source_attached", `${input.post.platform} post by ${input.post.author}, ${stored.durationSec}s`).catch(() => undefined)
    return { ok: true, durationSec: stored.durationSec }
  } catch (e) {
    return fail(reason(e))
  }
}
