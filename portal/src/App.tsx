import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'
import LoginPage from '@/pages/LoginPage'
import AppShell from '@/components/AppShell'
import RunsPage from '@/pages/RunsPage'
import BundlesPage from '@/pages/BundlesPage'
import FactsPage from '@/pages/FactsPage'
import RunDetailPage from '@/pages/RunDetailPage'
import BundleDetailPage from '@/pages/BundleDetailPage'
import FactDetailPage from '@/pages/FactDetailPage'
import JobsPage from '@/pages/JobsPage'
import JobDetailPage from '@/pages/JobDetailPage'

export default function App() {
  const init = useAuthStore((s) => s.init)
  const initialized = useAuthStore((s) => s.initialized)
  const session = useAuthStore((s) => s.session)

  useEffect(() => {
    init()
  }, [init])

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/app" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/app"
          element={
            initialized && !session ? (
              <Navigate to="/login" replace />
            ) : (
              <AppShell />
            )
          }
        >
          <Route index element={<Navigate to="/app/runs" replace />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="runs/:runId" element={<RunDetailPage />} />
          <Route path="bundles" element={<BundlesPage />} />
          <Route path="bundles/:bundleId" element={<BundleDetailPage />} />
          <Route path="facts" element={<FactsPage />} />
          <Route path="facts/:factId" element={<FactDetailPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="jobs/:jobId" element={<JobDetailPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </Router>
  )
}
