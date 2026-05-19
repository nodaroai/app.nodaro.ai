import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "clear": { label: "맑음", description: "깨끗하고 대기 효과가 없습니다" },
  "overcast": { label: "흐림", description: "균일한 회색 구름 덮개입니다" },
  "fog-mist": { label: "안개 / 미스트", description: "부드럽게 확산되는 안개입니다" },
  "light-rain": { label: "약한 비", description: "부드럽게 내리는 비입니다" },
  "heavy-rain": { label: "폭우", description: "쏟아지는 비를 동반한 강한 폭풍입니다" },
  "snow": { label: "눈", description: "내리는 눈송이입니다" },
  "dust": { label: "먼지", description: "공기 중의 먼지 입자입니다" },
  "god-rays": { label: "갓 레이", description: "안개를 뚫고 내리는 햇살입니다" },
  "smoke": { label: "연기", description: "흩날리는 연기입니다" },
  "bokeh-particles": { label: "보케 입자", description: "초점이 나간 떠다니는 입자들입니다" },
  "chalk-dust": { label: "분필 가루", description: "공중에 떠 있는 부드러운 분필 가루입니다" },
  "falling-petals": { label: "떨어지는 꽃잎", description: "흩날리는 꽃잎들입니다" },
  "confetti": { label: "색종이", description: "내리는 화려한 색종이입니다" },
  "sparks-embers": { label: "불꽃 / 불씨", description: "위로 떠오르는 빛나는 불씨입니다" },
  "lens-flare": { label: "렌즈 플레어", description: "프레임을 가로지르는 아나모픽 플레어입니다" },
  "heat-haze": { label: "열 아지랑이", description: "배경을 일그러뜨리는 열의 아른거림입니다" },
  "steam": { label: "증기", description: "피어오르는 흰색 증기입니다" },
  "bubbles-underwater": { label: "수중 버블", description: "물속에서 올라오는 버블입니다" },
  "rain-on-glass": { label: "유리 위의 비", description: "전경 유리에 흘러내리는 빗방울입니다" },
  "pollen-light": { label: "빛 속의 꽃가루", description: "햇살 속의 따뜻한 입자들입니다" },
  "water-droplets": { label: "물방울", description: "피부나 표면에 맺힌 물방울입니다" },
  "falling-ash": { label: "떨어지는 재", description: "공중을 떠다니는 고운 회색 재입니다" },
  "fireflies": { label: "반딧불이", description: "여름밤의 마법 같은 생체발광 입자가 흩날립니다" },
  "incense-smoke": { label: "향 연기", description: "두꺼운 향 연기가 천천히 피어오릅니다" },
  "cigarette-smoke": { label: "담배 연기", description: "내쉰 담배 연기가 위로 휘감겨 올라갑니다" },
  "candle-glow": { label: "촛불 빛", description: "후광이 도는 따뜻한 촛불 광원입니다" },
  "glitter-sparkle": { label: "글리터 / 스파클", description: "공중에 떠다니는 반짝이 입자, 파티 분위기입니다" },
  "starfield": { label: "별밭", description: "별이 보이는 밤하늘, 우주적 배경입니다" },
  "dandelion-seeds": { label: "민들레 씨앗", description: "여름 산들바람을 타고 흩날리는 민들레 솜털입니다" },
  "pollen-drift": { label: "꽃가루 드리프트", description: "골든아워 빛 속의 곱고 황금빛 노란 꽃가루입니다" },

  // Additional atmospheres
  "snowflakes-heavy": { label: "폭설", description: "두껍고 무거운 눈송이가 공기를 가득 채웁니다" },
  "snowflakes-light": { label: "가벼운 눈발", description: "드문드문 흩날리는 눈송이입니다" },
  "raindrops-on-skin": { label: "피부 위의 빗방울", description: "피부에 맺힌 보이는 물방울입니다" },
  "bioluminescent-cloud": { label: "생체발광 입자 구름", description: "푸른빛-녹색으로 빛나며 떠다니는 입자입니다" },
  "motion-streaks": { label: "모션 스트릭", description: "스피드 라인 모션 블러 스트릭입니다" },
  // Location-studio extension (PR #2505 follow-up)
  "cloudy": { label: "흐림", description: "부분적인 구름 덮개, 혼합된 빛" },
  "storm": { label: "폭풍", description: "비와 번개를 동반한 격렬한 뇌우" },
  "blizzard": { label: "눈보라", description: "격렬한 눈보라, 거의 화이트아웃" },
  "fog": { label: "안개", description: "시야가 낮은 짙은 안개" },
  "mist": { label: "엷은 안개", description: "얇게 확산되는 안개" },
}

export default map
