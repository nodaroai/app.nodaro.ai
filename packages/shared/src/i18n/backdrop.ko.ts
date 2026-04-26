import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Solid / Seamless
  "white-seamless": { label: "화이트 심리스", description: "깨끗한 흰색 스튜디오 페이퍼입니다" },
  "black-seamless": { label: "블랙 심리스", description: "순수한 검은색 스튜디오 배경입니다" },
  "grey-seamless": { label: "그레이 심리스", description: "중립적인 미드 그레이 스튜디오 페이퍼입니다" },
  "ivory-seamless": { label: "아이보리 심리스", description: "따뜻한 아이보리 오프화이트 배경입니다" },
  "deep-red": { label: "딥 레드", description: "채도 높은 진한 빨간색 벽입니다" },
  "royal-blue": { label: "로열 블루", description: "채도 높은 로열 블루 배경입니다" },
  "emerald-green": { label: "에메랄드 그린", description: "채도 높은 에메랄드 색 벽입니다" },
  "dusty-pink": { label: "더스티 핑크", description: "부드럽고 차분한 핑크 배경입니다" },
  "mustard-yellow": { label: "머스터드 옐로우", description: "따뜻한 머스터드 색 배경입니다" },
  "teal-textured-wall": { label: "텍스처 틸 벽", description: "페인트칠된 틸 색의 텍스처 벽입니다" },

  // Gradient
  "red-orange-gradient": { label: "레드-오렌지 그라데이션", description: "따뜻한 빨강에서 주황으로 흐르는 스윕입니다" },
  "pink-orange-gradient": { label: "핑크-오렌지 그라데이션", description: "선셋 핑크에서 오렌지로 이어지는 스윕입니다" },
  "blue-emerald-gradient": { label: "블루-에메랄드 그라데이션", description: "차가운 블루에서 에메랄드로 이어지는 스윕입니다" },
  "sunset-gradient": { label: "선셋 그라데이션", description: "다양한 톤의 선셋 스윕입니다" },
  "two-tone-split": { label: "투톤 스플릿", description: "반반으로 나뉜 투컬러 벽입니다" },

  // Textured
  "brick-wall": { label: "벽돌 벽", description: "노출된 빨간 벽돌 벽입니다" },
  "concrete-wall": { label: "콘크리트 벽", description: "원형 콘크리트 표면입니다" },
  "plastered-wall": { label: "회벽", description: "손으로 미장한 회벽입니다" },
  "peeling-paint": { label: "벗겨진 페인트", description: "빈티지하게 벗겨진 페인트 벽입니다" },
  "wood-paneling": { label: "우드 패널링", description: "따뜻한 우드 패널 벽입니다" },

  // Fabric / Drape
  "muslin-drape": { label: "모슬린", description: "얼룩덜룩하게 손으로 칠한 모슬린입니다" },
  "velvet-drape": { label: "벨벳 드레이프", description: "묵직한 벨벳 드레이프 배경입니다" },
  "satin-drape": { label: "새틴 드레이프", description: "광택이 있는 새틴 드레이프입니다" },
  "canvas-painted": { label: "페인티드 캔버스", description: "회화적인 캔버스 배경입니다" },

  // Effect / Lighting
  "bokeh-blur": { label: "보케 블러", description: "초점이 나간 보케 필드입니다" },
  "neon-bokeh": { label: "네온 보케", description: "채도 높은 네온 보케 블러입니다" },
  "halo-glow": { label: "헤일로 글로우", description: "머리 뒤에 빛나는 원형 후광입니다" },
  "light-leak": { label: "라이트 릭", description: "렌즈 플레어 라이트 릭 스트릭입니다" },
  "vignette-dark": { label: "다크 비네트", description: "묵직한 어두운 비네트 주변부입니다" },

  // Reflective
  "mirror-floor": { label: "거울 바닥", description: "반사되는 거울 표면입니다" },
  "polished-floor": { label: "광택 바닥", description: "광택이 흐르는 바닥 반사입니다" },
  "chroma-green": { label: "크로마 그린", description: "키잉용으로 평평하게 채도 높은 그린 스크린입니다" },
  "chroma-blue": { label: "크로마 블루", description: "평평하고 채도 높은 블루 스크린입니다" },
  "paper-roll-seamless": { label: "페이퍼 롤 심리스", description: "범용 중성 파스텔 페이퍼 롤입니다" },
  "tile-wall": { label: "타일 벽", description: "욕실 / 주방의 사각 타일 벽입니다" },
  "marble-wall": { label: "마블 벽", description: "결이 있는 럭셔리 대리석 벽입니다" },

  // Additional backdrops
  "graffiti-wall": { label: "그래피티 벽", description: "선명한 도시 그래피티 태그 벽입니다" },
  "exposed-stone": { label: "노출 돌 벽", description: "다듬지 않은 노출 돌 또는 애쉬라 석조입니다" },
  "window-with-light": { label: "빛이 들어오는 창", description: "빛이 쏟아져 들어오는 큰 창문 배경입니다" },
  "rooftop-skyline": { label: "루프탑 스카이라인", description: "도시 스카이라인이 보이는 야외 루프탑입니다" },
}

export default map
