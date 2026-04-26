import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "auto": { label: "تلقائي", description: "اترك النموذج يختار حركة الكاميرا المناسبة" },
  "static": { label: "ثابت", description: "كاميرا ثابتة، بدون حركة" },
  "handheld": { label: "محمول باليد", description: "اهتزاز طبيعي محمول باليد" },
  "steadicam": { label: "Steadicam", description: "لقطة مشي سلسة مثبتة" },

  "pan-left": { label: "لقطة بانورامية لليسار", description: "تدوير الكاميرا أفقيا لليسار" },
  "pan-right": { label: "لقطة بانورامية لليمين", description: "تدوير الكاميرا أفقيا لليمين" },
  "whip-pan-left": { label: "Whip Pan لليسار", description: "بان سريع لليسار مع ضبابية حركة" },
  "whip-pan-right": { label: "Whip Pan لليمين", description: "بان سريع لليمين مع ضبابية حركة" },

  "tilt-up": { label: "إمالة لأعلى", description: "إمالة الكاميرا لأعلى" },
  "tilt-down": { label: "إمالة لأسفل", description: "إمالة الكاميرا لأسفل" },

  "zoom-in": { label: "تقريب", description: "تقريب العدسة نحو الموضوع" },
  "zoom-out": { label: "تبعيد", description: "تبعيد العدسة عن الموضوع" },
  "crash-zoom-in": { label: "Crash Zoom تقريب", description: "تقريب سريع بأسلوب Whip" },
  "crash-zoom-out": { label: "Crash Zoom تبعيد", description: "تبعيد سريع بأسلوب Whip" },

  "dolly-in": { label: "Dolly In", description: "دفع الكاميرا نحو الموضوع (تباين منظور)" },
  "dolly-out": { label: "Dolly Out", description: "سحب الكاميرا للخلف (تباين منظور)" },
  "dolly-zoom": { label: "Dolly Zoom", description: "تأثير Vertigo: Dolly يعاكس Zoom" },
  "push-in": { label: "Push In", description: "دفع بطيء خفيف نحو الموضوع" },
  "pull-out": { label: "Pull Out", description: "سحب بطيء خفيف عن الموضوع" },

  "truck-left": { label: "Truck لليسار", description: "انزلاق جسم الكاميرا أفقيا لليسار" },
  "truck-right": { label: "Truck لليمين", description: "انزلاق جسم الكاميرا أفقيا لليمين" },

  "pedestal-up": { label: "Pedestal لأعلى", description: "رفع جسم الكاميرا عموديا" },
  "pedestal-down": { label: "Pedestal لأسفل", description: "خفض جسم الكاميرا عموديا" },

  "roll-left": { label: "Roll لليسار", description: "تدوير الكاميرا عكس عقارب الساعة" },
  "roll-right": { label: "Roll لليمين", description: "تدوير الكاميرا مع عقارب الساعة" },
  "dutch-angle": { label: "Dutch Angle", description: "إطار ثابت مائل للتوتر" },

  "orbit-left": { label: "دوران Orbit يسار", description: "دائرة كاملة حول الموضوع لليسار" },
  "orbit-right": { label: "دوران Orbit يمين", description: "دائرة كاملة حول الموضوع لليمين" },
  "arc-left": { label: "قوس Arc يسار", description: "قوس جزئي حول الموضوع لليسار" },
  "arc-right": { label: "قوس Arc يمين", description: "قوس جزئي حول الموضوع لليمين" },

  "crane-up": { label: "Crane لأعلى", description: "ارتفاع رافعة كاسح يكشف المشهد" },
  "crane-down": { label: "Crane لأسفل", description: "نزول رافعة كاسح" },
  "boom-up": { label: "Boom لأعلى", description: "رفع ذراع Boom" },
  "boom-down": { label: "Boom لأسفل", description: "نزول ذراع Boom" },

  "tracking-shot": { label: "لقطة تتبع", description: "الكاميرا تتعقب الموضوع المتحرك بجانبه" },
  "follow": { label: "متابعة", description: "اتباع الموضوع من الخلف" },
  "lead": { label: "تقدم", description: "التحرك أمام الموضوع المتقدم" },
  "drone-follow": { label: "متابعة بالدرون", description: "درون مرتفع يتتبع الموضوع" },
  "dolly-track": { label: "Dolly Track", description: "Dolly على مسار مواز بجانب الموضوع" },

  "pov": { label: "POV", description: "منظور الشخص الأول" },
  "over-the-shoulder": { label: "فوق الكتف", description: "تأطير عبر كتف الشخصية" },
  "birds-eye": { label: "عين الطائر", description: "منظر علوي مباشر من فوق" },
  "worms-eye": { label: "عين الدودة", description: "زاوية منخفضة جدا تنظر للأعلى" },
  "aerial": { label: "جوي", description: "لقطة بأسلوب درون من ارتفاع عال" },
  "helicopter": { label: "هليكوبتر", description: "لقطة جوية واسعة كاسحة من ارتفاع عال" },
  "fly-over": { label: "تحليق فوق", description: "تمرير جوي سريع منخفض فوق المشهد" },
  "flythrough": { label: "تحليق عبر", description: "الكاميرا تطير عبر الفضاء" },
  "reveal": { label: "كشف", description: "كشف تدريجي لمشهد أوسع" },
  "snorricam": { label: "Snorricam", description: "كاميرا مثبتة على الجسم (الموضوع مقفل في الإطار)" },
  "rack-focus": { label: "Rack Focus", description: "نقل التركيز بين المقدمة والخلفية" },

  "handheld-vlog": { label: "Handheld Vlog", description: "محمول باليد بأسلوب Vlog عفوي" },
  "pov-walk": { label: "POV مشي", description: "مشي بمنظور الشخص الأول" },
  "velocity-edit": { label: "Velocity Edit", description: "إيقاع Speed-Ramp بأسلوب TikTok" },
  "match-cut-zoom": { label: "Match Cut Zoom", description: "تقريب موقت على الإيقاع للقطع" },
  "screen-tap": { label: "Screen Tap", description: "انتقال نقر إصبع على الشاشة" },
  "phone-flip": { label: "قلب الهاتف", description: "قلب الكاميرا الأمامية/الخلفية" },
}

export default map
