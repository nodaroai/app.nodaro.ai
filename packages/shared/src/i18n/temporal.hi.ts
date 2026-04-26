import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Speed
  "real-time": { label: "Real-time", description: "सामान्य playback गति" },
  "slow-motion": { label: "Slow Motion", description: "मध्यम रूप से धीमी की गई footage" },
  "super-slow-mo": { label: "Super Slow-mo", description: "अत्यधिक धीमी footage" },
  "time-lapse": { label: "Time-lapse", description: "Compressed समय, तेज़ बीताव" },
  "hyper-lapse": { label: "Hyper-lapse", description: "चलती हुई time-lapse" },
  "speed-ramp": { label: "Speed Ramp", description: "Mid-shot में dynamic गति परिवर्तन" },

  // Freeze
  "full-freeze": { label: "Full Freeze-frame", description: "सारी गति जमी हुई" },
  "bullet-time": { label: "Bullet Time", description: "Subject जमा हुआ, camera घूमता है" },
  "frozen-subject": { label: "Frozen Subject", description: "Subject जमा हुआ, दुनिया चलती है" },
  "moving-subject": { label: "Moving Subject", description: "Subject चलता है, दुनिया जमी हुई" },

  // Direction
  "forward": { label: "Forward", description: "सामान्य आगे की playback" },
  "reverse": { label: "Reverse / Rewind", description: "समय पीछे की ओर चलता है" },
  "loop-boomerang": { label: "Loop / Boomerang", description: "आगे फिर पीछे" },

  // Shutter
  "long-exposure": { label: "Long Exposure", description: "गति trails और streaks" },
  "crisp-shutter": { label: "Crisp Shutter", description: "तेज़ गति, कोई blur नहीं" },
  "motion-blur": { label: "Motion Blur", description: "स्पष्ट दिशात्मक blur" },
  "stutter-strobe": { label: "Stutter / Strobe", description: "Strobe-effect झटकेदार गति" },
  "stop-motion": { label: "Stop-motion", description: "Stepped frame-by-frame गति" },
}

export default map
