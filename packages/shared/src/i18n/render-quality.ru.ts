import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ---------------------------- Engines (proper names kept English) ----------------------------
  "unreal-engine-5": { description: "Внешний вид UE5 с реал-тайм path tracing" },
  "blender-cycles": { description: "Несмещённый path tracing Cycles" },
  "octane-render": { description: "GPU-спектральный path tracing" },
  "redshift": { description: "Продакшн GPU смещённый рендерер" },
  "houdini-mantra": { description: "Физический рендеринг VFX-уровня" },

  // ---------------------------- Render-quality keywords ----------------------------
  "raytracing": { label: "Трассировка лучей", description: "Точные отражения и тени" },
  "physically-based-rendering": { label: "PBR", description: "Физически корректные материалы" },
  "global-illumination": { label: "Глобальное освещение", description: "Реалистичное отражение света" },
  "lumen-reflections": { label: "Lumen-отражения", description: "Реал-тайм динамическое GI" },

  // ---------------------------- Resolution / Detail (technical units kept) ----------------------------
  "8k-uhd": { description: "Сверхрезкое разрешение 8K" },
  "4k-uhd": { description: "Чёткое разрешение 4K" },
  "16k-megapixel": { description: "Невероятно высокое разрешение" },
  "ultra-detailed": { label: "Ультра-детализированный", description: "Максимальный микро-детальный рендер" },

  // ---------------------------- Style stamps ----------------------------
  "raw-photo": { label: "Сырое фото", description: "Необработанное фотографическое ощущение" },
  "masterpiece": { label: "Шедевр", description: "Штамп качества руки эксперта" },
  "award-winning": { label: "Награждённый", description: "Калибр премиальных кругов" },
}

export default map
