import type { FactoryPreset } from "./types.js"

// SwitchX (Beeble) relight & composite starting points — one per common job,
// so users get a tuned prompt + the right alpha mode instead of a blank node.
// Presets set alphaMode + a starter prompt (and keyframe for select); they
// deliberately leave resolution alone so they don't override the user's choice.
// A connected reference image is the biggest quality lever for all of these.
export const SWITCHX_PRESETS: readonly FactoryPreset[] = [
  {
    id: "switchx/relight-subject",
    name: "Relight Subject",
    description: "Auto-mask the subject and relight it to match a reference.",
    group: "Relight & Composite",
    data: {
      alphaMode: "auto",
      prompt:
        "Relight the subject to match the reference: match its colour temperature, key-light direction and intensity, and add matching contact shadows. Keep the subject's motion, pose and identity unchanged.",
    },
  },
  {
    id: "switchx/swap-background",
    name: "Swap Background",
    description: "Keep the subject, replace the background, relight to fit.",
    group: "Relight & Composite",
    data: {
      alphaMode: "auto",
      prompt:
        "Keep the foreground subject and replace the background with the environment from the reference. Relight the subject so it sits naturally in the new scene — match light direction, colour and shadows.",
    },
  },
  {
    id: "switchx/restyle-scene",
    name: "Restyle Whole Scene",
    description: "No mask — restyle the entire frame from a reference/prompt.",
    group: "Relight & Composite",
    data: {
      alphaMode: "fill",
      prompt:
        "Restyle the entire frame to match the reference look — colour grade, lighting and mood — while preserving the original motion, composition and timing.",
    },
  },
  {
    id: "switchx/masked-composite",
    name: "Masked Composite",
    description: "Precise control via a one-frame mask (wire a Generate Mask node).",
    group: "Relight & Composite",
    data: {
      alphaMode: "select",
      alphaKeyframeIndex: 0,
      prompt:
        "Composite the masked region against the reference and relight it to match. Leave everything outside the mask untouched.",
    },
  },
  {
    id: "switchx/frame-accurate-matte",
    name: "Frame-Accurate Matte",
    description: "Exact per-frame control via a supplied alpha matte video.",
    group: "Relight & Composite",
    data: {
      alphaMode: "custom",
      prompt:
        "Composite using the supplied per-frame matte and relight the kept region to match the reference. Preserve the original motion.",
    },
  },
]
