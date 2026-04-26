import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Engines (product names — keep in English)
  "unreal-engine-5": { description: "실시간 패스 트레이싱 UE5 룩입니다" },
  "blender-cycles": { description: "Cycles 비편향 패스 트레이싱입니다" },
  "octane-render": { description: "GPU 스펙트럼 패스 트레이싱입니다" },
  "redshift": { description: "프로덕션급 GPU 편향 렌더러입니다" },
  "houdini-mantra": { description: "VFX급 물리 기반 렌더링입니다" },

  // Render-quality keywords
  "raytracing": { label: "레이 트레이싱", description: "정확한 반사와 그림자 처리입니다" },
  "physically-based-rendering": { description: "물리 기반 머티리얼입니다" },
  "global-illumination": { label: "글로벌 일루미네이션", description: "사실적인 빛 반사입니다" },
  "lumen-reflections": { description: "실시간 다이내믹 GI입니다" },

  // Resolution / Detail (technical alphanumeric)
  "8k-uhd": { description: "초선명한 8K 해상도입니다" },
  "4k-uhd": { description: "또렷한 4K 해상도입니다" },
  "16k-megapixel": { description: "엄청나게 높은 해상도의 디테일입니다" },
  "ultra-detailed": { label: "울트라 디테일드", description: "최대 마이크로 디테일 렌더링입니다" },

  // Style stamps
  "raw-photo": { label: "Raw 포토", description: "가공되지 않은 사진의 느낌입니다" },
  "masterpiece": { label: "마스터피스", description: "장인의 손길이 느껴지는 품질의 스탬프입니다" },
  "award-winning": { label: "어워드 위닝", description: "수상작 수준의 퀄리티입니다" },
}

export default map
