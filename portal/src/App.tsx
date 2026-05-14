import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'
import LoginPage from '@/pages/LoginPage'
import AppShell from '@/components/AppShell'
import DashboardPage from '@/pages/DashboardPage'
import RunsPage from '@/pages/RunsPage'
import BundlesPage from '@/pages/BundlesPage'
import FactsPage from '@/pages/FactsPage'
import RunDetailPage from '@/pages/RunDetailPage'
import BundleDetailPage from '@/pages/BundleDetailPage'
import FactDetailPage from '@/pages/FactDetailPage'
import JobsPage from '@/pages/JobsPage'
import JobDetailPage from '@/pages/JobDetailPage'
import CeoReviewPage from '@/pages/CeoReviewPage'
import AgentsPage from '@/pages/AgentsPage'
import AgentUpsertPage from '@/pages/AgentUpsertPage'
import ReportPage from '@/pages/ReportPage'
import CostLedgerPage from '@/pages/CostLedgerPage'
import ApprovalQueuePage from '@/pages/ApprovalQueuePage'
import AuditLogPage from '@/pages/AuditLogPage'
import ToolsPage from '@/pages/ToolsPage'

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
        <Route path="/agents" element={<Navigate to="/app/agents" replace />} />
        <Route path="/agents/new" element={<Navigate to="/app/agents/new" replace />} />
        <Route path="/agents/:agentId/edit" element={<Navigate to="/app/agents/:agentId/edit" replace />} />
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
          <Route index element={<Navigate to="/app/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="runs/:runId" element={<RunDetailPage />} />
          <Route path="reports/:runId" element={<ReportPage />} />
          <Route path="bundles" element={<BundlesPage />} />
          <Route path="bundles/:bundleId" element={<BundleDetailPage />} />
          <Route path="facts" element={<FactsPage />} />
          <Route path="facts/:factId" element={<FactDetailPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="jobs/:jobId" element={<JobDetailPage />} />
          <Route path="jobs/:jobId/review" element={<CeoReviewPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agents/new" element={<AgentUpsertPage mode="new" />} />
          <Route path="agents/:agentId/edit" element={<AgentUpsertPage mode="edit" />} />
          <Route path="tools" element={<ToolsPage />} />
          <Route path="cost-ledger" element={<CostLedgerPage />} />
          <Route path="approval-queue" element={<ApprovalQueuePage />} />
          <Route path="audit-log" element={<AuditLogPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </Router>
  )
}
