import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Standing
  "standing-upright": { label: "똑바로 서기", description: "편안하게 서 있는 자세입니다" },
  "confident-stance": { label: "당당한 자세", description: "다리를 벌리고 어깨를 펼친 자세입니다" },
  "hands-on-hips": { label: "허리에 손", description: "허리에 손을 올린 모습입니다" },
  "arms-crossed": { label: "팔짱 끼기", description: "가슴에 팔을 교차한 자세입니다" },
  "leaning": { label: "기대기", description: "무언가에 기대고 있습니다" },
  "hero-pose": { label: "히어로 포즈", description: "극적인 영웅적 자세입니다" },
  "contrapposto": { description: "엉덩이를 기울이고 한쪽 다리에 무게를 실은 자세입니다" },
  "leaning-against-wall": { label: "벽에 기대기", description: "캐주얼하게 벽에 기댄 모습입니다" },
  "hands-behind-head": { label: "머리 뒤에 손", description: "두 손을 머리 뒤에 깍지 낀 자세입니다" },
  "hands-behind-back": { label: "등 뒤에 손", description: "두 손을 등 뒤에 깍지 낀 자세입니다" },

  // Seated
  "sitting": { label: "앉기", description: "자연스럽게 앉아 있는 모습입니다" },
  "cross-legged": { label: "양반다리", description: "바닥에 양반다리로 앉은 자세입니다" },
  "kneeling": { label: "무릎 꿇기", description: "땅에 무릎을 꿇은 자세입니다" },
  "crouching": { label: "쪼그려 앉기", description: "낮게 쪼그려 앉은 자세입니다" },
  "lounging": { label: "느긋하게 누워있기", description: "기댄 듯 편안하게 앉은 자세입니다" },
  "sitting-edge-of-bed": { label: "침대 가장자리에 앉기", description: "침대 가장자리에 걸터앉은 모습입니다" },
  "chair-arm-drape": { label: "의자 팔걸이에 다리 걸치기", description: "의자 팔걸이에 다리를 걸친 자세입니다" },
  "elbow-propped": { label: "팔꿈치에 뺨", description: "팔꿈치에 뺨을 받친 자세입니다" },
  "lying-on-stomach-reading": { label: "엎드려 책 읽기", description: "엎드려 팔꿈치를 받치고 책을 읽는 모습입니다" },

  // Movement
  "walking": { label: "걷기", description: "걸음 중간의 모습입니다" },
  "running": { label: "달리기", description: "달리는 중, 동작 중간의 모습입니다" },
  "jumping": { label: "점프하기", description: "공중에 떠 있는 점프 중간의 모습입니다" },
  "dancing": { label: "춤추기", description: "춤추는 중간의 포착된 순간입니다" },
  "climbing": { label: "오르기", description: "위로 잡고 오르는 모습입니다" },
  "mid-fall": { label: "추락 중", description: "공중에서 떨어지는 중간의 모습입니다" },
  "mid-spin": { label: "회전 중", description: "도는 중 회전 중간의 모습입니다" },
  "stretching": { label: "스트레칭", description: "팔을 머리 위로 뻗는 풀 바디 스트레칭입니다" },
  "reaching-up": { label: "위로 뻗기", description: "팔을 머리 위로 뻗은 모습입니다" },
  "kissing": { label: "키스", description: "키스를 나누는 모습입니다" },
  "riding": { label: "타기", description: "자전거, 말, 오토바이를 타는 모습입니다" },
  "driving": { label: "운전", description: "차의 핸들을 잡고 운전하는 모습입니다" },

  // Action
  "fighting-stance": { label: "전투 자세", description: "전투 준비가 된 자세입니다" },
  "reaching": { label: "손 뻗기", description: "바깥쪽으로 손을 뻗는 자세입니다" },
  "throwing": { label: "던지기", description: "던지는 중간의 동작입니다" },
  "leaping": { label: "도약", description: "역동적으로 앞으로 도약하는 모습입니다" },
  "dramatic-action": { label: "드라마틱 액션", description: "과장된 액션 포즈입니다" },
  "biting-lip": { label: "입술 깨물기", description: "장난스럽게 살짝 입술을 깨문 모습입니다" },
  "mid-laugh": { label: "웃는 중", description: "고개를 젖히고 웃는 중간의 모습입니다" },
  "pointing-at-camera": { label: "카메라 가리키기", description: "카메라를 직접 가리키는 모습입니다" },
  "tongue-out": { label: "혀 내밀기", description: "장난스럽게 혀를 내민 표정입니다" },
  "thinking": { label: "생각하기", description: "턱에 손을 대고 사색하는 자세입니다" },

  // Resting
  "lying-down": { label: "누워있기", description: "편평하게 누운 모습입니다" },
  "sleeping": { label: "잠자기", description: "눈을 감고 잠든 모습입니다" },
  "hugging": { label: "포옹", description: "다른 사람을 안은 모습입니다" },
  "looking-away": { label: "다른 곳 보기", description: "고개를 돌려 다른 곳을 보는 모습입니다" },
  "looking-up": { label: "위 보기", description: "하늘을 올려다보는 모습입니다" },
  "looking-down": { label: "아래 보기", description: "시선을 떨군 모습입니다" },
  "head-over-shoulder": { label: "어깨 너머로 보기", description: "어깨 너머로 돌아보는 모습입니다" },
  "wading-in-water": { label: "물 속을 걷기", description: "허벅지 깊이의 물 속을 걷는 모습입니다" },

  // Hand Position
  "hands-in-pockets": { label: "주머니에 손", description: "두 손을 주머니에 넣은 모습입니다" },
  "hand-on-hip": { label: "허리에 손", description: "한 손을 허리에 올린 모습입니다" },
  "hand-position-hands-on-hips": { label: "허리에 양손", description: "두 손을 모두 허리에 올린 모습입니다" },
  "hand-on-chin": { label: "턱에 손", description: "턱 아래에 손을 올린 모습입니다" },
  "hand-on-collarbone": { label: "쇄골에 손", description: "쇄골에 손을 가볍게 올린 모습입니다" },
  "hand-brushing-hair": { label: "머리 쓸어 넘기기", description: "손가락으로 머리를 쓸어 넘기는 모습입니다" },
  "finger-to-lip": { label: "입술에 손가락", description: "손가락 끝을 아랫입술에 댄 모습입니다" },
  "arms-wrapped-around-self": { label: "스스로를 감싸는 팔", description: "팔로 몸통을 감싸 안은 모습입니다" },
  "hands-clasped": { label: "양손 모으기", description: "두 손을 앞에 모은 모습입니다" },

  // Body Lean
  "leaning-back": { label: "뒤로 기울이기", description: "상체를 살짝 뒤로 기울인 모습입니다" },
  "leaning-forward": { label: "앞으로 기울이기", description: "카메라 쪽으로 상체를 기울인 모습입니다" },
  "body-lean-contrapposto": { description: "한쪽 다리에 무게를 실고 한쪽 엉덩이를 내민 자세입니다" },
  "arched-back": { label: "허리 젖히기", description: "허리를 부드럽게 아치 형태로 젖히고 가슴을 앞으로 내민 모습입니다" },
  "shoulder-rolled-forward": { label: "어깨 앞으로 말기", description: "한쪽 어깨를 앞으로 말아 비대칭 자세를 취한 모습입니다" },

  // Head Tilt
  "tilted-up": { label: "위로 기울임", description: "고개를 살짝 위로 기울인 모습입니다" },
  "tilted-down": { label: "아래로 기울임", description: "고개를 살짝 아래로 기울인 모습입니다" },
  "tilted-side": { label: "옆으로 기울임", description: "어깨 쪽으로 고개를 기울인 모습입니다" },
  "tilted-back": { label: "뒤로 젖힘", description: "고개를 완전히 뒤로 젖혀 목이 드러난 모습입니다" },
  "chin-up": { label: "턱 들기", description: "턱을 들고 코끝으로 내려다보는 모습입니다" },
  "chin-tucked": { label: "턱 당기기", description: "턱을 가슴 쪽으로 당긴 모습입니다" },

  // Activity
  "activity-smoking": { label: "흡연", description: "담배를 들고 피우는 모습입니다" },
  "activity-drinking": { label: "마시기", description: "잔이나 컵에서 음료를 마시는 모습입니다" },
  "activity-eating": { label: "먹기", description: "한 입 베어 무는 중간의 모습입니다" },
  "activity-talking-on-phone": { label: "통화", description: "휴대폰을 귀에 대고 통화하는 모습입니다" },
  "activity-texting": { label: "문자 보내기", description: "휴대폰을 보며 양손 엄지로 타이핑하는 모습입니다" },
  "activity-typing-laptop": { label: "노트북 타이핑", description: "키보드에 손을 올리고 화면에 집중하는 모습입니다" },
  "activity-reading": { label: "독서", description: "책이나 잡지를 펼쳐 들고 읽는 모습입니다" },
  "activity-writing": { label: "글쓰기", description: "노트에 펜으로 글을 쓰는 모습입니다" },
  "activity-painting": { label: "그림 그리기", description: "캔버스 위에 붓으로 그림을 그리는 모습입니다" },
  "activity-playing-instrument": { label: "악기 연주", description: "악기를 연주하는 모습입니다" },
  "activity-cooking": { label: "요리", description: "주방 카운터나 스토브에서 요리하는 모습입니다" },
  "activity-driving": { label: "운전", description: "운전대를 잡고 운전하는 모습입니다" },
}

export default map
