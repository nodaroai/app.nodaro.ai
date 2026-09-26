import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Fabric
  "silk": { label: "실크", description: "매끄럽고 광택 있는 실크" },
  "cotton": { label: "코튼", description: "부드럽고 매트한 코튼" },
  "denim": { label: "데님", description: "묵직한 인디고 데님" },
  "leather": { label: "가죽", description: "깊은 질감의 부드러운 가죽" },
  "velvet": { label: "벨벳", description: "풍성한 벨벳" },
  "satin": { label: "새틴", description: "광택이 흐르는 새틴" },
  "lace": { label: "레이스", description: "섬세한 패턴의 레이스" },
  "wool": { label: "울", description: "따뜻한 짜임의 울" },
  "linen": { label: "린넨", description: "자연스러운 질감의 린넨" },
  "tweed": { label: "트위드", description: "투박하게 짠 트위드" },
  "cashmere": { label: "캐시미어", description: "고급스럽고 부드러운 캐시미어" },
  "chiffon": { label: "시폰", description: "비치는 듯 하늘거리는 시폰" },
  "fur": { label: "퍼", description: "두껍고 풍성한 모피" },

  // Metal
  "gold": { label: "금", description: "광택 있는 금" },
  "silver": { label: "은", description: "광택 있는 은" },
  "bronze": { label: "청동", description: "녹청이 낀 주조 청동" },
  "chrome": { label: "크롬", description: "강하게 반사되는 크롬" },
  "copper": { label: "구리", description: "녹청이 낀 따뜻한 구리" },
  "brass": { label: "황동", description: "앤티크 황동" },
  "steel": { label: "스틸", description: "헤어라인 스테인리스 스틸" },
  "iron": { label: "철", description: "거친 단철" },
  "platinum": { label: "백금", description: "광택 있는 백금" },
  "titanium": { label: "티타늄", description: "매트한 산업용 티타늄" },

  // Stone
  "marble": { label: "대리석", description: "결이 있는 흰 대리석" },
  "granite": { label: "화강암", description: "얼룩덜룩한 광택 화강암" },
  "obsidian": { label: "흑요석", description: "광택 있는 검은 흑요석" },
  "sandstone": { label: "사암", description: "층이 있는 따뜻한 사암" },
  "slate": { label: "슬레이트", description: "어둡고 평평한 슬레이트" },
  "jade": { label: "옥", description: "반투명한 녹색 옥" },
  "onyx": { label: "오닉스", description: "줄무늬가 있는 광택 오닉스" },
  "concrete": { label: "콘크리트", description: "거푸집으로 굳힌 산업용 콘크리트" },

  // Wood
  "oak": { label: "오크", description: "결이 풍부한 오크" },
  "mahogany": { label: "마호가니", description: "진한 붉은빛 마호가니" },
  "walnut": { label: "월넛", description: "어두운 월넛" },
  "bamboo": { label: "대나무", description: "마디가 있는 밝은 색 대나무" },
  "birch": { label: "자작나무", description: "옅고 매끄러운 자작나무" },
  "driftwood": { label: "유목", description: "풍화된 유목" },

  // Glass / Ceramic
  "glass": { label: "유리", description: "맑고 투명한 유리" },
  "stained-glass": { label: "스테인드 글라스", description: "보석 톤의 스테인드 글라스" },
  "crystal": { label: "크리스털", description: "다면 컷의 맑은 크리스털" },
  "porcelain": { label: "도자기", description: "매끄러운 흰 도자기" },
  "ceramic-glazed": { label: "유약 도자기", description: "흙빛의 유약 도자기" },
  "terracotta": { label: "테라코타", description: "유약을 바르지 않은 따뜻한 테라코타" },

  // Natural
  "water": { label: "물", description: "흐르는 반투명한 물" },
  "fire": { label: "불", description: "살아 있는 불꽃" },
  "ice": { label: "얼음", description: "반투명한 결정 얼음" },
  "smoke": { label: "연기", description: "몽환적으로 흩날리는 연기" },
  "sand": { label: "모래", description: "고운 알갱이의 모래" },
  "moss": { label: "이끼", description: "무성하게 살아 있는 이끼" },
  "leaves": { label: "잎", description: "겹겹이 쌓인 식물 잎" },

  // Exotic
  "holographic": { label: "홀로그래픽", description: "무지갯빛 홀로그램" },
  "liquid-metal": { label: "리퀴드 메탈", description: "빛을 반사하는 액체 크롬" },
  "neon": { label: "네온 글로우", description: "빛나는 네온관" },
  "translucent": { label: "반투명 레진", description: "서리 낀 듯 은은하게 빛나는 레진" },
  "mirror": { label: "미러", description: "완벽한 거울 표면" },
  "plasma": { label: "플라즈마", description: "빛나는 전기 플라즈마" },
  "crystal-shard": { label: "크리스털 파편", description: "산산조각 난 빛나는 크리스털" },
  "obsidian-glass": { label: "흑요석 유리", description: "어두운 화산 유리" },

  // Newly added
  "suede": { label: "스웨이드", description: "부드럽게 기모를 살린 가죽, 매트하고 벨벳 같은 표면" },
  "mesh": { label: "메시", description: "비치는 그물망 원단, 운동복 / 시스루 톱 소재" },
  "patent-leather": { label: "에나멜 가죽", description: "강한 광택으로 반사되는 에나멜 가죽" },
  "terrazzo": { label: "테라조", description: "대리석 / 유리 조각이 박힌 복합 석재" },
  "iridescent": { label: "무지갯빛", description: "각도에 따라 색이 변하는 무지갯빛 표면" },
  "mother-of-pearl": { label: "자개", description: "조개 안쪽의 진주층, 무지갯빛 크림색" },
  "carbon-fiber": { label: "카본 파이버", description: "직조된 검은 카본 파이버 복합재" },
  "holographic-film": { label: "홀로그래픽 필름", description: "빛을 굴절시켜 무지갯빛 광채를 내는 홀로그램 필름" },
  "subsurface": { label: "서브서피스 글로우", description: "표면 아래에서 빛나는 광채" },
}

export default map
