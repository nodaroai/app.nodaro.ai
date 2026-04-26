import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Speed
  "real-time": { label: "リアルタイム", description: "通常の再生速度" },
  "slow-motion": { label: "スローモーション", description: "中程度に減速した映像" },
  "super-slow-mo": { label: "スーパースロー", description: "極端に遅くした映像" },
  "time-lapse": { label: "タイムラプス", description: "時間を圧縮した、速い経過" },
  "hyper-lapse": { label: "ハイパーラプス", description: "移動するタイムラプス" },
  "speed-ramp": { label: "スピードランプ", description: "ショット中のダイナミックな速度変化" },

  // Freeze
  "full-freeze": { label: "完全フリーズフレーム", description: "すべての動きが止まる" },
  "bullet-time": { label: "バレットタイム", description: "被写体が静止し、カメラが旋回" },
  "frozen-subject": { label: "静止する被写体", description: "被写体は静止、世界は動く" },
  "moving-subject": { label: "動く被写体", description: "被写体は動き、世界は静止" },

  // Direction
  "forward": { label: "順送り", description: "通常の順方向再生" },
  "reverse": { label: "リバース／巻き戻し", description: "時間が逆方向に流れる" },
  "loop-boomerang": { label: "ループ／ブーメラン", description: "順方向の後に逆方向" },

  // Shutter
  "long-exposure": { label: "長時間露光", description: "モーショントレイルとストリーク" },
  "crisp-shutter": { label: "シャープシャッター", description: "シャープな動き、ブレなし" },
  "motion-blur": { label: "モーションブラー", description: "顕著な方向性のあるブラー" },
  "stutter-strobe": { label: "スタッター／ストロボ", description: "ストロボ効果のカクついた動き" },
  "stop-motion": { label: "ストップモーション", description: "段階的なフレームごとの動き" },
}

export default map
