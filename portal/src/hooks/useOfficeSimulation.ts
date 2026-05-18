import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

export interface AgentPosition {
  agentId: string
  name: string
  code: string
  role: string
  position: THREE.Vector3
  targetPosition: THREE.Vector3
  isMoving: boolean
  mesh?: THREE.Group
  positionHistory: THREE.Vector3[]
  trailMesh?: THREE.Line
  statusIndicator?: THREE.Mesh
  currentJobStatus?: string
}

const ROLE_COLORS: Record<string, number> = {
  researcher: 0x3b82f6,     // blue
  analyst: 0x8b5cf6,        // purple
  writer: 0xec4899,         // pink
  editor: 0x10b981,         // emerald
  planner: 0xf59e0b,        // amber
  executor: 0xef4444,       // red
  default: 0x6366f1,        // indigo
}

interface UseOfficeSimulationProps {
  scene: THREE.Scene | null
  dbAgents?: Array<{ id: string; name: string | null; code: string | null; role: string | null }>
}

export function useOfficeSimulation({ scene, dbAgents = [] }: UseOfficeSimulationProps) {
  const [agents, setAgents] = useState<AgentPosition[]>([])
  const agentsRef = useRef<Map<string, AgentPosition>>(new Map())
  const animationIdRef = useRef<number | null>(null)

  // Initialize agents at desk positions
  useEffect(() => {
    if (!scene) return

    const deskPositions = [
      { x: -12, z: 0 },
      { x: -6, z: -10 },
      { x: 0, z: -15 },
      { x: 6, z: -10 },
      { x: 12, z: 0 },
    ]

    // Use database agents if available, otherwise use demo agents
    const agentsToInit = dbAgents.length > 0
      ? dbAgents.slice(0, 5).map((dbAgent, idx) => ({
          agentId: dbAgent.id,
          name: dbAgent.name || `Agent ${idx + 1}`,
          code: dbAgent.code || `agent-${idx + 1}`,
          role: dbAgent.role || 'executor',
          position: new THREE.Vector3(deskPositions[idx].x, 2, deskPositions[idx].z),
          targetPosition: new THREE.Vector3(deskPositions[idx].x, 2, deskPositions[idx].z),
          isMoving: false,
          positionHistory: [],
        }))
      : [
          {
            agentId: 'agent-1',
            name: 'Research Bot',
            code: 'rb-001',
            role: 'researcher',
            position: new THREE.Vector3(deskPositions[0].x, 2, deskPositions[0].z),
            targetPosition: new THREE.Vector3(deskPositions[0].x, 2, deskPositions[0].z),
            isMoving: false,
            positionHistory: [],
          },
          {
            agentId: 'agent-2',
            name: 'Analysis Bot',
            code: 'ab-001',
            role: 'analyst',
            position: new THREE.Vector3(deskPositions[1].x, 2, deskPositions[1].z),
            targetPosition: new THREE.Vector3(deskPositions[1].x, 2, deskPositions[1].z),
            isMoving: false,
            positionHistory: [],
          },
          {
            agentId: 'agent-3',
            name: 'Writing Bot',
            code: 'wb-001',
            role: 'writer',
            position: new THREE.Vector3(deskPositions[2].x, 2, deskPositions[2].z),
            targetPosition: new THREE.Vector3(deskPositions[2].x, 2, deskPositions[2].z),
            isMoving: false,
            positionHistory: [],
          },
          {
            agentId: 'agent-4',
            name: 'Edit Bot',
            code: 'eb-001',
            role: 'editor',
            position: new THREE.Vector3(deskPositions[3].x, 2, deskPositions[3].z),
            targetPosition: new THREE.Vector3(deskPositions[3].x, 2, deskPositions[3].z),
            isMoving: false,
            positionHistory: [],
          },
          {
            agentId: 'agent-5',
            name: 'Plan Bot',
            code: 'pb-001',
            role: 'planner',
            position: new THREE.Vector3(deskPositions[4].x, 2, deskPositions[4].z),
            targetPosition: new THREE.Vector3(deskPositions[4].x, 2, deskPositions[4].z),
            isMoving: false,
            positionHistory: [],
          },
        ]

    agentsToInit.forEach((agent) => {
      agentsRef.current.set(agent.agentId, agent)
      createAgentMesh(agent, scene)
    })

    setAgents(agentsToInit)
  }, [scene, dbAgents])

  // Create 3D mesh for agent - humanoid character SITTING AT DESK
  function createAgentMesh(agent: AgentPosition, scene: THREE.Scene) {
    const group = new THREE.Group()
    group.position.copy(agent.position)

    const roleColor = ROLE_COLORS[agent.role] ?? ROLE_COLORS.default

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: roleColor,
      emissive: roleColor,
      emissiveIntensity: 0.4,
      roughness: 0.5,
      metalness: 0.4,
    })

    // Head - higher position for sitting
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 16, 16),
      bodyMaterial
    )
    head.position.y = 0.65 // Sitting position - lower than standing
    head.castShadow = true
    head.receiveShadow = true
    group.add(head)

    // Body (torso) - sitting posture
    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.2, 0.5, 8, 8),
      bodyMaterial
    )
    torso.position.y = 0.25 // Lower for sitting
    torso.rotation.z = 0.1 // Slight lean back
    torso.castShadow = true
    torso.receiveShadow = true
    group.add(torso)

    // Left arm - relaxed on desk
    const leftArm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.08, 0.5, 8, 8),
      bodyMaterial
    )
    leftArm.position.set(-0.25, 0.3, 0.15)
    leftArm.rotation.z = Math.PI / 3 // More horizontal for desk work
    leftArm.castShadow = true
    group.add(leftArm)

    // Right arm - on desk/keyboard
    const rightArm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.08, 0.5, 8, 8),
      bodyMaterial
    )
    rightArm.position.set(0.25, 0.3, 0.15)
    rightArm.rotation.z = -Math.PI / 3 // Reaching toward keyboard
    rightArm.castShadow = true
    group.add(rightArm)

    // Left leg - sitting under desk
    const leftLeg = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.1, 0.5, 8, 8),
      new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        roughness: 0.6,
        metalness: 0.1,
      })
    )
    leftLeg.position.set(-0.15, -0.15, 0) // Angled under desk
    leftLeg.rotation.x = Math.PI / 4
    leftLeg.castShadow = true
    group.add(leftLeg)

    // Right leg - sitting under desk
    const rightLeg = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.1, 0.5, 8, 8),
      new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        roughness: 0.6,
        metalness: 0.1,
      })
    )
    rightLeg.position.set(0.15, -0.15, 0) // Angled under desk
    rightLeg.rotation.x = Math.PI / 4
    rightLeg.castShadow = true
    group.add(rightLeg)

    // Office chair back rest - behind agent
    const chairBackrest = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.6, 0.08),
      new THREE.MeshStandardMaterial({
        color: 0x2a2a2a,
        roughness: 0.5,
        metalness: 0.2,
      })
    )
    chairBackrest.position.set(0, 0.35, -0.35)
    chairBackrest.castShadow = true
    group.add(chairBackrest)

    // Office chair - base
    const chairBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 0.05),
      new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        roughness: 0.4,
        metalness: 0.3,
      })
    )
    chairBase.position.y = -0.35
    chairBase.castShadow = true
    group.add(chairBase)

    // Glow aura
    const glowGeometry = new THREE.SphereGeometry(0.8, 16, 16)
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: roleColor,
      transparent: true,
      opacity: 0.1,
    })
    const glow = new THREE.Mesh(glowGeometry, glowMaterial)
    group.add(glow)

    // Light above agent
    const light = new THREE.PointLight(roleColor, 2, 12)
    light.position.y = 0.8
    group.add(light)

    // Store metadata
    group.userData.agentId = agent.agentId
    group.userData.role = agent.role

    scene.add(group)
    agent.mesh = group
  }

  // Animation loop
  useEffect(() => {
    if (!scene || agents.length === 0) return

    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate)

      // Update agent positions
      agents.forEach((agent) => {
        if (!agent.mesh) return

        // Smooth movement toward target
        const delta = 0.05
        agent.position.lerp(agent.targetPosition, delta)
        agent.mesh.position.copy(agent.position)

        // Track position history for motion trails
        if (agent.isMoving) {
          agent.positionHistory.push(agent.position.clone())
          // Keep only last 50 points to avoid memory issues
          if (agent.positionHistory.length > 50) {
            agent.positionHistory.shift()
          }

          // Update or create trail mesh
          if (agent.positionHistory.length > 1) {
            if (agent.trailMesh) {
              scene.remove(agent.trailMesh)
            }

            const geometry = new THREE.BufferGeometry()
            geometry.setFromPoints(agent.positionHistory)
            const roleColor = ROLE_COLORS[agent.role] ?? ROLE_COLORS.default
            const material = new THREE.LineBasicMaterial({
              color: roleColor,
              linewidth: 2,
              transparent: true,
              opacity: 0.6,
            })
            const trail = new THREE.Line(geometry, material)
            scene.add(trail)
            agent.trailMesh = trail
          }
        } else if (agent.trailMesh) {
          // Remove trail when agent stops moving
          scene.remove(agent.trailMesh)
          agent.trailMesh.geometry.dispose()
          ;(agent.trailMesh.material as THREE.Material).dispose()
          agent.trailMesh = undefined
          agent.positionHistory = []
        }

        // Check if reached target
        const distance = agent.position.distanceTo(agent.targetPosition)
        if (distance < 0.1) {
          agent.isMoving = false
        }

        // Gentle bob animation
        agent.mesh.position.y += Math.sin(Date.now() * 0.002) * 0.02
      })
    }

    animate()

    return () => {
      if (animationIdRef.current !== null) {
        cancelAnimationFrame(animationIdRef.current)
      }
    }
  }, [scene, agents])

  // Move agent to position
  const moveAgentTo = (agentId: string, targetPos: THREE.Vector3) => {
    const agent = agentsRef.current.get(agentId)
    if (agent) {
      agent.targetPosition.copy(targetPos)
      agent.isMoving = true
    }
  }

  // Update agent status indicator
  const updateAgentStatus = (agentId: string, status: string) => {
    const agent = agentsRef.current.get(agentId)
    if (!agent) return

    agent.currentJobStatus = status

    const statusColors: Record<string, number> = {
      pending: 0x6b7280,    // gray
      running: 0xf59e0b,    // amber
      completed: 0x10b981,  // emerald
      failed: 0xef4444,     // red
    }

    const color = statusColors[status] ?? statusColors.pending

    // Create or update status indicator
    if (!agent.statusIndicator && agent.mesh) {
      const geometry = new THREE.SphereGeometry(0.15, 16, 16)
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.8,
        roughness: 0.3,
        metalness: 0.5,
      })
      const indicator = new THREE.Mesh(geometry, material)
      indicator.position.y = 1.3
      agent.mesh.add(indicator)
      agent.statusIndicator = indicator
    } else if (agent.statusIndicator) {
      const material = agent.statusIndicator.material as THREE.MeshStandardMaterial
      material.color.setHex(color)
      material.emissive.setHex(color)
    }
  }

  // Move agent to CEO zone
  const moveAgentToCeoZone = (agentId: string) => {
    moveAgentTo(agentId, new THREE.Vector3(0, 2, 5))
    updateAgentStatus(agentId, 'running')
  }

  // Return agent to desk
  const returnAgentToDesk = (agentId: string, deskIndex: number) => {
    const deskPositions = [
      new THREE.Vector3(-12, 2, 0),
      new THREE.Vector3(-6, 2, -10),
      new THREE.Vector3(0, 2, -15),
      new THREE.Vector3(6, 2, -10),
      new THREE.Vector3(12, 2, 0),
    ]
    if (deskIndex < deskPositions.length) {
      moveAgentTo(agentId, deskPositions[deskIndex])
      updateAgentStatus(agentId, 'idle')
    }
  }

  return {
    agents,
    moveAgentTo,
    moveAgentToCeoZone,
    returnAgentToDesk,
    updateAgentStatus,
  }
}
