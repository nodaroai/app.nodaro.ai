import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Solid / Seamless
  "white-seamless": { label: "화이트 심리스", description: "깨끗한 흰색 스튜디오 배경지" },
  "black-seamless": { label: "블랙 심리스", description: "순수한 검은색 스튜디오 배경" },
  "grey-seamless": { label: "그레이 심리스", description: "뉴트럴 미드 그레이 스튜디오 배경지" },
  "ivory-seamless": { label: "아이보리 심리스", description: "따뜻한 아이보리 오프화이트 배경" },
  "deep-red": { label: "딥 레드", description: "채도 높은 진한 빨간색 벽" },
  "royal-blue": { label: "로열 블루", description: "채도 높은 로열 블루 배경" },
  "emerald-green": { label: "에메랄드 그린", description: "채도 높은 에메랄드색 벽" },
  "dusty-pink": { label: "더스티 핑크", description: "부드럽고 차분한 핑크 배경" },
  "mustard-yellow": { label: "머스터드 옐로", description: "따뜻한 머스터드색 배경" },
  "teal-textured-wall": { label: "텍스처 틸 벽", description: "페인트를 칠한 틸 색 텍스처 벽" },

  // Gradient
  "red-orange-gradient": { label: "레드-오렌지 그라데이션", description: "빨강에서 주황으로 이어지는 따뜻한 그라데이션" },
  "pink-orange-gradient": { label: "핑크-오렌지 그라데이션", description: "노을빛 핑크에서 오렌지로 이어지는 그라데이션" },
  "blue-emerald-gradient": { label: "블루-에메랄드 그라데이션", description: "블루에서 에메랄드로 이어지는 차가운 그라데이션" },
  "sunset-gradient": { label: "선셋 그라데이션", description: "여러 톤이 어우러진 노을빛 그라데이션" },
  "two-tone-split": { label: "투톤 스플릿", description: "두 가지 색으로 반반 나뉜 벽" },

  // Textured
  "brick-wall": { label: "벽돌 벽", description: "노출된 빨간 벽돌 벽" },
  "concrete-wall": { label: "콘크리트 벽", description: "노출 콘크리트 표면" },
  "plastered-wall": { label: "회벽", description: "손으로 미장한 회벽" },
  "peeling-paint": { label: "벗겨진 페인트", description: "빈티지하게 벗겨진 페인트 벽" },
  "wood-paneling": { label: "우드 패널링", description: "따뜻한 우드 패널 벽" },

  // Fabric / Drape
  "muslin-drape": { label: "모슬린", description: "얼룩덜룩하게 손으로 칠한 모슬린" },
  "velvet-drape": { label: "벨벳 드레이프", description: "묵직한 벨벳 드레이프 배경" },
  "satin-drape": { label: "새틴 드레이프", description: "광택이 흐르는 새틴 드레이프" },
  "canvas-painted": { label: "페인티드 캔버스", description: "회화적인 캔버스 배경" },

  // Effect / Lighting
  "bokeh-blur": { label: "보케 블러", description: "초점이 흐려진 보케 배경" },
  "neon-bokeh": { label: "네온 보케", description: "채도 높은 네온 보케 블러" },
  "halo-glow": { label: "빛나는 후광", description: "머리 뒤에 빛나는 원형 후광" },
  "light-leak": { label: "빛샘", description: "렌즈 플레어처럼 번지는 빛샘 줄기" },
  "vignette-dark": { label: "다크 비네트", description: "가장자리를 짙게 감싸는 어두운 비네트" },

  // Reflective
  "mirror-floor": { label: "거울 바닥", description: "반사되는 거울 표면" },
  "polished-floor": { label: "광택 바닥", description: "광택이 흐르는 바닥 반사" },
  "chroma-green": { label: "크로마 그린", description: "균일하고 채도 높은 그린 스크린" },
  "chroma-blue": { label: "크로마 블루", description: "균일하고 채도 높은 블루 스크린" },
  "paper-roll-seamless": { label: "페이퍼 롤 심리스", description: "무난한 중성 파스텔 톤 배경지 롤" },
  "tile-wall": { label: "타일 벽", description: "욕실이나 주방의 정사각형 타일 벽" },
  "marble-wall": { label: "대리석 벽", description: "결이 있는 럭셔리 대리석 벽" },

  // Additional backdrops
  "graffiti-wall": { label: "그래피티 벽", description: "선명한 그래피티와 태그로 뒤덮인 도시의 벽, 스트리트 아트" },
  "exposed-stone": { label: "노출 석벽", description: "다듬지 않은 노출 석재 또는 마름돌로 쌓은 벽" },
  "window-with-light": { label: "빛이 들어오는 창", description: "빛이 쏟아져 들어오는 큰 창문 배경" },
  "rooftop-skyline": { label: "루프탑 스카이라인", description: "도시 스카이라인이 보이는 야외 루프탑" },
}

export default map
