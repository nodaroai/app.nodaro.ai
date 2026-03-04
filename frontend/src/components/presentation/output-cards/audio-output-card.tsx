import { Loader2, Download, Copy, Music } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusBadge, copyUrl, downloadFile, type OutputStatus } from "./shared"

interface AudioOutputCardProps {
  label: string
  status: OutputStatus
  url?: string
}

export function AudioOutputCard({ label, status, url }: AudioOutputCardProps) {
  return (
    <div className="bg-white dark:bg-[#1E1E1E] rounded-lg border border-gray-200 dark:border-[#2D2D2D] p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
        <StatusBadge status={status} />
      </div>
      {status === "running" ? (
        <div className="flex items-center justify-center h-20 bg-gray-100 dark:bg-[#2D2D2D] rounded-md">
          <Loader2 className="h-6 w-6 animate-spin text-[#ff0073]" />
        </div>
      ) : url ? (
        <>
          <audio src={url} controls className="w-full" />
          <div className="flex gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={() => copyUrl(url)}>
              <Copy className="h-3 w-3 mr-1" /> Copy URL
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadFile(url, `${label.replace(/\s+/g, "-").toLowerCase()}.mp3`)}>
              <Download className="h-3 w-3 mr-1" /> Download
            </Button>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center h-20 bg-gray-100 dark:bg-[#2D2D2D] rounded-md text-gray-400">
          <div className="text-center">
            <Music className="h-6 w-6 mx-auto mb-1" />
            <span className="text-xs">{status === "failed" ? "Generation failed" : "Awaiting generation"}</span>
          </div>
        </div>
      )}
    </div>
  )
}
