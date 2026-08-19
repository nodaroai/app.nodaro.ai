"use client"

import { useEffect, useCallback, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X, Loader2, Check, FilePlus } from "lucide-react"
import { NODARO_LOAD_VIDEO, NODARO_IMPORT_FILES, NODARO_RESET_PROJECT, FREECUT_READY, FREECUT_EXPORT_COMPLETE, FREECUT_REQUEST_IMPORT } from "@nodaro/shared"
import { runtimeFreecutOrigin, runtimeFreecutUrl } from "@/lib/runtime-config"

/**
 * Read at RUNTIME, not inlined at build time (#767). The published community
 * image is built once and must be repointable at a self-hosted FreeCut with a
 * `.env` value and a restart. Both values come from the same getter pair, so
 * the frame URL and the postMessage origin check can never disagree.
 *
 * The old build-time default was `http://localhost:5174` — a Vite dev server on
 * a developer laptop, which is what every self-hoster's editor pointed at.
 */
const freecutUrl = () => runtimeFreecutUrl()
const freecutOrigin = () => runtimeFreecutOrigin()

/**
 * How long to wait for the editor's own FREECUT_READY handshake before telling
 * the user it did not load. The handshake is the only reliable signal: a frame
 * blocked by `frame-ancestors` still fires `onLoad` (with the browser's error
 * page), so load events cannot distinguish "loaded" from "refused".
 */
const READY_TIMEOUT_MS = 12_000

interface AdditionalAsset {
  readonly url: string
  readonly type: "video" | "image" | "audio"
  readonly label?: string
}

interface FreeCutEditorModalProps {
  readonly videoUrl: string
  readonly freecutProjectUrl?: string
  readonly additionalAssets?: AdditionalAsset[]
  readonly onExportComplete: (videoBlob: Blob, projectJson?: unknown) => Promise<void>
  readonly onClose: () => void
  readonly onImportRequest?: (accept: string, multiple: boolean) => void
  readonly sendImportFilesRef?: React.MutableRefObject<((files: Array<{ name: string; type: string; size: number; buffer: ArrayBuffer }>) => void) | null>
}

export function FreeCutEditorModal({ videoUrl, freecutProjectUrl, additionalAssets, onExportComplete, onClose, onImportRequest, sendImportFilesRef }: FreeCutEditorModalProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "done">("idle")
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [showNewProjectConfirm, setShowNewProjectConfirm] = useState(false)
  const sentVideoRef = useRef(false)
  const [ready, setReady] = useState(false)
  const [unreachable, setUnreachable] = useState(false)
  const editorDisabled = freecutUrl() === ""

  const sendVideoToFreeCut = useCallback(
    async (iframe: HTMLIFrameElement, includeProject: boolean) => {
      const videoBuffer = await fetch(videoUrl).then((r) => r.arrayBuffer())

      // Optionally fetch project JSON for restore
      let projectJson: unknown = undefined
      if (includeProject && freecutProjectUrl) {
        try {
          projectJson = await fetch(freecutProjectUrl).then((r) => r.json())
          console.warn("[FreeCut] Loaded project JSON from:", freecutProjectUrl)
        } catch (e) {
          console.warn("[FreeCut] Failed to load project JSON:", e)
        }
      } else {
        console.warn("[FreeCut] No project to restore", { includeProject, freecutProjectUrl })
      }

      // Fetch additional connected assets (for manual-edit multi-input)
      let additionalFiles: Array<{ name: string; type: string; size: number; buffer: ArrayBuffer }> | undefined
      if (additionalAssets && additionalAssets.length > 0) {
        try {
          additionalFiles = await Promise.all(
            additionalAssets.map(async (asset) => {
              const ext = asset.type === "video" ? "mp4" : asset.type === "audio" ? "mp3" : "png"
              const mime = asset.type === "video" ? "video/mp4" : asset.type === "audio" ? "audio/mpeg" : "image/png"
              const buffer = await fetch(asset.url).then((r) => r.arrayBuffer())
              return { name: `${asset.label ?? "asset"}.${ext}`, type: mime, size: buffer.byteLength, buffer }
            }),
          )
        } catch {
          console.warn("[FreeCut] Failed to fetch some additional assets")
        }
      }

      console.warn("[FreeCut] Sending to iframe", { hasBuffer: !!videoBuffer, hasProjectJson: !!projectJson, additionalFiles: additionalFiles?.map((f) => ({ name: f.name, size: f.size })) ?? [] })
      iframe.contentWindow!.postMessage(
        { type: NODARO_LOAD_VIDEO, payload: { videoUrl, videoBuffer, projectJson, additionalFiles } },
        freecutOrigin(),
        [videoBuffer],
      )
    },
    [videoUrl, freecutProjectUrl, additionalAssets],
  )

  const sendImportFiles = useCallback(
    (files: Array<{ name: string; type: string; size: number; buffer: ArrayBuffer }>) => {
      const iframe = iframeRef.current
      if (!iframe?.contentWindow) return
      const buffers = files.map(f => f.buffer)
      iframe.contentWindow.postMessage(
        { type: NODARO_IMPORT_FILES, payload: { files } },
        freecutOrigin(),
        buffers,
      )
    },
    [],
  )

  useEffect(() => {
    if (sendImportFilesRef) sendImportFilesRef.current = sendImportFiles
    return () => { if (sendImportFilesRef) sendImportFilesRef.current = null }
  }, [sendImportFiles, sendImportFilesRef])

  // A frame blocked by `frame-ancestors` still fires onLoad (browser error
  // page), so the editor's own handshake is the only signal that it really
  // came up. No handshake in time = tell the user why, rather than leaving a
  // blank panel behind a spinner.
  useEffect(() => {
    if (ready || editorDisabled) return
    const t = setTimeout(() => setUnreachable(true), READY_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [ready, editorDisabled])

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (event.origin !== freecutOrigin()) return

      if (event.data?.type === FREECUT_READY) {
        setReady(true)
        if (!sentVideoRef.current) {
          sentVideoRef.current = true
          const iframe = iframeRef.current
          if (iframe?.contentWindow) {
            sendVideoToFreeCut(iframe, true).catch((err) => {
              // The URL-only fallback that used to live here asked the editor to
              // fetch the media itself. On a self-host that is an https frame
              // fetching http://localhost/storage/... — mixed content, blocked
              // silently by the browser, leaving an editor with no video and no
              // explanation. Surface the real failure instead (#767).
              console.error("[FreeCut] could not hand the video to the editor:", err)
              setUnreachable(true)
            })
          }
        }
      }

      if (event.data?.type === FREECUT_EXPORT_COMPLETE) {
        const buffer: ArrayBuffer = event.data.payload?.videoBuffer
        if (!buffer) return
        setSaveState("saving")
        const blob = new Blob([buffer], { type: "video/mp4" })
        const projectJson = event.data.payload?.projectJson
        console.warn("[FreeCut] Export received", { hasBuffer: !!buffer, hasProjectJson: !!projectJson, projectJsonType: typeof projectJson })
        onExportComplete(blob, projectJson).then(() => {
          setSaveState("done")
          setTimeout(() => onClose(), 800)
        }).catch(() => {
          setSaveState("idle")
        })
      }

      if (event.data?.type === FREECUT_REQUEST_IMPORT) {
        const { accept, multiple } = event.data.payload
        if (onImportRequest) {
          onImportRequest(accept || "video/*,audio/*,image/*", multiple ?? true)
          return
        }
        const input = document.createElement("input")
        input.type = "file"
        input.accept = accept || "video/*,audio/*,image/*"
        input.multiple = multiple ?? true
        input.onchange = async () => {
          const files = Array.from(input.files || [])
          if (!files.length) return
          const payload = await Promise.all(
            files.map(async (f) => ({
              name: f.name,
              type: f.type,
              size: f.size,
              buffer: await f.arrayBuffer(),
            })),
          )
          const buffers = payload.map((f) => f.buffer)
          iframeRef.current?.contentWindow?.postMessage(
            { type: NODARO_IMPORT_FILES, payload: { files: payload } },
            freecutOrigin(),
            buffers,
          )
        }
        input.click()
      }
    },
    [onExportComplete, onClose, videoUrl, sendVideoToFreeCut, onImportRequest],
  )

  useEffect(() => {
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [handleMessage])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setShowCloseConfirm((prev) => !prev)
      }
    },
    [],
  )

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  function handleNewProject() {
    setShowNewProjectConfirm(false)
    const iframe = iframeRef.current
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: NODARO_RESET_PROJECT, payload: {} },
        freecutOrigin(),
      )
      // Re-send video without project JSON
      sentVideoRef.current = false
      sendVideoToFreeCut(iframe, false).catch(() => {
        iframe.contentWindow!.postMessage(
          { type: NODARO_LOAD_VIDEO, payload: { videoUrl } },
          freecutOrigin(),
        )
      })
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#1E1E1E] border-b border-[#2D2D2D] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-white">NodarCut Editor</span>
          <button
            type="button"
            className="flex items-center gap-1.5 px-2 py-1 text-[11px] rounded-md text-white/50 hover:text-white/80 hover:bg-white/10 transition-colors"
            onClick={() => setShowNewProjectConfirm(true)}
          >
            <FilePlus className="w-3.5 h-3.5" />
            New Project
          </button>
        </div>
        <button
          type="button"
          aria-label="Close editor"
          className="text-white/70 hover:text-white transition-colors"
          onClick={() => setShowCloseConfirm(true)}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Iframe */}
      <div className="flex-1 relative">
        {!iframeLoaded && !unreachable && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <Loader2 className="w-8 h-8 animate-spin text-white/50" />
          </div>
        )}
        {unreachable && <EditorUnreachable url={freecutUrl()} />}
        {/* An empty src makes an iframe load the PARENT document — the app
            rendering itself inside its own editor. `openFreeCut` refuses to open
            without a URL, but the presentation/app-runner surface mounts this
            modal from its own state, so the guard belongs here where every
            caller passes through. */}
        {editorDisabled ? (
          <EditorDisabled />
        ) : (
        <iframe
          ref={iframeRef}
          src={freecutUrl()}
          className="w-full h-full border-0"
          allow="autoplay; camera; microphone; storage-access"
          onLoad={() => setIframeLoaded(true)}
          title="NodarCut Video Editor"
        />
        )}
      </div>

      {/* Saving overlay */}
      {saveState !== "idle" && (
        <div className="absolute inset-0 z-[10000] bg-black/70 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            {saveState === "saving" && (
              <>
                <Loader2 className="w-8 h-8 animate-spin text-white" />
                <span className="text-sm text-white">Saving edited video...</span>
              </>
            )}
            {saveState === "done" && (
              <>
                <Check className="w-8 h-8 text-green-400" />
                <span className="text-sm text-green-400">Saved</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* New project confirmation */}
      {showNewProjectConfirm && (
        <div
          className="absolute inset-0 z-[10000] bg-black/60 flex items-center justify-center"
          onClick={() => setShowNewProjectConfirm(false)}
        >
          <div
            className="bg-[#1E1E1E] border border-[#2D2D2D] rounded-lg p-6 max-w-sm mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-medium text-white mb-2">Start a new project?</h3>
            <p className="text-xs text-white/60 mb-4">
              This will discard your current edits and start fresh with the original video.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                onClick={() => setShowNewProjectConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
                onClick={handleNewProject}
              >
                Start Fresh
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close confirmation */}
      {showCloseConfirm && (
        <div
          className="absolute inset-0 z-[10000] bg-black/60 flex items-center justify-center"
          onClick={() => setShowCloseConfirm(false)}
        >
          <div
            className="bg-[#1E1E1E] border border-[#2D2D2D] rounded-lg p-6 max-w-sm mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-medium text-white mb-2">Discard changes?</h3>
            <p className="text-xs text-white/60 mb-4">
              Your edits haven't been sent back. Closing will discard them.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                onClick={() => setShowCloseConfirm(false)}
              >
                Continue editing
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
                onClick={() => { setShowCloseConfirm(false); onClose() }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

/**
 * Why the editor panel is empty.
 *
 * The hosted editor allowlists `http://localhost:*` and our own domains in its
 * `frame-ancestors` — by decision, not oversight. An install reached on any
 * other origin (a LAN address, a real domain behind a proxy) is refused by the
 * browser, and the refusal is invisible: the frame just stays blank.
 *
 * That is precisely the state our own quickstart steers people into when it
 * tells them to set PUBLIC_URL and front the stack with a reverse proxy, so it
 * has to explain itself rather than look like a bug (#767).
 */
function EditorUnreachable({ url }: { readonly url: string }) {
  const host = typeof window !== "undefined" ? window.location.hostname : ""
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]"
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black p-8">
      <div className="max-w-md text-center flex flex-col gap-3">
        <p className="text-white text-sm font-medium">The video editor did not load</p>
        {isLocal ? (
          <p className="text-white/60 text-xs leading-relaxed">
            Could not reach <span className="font-mono">{url}</span>. Check this machine's
            connection, or point the install at your own editor with{" "}
            <span className="font-mono">FREECUT_URL</span>.
          </p>
        ) : (
          <p className="text-white/60 text-xs leading-relaxed">
            The hosted editor only accepts being embedded from{" "}
            <span className="font-mono">localhost</span>, and this install is served
            from <span className="font-mono">{host}</span>. Ask us to allow this origin,
            or run your own FreeCut and set{" "}
            <span className="font-mono">FREECUT_URL</span> to it — it is public and
            MIT-licensed.
          </p>
        )}
      </div>
    </div>
  )
}

/** No editor configured (`FREECUT_URL=off`). Says so instead of framing nothing. */
function EditorDisabled() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black p-8">
      <p className="max-w-md text-center text-white/60 text-xs leading-relaxed">
        No video editor is configured for this install. Set{" "}
        <span className="font-mono">FREECUT_URL</span> to your own FreeCut deployment
        to enable editing.
      </p>
    </div>
  )
}
