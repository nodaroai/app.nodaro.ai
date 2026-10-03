import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Engines (product names — keep in English)
  "unreal-engine-5": { description: "실시간 패스 트레이싱 UE5 룩" },
  "blender-cycles": { description: "Cycles 비편향 패스 트레이싱" },
  "octane-render": { description: "GPU 스펙트럼 패스 트레이싱" },
  "redshift": { description: "프로덕션급 GPU 편향 렌더러" },
  "houdini-mantra": { description: "VFX급 물리 기반 렌더링" },
  "arnold-render": { description: "업계 표준 VFX 패스 트레이서" },
  "corona-renderer": { description: "포토리얼리스틱 비편향 건축 시각화 렌더러" },
  "vray": { description: "업계 표준 제품 / 건축 시각화 / VFX 렌더러" },
  "aces": { description: "시네마급 ACES 컬러 관리" },

  // Render-quality keywords
  "raytracing": { label: "레이 트레이싱", description: "정확한 반사와 그림자 처리" },
  "physically-based-rendering": { description: "물리 기반 머티리얼" },
  "global-illumination": { label: "글로벌 일루미네이션", description: "사실적인 빛 반사" },
  "lumen-reflections": { description: "실시간 다이내믹 GI" },

  // Resolution / Detail (technical alphanumeric)
  "8k-uhd": { description: "초선명한 8K 해상도" },
  "4k-uhd": { description: "또렷한 4K 해상도" },
  "16k-megapixel": { description: "엄청나게 높은 해상도의 디테일" },
  "ultra-detailed": { label: "울트라 디테일", description: "최대 마이크로 디테일 렌더링" },

  // Style stamps
  "raw-photo": { label: "RAW 사진", description: "가공되지 않은 사진의 느낌" },
  "masterpiece": { label: "마스터피스", description: "장인의 손길이 느껴지는 품질 보증" },
  "award-winning": { label: "수상작급", description: "수상작 수준의 퀄리티" },

  // Additional render qualities
  "volumetric-lighting": { label: "볼류메트릭 라이팅", description: "대기를 가르는 갓 레이 볼류메트릭 빛줄기" },
  "photon-mapping": { label: "포톤 매핑", description: "코스틱까지 계산하는 포톤 매핑 글로벌 일루미네이션 렌더러" },
  "ai-upscaled": { label: "AI 업스케일", description: "신경망 업스케일로 디테일 향상, 선명한 초해상도" },
  "denoised": { label: "노이즈 제거", description: "노이즈를 제거한 깨끗하고 정갈한 렌더링, 그레인이나 반점 없음" },
}

export default map
