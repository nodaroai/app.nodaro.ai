import { Download, Play } from "lucide-react"
import { useT } from "@/lib/i18n"
import type { DeliveredVideoClip } from "@/lib/run-result-identity"
import { downloadVideoFile } from "./video-unplayable"

export function ProClipDownloads({ clips, inline = false }: { clips?: readonly DeliveredVideoClip[]; inline?: boolean }) {
  const t = useT()
  if (!clips?.length) return null
  return (
    <details className={`nodrag nowheel nopan rounded-md bg-background/95 px-2 py-1 text-xs shadow ${inline ? "" : "absolute bottom-10 left-2 z-20 max-w-[90%]"}`} onClick={event => event.stopPropagation()}>
      <summary className="cursor-pointer">{t("node.downloadSeparateClips", { n: clips.length })}</summary>
      <div className="max-h-36 overflow-auto">
        {clips.map(clip => (
          <div key={clip.segment} className="flex items-center gap-2">
            <a href={clip.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded p-1 hover:bg-muted">
              <Play size={14} />{t("common.play")} · {clip.segment}
            </a>
            <button type="button" className="flex items-center gap-1 rounded p-1 hover:bg-muted"
              onClick={() => downloadVideoFile(clip.url, `segment-${clip.segment}`)}>
              <Download size={14} />{t("common.download")} · {clip.segment}
            </button>
          </div>
        ))}
      </div>
    </details>
  )
}
