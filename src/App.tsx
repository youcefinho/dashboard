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
const DocumentsPage = lazy(() => import('@/pages/Documents').then(m => ({ default: m.DocumentsPage })));
const DocumentTemplatesPage = lazy(() => import('@/pages/DocumentTemplates').then(m => ({ default: m.DocumentTemplatesPage })));
const SignDocumentPage = lazy(() => import('@/pages/SignDocument').then(m => ({ default: m.SignDocumentPage })));
const ReviewsPage = lazy(() => import('@/pages/Reviews').then(m => ({ default: m.ReviewsPage })));
const InvoicesPage = lazy(() => import('@/pages/Invoices').then(m => ({ default: m.InvoicesPage })));
const AgenciesPage = lazy(() => import('@/pages/Agencies').then(m => ({ default: m.AgenciesPage })));
const TrashPage = lazy(() => import('@/pages/Trash').then(m => ({ default: m.TrashPage })));
const VisitModePage = lazy(() => import('@/pages/VisitMode').then(m => ({ default: m.VisitModePage })));
const EmailBuilderPage = lazy(() => import('@/pages/EmailBuilder').then(m => ({ default: m.EmailBuilderPage })));
const FormBuilderPage = lazy(() => import('@/pages/FormBuilder').then(m => ({ default: m.FormBuilderPage })));
const TriggerLinksPage = lazy(() => import('@/pages/TriggerLinks').then(m => ({ default: m.TriggerLinksPage })));
const PublicFormPage = lazy(() => import('@/pages/PublicForm').then(m => ({ default: m.PublicFormPage })));
const PropertiesPage = lazy(() => import('@/pages/Properties').then(m => ({ default: m.PropertiesPage })));

// ── Pages Publiques ─────────────────────────────────────────
const HomePage = lazy(() => import('@/pages/landing/Home').then(m => ({ default: m.HomePage })));
const PricingPage = lazy(() => import('@/pages/landing/Pricing').then(m => ({ default: m.PricingPage })));
const DemoPage = lazy(() => import('@/pages/landing/Demo').then(m => ({ default: m.DemoPage })));
const AboutPage = lazy(() => import('@/pages/landing/About').then(m => ({ default: m.AboutPage })));
const LegalPage = lazy(() => import('@/pages/landing/Legal').then(m => ({ default: m.LegalPage })));
const HelpCenterPage = lazy(() => import('@/pages/help/HelpCenter').then(m => ({ default: m.HelpCenterPage })));
const ChangelogPage = lazy(() => import('@/pages/landing/Changelog').then(m => ({ default: m.ChangelogPage })));

// ── Spinner de chargement ──────────────────────────────────

function PageLoader() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--bg-canvas, #f8f9fa)' }}>
      <div style={{ width: 36, height: 36, border: '3px solid rgba(0,157,219,0.2)', borderTopColor: 'var(--brand-primary, #009DDB)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
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
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <HomePage />
    </Suspense>
  ),
});

const pricingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pricing',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <PricingPage />
    </Suspense>
  ),
});

const demoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/demo',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <DemoPage />
    </Suspense>
  ),
});

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/about',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <AboutPage />
    </Suspense>
  ),
});

const helpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/help',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <HelpCenterPage />
    </Suspense>
  ),
});

const changelogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/changelog',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <ChangelogPage />
    </Suspense>
  ),
});

const legalPrivacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/legal/privacy',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <LegalPage type="privacy" />
    </Suspense>
  ),
});

const legalTermsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/legal/terms',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <LegalPage type="terms" />
    </Suspense>
  ),
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

const publicFormRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/f/$slug',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <PublicFormPage />
    </Suspense>
  ),
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

const documentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documents',
  component: () => (<LazyGuard><DocumentsPage /></LazyGuard>),
});

const documentTemplatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documents/templates',
  component: () => (<LazyGuard><DocumentTemplatesPage /></LazyGuard>),
});

const signDocumentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign/$token',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <SignDocumentPage />
    </Suspense>
  ),
});

const reviewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reviews',
  component: () => (<LazyGuard><ReviewsPage /></LazyGuard>),
});

const invoicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invoices',
  component: () => (<LazyGuard><InvoicesPage /></LazyGuard>),
});

const agenciesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agencies',
  component: () => (<LazyGuard><AgenciesPage /></LazyGuard>),
});

const trashRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trash',
  component: () => (<LazyGuard><TrashPage /></LazyGuard>),
});

const visitModeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/visit/$leadId',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <VisitModePage />
    </Suspense>
  ),
});

const emailBuilderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/templates/builder/$templateId',
  component: () => (<LazyGuard><EmailBuilderPage /></LazyGuard>),
});

const formBuilderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forms/builder/$formId',
  component: () => (<LazyGuard><FormBuilderPage /></LazyGuard>),
});

const triggerLinksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trigger-links',
  component: () => (<LazyGuard><TriggerLinksPage /></LazyGuard>),
});

// ── Router ──────────────────────────────────────────────────

const propertiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/properties',
  component: () => (<LazyGuard><PropertiesPage /></LazyGuard>),
});

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
  documentsRoute,
  documentTemplatesRoute,
  signDocumentRoute,
  reviewsRoute,
  invoicesRoute,
  agenciesRoute,
  trashRoute,
  visitModeRoute,
  emailBuilderRoute,
  formBuilderRoute,
  triggerLinksRoute,
  publicFormRoute,
  propertiesRoute,
  pricingRoute,
  demoRoute,
  aboutRoute,
  helpRoute,
  changelogRoute,
  legalPrivacyRoute,
  legalTermsRoute,
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
