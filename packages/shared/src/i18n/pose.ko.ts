import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Standing
  "standing-upright": { label: "똑바로 서기", description: "편안하게 서 있는 자세" },
  "confident-stance": { label: "당당한 자세", description: "다리를 벌리고 어깨를 편 자세" },
  "hands-on-hips": { label: "허리에 양손", description: "허리에 양손을 올린 모습" },
  "arms-crossed": { label: "팔짱 끼기", description: "가슴 앞으로 팔짱을 낀 자세" },
  "leaning": { label: "기대기", description: "무언가에 기댄 모습" },
  "hero-pose": { label: "히어로 포즈", description: "극적인 영웅적 자세" },
  "contrapposto": { description: "엉덩이를 기울이고 한쪽 다리에 무게를 실은 자세" },
  "leaning-against-wall": { label: "벽에 기대기", description: "편하게 벽에 기댄 모습" },
  "hands-behind-head": { label: "머리 뒤에 손", description: "두 손을 머리 뒤에 깍지 낀 자세" },
  "hands-behind-back": { label: "등 뒤에 손", description: "뒷짐을 진 자세" },

  // Seated
  "sitting": { label: "앉기", description: "자연스럽게 앉아 있는 모습" },
  "cross-legged": { label: "양반다리", description: "바닥에 양반다리로 앉은 자세" },
  "kneeling": { label: "무릎 꿇기", description: "땅에 무릎을 꿇은 자세" },
  "crouching": { label: "쪼그려 앉기", description: "낮게 쪼그려 앉은 자세" },
  "lounging": { label: "느긋하게 기대앉기", description: "뒤로 기대어 편안하게 앉은 자세" },
  "sitting-edge-of-bed": { label: "침대 가장자리에 앉기", description: "침대 가장자리에 걸터앉은 모습" },
  "chair-arm-drape": { label: "의자 팔걸이에 다리 걸치기", description: "의자 팔걸이에 다리를 걸친 자세" },
  "elbow-propped": { label: "팔꿈치에 뺨", description: "팔꿈치를 괴고 뺨을 기댄 자세" },
  "lying-on-stomach-reading": { label: "엎드려 책 읽기", description: "엎드려 팔꿈치를 괴고 책을 읽는 모습" },

  // Movement
  "walking": { label: "걷기", description: "걸음을 내딛는 순간" },
  "running": { label: "달리기", description: "한창 달리는 중인 모습" },
  "jumping": { label: "점프하기", description: "점프해 공중에 떠 있는 순간" },
  "dancing": { label: "춤추기", description: "춤추는 도중 포착한 순간" },
  "climbing": { label: "오르기", description: "위쪽을 붙잡고 기어오르는 모습" },
  "mid-fall": { label: "추락 중", description: "공중에서 떨어지는 순간을 포착한 모습" },
  "mid-spin": { label: "회전 중", description: "빙글 도는 회전 동작의 한순간" },
  "stretching": { label: "스트레칭", description: "팔을 머리 위로 뻗은 전신 스트레칭" },
  "reaching-up": { label: "위로 뻗기", description: "팔을 머리 위로 뻗은 모습" },
  "kissing": { label: "키스", description: "키스를 나누는 모습" },
  "riding": { label: "타기", description: "자전거, 말, 오토바이를 타는 모습" },
  "driving": { label: "운전", description: "차의 핸들을 잡고 운전하는 모습" },

  // Action
  "fighting-stance": { label: "전투 자세", description: "전투 준비가 된 자세" },
  "reaching": { label: "손 뻗기", description: "바깥쪽으로 손을 뻗은 자세" },
  "throwing": { label: "던지기", description: "무언가를 던지는 순간의 동작" },
  "leaping": { label: "도약", description: "역동적으로 앞으로 도약하는 모습" },
  "dramatic-action": { label: "드라마틱 액션", description: "과장된 액션 포즈" },
  "biting-lip": { label: "입술 깨물기", description: "장난스럽게 살짝 입술을 깨문 모습" },
  "mid-laugh": { label: "웃는 중", description: "고개를 젖히고 웃는 순간" },
  "pointing-at-camera": { label: "카메라 가리키기", description: "카메라를 정면으로 가리키는 모습" },
  "tongue-out": { label: "혀 내밀기", description: "장난스럽게 혀를 내민 표정" },
  "thinking": { label: "생각하기", description: "턱에 손을 대고 사색하는 자세" },

  // Resting
  "lying-down": { label: "누워있기", description: "반듯하게 누운 모습" },
  "sleeping": { label: "잠자기", description: "눈을 감고 잠든 모습" },
  "hugging": { label: "포옹", description: "다른 사람을 안은 모습" },
  "looking-away": { label: "다른 곳 보기", description: "고개를 돌려 다른 곳을 보는 모습" },
  "looking-up": { label: "위 보기", description: "하늘을 올려다보는 모습" },
  "looking-down": { label: "아래 보기", description: "시선을 떨군 모습" },
  "head-over-shoulder": { label: "어깨 너머로 보기", description: "어깨 너머로 돌아보는 모습" },
  "wading-in-water": { label: "물속 걷기", description: "허벅지까지 오는 물속을 걷는 모습" },

  // Hand Position
  "hands-in-pockets": { label: "주머니에 손", description: "두 손을 주머니에 넣은 모습" },
  "hand-on-hip": { label: "허리에 손", description: "한 손을 허리에 올린 모습" },
  "hand-position-hands-on-hips": { label: "허리에 양손", description: "두 손을 모두 허리에 올린 모습" },
  "hand-on-chin": { label: "턱에 손", description: "손으로 턱을 받친 모습" },
  "hand-on-collarbone": { label: "쇄골에 손", description: "쇄골에 손을 가볍게 올린 모습" },
  "hand-brushing-hair": { label: "머리 쓸어 넘기기", description: "손가락으로 머리를 쓸어 넘기는 모습" },
  "finger-to-lip": { label: "입술에 손가락", description: "손가락 끝을 아랫입술에 댄 모습" },
  "arms-wrapped-around-self": { label: "몸 감싸 안기", description: "팔로 몸통을 감싸 안은 모습" },
  "hands-clasped": { label: "양손 모으기", description: "두 손을 앞에 모은 모습" },

  // Body Lean
  "leaning-back": { label: "뒤로 기울이기", description: "상체를 살짝 뒤로 기울인 모습" },
  "leaning-forward": { label: "앞으로 기울이기", description: "카메라 쪽으로 상체를 기울인 모습" },
  "body-lean-contrapposto": { description: "한쪽 다리에 무게를 싣고 엉덩이를 한쪽으로 내민 자세" },
  "arched-back": { label: "허리 젖히기", description: "허리를 부드럽게 아치 형태로 젖히고 가슴을 앞으로 내민 모습" },
  "shoulder-rolled-forward": { label: "어깨 앞으로 말기", description: "한쪽 어깨가 앞으로 말린 모습" },

  // Head Tilt
  "tilted-up": { label: "위로 기울임", description: "고개를 살짝 위로 기울인 모습" },
  "tilted-down": { label: "아래로 기울임", description: "고개를 살짝 아래로 기울인 모습" },
  "tilted-side": { label: "옆으로 기울임", description: "어깨 쪽으로 고개를 기울인 모습" },
  "tilted-back": { label: "뒤로 젖힘", description: "고개를 완전히 뒤로 젖혀 목이 드러난 모습" },
  "chin-up": { label: "턱 들기", description: "턱을 치켜들고 내려다보는 모습" },
  "chin-tucked": { label: "턱 당기기", description: "턱을 가슴 쪽으로 당긴 모습" },

  // Activity
  "activity-smoking": { label: "흡연", description: "담배를 들고 피우는 모습" },
  "activity-drinking": { label: "마시기", description: "잔이나 컵으로 음료를 마시는 모습" },
  "activity-eating": { label: "먹기", description: "한 입 베어 무는 순간" },
  "activity-talking-on-phone": { label: "통화", description: "휴대폰을 귀에 대고 통화하는 모습" },
  "activity-texting": { label: "문자 보내기", description: "휴대폰을 보며 양손 엄지로 타이핑하는 모습" },
  "activity-typing-laptop": { label: "노트북 타이핑", description: "키보드에 손을 올리고 화면에 집중하는 모습" },
  "activity-reading": { label: "독서", description: "책이나 잡지를 펼쳐 들고 읽는 모습" },
  "activity-writing": { label: "글쓰기", description: "노트에 펜으로 글을 쓰는 모습" },
  "activity-painting": { label: "그림 그리기", description: "캔버스 위에 붓으로 그림을 그리는 모습" },
  "activity-playing-instrument": { label: "악기 연주", description: "악기를 연주하는 모습" },
  "activity-cooking": { label: "요리", description: "조리대나 레인지 앞에서 요리하는 모습" },
  "activity-driving": { label: "운전", description: "운전대를 잡고 운전하는 모습" },
}

export default map
