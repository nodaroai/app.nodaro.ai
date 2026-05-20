import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Transformation ──
  "auto": { label: "자동", description: "모델이 선택하도록 맡김" },
  "none": { label: "없음", description: "캐릭터 효과 없음" },
  "werewolf": { label: "늑대인간", description: "늑대인간으로 변신" },
  "vampire": { label: "뱀파이어", description: "뱀파이어로 변신" },
  "cyborg": { label: "사이보그 공개", description: "피부가 열리며 사이버네틱 내부 노출" },
  "ghost-form": { label: "유령 형태", description: "몸이 반투명한 영체로 변함" },
  "statue-stone": { label: "석화", description: "몸이 돌 조각상으로 굳음" },
  "liquid-metal": { label: "액체 금속", description: "T-1000 스타일 액체 크롬 형태" },
  "animalization": { label: "동물화", description: "동물로 변신" },
  "gorilla-form": { label: "고릴라 형태", description: "실버백 고릴라로 변신" },
  "mystification": { label: "신비 변신", description: "마법의 오라가 감싸며 변신" },
  "gas-form": { label: "기체 변환", description: "몸이 기체로 흩어졌다 재응축" },
  "diamond-skin": { label: "다이아몬드 피부", description: "몸이 다이아몬드 면체로 결정화" },
  "agent-reveal": { label: "요원 변신", description: "정장과 선글라스가 순식간에 등장" },

  // ── Power ──
  "fire-breathe": { label: "화염 방사", description: "지속적인 주황빛 화염 제트를 내뿜음" },
  "ice-breathe": { label: "얼음 호흡", description: "얼음 결정이 맺히는 냉기를 내뿜음" },
  "air-bending": { label: "기류 조종", description: "소용돌이치는 공기 흐름을 조종" },
  "water-bending": { label: "수류 조종", description: "손동작으로 흐르는 물을 조종" },
  "earth-bending": { label: "대지 조종", description: "지면에서 석판을 솟구치게 함" },
  "lightning-hands": { label: "번개 손", description: "손에서 전기 아크가 뻗어 나옴" },
  "levitation": { label: "공중 부양", description: "지면에서 떠올라 몸이 수직 또는 수평으로 부유" },
  "telekinesis": { label: "염동력", description: "주변 물체가 떠올라 공전함" },
  "invisibility": { label: "투명화", description: "몸이 투명한 굴절 윤곽으로 사라짐" },
  "hero-flight": { label: "영웅 비행", description: "슈퍼히어로 자세로 하늘로 날아오름" },
  "super-speed": { label: "초고속", description: "잔상을 남기며 초고속으로 이동" },
  "soul-departure": { label: "영혼 이탈", description: "반투명한 영혼이 몸에서 떠오름" },

  // ── Body-Mod ──
  "wings-grow": { label: "날개 성장", description: "등에서 날개가 돋아 펼쳐짐" },
  "horns-grow": { label: "뿔 출현", description: "머리에서 뿔이 밀고 나옴" },
  "tail-emerge": { label: "꼬리 출현", description: "척추 기저부에서 꼬리가 뻗어 나옴" },
  "tentacles-emerge": { label: "촉수 출현", description: "등이나 몸에서 촉수가 꿈틀거리며 나옴" },
  "extra-eyes": { label: "추가 눈 열림", description: "얼굴과 몸 곳곳에 추가 눈이 차례로 열림" },
  "head-explode": { label: "두부 폭발", description: "머리가 폭발적으로 터짐 (PG-13 스타일)" },
  "head-off": { label: "두부 분리", description: "머리가 목에서 부드럽게 분리되어 부유 (PG-13)" },
  "spiders-from-mouth": { label: "입에서 거미", description: "벌린 입에서 거미들이 기어 나옴 (공포)" },
  "skin-surge": { label: "피부 출렁임", description: "피부 아래에서 무언가 움직이는 듯 출렁임" },

  // ── Face-Expression ──
  "horror-face": { label: "공포 표정", description: "얼굴이 공포스러운 표정으로 뒤틀림" },
  "oni-mask": { label: "오니 마스크", description: "귀신 가면이 얼굴 위에 나타남" },
  "glowing-eyes": { label: "빛나는 눈", description: "눈이 내부에서 점화되어 빛남" },
  "floral-eyes": { label: "꽃의 눈", description: "눈 소켓에서 꽃이 피어남" },
  "bloom-mouth": { label: "꽃피는 입", description: "벌린 입에서 꽃과 덩굴이 피어남" },
  "x-ray": { label: "X레이 투시", description: "몸이 X레이 스타일로 반투명해져 골격이 보임" },
  "agent-snap": { label: "선글라스 착용", description: "선글라스가 눈 위에 딱 등장" },
  "visor-x": { label: "사이버 바이저", description: "SF풍 사이버 바이저가 눈 앞에 나타남" },

  // ── Aura-Ambient ──
  "paparazzi": { label: "파파라치 플래시", description: "카메라 플래시가 피사체 주위에서 터짐" },
  "money-rain": { label: "돈 비", description: "지폐가 피사체 주위에 비처럼 내림" },
  "color-rain": { label: "컬러 비", description: "선명한 색깔의 빗방울이 피사체 주위에 내림" },
  "saint-glow": { label: "성인 광휘", description: "후광과 신성한 빛이 피사체를 감쌈" },
  "fire-aura": { label: "화염 오라", description: "화염이 피사체의 몸 주위를 핥음" },
  "frost-aura": { label: "냉기 오라", description: "서리와 얼음이 피사체에서 방사됨" },
  "shadow-aura": { label: "그림자 오라", description: "어두운 그림자 촉수가 피사체 주위를 감쌈" },
  "electricity-aura": { label: "전기 오라", description: "테슬라 코일식 전기 아크가 피사체 주위를 튐" },
  "sparkles-around": { label: "마법 반짝임", description: "마법의 반짝임이 피사체 주위를 공전함" },
  "fairies-around": { label: "주위의 요정들", description: "작은 빛나는 요정들이 주위를 날아다님" },
  "objects-orbit": { label: "물체 공전", description: "작은 물체들이 피사체 주위를 부유하며 돎" },
  "petals-around": { label: "꽃잎 주위", description: "벚꽃 잎사귀가 피사체 주위에 부드럽게 내림" },
  "glow-trace": { label: "발광 궤적", description: "빛나는 잔상이 피사체의 모든 움직임을 따라감" },
  "tattoo-animation": { label: "문신 애니메이션", description: "피부의 문신이 빛나며 움직이기 시작함" },
}

export default map
