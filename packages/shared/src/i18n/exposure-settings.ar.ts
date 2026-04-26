import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "aperture-f1-2": { description: "عمق ميدان رفيع جدا، بوكيه حالم" },
  "aperture-f1-4": { description: "عزل قوي للموضوع" },
  "aperture-f1-8": { description: "فصل بورتريه كلاسيكي" },
  "aperture-f2-8": { description: "موضوع حاد، خلفية ناعمة" },
  "aperture-f4": { description: "عمق ميدان يومي متوازن" },
  "aperture-f5-6": { description: "حدة عبر الموضوع" },
  "aperture-f8": { description: "ذروة الحدة" },
  "aperture-f11": { description: "عمق ميدان واسع للمناظر الطبيعية" },
  "aperture-f16": { description: "Hyperfocal، نجوم الشمس" },

  "shutter-1-30": { label: "1/30 (ضبابية يدوية)", description: "تلميح لحركة محمولة باليد" },
  "shutter-1-60": { description: "غالق يومي قياسي" },
  "shutter-1-200": { description: "حاد على معظم المواضيع" },
  "shutter-1-500": { description: "حاد على الحركة السريعة" },
  "shutter-1-1000": { label: "1/1000 (تجميد حركة)", description: "تجميد رياضات/حياة برية" },
  "shutter-long-1s": { label: "تعريض طويل (1 ثانية)", description: "خطوط ومسارات حركة" },

  "iso-100": { label: "ISO 100 (نظيف)", description: "تشويش ضئيل، حبيبات دقيقة" },
  "iso-400": { description: "نسيج خفيف، ISO يومي" },
  "iso-800": { description: "حبيبات مرئية ولكن لطيفة" },
  "iso-1600": { label: "ISO 1600 (حبيبات مرئية)", description: "نسيج تحريري بإضاءة منخفضة" },
  "iso-3200": { label: "ISO 3200 (حبيبات كثيفة)", description: "إحساس وثائقي خشن مدفوع" },
}

export default map
