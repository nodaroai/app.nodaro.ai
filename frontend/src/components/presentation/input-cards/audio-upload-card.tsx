import { Music } from "lucide-react"

interface AudioUploadCardProps {
  label: string
  url?: string
}

export function AudioUploadCard({ label, url }: AudioUploadCardProps) {
  return (
    <div className="bg-white dark:bg-[#1E1E1E] rounded-lg border border-gray-200 dark:border-[#2D2D2D] p-4 shadow-sm">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        {label}
      </label>
      {url ? (
        <audio src={url} controls className="w-full" />
      ) : (
        <div className="flex items-center justify-center h-20 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-md text-gray-400">
          <div className="text-center">
            <Music className="h-6 w-6 mx-auto mb-1" />
            <span className="text-xs">No audio uploaded</span>
          </div>
        </div>
      )}
    </div>
  )
}
