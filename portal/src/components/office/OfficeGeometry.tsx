import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { getAmphibDeskPositions, getOpsTableColor } from '@/lib/office'

interface OfficeGeometryProps {
  scene: THREE.Scene
  runningDeskIndices?: number[]
  pendingApprovalCount?: number
  totalOps?: number
  hasEscalation?: boolean
}

function mat(color: number, rough = 0.6, metal = 0, emit = 0, emitColor?: number) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: rough,
    metalness: metal,
    emissive: emitColor ?? color,
    emissiveIntensity: emit,
  })
}

const DESK_COUNT = 5
const AMFI_POSITIONS = getAmphibDeskPositions(DESK_COUNT)

// ── Room constants ──────────────────────────────────────────────────────────
const ROOM_W  = 36   // x: -18..+18
const ROOM_D  = 28   // z: -14..+14
const ROOM_H  = 6    // ceiling y
const BACK_Z  = -14  // back wall z
const CEIL_Y  = ROOM_H

export default function OfficeGeometry({
  scene,
  runningDeskIndices = [],
  pendingApprovalCount = 0,
  totalOps = 0,
  hasEscalation = false,
}: OfficeGeometryProps) {

  // ── Static geometry ─────────────────────────────────────────────────────────
  useEffect(() => {

    // ── FLOOR — warm wood parquet ─────────────────────────────────────────
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_W, ROOM_D),
      mat(0x9a7b5f, 0.7, 0.05)
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, 0, 0)
    floor.receiveShadow = true
    scene.add(floor)

    // Center carpet under ops table
    const carpet = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 9),
      mat(0x334155, 0.9, 0)
    )
    carpet.rotation.x = -Math.PI / 2
    carpet.position.set(0, 0.005, 0)
    carpet.receiveShadow = true
    scene.add(carpet)

    // ── CEILING — dollhouse: normal faces down, FrontSide → camera above can't see it ──
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_W, ROOM_D),
      mat(0xcbd5e1, 0.8, 0)
    )
    ceiling.rotation.x = Math.PI / 2   // normal → -Y (down) — invisible from camera above
    ceiling.position.set(0, CEIL_Y, 0)
    scene.add(ceiling)

    // 6 recessed spot discs on ceiling
    const spotPositions: [number, number][] = [
      [-9, -4], [0, -4], [9, -4],
      [-9,  4], [0,  4], [9,  4],
    ]
    spotPositions.forEach(([sx, sz]) => {
      // Dark housing cylinder — gömme armatür gövdesi
      const housing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 0.06, 16),
        mat(0x334155, 0.5, 0.3)
      )
      housing.position.set(sx, CEIL_Y - 0.03, sz)
      scene.add(housing)

      // Bright emissive disc inside housing (smaller: 0.22→0.12)
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.01, 16),
        mat(0xfff7ed, 0.1, 0.1, 1.2, 0xfff4e0)
      )
      disc.position.set(sx, CEIL_Y - 0.055, sz)
      scene.add(disc)

      const spot = new THREE.SpotLight(0xfff4e0, 0.6, 8, Math.PI / 4, 0.6)
      spot.position.set(sx, CEIL_Y - 0.08, sz)
      spot.target.position.set(sx, 0, sz)
      scene.add(spot)
      scene.add(spot.target)
    })

    // ── WALLS (3 — front open for camera) ────────────────────────────────
    const wallMat = mat(0x8a94a3, 0.9, 0)

    // Back wall
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W, ROOM_H, 0.3), wallMat)
    backWall.position.set(0, ROOM_H / 2, BACK_Z)
    backWall.receiveShadow = true
    scene.add(backWall)

    // Left wall
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.3, ROOM_H, ROOM_D), wallMat)
    leftWall.position.set(-ROOM_W / 2, ROOM_H / 2, 0)
    leftWall.receiveShadow = true
    scene.add(leftWall)

    // Right wall
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.3, ROOM_H, ROOM_D), wallMat)
    rightWall.position.set(ROOM_W / 2, ROOM_H / 2, 0)
    rightWall.receiveShadow = true
    scene.add(rightWall)

    // ── FAKE WINDOWS on back wall — glowing planes, no glass/outside plane ──
    // Mounted flush on inside face of back wall (z = BACK_Z + 0.16)
    const windowY = 3.5
    const windowPositions = [-10, 0, 10]
    windowPositions.forEach((wx) => {
      // Window frame
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(6.2, 3.7, 0.12),
        mat(0x475569, 0.6, 0.2)
      )
      frame.position.set(wx, windowY, BACK_Z + 0.18)
      scene.add(frame)

      // "Sky" — MeshBasicMaterial: light-independent, always bright regardless of scene lighting
      const skyPane = new THREE.Mesh(
        new THREE.PlaneGeometry(5.8, 3.4),
        new THREE.MeshBasicMaterial({ color: 0xbfdbfe })
      )
      skyPane.position.set(wx, windowY, BACK_Z + 0.25) // R4.2: çerçeve ön yüzü +0.24'te; cam ÖNDE olmalı (0.17'de kutu içinde gömülü kalıyordu)
      scene.add(skyPane)

      // Subtle window sill
      const sill = new THREE.Mesh(
        new THREE.BoxGeometry(6.0, 0.1, 0.25),
        mat(0x64748b, 0.5, 0.2)
      )
      sill.position.set(wx, windowY - 1.85, BACK_Z + 0.28)
      scene.add(sill)
    })

    // ── PENDANT LAMPS — desk (5) ──────────────────────────────────────────
    // PointLight count: 5 + 3 (ops) = 8 total ≤ 12
    const cableLen = 3.2
    const lampY    = CEIL_Y - cableLen   // ≈ 2.8

    AMFI_POSITIONS.forEach((pos) => {
      const { x, z } = pos

      // Cable
      const cable = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, cableLen, 8),
        mat(0x1e293b, 0.5, 0.4)
      )
      cable.position.set(x, CEIL_Y - cableLen / 2, z)
      scene.add(cable)

      // Shade (cone, opening downward — inverted)
      const shade = new THREE.Mesh(
        new THREE.ConeGeometry(0.32, 0.28, 16, 1, true),
        mat(0xfff4e0, 0.4, 0.05, 0.8, 0xfff4e0)
      )
      shade.position.set(x, lampY - 0.14, z)
      // R4.2: rotation gereksiz — ConeGeometry varsayılanı zaten tepe yukarı/ağız aşağı
      scene.add(shade)

      // PointLight — warm pool on desk
      const pl = new THREE.PointLight(0xffedd5, 0.8, 6)
      pl.position.set(x, lampY - 0.35, z)
      scene.add(pl)
    })

    // ── PENDANT LAMPS — ops table (3, arranged 120° apart) ───────────────
    const opsPendantR = 1.4
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2
      const px = Math.cos(angle) * opsPendantR
      const pz = Math.sin(angle) * opsPendantR

      const opsLen = 2.8
      const opsLampY = CEIL_Y - opsLen

      const cable = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, opsLen, 8),
        mat(0x1e293b, 0.5, 0.4)
      )
      cable.position.set(px, CEIL_Y - opsLen / 2, pz)
      scene.add(cable)

      const shade = new THREE.Mesh(
        new THREE.ConeGeometry(0.38, 0.3, 16, 1, true),
        mat(0xfff4e0, 0.4, 0.05, 0.8, 0xfff4e0)
      )
      shade.position.set(px, opsLampY - 0.15, pz)
      // R4.2: rotation gereksiz — varsayılan yön doğru
      scene.add(shade)

      const pl = new THREE.PointLight(0xffedd5, 0.7, 5)
      pl.position.set(px, opsLampY - 0.35, pz)
      scene.add(pl)
    }

    // ── FLOOR LAMP — front-left corner (dik, y-ekseninde) ────────────────
    const flX = -16, flZ = -9 // R4.3: ön köşede geniş açı perspektifi direği devrik gösteriyordu; arka köşede dik okunur
    const lampMat = mat(0x475569, 0.3, 0.6)

    // Base disc on floor
    const flBase = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.08, 16), lampMat)
    flBase.position.set(flX, 0.04, flZ)
    scene.add(flBase)

    // Vertical pole (y-axis aligned = upright)
    const poleH = 3.5
    const flPole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, poleH, 8), lampMat)
    flPole.position.set(flX, 0.08 + poleH / 2, flZ)  // base at y=0.08, pole extends up
    scene.add(flPole)

    // Shade at top — cone opens downward
    const flShade = new THREE.Mesh(
      new THREE.ConeGeometry(0.38, 0.32, 16, 1, true),
      mat(0xfff4e0, 0.4, 0.05, 0.8, 0xfff4e0)
    )
    flShade.position.set(flX, 0.08 + poleH - 0.08, flZ)
    // R4.2: rotation.x=π KALDIRILDI — ConeGeometry zaten tepe yukarı/ağız aşağı doğar;
    // çevirmek abajuru ters huniye döndürüp üstten beyaz "yelken" gibi gösteriyordu.
    scene.add(flShade)

    const flLight = new THREE.PointLight(0xffedd5, 0.7, 7)
    flLight.position.set(flX, 0.08 + poleH - 0.4, flZ)
    scene.add(flLight)

    // ── BOOKSHELVES — back wall flanks ────────────────────────────────────
    const shelfWood = mat(0x6b4f3a, 0.7, 0.05)
    // Sağ kitaplık x=15 → CEO odası içinde kalıyordu; sol duvara taşındı
    const shelfPositions = [
      { x: -15, z: BACK_Z + 0.65 },
      { x: -12, z: BACK_Z + 0.65 },
    ]
    const bookColors = [0xef4444, 0x3b82f6, 0x10b981, 0xf59e0b, 0x8b5cf6, 0xec4899]

    // Kitaplıklar: gövde arka duvara dayalı, raf yüzü odaya (z+ yönüne) bakıyor
    // body depth (z ekseni) = 0.38; arka duvara: z_back = BACK_Z + 0.19 (gövdenin yarısı)
    shelfPositions.forEach(({ x }) => {
      const bodyZ = BACK_Z + 0.19  // gövde sırtı duvara yapışık

      const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 4.2, 0.38), shelfWood)
      body.position.set(x, 2.1, bodyZ)
      body.castShadow = true
      scene.add(body)

      for (let shelf = 0; shelf < 4; shelf++) {
        const sy = 0.6 + shelf * 1.0

        // Shelf board
        const board = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.05, 0.32), shelfWood)
        board.position.set(x, sy, bodyZ)
        scene.add(board)

        // Books facing front (+Z)
        const bookCount = 5 + (shelf % 2)
        const bookW = 2.1 / bookCount
        for (let b = 0; b < bookCount; b++) {
          const bx = x - 1.05 + bookW * b + bookW / 2
          const bookH = 0.28 + (b % 3) * 0.05   // deterministic height variation
          const book = new THREE.Mesh(
            new THREE.BoxGeometry(bookW - 0.02, bookH, 0.26),
            mat(bookColors[(shelf * bookCount + b) % bookColors.length], 0.8, 0)
          )
          book.position.set(bx, sy + bookH / 2 + 0.025, bodyZ)
          scene.add(book)
        }
      }
    })

    // ── COFFEE CORNER — left back (CEO odası alanından taşındı) ─────────
    const ccX = -16, ccZ = -12
    const woodMat = mat(0x6b4f3a, 0.7, 0.05)

    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 0.7), woodMat)
    counter.position.set(ccX, 0.45, ccZ)
    counter.castShadow = true
    scene.add(counter)

    const counterTop = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 0.7), mat(0x1e293b, 0.2, 0.5))
    counterTop.position.set(ccX, 0.925, ccZ)
    scene.add(counterTop)

    // Coffee machine
    const machine = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.45, 0.3), mat(0x1e293b, 0.3, 0.6))
    machine.position.set(ccX - 0.7, 1.15, ccZ)
    machine.castShadow = true
    scene.add(machine)

    const machineLed = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.02), mat(0x4ade80, 0.1, 0, 1.5, 0x4ade80))
    machineLed.position.set(ccX - 0.7, 1.3, ccZ - 0.16)
    scene.add(machineLed)

    // 2 cups
    const cupMat = mat(0xf5e6d3, 0.4, 0.1)
    ;[0.3, 0.65].forEach((ox) => {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 10), cupMat)
      cup.position.set(ccX + ox, 0.975, ccZ)
      scene.add(cup)

      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.013, 6, 8), cupMat)
      handle.position.set(ccX + ox + 0.09, 0.99, ccZ)
      handle.rotation.z = Math.PI / 2
      scene.add(handle)
    })

    // ── LARGE POTTED PLANTS — window sills ───────────────────────────────
    const potMat  = mat(0xa16207, 0.7, 0)
    const leafMat = mat(0x4a7c59, 0.6, 0)

    // Sağ bitki x=10 CEO odasının önünde — ortak alana kaydırıldı
    const plantPositions = [
      { x: -10, z: BACK_Z + 1.2 },
      { x:   0, z: BACK_Z + 1.2 },
      { x:   5, z:  -3 },          // ortak alanda
    ]
    plantPositions.forEach(({ x, z }) => {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.4, 14), potMat)
      pot.position.set(x, 0.2, z)
      scene.add(pot)

      // Foliage — 3 overlapping spheres
      ;[
        [0, 0.6, 0, 1.0],
        [-0.18, 0.7, -0.1, 0.85],
        [0.15, 0.75, 0.08, 0.8],
      ].forEach(([ox, oy, oz, s]) => {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.22 * s, 8, 8), leafMat)
        leaf.position.set(x + ox, 0.4 + oy, z + oz)
        leaf.castShadow = true
        scene.add(leaf)
      })
    })

    // ── WALL ART — side walls ─────────────────────────────────────────────
    // Tablolar: yan duvarlara bitişik, odaya dönük (ry=±π/2 → yüz +Z'ye bakar)
    const artData = [
      { x: -17.85, z:  2, ry:  Math.PI / 2, colors: [0x6366f1, 0x7dd3fc, 0xf0abfc] },
      { x:  17.85, z: -2, ry: -Math.PI / 2, colors: [0xfb923c, 0xfde68a, 0xa3e635] },
    ]
    artData.forEach(({ x, z, ry, colors }) => {
      // Frame: BoxGeometry(depth, height, width) — thin slab against wall
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 1.6, 2.4),
        mat(0x475569, 0.5, 0.2)
      )
      frame.position.set(x, 3.0, z)
      frame.rotation.y = ry
      scene.add(frame)

      // 3 color panels side by side on the canvas face
      colors.forEach((c, i) => {
        const panel = new THREE.Mesh(
          new THREE.PlaneGeometry(0.72, 1.35),
          new THREE.MeshBasicMaterial({ color: c })
        )
        // Offset panels along local Z of frame (world-Z for left wall)
        const sign = ry > 0 ? 1 : -1
        panel.position.set(
          x + sign * 0.04,
          3.0,
          z - 0.72 + i * 0.72
        )
        panel.rotation.y = ry
        scene.add(panel)
      })
    })

    // ── AMPHITHEATER DESKS ────────────────────────────────────────────────
    const deskSurfMat  = mat(0x1e293b, 0.25, 0.5)
    const deskFrameMat = mat(0x334155, 0.2, 0.8)
    const monitorMat   = mat(0x0f172a, 0.3, 0.5)
    const screenColors = [0x3b82f6, 0x8b5cf6, 0x06b6d4, 0x10b981, 0xf59e0b]

    AMFI_POSITIONS.forEach((pos, idx) => {
      const { x, z } = pos

      const surface = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.06, 1.8), deskSurfMat)
      surface.position.set(x, 0.8, z)
      surface.castShadow = true
      surface.receiveShadow = true
      scene.add(surface)

      const angleToCenter = Math.atan2(-z, -x)
      const edgeX = x + Math.cos(angleToCenter) * 0.9
      const edgeZ = z + Math.sin(angleToCenter) * 0.9
      const edgeMat = mat(0x7dd3fc, 0.4, 0.2, 0.4, 0x93c5fd)
      const edge = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.03, 0.03), edgeMat)
      edge.position.set(edgeX, 0.82, edgeZ)
      scene.add(edge)

      const legOffsets: [number, number][] = [[-1.4, -0.8], [1.4, -0.8], [-1.4, 0.8], [1.4, 0.8]]
      legOffsets.forEach(([lx, lz]) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.06), deskFrameMat)
        leg.position.set(x + lx, 0.4, z + lz)
        leg.castShadow = true
        scene.add(leg)
      })

      const screenColor = screenColors[idx]
      const monitor = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.75, 0.04), monitorMat)
      monitor.position.set(x, 1.55, z - 0.3)
      monitor.castShadow = true
      scene.add(monitor)

      const screenMat = mat(screenColor, 0.1, 0, 0.7, screenColor)
      const screen = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.68, 0.01), screenMat)
      screen.position.set(x, 1.55, z - 0.278)
      scene.add(screen)

      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.05), deskFrameMat)
      stand.position.set(x, 1.1, z - 0.25)
      scene.add(stand)

      const screenLight = new THREE.PointLight(screenColor, 0.4, 3)
      screenLight.position.set(x, 1.55, z - 0.1)
      scene.add(screenLight)
    })

    // ── SMALL MEETING TABLE + STOOLS — ortak alan (-11, 0, -8) ──────────
    const mtX = -11, mtZ = -8
    const mtTable = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.75, 0.06, 24),
      mat(0x6b4f3a, 0.7, 0.05)
    )
    mtTable.position.set(mtX, 0.72, mtZ)
    scene.add(mtTable)

    for (let s = 0; s < 3; s++) {
      const sa = (s / 3) * Math.PI * 2
      const stool = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 0.4, 12),
        mat(0x334155, 0.6, 0.1)
      )
      stool.position.set(mtX + Math.cos(sa) * 1.2, 0.2, mtZ + Math.sin(sa) * 1.2)
      scene.add(stool)
      // Stool top pad
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(0.23, 0.23, 0.06, 12),
        mat(0x475569, 0.7, 0)
      )
      pad.position.set(mtX + Math.cos(sa) * 1.2, 0.42, mtZ + Math.sin(sa) * 1.2)
      scene.add(pad)
    }

    // ── CEO ROOM — sağ-arka köşe x∈[8,18] z∈[-14,-6] ───────────────────
    const CEO_X0 = 8, CEO_Z0 = -6    // sol-ön köşe
    const GLASS_H = 4

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xbfdbfe,
      transparent: true,
      opacity: 0.13,
      roughness: 0.05,
      metalness: 0.0,
    })
    const frameMat2 = mat(0x475569, 0.4, 0.3)

    // Sol cam bölme (x=8, z=-14 → z=-6, tam boy)
    const leftGlass = new THREE.Mesh(new THREE.BoxGeometry(0.06, GLASS_H, 8), glassMat)
    leftGlass.position.set(CEO_X0, GLASS_H / 2, (BACK_Z + CEO_Z0) / 2)  // z mid: -10
    scene.add(leftGlass)

    // Ön cam bölme (z=-6, x=10 → x=18, kapı boşluğu x=8-10 → yok)
    const frontGlass = new THREE.Mesh(new THREE.BoxGeometry(8, GLASS_H, 0.06), glassMat)
    frontGlass.position.set(14, GLASS_H / 2, CEO_Z0)  // x mid of 10..18 = 14
    scene.add(frontGlass)

    // Dikme — sol-ön köşe
    const post1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, GLASS_H, 0.1), frameMat2)
    post1.position.set(CEO_X0, GLASS_H / 2, CEO_Z0)
    scene.add(post1)

    // Dikme — kapı kenarı (x=10, z=-6)
    const post2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, GLASS_H, 0.1), frameMat2)
    post2.position.set(10, GLASS_H / 2, CEO_Z0)
    scene.add(post2)

    // Üst ray — sol bölme
    const topRail1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 8), frameMat2)
    topRail1.position.set(CEO_X0, GLASS_H, (BACK_Z + CEO_Z0) / 2)
    scene.add(topRail1)

    // Üst ray — ön bölme
    const topRail2 = new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 0.06), frameMat2)
    topRail2.position.set(14, GLASS_H, CEO_Z0)
    scene.add(topRail2)

    // CEO halısı
    const ceoFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(8.5, 7),
      mat(0x1e3a5f, 0.9, 0)
    )
    ceoFloor.rotation.x = -Math.PI / 2
    ceoFloor.position.set(13.5, 0.006, -10)
    scene.add(ceoFloor)

    // Yönetici masası
    const ceoDesk = new THREE.Mesh(
      new THREE.BoxGeometry(3.6, 0.08, 1.8),
      mat(0x5d4a37, 0.5, 0.1)
    )
    ceoDesk.position.set(14, 0.8, -10)
    ceoDesk.castShadow = true
    scene.add(ceoDesk)

    // Masa bacakları
    ;[[-1.6,-0.8],[1.6,-0.8],[-1.6,0.8],[1.6,0.8]].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.8, 0.07), mat(0x3b2a1a, 0.4, 0.2))
      leg.position.set(14 + lx, 0.4, -10 + lz)
      scene.add(leg)
    })

    // Arkalıklı koltuk
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.12, 16), mat(0x1e293b, 0.6, 0.1))
    seat.position.set(14, 0.46, -9.0)
    scene.add(seat)
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.7, 0.08), mat(0x1e293b, 0.6, 0.1))
    back.position.set(14, 0.82, -8.65)
    scene.add(back)

    // CEO monitörü
    const ceoMonitor = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.85, 0.04), mat(0x0f172a, 0.3, 0.5))
    ceoMonitor.position.set(14, 1.5, -10.55)
    scene.add(ceoMonitor)
    const ceoScreen = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.78, 0.01), mat(0x6366f1, 0.1, 0, 0.7, 0x818cf8))
    ceoScreen.position.set(14, 1.5, -10.528)
    scene.add(ceoScreen)

    // CEO masa lambası (sarkıt)
    const ceoLampLen = 3.2
    const ceoCable = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, ceoLampLen, 8), mat(0x1e293b, 0.5, 0.4))
    ceoCable.position.set(14, CEIL_Y - ceoLampLen / 2, -10)
    scene.add(ceoCable)
    const ceoShade = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.28, 16, 1, true), mat(0xfff4e0, 0.4, 0.05, 0.8, 0xfff4e0))
    ceoShade.position.set(14, CEIL_Y - ceoLampLen - 0.14, -10)
    ceoShade.rotation.x = Math.PI
    scene.add(ceoShade)
    const ceoLight = new THREE.PointLight(0xffedd5, 0.9, 7)
    ceoLight.position.set(14, CEIL_Y - ceoLampLen - 0.35, -10)
    scene.add(ceoLight)

    // CEO odasına küçük tablo (arka duvar iç yüzü)
    const ceoFrame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 0.06), mat(0x475569, 0.5, 0.2))
    ceoFrame.position.set(14, 3.0, BACK_Z + 0.12)
    scene.add(ceoFrame)
    const ceoPainting = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 0.98), new THREE.MeshBasicMaterial({ color: 0x4338ca }))
    ceoPainting.position.set(14, 3.0, BACK_Z + 0.16)
    scene.add(ceoPainting)

    // ── CENTER OPERATIONS TABLE ───────────────────────────────────────────
    const opsTable = new THREE.Mesh(
      new THREE.CylinderGeometry(3.5, 3.5, 0.4, 32),
      mat(0x334155, 0.25, 0.5, 0.15, 0x6366f1)
    )
    opsTable.position.set(0, 0.2, 0)
    opsTable.castShadow = true
    opsTable.receiveShadow = true
    scene.add(opsTable)

    const tableEdge = new THREE.Mesh(
      new THREE.TorusGeometry(3.5, 0.05, 8, 64),
      mat(0x818cf8, 0.2, 0.3, 0.7, 0xa5b4fc)
    )
    tableEdge.rotation.x = Math.PI / 2
    tableEdge.position.set(0, 0.42, 0)
    scene.add(tableEdge)

    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 2.0, 12),
      mat(0x6366f1, 0.1, 0.6, 0.8, 0x818cf8)
    )
    pillar.position.set(0, 1.4, 0)
    scene.add(pillar)

    const centerLight = new THREE.PointLight(0x6366f1, 1.2, 10)
    centerLight.position.set(0, 2, 0)
    scene.add(centerLight)

    return () => {
      // Scene clear handled by Office3DScene on unmount
    }
  }, [scene])

  const runningKey = useMemo(() => runningDeskIndices.slice().sort().join(','), [runningDeskIndices])

  // ── Dynamic objects (desk rings, approval badge, ops ring, particles) ───────
  useEffect(() => {
    const objects: THREE.Object3D[] = []
    let animId: number

    runningDeskIndices.forEach((idx) => {
      const pos = AMFI_POSITIONS[idx]
      if (!pos) return
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.2, 0.08, 8, 32),
        mat(0x3b82f6, 0.2, 0.1, 0.9, 0x60a5fa)
      )
      ring.rotation.x = Math.PI / 2
      ring.position.set(pos.x, 0.85, pos.z)
      scene.add(ring)
      objects.push(ring)
    })

    if (pendingApprovalCount > 0) {
      const badge = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 10, 10),
        mat(0xf59e0b, 0.2, 0.1, 1.2, 0xfbbf24)
      )
      badge.position.set(0, 2.8, 0)
      scene.add(badge)
      objects.push(badge)

      const badgeLight = new THREE.PointLight(0xf59e0b, 1.0, 5)
      badgeLight.position.set(0, 3.2, 0)
      scene.add(badgeLight)
      objects.push(badgeLight)
    }

    const clampedOps = Math.min(totalOps, 6)
    const opsRadius  = Math.min(clampedOps * 0.4 + 2, 4)
    const opsColor   = getOpsTableColor(hasEscalation)
    const opsRing    = new THREE.Mesh(
      new THREE.TorusGeometry(opsRadius, 0.12, 8, 48),
      mat(opsColor, 0.2, 0.1, 1.2, opsColor)
    )
    opsRing.rotation.x = Math.PI / 2
    opsRing.position.set(0, 0.7, 0)
    scene.add(opsRing)
    objects.push(opsRing)

    const PARTICLE_COUNT_PER_FLOW = runningDeskIndices.length > 0
      ? Math.min(40, Math.floor(200 / runningDeskIndices.length))
      : 0

    type ParticleGroup = {
      points: THREE.Points
      from: THREE.Vector3
      to: THREE.Vector3
      offsets: Float32Array
    }
    const particleGroups: ParticleGroup[] = []

    runningDeskIndices.forEach((idx) => {
      const deskPos = AMFI_POSITIONS[idx]
      if (!deskPos) return

      const from = new THREE.Vector3(0, 1, 0)
      const to   = new THREE.Vector3(deskPos.x, 1, deskPos.z)

      const positions = new Float32Array(PARTICLE_COUNT_PER_FLOW * 3)
      const offsets   = new Float32Array(PARTICLE_COUNT_PER_FLOW)

      for (let i = 0; i < PARTICLE_COUNT_PER_FLOW; i++) {
        offsets[i] = Math.random()
        const t = offsets[i]
        positions[i * 3]     = from.x + (to.x - from.x) * t
        positions[i * 3 + 1] = from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * 0.6
        positions[i * 3 + 2] = from.z + (to.z - from.z) * t
      }

      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x7dd3fc, size: 0.12, sizeAttenuation: true }))
      scene.add(pts)
      objects.push(pts)
      particleGroups.push({ points: pts, from, to, offsets })
    })

    const SPEED = 0.25
    const animate = () => {
      animId = requestAnimationFrame(animate)
      particleGroups.forEach(({ points, from, to, offsets }) => {
        const pos = points.geometry.attributes.position as THREE.BufferAttribute
        const arr = pos.array as Float32Array
        for (let i = 0; i < offsets.length; i++) {
          offsets[i] = (offsets[i] + SPEED / 60) % 1
          const t = offsets[i]
          arr[i * 3]     = from.x + (to.x - from.x) * t
          arr[i * 3 + 1] = from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * 0.6
          arr[i * 3 + 2] = from.z + (to.z - from.z) * t
        }
        pos.needsUpdate = true
      })
    }
    if (particleGroups.length > 0) animate()

    return () => {
      cancelAnimationFrame(animId)
      objects.forEach((o) => scene.remove(o))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, runningKey, pendingApprovalCount, totalOps, hasEscalation])

  return null
}
