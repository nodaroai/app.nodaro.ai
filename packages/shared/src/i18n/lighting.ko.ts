import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Time of day
  "sunrise": { label: "일출", description: "낮게 뜬 따뜻한 태양, 긴 그림자" },
  "golden-hour": { label: "골든 아워", description: "따뜻한 노을빛" },
  "noon": { label: "정오", description: "머리 위에서 내리쬐는 강한 한낮의 태양" },
  "harsh-midday": { label: "한낮의 강한 햇볕", description: "하늘 꼭대기에서 하얗게 작열하는 태양" },
  "overcast": { label: "흐림", description: "부드럽게 확산된 일광" },
  "blue-hour": { label: "블루 아워", description: "해 질 녘의 차가운 어스름" },
  "twilight": { label: "트와일라잇", description: "블루 아워와 밤 사이" },
  "night": { label: "밤", description: "깊은 밤, 약한 주변광" },
  "moonlight": { label: "달빛", description: "차갑고 푸른 달빛 풍경" },
  "neon-night": { label: "네온 나이트", description: "채도 높은 네온 도시의 밤" },

  // Style
  "three-point": { label: "삼점 조명", description: "키 + 필 + 백의 클래식 조명" },
  "rembrandt": { label: "렘브란트", description: "뺨에 맺히는 삼각형 빛" },
  "chiaroscuro": { description: "강한 명암 대비" },
  "silhouette": { label: "실루엣", description: "순수한 형태로 표현된 피사체" },
  "high-key": { label: "하이키", description: "밝고 대비가 낮은 톤" },
  "low-key": { label: "로우키", description: "어둡고 대비가 강한 톤" },
  "split": { label: "스플릿", description: "절반은 빛, 절반은 그림자인 얼굴" },
  "hard": { label: "하드", description: "경계가 선명한 그림자" },
  "soft": { label: "소프트", description: "확산된 부드러운 빛" },
  "practical": { label: "프랙티컬", description: "장면 안에 보이는 광원" },
  "ring-light": { label: "링 라이트", description: "뷰티/브이로그용 링 캐치라이트" },
  "phone-screen-glow": { label: "휴대폰 화면 불빛", description: "얼굴을 아래에서 비추는 차가운 화면 빛" },
  "selfie-natural": { label: "자연광 셀카", description: "창가 빛으로 찍은 셀카" },
  "natural": { label: "자연광", description: "현장에 있는 그대로의 주변광" },
  "volumetric": { label: "볼류메트릭", description: "연무 속에 드러나는 빛줄기" },
  "noir": { label: "느와르", description: "고대비 흑백 필름 느와르" },
  "on-camera-flash": { label: "온 카메라 플래시", description: "파파라치/iPhone 스타일의 직광 플래시" },
  "mirror-bounce-flash": { label: "거울 바운스 플래시", description: "거울 셀카의 플래시 바운스" },
  "bounced-flash": { label: "바운스 플래시", description: "천장에 바운스한 부드러운 필 라이트" },
  "softbox-key": { label: "소프트박스 키", description: "큼직하게 확산된 패션 키 라이트" },
  "beauty-dish": { label: "뷰티 디시", description: "주인공을 돋보이게 하는 빛, 또렷한 폴오프" },
  "gridded-snoot": { label: "그리드 스누트", description: "좁게 모인 스폿 형태의 빛" },
  "silk-diffusion": { label: "실크 디퓨전", description: "실크로 부드럽게 만든 키 라이트" },
  "kicker-rim": { label: "키커 / 림 액센트", description: "낮은 측면에서 피사체를 분리하는 액센트 라이트" },
  "candlelight": { label: "촛불", description: "따뜻하게 일렁이는 불빛" },
  "edison-tungsten": { label: "에디슨 텅스텐", description: "아늑하고 따뜻한 글로브 전구의 빛" },
  "dappled-light": { label: "얼룩진 빛 / 잎새 사이 빛", description: "나뭇잎 사이로 얼룩덜룩 비치는 빛" },
  "raking-sidelight": { label: "스치는 측면광", description: "극단적으로 낮은 측면에서 비춰 질감을 살리는 빛" },
  "stage-spotlight": { label: "무대 스포트라이트", description: "머리 위에서 떨어지는 강한 단일 스폿" },
  "underwater-caustics": { label: "수중 코스틱", description: "물결치는 굴절 패턴" },
  "bioluminescence": { label: "생체 발광", description: "차갑고 기묘한 생물의 빛" },

  // Direction
  "front": { label: "정면", description: "카메라 방향에서 오는 빛" },
  "three-quarter": { label: "3/4 라이트", description: "인물 사진의 클래식한 키 라이트 각도" },
  "side": { label: "측면", description: "한쪽에서 오는 빛" },
  "back-rim": { label: "백 / 림", description: "피사체 주위에 림을 만드는 백라이트" },
  "silhouette-backlight": { label: "실루엣 백라이트", description: "밝은 후광, 어두운 피사체" },
  "top-overhead": { label: "탑 / 오버헤드", description: "바로 위에서 내리쬐는 빛" },
  "under-uplight": { label: "언더 / 업라이트", description: "아래에서 오는 빛" },
  "window": { label: "창문", description: "창문에서 들어오는 부드러운 측면광" },

  // Lighting ratio (technical alphanumeric)
  "ratio-1-1": { description: "평면적, 그림자 대비 없음" },
  "ratio-1-2": { description: "1스탑 정도의 부드러운 폴오프" },
  "ratio-1-3": { description: "2스탑 정도의 중간 대비" },
  "ratio-1-4": { description: "강한 에디토리얼 대비" },
  "ratio-1-8": { description: "극단적인 로우키 키아로스쿠로" },
  "ratio-1-16": { description: "단일 광원의 필름 느와르 폴오프" },

  // Color temperature (technical Kelvin units stay in alphanumeric)
  "temp-2700k": { label: "2700K 캔들", description: "진한 호박색 캔들/텅스텐 빛" },
  "temp-3200k": { label: "3200K 텅스텐", description: "따뜻한 노란색 실내 조명" },
  "temp-4000k": { label: "4000K 혼합광", description: "뉴트럴 화이트" },
  "temp-5600k": { label: "5600K 데이라이트", description: "데이라이트 밸런스의 한낮 태양" },
  "temp-6500k": { label: "6500K 흐림", description: "약간 차갑고 푸르스름한 색감" },
  "temp-9000k": { label: "9000K 그늘", description: "확연히 차갑고 푸른 그늘" },

  // Portrait setups
  "butterfly": { label: "버터플라이 라이팅", description: "위에서 비춘 빛이 코 아래에 만드는 나비 모양 그림자" },
  "loop": { label: "루프 라이팅", description: "약간 옆쪽 위에서 비춘 빛이 뺨에 만드는 작은 루프 그림자" },
  "broad": { label: "브로드 라이팅", description: "카메라 쪽 얼굴을 밝혀 얼굴이 넓어 보이는 조명" },
  "short": { label: "쇼트 라이팅", description: "카메라 반대쪽 얼굴을 밝혀 얼굴이 갸름해 보이는 조명" },
  "hatchet": { label: "해칫 라이팅", description: "위에서 스치듯 비춰 반대쪽에 짙은 그림자를 드리우는 조명" },
  "clamshell": { label: "클램셸 라이팅", description: "위쪽 키 라이트와 아래쪽 리플렉터로 얼굴을 감싸는 뷰티 라이팅" },
  // Location-studio extension (PR #2505 follow-up)
  "dawn": { label: "새벽", description: "일출 전 창백한 빛" },
  "morning": { label: "아침", description: "상쾌하고 밝은 아침 햇살" },
  "afternoon": { label: "오후", description: "따뜻한 늦은 오후의 빛" },
  "dusk": { label: "황혼", description: "일몰 후 사라지는 빛" },
  "midnight": { label: "자정", description: "가장 깊은 밤, 거의 검은 하늘" },
}

export default map
