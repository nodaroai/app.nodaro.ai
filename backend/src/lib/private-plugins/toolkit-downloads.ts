/**
 * A private plugin's own downloads of a link: the plugin toolkit's
 * `downloadYouTubeVideo` and `downloadSocialPostVideo`. This is the import
 * gate's engine for the plugin lane, kept apart from the toolkit so the
 * toolkit hands a plugin no runner that skips the gate
 * (`import-gate-totality.test.ts` holds this file to both halves).
 *
 * The link is first held to the runner's own test, so a link the runner would
 * refuse never uses up the person's confirmation. Then the gate
 * (`lib/import-gate.ts`) is read and the confirmation spent for the running
 * job's owner, the job being the request, so a retry of the same job spends
 * the same confirmation again. The confirmation is the one the plugin passes,
 * made by the person for that link. A plugin's job carries no way in (its
 * host-owned keys are dropped), so a standing authorization never covers this
 * lane. Outside any job there is no account: only the site's policy and the
 * deployment's rule decide, and a confirmation passed there is ignored, since
 * it could be nobody's.
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
