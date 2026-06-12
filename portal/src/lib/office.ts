import * as THREE from 'three'

// Amphitheater desk positions — two-row arc wrapping three sides of the ops table.
// Arc: 130°→410° (280° sweep) — ön-merkez 80° boşluk = kamera koridoru + ops görüş hattı.
// Inner r=8 (ilk 6 masa), outer eliptic xR=12.5/zR=10 (kalanlar, oda sınırı içinde).
// Outer sıra iç sıraya yarım adım offset → masalar arasına "nesting" yapar.
// Her pozisyon { x, z, angle } döndürür — angle desk rotation hesabında kullanılır:
//   deskGroup.rotation.y = -π/2 - angle  → local +Z merkeze bakar (ajan merkeze dönük).
export function getAmphibDeskPositions(count: number): { x: number; z: number; angle: number }[] {
  if (count < 1) return [{ x: 0, z: 0, angle: 0 }]

  const startRad = (130 * Math.PI) / 180
  const sweepRad = (280 * Math.PI) / 180

  const INNER_MAX = 6
  const INNER_R   = 8
  const OUTER_XR  = 12.5  // eliptic x-radius — stays in room (±18)
  const OUTER_ZR  = 10    // eliptic z-radius — stays in room (±14, with 1 unit clearance)

  const innerCount = Math.min(count, INNER_MAX)
  const outerCount = count - innerCount

  const makeRow = (
    n: number,
    xR: number,
    zR: number,
    offset = 0,
  ): { x: number; z: number; angle: number }[] => {
    if (n === 0) return []
    return Array.from({ length: n }, (_, i) => {
      const angle = n === 1
        ? startRad + sweepRad / 2 + offset
        : startRad + offset + i * (sweepRad / (n - 1))
      return { x: Math.cos(angle) * xR, z: Math.sin(angle) * zR, angle }
    })
  }

  // Outer sıra: iç sıra adımının yarısı kadar ötelenir → iç masaların arasına nestler
  const innerStep  = innerCount > 1 ? sweepRad / (innerCount - 1) : sweepRad
  const outerOffset = innerStep / 2

  return [
    ...makeRow(innerCount, INNER_R, INNER_R),
    ...makeRow(outerCount, OUTER_XR, OUTER_ZR, outerOffset),
  ]
}

// Ring color for agent desk based on job status
export function getAgentRingColor(status: string): number {
  if (status === 'running') return 0x3b82f6
  if (status === 'pending') return 0xf59e0b
  return 0x475569
}

// Center ops table ring color
export function getOpsTableColor(hasEscalation: boolean): number {
  return hasEscalation ? 0xef4444 : 0x6366f1
}

// Map run status to color
export function mapStatusToColor(status: string): number {
  const colorMap: Record<string, number> = {
    pending: 0xf59e0b,    // amber
    running: 0x3b82f6,    // blue
    success: 0x10b981,    // emerald
    failed: 0xef4444,     // red
    paused: 0x6b7280,     // gray
    cancelled: 0x8b5cf6,  // purple
  }
  return colorMap[status] ?? colorMap.pending
}

// Get data flow paths from agent connections
type DataFlowAgent = { id: string }
type DataFlowRun = { agent_id: string | null; status: string }

export function getDataFlowPaths(
  agents: DataFlowAgent[],
  runs: DataFlowRun[],
): Array<{ from: number; to: number; intensity: number }> {
  const flows: Array<{ from: number; to: number; intensity: number }> = []

  // Group active runs by agents
  const runsByAgent = new Map<string, number>()
  runs.forEach((run) => {
    if (run.agent_id && (run.status === 'running' || run.status === 'pending')) {
      runsByAgent.set(run.agent_id, (runsByAgent.get(run.agent_id) ?? 0) + 1)
    }
  })

  // Create flows between consecutive agents based on activity
  agents.forEach((agent, idx) => {
    const nextIdx = (idx + 1) % agents.length
    const intensity = runsByAgent.get(agent.id) ?? 0
    if (intensity > 0) {
      flows.push({ from: idx, to: nextIdx, intensity: Math.min(intensity / 10, 1) })
    }
  })

  return flows
}

// Format milliseconds to human readable
export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const sec = ms / 1000
  if (sec < 60) return `${sec.toFixed(1)}s`
  const min = sec / 60
  if (min < 60) return `${min.toFixed(1)}m`
  const hr = min / 60
  return `${hr.toFixed(1)}h`
}

// Get KPI color based on value and thresholds
export function getKpiColor(value: number, good: number, warning: number): number {
  if (value <= good) return 0x10b981    // green
  if (value <= warning) return 0xf59e0b // amber
  return 0xef4444                        // red
}

// Create a simple 3D bar for KPI visualization
export function create3DBar(height: number, color: number): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(2, height, 2)
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.3,
    roughness: 0.4,
    metalness: 0.6,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

// Create a rotating ring for KPI (latency visualization)
export function create3DRing(radius: number, color: number): THREE.Mesh {
  const geometry = new THREE.TorusGeometry(radius, 0.3, 16, 32)
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.4,
    roughness: 0.3,
    metalness: 0.7,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

// Create particle system for fail rate visualization
export function create3DParticles(count: number, color: number): THREE.Points {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)

  for (let i = 0; i < count * 3; i += 3) {
    positions[i] = (Math.random() - 0.5) * 8        // x
    positions[i + 1] = (Math.random() - 0.5) * 8    // y
    positions[i + 2] = (Math.random() - 0.5) * 8    // z
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  const material = new THREE.PointsMaterial({
    color,
    size: 0.2,
    sizeAttenuation: true,
  })

  const mesh = new THREE.Points(geometry, material)
  return mesh
}
