import type { RenderVideoInputProps, MediaAsset } from "../types"
import type {
  SceneGraph,
  MediaTrack,
  AudioTrack,
  TextTrack,
  MediaSegment,
  TextSegment,
  TransitionType,
  Effect,
} from "../scene-graph"

/**
 * Convert legacy RenderVideoInputProps → SceneGraph.
 * Dispatches by template name to replicate exact original behavior.
 */
export function legacyToSceneGraph(props: RenderVideoInputProps): SceneGraph {
  switch (props.template) {
    case "slideshow":
      return slideshowToSceneGraph(props)
    case "explainer":
      return explainerToSceneGraph(props)
    case "social-reel":
      return socialReelToSceneGraph(props)
    case "documentary":
      return documentaryToSceneGraph(props)
    default:
      return slideshowToSceneGraph(props)
  }
}

function filterVisualAssets(assets: readonly MediaAsset[]): readonly MediaAsset[] {
  return assets.filter((a) => a.type === "image" || a.type === "video")
}

function filterImageAssets(assets: readonly MediaAsset[]): readonly MediaAsset[] {
  return assets.filter((a) => a.type === "image")
}

function buildTextTrack(props: RenderVideoInputProps, style?: {
  fontWeight?: number
  fontStyle?: "normal" | "italic"
}): TextTrack | null {
  if (props.textOverlays.length === 0) return null

  const segments: TextSegment[] = props.textOverlays.map((overlay, i) => ({
    id: `text-${i}`,
    text: overlay.text,
    startFrame: overlay.startFrame,
    durationInFrames: overlay.endFrame - overlay.startFrame,
    position: overlay.position,
    fontSize: overlay.fontSize,
    color: overlay.color,
    fontWeight: style?.fontWeight,
    fontStyle: style?.fontStyle,
    animation: "fade" as const,
  }))

  return {
    type: "text",
    id: "text-track",
    zIndex: 10,
    segments,
  }
}

function buildAudioTrack(props: RenderVideoInputProps): AudioTrack | null {
  if (!props.audioTrackUrl) return null

  return {
    type: "audio",
    id: "audio-track",
    src: props.audioTrackUrl,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
  }
}

/**
 * Slideshow: equal-time segments with crossfade transitions, optional Ken Burns.
 */
function slideshowToSceneGraph(props: RenderVideoInputProps): SceneGraph {
  const visualAssets = filterVisualAssets(props.mediaAssets)
  const assetCount = visualAssets.length || 1
  const framesPerAsset = Math.floor(props.durationInFrames / assetCount)

  const segments: MediaSegment[] = visualAssets.map((asset, i) => {
    const isFirst = i === 0
    const isLast = i === assetCount - 1
    const effects: Effect[] = []

    if (props.kenBurnsEnabled && asset.type === "image") {
      effects.push({ type: "ken-burns", startValue: 0, endValue: 1 })
    }

    return {
      id: `segment-${i}`,
      src: asset.src,
      mediaType: asset.type as "image" | "video",
      startFrame: i * framesPerAsset,
      durationInFrames: framesPerAsset,
      layout: { mode: "fullscreen" as const, objectFit: "cover" as const },
      transitionIn: isFirst ? undefined : { type: "fade" as TransitionType, durationFrames: props.transitionDurationFrames },
      transitionOut: isLast ? undefined : { type: "fade" as TransitionType, durationFrames: props.transitionDurationFrames },
      effects,
    }
  })

  const tracks: (MediaTrack | AudioTrack | TextTrack)[] = [
    { type: "media", id: "media-track", zIndex: 0, segments },
  ]

  const textTrack = buildTextTrack(props)
  if (textTrack) tracks.push(textTrack)

  const audioTrack = buildAudioTrack(props)
  if (audioTrack) tracks.push(audioTrack)

  return {
    fps: props.fps,
    width: props.width,
    height: props.height,
    durationInFrames: props.durationInFrames,
    backgroundColor: props.backgroundColor,
    tracks,
  }
}

/**
 * Explainer: slide-in from left with opacity, images only.
 */
function explainerToSceneGraph(props: RenderVideoInputProps): SceneGraph {
  const imageAssets = filterImageAssets(props.mediaAssets)
  const assetCount = imageAssets.length || 1
  const framesPerSegment = Math.floor(props.durationInFrames / assetCount)

  const segments: MediaSegment[] = imageAssets.map((asset, i) => ({
    id: `segment-${i}`,
    src: asset.src,
    mediaType: "image" as const,
    startFrame: i * framesPerSegment,
    durationInFrames: framesPerSegment,
    layout: { mode: "fullscreen" as const, objectFit: "cover" as const },
    transitionIn: { type: "slide-right" as TransitionType, durationFrames: props.transitionDurationFrames },
    transitionOut: undefined,
    effects: [],
  }))

  const tracks: (MediaTrack | AudioTrack | TextTrack)[] = [
    { type: "media", id: "media-track", zIndex: 0, segments },
  ]

  const textTrack = buildTextTrack(props)
  if (textTrack) tracks.push(textTrack)

  const audioTrack = buildAudioTrack(props)
  if (audioTrack) tracks.push(audioTrack)

  return {
    fps: props.fps,
    width: props.width,
    height: props.height,
    durationInFrames: props.durationInFrames,
    backgroundColor: props.backgroundColor,
    tracks,
  }
}

/**
 * Social Reel: spring zoom + word-highlight captions, 9:16 format.
 */
function socialReelToSceneGraph(props: RenderVideoInputProps): SceneGraph {
  const visualAssets = filterVisualAssets(props.mediaAssets)
  const assetCount = visualAssets.length || 1
  const framesPerAsset = Math.floor(props.durationInFrames / assetCount)

  const segments: MediaSegment[] = visualAssets.map((asset, i) => ({
    id: `segment-${i}`,
    src: asset.src,
    mediaType: asset.type as "image" | "video",
    startFrame: i * framesPerAsset,
    durationInFrames: framesPerAsset,
    layout: { mode: "fullscreen" as const, objectFit: "cover" as const },
    transitionIn: { type: "zoom-in" as TransitionType, durationFrames: Math.min(props.transitionDurationFrames, 8) },
    transitionOut: { type: "fade" as TransitionType, durationFrames: 5 },
    effects: [],
  }))

  const tracks: (MediaTrack | AudioTrack | TextTrack)[] = [
    { type: "media", id: "media-track", zIndex: 0, segments },
  ]

  // For social reel, use word-highlight animation on text when captions enabled
  if (props.textOverlays.length > 0) {
    const animation = props.captions.enabled ? "word-highlight" as const : "fade" as const
    const textSegments: TextSegment[] = props.textOverlays.map((overlay, i) => ({
      id: `text-${i}`,
      text: overlay.text,
      startFrame: overlay.startFrame,
      durationInFrames: overlay.endFrame - overlay.startFrame,
      position: props.captions.enabled ? props.captions.position : "bottom",
      fontSize: props.captions.enabled ? props.captions.fontSize * 1.5 : overlay.fontSize,
      color: props.captions.enabled ? props.captions.color : overlay.color,
      fontWeight: 900,
      animation,
    }))

    tracks.push({
      type: "text",
      id: "text-track",
      zIndex: 20,
      segments: textSegments,
    })
  }

  const audioTrack = buildAudioTrack(props)
  if (audioTrack) tracks.push(audioTrack)

  return {
    fps: props.fps,
    width: props.width,
    height: props.height,
    durationInFrames: props.durationInFrames,
    backgroundColor: props.backgroundColor,
    tracks,
  }
}

/**
 * Documentary: Ken Burns on images + atmospheric fade, elegant text styling.
 */
function documentaryToSceneGraph(props: RenderVideoInputProps): SceneGraph {
  const visualAssets = filterVisualAssets(props.mediaAssets)
  const assetCount = visualAssets.length || 1
  const framesPerAsset = Math.floor(props.durationInFrames / assetCount)

  const segments: MediaSegment[] = visualAssets.map((asset, i) => {
    const fadeFrames = Math.min(30, Math.floor(framesPerAsset * 0.15))
    const effects: Effect[] = []

    if (asset.type === "image") {
      effects.push({ type: "ken-burns", startValue: 0, endValue: 1 })
    }

    return {
      id: `segment-${i}`,
      src: asset.src,
      mediaType: asset.type as "image" | "video",
      startFrame: i * framesPerAsset,
      durationInFrames: framesPerAsset,
      layout: { mode: "fullscreen" as const, objectFit: "cover" as const },
      transitionIn: { type: "fade" as TransitionType, durationFrames: fadeFrames },
      transitionOut: { type: "fade" as TransitionType, durationFrames: fadeFrames },
      effects,
    }
  })

  const tracks: (MediaTrack | AudioTrack | TextTrack)[] = [
    { type: "media", id: "media-track", zIndex: 0, segments },
  ]

  const textTrack = buildTextTrack(props, { fontWeight: 300, fontStyle: "italic" })
  if (textTrack) tracks.push(textTrack)

  const audioTrack = buildAudioTrack(props)
  if (audioTrack) tracks.push(audioTrack)

  return {
    fps: props.fps,
    width: props.width,
    height: props.height,
    durationInFrames: props.durationInFrames,
    backgroundColor: props.backgroundColor,
    tracks,
  }
}
