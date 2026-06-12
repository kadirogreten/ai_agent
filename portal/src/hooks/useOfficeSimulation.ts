import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { getAmphibDeskPositions } from '@/lib/office'
import type { StepEvent } from '@/pages/OfficePage'

// ── Types ──────────────────────────────────────────────────────────────────────

export type AgentBehavior = 'idle' | 'walking' | 'working' | 'talking'

export interface AgentPosition {
  agentId: string
  name: string
  code: string
  role: string
  isCeo: boolean
  position: THREE.Vector3
  targetPosition: THREE.Vector3
  deskPosition: THREE.Vector3    // home
  isMoving: boolean
  mesh?: THREE.Group
  positionHistory: THREE.Vector3[]
  trailMesh?: THREE.Line
  statusIndicator?: THREE.Mesh
  currentJobStatus?: string
  // animated parts
  headMesh?: THREE.Mesh
  screenMesh?: THREE.Mesh
  // sprites
  labelSprite?: THREE.Sprite
  bubbleSprite?: THREE.Sprite
  bubblePhase: number
  // behavior state machine
  behavior: AgentBehavior
  idleTimer: number              // seconds until next idle event
  walkTarget: THREE.Vector3 | null
  walkReturnTarget: THREE.Vector3 | null
  walkPhase: 'going' | 'talking' | 'returning' | null
  walkTimer: number              // countdown for talking pause
}

// ── Constants ──────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, number> = {
  researcher: 0x3b82f6,
  analyst:    0x8b5cf6,
  writer:     0xec4899,
  editor:     0x10b981,
  planner:    0xf59e0b,
  executor:   0xef4444,
  ceo:        0x6366f1,
  default:    0x6366f1,
}

// CEO sits at chair (y≈0.9 = group base, chair seat rel.y=-0.35 → world 0.55 ≈ chair at 0.46)
// z=-10.6 puts figure behind desk facing room (+z = rotation.y 0)
const CEO_DESK_POS   = new THREE.Vector3(14, 0.9, -10.6)
const COFFEE_POS     = new THREE.Vector3(-16, 2, -12)
const WALK_SPEED     = 3.5    // units/sec
const MAX_WALKERS    = 2

// ── Canvas helpers ─────────────────────────────────────────────────────────────

function hexToRgb(hex: number) {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff }
}

function createNameLabel(name: string, role: string, roleColor: number): THREE.Sprite {
  const W = 256, H = 96
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  const { r, g, b } = hexToRgb(roleColor)

  ctx.fillStyle = 'rgba(15,23,42,0.95)'
  ctx.beginPath()
  try { ctx.roundRect(2, 2, W - 4, H - 4, 9) } catch { ctx.rect(2, 2, W - 4, H - 4) }
  ctx.fill()

  ctx.strokeStyle = `rgb(${r},${g},${b})`
  ctx.lineWidth = 3
  ctx.beginPath()
  try { ctx.roundRect(2, 2, W - 4, H - 4, 9) } catch { ctx.rect(2, 2, W - 4, H - 4) }
  ctx.stroke()

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 30px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(name.slice(0, 14), W / 2, 40)

  ctx.fillStyle = '#94a3b8'
  ctx.font = '20px sans-serif'
  ctx.fillText(role, W / 2, 68)

  const tex = new THREE.CanvasTexture(canvas)
  // R5.2: sizeAttenuation TRUE — false modunda scale ekran-uzayı birimine döner ve
  // (1.7, 0.45) dev ekran kaplamasına yol açar (canlıda sahneyi yuttu).
  // Okunabilirlik dünya ölçüsünü büyütüp kontrastı artırarak sağlanır.
  const mat = new THREE.SpriteMaterial({ map: tex, sizeAttenuation: true, transparent: true })
  const spr = new THREE.Sprite(mat)
  spr.scale.set(1.9, 0.7, 1)
  return spr
}

function createSpeechBubble(): THREE.Sprite {
  const W = 96, H = 48
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const tex = new THREE.CanvasTexture(canvas)
  const mat = new THREE.SpriteMaterial({ map: tex, sizeAttenuation: true, transparent: true })
  const spr = new THREE.Sprite(mat)
  spr.scale.set(1.1, 0.55, 1)
  spr.visible = false
  ;(spr.userData as Record<string, unknown>).canvas = canvas
  ;(spr.userData as Record<string, unknown>).texture = tex
  return spr
}

function updateBubbleDots(spr: THREE.Sprite, phase: number) {
  const canvas = spr.userData.canvas as HTMLCanvasElement
  const tex    = spr.userData.texture as THREE.CanvasTexture
  const W = canvas.width, H = canvas.height
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, W, H)

  ctx.fillStyle = 'rgba(255,255,255,0.93)'
  ctx.beginPath()
  try { ctx.roundRect(3, 3, 72, 28, 7) } catch { ctx.rect(3, 3, 72, 28) }
  ctx.fill()

  // bubble tail
  ctx.beginPath()
  ctx.moveTo(18, 31)
  ctx.lineTo(10, 44)
  ctx.lineTo(28, 31)
  ctx.fill()

  ctx.fillStyle = '#1e293b'
  ctx.font = 'bold 20px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('.'.repeat((phase % 3) + 1), 39, 24)

  tex.needsUpdate = true
}

// ── Mesh factory ──────────────────────────────────────────────────────────────

function createAgentMesh(
  agent: AgentPosition,
  scene: THREE.Scene
): { head: THREE.Mesh; screen: THREE.Mesh | null } {
  const group = new THREE.Group()
  group.position.copy(agent.position)

  const roleColor  = ROLE_COLORS[agent.role?.toLowerCase()] ?? ROLE_COLORS.default
  const bodyMat = new THREE.MeshStandardMaterial({
    color:            0x1e293b,
    emissive:         new THREE.Color(roleColor),
    emissiveIntensity: 0.25,
    roughness:        0.5,
    metalness:        0.1,
  })

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), bodyMat.clone())
  head.position.y = 0.68
  head.castShadow = true
  group.add(head)

  // Eyes
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: 0x333333, emissiveIntensity: 0.2 })
  ;[[-0.06, 0.73, 0.15], [0.06, 0.73, 0.15]].forEach(([ex, ey, ez]) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 10), eyeMat)
    eye.position.set(ex, ey, ez)
    group.add(eye)
  })

  // Torso
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.52, 6, 8), bodyMat)
  torso.position.y = 0.22
  torso.castShadow = true
  group.add(torso)

  // Arms
  ;[[-1, 1]].forEach((sides) => {
    sides = Array.isArray(sides) ? sides : [sides]
  })
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.44, 6, 8), bodyMat.clone())
    arm.position.set(side * 0.3, 0.25, 0.1)
    arm.rotation.z = side * (-Math.PI / 3.2)
    arm.castShadow = true
    group.add(arm)
  }

  // Pants / legs
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 })
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.5, 6, 8), pantsMat)
    leg.position.set(side * 0.18, -0.12, 0)
    leg.rotation.x = Math.PI / 4.5
    leg.castShadow = true
    group.add(leg)
  }

  // Chair
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.2 })
  const chairSeat = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.05, 14), chairMat)
  chairSeat.position.y = -0.35
  group.add(chairSeat)
  const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.58, 0.07), chairMat)
  chairBack.position.set(0, 0.33, -0.33)
  group.add(chairBack)

  // Glow aura
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.78, 14, 14),
    new THREE.MeshBasicMaterial({ color: roleColor, transparent: true, opacity: 0.08 })
  )
  group.add(glow)

  // Role accent light
  const roleLight = new THREE.PointLight(roleColor, 1.2, 8)
  roleLight.position.y = 0.9
  group.add(roleLight)

  // Name label sprite — positioned above head
  const label = createNameLabel(agent.name, agent.role ?? 'agent', roleColor)
  label.position.set(0, 1.55, 0)
  group.add(label)
  agent.labelSprite = label

  // Speech bubble sprite
  const bubble = createSpeechBubble()
  bubble.position.set(0, 1.85, 0)
  group.add(bubble)
  agent.bubbleSprite = bubble

  // Screen ref (null for non-desk agents)
  let screenRef: THREE.Mesh | null = null

  group.userData.agentId = agent.agentId
  group.userData.role    = agent.role

  scene.add(group)
  agent.mesh = group

  return { head, screen: screenRef }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseOfficeSimulationProps {
  scene: THREE.Scene | null
  dbAgents?: Array<{ id: string; name: string | null; code: string | null; role: string | null }>
  stepEvents?: StepEvent[]
}

export function useOfficeSimulation({
  scene,
  dbAgents = [],
  stepEvents = [],
}: UseOfficeSimulationProps) {
  const [agents, setAgents] = useState<AgentPosition[]>([])
  const agentsRef           = useRef<Map<string, AgentPosition>>(new Map())
  const animationIdRef      = useRef<number | null>(null)
  const clockRef            = useRef(new THREE.Clock())
  const walkingCountRef     = useRef(0)
  const lastProcessedAtRef  = useRef<string | null>(null)
  const bubbleTimerRef      = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Init agents ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!scene) return

    const amphi = getAmphibDeskPositions(5)
    let amphibIdx = 0

    const agentsToInit: AgentPosition[] = (
      dbAgents.length > 0
        // R5.2: slice(0,8) sınırı kaldırıldı — KPI 11 gösterirken sahne/panel 8'de
        // kalıyordu (CEO dahil 3 ajan hiç çizilmiyordu). Masa sayısı zaten
        // deskCount=nonCeo ile eşleşiyor; güvenlik tavanı 16.
        ? dbAgents.slice(0, 16).map((dbA) => ({
            agentId: dbA.id,
            name:    dbA.name   ?? 'Agent',
            code:    dbA.code   ?? '',
            role:    dbA.role   ?? 'executor',
          }))
        : [
            { agentId: 'demo-1', name: 'Research Bot', code: 'rb-001', role: 'researcher' },
            { agentId: 'demo-2', name: 'Analysis Bot', code: 'ab-001', role: 'analyst' },
            { agentId: 'demo-3', name: 'Writing Bot',  code: 'wb-001', role: 'writer' },
            { agentId: 'demo-4', name: 'Edit Bot',     code: 'eb-001', role: 'editor' },
            { agentId: 'demo-5', name: 'Plan Bot',     code: 'pb-001', role: 'planner' },
          ]
    ).map((a) => {
      // R5.2: rol seçenekleri arasında 'ceo' yok (form kısıtı) — kod/ad ile de tanı.
      const isCeo = a.role?.toLowerCase() === 'ceo' || a.code?.toUpperCase() === 'CEO' || a.name?.toUpperCase() === 'CEO'
      const deskPos = isCeo
        ? CEO_DESK_POS.clone()
        : new THREE.Vector3(amphi[amphibIdx]?.x ?? 0, 2, amphi[amphibIdx]?.z ?? 0)

      if (!isCeo) amphibIdx = Math.min(amphibIdx + 1, amphi.length - 1)

      return {
        agentId:         a.agentId,
        name:            a.name,
        code:            a.code,
        role:            a.role,
        isCeo,
        position:        deskPos.clone(),
        targetPosition:  deskPos.clone(),
        deskPosition:    deskPos.clone(),
        isMoving:        false,
        positionHistory: [],
        bubblePhase:     0,
        behavior:        'idle' as AgentBehavior,
        idleTimer:       20 + Math.random() * 40,
        walkTarget:      null,
        walkReturnTarget: null,
        walkPhase:       null,
        walkTimer:       0,
      }
    })

    agentsToInit.forEach((agent) => {
      const { head, screen } = createAgentMesh(agent, scene)
      agent.headMesh  = head
      agent.screenMesh = screen ?? undefined
      // CEO faces room (+z): default rotation.y=0 works; ensure it's set
      if (agent.isCeo && agent.mesh) {
        agent.mesh.rotation.y = 0
      }
      agentsRef.current.set(agent.agentId, agent)
    })

    setAgents(agentsToInit)
    clockRef.current.start()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, dbAgents])

  // ── Step-event driven behavior ─────────────────────────────────────────────
  useEffect(() => {
    if (stepEvents.length === 0) return
    const newest = stepEvents[0]
    // Dedup: skip if already processed
    if (newest.createdAt === lastProcessedAtRef.current) return
    lastProcessedAtRef.current = newest.createdAt

    const currentAgentId = newest.agentId
    const prevEvent      = stepEvents[1]
    const prevAgentId    = prevEvent?.agentId

    // Mark current agent as working
    const currentAgent = agentsRef.current.get(
      [...agentsRef.current.values()].find((a) => a.code === currentAgentId || a.agentId === currentAgentId || a.role?.toUpperCase() === currentAgentId)?.agentId ?? ''
    )
    // Find by orchestrator agent id (payload.agent = agent.Id from playbook = role-like string)
    const findByOrchId = (id: string) =>
      [...agentsRef.current.values()].find(
        (a) =>
          a.agentId === id ||
          a.code    === id ||
          a.role?.toLowerCase()  === id.toLowerCase() ||
          a.name?.toLowerCase()  === id.toLowerCase()
      )

    const cur = findByOrchId(currentAgentId)
    const isCeoStep = currentAgentId === 'CEO'

    if (cur && cur.behavior !== 'walking') {
      cur.behavior = 'working'
    }

    // Step transition: prevAgent walks to curAgent desk
    if (prevAgentId && prevAgentId !== currentAgentId) {
      const prev = findByOrchId(prevAgentId)
      if (
        prev &&
        cur &&
        prev.agentId !== cur.agentId &&
        prev.behavior !== 'walking' &&
        walkingCountRef.current < MAX_WALKERS
      ) {
        const walkDest = isCeoStep
          ? CEO_DESK_POS.clone().add(new THREE.Vector3(0, 0, 1.2))
          : cur.deskPosition.clone().add(new THREE.Vector3(0.6, 0, 0))

        prev.behavior        = 'walking'
        prev.walkPhase       = 'going'
        prev.walkTarget      = walkDest
        prev.walkReturnTarget = prev.deskPosition.clone()
        prev.walkTimer       = 2.0
        walkingCountRef.current++
      }
    }
  }, [stepEvents])

  // ── Animation loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!scene || agents.length === 0) return

    // Speech bubble dot animation
    if (bubbleTimerRef.current) clearInterval(bubbleTimerRef.current)
    bubbleTimerRef.current = setInterval(() => {
      agentsRef.current.forEach((agent) => {
        if (agent.bubbleSprite?.visible) {
          agent.bubblePhase++
          updateBubbleDots(agent.bubbleSprite, agent.bubblePhase)
        }
      })
    }, 1200)

    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate)
      const delta = Math.min(clockRef.current.getDelta(), 0.1) // cap to avoid spiral
      const t     = clockRef.current.getElapsedTime()

      agentsRef.current.forEach((agent) => {
        if (!agent.mesh) return

        switch (agent.behavior) {
          case 'working': {
            // Head bob (0.5 Hz)
            if (agent.headMesh) {
              agent.headMesh.position.y = 0.68 + Math.sin(t * Math.PI) * 0.025
            }
            // Monitor emissive pulse
            if (agent.screenMesh) {
              const m = agent.screenMesh.material as THREE.MeshStandardMaterial
              m.emissiveIntensity = 0.7 + Math.sin(t * 2) * 0.2
            }
            // Gentle full-body sway
            agent.mesh.rotation.z = Math.sin(t * 0.8) * 0.015
            break
          }

          case 'walking': {
            if (!agent.walkTarget) break
            const dir  = agent.walkTarget.clone().sub(agent.position)
            const dist = dir.length()

            if (dist < 0.25) {
              // Arrived
              if (agent.walkPhase === 'going') {
                agent.behavior  = 'talking'
                agent.walkPhase = 'talking'
                agent.walkTimer = 2.0
                if (agent.bubbleSprite) {
                  agent.bubbleSprite.visible = true
                  updateBubbleDots(agent.bubbleSprite, 0)
                }
              } else if (agent.walkPhase === 'returning') {
                agent.behavior  = 'idle'
                agent.walkPhase = null
                agent.walkTarget = null
                walkingCountRef.current = Math.max(0, walkingCountRef.current - 1)
                if (agent.bubbleSprite) agent.bubbleSprite.visible = false
              }
            } else {
              const step = Math.min(WALK_SPEED * delta, dist)
              agent.position.add(dir.normalize().multiplyScalar(step))
              agent.mesh.position.copy(agent.position)
              // Face walk direction
              agent.mesh.rotation.y = Math.atan2(dir.x, dir.z)
            }

            // Trail
            agent.positionHistory.push(agent.position.clone())
            if (agent.positionHistory.length > 50) agent.positionHistory.shift()
            if (agent.positionHistory.length > 1) {
              if (agent.trailMesh) scene.remove(agent.trailMesh)
              const geo = new THREE.BufferGeometry()
              geo.setFromPoints(agent.positionHistory)
              const roleColor = ROLE_COLORS[agent.role?.toLowerCase()] ?? ROLE_COLORS.default
              const trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: roleColor, transparent: true, opacity: 0.5 }))
              scene.add(trail)
              agent.trailMesh = trail
            }
            break
          }

          case 'talking': {
            agent.walkTimer -= delta
            if (agent.walkTimer <= 0) {
              if (agent.walkReturnTarget) {
                agent.behavior  = 'walking'
                agent.walkPhase = 'returning'
                agent.walkTarget = agent.walkReturnTarget
              } else {
                agent.behavior = 'idle'
                agent.walkPhase = null
              }
              if (agent.bubbleSprite) agent.bubbleSprite.visible = false
            }
            // Clear trail when stationary
            if (agent.trailMesh) {
              scene.remove(agent.trailMesh)
              agent.trailMesh = undefined
              agent.positionHistory = []
            }
            break
          }

          case 'idle': {
            agent.idleTimer -= delta

            if (agent.idleTimer <= 0) {
              agent.idleTimer = 30 + Math.random() * 30

              if (!agent.isCeo && walkingCountRef.current < MAX_WALKERS) {
                const roll = Math.random()
                if (roll < 0.20) {
                  // Coffee walk
                  agent.behavior        = 'walking'
                  agent.walkPhase       = 'going'
                  agent.walkTarget      = COFFEE_POS.clone()
                  agent.walkReturnTarget = agent.deskPosition.clone()
                  agent.walkTimer       = 3.0
                  walkingCountRef.current++
                } else if (roll < 0.30) {
                  // Neighbor visit — pick a random different agent's desk
                  const others = [...agentsRef.current.values()].filter(
                    (a) => a.agentId !== agent.agentId && !a.isCeo && a.behavior === 'idle'
                  )
                  if (others.length > 0) {
                    const target = others[Math.floor(Math.random() * others.length)]
                    agent.behavior        = 'walking'
                    agent.walkPhase       = 'going'
                    agent.walkTarget      = target.deskPosition.clone().add(new THREE.Vector3(0.8, 0, 0))
                    agent.walkReturnTarget = agent.deskPosition.clone()
                    agent.walkTimer       = 1.5
                    walkingCountRef.current++
                  }
                }
                // else: micro sway (handled below)
              }
            }

            // Micro sway for idle agents
            agent.mesh.position.y = agent.position.y + Math.sin(t * 0.6 + agent.agentId.charCodeAt(0)) * 0.01
            agent.mesh.rotation.z = Math.sin(t * 0.4 + agent.agentId.charCodeAt(0)) * 0.008
            break
          }
        }

        // Pulsing status indicator
        if (agent.statusIndicator && agent.currentJobStatus === 'running') {
          const pulse = 1 + Math.sin(t * 3) * 0.3
          agent.statusIndicator.scale.set(pulse, pulse, pulse)
        }
      })
    }

    animate()

    return () => {
      if (animationIdRef.current !== null) cancelAnimationFrame(animationIdRef.current)
      if (bubbleTimerRef.current) clearInterval(bubbleTimerRef.current)
    }
  }, [scene, agents])

  // ── Imperative API ────────────────────────────────────────────────────────

  const moveAgentTo = (agentId: string, targetPos: THREE.Vector3) => {
    const agent = agentsRef.current.get(agentId)
    if (agent) {
      agent.targetPosition.copy(targetPos)
      agent.isMoving = true
    }
  }

  const updateAgentStatus = (agentId: string, status: string) => {
    const agent = agentsRef.current.get(agentId)
    if (!agent) return
    agent.currentJobStatus = status

    const statusColors: Record<string, number> = {
      pending:   0x6b7280,
      running:   0xf59e0b,
      completed: 0x10b981,
      failed:    0xef4444,
    }
    const color = statusColors[status] ?? statusColors.pending

    if (!agent.statusIndicator && agent.mesh) {
      const ind = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 12, 12),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.5 })
      )
      ind.position.y = 1.4
      agent.mesh.add(ind)
      agent.statusIndicator = ind
    } else if (agent.statusIndicator) {
      const m = agent.statusIndicator.material as THREE.MeshStandardMaterial
      m.color.setHex(color)
      m.emissive.setHex(color)
    }
  }

  const moveAgentToCeoZone = (agentId: string) => {
    moveAgentTo(agentId, new THREE.Vector3(0, 2, 0))
    updateAgentStatus(agentId, 'running')
  }

  const returnAgentToDesk = (agentId: string, deskIndex: number) => {
    const amphi = getAmphibDeskPositions(5)
    const agent = agentsRef.current.get(agentId)
    if (!agent) return
    if (agent.isCeo) {
      moveAgentTo(agentId, CEO_DESK_POS)
    } else if (deskIndex < amphi.length) {
      const { x, z } = amphi[deskIndex]
      moveAgentTo(agentId, new THREE.Vector3(x, 2, z))
    }
    updateAgentStatus(agentId, 'idle')
  }

  return { agents, moveAgentTo, moveAgentToCeoZone, returnAgentToDesk, updateAgentStatus }
}
