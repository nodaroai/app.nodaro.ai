import { Loader2, Download, Copy, ImageIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusBadge, copyUrl, downloadFile, type OutputStatus } from "./shared"

interface ImageOutputCardProps {
  label: string
  status: OutputStatus
  url?: string
}

export function ImageOutputCard({ label, status, url }: ImageOutputCardProps) {
  return (
    <div className="bg-white dark:bg-[#1E1E1E] rounded-lg border border-gray-200 dark:border-[#2D2D2D] p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
        <StatusBadge status={status} />
      </div>
      {status === "running" ? (
        <div className="flex items-center justify-center h-48 bg-gray-100 dark:bg-[#2D2D2D] rounded-md">
          <Loader2 className="h-8 w-8 animate-spin text-[#ff0073]" />
        </div>
      ) : url ? (
        <>
          <img
            src={url}
            alt={label}
            className="w-full rounded-md bg-gray-100 dark:bg-[#2D2D2D] cursor-pointer hover:opacity-90 transition-opacity"
          />
          <div className="flex gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={() => copyUrl(url)}>
              <Copy className="h-3 w-3 mr-1" /> Copy URL
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadFile(url, `${label.replace(/\s+/g, "-").toLowerCase()}.png`)}>
              <Download className="h-3 w-3 mr-1" /> Download
            </Button>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center h-48 bg-gray-100 dark:bg-[#2D2D2D] rounded-md text-gray-400">
          <div className="text-center">
            <ImageIcon className="h-8 w-8 mx-auto mb-1" />
            <span className="text-xs">{status === "failed" ? "Generation failed" : "Awaiting generation"}</span>
          </div>
        </div>
      )}
    </div>
  )
}
