import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Speed
  "real-time": { label: "זמן אמת", description: "מהירות נגינה רגילה" },
  "slow-motion": { label: "Slow Motion", description: "צילום מואט באופן מתון" },
  "super-slow-mo": { label: "Super Slow-mo", description: "צילום איטי במיוחד" },
  "time-lapse": { label: "Time-lapse", description: "זמן דחוס, מעבר מהיר" },
  "hyper-lapse": { label: "Hyper-lapse", description: "Time-lapse בתנועה" },
  "speed-ramp": { label: "Speed Ramp", description: "שינוי מהירות דינמי באמצע צילום" },

  // Freeze
  "full-freeze": { label: "הקפאת פריים מלאה", description: "כל התנועה קפואה" },
  "bullet-time": { label: "Bullet Time", description: "סובייקט קפוא, מצלמה מקיפה" },
  "frozen-subject": { label: "סובייקט קפוא", description: "סובייקט קפוא, עולם נע" },
  "moving-subject": { label: "סובייקט נע", description: "סובייקט נע, עולם קפוא" },

  // Direction
  "forward": { label: "קדימה", description: "נגינה קדימה רגילה" },
  "reverse": { label: "Reverse / Rewind", description: "זמן מתנגן לאחור" },
  "loop-boomerang": { label: "Loop / Boomerang", description: "קדימה ואז לאחור" },

  // Shutter
  "long-exposure": { label: "חשיפה ארוכה", description: "שבילי תנועה ופסים" },
  "crisp-shutter": { label: "Crisp Shutter", description: "תנועה חדה, ללא טשטוש" },
  "motion-blur": { label: "Motion Blur", description: "טשטוש כיווני בולט" },
  "stutter-strobe": { label: "Stutter / Strobe", description: "תנועה קופצנית בסגנון סטרובוסקופ" },
  "stop-motion": { label: "Stop-motion", description: "תנועת פריים-אחר-פריים מדורגת" },
}

export default map
