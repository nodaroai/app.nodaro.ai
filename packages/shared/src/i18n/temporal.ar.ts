import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Speed
  "real-time": { label: "زمن حقيقي", description: "سرعة تشغيل عادية" },
  "slow-motion": { label: "Slow Motion", description: "لقطات مبطأة باعتدال" },
  "super-slow-mo": { label: "Super Slow-mo", description: "لقطات بطيئة جدا" },
  "time-lapse": { label: "Time-lapse", description: "زمن مضغوط، مرور سريع" },
  "hyper-lapse": { label: "Hyper-lapse", description: "Time-lapse متحرك" },
  "speed-ramp": { label: "Speed Ramp", description: "تغيير سرعة ديناميكي في منتصف اللقطة" },

  // Freeze
  "full-freeze": { label: "تجميد إطار كامل", description: "كل الحركة مجمدة" },
  "bullet-time": { label: "Bullet Time", description: "الموضوع مجمد، الكاميرا تدور" },
  "frozen-subject": { label: "موضوع مجمد", description: "الموضوع مجمد، العالم يتحرك" },
  "moving-subject": { label: "موضوع متحرك", description: "الموضوع يتحرك، العالم مجمد" },

  // Direction
  "forward": { label: "للأمام", description: "تشغيل عادي للأمام" },
  "reverse": { label: "Reverse / Rewind", description: "الزمن يسير للخلف" },
  "loop-boomerang": { label: "Loop / Boomerang", description: "للأمام ثم للخلف" },

  // Shutter
  "long-exposure": { label: "تعريض طويل", description: "آثار حركة وخطوط ضوء" },
  "crisp-shutter": { label: "Crisp Shutter", description: "حركة حادة، بدون ضبابية" },
  "motion-blur": { label: "Motion Blur", description: "ضبابية اتجاهية واضحة" },
  "stutter-strobe": { label: "Stutter / Strobe", description: "حركة متقطعة بأسلوب ستروبوسكوب" },
  "stop-motion": { label: "Stop-motion", description: "حركة إطار-بإطار متدرجة" },
}

export default map
