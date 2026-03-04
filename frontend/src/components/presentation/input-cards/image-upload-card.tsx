import { ImageIcon } from "lucide-react"

interface ImageUploadCardProps {
  label: string
  url?: string
}

export function ImageUploadCard({ label, url }: ImageUploadCardProps) {
  return (
    <div className="bg-white dark:bg-[#1E1E1E] rounded-lg border border-gray-200 dark:border-[#2D2D2D] p-4 shadow-sm">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        {label}
      </label>
      {url ? (
        <img
          src={url}
          alt={label}
          className="w-full max-h-48 object-contain rounded-md bg-gray-100 dark:bg-[#2D2D2D]"
        />
      ) : (
        <div className="flex items-center justify-center h-32 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-md text-gray-400">
          <div className="text-center">
            <ImageIcon className="h-8 w-8 mx-auto mb-1" />
            <span className="text-xs">No image uploaded</span>
          </div>
        </div>
      )}
    </div>
  )
}
