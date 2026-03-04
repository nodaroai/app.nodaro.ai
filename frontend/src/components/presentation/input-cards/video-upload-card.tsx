import { VideoIcon } from "lucide-react"

interface VideoUploadCardProps {
  label: string
  url?: string
}

export function VideoUploadCard({ label, url }: VideoUploadCardProps) {
  return (
    <div className="bg-white dark:bg-[#1E1E1E] rounded-lg border border-gray-200 dark:border-[#2D2D2D] p-4 shadow-sm">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        {label}
      </label>
      {url ? (
        <video src={url} controls className="w-full max-h-48 rounded-md bg-black" />
      ) : (
        <div className="flex items-center justify-center h-32 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-md text-gray-400">
          <div className="text-center">
            <VideoIcon className="h-8 w-8 mx-auto mb-1" />
            <span className="text-xs">No video uploaded</span>
          </div>
        </div>
      )}
    </div>
  )
}
