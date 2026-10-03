import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "clear": { label: "맑음", description: "깨끗함, 대기 효과 없음" },
  "overcast": { label: "흐림", description: "하늘을 고르게 덮은 회색 구름" },
  "fog-mist": { label: "안개 / 엷은 안개", description: "부드럽게 퍼지는 안개" },
  "light-rain": { label: "약한 비", description: "부드럽게 내리는 비" },
  "heavy-rain": { label: "폭우", description: "세찬 빗줄기를 동반한 강한 폭풍" },
  "snow": { label: "눈", description: "내리는 눈송이" },
  "dust": { label: "먼지", description: "공기 중의 먼지 입자" },
  "god-rays": { label: "갓 레이", description: "안개를 뚫고 내리는 햇살 줄기" },
  "smoke": { label: "연기", description: "떠다니는 연기" },
  "bokeh-particles": { label: "보케 입자", description: "초점이 맞지 않은 채 떠다니는 작은 입자" },
  "chalk-dust": { label: "분필 가루", description: "공중에 떠 있는 부드러운 분필 가루" },
  "falling-petals": { label: "떨어지는 꽃잎", description: "흩날리는 꽃잎" },
  "confetti": { label: "색종이 조각", description: "흩날리며 떨어지는 알록달록한 색종이 조각" },
  "sparks-embers": { label: "불꽃 / 불씨", description: "위로 떠오르는 빛나는 불씨" },
  "lens-flare": { label: "렌즈 플레어", description: "프레임을 가로지르는 아나모픽 플레어 줄기" },
  "heat-haze": { label: "열 아지랑이", description: "배경을 일그러뜨리는 열기의 아른거림" },
  "steam": { label: "증기", description: "피어오르는 흰 증기" },
  "bubbles-underwater": { label: "수중 기포", description: "물속에서 떠오르는 기포" },
  "rain-on-glass": { label: "유리창의 빗방울", description: "전경의 유리를 타고 흘러내리는 빗방울" },
  "pollen-light": { label: "빛 속의 꽃가루", description: "햇살 속을 떠다니는 따뜻한 입자" },
  "water-droplets": { label: "물방울", description: "피부나 표면에 맺힌 물방울" },
  "falling-ash": { label: "떨어지는 재", description: "공중을 떠다니는 고운 회색 재" },
  "fireflies": { label: "반딧불이", description: "떠다니는 생체발광 입자" },
  "incense-smoke": { label: "향 연기", description: "천천히 피어오르는 짙은 향 연기" },
  "cigarette-smoke": { label: "담배 연기", description: "내뿜은 뒤 위로 말려 올라가는 연기" },
  "candle-glow": { label: "촛불 빛", description: "은은한 후광이 도는 따뜻한 촛불 빛" },
  "glitter-sparkle": { label: "글리터 / 스파클", description: "공중에 떠다니는 반짝이는 입자" },
  "starfield": { label: "별밭", description: "별이 보이는 밤하늘" },
  "dandelion-seeds": { label: "민들레 씨앗", description: "흩날리는 민들레 솜털" },
  "pollen-drift": { label: "흩날리는 꽃가루", description: "금빛 햇살 속의 고운 황금빛 꽃가루" },

  // Additional atmospheres
  "snowflakes-heavy": { label: "폭설", description: "공중을 가득 메운 굵고 무거운 눈송이, 눈보라" },
  "snowflakes-light": { label: "가벼운 눈발", description: "드문드문 흩날리는 눈송이, 고요한 겨울 풍경" },
  "raindrops-on-skin": { label: "피부 위의 빗방울", description: "피부와 머리카락에 송골송골 맺힌 물방울" },
  "bioluminescent-cloud": { label: "생체발광 입자 구름", description: "야광충처럼 떠다니는, 청록빛으로 빛나는 생체발광 입자" },
  "motion-streaks": { label: "모션 스트릭", description: "빠른 움직임을 암시하는 스피드 라인과 모션 블러" },
  // Location-studio extension (PR #2505 follow-up)
  "cloudy": { label: "구름 많음", description: "하늘을 일부 덮은 구름, 햇빛과 그늘이 섞인 빛" },
  "storm": { label: "폭풍", description: "비와 번개를 동반한 격렬한 뇌우" },
  "blizzard": { label: "눈보라", description: "격렬한 눈보라, 거의 화이트아웃" },
  "fog": { label: "안개", description: "시야를 가리는 짙은 안개" },
  "mist": { label: "엷은 안개", description: "얇게 확산되는 안개" },
}

export default map
