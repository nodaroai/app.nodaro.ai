import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Fabric
  "silk": { label: "실크", description: "매끄럽고 광택 있는 실크입니다" },
  "cotton": { label: "코튼", description: "부드럽고 매트한 코튼입니다" },
  "denim": { label: "데님", description: "묵직한 인디고 데님입니다" },
  "leather": { label: "가죽", description: "풍부하고 부드러운 가죽입니다" },
  "velvet": { label: "벨벳", description: "풍성한 벨벳입니다" },
  "satin": { label: "새틴", description: "광택이 흐르는 새틴입니다" },
  "lace": { label: "레이스", description: "섬세한 패턴의 레이스입니다" },
  "wool": { label: "울", description: "따뜻하게 짠 울입니다" },
  "linen": { label: "린넨", description: "자연스러운 텍스처의 린넨입니다" },
  "tweed": { label: "트위드", description: "투박하게 짠 트위드입니다" },
  "cashmere": { label: "캐시미어", description: "고급스러운 부드러운 캐시미어입니다" },
  "chiffon": { label: "시폰", description: "투명하게 흐르는 시폰입니다" },
  "fur": { label: "퍼", description: "두껍고 풍성한 모피입니다" },

  // Metal
  "gold": { label: "금", description: "광택 있는 금입니다" },
  "silver": { label: "은", description: "광택 있는 은입니다" },
  "bronze": { label: "청동", description: "녹청이 낀 주조 청동입니다" },
  "chrome": { label: "크롬", description: "강하게 반사되는 크롬입니다" },
  "copper": { label: "구리", description: "녹청이 있는 따뜻한 구리입니다" },
  "brass": { label: "황동", description: "앤티크 황동입니다" },
  "steel": { label: "스틸", description: "헤어라인 스테인리스 스틸입니다" },
  "iron": { label: "철", description: "거친 단철입니다" },
  "platinum": { label: "백금", description: "광택 있는 백금입니다" },
  "titanium": { label: "티타늄", description: "매트한 산업용 티타늄입니다" },

  // Stone
  "marble": { label: "대리석", description: "결이 있는 흰 대리석입니다" },
  "granite": { label: "화강암", description: "얼룩덜룩한 광택 화강암입니다" },
  "obsidian": { label: "흑요석", description: "광택 있는 검은 흑요석입니다" },
  "sandstone": { label: "사암", description: "층이 있는 따뜻한 사암입니다" },
  "slate": { label: "슬레이트", description: "어둡고 평평한 슬레이트입니다" },
  "jade": { label: "옥", description: "반투명한 녹색 옥입니다" },
  "onyx": { label: "오닉스", description: "줄무늬가 있는 광택 오닉스입니다" },
  "concrete": { label: "콘크리트", description: "주조된 산업용 콘크리트입니다" },

  // Wood
  "oak": { label: "오크", description: "결이 풍부한 오크입니다" },
  "mahogany": { label: "마호가니", description: "진한 붉은 마호가니입니다" },
  "walnut": { label: "월넛", description: "어두운 월넛입니다" },
  "bamboo": { label: "대나무", description: "마디가 있는 가벼운 대나무입니다" },
  "birch": { label: "자작나무", description: "옅고 매끄러운 자작나무입니다" },
  "driftwood": { label: "유목", description: "풍화된 유목입니다" },

  // Glass / Ceramic
  "glass": { label: "유리", description: "맑고 투명한 유리입니다" },
  "stained-glass": { label: "스테인드 글라스", description: "보석 톤의 스테인드 글라스입니다" },
  "crystal": { label: "크리스털", description: "다면 컷의 맑은 크리스털입니다" },
  "porcelain": { label: "도자기", description: "매끄러운 흰 도자기입니다" },
  "ceramic-glazed": { label: "유약 도자기", description: "흙빛의 유약 도자기입니다" },
  "terracotta": { label: "테라코타", description: "따뜻한 무유약 테라코타입니다" },

  // Natural
  "water": { label: "물", description: "흐르는 반투명한 물입니다" },
  "fire": { label: "불", description: "살아 있는 불꽃입니다" },
  "ice": { label: "얼음", description: "반투명한 결정 얼음입니다" },
  "smoke": { label: "연기", description: "표류하는 환상적 연기입니다" },
  "sand": { label: "모래", description: "고운 알갱이의 모래입니다" },
  "moss": { label: "이끼", description: "무성하게 살아 있는 이끼입니다" },
  "leaves": { label: "잎", description: "겹겹이 쌓인 식물 잎입니다" },

  // Exotic
  "holographic": { label: "홀로그래픽", description: "무지갯빛 홀로그램입니다" },
  "liquid-metal": { label: "리퀴드 메탈", description: "반사되는 액체 크롬입니다" },
  "neon": { label: "네온 글로우", description: "빛나는 네온 튜빙입니다" },
  "translucent": { label: "트랜스루센트 레진", description: "빛나는 프로스트 레진입니다" },
  "mirror": { label: "미러", description: "완벽한 거울 표면입니다" },
  "plasma": { label: "플라즈마", description: "빛나는 전기 플라즈마입니다" },
  "crystal-shard": { label: "크리스털 샤드", description: "산산조각난 빛나는 크리스털입니다" },
  "obsidian-glass": { label: "옵시디언 글라스", description: "어두운 화산 유리입니다" },

  // Newly added
  "suede": { label: "스웨이드", description: "부드럽게 기모를 살린 가죽, 매트하고 벨벳 같은 표면입니다" },
  "mesh": { label: "메쉬", description: "비치는 그물망 원단, 운동복 / 시스루 톱에 사용됩니다" },
  "patent-leather": { label: "패턴트 레더", description: "강한 광택을 가진 반사성 가죽입니다" },
  "terrazzo": { label: "테라조", description: "대리석 / 유리 조각이 박힌 복합 석재입니다" },
  "iridescent": { label: "이리데센트", description: "각도에 따라 색이 변하는 무지갯빛 표면입니다" },
  "mother-of-pearl": { label: "자개", description: "조개 안쪽의 진주층, 무지갯빛 크림색입니다" },
  "carbon-fiber": { label: "카본 파이버", description: "직조된 검은 카본 파이버 복합재입니다" },
  "holographic-film": { label: "홀로그래픽 필름", description: "빛을 굴절시켜 무지갯빛 광채를 내는 홀로그램 필름입니다" },
}

export default map
