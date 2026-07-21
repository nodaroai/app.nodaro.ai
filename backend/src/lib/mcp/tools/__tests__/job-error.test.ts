import { describe, it, expect } from "vitest"
import { isContentRejection, isRetryableFailure } from "../_job-error.js"

describe("isRetryableFailure", () => {
  it("marks content-policy / safety failures NON-retryable", () => {
    expect(
      isRetryableFailure(
        "Content policy violation: The output was blocked by the provider's safety filter. Try modifying your prompt or input image.",
      ),
    ).toBe(false)
    expect(isRetryableFailure("Request flagged for moderation")).toBe(false)
    expect(isRetryableFailure("NSFW content detected")).toBe(false)
    expect(isRetryableFailure("prompt violates our content policy")).toBe(false)
  })

  it("marks input-shape-limit failures NON-retryable", () => {
    expect(
      isRetryableFailure(
        "Input file exceeds the size or duration limit. Please use a shorter or smaller file.",
      ),
    ).toBe(false)
    expect(isRetryableFailure("Image too large")).toBe(false)
  })

  it("treats transient / unknown failures as retryable", () => {
    expect(
      isRetryableFailure("Generation failed. Please try again or contact support."),
    ).toBe(true)
    expect(isRetryableFailure("Provider timeout after 30s")).toBe(true)
    expect(isRetryableFailure("Internal server error (502)")).toBe(true)
    expect(isRetryableFailure(null)).toBe(true)
    expect(isRetryableFailure(undefined)).toBe(true)
    expect(isRetryableFailure("")).toBe(true)
  })
})

describe("isContentRejection", () => {
  it("matches the safety/moderation subset", () => {
    expect(
      isContentRejection(
        "Content policy violation: The output was blocked by the provider's safety filter.",
      ),
    ).toBe(true)
    expect(isContentRejection("Request flagged for moderation")).toBe(true)
    expect(isContentRejection("NSFW content detected")).toBe(true)
  })

  it("does NOT match input-shape limits (non-retryable but not rejections)", () => {
    expect(isContentRejection("Input file exceeds the size or duration limit.")).toBe(false)
    expect(isContentRejection("Image too large")).toBe(false)
  })

  it("does NOT match transient / absent reasons", () => {
    expect(isContentRejection("Provider timeout after 30s")).toBe(false)
    expect(isContentRejection(null)).toBe(false)
    expect(isContentRejection(undefined)).toBe(false)
    expect(isContentRejection("")).toBe(false)
  })
})

describe("local ffmpeg failures are never content rejections (2026-07-20 sweep false positives)", () => {
  // The real shape: runFfmpeg prefixes "ffmpeg failed:" and appends raw
  // stderr, whose filter-graph diagnostics contain the word "filtered".
  const FFMPEG_WALL =
    "ffmpeg failed: ffmpeg version n8.1.2 Copyright (c) 2000-2026 the FFmpeg developers\n" +
    "[vf#0:0] No filtered frames for output stream, trying to initialize anyway.\n" +
    "[mjpeg] Non full-range YUV is non-standard, set strict_std_compliance to at most unofficial to use it.\n" +
    "Conversion failed!"

  it("the extract-frame wall is not a rejection and stays retryable", () => {
    expect(isContentRejection(FFMPEG_WALL)).toBe(false)
    expect(isRetryableFailure(FFMPEG_WALL)).toBe(true)
  })

  it('bare "filtered" no longer matches; provider phrasings still do', () => {
    expect(isContentRejection("No filtered frames for output stream")).toBe(false)
    expect(isContentRejection("Your image was filtered by the safety system")).toBe(true)
    expect(isContentRejection("Prompt content filtered")).toBe(true)
    expect(isContentRejection("Output filtered due to policy")).toBe(true)
  })
})
