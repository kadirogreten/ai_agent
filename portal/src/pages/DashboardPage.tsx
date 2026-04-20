import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { 
  BarChart3, 
  TrendingUp, 
  Clock, 
  CheckCircle, 
  AlertCircle,
  Download,
  RefreshCw
} from 'lucide-react'

type DashboardStats = {
  totalRuns: number
  successfulRuns: number
  failedRuns: number
  totalBundles: number
  totalFacts: number
  lastRunDate: string | null
  recentRuns: Array<{
    id: string
    external_id: string | null
    title: string | null
    status: 'running' | 'success' | 'fail'
    created_at: string
  }>
  recentJobs: Array<{
    id: string
    mode: string
    status: 'pending' | 'running' | 'success' | 'fail'
    request_text: string | null
    created_at: string
  }>
}

export default function DashboardPage() {
  const init = useAuthStore((s) => s.init)
  const user = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  useEffect(() => {
    init()
  }, [init])

  useEffect(() => {
    if (!initialized || !user) return
    loadDashboardData()
  }, [initialized, user, lastRefresh])

  const loadDashboardData = async () => {
    try {
      setLoading(true)

      // Get runs statistics
      const { data: runsData, error: runsError } = await supabase
        .from('runs')
        .select('id, status, created_at, external_id, title')
        .eq('owner_user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10)

      if (runsError) throw runsError

      // Get bundles count
      const { count: bundlesCount, error: bundlesError } = await supabase
        .from('bundles')
        .select('*', { count: 'exact', head: true })
        .eq('owner_user_id', user.id)

      if (bundlesError) throw bundlesError

      // Get facts count
      const { count: factsCount, error: factsError } = await supabase
        .from('knowledge_facts')
        .select('*', { count: 'exact', head: true })
        .eq('owner_user_id', user.id)

      if (factsError) throw factsError

      // Get recent jobs
      const { data: jobsData, error: jobsError } = await supabase
        .from('run_requests')
        .select('id, mode, status, request_text, created_at')
        .eq('owner_user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5)

      if (jobsError) throw jobsError

      const successfulRuns = runsData?.filter(r => r.status === 'success').length || 0
      const failedRuns = runsData?.filter(r => r.status === 'fail').length || 0

      setStats({
        totalRuns: runsData?.length || 0,
        successfulRuns,
        failedRuns,
        totalBundles: bundlesCount || 0,
        totalFacts: factsCount || 0,
        lastRunDate: runsData?.[0]?.created_at || null,
        recentRuns: runsData?.slice(0, 5) || [],
        recentJobs: jobsData || []
      })
    } catch (error) {
      console.error('Dashboard data load error:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = () => {
    setLastRefresh(new Date())
  }

  const handleExportReport = () => {
    if (!stats) return

    const report = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalRuns: stats.totalRuns,
        successfulRuns: stats.successfulRuns,
        failedRuns: stats.failedRuns,
        successRate: stats.totalRuns > 0 ? Math.round((stats.successfulRuns / stats.totalRuns) * 100) : 0,
        totalBundles: stats.totalBundles,
        totalFacts: stats.totalFacts
      },
      recentActivity: {
        runs: stats.recentRuns,
        jobs: stats.recentJobs
      }
    }

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ceo-report-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="p-6">
        <div className="text-center text-gray-500">
          <AlertCircle className="w-12 h-12 mx-auto mb-2" />
          <p>Dashboard verileri yüklenemedi</p>
          <Button onClick={handleRefresh} className="mt-4">
            <RefreshCw className="w-4 h-4 mr-2" />
            Tekrar Dene
          </Button>
        </div>
      </div>
    )
  }

  const successRate = stats.totalRuns > 0 ? Math.round((stats.successfulRuns / stats.totalRuns) * 100) : 0

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">CEO Dashboard</h1>
          <p className="text-gray-600 mt-1">AgentArmy performansınızın genel görünümü</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Yenile
          </Button>
          <Button onClick={handleExportReport}>
            <Download className="w-4 h-4 mr-2" />
            Rapor İndir
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Toplam Çalıştırma</p>
              <p className="text-2xl font-bold text-gray-900">{stats.totalRuns}</p>
            </div>
            <BarChart3 className="w-8 h-8 text-blue-600" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Başarı Oranı</p>
              <p className="text-2xl font-bold text-green-600">{successRate}%</p>
            </div>
            <TrendingUp className="w-8 h-8 text-green-600" />
          </div>
          <div className="mt-2 text-xs text-gray-500">
            {stats.successfulRuns} başarılı / {stats.failedRuns} başarısız
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Toplam Bundle</p>
              <p className="text-2xl font-bold text-gray-900">{stats.totalBundles}</p>
            </div>
            <CheckCircle className="w-8 h-8 text-purple-600" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Bilgi Faktı</p>
              <p className="text-2xl font-bold text-gray-900">{stats.totalFacts}</p>
            </div>
            <Clock className="w-8 h-8 text-orange-600" />
          </div>
        </Card>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Runs */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Son Çalıştırmalar</h3>
          <div className="space-y-3">
            {stats.recentRuns.length === 0 ? (
              <p className="text-gray-500 text-sm">Henüz çalıştırma yok</p>
            ) : (
              stats.recentRuns.map((run) => (
                <div key={run.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Badge tone={run.status === 'success' ? 'green' : run.status === 'fail' ? 'red' : 'yellow'}>
                      {run.status === 'success' ? '✓' : run.status === 'fail' ? '✗' : '⏳'}
                    </Badge>
                    <div>
                      <p className="font-medium text-sm">{run.title || 'Başlıksız'}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(run.created_at).toLocaleDateString('tr-TR')}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Recent Jobs */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Son İşler</h3>
          <div className="space-y-3">
            {stats.recentJobs.length === 0 ? (
              <p className="text-gray-500 text-sm">Henüz iş yok</p>
            ) : (
              stats.recentJobs.map((job) => (
                <div key={job.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Badge tone={job.status === 'success' ? 'green' : job.status === 'fail' ? 'red' : 'yellow'}>
                      {job.mode.toUpperCase()}
                    </Badge>
                    <div>
                      <p className="font-medium text-sm truncate max-w-xs">
                        {job.request_text?.slice(0, 50) || 'İçerik yok'}...
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(job.created_at).toLocaleDateString('tr-TR')}
                      </p>
                    </div>
                  </div>
                  <Badge tone={job.status === 'success' ? 'green' : job.status === 'fail' ? 'red' : 'yellow'}>
                    {job.status}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Hızlı İşlemler</h3>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline">
            <BarChart3 className="w-4 h-4 mr-2" />
            Detaylı Analiz
          </Button>
          <Button variant="outline">
            <TrendingUp className="w-4 h-4 mr-2" />
            Trend Raporu
          </Button>
          <Button variant="outline">
            <CheckCircle className="w-4 h-4 mr-2" />
            Başarı Metrikleri
          </Button>
        </div>
      </Card>
    </div>
  )
}
