import {
  extractAssets,
  extractTextFields,
  type ExtractedAsset,
} from "./job-asset-view-extractors"

interface JobAssetViewProps {
  readonly data: Record<string, unknown> | null
}

export function JobAssetView({ data }: JobAssetViewProps) {
  if (data === null) {
    return <p className="text-xs text-muted-foreground">No data</p>
  }

  const textFields = extractTextFields(data)
  const assets = extractAssets(data)
  const noContent = textFields.length === 0 && assets.length === 0

  return (
    <div className="flex flex-col gap-4">
      {textFields.length > 0 && (
        <div className="flex flex-col gap-3">
          {textFields.map((tf) => (
            <div key={tf.label} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground font-mono">{tf.label}</span>
              <div className="text-xs whitespace-pre-wrap rounded-md bg-muted/50 p-3">{tf.value}</div>
            </div>
          ))}
        </div>
      )}

      {assets.length > 0 && (
        <div className="flex flex-col gap-3">
          {assets.map((a, i) => (
            <AssetRow key={i} asset={a} />
          ))}
        </div>
      )}

      <details open={noContent}>
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none mb-2">
          Raw JSON
        </summary>
        <pre className="text-xs bg-muted/50 rounded-lg p-4 overflow-auto max-h-64 whitespace-pre-wrap">
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  )
}

function AssetRow({ asset }: { readonly asset: ExtractedAsset }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground font-mono break-all">{asset.path}</span>
      {renderAsset(asset)}
    </div>
  )
}

function renderAsset(asset: ExtractedAsset) {
  switch (asset.kind) {
    case "video":
      return (
        <video
          controls
          preload="metadata"
          className="max-h-64 max-w-full rounded-md bg-muted"
          src={asset.url}
        />
      )
    case "image":
      return (
        <a href={asset.url} target="_blank" rel="noopener noreferrer">
          <img
            className="max-h-48 max-w-full rounded-md object-contain"
            loading="lazy"
            src={asset.url}
            alt={asset.path}
          />
        </a>
      )
    case "audio":
      return <audio controls preload="metadata" className="w-full" src={asset.url} />
    case "other":
      return (
        <a
          href={asset.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:underline break-all text-xs"
        >
          {asset.url}
        </a>
      )
  }
}
