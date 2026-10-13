import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"
import { accountZoom, clampZoom, clusterZoom, fitZoom, FRUSTUM, singleDesk, type FloorLayout } from "../floor-layout"
import type { AccountState, Activity, LinkType, ShowFilter } from "../map-model"
import { makeAssets, PROGRESS, THEMES, type Theme } from "./world-assets"
import { buildCluster, buildSingle, removeGroup, UP, type Builder, type ClusterNode, type Monitor, type Pick, type SingleNode } from "./world-builders"
import { createLabels } from "./world-labels"

/**
 * The office floor. `createWorld` owns the renderer, camera, controls and the
 * animation loop; the page drives it with `update(view)` whenever its state
 * changes, and gets clicks back through `onSelect`.
 */

export interface WorldAccount {
  readonly id: string
  readonly cluster: string | null
  readonly state: AccountState
  readonly act: Activity
  readonly fired: readonly LinkType[]
  readonly email: string
  readonly op: number
  readonly stateLabel: string
  readonly actLabel: string
  readonly why: string
}

export interface WorldCluster {
  readonly key: string
  readonly id: number
  readonly hue: string
  readonly links: readonly LinkType[]
  readonly size: number
  readonly granted: number
  readonly withheld: number
  readonly visible: boolean
}

export interface WorldView {
  readonly theme: "light" | "dark"
  readonly show: ShowFilter
  readonly layout: FloorLayout
  readonly clusters: readonly WorldCluster[]
  /** Clustered accounts in sign-up order per cluster, then the singles newest-first. */
  readonly accounts: readonly WorldAccount[]
  readonly selected: Pick | null
  readonly selectedCluster: string | null
  readonly link: LinkType | null
  /** Pixels the side panel covers on the left; fly-to keeps the subject in the free area. */
  readonly panelOffset: number
}

export interface World {
  update(view: WorldView): void
  zoomBy(f: number): void
  rotateBy(rad: number): void
  home(): void
  dispose(): void
}

const HOME = { target: new THREE.Vector3(0, 0, 0), az: Math.PI / 4, pol: 0.95, r: 150 }
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export function createWorld(el: HTMLElement, onSelect: (pick: Pick | null) => void): World {
  const W = () => el.clientWidth || 1
  const H = () => el.clientHeight || 1
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.setSize(W(), H())
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.domElement.style.display = "block"
  el.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(THEMES.light.bg)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = envTexture

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 1000)
  const setCam = () => {
    const a = W() / H()
    cam.left = (-FRUSTUM * a) / 2
    cam.right = (FRUSTUM * a) / 2
    cam.top = FRUSTUM / 2
    cam.bottom = -FRUSTUM / 2
    cam.updateProjectionMatrix()
  }
  setCam()
  cam.position.copy(HOME.target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(HOME.r, HOME.pol, HOME.az)))
  const controls = new OrbitControls(cam, renderer.domElement)
  controls.target.copy(HOME.target)
  cam.lookAt(HOME.target)
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.12, screenSpacePanning: false, minPolarAngle: 0.5, maxPolarAngle: 1.15, minZoom: 0.6, maxZoom: 5, zoomSpeed: 0.25, zoomToCursor: true })
  // The left button and one finger drag the FLOOR (below): the point taken
  // hold of stays under the pointer, however the camera is tilted or zoomed.
  // OrbitControls' own pan moved the floor by a fraction of the drag, which
  // read as "the map will not go where I pull it". Wheel zooms, right rotates.
  controls.enablePan = false
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
  controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE }

  const hemi = new THREE.HemisphereLight(0xffffff, 0xcfd8ea, 0.55)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xfff8f0, 1.6)
  sun.position.set(-30, 70, 40)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0005
  sun.shadow.radius = 4
  scene.add(sun)

  const assets = makeAssets()
  const shared = new Set<THREE.BufferGeometry | THREE.Material>([...Object.values(assets.geo), ...Object.values(assets.mats)])
  let theme: Theme = THEMES.light
  let themeName: "light" | "dark" = "light"
  const pickables: THREE.Object3D[] = []
  const builder: Builder = { assets, scene, pickables, theme: () => theme }

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), assets.mat(theme.ground, { roughness: 1 }))
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)
  const floorMat = assets.mat(theme.floor, { roughness: 0.95 })
  let floor: THREE.Group | null = null
  let floorKey = ""
  /** The zoom that frames the whole floor from the home angle. */
  let homeZoom = 1
  let framed = false

  /** The slab, grid, two low walls and plants, sized to the layout. */
  function buildFloor(layout: FloorLayout) {
    const { minX, maxX, minZ, maxZ } = layout.bounds
    const key = [minX, maxX, minZ, maxZ].map((n) => n.toFixed(1)).join(",")
    if (key === floorKey) return
    floorKey = key
    if (floor) removeGroup(builder, floor, new Set([...shared, floorMat]))
    const g = new THREE.Group()
    const w = maxX - minX
    const d = maxZ - minZ
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), floorMat)
    slab.position.set(cx, 0.15, cz)
    slab.receiveShadow = true
    g.add(slab)
    const lines = Math.max(2, Math.round(Math.max(w, d) / 2))
    const gridColor = themeName === "dark" ? 0x171d29 : 0xe6ebf3
    const grid = new THREE.GridHelper(Math.max(w, d), lines, gridColor, gridColor)
    grid.position.set(cx, 0.31, cz)
    grid.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d))
    g.add(grid)
    const wallA = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, 0.5), assets.mats.wall)
    wallA.position.set(cx, 1.1, minZ)
    const wallB = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, d), assets.mats.wall)
    wallB.position.set(minX, 1.1, cz)
    for (const wall of [wallA, wallB]) {
      wall.castShadow = wall.receiveShadow = true
      g.add(wall)
    }
    for (const [x, z] of [[minX + 4, minZ + 4], [cx, minZ + 4], [maxX - 4, minZ + 4], [minX + 4, cz], [minX + 4, maxZ - 4]] as const) {
      const pot = new THREE.Mesh(assets.geo.pot, assets.mats.pot)
      pot.position.set(x, 0.85, z)
      const leaf = new THREE.Mesh(assets.geo.leaf, assets.mats.leaf)
      leaf.position.set(x, 2.4, z)
      pot.castShadow = leaf.castShadow = true
      g.add(pot, leaf)
    }
    scene.add(g)
    floor = g
    homeZoom = fitZoom(w, d, W() / H())
    if (!framed) {
      framed = true
      cam.zoom = homeZoom
      cam.updateProjectionMatrix()
    }
    const half = Math.max(w, d) / 2 + 10
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 260 })
    sun.target.position.set(cx, 0, cz)
    sun.position.set(cx - 30, 70, cz + 40)
    scene.add(sun.target)
    sun.shadow.camera.updateProjectionMatrix()
  }

  function setTheme(name: "light" | "dark") {
    theme = THEMES[name]
    themeName = name
    ;(scene.background as THREE.Color).setHex(theme.bg)
    ;(ground.material as THREE.MeshStandardMaterial).color.setHex(theme.ground)
    floorMat.color.setHex(theme.floor)
    assets.mats.wall.color.setHex(theme.wall)
    assets.mats.pot.color.setHex(theme.pot)
    assets.mats.desk.color.setHex(theme.desk)
    assets.mats.deskTop.color.setHex(theme.deskTop)
    assets.mats.chair.color.setHex(theme.chair)
    hemi.intensity = theme.hemi
    sun.intensity = theme.sun
    renderer.toneMappingExposure = theme.exposure
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material
      if (m instanceof THREE.MeshStandardMaterial) m.envMapIntensity = theme.env
    })
    floorKey = ""
    for (const [key, c] of clusters) c.rugMat.color.copy(new THREE.Color(theme.rug).lerp(new THREE.Color(hueOf.get(key) ?? "#ffffff"), theme.mix))
  }

  const monitors = new Map<string, Monitor>()
  const clusters = new Map<string, ClusterNode>()
  const singles = new Map<string, SingleNode>()
  const hueOf = new Map<string, string>()
  /** What each built cluster was built from: members, hue and place. */
  const signatureOf = new Map<string, string>()
  /** Accounts seen by an earlier update: a later arrival boots its screen. */
  const seen = new Set<string>()
  let firstUpdate = true

  const selFrame = new THREE.Mesh(new THREE.BoxGeometry(1.78, 1.16, 0.04), new THREE.MeshBasicMaterial({ color: 0x3b6fe0 }))
  selFrame.visible = false
  scene.add(selFrame)

  const labels = createLabels(el, (key) => onSelect({ type: "cluster", key }))
  const parts: Array<{ s: THREE.Sprite; t: number; y0: number }> = []
  function emit(pos: THREE.Vector3, color: number) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: assets.tick, color, transparent: true, depthTest: false }))
    s.scale.setScalar(0.45)
    s.position.copy(pos)
    s.renderOrder = 5
    scene.add(s)
    parts.push({ s, t: 0, y0: pos.y })
  }

  let view: WorldView | null = null
  let lastSel = ""
  let hovered: string | null = null

  function syncScene(v: WorldView) {
    buildFloor(v.layout)
    const isNew = (id: string) => !firstUpdate && !seen.has(id)
    const byCluster = new Map<string, WorldAccount[]>()
    const solo: WorldAccount[] = []
    for (const a of v.accounts) {
      if (a.cluster) byCluster.set(a.cluster, [...(byCluster.get(a.cluster) ?? []), a])
      else solo.push(a)
    }
    // Every removal before any build: an account that moved (single → cluster,
    // cluster → cluster) must not have its new screen forgotten by the old desk.
    const plan = v.clusters.flatMap((c) => {
      const pos = v.layout.clusters.get(c.key)
      if (!pos) return []
      const members = byCluster.get(c.key) ?? []
      const signature = `${members.map((m) => m.id).join(",")}|${c.hue}|${pos.x.toFixed(2)},${pos.z.toFixed(2)}`
      return [{ c, pos, members, signature }]
    })
    const keep = new Map(plan.map((p) => [p.c.key, p.signature]))
    for (const [key, node] of clusters) {
      if (keep.get(key) === signatureOf.get(key)) continue
      removeGroup(builder, node.group, shared)
      node.ids.forEach((id) => monitors.delete(id))
      clusters.delete(key)
      signatureOf.delete(key)
    }
    const soloIds = new Set(solo.map((a) => a.id))
    for (const [id, node] of singles) {
      if (soloIds.has(id)) continue
      removeGroup(builder, node.g, shared)
      monitors.delete(id)
      singles.delete(id)
    }
    for (const { c, pos, members, signature } of plan) {
      if (clusters.has(c.key)) continue
      hueOf.set(c.key, c.hue)
      signatureOf.set(c.key, signature)
      clusters.set(c.key, buildCluster(builder, { key: c.key, hue: c.hue, links: c.links, x: pos.x, z: pos.z, members }, monitors, isNew))
    }
    solo.forEach((a, i) => {
      const at = singleDesk(v.layout, i)
      const node = singles.get(a.id)
      if (node) node.g.position.set(at.x, 0.3, at.z)
      else singles.set(a.id, buildSingle(builder, a.id, i, at, monitors, isNew(a.id)))
    })
    for (const a of v.accounts) seen.add(a.id)
    firstUpdate = false
  }

  function update(v: WorldView) {
    view = v
    if (v.theme !== themeName) setTheme(v.theme)
    syncScene(v)
    for (const a of v.accounts) {
      const m = monitors.get(a.id)
      if (!m) continue
      m.act = a.act
      m.state = a.state
      const off = a.act === "offline"
      // A clustered account's screen runs a live session (the farm at work),
      // dimmed while the account is offline; a single desk shows the still
      // app mock, dark while offline.
      m.screenMat.map = a.cluster ? assets.live(a.state, a.id) : off ? assets.off : assets.screens[a.state]
      m.prog.visible = m.progBg.visible = a.act === "generating"
      m.progMat.color.setHex(PROGRESS[a.state])
      m.dim = a.op < 1 ? 0.35 : off && a.cluster ? 0.55 : 1
      m.screenMat.color.setScalar(m.dim)
      const single = singles.get(a.id)
      if (single) single.body.forEach((o) => (o.visible = !off))
    }
    const showSingles = v.show === "all" || v.show === "legit"
    for (const s of singles.values()) s.g.visible = showSingles
    for (const c of v.clusters) {
      const node = clusters.get(c.key)
      if (!node) continue
      node.group.visible = c.visible
      const anyOn = node.ids.some((id) => monitors.get(id)?.act !== "offline")
      node.body.forEach((o) => (o.visible = anyOn))
      const sel = v.selectedCluster === c.key
      node.glowMat.opacity = sel ? 0.25 : 0
      for (const [type, lineMat] of Object.entries(node.cables)) lineMat.opacity = sel ? 0.6 : v.link === type ? 0.55 : 0
    }
    labels.render(v, singles.size)
    const selKey = v.selected ? `${v.selected.type}:${v.selected.type === "cluster" ? v.selected.key : v.selected.id}` : ""
    if (selKey !== lastSel) {
      lastSel = selKey
      const sel = v.selected
      if (sel?.type === "cluster") {
        const node = clusters.get(sel.key)
        if (node) {
          const z = clusterZoom(node.r)
          animateTo(shifted(node.focus.clone(), z), z)
        }
      } else if (sel?.type === "account") {
        const m = monitors.get(sel.id)
        if (m) {
          const p = new THREE.Vector3()
          m.g.getWorldPosition(p)
          const z = accountZoom(cam.zoom)
          animateTo(shifted(p.setY(0), z), z)
        }
      }
    }
  }

  function shifted(target: THREE.Vector3, zoom: number): THREE.Vector3 {
    const off = view?.panelOffset ?? 0
    if (!off) return target
    const unitsPerPixel = FRUSTUM / zoom / H()
    const right = new THREE.Vector3()
    cam.getWorldDirection(right)
    right.cross(UP).normalize()
    return target.clone().add(right.multiplyScalar((-off / 2) * unitsPerPixel)).setY(0)
  }

  let anim: { t0: number; fT: THREE.Vector3; tT: THREE.Vector3; fZ: number; tZ: number; fs: THREE.Spherical; tTheta: number; tPhi: number } | null = null
  function animateTo(target: THREE.Vector3 | null, zoom: number | null, theta?: number, phi?: number) {
    const fs = new THREE.Spherical().setFromVector3(cam.position.clone().sub(controls.target))
    let tt = theta ?? fs.theta
    while (tt - fs.theta > Math.PI) tt -= 2 * Math.PI
    while (fs.theta - tt > Math.PI) tt += 2 * Math.PI
    anim = { t0: performance.now(), fT: controls.target.clone(), tT: target ?? controls.target.clone(), fZ: cam.zoom, tZ: zoom ?? cam.zoom, fs, tTheta: tt, tPhi: phi ?? fs.phi }
  }

  const ray = new THREE.Raycaster()
  const ptr = new THREE.Vector2()
  const pick = (e: PointerEvent): Pick | null => {
    const r = renderer.domElement.getBoundingClientRect()
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(ptr, cam)
    const hit = ray.intersectObjects(pickables, false).find((h) => h.object.visible && isShown(h.object))
    return (hit?.object.userData.pick as Pick | undefined) ?? null
  }
  const isShown = (o: THREE.Object3D): boolean => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false
    return true
  }
  /** Where the pointer's ray meets the floor plane, or null when it looks past it. */
  const floorPlane = new THREE.Plane(UP.clone(), 0)
  const hitFloor = (e: PointerEvent): THREE.Vector3 | null => {
    const r = renderer.domElement.getBoundingClientRect()
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(ptr, cam)
    const out = new THREE.Vector3()
    return ray.ray.intersectPlane(floorPlane, out) ? out : null
  }
  let down: [number, number] | null = null
  /** The floor point under the pointer when the left button went down — the drag keeps it there. */
  let held: THREE.Vector3 | null = null
  const onDown = (e: PointerEvent) => {
    down = [e.clientX, e.clientY]
    held = e.button === 0 ? hitFloor(e) : null
    if (held) {
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        // A synthetic pointer (tests, some touch stacks) has nothing to capture.
      }
    }
  }
  const onUp = (e: PointerEvent) => {
    if (held) {
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
        // Already released, or never captured.
      }
      held = null
      canvas.style.cursor = "grab"
    }
    if (!down) return
    const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1])
    down = null
    if (moved < 5 && e.button === 0) onSelect(pick(e))
  }
  const onCancel = () => {
    held = null
    down = null
    canvas.style.cursor = "grab"
  }
  const onMove = (e: PointerEvent) => {
    // `held` alone says a drag is on: the button mask is not trusted —
    // a synthesised pointer (automation, some touch stacks) moves with none.
    if (held) {
      const now = hitFloor(e)
      if (now) {
        const shift = held.clone().sub(now).setY(0)
        if (shift.lengthSq() > 0) {
          anim = null
          controls.target.add(shift)
          cam.position.add(shift)
          canvas.style.cursor = "grabbing"
        }
      }
      labels.tip(null)
      return
    }
    if (e.buttons) {
      labels.tip(null)
      return
    }
    const p = pick(e)
    hovered = p?.type === "account" ? p.id : null
    renderer.domElement.style.cursor = p ? "pointer" : "grab"
    const a = hovered ? view?.accounts.find((x) => x.id === hovered) : undefined
    const r = el.getBoundingClientRect()
    labels.tip(a ? { account: a, x: e.clientX - r.left + 14, y: e.clientY - r.top + 14 } : null)
  }
  const onLeave = () => {
    labels.tip(null)
    hovered = null
  }
  const onContext = (e: Event) => e.preventDefault()
  const canvas = renderer.domElement
  canvas.addEventListener("pointerdown", onDown)
  canvas.addEventListener("pointerup", onUp)
  canvas.addEventListener("pointercancel", onCancel)
  canvas.addEventListener("pointermove", onMove)
  canvas.addEventListener("pointerleave", onLeave)
  canvas.addEventListener("contextmenu", onContext)

  const wp = new THREE.Vector3()
  const toScreen = (p: THREE.Vector3): [number, number] => {
    const v3 = p.clone().project(cam)
    return [((v3.x + 1) / 2) * W(), ((1 - v3.y) / 2) * H()]
  }
  let raf = 0
  let last = performance.now()
  function frame(now: number) {
    const size = renderer.getSize(new THREE.Vector2())
    if (el.clientWidth && el.clientHeight && (size.x !== el.clientWidth || size.y !== el.clientHeight)) {
      renderer.setSize(el.clientWidth, el.clientHeight)
      setCam()
    }
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const t = now / 1000
    if (anim) {
      const k = ease(Math.min(1, (now - anim.t0) / 800))
      controls.target.lerpVectors(anim.fT, anim.tT, k)
      cam.zoom = anim.fZ + (anim.tZ - anim.fZ) * k
      const s = new THREE.Spherical(anim.fs.radius, anim.fs.phi + (anim.tPhi - anim.fs.phi) * k, anim.fs.theta + (anim.tTheta - anim.fs.theta) * k)
      cam.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s))
      cam.lookAt(controls.target)
      cam.updateProjectionMatrix()
      if (k >= 1) anim = null
    } else controls.update()

    assets.tickLive(now)
    for (const [id, m] of monitors) {
      if (m.act === "generating") {
        m.progress += dt * 0.32
        if (m.progress >= 1) {
          m.progress = 0
          m.g.getWorldPosition(wp)
          wp.y += 0.75
          if (isShown(m.g)) emit(wp, PROGRESS[m.state as AccountState] ?? 0xffffff)
        }
        m.prog.scale.x = Math.max(0.02, m.progress)
      }
      if (m.boot > 0) {
        m.boot -= dt
        m.screenMat.color.setScalar(m.boot > 0.2 ? (Math.random() > 0.5 ? 1 : 0.15) : m.dim)
      }
      const target = hovered === id ? 1.08 : 1
      m.g.scale.setScalar(m.g.scale.x + (target - m.g.scale.x) * Math.min(1, dt * 12))
    }
    for (const s of singles.values()) {
      if (s.born < 1) {
        s.born = Math.min(1, s.born + dt * 2.2)
        const k = s.born
        s.g.scale.setScalar(k < 0.7 ? (k / 0.7) * 1.1 : 1.1 - ((k - 0.7) / 0.3) * 0.1)
      }
    }
    for (const node of clusters.values()) {
      if (node.led) node.led.visible = Math.sin(t * 9 + node.seed) > -0.2
      const busy = node.ids.map((id) => monitors.get(id)).filter((m): m is Monitor => m?.act === "generating")
      const target = busy.length ? busy[Math.floor(t / 2.5 + node.seed) % busy.length]!.angle : node.baseAngle
      const dA = ((target - node.person.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI
      node.person.rotation.y += dA * Math.min(1, dt * 3)
      node.body[1]!.position.y = 2.02 + (busy.length ? Math.sin(t * 7) * 0.025 : 0)
    }
    for (const [id, s] of singles) {
      const m = monitors.get(id)
      s.body[1]!.position.y = 2.02 + (m?.act === "generating" ? Math.sin(t * 7 + s.g.position.x) * 0.03 : 0)
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i]!
      q.t += dt
      q.s.position.y = q.y0 + q.t * 1.3
      q.s.material.opacity = Math.max(0, 1 - q.t)
      if (q.t >= 1) {
        scene.remove(q.s)
        q.s.material.dispose()
        parts.splice(i, 1)
      }
    }
    if (view) {
      const sel = view.selected
      const m = sel?.type === "account" ? monitors.get(sel.id) : undefined
      selFrame.visible = Boolean(m && isShown(m.g))
      if (m) {
        m.g.getWorldPosition(wp)
        selFrame.position.copy(wp)
        selFrame.quaternion.copy(m.g.getWorldQuaternion(new THREE.Quaternion()))
        selFrame.translateZ(-0.03)
        selFrame.scale.setScalar(m.g.scale.x * (1 + Math.sin(t * 5) * 0.02))
      }
      labels.place({
        view,
        toScreen,
        clusterAnchor: (key) => clusters.get(key)?.labelPos ?? null,
        singlesAnchor: () => {
          if (!singles.size || !view) return null
          const first = singleDesk(view.layout, 0)
          const lastCol = singleDesk(view.layout, Math.min(8, singles.size - 1))
          return new THREE.Vector3((first.x + lastCol.x) / 2, 2.5, first.z - 2.5)
        },
        accountAnchor: m ? wp.clone().setY(wp.y + 0.7) : null,
        width: W(),
        height: H(),
      })
    }
    renderer.render(scene, cam)
  }
  function loop(now: number) {
    raf = requestAnimationFrame(loop)
    frame(now)
  }
  raf = requestAnimationFrame(loop)

  return {
    update,
    zoomBy: (f) => animateTo(null, clampZoom(cam.zoom * f)),
    rotateBy: (d) => {
      const s = new THREE.Spherical().setFromVector3(cam.position.clone().sub(controls.target))
      animateTo(null, null, s.theta + d)
    },
    home: () => animateTo(HOME.target.clone(), homeZoom, HOME.az, HOME.pol),
    dispose: () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener("pointerdown", onDown)
      canvas.removeEventListener("pointerup", onUp)
      canvas.removeEventListener("pointercancel", onCancel)
      canvas.removeEventListener("pointermove", onMove)
      canvas.removeEventListener("pointerleave", onLeave)
      canvas.removeEventListener("contextmenu", onContext)
      controls.dispose()
      for (const node of clusters.values()) removeGroup(builder, node.group, shared)
      for (const s of singles.values()) removeGroup(builder, s.g, shared)
      if (floor) removeGroup(builder, floor, shared)
      assets.dispose()
      ground.geometry.dispose()
      ;(ground.material as THREE.Material).dispose()
      selFrame.geometry.dispose()
      ;(selFrame.material as THREE.Material).dispose()
      floorMat.dispose()
      for (const q of parts) q.s.material.dispose()
      envTexture.dispose()
      pmrem.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      labels.dispose()
      el.replaceChildren()
    },
  }
}
