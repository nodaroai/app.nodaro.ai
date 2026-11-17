/**
 * A document too large to send inline, as a link on this install's own storage
 * (decided 2026-11-17).
 *
 * The aggregator's chat-completions lane reads a document either inline, as a
 * `data:` URL, or by an https link whose path ends in `.pdf`, which it fetches
 * itself (measured on Gemini 4 Hydrogen 2026-11-17: 1.36 million characters
 * inline, up to 2.2 MB by link). So for a model that declares that shape
 * (`fileWire.kie: "image-url"`) a call's files go inline while they fit
 * {@link KIE_INLINE_FILE_MAX_CHARS} in all, and the rest go by link.
 *
 * Two steps, on the two sides of the hold:
 *  - {@link planLlmFileLinks}, before the job row and the hold: decides each
 *    file's way and refuses what can go neither way. It stores nothing, so a
 *    call refused here, or at its reservation, leaves nothing behind.
 *  - {@link storeLlmFileLinks}, once the job row exists and the hold is taken:
 *    stores each copy the plan asks for in that job's own scratch folder and
 *    returns the blocks with their links. {@link discardLlmFileLinks} deletes
 *    those copies when the call ends, in the caller's `finally`.
 *
 * Every other model, and the vendor's own API, sends the bytes and never comes
 * here.
 */
import { randomUUID } from "node:crypto"
import { isOwnStoredFileUrl } from "./own-storage-url.js"
import { providersCanFetchOwnMedia } from "./own-media-reachability.js"
import { config } from "./config.js"
import { discardJobScratchFile, uploadJobScratchBuffer } from "./job-scratch.js"
import { applyUploadPolicies, hasUploadPolicies } from "./upload-policy.js"
import { LlmFileError, type LlmFileBlock } from "./llm-files.js"

/** What a document's inline `data:` URL starts with. */
const FILE_DATA_URL_PREFIX = "data:application/pdf;base64,"

/** The characters `block` takes sent inline as a `data:` URL. */
export function llmFileInlineChars(block: LlmFileBlock): number {
  return FILE_DATA_URL_PREFIX.length + block.data.length
}

/** The most bytes a document may have and still fit `maxInlineChars` as a `data:` URL. */
export function llmFileInlineMaxBytes(maxInlineChars: number): number {
  return Math.floor((maxInlineChars - FILE_DATA_URL_PREFIX.length) / 4) * 3
}

/**
 * The most characters a call's documents may take inline, as `data:` URLs, in
 * all: 1.3 million, under the 1.36 million one inline file was read at
 * (2026-11-17) and under the part's refusal edge
 * (`KIE_INLINE_DATA_URL_MAX_CHARS`). About 0.93 MB of PDF.
 */
export const KIE_INLINE_FILE_MAX_CHARS = 1_300_000

/** How one document reaches the lane: its bytes inline, the caller's own stored link, or a copy to store. */
export type LlmFileLinkStep =
  | { readonly block: LlmFileBlock; readonly via: "inline" }
  | { readonly block: LlmFileBlock; readonly via: "own-link"; readonly url: string }
  | { readonly block: LlmFileBlock; readonly via: "copy" }

/**
 * Each of `blocks` (from `prepareLlmFiles`, for `urls`, same order) with the
 * way it reaches a lane that reads documents inline only up to
 * `maxInlineChars` IN ALL: in order, a file goes inline while the call's
 * inline files still fit that many characters, and by link once they would
 * not. The link is the caller's own when it is already a file on this
 * install's storage whose https path ends in `.pdf` (the editor's Upload PDF);
 * otherwise a copy of the bytes that were read and counted, to be stored by
 * {@link storeLlmFileLinks} (the link the caller gave is never sent: the model
 * must read the bytes the hold was sized from).
 *
 * Stores nothing. Refuses with `LlmFileError`:
 *  - `file_too_large` where a link cannot be given: the provider cannot fetch
 *    this install's storage (`providersCanFetchOwnMedia`), or that storage is
 *    not served over https (the aggregator reads a document by an https link);
 *  - `upload_blocked` when the deployment's upload policy refuses a copy.
 */
export async function planLlmFileLinks(
  urls: readonly string[],
  blocks: readonly LlmFileBlock[],
  opts: { maxInlineChars?: number; owner?: string } = {},
): Promise<LlmFileLinkStep[]> {
  const max = opts.maxInlineChars ?? KIE_INLINE_FILE_MAX_CHARS
  const plan: LlmFileLinkStep[] = []
  let inline = 0
  for (const [i, block] of blocks.entries()) {
    const chars = llmFileInlineChars(block)
    if (inline + chars <= max) {
      inline += chars
      plan.push({ block, via: "inline" })
      continue
    }
    if (!providersCanFetchOwnMedia()) throw tooLargeHere(max)
    const url = urls[i]
    if (isOwnStoredPdfLink(url)) {
      plan.push({ block, via: "own-link", url })
      continue
    }
    if (!ownStorageServesHttps()) throw tooLargeHere(max)
    await askUploadPolicy(block, opts.owner)
    plan.push({ block, via: "copy" })
  }
  return plan
}

function tooLargeHere(maxInlineChars: number): LlmFileError {
  const mb = (llmFileInlineMaxBytes(maxInlineChars) / (1024 * 1024)).toFixed(1)
  return new LlmFileError("file_too_large", `Files may total up to ${mb} MB for this model on this install.`)
}

/** Does `plan` ask for a stored copy? */
export function llmFileLinksNeedStoring(plan: readonly LlmFileLinkStep[]): boolean {
  return plan.some((step) => step.via === "copy")
}

/**
 * The blocks of `plan`, each file that goes by link carrying its `hostedUrl`.
 * A copy is stored in `jobId`'s scratch folder
 * (`tmp/provider-input/<jobId>/llm-file-<uuid>-<nonce>.pdf`); `stored` gains
 * each link as it is written, so the caller's `finally` can delete them
 * ({@link discardLlmFileLinks}) whatever happens after.
 */
export async function storeLlmFileLinks(plan: readonly LlmFileLinkStep[], jobId: string, stored: string[] = []): Promise<LlmFileBlock[]> {
  const out: LlmFileBlock[] = []
  for (const step of plan) {
    if (step.via === "inline") out.push(step.block)
    else if (step.via === "own-link") out.push({ ...step.block, hostedUrl: step.url })
    else {
      const url = await uploadJobScratchBuffer(Buffer.from(step.block.data, "base64"), `llm-file-${randomUUID()}`, "pdf", step.block.mediaType, jobId)
      stored.push(url)
      if (!isOwnStoredPdfLink(url)) throw new Error("llm-file-link: the stored copy of a document is not an https .pdf link on this install's storage")
      out.push({ ...step.block, hostedUrl: url })
    }
  }
  return out
}

/** Delete the copies {@link storeLlmFileLinks} stored for `jobId`. Never throws. */
export async function discardLlmFileLinks(stored: readonly string[], jobId: string): Promise<void> {
  for (const url of stored) await discardJobScratchFile(url, jobId)
}

/** Is `url` a file on this install's storage, addressed plainly over https, whose path ends in `.pdf`? */
function isOwnStoredPdfLink(url: string | undefined): url is string {
  if (!url || !isOwnStoredFileUrl(url)) return false
  const parsed = new URL(url)
  return parsed.protocol === "https:" && !parsed.search && !parsed.hash && /\.pdf$/i.test(parsed.pathname)
}

/** Is this install's storage served over https (`R2_PUBLIC_URL`)? */
function ownStorageServesHttps(): boolean {
  try {
    return new URL(config.R2_PUBLIC_URL ?? "").protocol === "https:"
  } catch {
    return false
  }
}

/** The deployment's upload policy, asked of a copy before it is planned: reads the bytes, stores nothing. */
async function askUploadPolicy(block: LlmFileBlock, owner: string | undefined): Promise<void> {
  if (!hasUploadPolicies()) return
  const bytes = Buffer.from(block.data, "base64")
  const decision = await applyUploadPolicies({
    kind: "other",
    lane: "media-import",
    mime: block.mediaType,
    sizeBytes: bytes.length,
    ...(owner ? { userId: owner } : {}),
    filename: block.filename,
    buffer: bytes,
  })
  if (!decision.allow) throw new LlmFileError("upload_blocked", decision.reason || "This upload is not allowed on this deployment")
}
