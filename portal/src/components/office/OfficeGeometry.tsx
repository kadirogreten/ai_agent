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

// Fixed 5-desk amphitheater layout
const DESK_COUNT = 5
const AMFI_POSITIONS = getAmphibDeskPositions(DESK_COUNT)

export default function OfficeGeometry({
  scene,
  runningDeskIndices = [],
  pendingApprovalCount = 0,
  totalOps = 0,
  hasEscalation = false,
}: OfficeGeometryProps) {

  // ── Static geometry (floor, walls, desks, ops table) ───────────────────────
  useEffect(() => {
    // Circular platform — amfi r=10 + 6 margin = 16; beyond this the slate-900 bg shows
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(16, 16, 0.08, 64),
      mat(0x1e293b, 0.45, 0.3)
    )
    platform.position.set(0, 0, 0)
    platform.receiveShadow = true
    scene.add(platform)

    // Soft grid — only inside platform, very low opacity
    const gridHelper = new THREE.GridHelper(28, 14, 0x334155, 0x334155)
    gridHelper.position.y = 0.05
    const gridMats = Array.isArray(gridHelper.material)
      ? gridHelper.material
      : [gridHelper.material]
    gridMats.forEach((m) => {
      const lm = m as THREE.LineBasicMaterial
      lm.transparent = true
      lm.opacity = 0.12
    })
    scene.add(gridHelper)

    // Ceiling removed — open sky feel, background slate-900 reads above walls

    // Walls
    const wallMat = mat(0x0f1e35, 0.85, 0.05)
    const walls: { size: [number,number,number]; pos: [number,number,number] }[] = [
      { size: [50, 10, 0.3], pos: [0, 5, -25] },
      { size: [50, 10, 0.3], pos: [0, 5, 25]  },
      { size: [0.3, 10, 50], pos: [25, 5, 0]  },
      { size: [0.3, 10, 50], pos: [-25, 5, 0] },
    ]
    walls.forEach(({ size, pos }) => {
      const w = new THREE.Mesh(new THREE.BoxGeometry(...size), wallMat)
      w.position.set(...pos)
      w.receiveShadow = true
      scene.add(w)
    })

    // Subtle baseboard strips (slate blue, no neon)
    const baseboardMat = mat(0x334155, 0.5, 0.2, 0.2, 0x475569)
    const baseboards: { size: [number,number,number]; pos: [number,number,number] }[] = [
      { size: [50, 0.06, 0.06], pos: [0, 0.03, -24.85] },
      { size: [50, 0.06, 0.06], pos: [0, 0.03, 24.85]  },
      { size: [0.06, 0.06, 50], pos: [24.85, 0.03, 0]  },
      { size: [0.06, 0.06, 50], pos: [-24.85, 0.03, 0] },
    ]
    baseboards.forEach(({ size, pos }) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(...size), baseboardMat)
      b.position.set(...pos)
      scene.add(b)
    })

    // Ceiling LED bars removed — HemisphereLight + keyLight provide even illumination

    // ── Amphitheater desks ─────────────────────────────────────────────
    const deskSurfMat  = mat(0x1e293b, 0.25, 0.5)
    const deskFrameMat = mat(0x334155, 0.2, 0.8)
    const monitorMat   = mat(0x0f172a, 0.3, 0.5)
    const screenColors = [0x3b82f6, 0x8b5cf6, 0x06b6d4, 0x10b981, 0xf59e0b]

    AMFI_POSITIONS.forEach((pos, idx) => {
      const { x, z } = pos

      // Desk surface
      const surface = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.06, 1.8), deskSurfMat)
      surface.position.set(x, 0.8, z)
      surface.castShadow = true
      surface.receiveShadow = true
      scene.add(surface)

      // Subtle edge strip — slate (not neon)
      const edgeMat = mat(0x7dd3fc, 0.4, 0.2, 0.4, 0x93c5fd)
      const edge = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.03, 0.03), edgeMat)
      // Orient edge toward camera (positive Z direction from desk center)
      const angleToCenter = Math.atan2(-z, -x) // direction from desk to origin
      const edgeX = x + Math.cos(angleToCenter) * 0.9
      const edgeZ = z + Math.sin(angleToCenter) * 0.9
      edge.position.set(edgeX, 0.82, edgeZ)
      scene.add(edge)

      // Legs
      const legOffsets: [number, number][] = [[-1.4, -0.8], [1.4, -0.8], [-1.4, 0.8], [1.4, 0.8]]
      legOffsets.forEach(([lx, lz]) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.06), deskFrameMat)
        leg.position.set(x + lx, 0.4, z + lz)
        leg.castShadow = true
        scene.add(leg)
      })

      // Monitor
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

      const screenLight = new THREE.PointLight(screenColor, 0.5, 4)
      screenLight.position.set(x, 1.55, z - 0.1)
      scene.add(screenLight)

      // Desk spot — soft
      const deskSpot = new THREE.SpotLight(0xbae6fd, 0.8, 8, Math.PI / 6, 0.5)
      deskSpot.position.set(x, 4, z)
      deskSpot.target.position.set(x, 0, z)
      scene.add(deskSpot)
      scene.add(deskSpot.target)
    })

    // ── Center Operations Table ────────────────────────────────────────
    // Slate-700 base + subtle indigo rim emissive
    const opsTable = new THREE.Mesh(
      new THREE.CylinderGeometry(3.5, 3.5, 0.4, 32),
      mat(0x334155, 0.25, 0.5, 0.15, 0x6366f1)
    )
    opsTable.position.set(0, 0.2, 0)   // top surface at y=0.4
    opsTable.castShadow = true
    opsTable.receiveShadow = true
    scene.add(opsTable)

    // Table edge ring — sits 0.3 above top surface (y = 0.4 + 0.3 = 0.7 → torus center)
    const tableEdge = new THREE.Mesh(
      new THREE.TorusGeometry(3.5, 0.05, 8, 64),
      mat(0x818cf8, 0.2, 0.3, 0.7, 0xa5b4fc)
    )
    tableEdge.rotation.x = Math.PI / 2
    tableEdge.position.set(0, 0.42, 0)  // flush with top face
    scene.add(tableEdge)

    // Holographic pillar above table
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 2.0, 12),
      mat(0x6366f1, 0.1, 0.6, 0.8, 0x818cf8)
    )
    pillar.position.set(0, 1.4, 0)
    scene.add(pillar)

    // Center uplight
    const centerLight = new THREE.PointLight(0x6366f1, 1.5, 12)
    centerLight.position.set(0, 2, 0)
    scene.add(centerLight)

    // ── Server racks (right wall) — slate tones ────────────────────────
    const rackMat = mat(0x1e293b, 0.3, 0.6)
    const ledGreen = mat(0x86efac, 0.1, 0, 1.5, 0x4ade80)
    const ledAmber = mat(0xfcd34d, 0.1, 0, 1.2, 0xfbbf24)

    for (let r = 0; r < 3; r++) {
      const rz = -12 + r * 6
      const rack = new THREE.Mesh(new THREE.BoxGeometry(0.8, 5, 2.0), rackMat)
      rack.position.set(24, 2.5, rz)
      rack.castShadow = true
      scene.add(rack)

      for (let l = 0; l < 8; l++) {
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.04), l % 3 === 0 ? ledAmber : ledGreen)
        led.position.set(23.6, 0.8 + l * 0.5, rz)
        scene.add(led)
      }

      const rl = new THREE.PointLight(0x4ade80, 0.4, 5)
      rl.position.set(23.4, 2.5, rz)
      scene.add(rl)
    }

    // ── Windows (left wall) ────────────────────────────────────────────
    const glassMat = mat(0x475569, 0.05, 0.1, 0.15, 0x7dd3fc)
    glassMat.transparent = true
    glassMat.opacity = 0.3

    for (let i = 0; i < 4; i++) {
      const wz = -15 + i * 10
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.5, 4.0), mat(0x1e293b, 0.2, 0.8))
      frame.position.set(-24.85, 4, wz)
      scene.add(frame)

      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.0, 3.6), glassMat)
      glass.position.set(-24.75, 4, wz)
      scene.add(glass)

      const wl = new THREE.PointLight(0x7dd3fc, 0.8, 10)
      wl.position.set(-23, 4, wz)
      scene.add(wl)
    }

    return () => {
      // Scene clear handled by Office3DScene on unmount
    }
  }, [scene])

  // Desk ring indices as stable string for dep comparison
  const runningKey = useMemo(() => runningDeskIndices.slice().sort().join(','), [runningDeskIndices])

  // ── Dynamic objects (desk rings, approval badge, ops ring, particles) ───────
  useEffect(() => {
    const objects: THREE.Object3D[] = []
    let animId: number

    // Desk rings for running jobs
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

    // Approval badge on center table when pending > 0
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

    // Center ops ring — size capped at radius 4 (6+ ops would overflow table)
    const clampedOps = Math.min(totalOps, 6)
    const opsRadius = Math.min(clampedOps * 0.4 + 2, 4)
    const opsColor = getOpsTableColor(hasEscalation)
    const opsRing = new THREE.Mesh(
      new THREE.TorusGeometry(opsRadius, 0.12, 8, 48),
      mat(opsColor, 0.2, 0.1, 1.2, opsColor)
    )
    opsRing.rotation.x = Math.PI / 2
    opsRing.position.set(0, 0.7, 0)   // 0.3 above table top (y=0.4)
    scene.add(opsRing)
    objects.push(opsRing)

    // Particle flow: center → running desks
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

    // Animation loop for particles
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
