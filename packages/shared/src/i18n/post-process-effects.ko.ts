import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "vignette-soft": { label: "소프트 비네트", description: "모서리가 은은하게 어두워지는 효과" },
  "vignette-heavy": { label: "강한 비네트", description: "극적인 검은 모서리" },
  "dodge-and-burn": { label: "닷지 & 번", description: "하이라이트와 섀도우로 조각한 입체감" },
  "film-grain-fine": { label: "고운 필름 그레인", description: "은은한 35mm 스타일 그레인" },
  "film-grain-heavy": { label: "강한 필름 그레인", description: "푸시 처리된 거친 그레인" },
  "halation-glow": { label: "헐레이션 글로우", description: "Cinestill 스타일의 레드 헐레이션 블룸" },
  "bloom-glow": { label: "블룸 글로우", description: "낭만적이고 몽환적인 하이라이트 블룸" },
  "chromatic-aberration": { label: "색수차", description: "가장자리의 빨강 / 시안 프린지" },
  "light-leak": { label: "라이트 릭", description: "프레임을 가로지르는 따뜻한 빛줄기" },
  "film-burn": { label: "필름 번", description: "빈티지 Super-8 모서리 플레어" },
  "scratched-emulsion": { label: "스크래치 에멀션", description: "오래된 필름 스크래치와 먼지 자국" },
  "color-fringe": { label: "컬러 프린지", description: "은은한 고대비 프린지" },
  "soft-focus-diffusion": { label: "소프트 포커스 디퓨전", description: "흐릿하고 몽환적인 하이라이트 블룸" },
  "contrast-boost": { label: "콘트라스트 부스트", description: "깊게 눌린 섀도우와 끌어올린 하이라이트" },

  // Additional post-process effects
  "sharpening": { label: "강한 샤프닝", description: "강한 엣지 샤프닝, 선명한 미세 디테일" },
  "clarity-boost": { label: "클래리티 부스트", description: "미드톤 클래리티 향상, 로컬 콘트라스트 증가" },
  "dehaze": { label: "디헤이즈", description: "대기 디헤이즈 적용 — 흐릿함을 걷어 내고 안개 속 대비를 끌어올림" },
  "lift-gamma-gain": { label: "리프트-감마-게인 그레이드", description: "3-웨이 컬러 그레이딩 휠 — 섀도우 리프트, 미드톤 감마, 하이라이트 게인" },
}

export default map
