// ── App — Routing TanStack Router ───────────────────────────

import { createRouter, createRoute, createRootRoute, RouterProvider, Navigate, Outlet } from '@tanstack/react-router';
import { AuthProvider, useAuth } from '@/lib/auth';
import { LoginPage } from '@/pages/Login';
import { DashboardPage } from '@/pages/Dashboard';
import { Suspense, lazy, type ReactNode } from 'react';
import { PanelStackProvider, ViewTransition } from '@/components/ui';
import { LeadPanel } from '@/components/panels/LeadPanel';
import { TaskPanel } from '@/components/panels/TaskPanel';
import { ErrorBoundary } from '@/pages/ErrorBoundary';
import { NotFound } from '@/pages/NotFound';

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
// Sprint 46 M1.3 — Dashboards partagés (public read, pas d'auth)
const SharedDashboardPage = lazy(() => import('@/pages/SharedDashboard').then(m => ({ default: m.SharedDashboardPage })));
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
// ── Sprint E1 M3.3 — Module Boutique (e-commerce B2), gated <ModuleGuard> ──
const BoutiqueDashboardPage = lazy(() => import('@/pages/boutique/BoutiqueDashboard').then(m => ({ default: m.BoutiqueDashboardPage })));
const BoutiqueProduitsPage = lazy(() => import('@/pages/boutique/Produits').then(m => ({ default: m.ProduitsPage })));
const BoutiqueCommandesPage = lazy(() => import('@/pages/boutique/Commandes').then(m => ({ default: m.CommandesPage })));
const BoutiqueClientsPage = lazy(() => import('@/pages/boutique/Clients').then(m => ({ default: m.BoutiqueClientsPage })));
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPassword').then(m => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPassword').then(m => ({ default: m.ResetPasswordPage })));
// ── Sprint 46 M2 — Admin analytics (org-wide dashboard) ─────
const AdminOverviewPage = lazy(() => import('@/pages/admin/AdminOverview').then(m => ({ default: m.AdminOverviewPage })));
import { AdminGuard } from '@/components/admin/AdminGuard';
// Sprint E1 M3.3 — gate des pages Boutique (module e-commerce B2)
import { ModuleGuard } from '@/components/ecommerce/ModuleGuard';

// ── Pages Publiques ─────────────────────────────────────────
// Sprint 47 M1 — Landing Stripe-clean remplace HomePage sur `/`
// HomePage (Sprint 23 dramatic) gardée en backup mais non routée.
const LandingPage = lazy(() => import('@/pages/marketing/Landing').then(m => ({ default: m.LandingPage })));
const PricingPage = lazy(() => import('@/pages/landing/Pricing').then(m => ({ default: m.PricingPage })));
const DemoPage = lazy(() => import('@/pages/landing/Demo').then(m => ({ default: m.DemoPage })));
const AboutPage = lazy(() => import('@/pages/landing/About').then(m => ({ default: m.AboutPage })));
const LegalPage = lazy(() => import('@/pages/landing/Legal').then(m => ({ default: m.LegalPage })));
const HelpCenterPage = lazy(() => import('@/pages/help/HelpCenter').then(m => ({ default: m.HelpCenterPage })));
const ChangelogPage = lazy(() => import('@/pages/landing/Changelog').then(m => ({ default: m.ChangelogPage })));
// ── Sprint 47 M3 — Blog + Docs marketing ─────────────────────
const BlogPage = lazy(() => import('@/pages/marketing/Blog').then(m => ({ default: m.BlogPage })));
const BlogArticlePage = lazy(() => import('@/pages/marketing/BlogArticle').then(m => ({ default: m.BlogArticlePage })));
const MarketingHelpPage = lazy(() => import('@/pages/marketing/Help').then(m => ({ default: m.HelpPage })));
const MarketingHelpArticlePage = lazy(() => import('@/pages/marketing/help/HelpArticle').then(m => ({ default: m.HelpArticlePage })));

// ── Sprint 47 M2 — Marketing pages Stripe SUBTLE (Pricing v2 + Legal + Contact + About) ──
const MarketingPricingV2Page = lazy(() => import('@/pages/marketing/Pricing').then(m => ({ default: m.MarketingPricingPage })));
const MarketingAboutV2Page = lazy(() => import('@/pages/marketing/About').then(m => ({ default: m.AboutMarketingPage })));
const MarketingContactPage = lazy(() => import('@/pages/marketing/Contact').then(m => ({ default: m.ContactPage })));
const MarketingTosPage = lazy(() => import('@/pages/marketing/legal/TermsOfService').then(m => ({ default: m.TermsOfServicePage })));
const MarketingPrivacyPage = lazy(() => import('@/pages/marketing/legal/PrivacyPolicy').then(m => ({ default: m.PrivacyPolicyPage })));
const MarketingCookiesPage = lazy(() => import('@/pages/marketing/legal/CookiePolicy').then(m => ({ default: m.CookiePolicyPage })));
const MarketingLoi25Page = lazy(() => import('@/pages/marketing/legal/Loi25Compliance').then(m => ({ default: m.Loi25CompliancePage })));
const MarketingCaslPage = lazy(() => import('@/pages/marketing/legal/CaslCompliance').then(m => ({ default: m.CaslCompliancePage })));

// ── Sprint 50 M3 — Beta invite flow (signup + magic link + roadmap) ──────────
const BetaSignupPage = lazy(() => import('@/pages/marketing/BetaSignup').then(m => ({ default: m.BetaSignupPage })));
const RoadmapPage = lazy(() => import('@/pages/marketing/Roadmap').then(m => ({ default: m.RoadmapPage })));
const MagicLinkRequestPage = lazy(() => import('@/pages/MagicLinkRequest').then(m => ({ default: m.MagicLinkRequestPage })));
const MagicLinkVerifyPage = lazy(() => import('@/pages/MagicLinkVerify').then(m => ({ default: m.MagicLinkVerifyPage })));

// ── Spinner de chargement ──────────────────────────────────

function PageLoader() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--bg-canvas, #f8f9fa)' }}>
      <div style={{ width: 36, height: 36, border: '3px solid rgba(0,157,219,0.2)', borderTopColor: 'var(--primary, #009DDB)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
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

// Root route avec PanelStackProvider — permet d'ouvrir des slide-over panels
// depuis n'importe quelle page sans full-page nav (différenciateur UX vs GHL).
const PANEL_RENDERERS = {
  lead: LeadPanel,
  task: TaskPanel,
} as const;

const rootRoute = createRootRoute({
  component: () => (
    <PanelStackProvider renderers={PANEL_RENDERERS}>
      <ViewTransition>
        <Outlet />
      </ViewTransition>
    </PanelStackProvider>
  ),
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <ForgotPasswordPage />
    </Suspense>
  ),
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password/$token',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <ResetPasswordPage />
    </Suspense>
  ),
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
      <LandingPage />
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

// Sprint 47 M3.3 — Le Help center marketing remplace le HelpCenter legacy
// sur /help (mêmes URLs, layout Stripe-clean SUBTLE, MDX dynamique).
const helpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/help',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <MarketingHelpPage />
    </Suspense>
  ),
});

const helpArticleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/help/$slug',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <MarketingHelpArticlePage />
    </Suspense>
  ),
});

// Sprint 47 M3.3 — Help center legacy conservé en /help-legacy
// pour usage interne/tests, non linké.
const helpLegacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/help-legacy',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <HelpCenterPage />
    </Suspense>
  ),
});

// Sprint 47 M3.1 — Blog list + article
const blogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/blog',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <BlogPage />
    </Suspense>
  ),
});

const blogArticleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/blog/$slug',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <BlogArticlePage />
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

// ── Sprint 47 M2 — Marketing routes Stripe SUBTLE ────────────
// Routes `/marketing/*` séparées des `/pricing`, `/about`, `/legal/*` legacy.
// Liées depuis le footer et SEO sitemap. Coexistent avec landing/* historique.

const marketingPricingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/marketing/pricing',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <MarketingPricingV2Page />
    </Suspense>
  ),
});

const marketingAboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/marketing/about',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <MarketingAboutV2Page />
    </Suspense>
  ),
});

const marketingContactRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/marketing/contact',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <MarketingContactPage />
    </Suspense>
  ),
});

// Alias court /contact pour confort UX
const contactRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/contact',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <MarketingContactPage />
    </Suspense>
  ),
});

const marketingLegalTermsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/marketing/legal/terms',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <MarketingTosPage />
    </Suspense>
  ),
});

const marketingLegalPrivacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/marketing/legal/privacy',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <MarketingPrivacyPage />
    </Suspense>
  ),
});

const marketingLegalCookiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/marketing/legal/cookies',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <MarketingCookiesPage />
    </Suspense>
  ),
});

// Aliases courts /legal/cookies (cohérent avec /legal/privacy + /legal/terms)
const legalCookiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/legal/cookies',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <MarketingCookiesPage />
    </Suspense>
  ),
});

const marketingLegalLoi25Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/marketing/legal/loi-25',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <MarketingLoi25Page />
    </Suspense>
  ),
});

const legalLoi25Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/legal/loi-25',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <MarketingLoi25Page />
    </Suspense>
  ),
});

const marketingLegalCaslRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/marketing/legal/casl',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <MarketingCaslPage />
    </Suspense>
  ),
});

const legalCaslRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/legal/casl',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <MarketingCaslPage />
    </Suspense>
  ),
});

// ── Sprint 50 M3 — Beta invite flow routes (publiques) ───────
const betaSignupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/beta',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <BetaSignupPage />
    </Suspense>
  ),
});

const roadmapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/roadmap',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <RoadmapPage />
    </Suspense>
  ),
});

const magicLinkRequestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login/magic',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <MagicLinkRequestPage />
    </Suspense>
  ),
});

const magicLinkVerifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/verify',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <MagicLinkVerifyPage />
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

// Sprint 46 M1.3 — Dashboards partagés (public, lecture seule)
const sharedDashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboards/shared/$token',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <SharedDashboardPage />
    </Suspense>
  ),
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

// ── Sprint E1 M3.3 — Module Boutique (e-commerce B2) ────────
// Chaque page wrappée <ModuleGuard module="ecommerce"> : si le module est
// désactivé pour le tenant → redirect propre /dashboard + Toast (M2).
const boutiqueDashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/boutique',
  component: () => (<LazyGuard><ModuleGuard module="ecommerce"><BoutiqueDashboardPage /></ModuleGuard></LazyGuard>),
});
const boutiqueProduitsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/boutique/produits',
  component: () => (<LazyGuard><ModuleGuard module="ecommerce"><BoutiqueProduitsPage /></ModuleGuard></LazyGuard>),
});
const boutiqueCommandesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/boutique/commandes',
  component: () => (<LazyGuard><ModuleGuard module="ecommerce"><BoutiqueCommandesPage /></ModuleGuard></LazyGuard>),
});
const boutiqueClientsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/boutique/clients',
  component: () => (<LazyGuard><ModuleGuard module="ecommerce"><BoutiqueClientsPage /></ModuleGuard></LazyGuard>),
});

// ── Sprint 46 M2.1 — Admin routes (wrapped by AdminGuard) ───
const adminOverviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/overview',
  component: () => (<LazyGuard><AdminGuard><AdminOverviewPage /></AdminGuard></LazyGuard>),
});

// Alias /admin → /admin/overview pour confort UX (redirige via Navigate inline)
const adminIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: () => (<LazyGuard><AdminGuard><Navigate to="/admin/overview" /></AdminGuard></LazyGuard>),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
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
  sharedDashboardRoute,
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
  // ── Sprint E1 M3.3 — Module Boutique (e-commerce B2) ──
  boutiqueDashboardRoute,
  boutiqueProduitsRoute,
  boutiqueCommandesRoute,
  boutiqueClientsRoute,
  adminIndexRoute,
  adminOverviewRoute,
  pricingRoute,
  demoRoute,
  aboutRoute,
  helpRoute,
  helpArticleRoute,
  helpLegacyRoute,
  blogRoute,
  blogArticleRoute,
  changelogRoute,
  legalPrivacyRoute,
  legalTermsRoute,
  // ── Sprint 47 M2 — Marketing routes ──
  marketingPricingRoute,
  marketingAboutRoute,
  marketingContactRoute,
  contactRoute,
  marketingLegalTermsRoute,
  marketingLegalPrivacyRoute,
  marketingLegalCookiesRoute,
  legalCookiesRoute,
  marketingLegalLoi25Route,
  legalLoi25Route,
  marketingLegalCaslRoute,
  legalCaslRoute,
  // ── Sprint 50 M3 — Beta invite flow ──
  betaSignupRoute,
  roadmapRoute,
  magicLinkRequestRoute,
  magicLinkVerifyRoute,
]);

const router = createRouter({
  routeTree,
  // Sprint 24 vague 5A — page 404 premium custom (cohérence design system).
  defaultNotFoundComponent: NotFound,
  // Sprint 35 vague 35-1B — prefetch sur intent (hover/touchstart) avec
  // staleTime 30s. Effet : quand l'user hover un <Link>, TanStack lance
  // le chargement du chunk lazy AVANT le click → la nav est instantanée
  // (sub-100ms perçu vs 200-400ms cold). LazyGuard tient car le Suspense
  // fallback (PageLoader) reste actif si le chunk n'est pas encore prêt
  // quand le click arrive — pas de race condition.
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 30_000,
});

// ── App Root ────────────────────────────────────────────────

import { ToastProvider, ConfirmProvider, AppBootScreen } from '@/components/ui';

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            {/* Sprint 34 vague 34-3A — Suspense fallback premium pendant
                l'initial mount (chunks lazy non encore résolus au boot) */}
            <Suspense fallback={<AppBootScreen />}>
              <RouterProvider router={router} />
            </Suspense>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
