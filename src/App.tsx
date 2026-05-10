// ── App — Routing TanStack Router ───────────────────────────

import { createRouter, createRoute, createRootRoute, RouterProvider, Navigate } from '@tanstack/react-router';
import { AuthProvider, useAuth } from '@/lib/auth';
import { LoginPage } from '@/pages/Login';
import { DashboardPage } from '@/pages/Dashboard';
import { Suspense, lazy, type ReactNode } from 'react';

// ── Code splitting : chargement différé des pages secondaires ──
const ClientsPage = lazy(() => import('@/pages/Clients').then(m => ({ default: m.ClientsPage })));
const ClientLeadsPage = lazy(() => import('@/pages/ClientLeads').then(m => ({ default: m.ClientLeadsPage })));
const LeadsPage = lazy(() => import('@/pages/Leads').then(m => ({ default: m.LeadsPage })));
const LeadDetailPage = lazy(() => import('@/pages/LeadDetail').then(m => ({ default: m.LeadDetailPage })));
const PipelinePage = lazy(() => import('@/pages/Pipeline').then(m => ({ default: m.PipelinePage })));
const SettingsPage = lazy(() => import('@/pages/Settings').then(m => ({ default: m.SettingsPage })));
const InboxPage = lazy(() => import('@/pages/Inbox').then(m => ({ default: m.InboxPage })));
const TemplatesPage = lazy(() => import('@/pages/Templates').then(m => ({ default: m.TemplatesPage })));
const WorkflowsPage = lazy(() => import('@/pages/Workflows').then(m => ({ default: m.WorkflowsPage })));
const WorkflowDetailPage = lazy(() => import('@/pages/WorkflowDetail').then(m => ({ default: m.WorkflowDetailPage })));
const WorkflowBuilderPage = lazy(() => import('@/pages/WorkflowBuilder').then(m => ({ default: m.WorkflowBuilderPage })));
const CalendarPage = lazy(() => import('@/pages/Calendar').then(m => ({ default: m.CalendarPage })));
const IntegrationsPage = lazy(() => import('@/pages/Integrations').then(m => ({ default: m.IntegrationsPage })));
const ReportsPage = lazy(() => import('@/pages/Reports').then(m => ({ default: m.ReportsPage })));
const TasksPage = lazy(() => import('@/pages/Tasks').then(m => ({ default: m.TasksPage })));
const ChangePasswordPage = lazy(() => import('@/pages/ChangePassword').then(m => ({ default: m.ChangePasswordPage })));

// ── Spinner de chargement ──────────────────────────────────

function PageLoader() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--bg-primary, #0a0a14)' }}>
      <div style={{ width: 36, height: 36, border: '3px solid rgba(99,102,241,0.2)', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    </div>
  );
}

// ── Auth Guard ──────────────────────────────────────────────

function AuthGuard({ children }: { children: ReactNode }) {
  const { isLoggedIn } = useAuth();
  if (!isLoggedIn) {
    return <Navigate to="/login" />;
  }
  return <>{children}</>;
}

function LazyGuard({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <Suspense fallback={<PageLoader />}>
        {children}
      </Suspense>
    </AuthGuard>
  );
}

// ── Routes ──────────────────────────────────────────────────

const rootRoute = createRootRoute();

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  component: () => (
    <AuthGuard><DashboardPage /></AuthGuard>
  ),
});

const clientsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clients',
  component: () => (<LazyGuard><ClientsPage /></LazyGuard>),
});

const clientLeadsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clients/$clientId',
  component: () => (<LazyGuard><ClientLeadsPage /></LazyGuard>),
});

const leadsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/leads',
  component: () => (<LazyGuard><LeadsPage /></LazyGuard>),
});

const leadDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/leads/$leadId',
  component: () => (<LazyGuard><LeadDetailPage /></LazyGuard>),
});

const pipelineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pipeline',
  component: () => (<LazyGuard><PipelinePage /></LazyGuard>),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: () => (<LazyGuard><SettingsPage /></LazyGuard>),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <Navigate to="/dashboard" />,
});

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/conversations',
  component: () => (<LazyGuard><InboxPage /></LazyGuard>),
});

const templatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/templates',
  component: () => (<LazyGuard><TemplatesPage /></LazyGuard>),
});

const workflowsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workflows',
  component: () => (<LazyGuard><WorkflowsPage /></LazyGuard>),
});

const workflowDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workflows/$workflowId',
  component: () => (<LazyGuard><WorkflowDetailPage /></LazyGuard>),
});

const workflowNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workflows/new',
  component: () => (<LazyGuard><WorkflowBuilderPage /></LazyGuard>),
});

const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/calendar',
  component: () => (<LazyGuard><CalendarPage /></LazyGuard>),
});

const integrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/integrations',
  component: () => (<LazyGuard><IntegrationsPage /></LazyGuard>),
});

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  component: () => (<LazyGuard><ReportsPage /></LazyGuard>),
});

const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tasks',
  component: () => (<LazyGuard><TasksPage /></LazyGuard>),
});

const changePasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/change-password',
  component: () => (<LazyGuard><ChangePasswordPage /></LazyGuard>),
});

// ── Router ──────────────────────────────────────────────────

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  dashboardRoute,
  leadsRoute,
  leadDetailRoute,
  clientsRoute,
  clientLeadsRoute,
  pipelineRoute,
  inboxRoute,
  templatesRoute,
  workflowNewRoute,
  workflowDetailRoute,
  workflowsRoute,
  calendarRoute,
  integrationsRoute,
  reportsRoute,
  tasksRoute,
  changePasswordRoute,
  settingsRoute,
]);

const router = createRouter({ routeTree });

// ── App Root ────────────────────────────────────────────────

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
