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
import JobReportPage from '@/pages/JobReportPage'
import AgentsPage from '@/pages/AgentsPage'
import AgentUpsertPage from '@/pages/AgentUpsertPage'
import ReportPage from '@/pages/ReportPage'
import CostLedgerPage from '@/pages/CostLedgerPage'
import ApprovalQueuePage from '@/pages/ApprovalQueuePage'
import AuditLogPage from '@/pages/AuditLogPage'
import ToolsPage from '@/pages/ToolsPage'
import StockPage from '@/pages/StockPage'
import TedarikReportPage from '@/pages/TedarikReportPage'
import SectorBuilderPage from '@/pages/SectorBuilderPage'
import PackDraftReviewPage from '@/pages/PackDraftReviewPage'
import PersonasPage from '@/pages/PersonasPage'
import PersonaUpsertPage from '@/pages/PersonaUpsertPage'
import PlaybooksPage from '@/pages/PlaybooksPage'
import PlaybookUpsertPage from '@/pages/PlaybookUpsertPage'
import PlaybookBundlesPage from '@/pages/PlaybookBundlesPage'
import PlaybookBundleDetailPage from '@/pages/PlaybookBundleDetailPage'
import DomainPacksPage from '@/pages/DomainPacksPage'
import RunWizardPage from '@/pages/RunWizardPage'
import SchedulesPage from '@/pages/SchedulesPage'
import SelfReflectionPage from '@/pages/SelfReflectionPage'
import EmpiricalCheckPage from '@/pages/EmpiricalCheckPage'
import NotificationChannelsPage from '@/pages/NotificationChannelsPage'
import PoliciesPage from '@/pages/PoliciesPage'
import BudgetsPage from '@/pages/BudgetsPage'
import LlmProvidersPage from '@/pages/LlmProvidersPage'
import OfficePage from '@/pages/OfficePage'
import OperationsPage from '@/pages/OperationsPage'
import SocialAccountsPage from '@/pages/SocialAccountsPage'

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
          <Route path="office" element={<OfficePage />} />
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
          <Route path="jobs/:jobId/report" element={<JobReportPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agents/new" element={<AgentUpsertPage mode="new" />} />
          <Route path="agents/:agentId/edit" element={<AgentUpsertPage mode="edit" />} />
          <Route path="tools" element={<ToolsPage />} />
          <Route path="stock" element={<StockPage />} />
          <Route path="tedarik-raporu" element={<TedarikReportPage />} />
          <Route path="cost-ledger" element={<CostLedgerPage />} />
          <Route path="approval-queue" element={<ApprovalQueuePage />} />
          <Route path="audit-log" element={<AuditLogPage />} />
          <Route path="sector-builder" element={<SectorBuilderPage />} />
          <Route path="pack-drafts" element={<PackDraftReviewPage />} />
          <Route path="personas" element={<PersonasPage />} />
          <Route path="personas/new" element={<PersonaUpsertPage mode="new" />} />
          <Route path="personas/:personaId/edit" element={<PersonaUpsertPage mode="edit" />} />
          <Route path="playbooks" element={<PlaybooksPage />} />
          <Route path="playbooks/new" element={<PlaybookUpsertPage mode="new" />} />
          <Route path="playbooks/:playbookId/edit" element={<PlaybookUpsertPage mode="edit" />} />
          <Route path="playbook-bundles" element={<PlaybookBundlesPage />} />
          <Route path="playbook-bundles/:bundleId" element={<PlaybookBundleDetailPage />} />
          <Route path="domain-packs" element={<DomainPacksPage />} />
          <Route path="run" element={<RunWizardPage />} />
          <Route path="schedules" element={<SchedulesPage />} />
          <Route path="self-reflection" element={<SelfReflectionPage />} />
          <Route path="empirical-check" element={<EmpiricalCheckPage />} />
          <Route path="notification-channels" element={<NotificationChannelsPage />} />
          <Route path="policies" element={<PoliciesPage />} />
          <Route path="budgets" element={<BudgetsPage />} />
          <Route path="llm-providers" element={<LlmProvidersPage />} />
          <Route path="social-accounts" element={<SocialAccountsPage />} />
          <Route path="operations" element={<OperationsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </Router>
  )
}
