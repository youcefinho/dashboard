// ── App — Routing TanStack Router ───────────────────────────

import { createRouter, createRoute, createRootRoute, RouterProvider, Navigate, Outlet } from '@tanstack/react-router';
import { AuthProvider, useAuth } from '@/lib/auth';
import { LoginPage } from '@/pages/Login';
import { SignupPage } from '@/pages/Signup';
import { AcceptInvitationPage } from '@/pages/AcceptInvitation';
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
// Sprint 21 — Onboarding durci : page dédiée /getting-started (checklist enrichie)
const GettingStartedPage = lazy(() => import('@/pages/GettingStarted').then(m => ({ default: m.GettingStartedPage })));
const InboxPage = lazy(() => import('@/pages/Inbox').then(m => ({ default: m.InboxPage })));
const TemplatesPage = lazy(() => import('@/pages/Templates').then(m => ({ default: m.TemplatesPage })));
const WorkflowsPage = lazy(() => import('@/pages/Workflows').then(m => ({ default: m.WorkflowsPage })));
// Sprint 5 — Email marketing & séquences (stubs Phase A → corps Phase C)
const SequencesPage = lazy(() => import('@/pages/Sequences').then(m => ({ default: m.SequencesPage })));
const CampaignsPage = lazy(() => import('@/pages/Campaigns').then(m => ({ default: m.CampaignsPage })));
// LOT G6 — Segments de leads dynamiques (stub Phase A → corps Phase C)
const SegmentsPage = lazy(() => import('@/pages/Segments').then(m => ({ default: m.SegmentsPage })));
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
// ── LOT TELEPHONY-DISPOSITION (Sprint 16) — journal d'appels global ──
const TelephoniePage = lazy(() => import('@/pages/Telephonie').then(m => ({ default: m.TelephoniePage })));
// ── LOT SOCIAL PLANNER (Sprint 9) — composer + calendrier de planification ──
const SocialPage = lazy(() => import('@/pages/Social').then(m => ({ default: m.SocialPage })));
const SocialCalendarPage = lazy(() => import('@/pages/SocialCalendar').then(m => ({ default: m.SocialCalendarPage })));
const InvoicesPage = lazy(() => import('@/pages/Invoices').then(m => ({ default: m.InvoicesPage })));
const QuotesPage = lazy(() => import('@/pages/Quotes').then(m => ({ default: m.QuotesPage })));
// ── Sprint 18 CATALOGUE DE SERVICES — page de gestion du catalogue (Manager-C) ──
const CatalogPage = lazy(() => import('@/pages/Catalog').then(m => ({ default: m.CatalogPage })));
const AgenciesPage = lazy(() => import('@/pages/Agencies').then(m => ({ default: m.AgenciesPage })));
const TrashPage = lazy(() => import('@/pages/Trash').then(m => ({ default: m.TrashPage })));
// Sprint 35 (Agent B4) — Snapshots GHL-style (page standalone /snapshots)
const SnapshotsPage = lazy(() => import('@/pages/SnapshotsPage').then(m => ({ default: m.SnapshotsPage })));
// Sprint 39 (Agent B4) — Multi-currency + tax regions (page standalone /settings/currency-multi)
const CurrencyMultiSettingsPage = lazy(() => import('@/pages/settings/CurrencyMultiSettingsPage').then(m => ({ default: m.CurrencyMultiSettingsPage })));
// Sprint 41 (Agent B1) — AI Voice Agent (page standalone /settings/voice-agent)
const VoiceAgentPage = lazy(() => import('@/pages/settings/VoiceAgentPage').then(m => ({ default: m.VoiceAgentPage })));
// Sprint 43 (Agent B2) — Courses LMS member-facing UI (page standalone /lms)
const CoursesLMSPage = lazy(() => import('@/pages/lms/CoursesLMSPage').then(m => ({ default: m.CoursesLMSPage })));
// Sprint 45 (Agent B2) — Community forum (LOT COMMUNITY S45, /community)
const CommunityPage = lazy(() => import('@/pages/community/CommunityPage').then(m => ({ default: m.CommunityPage })));
// Sprint 47 (Agent B2) — Multi-warehouse + Dropshipping (page standalone /warehouse)
const WarehousePage = lazy(() => import('@/pages/warehouse/WarehousePage').then(m => ({ default: m.WarehousePage })));
// Sprint 48 (Agent B2) — B2B wholesale + Bundles + Pre-orders (page standalone /b2b)
const B2BPage = lazy(() => import('@/pages/b2b/B2BPage').then(m => ({ default: m.B2BPage })));
// Sprint 42 (Agent B1) — AI Chat Agent (page standalone /settings/chat-bot)
const ChatBotPage = lazy(() => import('@/pages/settings/ChatBotPage').then(m => ({ default: m.ChatBotPage })));
// Sprint 36 (Agent B2) — Live chat inbox (page standalone /chat-inbox)
const ChatInbox = lazy(() => import('@/pages/ChatInbox').then(m => ({ default: m.ChatInbox })));
// Sprint 36 (Agent B4) — Live chat widgets manager (page standalone /chat-widgets)
const ChatWidgetsPage = lazy(() => import('@/pages/ChatWidgetsPage').then(m => ({ default: m.ChatWidgetsPage })));
const VisitModePage = lazy(() => import('@/pages/VisitMode').then(m => ({ default: m.VisitModePage })));
const EmailBuilderPage = lazy(() => import('@/pages/EmailBuilder').then(m => ({ default: m.EmailBuilderPage })));
const FormBuilderPage = lazy(() => import('@/pages/FormBuilder').then(m => ({ default: m.FormBuilderPage })));
const FormsPage = lazy(() => import('@/pages/Forms').then(m => ({ default: m.FormsPage })));
const TriggerLinksPage = lazy(() => import('@/pages/TriggerLinks').then(m => ({ default: m.TriggerLinksPage })));
const PublicFormPage = lazy(() => import('@/pages/PublicForm').then(m => ({ default: m.PublicFormPage })));
// ── LOT FUNNEL — builder landing pages / funnels. Pages = stubs lazy Phase A,
//    corps réels Phase C Manager-C (FunnelsPage / FunnelBuilder / PublicFunnel).
// Sprint 44 (Agent B2) — route `/funnels` repointée vers la page Sprint 44
// (Tabs Entonnoirs + Analytique). L'ancienne page `@/pages/Funnels` (Sprint 1)
// reste sur disque mais n'est plus routée.
const FunnelsPage = lazy(() => import('@/pages/funnels/FunnelsPage').then(m => ({ default: m.FunnelsPage })));
const FunnelBuilderPage = lazy(() => import('@/pages/FunnelBuilder').then(m => ({ default: m.FunnelBuilderPage })));
const PublicFunnelPage = lazy(() => import('@/pages/PublicFunnel').then(m => ({ default: m.PublicFunnelPage })));
// ── LOT SITE BUILDER (Sprint 10) — site multi-pages réutilisant le moteur funnel.
//    Pages = stubs lazy Phase A, corps réels Phase C Manager-C (SitesPage /
//    SiteBuilderPage / PublicSitePage). Exports nommés FIGÉS (App.tsx GELÉ les
//    lazy-importe). PublicSitePage hors LazyGuard/auth (calque PublicFunnelPage).
const SitesPage = lazy(() => import('@/pages/Sites').then(m => ({ default: m.SitesPage })));
const SiteBuilderPage = lazy(() => import('@/pages/SiteBuilder').then(m => ({ default: m.SiteBuilderPage })));
const PublicSitePage = lazy(() => import('@/pages/PublicSite').then(m => ({ default: m.PublicSitePage })));
// ── LOT G7 MARKETPLACE — templates partageables cross-tenant. Page = stub lazy
//    Phase A, corps réel Phase C Manager-C (MarketplacePage). ──────────────────
const MarketplacePage = lazy(() => import('@/pages/Marketplace').then(m => ({ default: m.MarketplacePage })));
// ── SPRINT 12 — IA contenu : atelier centralisé. Page = stub lazy Phase A,
//    corps réel Phase C Manager-C (AiContentPage). Export nommé FIGÉ. ──────────
const AiContentPage = lazy(() => import('@/pages/AiContent').then(m => ({ default: m.AiContentPage })));
// ── LOT G1 HELPDESK — tickets de support & base de connaissances (Phase A
//    fige le dispatch ; corps réels Phase C Manager-C : Tickets / KBAdmin /
//    PublicTicketForm / KBPublic). ───────────────────────────────────────────
const TicketsPage = lazy(() => import('@/pages/Tickets').then(m => ({ default: m.TicketsPage })));
const KBAdminPage = lazy(() => import('@/pages/KBAdmin').then(m => ({ default: m.KBAdminPage })));
const PublicTicketFormPage = lazy(() => import('@/pages/PublicTicketForm').then(m => ({ default: m.PublicTicketFormPage })));
const KBPublicPage = lazy(() => import('@/pages/KBPublic').then(m => ({ default: m.KBPublicPage })));
// ── LOT G2 AFFILIATION — programme d'affiliation natif (Phase A fige le
//    dispatch ; corps réel Phase C Manager-C : AffiliatesPage 3 onglets). Le
//    redirect public /r/:code est 100% worker (302), AUCUNE page React. ────────
const AffiliatesPage = lazy(() => import('@/pages/affiliates/AffiliatesPage').then(m => ({ default: m.AffiliatesPage })));
// ── LOT BOOKING — moteur de réservation client pro. Pages = stubs lazy
//    Phase A, corps réels Phase C Manager-C (BookingSettings / PublicBooking).
const BookingSettingsPage = lazy(() => import('@/pages/BookingSettings').then(m => ({ default: m.BookingSettingsPage })));
const PublicBookingPage = lazy(() => import('@/pages/PublicBooking').then(m => ({ default: m.PublicBookingPage })));
// ── LOT STOREFRONT CHECKOUT (Sprint 7) — pages PUBLIQUES (NEUVES Phase C
//    Manager-C). Hors AuthGuard/ModuleGuard (calque PublicBookingPage /
//    PublicFunnelPage). Exports nommés FIGÉS (App.tsx GELÉ les lazy-importe). ──
const PublicStorePage = lazy(() => import('@/pages/PublicStore').then(m => ({ default: m.PublicStorePage })));
const PublicCheckoutPage = lazy(() => import('@/pages/PublicCheckout').then(m => ({ default: m.PublicCheckoutPage })));
// ── LOT REPUTATION (Sprint 8) — page PUBLIQUE de dépôt d'avis 1st-party (NEUVE
//    Phase C Manager-C). Hors AuthGuard/ModuleGuard (calque PublicBookingPage /
//    PublicFunnelPage). Export nommé FIGÉ (App.tsx GELÉ le lazy-importe). ───────
const PublicReviewPage = lazy(() => import('@/pages/PublicReview').then(m => ({ default: m.PublicReviewPage })));
// ── LOT MEMBERSHIPS — espace membre public + gestion PRO cours ──
const MemberSpacePage = lazy(() => import('@/pages/MemberSpace').then(m => ({ default: m.MemberSpacePage })));
const CoursesAdminPage = lazy(() => import('@/pages/CoursesAdmin').then(m => ({ default: m.CoursesAdminPage })));
// ── LOT PORTAL-E — portail client public (/portal/$slug, hors LazyGuard) +
//    config PRO (/portal-settings, sous LazyGuard). ──
const PortalSpacePage = lazy(() => import('@/pages/PortalSpace').then(m => ({ default: m.PortalSpacePage })));
const PortalSettingsPage = lazy(() => import('@/pages/PortalSettings').then(m => ({ default: m.PortalSettingsPage })));
const PropertiesPage = lazy(() => import('@/pages/Properties').then(m => ({ default: m.PropertiesPage })));
// ── Sprint E1 M3.3 — Module Boutique (e-commerce B2), gated <ModuleGuard> ──
const BoutiqueDashboardPage = lazy(() => import('@/pages/boutique/BoutiqueDashboard').then(m => ({ default: m.BoutiqueDashboardPage })));
const BoutiqueProduitsPage = lazy(() => import('@/pages/boutique/Produits').then(m => ({ default: m.ProduitsPage })));
const BoutiqueCommandesPage = lazy(() => import('@/pages/boutique/Commandes').then(m => ({ default: m.CommandesPage })));
const BoutiqueClientsPage = lazy(() => import('@/pages/boutique/Clients').then(m => ({ default: m.BoutiqueClientsPage })));
// Sprint 4 — Coupons/promos + Abonnements produit (stubs lazy Phase A,
// corps réel Phase B/C). Pattern identique aux pages boutique ci-dessus.
const BoutiqueCouponsPage = lazy(() => import('@/pages/boutique/Coupons').then(m => ({ default: m.CouponsPage })));
const BoutiqueAbonnementsPage = lazy(() => import('@/pages/boutique/Abonnements').then(m => ({ default: m.AbonnementsPage })));
// Sprint 37 (Agent B1) — POS retail (caisse) /boutique/pos
const BoutiquePOSPage = lazy(() => import('@/pages/boutique/POS').then(m => ({ default: m.POSPage })));
// Sprint 38 (Agent B4) — Gift cards + Loyalty /boutique/giftcards-loyalty
const BoutiqueGiftCardsLoyaltyPage = lazy(() => import('@/pages/boutique/GiftCardsLoyaltyPage').then(m => ({ default: m.GiftCardsLoyaltyPage })));
// Sprint 40 (Agent B4) — Recovery workflow editor (séquence multi-touch) /boutique/recovery-workflow
const BoutiqueRecoveryWorkflowPage = lazy(() => import('@/pages/boutique/RecoveryWorkflow').then(m => ({ default: m.RecoveryWorkflowPage })));
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPassword').then(m => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPassword').then(m => ({ default: m.ResetPasswordPage })));
// ── Sprint 46 M2 — Admin analytics (org-wide dashboard) ─────
const AdminOverviewPage = lazy(() => import('@/pages/admin/AdminOverview').then(m => ({ default: m.AdminOverviewPage })));
// ── Sprint 24 — Observabilité (admin/owner only, lazy + AdminGuard) ─────
const ObservabilityPanelPage = lazy(() => import('@/pages/admin/ObservabilityPanel').then(m => ({ default: m.ObservabilityPanel })));
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

// Sprint 50 (Agent B2) — Surveys & DNS page (tab Surveys + NPS Analytics + Domains)
const SurveysAndDnsPage = lazy(() => import('@/pages/surveys/SurveysAndDnsPage').then(m => ({ default: m.SurveysAndDnsPage })));

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

// SaaS Lot 4 §6.20 — route /signup PUBLIQUE (calque loginRoute, hors guard)
const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signup',
  component: SignupPage,
});

// LOT TEAM A (Phase B / M2) — route /invite/accept PUBLIQUE
// (calque signupRoute, hors AuthGuard). Token lu côté page via querystring.
const acceptInvitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/accept',
  component: AcceptInvitationPage,
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

// Sprint 21 — Onboarding durci : page dédiée /getting-started (sous LazyGuard,
// calque settingsRoute). Contenu = <OnboardingChecklistPanel variant="page">.
const gettingStartedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/getting-started',
  component: () => (<LazyGuard><GettingStartedPage /></LazyGuard>),
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

// Sprint 5 — Séquences drip + Campagnes courriel (stubs Phase A → Phase C)
const sequencesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sequences',
  component: () => (<LazyGuard><SequencesPage /></LazyGuard>),
});

const campaignsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/campaigns',
  component: () => (<LazyGuard><CampaignsPage /></LazyGuard>),
});

// LOT G6 — Segments de leads dynamiques (stub Phase A → corps Phase C)
const segmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/segments',
  component: () => (<LazyGuard><SegmentsPage /></LazyGuard>),
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

// LOT AUTOMATION BUILDER seq 105 (Sprint 4) — route ÉDITION figée Phase A.
// Calque workflowNewRoute / workflowDetailRoute. Manager-C rendra
// WorkflowBuilder edit-aware (charge via getWorkflow, sauve via updateWorkflow).
const workflowEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workflows/$workflowId/edit',
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

// ── LOT TELEPHONY-DISPOSITION (Sprint 16) — route protégée (calque reviewsRoute) ──
const telephonieRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/telephonie',
  component: () => (<LazyGuard><TelephoniePage /></LazyGuard>),
});

// ── LOT SOCIAL PLANNER (Sprint 9) — routes PROTÉGÉES (calque reviewsRoute) ───
const socialRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/social',
  component: () => (<LazyGuard><SocialPage /></LazyGuard>),
});

const socialCalendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/social/calendar',
  component: () => (<LazyGuard><SocialCalendarPage /></LazyGuard>),
});

// ── SPRINT 12 — IA contenu : route PROTÉGÉE (calque socialRoute / LazyGuard) ─
const aiContentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ai-content',
  component: () => (<LazyGuard><AiContentPage /></LazyGuard>),
});

const invoicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invoices',
  component: () => (<LazyGuard><InvoicesPage /></LazyGuard>),
});

const quotesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quotes',
  component: () => (<LazyGuard><QuotesPage /></LazyGuard>),
});

// ── Sprint 18 CATALOGUE DE SERVICES — route protégée (calque quotesRoute) ────
const catalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/catalog',
  component: () => (<LazyGuard><CatalogPage /></LazyGuard>),
});

// ── LOT FUNNEL — routes (calque invoicesRoute protégé + publicFormRoute) ────
const funnelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/funnels',
  component: () => (<LazyGuard><FunnelsPage /></LazyGuard>),
});

const funnelBuilderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/funnels/$funnelId',
  component: () => (<LazyGuard><FunnelBuilderPage /></LazyGuard>),
});

// Page publiée — hors LazyGuard/auth (calque EXACT publicFormRoute /f/$slug).
const publicFunnelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$slug',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <PublicFunnelPage />
    </Suspense>
  ),
});

// ── LOT SITE BUILDER — routes (PRO sous LazyGuard calque funnelsRoute /
//    funnelBuilderRoute ; pages publiques hors LazyGuard/auth calque EXACT
//    publicFunnelRoute /p/$slug). ⚠ /site/$slug/$page (page interne) déclarée
//    AVANT /site/$slug n'est PAS requis en TanStack Router (matching exact par
//    path), mais on conserve l'ordre par convention. ────────────────────────
const sitesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sites',
  component: () => (<LazyGuard><SitesPage /></LazyGuard>),
});

const siteBuilderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sites/$siteId',
  component: () => (<LazyGuard><SiteBuilderPage /></LazyGuard>),
});

// Site publié — page d'accueil. Hors LazyGuard/auth (calque EXACT publicFunnelRoute).
const publicSiteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/site/$slug',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <PublicSitePage />
    </Suspense>
  ),
});

// Site publié — page interne adressable `/site/:slug/:page` (calque publicSiteRoute).
const publicSitePageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/site/$slug/$page',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <PublicSitePage />
    </Suspense>
  ),
});

// ── LOT G7 MARKETPLACE — route (PRO sous LazyGuard calque funnelsRoute) ─────
const marketplaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/marketplace',
  component: () => (<LazyGuard><MarketplacePage /></LazyGuard>),
});

// ── LOT G1 HELPDESK — routes (PRO sous LazyGuard calque invoicesRoute ;
//    pages publiques hors LazyGuard/auth calque EXACT publicFunnelRoute) ─────
const ticketsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tickets',
  component: () => (<LazyGuard><TicketsPage /></LazyGuard>),
});

// Détail ticket = même panneau slide-over intégré à TicketsPage (pas de page
// séparée — calque LeadDetail). La route ouvre simplement le panneau.
const ticketDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tickets/$ticketId',
  component: () => (<LazyGuard><TicketsPage /></LazyGuard>),
});

const kbAdminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/kb',
  component: () => (<LazyGuard><KBAdminPage /></LazyGuard>),
});

const kbArticleEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/kb/$articleId',
  component: () => (<LazyGuard><KBAdminPage /></LazyGuard>),
});

// Formulaire public d'ouverture de ticket — hors LazyGuard/auth (calque EXACT
// publicFunnelRoute /p/$slug).
const publicTicketFormRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/support/$slug',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <PublicTicketFormPage />
    </Suspense>
  ),
});

// Article KB public — hors LazyGuard/auth (calque EXACT publicFunnelRoute).
// Path /help-center/$slug : /help/$slug est déjà pris par helpArticleRoute
// (Sprint 47 marketing) — namespace distinct pour éviter la collision.
const kbPublicRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/help-center/$slug',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <KBPublicPage />
    </Suspense>
  ),
});

// ── LOT G2 AFFILIATION — route PRO (calque invoicesRoute sous LazyGuard). Le
//    redirect public /r/:code est 100% worker (302) — AUCUNE route React. ──────
const affiliatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/affiliates',
  component: () => (<LazyGuard><AffiliatesPage /></LazyGuard>),
});

// ── LOT BOOKING — routes (réglages PROTÉGÉ calque settingsRoute +
//    page publique hors LazyGuard/auth calque EXACT publicFunnelRoute) ──────
const bookingSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/booking-settings',
  component: () => (<LazyGuard><BookingSettingsPage /></LazyGuard>),
});

// Page de réservation publique — hors LazyGuard/auth (calque EXACT
// publicFunnelRoute /p/$slug).
const publicBookingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/book/$slug',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <PublicBookingPage />
    </Suspense>
  ),
});

// ── LOT STOREFRONT CHECKOUT (Sprint 7) — vitrine + checkout PUBLICS, hors
//    LazyGuard/auth (calque EXACT publicBookingRoute / publicFunnelRoute
//    /p/$slug). Le panier est anonyme (token localStorage), paiement MOCK. ─────
const publicStoreRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/store/$slug',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <PublicStorePage />
    </Suspense>
  ),
});

const publicCheckoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/store/$slug/checkout',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <PublicCheckoutPage />
    </Suspense>
  ),
});

// ── LOT REPUTATION (Sprint 8) — page PUBLIQUE de dépôt d'avis 1st-party, hors
//    LazyGuard/auth (calque EXACT publicBookingRoute / publicFunnelRoute
//    /p/$slug). Invitation résolue par token ; après submit, le worker route
//    public (redirection Google/FB) ou privé (écran remerciement). ─────────────
const publicReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/r/$token',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <PublicReviewPage />
    </Suspense>
  ),
});

// ── LOT MEMBERSHIPS — routes (espace membre PUBLIC hors LazyGuard/auth
//    calque EXACT publicFunnelRoute /p/$slug + gestion PRO sous LazyGuard
//    calque settingsRoute). Corps réels Phase C Manager-C. ─────────────────
const memberSpaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/m/$slug',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <MemberSpacePage />
    </Suspense>
  ),
});

const coursesAdminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/courses-admin',
  component: () => (<LazyGuard><CoursesAdminPage /></LazyGuard>),
});

// ── LOT PORTAL-E — portail client PUBLIC (hors LazyGuard/auth, calque EXACT
//    memberSpaceRoute /m/$slug — collision /portal vérifiée libre) + config PRO
//    sous LazyGuard (calque coursesAdminRoute). Corps réels Phase C Manager-C. ──
const portalSpaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/portal/$slug',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <PortalSpacePage />
    </Suspense>
  ),
});

const portalSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/portal-settings',
  component: () => (<LazyGuard><PortalSettingsPage /></LazyGuard>),
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

// Sprint 35 (Agent B4) — Snapshots GHL-style (calque trashRoute sous LazyGuard)
const snapshotsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/snapshots',
  component: () => (<LazyGuard><SnapshotsPage /></LazyGuard>),
});

// Sprint 39 (Agent B4) — Multi-currency + tax regions (calque snapshotsRoute)
const currencyMultiSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/currency-multi',
  component: () => (<LazyGuard><CurrencyMultiSettingsPage /></LazyGuard>),
});

// Sprint 41 (Agent B1) — AI Voice Agent (calque currencyMultiSettingsRoute)
const voiceAgentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/voice-agent',
  component: () => (<LazyGuard><VoiceAgentPage /></LazyGuard>),
});

// Sprint 43 (Agent B2) — Courses LMS member-facing UI (calque voiceAgentRoute)
const coursesLMSRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/lms',
  component: () => (<LazyGuard><CoursesLMSPage /></LazyGuard>),
});

// Sprint 45 (Agent B2) — Community forum (calque coursesLMSRoute sous LazyGuard)
const communityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/community',
  component: () => (<LazyGuard><CommunityPage /></LazyGuard>),
});

// Sprint 47 (Agent B2) — Multi-warehouse + Dropshipping (calque communityRoute sous LazyGuard)
const warehouseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/warehouse',
  component: () => (<LazyGuard><WarehousePage /></LazyGuard>),
});

// Sprint 48 (Agent B2) — B2B wholesale + Bundles + Pre-orders (calque warehouseRoute)
const b2bRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/b2b',
  component: () => (<LazyGuard><B2BPage /></LazyGuard>),
});

// Sprint 42 (Agent B1) — AI Chat Agent (calque voiceAgentRoute)
const chatBotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/chat-bot',
  component: () => (<LazyGuard><ChatBotPage /></LazyGuard>),
});

// Sprint 50 (Agent B2) — Surveys & DNS (calque chatBotRoute sous LazyGuard)
const surveysAndDnsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/surveys-and-dns',
  component: () => (<LazyGuard><SurveysAndDnsPage /></LazyGuard>),
});

// Sprint 36 (Agent B2) — Live chat inbox (page standalone /chat-inbox)
const chatInboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat-inbox',
  component: () => (<LazyGuard><ChatInbox /></LazyGuard>),
});

// Sprint 36 (Agent B4) — Live chat widgets manager (page standalone /chat-widgets)
const chatWidgetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat-widgets',
  component: () => (<LazyGuard><ChatWidgetsPage /></LazyGuard>),
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

const formsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forms',
  component: () => (<LazyGuard><FormsPage /></LazyGuard>),
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
// Sprint 4 — Coupons/promos + Abonnements produit (gated <ModuleGuard>).
const boutiqueCouponsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/boutique/coupons',
  component: () => (<LazyGuard><ModuleGuard module="ecommerce"><BoutiqueCouponsPage /></ModuleGuard></LazyGuard>),
});
const boutiqueAbonnementsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/boutique/abonnements',
  component: () => (<LazyGuard><ModuleGuard module="ecommerce"><BoutiqueAbonnementsPage /></ModuleGuard></LazyGuard>),
});
// Sprint 37 (Agent B1) — POS retail caisse (ModuleGuard "ecommerce" appliqué dans la page)
const boutiquePOSRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/boutique/pos',
  component: () => (<LazyGuard><BoutiquePOSPage /></LazyGuard>),
});
// Sprint 38 (Agent B4) — Gift cards + Loyalty (ModuleGuard "ecommerce" appliqué dans la page)
const boutiqueGiftCardsLoyaltyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/boutique/giftcards-loyalty',
  component: () => (<LazyGuard><BoutiqueGiftCardsLoyaltyPage /></LazyGuard>),
});
// Sprint 40 (Agent B4) — Recovery workflow editor (ModuleGuard "ecommerce" appliqué dans la page)
const boutiqueRecoveryWorkflowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/boutique/recovery-workflow',
  component: () => (<LazyGuard><BoutiqueRecoveryWorkflowPage /></LazyGuard>),
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

// ── Sprint 24 — Observabilité : page admin santé/perf/alertes ─────────────
const adminObservabilityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/observability',
  component: () => (<LazyGuard><AdminGuard><ObservabilityPanelPage /></AdminGuard></LazyGuard>),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  signupRoute,
  acceptInvitationRoute,
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
  workflowEditRoute,
  workflowDetailRoute,
  workflowsRoute,
  sequencesRoute,
  campaignsRoute,
  segmentsRoute,
  calendarRoute,
  integrationsRoute,
  reportsRoute,
  sharedDashboardRoute,
  tasksRoute,
  changePasswordRoute,
  settingsRoute,
  // Sprint 21 — Onboarding durci : page dédiée /getting-started
  gettingStartedRoute,
  documentsRoute,
  documentTemplatesRoute,
  signDocumentRoute,
  reviewsRoute,
  // ── LOT TELEPHONY-DISPOSITION (Sprint 16) — journal d'appels global ──
  telephonieRoute,
  // ── LOT SOCIAL PLANNER (Sprint 9) — /social/calendar AVANT /social ──
  socialCalendarRoute,
  socialRoute,
  // ── SPRINT 12 — IA contenu : atelier centralisé ──
  aiContentRoute,
  invoicesRoute,
  quotesRoute,
  // ── Sprint 18 CATALOGUE DE SERVICES ──
  catalogRoute,
  // ── LOT FUNNEL ──
  funnelsRoute,
  funnelBuilderRoute,
  publicFunnelRoute,
  // ── LOT SITE BUILDER (Sprint 10) — sites multi-pages ──
  sitesRoute,
  siteBuilderRoute,
  publicSitePageRoute,
  publicSiteRoute,
  // ── LOT G7 MARKETPLACE ──
  marketplaceRoute,
  // ── LOT G1 HELPDESK ──
  ticketsRoute,
  ticketDetailRoute,
  kbAdminRoute,
  kbArticleEditRoute,
  publicTicketFormRoute,
  kbPublicRoute,
  // ── LOT G2 AFFILIATION ──
  affiliatesRoute,
  // ── LOT BOOKING ──
  bookingSettingsRoute,
  publicBookingRoute,
  // ── LOT STOREFRONT CHECKOUT (Sprint 7) — vitrine + checkout publics ──
  publicStoreRoute,
  publicCheckoutRoute,
  // ── LOT REPUTATION (Sprint 8) — page publique de dépôt d'avis 1st-party ──
  publicReviewRoute,
  // ── LOT MEMBERSHIPS ──
  memberSpaceRoute,
  coursesAdminRoute,
  // ── LOT PORTAL-E ──
  portalSpaceRoute,
  portalSettingsRoute,
  agenciesRoute,
  trashRoute,
  // Sprint 35 (Agent B4) — Snapshots GHL-style
  snapshotsRoute,
  // Sprint 39 (Agent B4) — Multi-currency + tax regions
  currencyMultiSettingsRoute,
  // Sprint 41 (Agent B1) — AI Voice Agent
  voiceAgentRoute,
  // Sprint 43 (Agent B2) — Courses LMS member-facing UI
  coursesLMSRoute,
  // Sprint 45 (Agent B2) — Community forum
  communityRoute,
  // Sprint 47 (Agent B2) — Multi-warehouse + Dropshipping
  warehouseRoute,
  // Sprint 48 (Agent B2) — B2B wholesale + Bundles + Pre-orders
  b2bRoute,
  // Sprint 42 (Agent B1) — AI Chat Agent
  chatBotRoute,
  // Sprint 50 (Agent B2) — Surveys & DNS
  surveysAndDnsRoute,
  // Sprint 36 (Agent B2) — Live chat inbox
  chatInboxRoute,
  // Sprint 36 (Agent B4) — Live chat widgets manager
  chatWidgetsRoute,
  visitModeRoute,
  emailBuilderRoute,
  formsRoute,
  formBuilderRoute,
  triggerLinksRoute,
  publicFormRoute,
  propertiesRoute,
  // ── Sprint E1 M3.3 — Module Boutique (e-commerce B2) ──
  boutiqueDashboardRoute,
  boutiqueProduitsRoute,
  boutiqueCommandesRoute,
  boutiqueClientsRoute,
  // ── Sprint 4 — Coupons/promos + Abonnements produit ──
  boutiqueCouponsRoute,
  boutiqueAbonnementsRoute,
  // Sprint 37 (Agent B1) — POS retail caisse
  boutiquePOSRoute,
  // Sprint 38 (Agent B4) — Gift cards + Loyalty
  boutiqueGiftCardsLoyaltyRoute,
  // Sprint 40 (Agent B4) — Recovery workflow editor
  boutiqueRecoveryWorkflowRoute,
  adminIndexRoute,
  adminOverviewRoute,
  // Sprint 24 — Observabilité
  adminObservabilityRoute,
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
// ── Sprint 23 — Sécurité / conformité : banner cookies global (Loi 25 + RGPD) ──
import { CookiesBanner } from '@/components/CookiesBanner';

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
            {/* Sprint 23 — Cookies banner global (frère du RouterProvider). */}
            <CookiesBanner />
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
