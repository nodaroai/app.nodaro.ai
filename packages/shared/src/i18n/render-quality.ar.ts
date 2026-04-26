import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "unreal-engine-5": { description: "مظهر UE5 بـ Path Tracing فوري" },
  "blender-cycles": { description: "Cycles Path Tracing غير منحاز" },
  "octane-render": { description: "Path Tracing طيفي على GPU" },
  "redshift": { description: "محرك إنتاج GPU منحاز" },
  "houdini-mantra": { description: "إنتاج فيزيائي بمستوى VFX" },

  "raytracing": { label: "تتبع الأشعة", description: "انعكاسات + ظلال دقيقة" },
  "physically-based-rendering": { label: "PBR", description: "مواد فيزيائية" },
  "global-illumination": { label: "إضاءة عالمية", description: "ارتداد ضوء واقعي" },
  "lumen-reflections": { label: "انعكاسات Lumen", description: "GI ديناميكي فوري" },

  "8k-uhd": { label: "8K UHD", description: "دقة 8K حادة جدا" },
  "4k-uhd": { label: "4K UHD", description: "دقة 4K واضحة" },
  "16k-megapixel": { label: "16K ميجابكسل", description: "تفاصيل عالية الدقة بشكل لا يصدق" },
  "ultra-detailed": { label: "تفاصيل فائقة", description: "إنتاج بأقصى تفاصيل دقيقة" },

  "raw-photo": { label: "صورة Raw", description: "إحساس فوتوغرافي غير معالج" },
  "masterpiece": { label: "تحفة", description: "ختم جودة بمستوى يد خبير" },
  "award-winning": { label: "حائز على جائزة", description: "بمستوى جوائز" },

  "volumetric-lighting": { label: "إضاءة Volumetric", description: "أعمدة ضوء Volumetric كأشعة الإله" },
  "photon-mapping": { label: "Photon Mapping", description: "إضاءة عالمية بـ Photon-Mapping واعية بالـ Caustics" },
  "ai-upscaled": { label: "Upscaled بالذكاء الاصطناعي", description: "تعزيز تفاصيل بـ Upscaling عصبي" },
  "denoised": { label: "Denoised", description: "إنتاج نقي خال من الضوضاء" },
}

export default map
