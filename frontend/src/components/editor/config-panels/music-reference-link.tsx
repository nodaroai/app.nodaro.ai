"use client"

/**
 * The Music node's reference link: Get fetches the link's sound
 * (`POST /v1/youtube-audio`) and stores it as the node's reference audio. The
 * fetch is an import of that link, so Get waits for the content rights box
 * ticked for that link on this node, and confirms it for that one fetch
 * (session state, `node-link-rights.ts`). A run never fetches the link: it
 * reads the stored file.
 */
import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RightsDeclarationBox } from "@/components/content-rights/rights-declaration-box"
import { downloadYouTubeAudio } from "@/lib/api"
import { DeclarationChangedError } from "@/lib/content-rights"
import { useT } from "@/lib/i18n"
import {
  confirmNodeLink,
  isNodeLinkRightsTicked,
  tickNodeLinkRights,
  untickNodeLinkRights,
  useNodeLinkRightsTicked,
} from "@/lib/node-link-rights"

export interface MusicReferenceLinkProps {
  readonly nodeId?: string | null
  readonly link: string
  /** The node has its reference audio already (fetched or uploaded). */
  readonly ready: boolean
  readonly onLinkChange: (link: string) => void
  /** The stored file of the link's sound. */
  readonly onFetched: (audioUrl: string) => void
}

export function MusicReferenceLink({ nodeId, link, ready, onLinkChange, onFetched }: MusicReferenceLinkProps) {
  const t = useT()
  const [status, setStatus] = useState<"idle" | "downloading" | "error">("idle")
  const url = link.trim()
  // No node, no box to tick: never counted as ticked.
  const ticked = useNodeLinkRightsTicked(nodeId ?? "", url) && Boolean(nodeId)

  const get = useCallback(async () => {
    if (!url || !nodeId || !isNodeLinkRightsTicked(nodeId, url)) return
    setStatus("downloading")
    try {
      const confirmationId = await confirmNodeLink(nodeId, url)
      const result = await downloadYouTubeAudio(url, { confirmationId })
      onFetched(result.url)
      setStatus("idle")
    } catch (err) {
      // A changed declaration unticked the box: back to waiting for it, not a failed download.
      setStatus(err instanceof DeclarationChangedError ? "idle" : "error")
    }
  }, [url, nodeId, onFetched])

  return (
    <div className="ms-6 flex flex-col gap-1">
      <div className="flex gap-1">
        <Input value={link} onChange={(e) => onLinkChange(e.target.value)} placeholder="https://…" className="flex-1" />
        <Button size="sm" variant="outline" onClick={get} disabled={status === "downloading" || !url || !ticked}>
          {status === "downloading" ? "..." : t("cfgext.musicGet")}
        </Button>
      </div>
      {nodeId && url && (
        <RightsDeclarationBox
          checked={ticked}
          onCheckedChange={(checked) => (checked ? tickNodeLinkRights(nodeId, url) : untickNodeLinkRights(nodeId))}
        />
      )}
      {status === "downloading" && <p className="text-xs text-muted-foreground">{t("cfgext.musicDownloadingAudio")}</p>}
      {status === "error" && <p className="text-xs text-red-500">{t("inputcfg.downloadFailed")}</p>}
      {ready && <p className="text-xs text-green-600">{t("cfgext.musicReady")}</p>}
    </div>
  )
}
