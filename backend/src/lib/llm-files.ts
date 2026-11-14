/**
 * Documents an LLM call reads (`referenceFileUrls`, decided 2026-11-13): each
 * link fetched ONCE, before any job row or hold, checked, its pages counted,
 * and turned into the inline block the request carries (`file_base64`).
 *
 * Why every check is here, before the hold:
 *  - the hold is sized by the pages (`llmRequestInputBound`), so a file whose
 *    pages cannot be counted is refused rather than guessed; they are counted
 *    by a real PDF parser in an isolated, bounded worker (`./pdf-pages.ts`),
 *    never on this thread;
 *  - the bytes are sent inline (the aggregator's OpenAI-shaped lanes failed
 *    media sent as links), so they are capped against the request's inline
 *    budget, which the images of the same call share
 *    (`KIE_INLINE_REQUEST_BUDGET_CHARS`, `inlineImagesForKie`);
 *  - a refused file is a `400` naming it, never a failed paid call.
 *
 * Only PDF: the aggregator refused a text file and a Word file sent the same
 * way (probed 2026-11-13). The fetch is the platform's SSRF-safe, byte-capped
 * one (`boundedPublicChunks`), and a link to outside content asks the
 * deployment's link switch first (`linkImportRefusal`).
 */
import { LLM_REFERENCE_FILES_MAX, LLM_REFERENCE_FILES_MAX_TOTAL_BYTES, LLM_REFERENCE_FILES_MAX_PAGES } from "@nodaro/shared/llm-models"
import { boundedPublicChunks, PublicDownloadTooLargeError } from "./safe-fetch-bytes.js"
import { linkImportRefusal } from "./link-imports.js"
import { countPdfPages, PdfReaderBusyError, takeDocumentReadTurn, type PdfPageCount } from "./pdf-pages.js"
import type { LlmContentBlock } from "./llm/types.js"

/**
 * The most bytes the documents of one call may total (6 MiB), about 8.4
 * million characters once base64 inflates them, inside the ten million an
 * inline request may carry (`KIE_INLINE_REQUEST_BUDGET_CHARS`), whose rest
 * goes to the call's images.
 */
export const LLM_FILES_MAX_TOTAL_BYTES = LLM_REFERENCE_FILES_MAX_TOTAL_BYTES

/** The most pages the documents of one call may have in all. */
export const LLM_FILES_MAX_PAGES = LLM_REFERENCE_FILES_MAX_PAGES

/** How long one document may take to download. */
const LLM_FILE_FETCH_TIMEOUT_MS = 30_000

/** A document block, as the request carries it. */
export type LlmFileBlock = Extract<LlmContentBlock, { type: "file_base64" }>

/** Why a document was refused — the `400`'s code and sentence. */
export class LlmFileError extends Error {
  readonly code: "file_unreachable" | "file_too_large" | "file_type_not_supported" | "file_unreadable" | "file_too_many_pages" | "link_imports_disabled" | "file_reader_busy"
  constructor(code: LlmFileError["code"], message: string) {
    super(message)
    this.name = "LlmFileError"
    this.code = code
  }
}

/** The name the model is told: the link's last path segment when it names a `.pdf`, else `document-<n>.pdf`. */
export function llmFileName(url: string, index: number): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "")
    if (/^[^\\/:*?"<>|\x00-\x1f]{1,120}\.pdf$/i.test(last)) return last
  } catch {
    /* fall through to the generic name */
  }
  return `document-${index + 1}.pdf`
}

/** Does `bytes` start like a PDF (`%PDF-`, allowing the few leading bytes some writers put first)? */
export function looksLikePdf(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 1024).toString("latin1")
  return head.includes("%PDF-")
}

/** One document's bytes, through the SSRF-safe fetch, refused past `maxBytes`. */
async function fetchFileBytes(url: string, name: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  const chunks: Buffer[] = []
  let length = 0
  try {
    for await (const chunk of boundedPublicChunks(url, { maxBytes, timeoutMs: LLM_FILE_FETCH_TIMEOUT_MS, label: "File", signal })) {
      chunks.push(chunk)
      length += chunk.length
    }
  } catch (err) {
    if (err instanceof PublicDownloadTooLargeError) throw tooLarge()
    throw new LlmFileError("file_unreachable", `We couldn't download the file ${name}. Check that its link is public and points to a PDF.`)
  }
  return Buffer.concat(chunks, length)
}

function tooLarge(): LlmFileError {
  return new LlmFileError("file_too_large", `Files may total up to ${LLM_FILES_MAX_TOTAL_BYTES / (1024 * 1024)} MB in one call.`)
}

/**
 * The inline blocks for `urls`, in order — each fetched once, checked and
 * counted — or `LlmFileError` naming the first file refused, by its file name
 * (`llmFileName`), never its link: a workflow's failure shows the sentence as
 * it is. With `owner` (the user), the call's reads run in that owner's one turn
 * here (`takeDocumentReadTurn`): one user's documents are read one call at a
 * time, fetches included, so a user never queues more than one call's bytes.
 * Refused, in this
 * order: more than {@link LLM_REFERENCE_FILES_MAX} links; a link to outside
 * content where this deployment refuses those; a file that cannot be
 * downloaded; files past {@link LLM_FILES_MAX_TOTAL_BYTES} in all; a file that
 * is not a PDF; a PDF whose pages cannot be counted; files past
 * {@link LLM_FILES_MAX_PAGES} pages in all.
 */
export async function prepareLlmFiles(
  urls: readonly string[],
  opts: { signal?: AbortSignal; owner?: string } = {},
): Promise<LlmFileBlock[]> {
  if (urls.length > LLM_REFERENCE_FILES_MAX) {
    throw new LlmFileError("file_too_large", `A call takes up to ${LLM_REFERENCE_FILES_MAX} files.`)
  }
  for (const url of urls) {
    const refusal = linkImportRefusal(url)
    if (refusal) throw new LlmFileError("link_imports_disabled", refusal.message)
  }
  let releaseTurn = () => {}
  if (opts.owner) {
    try {
      releaseTurn = await takeDocumentReadTurn(opts.owner, opts.signal)
    } catch (err) {
      if (err instanceof PdfReaderBusyError) throw readerBusy()
      throw err
    }
  }
  try {
    return await readFiles(urls, opts.signal)
  } finally {
    releaseTurn()
  }
}

function readerBusy(): LlmFileError {
  return new LlmFileError("file_reader_busy", "We're reading a lot of documents right now. Try again in a moment.")
}

async function readFiles(urls: readonly string[], signal?: AbortSignal): Promise<LlmFileBlock[]> {
  const blocks: LlmFileBlock[] = []
  let total = 0
  let totalPages = 0
  for (const [i, url] of urls.entries()) {
    const left = LLM_FILES_MAX_TOTAL_BYTES - total
    if (left < 1) throw tooLarge()
    const name = llmFileName(url, i)
    const bytes = await fetchFileBytes(url, name, left, signal)
    total += bytes.length
    if (!looksLikePdf(bytes)) {
      throw new LlmFileError("file_type_not_supported", `The file ${name} is not a PDF. Only PDF files can be read.`)
    }
    let count: PdfPageCount | null
    try {
      count = await countPdfPages(bytes, { signal })
    } catch (err) {
      if (err instanceof PdfReaderBusyError) throw readerBusy()
      throw err
    }
    if (count === null) {
      throw new LlmFileError("file_unreadable", `We couldn't read the pages of the PDF ${name}. It may be encrypted or damaged.`)
    }
    // The cap reads the pages a reader shows; the hold the larger count (`PdfPageCount`).
    const { pages, holdPages } = count
    totalPages += pages
    if (pages > LLM_FILES_MAX_PAGES) {
      throw new LlmFileError("file_too_many_pages", `The PDF ${name} has ${pages} pages; a call may read up to ${LLM_FILES_MAX_PAGES} pages in all.`)
    }
    if (totalPages > LLM_FILES_MAX_PAGES) {
      throw new LlmFileError("file_too_many_pages", `These files have ${totalPages} pages so far; a call may read up to ${LLM_FILES_MAX_PAGES} pages in all.`)
    }
    blocks.push({ type: "file_base64", mediaType: "application/pdf", data: bytes.toString("base64"), filename: name, pages, holdPages })
  }
  return blocks
}
