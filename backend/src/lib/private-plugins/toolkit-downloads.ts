/**
 * A private plugin's own downloads of a link: the plugin toolkit's
 * `downloadYouTubeVideo` and `downloadSocialPostVideo`. This is the import
 * gate's engine for the plugin lane, kept apart from the toolkit so the
 * toolkit hands a plugin no runner that skips the gate
 * (`import-gate-totality.test.ts` holds this file to both halves).
 *
 * The link is first held to the runner's own test. Then the gate
 * (`lib/import-gate.ts`) is asked for the running job's owner: the account's
 * measures and the site's policy. The plugin lane is exempt from the
 * declaration (decided 2026-11-05), so the gate never reads or spends a
 * confirmation here; the `confirmationId` a plugin passes is accepted for an
 * older contract and ignored. Outside any job there is no account: the
 * site's policy alone decides.
 */
import { downloadYouTubeVideo, YtUrlNotAllowedError } from "../../providers/video/youtube-video.js"
import { downloadSocialPostVideo, socialPostOf } from "../../providers/video/social-post-video.js"
import { isAllowedVideoImportUrl } from "../url-validator.js"
import { getJobId, getJobUserId } from "../job-cancellation.js"
import {
  requireAccountlessImportAllowed,
  requireImportAllowed,
  spendImportConfirmation,
  type ImportRights,
} from "../import-gate.js"

async function admitPluginImport(url: string, confirmationId: string | undefined): Promise<void> {
  const jobId = getJobId()
  if (jobId === undefined) {
    await requireAccountlessImportAllowed(url, "plugin")
    return
  }
  // In a job whose owner could not be read the account is "", which the gate
  // refuses outright (ImportOwnerUnknownError): never a pass.
  const rights: ImportRights = {
    userId: getJobUserId() ?? "",
    confirmationId: confirmationId ?? null,
    lane: "plugin",
    requestId: jobId,
    via: null,
  }
  await requireImportAllowed(url, rights)
  await spendImportConfirmation(url, rights)
}

/**
 * The toolkit's plain download. The runner never receives the plugin's
 * `hardening` (raw yt-dlp arguments among them) or the confirmation.
 */
export async function pluginDownloadYouTubeVideo({
  hardening: _internal,
  confirmationId,
  ...opts
}: Parameters<typeof downloadYouTubeVideo>[0] & { confirmationId?: string }): Promise<void> {
  if (!isAllowedVideoImportUrl(opts.url)) throw new YtUrlNotAllowedError(`host not allowed: ${opts.url}`)
  await admitPluginImport(opts.url, confirmationId)
  return downloadYouTubeVideo(opts)
}

/** The toolkit's hardened download of one post's video. */
export async function pluginDownloadSocialPostVideo({
  confirmationId,
  ...opts
}: Parameters<typeof downloadSocialPostVideo>[0] & { confirmationId?: string }): Promise<void> {
  if (!socialPostOf(opts.url)) throw new YtUrlNotAllowedError("not a social post this lane reads")
  await admitPluginImport(opts.url, confirmationId)
  return downloadSocialPostVideo(opts)
}
