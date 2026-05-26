import { useEffect } from 'react'
import * as THREE from 'three'

interface OfficeGeometryProps {
  scene: THREE.Scene
}

// ─────────────────────────────────────────────────────────────────────────────
// Material helpers
// ─────────────────────────────────────────────────────────────────────────────
function mat(color: number, rough = 0.6, metal = 0, emit = 0, emitColor?: number) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: rough,
    metalness: metal,
    emissive: emitColor ?? color,
    emissiveIntensity: emit,
  })
}

export default function OfficeGeometry({ scene }: OfficeGeometryProps) {
  useEffect(() => {

    // ── Floor — dark polished concrete with glowing grid ───────────────
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 50),
      mat(0x050a14, 0.3, 0.4)
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)

    // Neon grid lines on floor
    const gridHelper = new THREE.GridHelper(50, 25, 0x1a3a6e, 0x0d2040)
    gridHelper.position.y = 0.012
    scene.add(gridHelper)

    // Bright crosshair grid layer (narrower, more visible)
    const gridBright = new THREE.GridHelper(50, 10, 0x1e4080, 0x0f2050)
    gridBright.position.y = 0.015
    scene.add(gridBright)

    // ── Ceiling ────────────────────────────────────────────────────────
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 50),
      mat(0x030609, 0.9, 0)
    )
    ceiling.rotation.x = Math.PI / 2
    ceiling.position.y = 10
    scene.add(ceiling)

    // ── Walls ──────────────────────────────────────────────────────────
    const wallMat = mat(0x060d1a, 0.85, 0.05)

    const walls = [
      { size: [50, 10, 0.3] as [number,number,number], pos: [0, 5, -25] as [number,number,number] },
      { size: [50, 10, 0.3] as [number,number,number], pos: [0, 5, 25]  as [number,number,number] },
      { size: [0.3, 10, 50] as [number,number,number], pos: [25, 5, 0]  as [number,number,number] },
      { size: [0.3, 10, 50] as [number,number,number], pos: [-25, 5, 0] as [number,number,number] },
    ]
    walls.forEach(({ size, pos }) => {
      const w = new THREE.Mesh(new THREE.BoxGeometry(...size), wallMat)
      w.position.set(...pos)
      w.receiveShadow = true
      scene.add(w)
    })

    // Glowing baseboard strips (blue LED)
    const baseboardMat = mat(0x1d4ed8, 0.4, 0.2, 0.8, 0x3b82f6)
    const baseboards = [
      { size: [50, 0.08, 0.06] as [number,number,number], pos: [0, 0.04, -24.85] as [number,number,number] },
      { size: [50, 0.08, 0.06] as [number,number,number], pos: [0, 0.04, 24.85]  as [number,number,number] },
      { size: [0.06, 0.08, 50] as [number,number,number], pos: [24.85, 0.04, 0]  as [number,number,number] },
      { size: [0.06, 0.08, 50] as [number,number,number], pos: [-24.85, 0.04, 0] as [number,number,number] },
    ]
    baseboards.forEach(({ size, pos }) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(...size), baseboardMat)
      b.position.set(...pos)
      scene.add(b)
    })

    // ── Ceiling lights (LED panel strips) ─────────────────────────────
    const ledMat = mat(0xdbeafe, 0.2, 0.1, 1.2, 0xbfdbfe)
    const ceilLightPositions = [
      [-8, -8], [-8, 0], [-8, 8],
      [0, -8],  [0, 0],  [0, 8],
      [8, -8],  [8, 0],  [8, 8],
    ]
    ceilLightPositions.forEach(([x, z]) => {
      // LED strip panel
      const panel = new THREE.Mesh(new THREE.BoxGeometry(3, 0.04, 0.4), ledMat)
      panel.position.set(x, 9.97, z)
      scene.add(panel)

      // Actual point light
      const pl = new THREE.PointLight(0xdbeafe, 0.6, 18)
      pl.position.set(x, 9.8, z)
      scene.add(pl)
    })

    // ── Desks ──────────────────────────────────────────────────────────
    const deskPositions = [
      new THREE.Vector3(-12, 0.05, 0),
      new THREE.Vector3(-6,  0.05, -10),
      new THREE.Vector3(0,   0.05, -15),
      new THREE.Vector3(6,   0.05, -10),
      new THREE.Vector3(12,  0.05, 0),
    ]
    const deskSurfMat   = mat(0x0f1e35, 0.2, 0.6)        // dark steel-glass
    const deskFrameMat  = mat(0x1a2a40, 0.15, 0.85)       // polished dark metal
    const monitorMat    = mat(0x060c18, 0.3, 0.5)
    const screenColors  = [0x1d4ed8, 0x7c3aed, 0x0891b2, 0x059669, 0xd97706]

    deskPositions.forEach((pos, idx) => {
      const x = pos.x, z = pos.z

      // Desk surface — wide, low, sleek
      const surface = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.06, 2.0), deskSurfMat)
      surface.position.set(x, 0.8, z)
      surface.castShadow = true
      surface.receiveShadow = true
      scene.add(surface)

      // Blue edge glow strip on desk front
      const edgeMat = mat(0x3b82f6, 0.3, 0.2, 1.5, 0x60a5fa)
      const edge = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.04, 0.04), edgeMat)
      edge.position.set(x, 0.8, z + 1.02)
      scene.add(edge)

      // Desk legs — thin, angular
      const legOffsets = [[-1.7, -0.9], [1.7, -0.9], [-1.7, 0.9], [1.7, 0.9]]
      legOffsets.forEach(([lx, lz]) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.06), deskFrameMat)
        leg.position.set(x + lx, 0.4, z + lz)
        leg.castShadow = true
        scene.add(leg)
      })

      // Monitor — dual screen setup
      for (let m = 0; m < 2; m++) {
        const mx = x + (m === 0 ? -0.7 : 0.7)
        // Screen body
        const monitor = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.65, 0.04), monitorMat)
        monitor.position.set(mx, 1.5, z - 0.4)
        monitor.castShadow = true
        scene.add(monitor)

        // Screen glow — emissive display
        const screenColor = screenColors[idx]
        const screenMat = mat(screenColor, 0.1, 0, 0.9, screenColor)
        const screen = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.58, 0.01), screenMat)
        screen.position.set(mx, 1.5, z - 0.375)
        scene.add(screen)

        // Monitor stand
        const stand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.35, 0.06), deskFrameMat)
        stand.position.set(mx, 1.12, z - 0.35)
        scene.add(stand)

        // Screen point light
        const screenLight = new THREE.PointLight(screenColor, 0.8, 5)
        screenLight.position.set(mx, 1.5, z - 0.2)
        scene.add(screenLight)
      }

      // Keyboard — flat dark slab
      const kbMat = mat(0x0d1a2e, 0.4, 0.3)
      const kb = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 0.45), kbMat)
      kb.position.set(x, 0.84, z + 0.3)
      scene.add(kb)

      // Overhead desk spot
      const deskSpot = new THREE.SpotLight(0x93c5fd, 1.2, 10, Math.PI / 6, 0.4)
      deskSpot.position.set(x, 4, z)
      deskSpot.target.position.set(x, 0, z)
      scene.add(deskSpot)
      scene.add(deskSpot.target)
    })

    // ── CEO / Collaboration Zone (center) ──────────────────────────────
    // Glowing floor disc
    const ceoFloor = new THREE.Mesh(
      new THREE.CylinderGeometry(6.5, 6.5, 0.06, 64),
      mat(0x0c1f3f, 0.2, 0.6, 0.3, 0x1d4ed8)
    )
    ceoFloor.position.set(0, 0.03, 5)
    ceoFloor.receiveShadow = true
    scene.add(ceoFloor)

    // Outer glowing ring
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(6.8, 0.12, 16, 128),
      mat(0x3b82f6, 0.2, 0.3, 2.0, 0x60a5fa)
    )
    ring.position.set(0, 0.08, 5)
    ring.rotation.x = Math.PI / 2
    scene.add(ring)

    // Inner ring (dimmer)
    const ring2 = new THREE.Mesh(
      new THREE.TorusGeometry(4.5, 0.06, 16, 128),
      mat(0x1d4ed8, 0.2, 0.3, 1.2, 0x3b82f6)
    )
    ring2.position.set(0, 0.06, 5)
    ring2.rotation.x = Math.PI / 2
    scene.add(ring2)

    // Central holographic projection pillar
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 2.5, 16),
      mat(0x1e40af, 0.1, 0.8, 1.5, 0x3b82f6)
    )
    pillar.position.set(0, 1.25, 5)
    scene.add(pillar)

    // CEO zone strong blue uplight
    const ceoLight = new THREE.PointLight(0x2563eb, 3.0, 16)
    ceoLight.position.set(0, 1.5, 5)
    scene.add(ceoLight)

    // Circular seating (abstract chairs)
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2
      const r = 5
      const cx = Math.cos(angle) * r
      const cz = Math.sin(angle) * r + 5

      const chairMat = mat(0x0f2040, 0.3, 0.5)
      const chair = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.12, 16), chairMat)
      chair.position.set(cx, 0.45, cz)
      scene.add(chair)

      const back = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.06), chairMat)
      back.position.set(cx, 0.8, cz + 0.3)
      scene.add(back)
    }

    // ── Conference table ───────────────────────────────────────────────
    const tableMat = mat(0x0a1428, 0.15, 0.7)
    const table = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.08, 48), tableMat)
    table.position.set(0, 0.5, 5)
    table.castShadow = true
    table.receiveShadow = true
    scene.add(table)

    // Table edge glow
    const tableRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.8, 0.03, 8, 64),
      mat(0x1d4ed8, 0.2, 0.3, 1.8, 0x60a5fa)
    )
    tableRing.rotation.x = Math.PI / 2
    tableRing.position.set(0, 0.55, 5)
    scene.add(tableRing)

    // ── Decorative server racks (right wall) ──────────────────────────
    const rackMat  = mat(0x08111e, 0.2, 0.7)
    const rackLed  = mat(0x22c55e, 0.1, 0, 2.0, 0x4ade80)
    const rackLed2 = mat(0xf59e0b, 0.1, 0, 1.8, 0xfbbf24)

    for (let r = 0; r < 3; r++) {
      const rx = 24
      const rz = -12 + r * 6

      const rack = new THREE.Mesh(new THREE.BoxGeometry(0.8, 5, 2.0), rackMat)
      rack.position.set(rx, 2.5, rz)
      rack.castShadow = true
      scene.add(rack)

      // LED status rows
      for (let l = 0; l < 8; l++) {
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.04), l % 3 === 0 ? rackLed2 : rackLed)
        led.position.set(rx - 0.4, 0.8 + l * 0.5, rz)
        scene.add(led)
      }

      // Rack light
      const rl = new THREE.PointLight(0x22c55e, 0.5, 6)
      rl.position.set(rx - 0.6, 2.5, rz)
      scene.add(rl)
    }

    // ── Windows (left wall) with glowing exterior ──────────────────────
    const glassMat = mat(0x1e3a5f, 0.05, 0.1, 0.3, 0x3b82f6)
    glassMat.transparent = true
    glassMat.opacity = 0.35

    for (let i = 0; i < 4; i++) {
      const wz = -15 + i * 10
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.5, 4.0), mat(0x0d1a2e, 0.2, 0.8))
      frame.position.set(-24.85, 4, wz)
      scene.add(frame)

      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.0, 3.6), glassMat)
      glass.position.set(-24.75, 4, wz)
      scene.add(glass)

      // Window glow from outside
      const wl = new THREE.PointLight(0x60a5fa, 1.2, 12)
      wl.position.set(-23, 4, wz)
      scene.add(wl)
    }

    // ── Suspended accent lights (ceiling rods) ─────────────────────────
    const rodMat = mat(0x1a2a40, 0.1, 0.9)
    const pendantColors = [0x3b82f6, 0x8b5cf6, 0x06b6d4]
    ;[[-10, -10], [0, -12], [10, -10]].forEach(([x, z], i) => {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 4, 8), rodMat)
      rod.position.set(x, 8, z)
      scene.add(rod)

      const pendantMat = mat(pendantColors[i], 0.2, 0.3, 2.0, pendantColors[i])
      const pendant = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.15, 0.25, 16), pendantMat)
      pendant.position.set(x, 6, z)
      scene.add(pendant)

      const pl = new THREE.PointLight(pendantColors[i], 1.5, 12)
      pl.position.set(x, 5.8, z)
      scene.add(pl)
    })

    return () => {
      // Three.js disposes on scene clear — handled by parent
    }
  }, [scene])

  return null
}
