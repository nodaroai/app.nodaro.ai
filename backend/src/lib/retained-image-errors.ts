export class RetainedImageInUseError extends Error {
  readonly statusCode = 409
  readonly code = "retained_image_in_use"
  constructor(message = "Retained image bytes cannot be deleted through the gallery") {
    super(message)
    this.name = "RetainedImageInUseError"
  }
}

export class RetainedVideoInUseError extends Error {
  readonly statusCode = 409
  readonly code = "retained_video_in_use"
  constructor(message = "Retained video bytes cannot be deleted through the gallery") {
    super(message)
    this.name = "RetainedVideoInUseError"
  }
}
