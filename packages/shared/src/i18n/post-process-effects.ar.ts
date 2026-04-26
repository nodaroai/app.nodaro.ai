import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "vignette-soft": { label: "تظليل ناعم", description: "تعتيم زوايا لطيف" },
  "vignette-heavy": { label: "تظليل كثيف", description: "زوايا سوداء درامية" },
  "dodge-and-burn": { label: "Dodge & Burn", description: "نحت ضوء/ظل" },
  "film-grain-fine": { label: "حبيبات فيلم دقيقة", description: "حبيبات بأسلوب 35mm طفيفة" },
  "film-grain-heavy": { label: "حبيبات فيلم كثيفة", description: "حبيبات خشنة معالجة بالدفع" },
  "halation-glow": { label: "توهج Halation", description: "توهج هالة حمراء بأسلوب Cinestill" },
  "bloom-glow": { label: "توهج Bloom", description: "توهج إبرازات حالم رومانسي" },
  "chromatic-aberration": { label: "Chromatic Aberration", description: "هامش أحمر/تركوازي على الحواف" },
  "light-leak": { label: "تسرب ضوء", description: "خط دافئ عبر الإطار" },
  "film-burn": { label: "حرق فيلم", description: "وهج زاوية Super-8 قديم" },
  "scratched-emulsion": { label: "Emulsion مخدوش", description: "خدوش فيلم قديم + غبار" },
  "color-fringe": { label: "هامش لوني", description: "هامش طفيف على تباين عال" },
  "soft-focus-diffusion": { label: "انتشار تركيز ناعم", description: "توهج إبرازات ضبابي حالم" },
  "contrast-boost": { label: "تعزيز تباين", description: "ظلال مسحوقة + إبرازات مدفوعة" },

  "sharpening": { label: "Sharpening كثيف", description: "تمرير Sharpening حواد عدواني" },
  "clarity-boost": { label: "تعزيز Clarity", description: "تعزيز Clarity للنغمات المتوسطة، تباين محلي مرفوع" },
  "dehaze": { label: "Dehaze", description: "Dehaze جوي مطبق، يزيل النعومة" },
  "lift-gamma-gain": { label: "تدرج Lift-Gamma-Gain", description: "عجلات تدرج لوني ثلاثية" },
}

export default map
