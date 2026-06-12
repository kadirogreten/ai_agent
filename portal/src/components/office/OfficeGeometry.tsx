import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { getAmphibDeskPositions, getOpsTableColor } from '@/lib/office'

interface OfficeGeometryProps {
  scene: THREE.Scene
  deskCount?: number
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

// ── Room constants ──────────────────────────────────────────────────────────
const ROOM_W  = 36   // x: -18..+18
const ROOM_D  = 28   // z: -14..+14
const ROOM_H  = 6    // ceiling y
const BACK_Z  = -14  // back wall z
const CEIL_Y  = ROOM_H

export default function OfficeGeometry({
  scene,
  deskCount = 5,
  runningDeskIndices = [],
  pendingApprovalCount = 0,
  totalOps = 0,
  hasEscalation = false,
}: OfficeGeometryProps) {

  const effectiveDeskCount = Math.max(1, deskCount)

  // ── Static geometry ─────────────────────────────────────────────────────────
  useEffect(() => {
    const AMFI_POSITIONS = getAmphibDeskPositions(effectiveDeskCount)
    const group = new THREE.Group()
    scene.add(group)
    const add = (obj: THREE.Object3D) => { group.add(obj); return obj }

    // ── FLOOR — warm wood parquet ─────────────────────────────────────────
    const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), mat(0x9a7b5f, 0.7, 0.05)))
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, 0, 0)
    floor.receiveShadow = true

    const carpet = add(new THREE.Mesh(new THREE.PlaneGeometry(12, 9), mat(0x334155, 0.9, 0)))
    carpet.rotation.x = -Math.PI / 2
    carpet.position.set(0, 0.005, 0)
    carpet.receiveShadow = true

    // ── CEILING — dollhouse: normal faces down, FrontSide → invisible from above ──
    const ceiling = add(new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), mat(0xcbd5e1, 0.8, 0)))
    ceiling.rotation.x = Math.PI / 2
    ceiling.position.set(0, CEIL_Y, 0)

    // 6 recessed ceiling spots
    const spotPositions: [number, number][] = [
      [-9, -4], [0, -4], [9, -4],
      [-9,  4], [0,  4], [9,  4],
    ]
    spotPositions.forEach(([sx, sz]) => {
      const housing = add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 16), mat(0x334155, 0.5, 0.3)))
      housing.position.set(sx, CEIL_Y - 0.03, sz)
      const disc = add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.01, 16), mat(0xfff7ed, 0.1, 0.1, 1.2, 0xfff4e0)))
      disc.position.set(sx, CEIL_Y - 0.055, sz)
      const spot = new THREE.SpotLight(0xfff4e0, 0.6, 8, Math.PI / 4, 0.6)
      spot.position.set(sx, CEIL_Y - 0.08, sz)
      spot.target.position.set(sx, 0, sz)
      group.add(spot)
      group.add(spot.target)
    })

    // ── WALLS (3 — front open for camera) ────────────────────────────────
    const wallMat = mat(0x8a94a3, 0.9, 0)
    const backWall = add(new THREE.Mesh(new THREE.BoxGeometry(ROOM_W, ROOM_H, 0.3), wallMat))
    backWall.position.set(0, ROOM_H / 2, BACK_Z)
    backWall.receiveShadow = true
    const leftWall = add(new THREE.Mesh(new THREE.BoxGeometry(0.3, ROOM_H, ROOM_D), wallMat))
    leftWall.position.set(-ROOM_W / 2, ROOM_H / 2, 0)
    leftWall.receiveShadow = true
    const rightWall = add(new THREE.Mesh(new THREE.BoxGeometry(0.3, ROOM_H, ROOM_D), wallMat))
    rightWall.position.set(ROOM_W / 2, ROOM_H / 2, 0)
    rightWall.receiveShadow = true

    // ── FAKE WINDOWS — inside back wall, MeshBasicMaterial (no z-fight) ──
    const windowY = 3.5
    ;[-10, 0, 10].forEach((wx) => {
      const frame = add(new THREE.Mesh(new THREE.BoxGeometry(6.2, 3.7, 0.12), mat(0x475569, 0.6, 0.2)))
      frame.position.set(wx, windowY, BACK_Z + 0.18)
      const skyPane = add(new THREE.Mesh(new THREE.PlaneGeometry(5.8, 3.4), new THREE.MeshBasicMaterial({ color: 0xbfdbfe })))
      skyPane.position.set(wx, windowY, BACK_Z + 0.25)
      const sill = add(new THREE.Mesh(new THREE.BoxGeometry(6.0, 0.1, 0.25), mat(0x64748b, 0.5, 0.2)))
      sill.position.set(wx, windowY - 1.85, BACK_Z + 0.28)
    })

    // ── PENDANT LAMPS — desk (inner row: PointLight; outer row: visual only) ──
    const cableLen = 3.2
    const lampY    = CEIL_Y - cableLen

    AMFI_POSITIONS.forEach((pos, idx) => {
      const { x, z } = pos
      const cable = add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, cableLen, 8), mat(0x1e293b, 0.5, 0.4)))
      cable.position.set(x, CEIL_Y - cableLen / 2, z)
      const shade = add(new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.28, 16, 1, true), mat(0xfff4e0, 0.4, 0.05, 0.8, 0xfff4e0)))
      shade.position.set(x, lampY - 0.14, z)
      // Only inner ring (first 6) gets a PointLight to keep light budget reasonable
      if (idx < 6) {
        const pl = add(new THREE.PointLight(0xffedd5, 0.8, 6))
        pl.position.set(x, lampY - 0.35, z)
      }
    })

    // ── PENDANT LAMPS — ops table (3 × 120°) ─────────────────────────────
    const opsPendantR = 1.4
    for (let i = 0; i < 3; i++) {
      const angle    = (i / 3) * Math.PI * 2
      const px = Math.cos(angle) * opsPendantR
      const pz = Math.sin(angle) * opsPendantR
      const opsLen   = 2.8
      const opsLampY = CEIL_Y - opsLen
      const cable = add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, opsLen, 8), mat(0x1e293b, 0.5, 0.4)))
      cable.position.set(px, CEIL_Y - opsLen / 2, pz)
      const shade = add(new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.3, 16, 1, true), mat(0xfff4e0, 0.4, 0.05, 0.8, 0xfff4e0)))
      shade.position.set(px, opsLampY - 0.15, pz)
      const pl = add(new THREE.PointLight(0xffedd5, 0.7, 5))
      pl.position.set(px, opsLampY - 0.35, pz)
    }

    // ── FLOOR LAMP — mola alanı köşesinde (dik, y-ekseninde) ─────────────
    const flX = -17, flZ = -10
    const lampMat = mat(0x475569, 0.3, 0.6)
    const poleH = 3.5
    const flBase = add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.08, 16), lampMat))
    flBase.position.set(flX, 0.04, flZ)
    const flPole = add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, poleH, 8), lampMat))
    flPole.position.set(flX, 0.08 + poleH / 2, flZ)
    const flShade = add(new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.32, 16, 1, true), mat(0xfff4e0, 0.4, 0.05, 0.8, 0xfff4e0)))
    flShade.position.set(flX, 0.08 + poleH - 0.08, flZ)
    const flLight = add(new THREE.PointLight(0xffedd5, 0.7, 7))
    flLight.position.set(flX, 0.08 + poleH - 0.4, flZ)

    // ── BOOKSHELVES — sol duvar ───────────────────────────────────────────
    const shelfWood = mat(0x6b4f3a, 0.7, 0.05)
    const bookColors = [0xef4444, 0x3b82f6, 0x10b981, 0xf59e0b, 0x8b5cf6, 0xec4899]
    ;[-15, -12].forEach((bsx) => {
      const bodyZ = BACK_Z + 0.19
      const body = add(new THREE.Mesh(new THREE.BoxGeometry(2.5, 4.2, 0.38), shelfWood))
      body.position.set(bsx, 2.1, bodyZ)
      body.castShadow = true
      for (let shelf = 0; shelf < 4; shelf++) {
        const sy = 0.6 + shelf * 1.0
        const board = add(new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.05, 0.32), shelfWood))
        board.position.set(bsx, sy, bodyZ)
        const bookCount = 5 + (shelf % 2)
        const bookW = 2.1 / bookCount
        for (let b = 0; b < bookCount; b++) {
          const bx = bsx - 1.05 + bookW * b + bookW / 2
          const bookH = 0.28 + (b % 3) * 0.05
          const book = add(new THREE.Mesh(new THREE.BoxGeometry(bookW - 0.02, bookH, 0.26), mat(bookColors[(shelf * bookCount + b) % bookColors.length], 0.8, 0)))
          book.position.set(bx, sy + bookH / 2 + 0.025, bodyZ)
        }
      }
    })

    // ── COFFEE CORNER — tezgah sol duvara yaslanmış, ön yüzü odaya ────────
    // counter runs along z-axis (rotation.y=π/2), front (+x) faces room
    const ccX = -17.2, ccZ = -12
    const woodMat = mat(0x6b4f3a, 0.7, 0.05)

    // Halı — mola alanını belirgin yapar
    const breakRug = add(new THREE.Mesh(new THREE.PlaneGeometry(4, 4), mat(0x475569, 0.9, 0)))
    breakRug.rotation.x = -Math.PI / 2
    breakRug.position.set(-14.5, 0.006, -10.5)

    const counter = add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 0.7), woodMat))
    counter.position.set(ccX, 0.45, ccZ)
    counter.rotation.y = Math.PI / 2   // 2.2 uzunluk z boyunca, 0.7 derinlik x boyunca
    counter.castShadow = true

    const counterTop = add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 2.2), mat(0x1e293b, 0.2, 0.5)))
    counterTop.position.set(ccX, 0.925, ccZ)

    const machine = add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.45, 0.38), mat(0x1e293b, 0.3, 0.6)))
    machine.position.set(ccX + 0.04, 1.15, ccZ - 0.7)
    machine.castShadow = true

    const machineLed = add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.08), mat(0x4ade80, 0.1, 0, 1.5, 0x4ade80)))
    machineLed.position.set(ccX + 0.16, 1.3, ccZ - 0.7)

    const cupMat = mat(0xf5e6d3, 0.4, 0.1)
    ;[-0.3, 0.3].forEach((oz) => {
      const cup = add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 10), cupMat))
      cup.position.set(ccX + 0.05, 0.975, ccZ + oz)
      const handle = add(new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.013, 6, 8), cupMat))
      handle.position.set(ccX + 0.16, 0.99, ccZ + oz)
      handle.rotation.y = Math.PI / 2
    })

    // ── MEETING TABLE + STOOLS — mola alanına yakın (-13, 0, -9) ─────────
    const mtX = -13, mtZ = -9
    const mtTable = add(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.06, 24), mat(0x6b4f3a, 0.7, 0.05)))
    mtTable.position.set(mtX, 0.72, mtZ)
    for (let s = 0; s < 3; s++) {
      const sa = (s / 3) * Math.PI * 2
      const stool = add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.4, 12), mat(0x334155, 0.6, 0.1)))
      stool.position.set(mtX + Math.cos(sa) * 1.2, 0.2, mtZ + Math.sin(sa) * 1.2)
      const pad = add(new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.06, 12), mat(0x475569, 0.7, 0)))
      pad.position.set(mtX + Math.cos(sa) * 1.2, 0.42, mtZ + Math.sin(sa) * 1.2)
    }

    // ── LARGE POTTED PLANTS ───────────────────────────────────────────────
    const potMat  = mat(0xa16207, 0.7, 0)
    const leafMat = mat(0x4a7c59, 0.6, 0)
    ;[
      { x: -10, z: BACK_Z + 1.2 },
      { x:   0, z: BACK_Z + 1.2 },
      { x:   5, z: -3 },
    ].forEach(({ x, z }) => {
      const pot = add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.4, 14), potMat))
      pot.position.set(x, 0.2, z)
      ;[[0, 0.6, 0, 1.0], [-0.18, 0.7, -0.1, 0.85], [0.15, 0.75, 0.08, 0.8]].forEach(([ox, oy, oz, s]) => {
        const leaf = add(new THREE.Mesh(new THREE.SphereGeometry(0.22 * s, 8, 8), leafMat))
        leaf.position.set(x + ox, 0.4 + oy, z + oz)
        leaf.castShadow = true
      })
    })

    // ── WALL ART — side walls ─────────────────────────────────────────────
    ;[
      { x: -17.85, z:  2, ry:  Math.PI / 2, colors: [0x6366f1, 0x7dd3fc, 0xf0abfc] },
      { x:  17.85, z: -2, ry: -Math.PI / 2, colors: [0xfb923c, 0xfde68a, 0xa3e635] },
    ].forEach(({ x, z, ry, colors }) => {
      const frame = add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 2.4), mat(0x475569, 0.5, 0.2)))
      frame.position.set(x, 3.0, z)
      frame.rotation.y = ry
      colors.forEach((c, i) => {
        const panel = add(new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.35), new THREE.MeshBasicMaterial({ color: c })))
        const sign = ry > 0 ? 1 : -1
        panel.position.set(x + sign * 0.04, 3.0, z - 0.72 + i * 0.72)
        panel.rotation.y = ry
      })
    })

    // ── AMPHITHEATER DESKS ────────────────────────────────────────────────
    const deskSurfMat  = mat(0x1e293b, 0.25, 0.5)
    const deskFrameMat = mat(0x334155, 0.2, 0.8)
    const monitorMat   = mat(0x0f172a, 0.3, 0.5)
    const screenPalette = [0x3b82f6, 0x8b5cf6, 0x06b6d4, 0x10b981, 0xf59e0b, 0xec4899, 0xef4444, 0xf97316, 0x84cc16, 0x22d3ee, 0xa78bfa]

    AMFI_POSITIONS.forEach((pos, idx) => {
      const { x, z } = pos
      const surface = add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.06, 1.8), deskSurfMat))
      surface.position.set(x, 0.8, z)
      surface.castShadow = true
      surface.receiveShadow = true

      const angleToCenter = Math.atan2(-z, -x)
      const edgeX = x + Math.cos(angleToCenter) * 0.9
      const edgeZ = z + Math.sin(angleToCenter) * 0.9
      const edge = add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.03, 0.03), mat(0x7dd3fc, 0.4, 0.2, 0.4, 0x93c5fd)))
      edge.position.set(edgeX, 0.82, edgeZ)

      ;[[-1.4, -0.8], [1.4, -0.8], [-1.4, 0.8], [1.4, 0.8]].forEach(([lx, lz]) => {
        const leg = add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.06), deskFrameMat))
        leg.position.set(x + lx, 0.4, z + lz)
        leg.castShadow = true
      })

      const screenColor = screenPalette[idx % screenPalette.length]
      const monitor = add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.75, 0.04), monitorMat))
      monitor.position.set(x, 1.55, z - 0.3)
      monitor.castShadow = true
      const screen = add(new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.68, 0.01), mat(screenColor, 0.1, 0, 0.7, screenColor)))
      screen.position.set(x, 1.55, z - 0.278)
      const stand = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.05), deskFrameMat))
      stand.position.set(x, 1.1, z - 0.25)
      const screenLight = add(new THREE.PointLight(screenColor, 0.4, 3))
      screenLight.position.set(x, 1.55, z - 0.1)
    })

    // ── CEO ROOM — sağ-arka köşe x∈[8,18] z∈[-14,-6] ───────────────────
    const CEO_X0 = 8, CEO_Z0 = -6
    const GLASS_H = 4
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xbfdbfe, transparent: true, opacity: 0.13, roughness: 0.05, metalness: 0.0 })
    const frameMat2 = mat(0x475569, 0.4, 0.3)

    const leftGlass = add(new THREE.Mesh(new THREE.BoxGeometry(0.06, GLASS_H, 8), glassMat))
    leftGlass.position.set(CEO_X0, GLASS_H / 2, (BACK_Z + CEO_Z0) / 2)
    const frontGlass = add(new THREE.Mesh(new THREE.BoxGeometry(8, GLASS_H, 0.06), glassMat))
    frontGlass.position.set(14, GLASS_H / 2, CEO_Z0)
    const post1 = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, GLASS_H, 0.1), frameMat2))
    post1.position.set(CEO_X0, GLASS_H / 2, CEO_Z0)
    const post2 = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, GLASS_H, 0.1), frameMat2))
    post2.position.set(10, GLASS_H / 2, CEO_Z0)
    const topRail1 = add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 8), frameMat2))
    topRail1.position.set(CEO_X0, GLASS_H, (BACK_Z + CEO_Z0) / 2)
    const topRail2 = add(new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 0.06), frameMat2))
    topRail2.position.set(14, GLASS_H, CEO_Z0)

    const ceoFloor = add(new THREE.Mesh(new THREE.PlaneGeometry(8.5, 7), mat(0x1e3a5f, 0.9, 0)))
    ceoFloor.rotation.x = -Math.PI / 2
    ceoFloor.position.set(13.5, 0.006, -10)

    const ceoDesk = add(new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.08, 1.8), mat(0x5d4a37, 0.5, 0.1)))
    ceoDesk.position.set(14, 0.8, -10)
    ceoDesk.castShadow = true
    ;[[-1.6,-0.8],[1.6,-0.8],[-1.6,0.8],[1.6,0.8]].forEach(([lx, lz]) => {
      const leg = add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.8, 0.07), mat(0x3b2a1a, 0.4, 0.2)))
      leg.position.set(14 + lx, 0.4, -10 + lz)
    })

    const seat = add(new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.12, 16), mat(0x1e293b, 0.6, 0.1)))
    seat.position.set(14, 0.46, -9.0)
    const back = add(new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.7, 0.08), mat(0x1e293b, 0.6, 0.1)))
    back.position.set(14, 0.82, -8.65)

    const ceoMonitor = add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.85, 0.04), mat(0x0f172a, 0.3, 0.5)))
    ceoMonitor.position.set(14, 1.5, -10.55)
    const ceoScreen = add(new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.78, 0.01), mat(0x6366f1, 0.1, 0, 0.7, 0x818cf8)))
    ceoScreen.position.set(14, 1.5, -10.528)

    const ceoLampLen = 3.2
    const ceoCable = add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, ceoLampLen, 8), mat(0x1e293b, 0.5, 0.4)))
    ceoCable.position.set(14, CEIL_Y - ceoLampLen / 2, -10)
    const ceoShade = add(new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.28, 16, 1, true), mat(0xfff4e0, 0.4, 0.05, 0.8, 0xfff4e0)))
    ceoShade.position.set(14, CEIL_Y - ceoLampLen - 0.14, -10)
    ceoShade.rotation.x = Math.PI
    const ceoLight = add(new THREE.PointLight(0xffedd5, 0.9, 7))
    ceoLight.position.set(14, CEIL_Y - ceoLampLen - 0.35, -10)

    const ceoFrameM = add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 0.06), mat(0x475569, 0.5, 0.2)))
    ceoFrameM.position.set(14, 3.0, BACK_Z + 0.12)
    const ceoPainting = add(new THREE.Mesh(new THREE.PlaneGeometry(1.45, 0.98), new THREE.MeshBasicMaterial({ color: 0x4338ca })))
    ceoPainting.position.set(14, 3.0, BACK_Z + 0.16)

    // ── CENTER OPERATIONS TABLE ───────────────────────────────────────────
    const opsTable = add(new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 0.4, 32), mat(0x334155, 0.25, 0.5, 0.15, 0x6366f1)))
    opsTable.position.set(0, 0.2, 0)
    opsTable.castShadow = true
    opsTable.receiveShadow = true

    const tableEdge = add(new THREE.Mesh(new THREE.TorusGeometry(3.5, 0.05, 8, 64), mat(0x818cf8, 0.2, 0.3, 0.7, 0xa5b4fc)))
    tableEdge.rotation.x = Math.PI / 2
    tableEdge.position.set(0, 0.42, 0)

    const pillar = add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.0, 12), mat(0x6366f1, 0.1, 0.6, 0.8, 0x818cf8)))
    pillar.position.set(0, 1.4, 0)

    const centerLight = add(new THREE.PointLight(0x6366f1, 1.2, 10))
    centerLight.position.set(0, 2, 0)

    return () => {
      scene.remove(group)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, effectiveDeskCount])

  const runningKey = useMemo(() => runningDeskIndices.slice().sort().join(','), [runningDeskIndices])

  // ── Dynamic objects (desk rings, approval badge, ops ring, particles) ───────
  useEffect(() => {
    const AMFI_POSITIONS = getAmphibDeskPositions(effectiveDeskCount)
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
  }, [scene, effectiveDeskCount, runningKey, pendingApprovalCount, totalOps, hasEscalation])

  return null
}
