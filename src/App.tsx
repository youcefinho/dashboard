// ── App — Routing TanStack Router ───────────────────────────

import { createRouter, createRoute, createRootRoute, RouterProvider, Navigate } from '@tanstack/react-router';
import { AuthProvider, useAuth } from '@/lib/auth';
import { LoginPage } from '@/pages/Login';
import { DashboardPage } from '@/pages/Dashboard';
import { ClientsPage } from '@/pages/Clients';
import { ClientLeadsPage } from '@/pages/ClientLeads';
import { LeadsPage } from '@/pages/Leads';
import { LeadDetailPage } from '@/pages/LeadDetail';
import { PipelinePage } from '@/pages/Pipeline';
import { SettingsPage } from '@/pages/Settings';
import { InboxPage } from '@/pages/Inbox';
import { TemplatesPage } from '@/pages/Templates';
import { WorkflowsPage } from '@/pages/Workflows';
import { WorkflowDetailPage } from '@/pages/WorkflowDetail';
import { WorkflowBuilderPage } from '@/pages/WorkflowBuilder';
import { CalendarPage } from '@/pages/Calendar';
import { IntegrationsPage } from '@/pages/Integrations';
import { ReportsPage } from '@/pages/Reports';
import { TasksPage } from '@/pages/Tasks';
import { ChangePasswordPage } from '@/pages/ChangePassword';
import type { ReactNode } from 'react';

// ── Auth Guard ──────────────────────────────────────────────

function AuthGuard({ children }: { children: ReactNode }) {
  const { isLoggedIn } = useAuth();
  if (!isLoggedIn) {
    return <Navigate to="/login" />;
  }
  return <>{children}</>;
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
  component: () => (
    <AuthGuard><ClientsPage /></AuthGuard>
  ),
});

const clientLeadsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clients/$clientId',
  component: () => (
    <AuthGuard><ClientLeadsPage /></AuthGuard>
  ),
});

const leadsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/leads',
  component: () => (
    <AuthGuard><LeadsPage /></AuthGuard>
  ),
});

const leadDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/leads/$leadId',
  component: () => (
    <AuthGuard><LeadDetailPage /></AuthGuard>
  ),
});

const pipelineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pipeline',
  component: () => (
    <AuthGuard><PipelinePage /></AuthGuard>
  ),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: () => (
    <AuthGuard><SettingsPage /></AuthGuard>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <Navigate to="/dashboard" />,
});

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/conversations',
  component: () => (
    <AuthGuard><InboxPage /></AuthGuard>
  ),
});

const templatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/templates',
  component: () => (
    <AuthGuard><TemplatesPage /></AuthGuard>
  ),
});

const workflowsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workflows',
  component: () => (
    <AuthGuard><WorkflowsPage /></AuthGuard>
  ),
});

const workflowDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workflows/$workflowId',
  component: () => (
    <AuthGuard><WorkflowDetailPage /></AuthGuard>
  ),
});

const workflowNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workflows/new',
  component: () => (
    <AuthGuard><WorkflowBuilderPage /></AuthGuard>
  ),
});

const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/calendar',
  component: () => (
    <AuthGuard><CalendarPage /></AuthGuard>
  ),
});

const integrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/integrations',
  component: () => (
    <AuthGuard><IntegrationsPage /></AuthGuard>
  ),
});

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  component: () => (
    <AuthGuard><ReportsPage /></AuthGuard>
  ),
});

const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tasks',
  component: () => (
    <AuthGuard><TasksPage /></AuthGuard>
  ),
});

const changePasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/change-password',
  component: () => (
    <AuthGuard><ChangePasswordPage /></AuthGuard>
  ),
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
