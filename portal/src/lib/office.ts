import * as THREE from 'three'

export const ROLE_COLORS: Record<string, number> = {
  researcher: 0x3b82f6,     // blue
  analyst: 0x8b5cf6,        // purple
  writer: 0xec4899,         // pink
  editor: 0x10b981,         // emerald
  planner: 0xf59e0b,        // amber
  executor: 0xef4444,       // red
  default: 0x6366f1,        // indigo
}

export const ROLE_LABELS: Record<string, string> = {
  researcher: 'Researcher',
  analyst: 'Analyst',
  writer: 'Writer',
  editor: 'Editor',
  planner: 'Planner',
  executor: 'Executor',
  default: 'Agent',
}

// Amphitheater desk positions — radius 10, 200°→340° arc facing +Z camera
export function getAmphibDeskPositions(count: number): { x: number; z: number }[] {
  if (count < 2) return [{ x: 0, z: 0 }]
  const radius = 10
  const startRad = (200 * Math.PI) / 180
  const sweepRad = (140 * Math.PI) / 180
  return Array.from({ length: count }, (_, i) => {
    const angle = startRad + i * (sweepRad / (count - 1))
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius }
  })
}

// Calculate amphitheater positions for agent avatars (y=2 = standing height)
export function calculateAgentPositions(agentCount: number): THREE.Vector3[] {
  if (agentCount < 1) return []
  if (agentCount === 1) return [new THREE.Vector3(0, 2, 0)]
  return getAmphibDeskPositions(agentCount).map(({ x, z }) => new THREE.Vector3(x, 2, z))
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
