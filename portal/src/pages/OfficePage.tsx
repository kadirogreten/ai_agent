import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import Office3DScene from '@/components/Office3DScene'
import OfficeGeometry from '@/components/office/OfficeGeometry'
import { useOfficeSimulation } from '@/hooks/useOfficeSimulation'
import { supabase } from '@/lib/supabaseClient'
import * as THREE from 'three'

type Agent = { id: string; name: string | null; code: string | null; role: string | null }
type Run = { id: string; agent_id: string | null; status: string; created_at: string }
type Persona = { id: string; slug: string; name: string | null }

export default function OfficePage() {
  const init = useAuthStore((s) => s.init)
  const user = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [scene, setScene] = useState<THREE.Scene | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [err, setErr] = useState<string | null>(null)

  const { agents: officeAgents } = useOfficeSimulation(scene)

  useEffect(() => {
    init()
  }, [init])

  useEffect(() => {
    const load = async () => {
      if (!initialized || !user) return

      try {
        const session = await supabase.auth.getSession()
        console.log('Session:', session?.data?.session ? 'valid' : 'invalid')

        // Fetch agents
        const { data: agentsData, error: agentsErr } = await supabase
          .from('agents')
          .select('id,name,code,role')
          .limit(20)

        if (agentsErr) {
          console.error('Agents error:', agentsErr)
          setErr(`Agents: ${agentsErr.message}`)
        } else {
          setAgents((agentsData ?? []) as Agent[])
          console.log('Agents loaded:', agentsData?.length)
        }

        // Fetch recent runs (skip for now - agent_id column doesn't exist)
        // TODO: Check actual runs table schema
        setRuns([])

        // Fetch personas
        const { data: personasData, error: personasErr } = await supabase
          .from('personas')
          .select('id,slug,name')
          .limit(50)

        if (personasErr) {
          console.error('Personas error:', personasErr)
        } else {
          setPersonas((personasData ?? []) as Persona[])
          console.log('Personas loaded:', personasData?.length)
        }
      } catch (ex) {
        console.error('Load error:', ex)
        setErr(ex instanceof Error ? ex.message : 'Failed to load data')
      }
    }

    load()
  }, [initialized, user])

  const handleSceneReady = (sceneObj: THREE.Scene) => {
    setScene(sceneObj)
    console.log('Scene ready')
  }

  return (
    <div className="space-y-4 h-screen flex flex-col">
      <div className="px-4 py-3">
        <h1 className="text-2xl font-bold text-white">3D Office Dashboard</h1>
        <p className="text-sm text-white/40 mt-1">
          Interactive visualization of agent workflows and task pipelines
        </p>
      </div>

      {err && (
        <div className="mx-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {err}
        </div>
      )}

      <div className="mx-4 flex gap-4">
        <div className="flex-1 rounded-lg border border-white/[0.06] bg-gradient-to-b from-[#0f1829] to-[#0a1020] p-4">
          <div className="text-xs font-semibold text-white/60 mb-3">Statistics</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-white/60">Agents</span>
              <span className="text-white/90">{agents.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Active Runs</span>
              <span className="text-emerald-400">{runs.filter((r) => r.status === 'running').length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Personas</span>
              <span className="text-white/90">{personas.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Office Agents (3D)</span>
              <span className="text-white/90">{officeAgents.length}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 rounded-lg border border-white/[0.06] bg-gradient-to-b from-[#0f1829] to-[#0a1020] p-4">
          <div className="text-xs font-semibold text-white/60 mb-3">Active Agents</div>
          <div className="space-y-2 text-xs max-h-40 overflow-y-auto scrollbar-none">
            {officeAgents.length === 0 ? (
              <p className="text-white/40">Initializing 3D office...</p>
            ) : (
              officeAgents.map((agent) => (
                <div key={agent.agentId} className="flex items-center gap-2 p-1.5 rounded bg-white/5">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: '#3b82f6' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-white/90 truncate">{agent.name}</div>
                    <div className="text-white/40 text-[10px]">{agent.role}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mx-4 flex-1 rounded-lg border border-white/[0.06] bg-gradient-to-b from-[#0f1829] to-[#0a1020] overflow-hidden">
        <Office3DScene onSceneReady={handleSceneReady}>
          {scene && <OfficeGeometry scene={scene} />}
        </Office3DScene>
      </div>

      <div className="mx-4 py-4 text-xs text-white/30">
        <div className="space-y-1">
          <div>🎮 3D Office with 5 agents at desks + CEO meeting zone</div>
          <div>📊 Dashboard shows live agent/run statistics when data loads</div>
          <div>✨ Smooth animations and role-based color coding</div>
        </div>
      </div>
    </div>
  )
}
