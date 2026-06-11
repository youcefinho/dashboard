// ══════════════════════════════════════════════════════════════
// ██  ROUTEUR API — Intralys CRM Central
// ██  ~200 lignes → délègue aux 23 modules dans src/worker/
// ══════════════════════════════════════════════════════════════

import type { Env } from './worker/types';
import { setRequestContext, corsHeaders, json, requireAuth, setRequestId } from './worker/helpers';
import { errorResponse } from './worker/lib/error-response';

const START_TIME = Date.now();

// ── Modules métier ──────────────────────────────────────────
import { handleLogin, handleLogout, handleMe, handleChangePassword, handleGetSessions, handleDeleteSession, handleDeleteOtherSessions, handleGenerateBackupCodes, handleUpdateProfile, handleNotificationPreferences } from './worker/auth';
import { resolveTenantContext, type TenantContext } from './worker/tenant-context';
import {
  handleGetClients, handleCreateClient, handleGetClientLeads,
  handleGetLeads, handlePatchLead, handleBulkLeads, handleCreateLead,
  handleGetPipeline, handleGetLeadDetail,
  handleAddTag, handleRemoveTag, handleGetAllTags,
  handleGetActivity, handleExportCsv, setAutoEnroll,
} from './worker/leads';
import {
  handleGetLeadMessages, handleSendMessage,
  handleGetInboxMessages, handleInboundSms, handleInboundEmail,
} from './worker/messages';
import { handleGlobalSearch } from './worker/search';
import { handleConfigurableExport } from './worker/exports-extra';
import { handleGetTemplates, handleCreateTemplate, handleUpdateTemplate, handleDeleteTemplate, handleDuplicateTemplate, handleSendTestEmail } from './worker/templates';
import {
  handleGetPipelines, handleCreatePipeline, handleUpdatePipeline, handleDeletePipeline,
  handleGetPipelineStages, handleCreatePipelineStage, handleUpdatePipelineStage, handleDeletePipelineStage,
  handleReorderPipelineStages, handleGetLostReasons, handleCreateLostReason, handleGetPipelineForecast
} from './worker/pipelines';
import {
  handleGetWorkflows, handleGetWorkflowDetail, handleCreateWorkflow,
  handleUpdateWorkflow, handleDeleteWorkflow, handleToggleWorkflow,
  handleEnrollLead, processWorkflowQueue,
  autoEnroll,
  // LOT AUTOMATION BUILDER seq 105 (Sprint 4) — stubs Phase A → corps Phase B.
  handleGetWorkflowExecLog, handleGetLeadAutomationHistory,
  handleSimulateWorkflow, handleCreateWorkflowFromTemplate
} from './worker/workflows';
// LOT AUTOMATION BUILDER seq 105 — catalogue de modèles (fichier NEUF).
import { handleGetWorkflowTemplates } from './worker/workflow-templates';

import {
  handleGetCustomFields, handleCreateCustomField, handleUpdateCustomField, handleDeleteCustomField,
  handleGetLeadCustomFields, handleSetLeadCustomFields,
  handleGetSmartLists, handleCreateSmartList, handleDeleteSmartList, handleExecuteSmartList
} from './worker/custom-fields';
import { handleGetAppointments, handleCreateAppointment, handleUpdateAppointment, handleDeleteAppointment } from './worker/appointments';
import { handleGetTasks, handleGetTask, handleCreateTask, handlePatchTask, handleDeleteTask, processOverdueTasks } from './worker/tasks';
import { handleGetNotifications, handleReadNotification, handleReadAllNotifications } from './worker/notifications';
import { handleReportsOverview, handleReportsSources, handleReportsConversion, handleGetSavedReports, handleCreateSavedReport, handleDeleteSavedReport, handleRunReportWidget, handleReportsAttribution, handleReportsLeadCohorts } from './worker/reports';
// Sprint 46 M1.3 — Custom dashboards builder
import {
  handleGetDashboards, handleGetDashboard, handleCreateDashboard,
  handleUpdateDashboard, handleDeleteDashboard, handleShareDashboard,
  handleGetSharedDashboard,
} from './worker/dashboards';
// SPRINT 15 — Reports builder : templates de dashboard clonables (catalogue +
// clone). capGuard DANS les handlers (report-templates.ts owned Manager-B — corps
// Phase B). reports.view (lecture) / workflows.manage (clone).
import {
  handleGetReportTemplates, handleApplyReportTemplate,
} from './worker/report-templates';
// LOT SCHEDREPORT Sprint A — rapports d'activité planifiés (digest email)
import {
  handleListScheduledReports, handleCreateScheduledReport,
  handleUpdateScheduledReport, handleDeleteScheduledReport,
} from './worker/scheduled-reports';
// LOT PROACTIVE-C Sprint A — IA proactive batch (churn + NBA + alertes in-app)
import {
  handleListProactiveAlerts, handleMarkProactiveAlertSeen,
  handleDismissProactiveAlert,
} from './worker/proactive-ai';
import {
  handleGetBookingPages, handleCreateBookingPage, handleUpdateBookingPage, handleDeleteBookingPage,
  handleGetBookings, handlePublicBookingPage, handlePublicCreateBooking,
} from './worker/bookings';
// ── LOT BOOKING — moteur de réservation client pro (Phase A fige le dispatch ;
//    corps réels Phase B Manager-B dans booking-public.ts). Capability
//    réutilisée 'workflows.manage' (PAS d'ajout à ALL_CAPABILITIES). Le moteur
//    public est NEUF/ISOLÉ — bookings.ts existant intact (rétro-compat). ──────
import {
  handleGetBookingAvailability, handleGetPublicBookingMeta,
  handlePublicCreateBookingV2,
  handlePublicCancelBooking, handlePublicRescheduleBooking,
  handleListEventTypes, handleCreateEventType,
  handleUpdateEventType, handleDeleteEventType,
} from './worker/booking-public';
// ── LOT STOREFRONT CHECKOUT (Sprint 7) — tunnel acheteur PUBLIC du module
//    e-commerce (Phase A fige le dispatch ; corps réels Phase B Manager-B dans
//    storefront-public.ts). Routes publiques par slug = AUCUNE auth/capability
//    (bornage STRICT par client_id résolu du slug, anti-fuite cross-tenant) ;
//    settings PRO = capability EXISTANTE 'settings.manage' (PAS d'ajout à
//    ALL_CAPABILITIES). Réutilise createOrderCore/cart/shipping/tax/coupons par
//    IMPORT — cœurs ecom INTACTS. Paiement MOCK impératif (E4/E6 inactif). ──────
import {
  handleStoreProducts, handleStoreProduct,
  handleStoreGetCart, handleStoreAddCartItem,
  handleStoreUpdateCartItem, handleStoreDeleteCartItem,
  handleStoreShippingQuote, handleStoreCheckout, handleStoreGetOrder,
  handleGetStoreSettings, handleSaveStoreSettings,
} from './worker/storefront-public';
// ── LOT REPUTATION (Sprint 8) — page PUBLIQUE de dépôt d'avis 1st-party + routing
//    intelligent. Phase A fige le dispatch ; corps réels Phase B Manager-B dans
//    reputation-public.ts (page publique par token + submit avec routing) /
//    reputation.ts (settings PRO + feedback privé). Routes publiques par token =
//    AUCUNE auth/capability (bornage STRICT par token, anti-fuite cross-tenant) ;
//    settings PRO = capability EXISTANTE réutilisée (PAS d'ajout à
//    ALL_CAPABILITIES). NE casse PAS reviews.ts (flux 1st-party séparé). Google/FB
//    INACTIFS (_v2-backlog). ─────────────────────────────────────────────────
import {
  handlePublicGetReviewPage, handlePublicSubmitReview,
} from './worker/reputation-public';
import {
  handleGetReputationSettings, handleUpdateReputationSettings, handleGetPrivateFeedback,
} from './worker/reputation';
// ── LOT BOOKING REMINDERS / NO-SHOW (Phase A fige le dispatch ; corps réels
//    Phase B Manager-B dans booking-reminders.ts). No-show tracking protégé
//    (capability 'workflows.manage' réutilisée). Le cron rappels est câblé
//    dans scheduled() (best-effort). ─────────────────────────────────────────
import { handleMarkNoShow } from './worker/booking-reminders';
// ── LOT MEMBERSHIPS — espace membre & cours (Phase A fige le dispatch ; corps
//    réels Phase B Manager-B dans member-auth.ts / memberships.ts). Auth
//    membre 100% SÉPARÉE (member_sessions ≠ admin_sessions/users). Capability
//    PRO réutilisée 'workflows.manage' (PAS d'ajout à ALL_CAPABILITIES). ─────
import {
  handleMemberRegister, handleMemberLogin, handleMemberLogout, requireMember,
} from './worker/member-auth';
import {
  handleListCourses, handleCreateCourse, handleGetCourse, handleUpdateCourse,
  handleDeleteCourse, handleCourseModules,
  handleCreateLesson, handleUpdateLesson, handleDeleteLesson,
  handleMembershipSites, handleMembershipPlans,
  handleMemberCourses, handleMemberLesson, handleMemberLessonVideo,
  handleMemberProgress,
  // LOT MEMBERSHIP ENROLL (Sprint 6 fermeture boucle) — 5 stubs, corps Phase B.
  handleMemberEnroll, handleMemberCourseDetail,
  handleListMembers, handleAdminEnroll, handleListEnrollments,
} from './worker/memberships';
// ── LOT PORTAL-E — portail client (Phase A fige le dispatch ; corps réels des
//    agrégateurs Phase B Manager-B dans portal.ts). Auth portail 100% SÉPARÉE
//    (portal_sessions ≠ admin_sessions/users ≠ member_sessions/members), token
//    distinct intralys_portal_token. ISOLATION DOUBLE lead_id+client_id (session).
//    Capability config PRO réutilisée 'billing.view' (PAS d'ajout à
//    ALL_CAPABILITIES). Facture LECTURE SEULE (E4 jamais). ────────────────────
import {
  handlePortalLogin, handlePortalSetPassword, handlePortalLogout, requirePortalUser,
} from './worker/portal-auth';
import {
  handlePortalInvoices, handlePortalQuotes, handlePortalAppointments,
  handlePortalDocuments, handlePortalTickets, handlePortalCreateTicket,
  handlePortalSites, handlePortalUsers,
} from './worker/portal';
// ── LOT G10 COMMUNAUTÉ — espace social membres (forum threads/posts PLATS) +
//    commentaires de leçons (Phase A fige le dispatch ; corps réels Phase B
//    Manager-B dans community.ts). Auth MEMBRE (requireMember, member_sessions
//    ≠ admin_sessions/users) pour créer/lire/supprimer-son-propre ; modération
//    PRO via capability réutilisée 'workflows.manage' (PAS d'ajout à
//    ALL_CAPABILITIES). Isolation cross-site = client_id == member.clientId. ──
import {
  handleListThreads, handleCreateThread, handleListThreadPosts, handleCreatePost,
  handleDeleteOwnPost, handleListLessonComments, handleCreateLessonComment,
  handleDeleteOwnComment,
  handleModerateListThreads, handleModerateDeletePost, handleModerateDeleteComment,
  handleModerateThread, handleModerateListPosts, handleModerateListComments,
} from './worker/community';
import { handleGetForms, handleGetForm, handleGetFormStats, handleCreateForm, handleUpdateForm, handleDeleteForm, handleGetFormSubmissions, handlePublicFormGet, handlePublicFormSubmit, handleTrackFormView, handleLogFormFieldEvent, handleGetFormFieldAnalytics } from './worker/forms';
// ── LOT FUNNEL — builder landing pages / funnels (Phase A fige le dispatch ;
//    corps réels Phase B Manager-B dans funnels.ts). Capability réutilisée
//    'workflows.manage' (PAS d'ajout à ALL_CAPABILITIES). ─────────────────────
import {
  handleGetFunnels, handleCreateFunnel, handleGetFunnel, handleUpdateFunnel,
  handleDeleteFunnel, handleSaveFunnelPage, handlePublishFunnel, handleGetFunnelStats,
  handlePublicFunnelGet, handlePublicFunnelSubmit, handleTrackFunnelEvent,
} from './worker/funnels';
import {
  handleFunnelCheckout, handleFunnelUpsell,
  handleGetFunnelOffers, handleSaveFunnelOffer, handleDeleteFunnelOffer,
} from './worker/funnel-checkout';
// ── LOT SITE BUILDER (Sprint 10) — site multi-pages réutilisant le moteur funnel
//    (Phase A fige le dispatch ; corps réels Phase B Manager-B dans sites.ts).
//    Capability RÉUTILISÉE 'workflows.manage' (PAS d'ajout à ALL_CAPABILITIES).
//    Tables NEUVES seq 111. Le moteur de blocs (funnel-blocks.ts) est RÉUTILISÉ.
import {
  handleGetSites, handleCreateSite, handleGetSite, handleUpdateSite,
  handleDeleteSite, handleGetSitePages, handleCreateSitePage, handleSaveSitePage,
  handleDeleteSitePage, handlePublishSite,
  handlePublicSiteGet, handlePublicSitePageGet, handlePublicSiteSubmit,
} from './worker/sites';
// ── LOT G7 MARKETPLACE — templates partageables cross-tenant (Phase A fige le
//    dispatch ; corps réels Phase B Manager-B dans marketplace.ts). GET listing(s)
//    PUBLIC ; publish/install/review PROTÉGÉS (capability 'workflows.manage'
//    réutilisée — PAS d'ajout à ALL_CAPABILITIES). ─────────────────────────────
import {
  handleGetMarketplaceListings, handleGetMarketplaceListing,
  handlePublishMarketplaceListing, handleInstallMarketplaceListing,
  handleReviewMarketplaceListing, handleGetMyMarketplaceListings,
} from './worker/marketplace';
// ── LOT G1 HELPDESK — tickets de support + base de connaissances (Phase A fige
//    le dispatch ; corps réels Phase B Manager-B dans tickets.ts / kb.ts).
//    Garde mode-agence-only helpdeskCapGuard ('leads.write' réutilisée — PAS
//    d'ajout à ALL_CAPABILITIES). ────────────────────────────────────────────
import {
  handleGetTickets, handleCreateTicket, handleGetTicket, handleUpdateTicket,
  handleReplyTicket, handlePublicSubmitTicket,
} from './worker/tickets';
import {
  handleGetKBArticles, handleCreateKBArticle, handleGetKBArticle,
  handleUpdateKBArticle, handleDeleteKBArticle, handlePublicGetKBArticle,
  handleTriggerKbIndexing, handleTriggerAllKbIndexing, handleGetKbIndexStatus,
} from './worker/kb';
// ── LOT G2 AFFILIATION — programme d'affiliation natif (Phase A fige le
//    dispatch ; corps réels Phase B Manager-B dans affiliates.ts). Garde
//    mode-agence-only affiliateCapGuard ('workflows.manage' réutilisée — PAS
//    d'ajout à ALL_CAPABILITIES). Redirect public /r/:code (calque /l/:id).
//    Attribution via ?aff= (PAS ?ref=). ZÉRO Stripe (payout manuel v1). ────────
import {
  handleAffiliateRedirect, handleGetAffiliates, handleCreateAffiliate,
  handleGetAffiliate, handleUpdateAffiliate, handleDeleteAffiliate,
  handleGetAffiliateProgram, handleUpdateAffiliateProgram,
  handleGetAffiliateCommissions, handleExportAffiliateCommissions,
  handleUpdateCommissionStatus,
} from './worker/affiliates';
import { handleGetTriggerLinks, handleCreateTriggerLink, handleDeleteTriggerLink, handleTriggerLinkClick, handleGetTriggerLinkStats } from './worker/trigger-links';
import { handleAiGenerate, handleAiSuggestWorkflow, handleAiSummarizeConversation, handleAiSuggestNextAction, handleAiSummarizeLeads, handleAiDrafts, handleAiClassifyConversation, handleAiClassifyLead, handleAiNlQuery, handleAiComposeSuggest, handleAiProofread, handleAiSuggestReplies, handleGetWeeklyInsight, handleGenerateWeeklyInsight, handleTranslateMessage } from './worker/ai';
// Sprint 43 M3 — Reactions / QuickReplies / LeadScore backend
import { handleGetReactions, handleAddReaction, handleRemoveReaction } from './worker/reactions';
import { handleGetQuickReplies, handleAddQuickReply } from './worker/quick-replies';
import { handleGetLeadScore } from './worker/lead-score';
// Sprint 49 M2 — Predictive + bottleneck + anomalies
import { handleGetLeadPredict } from './worker/lead-predict';
// Sprint 77 — Routage prédictif IA
import { handleRouteLeadPredictive } from './worker/lead-routing';
// Sprint 13 — Scoring prédictif calibré tenant (conversion-scoring)
import { handleGetConversionScore } from './worker/conversion-engine';
// Sprint 14 — Forecasting (projection + objectifs + scénarios). Routes NEUVES
// /api/forecast* (moteur enrichi) — DISTINCT de /api/pipelines/:id/forecast
// (forecast pondéré naïf existant, INTOUCHÉ). capGuard reports.view DANS les
// handlers (forecast-engine.ts owned Manager-B — corps Phase B).
import {
  handleGetForecast, handleGetForecastTargets, handleCreateForecastTarget,
  handleDeleteForecastTarget,
} from './worker/forecast-engine';
import { handleGetPipelineBottlenecks, handleGetActivityAnomalies } from './worker/pipeline-insights';
import { handlePublicUnsubscribe, handleGetUnsubscribes, handleLogConsent, handleGetConsent, handleForgetLead, handleExportPii } from './worker/compliance';
// Sprint 93 — Purge RGPD & Loi 25 automatisée
import {
  handleGetPurgeRules, handleCreatePurgeRule, handleUpdatePurgeRule,
  handleDeletePurgeRule, handlePreviewPurge, handleRunPurge,
} from './worker/privacy-purge';
import { handleGetSubAccounts, handleCreateSubAccount, handleUpdateSubAccount, handleCreateSnapshot, handleApplySnapshot, handleGetWhitelabel, handleUpdateWhitelabel, handleWidgetScript } from './worker/sub-accounts';
import { handleListAccountSnapshots, handleCreateAccountSnapshot, handleApplyAccountSnapshot, handleDeleteAccountSnapshot } from './worker/account-snapshots';
// gcal.ts et gbp.ts déplacés en _v2-backlog/ (Sprint Consolidation)

import { handleEmailBroadcast, handleGetBroadcasts, handleGetBroadcastDetail } from './worker/broadcast';
// ── Sprint 5 — Email marketing & séquences pro (wrapper léger sur le moteur
// workflows EXISTANT ; aucun nouveau scheduler). Stubs Phase A → corps Phase B.
import {
  handleGetSequences, handleCreateSequence, handleGetSequenceDetail,
  handleUpdateSequence, handleDeleteSequence, handleEnrollSequence,
  handleGetSequenceStats,
} from './worker/sequences';
// ── LOT G6 — Segmentation comportementale + A/B testing campagnes (stubs
// Phase A → corps Phase B Manager-B). Capability workflows.manage réutilisée
// DANS les handlers (capGuard). Routes câblées Phase A (anti-shadowing).
import {
  handleGetSegments, handleCreateSegment, handlePreviewSegment,
  handleGetSegment, handleUpdateSegment, handleDeleteSegment, handleEnrollSegment,
  handleGetVariants, handleSetVariants,
} from './worker/segments';
// ── LOT G8 — AI Workspace conversationnel (assistant global cmd+/). Stubs
// Phase A → corps Phase B Manager-B. Capability `ai.use` réutilisée DANS les
// handlers (capGuard mode-agence-only). Tables ai_chat_* seq 91 (distinct de
// ai_conversations/ai_messages seq 7). Routes câblées Phase A (anti-shadowing
// /message AVANT /:id). v1 READ-ONLY / DRAFT-ONLY.
import {
  handleListAiThreads, handleCreateAiThread, handleGetAiThread,
  handleDeleteAiThread, handleSendAiMessage,
  // SPRINT 11 (Copilot v2, ADDITIF) — confirmation humaine d'action sûre.
  handleConfirmAiAction,
} from './worker/ai-chat';
import { handleDashboardStats, handleTotpSetup, handleTotpVerify, handleTotpDisable, handleSendSmsRoute, handleCsvImport } from './worker/dashboard';
import { handleWebhookLead } from './worker/leads';
import {
  handleUploadFile, handleGetFile, handleGetFiles, handleDeleteFile,
  handleGetDocumentTemplates, handleCreateDocumentTemplate, handleUpdateDocumentTemplate, handleDeleteDocumentTemplate,
  handleGetDocuments, handleCreateDocument, handleSendDocument,
  handlePublicGetDocument, handlePublicSignDocument, handleSendSigningSms,
} from './worker/documents';
import { handleGetPacks, handleGetPackDetail, handleInstallPack } from './worker/packs';
import {
  handleGetReviewRequests, handleCreateReviewRequest, handleBulkReviewRequest,
  handleGetReviews, handleGetReviewStats, handleSuggestReviewReply, handleReplyToReview,
} from './worker/reviews';
import { WebchatRoom, handleWebchatConnect, handleWebchatPrechat } from './worker/webchat';
// Sprint 46 M3.4 — NotificationsRoom Durable Object (broadcast WebSocket par user)
import { NotificationsRoom } from './worker/notifications-ws';
import {
  handleGetScoreProfiles, handleCreateScoreProfile, handleUpdateScoreProfile,
  handleGetLeadScores, handleRecomputeLeadScore, seedDefaultScoreProfiles,
} from './worker/scoring';
import {
  handleGetLeadNotes, handleCreateLeadNote, handleUpdateLeadNote, handleDeleteLeadNote,
} from './worker/lead-notes';
import {
  handleGetConversations, handleGetConversationDetail,
  handleCreateConversation, handleSendConversationMessage, handleUpdateConversation,
} from './worker/conversations';

import {
  handleGetPreferences, handleUpdatePreferences,
  handleGetApiKeys, handleCreateApiKey, handleRevokeApiKey,
  handleGetWebhooks, handleCreateWebhook, handleDeleteWebhook,
  handleGetClientCompliance, handleUpdateClientCompliance
} from './worker/settings';
import {
  handleGetPhoneNumbers, handleSearchPhoneNumbers,
  handlePurchasePhoneNumber, handleReleasePhoneNumber,
  handleGetRoutingRules, handleSaveRoutingRules
} from './worker/phone-numbers';
import {
  handleGetDialerCampaigns,
  handleCreateDialerCampaign,
  handleGetDialerCampaign,
  handleUpdateDialerCampaign,
  handleDeleteDialerCampaign,
  handleGetDialerCurrentLead,
} from './worker/dialer';

import { handleGetUsers, handleInviteUser, handleUpdateUserRole, handleDeleteUser, handleGetRoles, handleAcceptInvitation, handleRevokeInvitation, handleResendInvitation, handleListInvitations, handleUpdateRolePermission } from './worker/team';
// ── LOT TEAM B/C — capabilities + sous-comptes (Phase A fige le dispatch) ───
import { resolveCapabilities, handleGetMyCapabilities } from './worker/capabilities';
import { handleGetSystemAuditLogs } from './worker/system-audit';
import { handleUpdateClient, handleDeleteClient, handleGetClientBranding, handleUpdateClientBranding, handleGetAgencyReports, handleGetCustomDomains, handleAddCustomDomain, handleDeleteCustomDomain } from './worker/clients-admin';

import { handleFeedback, handleNps } from './worker/feedback';
import { handleDemoReset } from './worker/admin';
// Sprint 46 M2 — Admin analytics (overview / heatmap / features-usage)
import {
  handleAdminOverview, handleAdminActivityHeatmap, handleAdminFeaturesUsage,
} from './worker/admin-analytics';
// Sprint S-D (LOT D, M1 cadre / M2 implémente) — Observabilité ops : agrégat
// web-vitals admin. handleAdminWebVitals créé par Manager B dans
// observability-ops.ts selon contrat §6.3 de docs/SPRINT-D.md (signature figée
// (request, env, auth) => Promise<Response>).
import { handleAdminWebVitals } from './worker/observability-ops';
// Sprint 24 — Observabilité : middleware request_id + helper request-metrics.
//   - `setRequestId` (importé ligne 7 avec setRequestContext) est appelé au
//     chokepoint juste après setRequestContext.
//   - `recordRequestMetric` est appelé via ctx.waitUntil au point de sortie
//     du fetch handler (best-effort, never throws — cf. lib/request-metrics.ts).
import { recordRequestMetric } from './worker/lib/request-metrics';
// Sprint 25 — Perf : Cache API helper (best-effort, never throws). Wrappe 3
// endpoints GET en lecture seule (billing/plans 300s, capabilities/me 30s,
// observability/request-metrics 60s) + bust sur 2 mutations qui invalident.
// Voir docs/LOT-PERF.md §cache pour le contrat exact + clés canoniques.
import { cacheGet, cachePut, cacheBust } from './worker/lib/cache';
import { handleDataReconcile } from './worker/data-reconcile';
import { handleCompleteOnboarding, handleWelcomeOnboarding, handleGetOnboardingState, handlePutOnboardingState, handleGetChecklist, handleCompleteChecklistItem, handleSkipChecklistItem, handleResetChecklist } from './worker/onboarding';
import { handleRegisterDevice, handleUnregisterDevice, handleSendPush } from './worker/push';

// Export Durable Objects pour Cloudflare
export { WebchatRoom };
// Sprint 46 M3.4 — Notifications real-time
export { NotificationsRoom };

// Injection de dépendance : autoEnroll pour les leads
setAutoEnroll(autoEnroll);

// ── Entry Point ─────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    setRequestContext(request, env);
    // ── Sprint 24 — Observabilité : middleware request_id ─────────────────
    // Reprend le header X-Request-Id entrant (corrélation cross-service, ex:
    // gateway → worker) ou en génère un UUID v4 si absent. Stocké via
    // setRequestId (helpers.ts) pour :
    //   - injection header X-Request-Id en réponse (json())
    //   - propagation audit_log.request_id (audit() triple fallback seq122)
    //   - corrélation logs via createCorrelatedLogger (logger.ts)
    // `__startMs` capture le timestamp pour calcul de latence dans
    // recordRequestMetric() au point de sortie ci-dessous.
    const requestId = request.headers.get('X-Request-Id') || crypto.randomUUID();
    setRequestId(requestId);
    const __startMs = Date.now();
    const url = new URL(request.url);
    let path = url.pathname;
    const method = request.method;

    // ── Sprint 96 — API Versioning : rewrite /v1/api/* → /api/* ────────
    let __apiVersionCtx: import('./worker/api-versioning').ApiVersionContext | null = null;
    try {
      const { parseVersionPrefix, handleUnsupportedVersion } = await import('./worker/api-versioning');
      const unsupported = handleUnsupportedVersion(path);
      if (unsupported) return unsupported;
      __apiVersionCtx = parseVersionPrefix(path);
      if (__apiVersionCtx) {
        path = __apiVersionCtx.rewrittenPath;
      }
    } catch {
      // Fail-open : si le module est absent, on continue sans versioning
    }

    // ── Sprint 47 M2.4 — SSR meta snapshot pour crawlers (Google/Twitter/FB/LinkedIn)
    // Non destructif : ne s'active QUE si UA = crawler ET path = route marketing
    // connue (cf. src/worker/route-meta-ssr.ts). Sinon, traverse vers le SPA.
    try {
      const { maybeServeSsrMeta, maybeServeFunnelSsr } = await import('./worker/route-meta-ssr');
      const ssrResponse = maybeServeSsrMeta(request);
      if (ssrResponse) return ssrResponse;
      // ── LOT FUNNEL — snapshot crawler /p/:slug (async, best-effort).
      //    Non bloquant : null ⇒ traverse au SPA hydraté.
      const funnelSsr = await maybeServeFunnelSsr(request, env);
      if (funnelSsr) return funnelSsr;
      // ── LOT SITE BUILDER — snapshot crawler /site/:slug[/:page] (async,
      //    best-effort). Non bloquant : null ⇒ traverse au SPA hydraté.
      const { maybeServeSiteSsr } = await import('./worker/site-ssr');
      const siteSsr = await maybeServeSiteSsr(request, env, url);
      if (siteSsr) return siteSsr;
    } catch {
      // Si le module échoue, on laisse traverser au SPA — pas de blocking
    }

    // CORS preflight
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

    // ── Sprint 91 (seq186) — Middleware global rate-limiting KV ────────────
    // Fixed-window counter via Cloudflare KV (env.RATE_LIMITER). Tier 'public'
    // (60 req/min/IP) pour toutes les routes /api/*. Le tier 'authenticated'
    // (120 req/min/user) est appliqué plus bas, APRÈS requireAuth, en
    // ré-évaluant avec l'identifiant utilisateur.
    //
    // Exemptions :
    //   - OPTIONS → traité au-dessus (preflight CORS, jamais rate-limité).
    //   - Routes non /api/* → assets SPA, pas d'API à protéger.
    //   - /api/openapi.json, /docs/api → documentation, faible risque.
    //
    // Idiome FAIL-OPEN : si env.RATE_LIMITER est absent (binding KV non
    // configuré) ou si KV panne, checkRateLimitKV retourne { allowed: true }
    // → le middleware est transparent et ne bloque JAMAIS en cas de panne.
    //
    // Headers X-RateLimit-* injectés sur TOUTES les réponses (même autorisées)
    // via un wrapper qui clone la Response finale. Le rate-limit result est
    // stocké dans __rlResult pour injection au point de sortie.
    let __rlResult: import('./worker/lib/rate-limit-kv').RateLimitKVResult | null = null;
    if (path.startsWith('/api/')) {
      try {
        const { checkRateLimitKV, rateLimitedResponse } = await import('./worker/lib/rate-limit-kv');
        const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
        __rlResult = await checkRateLimitKV(env.RATE_LIMITER, clientIp, 'public');
        if (!__rlResult.allowed) {
          return rateLimitedResponse(__rlResult);
        }
      } catch {
        // Fail-open : erreur import/runtime → on laisse passer sans bloquer.
      }
    }

    // ── Routes publiques (pas d'auth) ─────────────────────
    try {
      // OpenAPI & Swagger UI
      if (path === '/api/openapi.json' && method === 'GET') {
        const { generateOpenApiSpec } = await import('./worker/openapi-spec');
        const baseUrl = new URL(request.url).origin;
        return json(generateOpenApiSpec(baseUrl));
      }
      if (path === '/docs/api' && method === 'GET') {
        const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Intralys CRM - API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    body { margin: 0; background: #fafafa; }
    .swagger-ui .topbar { background-color: #164e63; } /* Intralys cyan-900 */
    .swagger-ui .info .title { color: #0891b2; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/api/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
        layout: "BaseLayout",
      });
    };
  </script>
</body>
</html>`;
        return new Response(html, { headers: { 'Content-Type': 'text/html' } });
      }

      // Public API endpoints (requires ApiKey)
      if (path.startsWith('/api/public/v1/')) {
        const { requireApiKey, requireScope } = await import('./worker/api-public-auth');
        const authResult = await requireApiKey(request, env);
        if (authResult instanceof Response) return authResult;

        // On délègue aux handlers existants après vérification du scope
        const subPath = path.replace('/api/public/v1', '');
        
        // --- AUTH & ZAPIER ---
        if (subPath === '/me' && method === 'GET') {
          return json({
            data: {
              client_id: authResult.clientId,
              user_id: authResult.userId,
              scopes: authResult.scopes
            }
          });
        }
        
        // --- LEADS ---
        if (subPath === '/leads' && method === 'GET') {
          const scopeErr = requireScope(authResult, 'read');
          if (scopeErr) return scopeErr;
          const { handleGetLeads } = await import('./worker/leads');
          return await handleGetLeads(env, { userId: authResult.userId, role: 'api', clientId: authResult.clientId } as any, url);
        }
        if (subPath === '/leads' && method === 'POST') {
          const scopeErr = requireScope(authResult, 'write');
          if (scopeErr) return scopeErr;
          const { handleCreateLead } = await import('./worker/leads');
          return await handleCreateLead(request, env, { userId: authResult.userId, role: 'api', clientId: authResult.clientId } as any);
        }
        
        const leadMatch = subPath.match(/^\/leads\/([^/]+)$/);
        if (leadMatch && method === 'GET') {
          const scopeErr = requireScope(authResult, 'read');
          if (scopeErr) return scopeErr;
          const { handleGetLeadDetail } = await import('./worker/leads');
          return await handleGetLeadDetail(env, { userId: authResult.userId, role: 'api', clientId: authResult.clientId } as any, leadMatch[1]!);
        }
        if (leadMatch && method === 'PATCH') {
          const scopeErr = requireScope(authResult, 'write');
          if (scopeErr) return scopeErr;
          const { handlePatchLead } = await import('./worker/leads');
          return await handlePatchLead(request, env, { userId: authResult.userId, role: 'api', clientId: authResult.clientId } as any, leadMatch[1]!);
        }

        const tagsMatch = subPath.match(/^\/leads\/([^/]+)\/tags$/);
        if (tagsMatch && method === 'POST') {
          const scopeErr = requireScope(authResult, 'write');
          if (scopeErr) return scopeErr;
          const { handleAddTag } = await import('./worker/leads');
          return await handleAddTag(request, env, { userId: authResult.userId, role: 'api', clientId: authResult.clientId } as any, tagsMatch[1]!);
        }

        const leadMsgMatch = subPath.match(/^\/leads\/([^/]+)\/messages$/);
        if (leadMsgMatch && method === 'POST') {
          const scopeErr = requireScope(authResult, 'write');
          if (scopeErr) return scopeErr;
          const { handleSendMessage } = await import('./worker/messages');
          return await handleSendMessage(request, env, { userId: authResult.userId, role: 'api', clientId: authResult.clientId } as any, leadMsgMatch[1]!);
        }

        // --- TASKS ---
        if (subPath === '/tasks' && method === 'GET') {
          const scopeErr = requireScope(authResult, 'read');
          if (scopeErr) return scopeErr;
          const { handleGetTasks } = await import('./worker/tasks');
          return await handleGetTasks(env, { userId: authResult.userId, role: 'api', clientId: authResult.clientId } as any, url);
        }
        if (subPath === '/tasks' && method === 'POST') {
          const scopeErr = requireScope(authResult, 'write');
          if (scopeErr) return scopeErr;
          const { handleCreateTask } = await import('./worker/tasks');
          return await handleCreateTask(request, env, { userId: authResult.userId, role: 'api', clientId: authResult.clientId } as any);
        }
        
        // --- APPOINTMENTS ---
        if (subPath === '/appointments' && method === 'GET') {
          const scopeErr = requireScope(authResult, 'read');
          if (scopeErr) return scopeErr;
          const { handleGetAppointments } = await import('./worker/appointments');
          return await handleGetAppointments(env, { userId: authResult.userId, role: 'api', clientId: authResult.clientId } as any, url);
        }
        if (subPath === '/appointments' && method === 'POST') {
          const scopeErr = requireScope(authResult, 'write');
          if (scopeErr) return scopeErr;
          const { handleCreateAppointment } = await import('./worker/appointments');
          return await handleCreateAppointment(request, env, { userId: authResult.userId, role: 'api', clientId: authResult.clientId } as any);
        }
        
        // --- WEBHOOKS (ZAPIER) ---
        if (subPath === '/webhooks' && method === 'POST') {
          const { handlePublicCreateWebhook } = await import('./worker/settings');
          return await handlePublicCreateWebhook(request, env, authResult.clientId);
        }
        const pubWhMatch = subPath.match(/^\/webhooks\/([^/]+)$/);
        if (pubWhMatch && method === 'DELETE') {
          const { handlePublicDeleteWebhook } = await import('./worker/settings');
          return await handlePublicDeleteWebhook(env, authResult.clientId, pubWhMatch[1]!);
        }

        // --- CATALOGUE PUBLIC (storefront futur) — Sprint E2 M1.4 ---
        // Lecture seule produits ACTIFS du tenant de la clé API. Scope read.
        // Gated module ecommerce (le clientId de la clé doit avoir le module).
        if (subPath === '/products' && method === 'GET') {
          const scopeErr = requireScope(authResult, 'read');
          if (scopeErr) return scopeErr;
          const { hasModule } = await import('./worker/modules');
          const client = await env.DB.prepare(
            'SELECT modules_json FROM clients WHERE id = ?',
          ).bind(authResult.clientId).first() as { modules_json: string | null } | null;
          if (!hasModule(client, 'ecommerce')) {
            return json({ error: 'Module Boutique non activé pour ce compte' }, 403);
          }
          const { handlePublicListProducts } = await import('./worker/ecommerce');
          return await handlePublicListProducts(env, authResult.clientId, url);
        }
        const pubProdMatch = subPath.match(/^\/products\/([^/]+)$/);
        if (pubProdMatch && method === 'GET') {
          const scopeErr = requireScope(authResult, 'read');
          if (scopeErr) return scopeErr;
          const { hasModule } = await import('./worker/modules');
          const client = await env.DB.prepare(
            'SELECT modules_json FROM clients WHERE id = ?',
          ).bind(authResult.clientId).first() as { modules_json: string | null } | null;
          if (!hasModule(client, 'ecommerce')) {
            return json({ error: 'Module Boutique non activé pour ce compte' }, 403);
          }
          const { handlePublicGetProduct } = await import('./worker/ecommerce');
          return await handlePublicGetProduct(env, authResult.clientId, pubProdMatch[1]!);
        }

        return new Response('Not Found in Public API', { status: 404 });
      }

      if (path === '/api/health' && method === 'GET') {
        const uptime = Math.floor((Date.now() - START_TIME) / 1000);
        const { handleHealth } = await import('./worker/health');
        return await handleHealth(env, uptime);
      }

      // Sprint S9 M1 — Beacon Web Vitals (non authentifié, best-effort, jamais bloquant).
      if (path === '/api/telemetry/web-vitals' && method === 'POST') {
        const { handlePostWebVitals } = await import('./worker/telemetry');
        // Sprint 25 — Perf : passe ctx pour ctx.waitUntil(logPerfBudget). Le
        // handler reste 100% best-effort/204 quoi qu'il arrive.
        return await handlePostWebVitals(request, env, ctx);
      }

      // ── LOT SMS/WHATSAPP seq 104 — webhook SMS inbound signé Twilio ─────────
      //   Validation X-Twilio-Signature EN AMONT de handleInboundSms (FLAG
      //   INACTIF : sans TWILIO_AUTH_TOKEN → verifyTwilioSignature bypass=true,
      //   mode mock préservé). CONVENTION BODY (cf. §6.E) : le body
      //   form-urlencoded est lu UNE SEULE FOIS ici (request.clone() →
      //   formData), converti en params {key:value} pour le vérificateur ;
      //   handleInboundSms relit le body sur la requête ORIGINALE (signature
      //   handleInboundSms INCHANGÉE — il consomme `request`, on lui passe la
      //   requête d'origine intacte ; seul le clone est consommé pour la vérif).
      if (path === '/api/webhook/sms' && method === 'POST') {
        const { verifyTwilioSignature } = await import('./worker/twilio-verify');
        const params: Record<string, string> = {};
        try {
          const fd = await request.clone().formData();
          for (const [k, v] of fd.entries()) params[k] = typeof v === 'string' ? v : '';
        } catch {
          // corps illisible : params vides — la vérif échouera si un token est
          // présent (rejet 403), bypass si flag inactif.
        }
        const valid = await verifyTwilioSignature(request, env, params);
        // Rejet UNIQUEMENT si un token est configuré ET la signature invalide.
        if (!valid && env.TWILIO_AUTH_TOKEN) return new Response('Forbidden', { status: 403 });
        return await handleInboundSms(request, env);
      }
      // Delivery receipt SMS (Twilio status-callback) — PUBLIC.
      if (path === '/api/webhook/sms/status' && method === 'POST') {
        const { handleSmsStatusCallback } = await import('./worker/messages');
        return await handleSmsStatusCallback(request, env);
      }
      // WhatsApp webhook Meta — GET (verify token) + POST (inbound) — PUBLIC.
      if (path === '/api/webhook/whatsapp' && (method === 'GET' || method === 'POST')) {
        const { handleWhatsAppWebhook } = await import('./worker/whatsapp');
        return await handleWhatsAppWebhook(request, env);
      }
      if (path === '/api/webhook/email' && method === 'POST') return await handleInboundEmail(request, env);
      if (path === '/api/webhook/meta' && (method === 'GET' || method === 'POST')) {
        const { handleMetaWebhook } = await import('./worker/meta');
        return await handleMetaWebhook(request, env);
      }
      if (path === '/api/webhook/lead' && method === 'POST') return await handleWebhookLead(request, env);
      // Sprint 51 M2 — Connecteur entrant générique par token (+ dry-run via ?dryRun=1)
      const ingestMatch = path.match(/^\/api\/ingest\/([^/]+)$/);
      if (ingestMatch && method === 'POST') {
        const { handleIngestByToken } = await import('./worker/leads');
        return await handleIngestByToken(request, env, ingestMatch[1]!, url);
      }
      // Sprint 51 M1.3 — Receiver Google Lead Form (auth via google_key dans le payload)
      if (path === '/api/webhook/google-leadform' && method === 'POST') {
        const { handleGoogleLeadForm } = await import('./worker/meta-leadgen');
        return await handleGoogleLeadForm(request, env);
      }
      // ── LOT BOOKING — endpoints PUBLICS (pré-requireAuth). Slug tenant
      //    résolu côté handler (calque /api/p/:slug funnels). Sous-routes
      //    spécifiques AVANT le GET générique /api/book/ (sinon shadowing).
      //    Corps réels Phase B Manager-B (booking-public.ts).
      const bookMetaMatch = path.match(/^\/api\/book\/([^/]+)\/meta$/);
      if (bookMetaMatch && method === 'GET') return await handleGetPublicBookingMeta(env, url, bookMetaMatch[1]!);
      const bookAvailMatch = path.match(/^\/api\/book\/([^/]+)\/availability$/);
      if (bookAvailMatch && method === 'GET') return await handleGetBookingAvailability(env, url, bookAvailMatch[1]!);
      const bookCancelMatch = path.match(/^\/api\/book\/([^/]+)\/cancel$/);
      if (bookCancelMatch && method === 'POST') return await handlePublicCancelBooking(request, env, bookCancelMatch[1]!);
      const bookReschedMatch = path.match(/^\/api\/book\/([^/]+)\/reschedule$/);
      if (bookReschedMatch && method === 'POST') return await handlePublicRescheduleBooking(request, env, bookReschedMatch[1]!);
      const bookCreateV2Match = path.match(/^\/api\/book\/([^/]+)$/);
      if (bookCreateV2Match && method === 'POST') return await handlePublicCreateBookingV2(request, env, bookCreateV2Match[1]!);
      if (path.startsWith('/api/book/') && method === 'GET') return await handlePublicBookingPage(env, url);
      if (path === '/api/book' && method === 'POST') return await handlePublicCreateBooking(request, env);
      // ── LOT FORMS XL (Sprint 5) — endpoints PUBLICS (pré-requireAuth).
      //    Câblés AVANT le matcher GET générique `/api/form/` et AVANT
      //    `/api/form/submit` (exact). Slug → form_id résolu ICI (handler
      //    handleTrackFormView attend un form_id, signature EXISTANTE inchangée).
      //    view-tracking = dette critique (handleTrackFormView jamais routé →
      //    total_views=0 → conversion fausse). Voir docs/LOT-FORMS-XL.md §6.E.
      const formViewMatch = path.match(/^\/api\/form\/([^/]+)\/view$/);
      if (formViewMatch && method === 'POST') {
        const f = await env.DB.prepare('SELECT id FROM forms WHERE slug = ? AND is_active = 1')
          .bind(formViewMatch[1]!).first() as { id: string } | null;
        if (!f) return new Response(JSON.stringify({ error: 'Formulaire non trouvé' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        return await handleTrackFormView(request, env, f.id);
      }
      const formFieldEventMatch = path.match(/^\/api\/form\/([^/]+)\/field-event$/);
      if (formFieldEventMatch && method === 'POST') return await handleLogFormFieldEvent(request, env, formFieldEventMatch[1]!);
      if (path.startsWith('/api/form/') && method === 'GET') return await handlePublicFormGet(env, url);
      if (path === '/api/form/submit' && method === 'POST') return await handlePublicFormSubmit(request, env);
      // ── LOT FUNNEL — endpoints PUBLICS (pré-requireAuth). Slug tenant
      //    résolu côté handler depuis funnel_publications (calque /api/form/).
      const funnelPubSubmit = path.match(/^\/api\/p\/([^/]+)\/submit$/);
      if (funnelPubSubmit && method === 'POST') return await handlePublicFunnelSubmit(request, env, funnelPubSubmit[1]!);
      const funnelPubTrack = path.match(/^\/api\/p\/([^/]+)\/track$/);
      if (funnelPubTrack && method === 'POST') return await handleTrackFunnelEvent(request, env, funnelPubTrack[1]!);
      const funnelPubGet = path.match(/^\/api\/p\/([^/]+)$/);
      if (funnelPubGet && method === 'GET') return await handlePublicFunnelGet(env, url);
      const funnelPubCheckout = path.match(/^\/api\/p\/([^/]+)\/checkout$/);
      if (funnelPubCheckout && method === 'POST') return await handleFunnelCheckout(request, env, funnelPubCheckout[1]!);
      const funnelPubUpsell = path.match(/^\/api\/p\/([^/]+)\/upsell$/);
      if (funnelPubUpsell && method === 'POST') return await handleFunnelUpsell(request, env, funnelPubUpsell[1]!);

      // ── Sprint 44 Funnels Builder — endpoints PUBLICS (pré-requireAuth) ────
      //    Tables fb_* seq139 (distinctes seq83 funnels). Visitor anonyme
      //    (cookie 1st-party `_intralys_fid`). Anti-bot rate-limit + honeypot
      //    appliqués via patterns Sprint 5 (/api/form/*) côté handler. Ordre
      //    anti-shadowing : track-view + track-conversion (collections) AVANT
      //    /:slug/render (paramétrique). Voir docs/LOT-FUNNELS-S44.md §3.
      if (path === '/api/public/funnels/track-view' && method === 'POST') {
        const m = await import('./worker/funnels-builder');
        return m.handlePublicTrackView(request, env);
      }
      if (path === '/api/public/funnels/track-conversion' && method === 'POST') {
        const m = await import('./worker/funnels-builder');
        return m.handlePublicTrackConversion(request, env);
      }
      const fbPublicRenderMatch = path.match(/^\/api\/public\/funnels\/([^/]+)\/render$/);
      if (fbPublicRenderMatch && method === 'GET') {
        const m = await import('./worker/funnels-builder');
        return m.handlePublicRenderStep(request, env, fbPublicRenderMatch[1]!);
      }

      // ── LOT SITE BUILDER — endpoints PUBLICS (pré-requireAuth). Slug tenant
      //    résolu côté handler depuis site_publications (calque /api/p/:slug
      //    funnels). ⚠ /:slug/:page (page interne) AVANT /:slug (accueil) —
      //    anti-shadowing. Corps réels Phase B Manager-B (sites.ts).
      // Submit d'un form de page de site → pipeline forms.ts (source='site').
      // AVANT le match /:slug/:page (POST, donc pas de shadow du GET, mais explicite).
      const sitePubSubmit = path.match(/^\/api\/site\/([^/]+)\/submit$/);
      if (sitePubSubmit && method === 'POST') return await handlePublicSiteSubmit(request, env, sitePubSubmit[1]!);
      const sitePubPageGet = path.match(/^\/api\/site\/([^/]+)\/([^/]+)$/);
      if (sitePubPageGet && method === 'GET') return await handlePublicSitePageGet(env, url);
      const sitePubGet = path.match(/^\/api\/site\/([^/]+)$/);
      if (sitePubGet && method === 'GET') return await handlePublicSiteGet(env, url);

      // ── LOT STOREFRONT CHECKOUT (Sprint 7) — tunnel acheteur PUBLIC
      //    (pré-requireAuth). Slug tenant résolu côté handler via
      //    resolveStoreClientId (clients.store_slug → client_id ; calque
      //    /api/p/:slug funnels & /api/book/:slug booking). AUCUNE auth :
      //    visiteur anonyme, panier par token. Sous-routes SPÉCIFIQUES AVANT les
      //    génériques (sinon shadowing : /products/:pslug avant /products,
      //    /cart/:itemId avant /cart). Corps réels Phase B Manager-B
      //    (storefront-public.ts). Paiement MOCK impératif (E4/E6 inactif).
      const storeProductMatch = path.match(/^\/api\/store\/([^/]+)\/products\/([^/]+)$/);
      if (storeProductMatch && method === 'GET') return await handleStoreProduct(env, storeProductMatch[1]!, storeProductMatch[2]!, url);
      const storeProductsMatch = path.match(/^\/api\/store\/([^/]+)\/products$/);
      if (storeProductsMatch && method === 'GET') return await handleStoreProducts(env, storeProductsMatch[1]!, url);
      const storeCartItemMatch = path.match(/^\/api\/store\/([^/]+)\/cart\/([^/]+)$/);
      if (storeCartItemMatch && method === 'PATCH') return await handleStoreUpdateCartItem(request, env, storeCartItemMatch[1]!, storeCartItemMatch[2]!);
      if (storeCartItemMatch && method === 'DELETE') return await handleStoreDeleteCartItem(env, storeCartItemMatch[1]!, storeCartItemMatch[2]!, url);
      const storeCartMatch = path.match(/^\/api\/store\/([^/]+)\/cart$/);
      if (storeCartMatch && method === 'GET') return await handleStoreGetCart(env, storeCartMatch[1]!, url);
      if (storeCartMatch && method === 'POST') return await handleStoreAddCartItem(request, env, storeCartMatch[1]!);
      const storeShipMatch = path.match(/^\/api\/store\/([^/]+)\/shipping-quote$/);
      if (storeShipMatch && method === 'POST') return await handleStoreShippingQuote(request, env, storeShipMatch[1]!);
      const storeCheckoutMatch = path.match(/^\/api\/store\/([^/]+)\/checkout$/);
      if (storeCheckoutMatch && method === 'POST') return await handleStoreCheckout(request, env, storeCheckoutMatch[1]!);
      const storeOrderMatch = path.match(/^\/api\/store\/([^/]+)\/order\/([^/]+)$/);
      if (storeOrderMatch && method === 'GET') return await handleStoreGetOrder(env, storeOrderMatch[1]!, storeOrderMatch[2]!);

      // ── LOT REPUTATION (Sprint 8) — page PUBLIQUE de dépôt d'avis 1st-party
      //    (pré-requireAuth). Invitation résolue côté handler par TOKEN via
      //    resolveInvitationToken (review_invitations.token ; calque /api/form/:slug
      //    & /api/p/:slug). AUCUNE auth : déposant anonyme. Sous-route SPÉCIFIQUE
      //    /submit AVANT le GET générique /api/r/:token (anti-shadowing). Corps
      //    réels Phase B Manager-B (reputation-public.ts) — routing intelligent
      //    (note ≥ seuil → redirige Google/FB ; note < seuil → feedback privé).
      const reviewSubmitMatch = path.match(/^\/api\/r\/([^/]+)\/submit$/);
      if (reviewSubmitMatch && method === 'POST') return await handlePublicSubmitReview(request, env, reviewSubmitMatch[1]!);
      const reviewPageMatch = path.match(/^\/api\/r\/([^/]+)$/);
      if (reviewPageMatch && method === 'GET') return await handlePublicGetReviewPage(env, reviewPageMatch[1]!);

      // ── LOT G7 MARKETPLACE — endpoints PUBLICS (pré-requireAuth). Catalogue
      //    cross-tenant en LECTURE SEULE (content_json déjà strippé au publish —
      //    FLAG #1). Sous-route /:id AVANT… (ici une seule, pas de shadowing :
      //    /listings exact vs /listings/:id). Corps réels Phase B Manager-B.
      if (path === '/api/marketplace/listings' && method === 'GET') return await handleGetMarketplaceListings(env, url);
      const mktListingPubMatch = path.match(/^\/api\/marketplace\/listings\/([^/]+)$/);
      if (mktListingPubMatch && method === 'GET') return await handleGetMarketplaceListing(env, mktListingPubMatch[1]!);

      // ── LOT G1 HELPDESK — endpoints PUBLICS (pré-requireAuth). Tenant résolu
      //    côté handler par slug (calque /api/form/ + /api/public/funnels).
      //    Visiteur anonyme : aucun auth. Corps réels Phase B Manager-B.
      if (path === '/api/public/tickets' && method === 'POST') return await handlePublicSubmitTicket(request, env);
      const kbPubGet = path.match(/^\/api\/public\/kb\/([^/]+)$/);
      if (kbPubGet && method === 'GET') return await handlePublicGetKBArticle(env, kbPubGet[1]!);

      // ── Sprint 38 — Gift cards balance PUBLIC (pré-requireAuth) ──────────
      // Une seule route publique : lookup solde par code (visiteur anonyme).
      // Rate-limit hérité du choke-point amont. Corps réel Phase B Manager-B.
      const gcBalanceMatch = path.match(/^\/api\/public\/gift-cards\/([^/]+)\/balance$/);
      if (gcBalanceMatch && method === 'GET') {
        const m = await import('./worker/gift-cards');
        return m.handleGetBalanceByCode(env, request, gcBalanceMatch[1]!);
      }

      // ── Sprint 48 — Pre-order waitlist join PUBLIC (pré-requireAuth) ─────
      // Visiteur anonyme dépose son email pour être notifié quand un variant
      // restocké est disponible. Rate-limit `preorder_join:<ip>` 5/300s +
      // honeypot champ `website` HANDLER (calque /api/public/tickets +
      // /api/r/:token/submit). Corps fonctionnel Phase A (insert preorder_queue
      // status='queued'). Voir docs/LOT-B2B-BUNDLES-PREORDERS-S48.md §6.
      if (path === '/api/public/preorders' && method === 'POST') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handlePublicCreatePreorder(request, env);
      }

      // ── Sprint 49 — Affiliate signup + track-click PUBLIC (pré-requireAuth)
      // Programme parrainage v2 — extension du module affiliation S(G2). Deux
      // endpoints PUBLIC :
      //   - POST /api/public/affiliates/signup      → visitor opt-in (rate-limit
      //                                                `aff_signup:<ip>` 3/3600s
      //                                                + honeypot `website`).
      //                                                Phase A 501 (Phase B
      //                                                Manager-B câblera).
      //   - POST /api/public/affiliates/track-click → log clic sur lien
      //                                                d'affiliation (rate-limit
      //                                                `aff_click:<ip>` 60/60s
      //                                                + honeypot). PII Loi 25 :
      //                                                ip_hash + UA_hash
      //                                                (SHA256 HANDLER).
      // Voir docs/LOT-AFFILIATES-S49.md §6.
      if (path === '/api/public/affiliates/signup' && method === 'POST') {
        const m = await import('./worker/affiliates');
        return m.handlePublicAffiliateSignup(request, env);
      }
      if (path === '/api/public/affiliates/track-click' && method === 'POST') {
        const m = await import('./worker/affiliates');
        return m.handlePublicTrackClick(request, env);
      }

      // ── Sprint 50 — Surveys avancés PUBLIC submit (pré-requireAuth) ──────
      //    1 route publique (visitor répond au questionnaire) :
      //      - POST /api/public/surveys/:id/submit
      //          rate-limit `survey_submit:<ip>` 10/3600s (calque
      //          /api/public/affiliates/track-click + /api/public/preorders) +
      //          honeypot champ `website` HANDLER + PII Loi 25 (ip_hash SHA256,
      //          pas brut). Le payload supporte partial=true (multi-pages
      //          accumule answers, status='in_progress') vs partial=false
      //          (finalize, status='completed', completed_at=now, déclenche
      //          éventuelle agrégation NPS Phase B).
      // Voir docs/LOT-SURVEYS-DNS-S50.md §6.
      const publicSurveySubmitMatch = path.match(/^\/api\/public\/surveys\/([^/]+)\/submit$/);
      if (publicSurveySubmitMatch && method === 'POST') {
        const m = await import('./worker/surveys');
        return m.handlePublicSubmitSurvey(request, env, publicSurveySubmitMatch[1]!);
      }

      // ── Sprint 78 — Lead Scoring Comportemental v2 (public track) ──
      if (path === '/api/public/track' && method === 'POST') {
        const { handleTrackBehavioralEvent } = await import('./worker/behavioral');
        return await handleTrackBehavioralEvent(request, env);
      }

      // ── Sprint 40 — Product Reviews PUBLIC + Recovery Landing PUBLIC ──────
      // 4 routes publiques (pré-requireAuth) :
      //   - GET  /api/products/:id/reviews        → list approved reviews (anti-bot
      //                                              optional via rate-limit amont).
      //   - POST /api/products/:id/reviews        → submit avis (honeypot +
      //                                              rate-limit + verified_buyer
      //                                              fast-track auto-approve).
      //   - POST /api/reviews/:id/helpful         → vote utile (IP-hash anti-rejeu).
      //   - GET  /api/recovery/:cartToken/:step   → landing page panier + coupon
      //                                              (jeton HMAC signé côté handler).
      // NE TOUCHE PAS `reviews.ts` (Sprint 9 — flux invitations Google/FB séparé).
      const productReviewListMatch = path.match(/^\/api\/products\/([^/]+)\/reviews$/);
      if (productReviewListMatch && method === 'GET') {
        const m = await import('./worker/product-reviews');
        return m.handleListProductReviews(request, env, productReviewListMatch[1]!, url);
      }
      if (productReviewListMatch && method === 'POST') {
        const m = await import('./worker/product-reviews');
        return m.handleSubmitProductReview(request, env, productReviewListMatch[1]!);
      }
      const reviewHelpfulMatch = path.match(/^\/api\/reviews\/([^/]+)\/helpful$/);
      if (reviewHelpfulMatch && method === 'POST') {
        const m = await import('./worker/product-reviews');
        return m.handleVoteHelpful(request, env, reviewHelpfulMatch[1]!);
      }
      const recoveryLandingMatch = path.match(/^\/api\/recovery\/([^/]+)\/([^/]+)$/);
      if (recoveryLandingMatch && method === 'GET') {
        const m = await import('./worker/abandoned-carts');
        return m.handleRecoveryLandingPage(request, env, recoveryLandingMatch[1]!, recoveryLandingMatch[2]!);
      }

      // ── LOT MEMBERSHIPS — endpoints PUBLICS espace membre (pré-requireAuth).
      //    Auth membre 100% SÉPARÉE : member-auth.ts:requireMember lit
      //    member_sessions UNIQUEMENT (JAMAIS admin_sessions/users). Tenant
      //    résolu côté handler via membership_sites.slug (calque /api/p/:slug
      //    funnels). Sous-routes spécifiques AVANT les génériques (sinon
      //    shadowing). Corps réels Phase B Manager-B (member-auth.ts /
      //    memberships.ts).
      const memRegMatch = path.match(/^\/api\/member\/([^/]+)\/register$/);
      if (memRegMatch && method === 'POST') return await handleMemberRegister(request, env, memRegMatch[1]!);
      const memLoginMatch = path.match(/^\/api\/member\/([^/]+)\/login$/);
      if (memLoginMatch && method === 'POST') return await handleMemberLogin(request, env, memLoginMatch[1]!);
      const memLogoutMatch = path.match(/^\/api\/member\/([^/]+)\/logout$/);
      if (memLogoutMatch && method === 'POST') return await handleMemberLogout(request, env, memLogoutMatch[1]!);
      // Espace membre AUTHENTIFIÉ (member_sessions) : requireMember en amont,
      // contexte membre injecté au handler (calque WS token / requireApiKey).
      const memVideoMatch = path.match(/^\/api\/member\/lessons\/([^/]+)\/video$/);
      if (memVideoMatch && method === 'GET') {
        const m = await requireMember(request, env);
        if (m instanceof Response) return m;
        return await handleMemberLessonVideo(request, env, memVideoMatch[1]!, m);
      }
      const memLessonMatch = path.match(/^\/api\/member\/lessons\/([^/]+)$/);
      if (memLessonMatch && method === 'GET') {
        const m = await requireMember(request, env);
        if (m instanceof Response) return m;
        return await handleMemberLesson(request, env, memLessonMatch[1]!, m);
      }
      // LOT MEMBERSHIP ENROLL — sous-routes /courses/:courseId/* (4+ segments)
      // AVANT le générique /courses (3 segments) sinon shadowing. Corps réels
      // Phase B Manager-B (memberships.ts).
      const memEnrollMatch = path.match(/^\/api\/member\/([^/]+)\/courses\/([^/]+)\/enroll$/);
      if (memEnrollMatch && method === 'POST') {
        const m = await requireMember(request, env);
        if (m instanceof Response) return m;
        return await handleMemberEnroll(request, env, memEnrollMatch[1]!, memEnrollMatch[2]!, m);
      }
      const memCourseDetailMatch = path.match(/^\/api\/member\/([^/]+)\/courses\/([^/]+)$/);
      if (memCourseDetailMatch && method === 'GET') {
        const m = await requireMember(request, env);
        if (m instanceof Response) return m;
        return await handleMemberCourseDetail(request, env, memCourseDetailMatch[1]!, memCourseDetailMatch[2]!, m);
      }
      const memCoursesMatch = path.match(/^\/api\/member\/([^/]+)\/courses$/);
      if (memCoursesMatch && method === 'GET') {
        const m = await requireMember(request, env);
        if (m instanceof Response) return m;
        return await handleMemberCourses(request, env, memCoursesMatch[1]!, m);
      }
      if (path === '/api/member/progress' && method === 'POST') {
        const m = await requireMember(request, env);
        if (m instanceof Response) return m;
        return await handleMemberProgress(request, env, m);
      }

      // ── LOT G10 COMMUNAUTÉ — espace social membre AUTHENTIFIÉ (requireMember
      //    en amont, contexte membre injecté au handler — auth membre 100%
      //    SÉPARÉE). Isolation cross-site bornée client_id == member.clientId
      //    DANS le handler (écriture + re-borne routes par ID — FLAG #1). Corps
      //    réels Phase B Manager-B (community.ts). Sous-routes spécifiques (par
      //    id GLOBAL sans slug : posts/:pid, comments/:cid) AVANT les
      //    génériques (anti-shadowing).
      const memThreadPostsMatch = path.match(/^\/api\/member\/([^/]+)\/community\/threads\/([^/]+)\/posts$/);
      if (memThreadPostsMatch && method === 'GET') {
        const m = await requireMember(request, env);
        if (m instanceof Response) return m;
        return await handleListThreadPosts(request, env, memThreadPostsMatch[1]!, memThreadPostsMatch[2]!, m);
      }
      if (memThreadPostsMatch && method === 'POST') {
        const m = await requireMember(request, env);
        if (m instanceof Response) return m;
        return await handleCreatePost(request, env, memThreadPostsMatch[1]!, memThreadPostsMatch[2]!, m);
      }
      const memThreadsMatch = path.match(/^\/api\/member\/([^/]+)\/community\/threads$/);
      if (memThreadsMatch && method === 'GET') {
        const m = await requireMember(request, env);
        if (m instanceof Response) return m;
        return await handleListThreads(request, env, memThreadsMatch[1]!, m);
      }
      if (memThreadsMatch && method === 'POST') {
        const m = await requireMember(request, env);
        if (m instanceof Response) return m;
        return await handleCreateThread(request, env, memThreadsMatch[1]!, m);
      }
      const memDelPostMatch = path.match(/^\/api\/member\/community\/posts\/([^/]+)$/);
      if (memDelPostMatch && method === 'DELETE') {
        const m = await requireMember(request, env);
        if (m instanceof Response) return m;
        return await handleDeleteOwnPost(request, env, memDelPostMatch[1]!, m);
      }
      const memDelCommentMatch = path.match(/^\/api\/member\/community\/comments\/([^/]+)$/);
      if (memDelCommentMatch && method === 'DELETE') {
        const m = await requireMember(request, env);
        if (m instanceof Response) return m;
        return await handleDeleteOwnComment(request, env, memDelCommentMatch[1]!, m);
      }
      const memLessonCommentsMatch = path.match(/^\/api\/member\/lessons\/([^/]+)\/comments$/);
      if (memLessonCommentsMatch && method === 'GET') {
        const m = await requireMember(request, env);
        if (m instanceof Response) return m;
        return await handleListLessonComments(request, env, memLessonCommentsMatch[1]!, m);
      }
      if (memLessonCommentsMatch && method === 'POST') {
        const m = await requireMember(request, env);
        if (m instanceof Response) return m;
        return await handleCreateLessonComment(request, env, memLessonCommentsMatch[1]!, m);
      }

      // ── LOT PORTAL-E — PORTAIL CLIENT. Endpoints PUBLICS auth (pré-requireAuth) :
      //    portal-auth.ts:handlePortalLogin/SetPassword/Logout. Tenant résolu côté
      //    handler via portal_sites.slug. Endpoints AUTHENTIFIÉS (portal_sessions) :
      //    requirePortalUser EN AMONT, PortalContext { portalUserId, leadId, clientId,
      //    agencyId } injecté au handler — ISOLATION DOUBLE lead_id+client_id (Phase B).
      //    Auth 100% SÉPARÉE (portal_sessions UNIQUEMENT, token distinct). Sous-routes
      //    AUTH spécifiques (login/set-password/logout) AVANT les agrégateurs
      //    génériques (anti-shadowing). Facture LECTURE SEULE (E4 jamais).
      const portalLoginMatch = path.match(/^\/api\/portal\/([^/]+)\/login$/);
      if (portalLoginMatch && method === 'POST') return await handlePortalLogin(request, env, portalLoginMatch[1]!);
      const portalSetPwMatch = path.match(/^\/api\/portal\/([^/]+)\/set-password$/);
      if (portalSetPwMatch && method === 'POST') return await handlePortalSetPassword(request, env, portalSetPwMatch[1]!);
      const portalLogoutMatch = path.match(/^\/api\/portal\/([^/]+)\/logout$/);
      if (portalLogoutMatch && method === 'POST') return await handlePortalLogout(request, env, portalLogoutMatch[1]!);
      // Agrégateurs AUTHENTIFIÉS — requirePortalUser en amont, contexte portail injecté.
      const portalInvoicesMatch = path.match(/^\/api\/portal\/([^/]+)\/invoices$/);
      if (portalInvoicesMatch && method === 'GET') {
        const p = await requirePortalUser(request, env);
        if (p instanceof Response) return p;
        return await handlePortalInvoices(request, env, portalInvoicesMatch[1]!, p);
      }
      const portalQuotesMatch = path.match(/^\/api\/portal\/([^/]+)\/quotes$/);
      if (portalQuotesMatch && method === 'GET') {
        const p = await requirePortalUser(request, env);
        if (p instanceof Response) return p;
        return await handlePortalQuotes(request, env, portalQuotesMatch[1]!, p);
      }
      const portalApptMatch = path.match(/^\/api\/portal\/([^/]+)\/appointments$/);
      if (portalApptMatch && method === 'GET') {
        const p = await requirePortalUser(request, env);
        if (p instanceof Response) return p;
        return await handlePortalAppointments(request, env, portalApptMatch[1]!, p);
      }
      const portalDocsMatch = path.match(/^\/api\/portal\/([^/]+)\/documents$/);
      if (portalDocsMatch && method === 'GET') {
        const p = await requirePortalUser(request, env);
        if (p instanceof Response) return p;
        return await handlePortalDocuments(request, env, portalDocsMatch[1]!, p);
      }
      const portalTicketsMatch = path.match(/^\/api\/portal\/([^/]+)\/tickets$/);
      if (portalTicketsMatch && method === 'GET') {
        const p = await requirePortalUser(request, env);
        if (p instanceof Response) return p;
        return await handlePortalTickets(request, env, portalTicketsMatch[1]!, p);
      }
      if (portalTicketsMatch && method === 'POST') {
        const p = await requirePortalUser(request, env);
        if (p instanceof Response) return p;
        return await handlePortalCreateTicket(request, env, portalTicketsMatch[1]!, p);
      }

      // Trigger Links Public Redirect
      const linkMatch = path.match(/^\/l\/([^/]+)$/);
      if (linkMatch && method === 'GET') return await handleTriggerLinkClick(request, env, linkMatch[1]!);

      // ── LOT G2 AFFILIATION — redirect public d'affiliation (calque /l/:id).
      //    DISTINCT de /l/:id (trigger-links). Anonyme : résout code → programme,
      //    set cookie aff_attr, log clic, 302 vers target_url. Corps réel Phase B.
      const affRedirectMatch = path.match(/^\/r\/([^/]+)$/);
      if (affRedirectMatch && method === 'GET') return await handleAffiliateRedirect(request, env, affRedirectMatch[1]!);
      if (path === '/api/widget.js' && method === 'GET') return await handleWidgetScript(env, url);
      const unsubMatch = path.match(/^\/api\/unsubscribe\/(.+)$/);
      if (unsubMatch && method === 'GET') return await handlePublicUnsubscribe(env, unsubMatch[1]!);
      // Documents — signature publique
      // ── Sprint 17 PROPOSALS E-SIGN — refus public (hors auth, calque /sign).
      //    Path EXACT /decline déclaré AVANT le /api/sign/:token générique
      //    (anti-shadowing : le générique [^/]+ + $ ne matche pas /decline,
      //    mais on le pose AVANT par sûreté). Corps réel Phase B (documents.ts).
      const signDeclineMatch = path.match(/^\/api\/sign\/([^/]+)\/decline$/);
      if (signDeclineMatch && method === 'POST') {
        const { handlePublicDeclineDocument } = await import('./worker/documents');
        return await handlePublicDeclineDocument(request, env, signDeclineMatch[1]!);
      }
      const signMatch = path.match(/^\/api\/sign\/([^/]+)$/);
      if (signMatch && method === 'GET') return await handlePublicGetDocument(env, signMatch[1]!);
      if (signMatch && method === 'POST') return await handlePublicSignDocument(request, env, signMatch[1]!);
      // Sprint 46 M1.3 — Dashboards partagés (token public)
      const sharedDashMatch = path.match(/^\/api\/dashboards\/shared\/([A-Za-z0-9_-]{8,64})$/);
      // LOT D Phase B Manager-B : passage du `request` pour audit IP/UA
      // (3e arg OPTIONNEL — rétro-compat byte-équivalente avec la signature
      // 2-args historique Sprint 46 M1.3 ; aucune route additionnelle).
      if (sharedDashMatch && method === 'GET') return await handleGetSharedDashboard(env, sharedDashMatch[1]!, request);
      // Voice
      const { handleVoiceTwiml, handleVoiceRecording } = await import('./worker/voice');
      if (path === '/api/voice/twiml' && method === 'POST') return await handleVoiceTwiml(request, env);
      if (path === '/api/voice/webhook/record' && method === 'POST') return await handleVoiceRecording(request, env);
      // ── LOT TELEPHONY-F — webhooks Twilio PUBLICS (anti-collision avec les
      //    2 routes voicemail ci-dessus ; module telephony.ts NEUF, voice.ts
      //    intouché). IVR TwiML (Say/Gather depuis ivr_menus) + status-callback
      //    (MAJ call_logs.status/duration depuis Twilio). ──────────────────────
      const ivrTwimlMatch = path.match(/^\/api\/voice\/ivr\/([^/]+)$/);
      if (ivrTwimlMatch && (method === 'GET' || method === 'POST')) {
        const { handleVoiceIvrTwiml } = await import('./worker/telephony');
        return await handleVoiceIvrTwiml(request, env);
      }
      if (path === '/api/voice/status-callback' && method === 'POST') {
        const { handleCallStatusCallback } = await import('./worker/telephony');
        return await handleCallStatusCallback(request, env);
      }

      // ── Sprint 34 (seq 129) — Twilio Voice TwiML PUBLICS ────────────────────
      //   4 webhooks PUBLICS Twilio (signature vérifiée DANS handlers via
      //   verifyTwilioSignature — twilio-verify.ts). Câblés sur les handlers
      //   stubs implémentés par agents A2/A3/A4 Phase B (twilio-twiml.ts).
      //   Distincts des routes voice.ts (voicemail entrant prod) + telephony.ts
      //   (IVR + status-callback existants) : ces routes ajoutent le routing
      //   TwiML inbound + voicemail enrichi consent CRTC + callbacks recording
      //   + transcription.
      if (path === '/api/twilio/twiml/voice' && method === 'POST') {
        const m = await import('./worker/twilio-twiml');
        return m.handleTwilioVoiceTwiml(request, env);
      }
      if (path === '/api/twilio/twiml/voicemail' && method === 'POST') {
        const m = await import('./worker/twilio-twiml');
        return m.handleTwilioVoicemailTwiml(request, env);
      }
      if (path === '/api/twilio/twiml/recording-status' && method === 'POST') {
        const m = await import('./worker/twilio-twiml');
        return m.handleTwilioRecordingStatusCallback(request, env, ctx);
      }
      if (path === '/api/twilio/twiml/transcription-callback' && method === 'POST') {
        const m = await import('./worker/twilio-twiml');
        return m.handleTwilioTranscriptionCallback(request, env);
      }

      // ── Sprint 41 (seq 136) — Voice Agent IVR PUBLICS Twilio ─────────────
      //   3 webhooks PUBLICS Twilio (signature vérifiée DANS handlers via
      //   verifyTwilioVoiceSignature — voice-agent-engine.ts). Routing IVR
      //   AI : incoming → menu (Gather DTMF/speech) → input (intent detect) →
      //   escalation (dial human OU voicemail). State machine in-memory.
      //   Bornage tenant via incoming phone number → call_logs.to_number.
      if (path === '/api/voice-agent/twilio/incoming' && method === 'POST') {
        const m = await import('./worker/voice-agent');
        return m.handleVoiceAgentIncoming(request, env);
      }
      if (path === '/api/voice-agent/twilio/gather' && method === 'POST') {
        const m = await import('./worker/voice-agent');
        return m.handleVoiceAgentGather(request, env);
      }
      if (path === '/api/voice-agent/twilio/escalate' && method === 'POST') {
        const m = await import('./worker/voice-agent');
        return m.handleVoiceAgentEscalate(request, env);
      }

      // Meta webhook public (oauth start/callback sont dans routeProtected lignes ~728)
      if (path === '/api/meta/webhook') {
        const { handleMetaWebhook } = await import('./worker/meta');
        return await handleMetaWebhook(request, env);
      }
      
      // Tracking (P3.5 & Sprint 4)
      if (path === '/api/track/conversion' && method === 'POST') {
        const { handleTrackConversion } = await import('./worker/tracking');
        return await handleTrackConversion(request, env);
      }
      const trackOpenMatch = path.match(/^\/api\/t\/o\/([^/]+)$/);
      if (trackOpenMatch && method === 'GET') {
        const { handleTrackOpen } = await import('./worker/tracking');
        return await handleTrackOpen(env, trackOpenMatch[1]!, request);
      }
      const trackClickMatch = path.match(/^\/api\/t\/c\/([^/]+)$/);
      if (trackClickMatch && method === 'GET') {
        const { handleTrackClick } = await import('./worker/tracking');
        return await handleTrackClick(env, trackClickMatch[1]!, request);
      }

      // Billing & Invoicing (P3.8)
      if (path === '/api/webhook/stripe' && method === 'POST') {
        const { handleStripeWebhook } = await import('./worker/billing');
        return await handleStripeWebhook(request, env);
      }

      // Sprint E4 M1 — Webhook paiement marchand e-commerce (PUBLIC).
      // ⚠️ ZONE RÉGULÉE. DISTINCT de /api/webhook/stripe (abo SaaS billing.ts,
      // intouchable). Auth = SIGNATURE provider, VRAIMENT vérifiée et déléguée
      // à provider.handleWebhook (M2/M3). Anti-rejeu via payment_events UNIQUE.
      const ecPayWhMatch = path.match(/^\/api\/webhook\/payments\/([^/]+)$/);
      if (ecPayWhMatch && method === 'POST') {
        // Sprint E6 M2 — Webhook dispute (chargeback) PUBLIC. ⚠️ ZONE RÉGULÉE :
        // un litige = ENREGISTREMENT DB seulement, AUCUN mouvement de fonds.
        // La SIGNATURE est vérifiée DANS le dispatcher M1 (provider.handleWebhook
        // → verifyStripeSignature, vraie HMAC ≠ mock billing.ts). Le dispatcher
        // M1 (handlePaymentWebhook) renvoie un outcome discriminé
        // PaymentWebhookOutcome ; quand outcome.kind==='dispute', le traitement
        // litige est délégué à handleDisputeWebhook (ecommerce-disputes.ts M2).
        // handlePaymentWebhook reste le SEUL point d'entrée (signature + dédup
        // payment_events) — on ne re-vérifie/re-mock RIEN ici, billing.ts
        // intouché. M1 (ecommerce-payments.ts) n'est PAS modifié.
        const epMod = await import('./worker/ecommerce-payments');
        // Accès défensif au dispatcher discriminé : M1 n'expose à ce jour que
        // handlePaymentWebhook (renvoie une Response, signature+dédup gérées).
        // Si/quand M1 publie un dispatcher renvoyant PaymentWebhookOutcome, la
        // voie dispute s'active sans modifier M1. Lookup runtime non typé pour
        // ne PAS introduire d'import nommé d'un symbole non exporté (TS2305).
        const dispatch = (epMod as unknown as Record<string, unknown>)
          .dispatchPaymentWebhook;
        if (typeof dispatch === 'function') {
          const outcome = await (
            dispatch as (
              r: Request,
              e: typeof env,
              p: string,
            ) => Promise<import('./worker/ecommerce-payments').PaymentWebhookOutcome | null>
          )(request, env, ecPayWhMatch[1]!);
          if (outcome && outcome.kind === 'dispute') {
            const { handleDisputeWebhook } = await import('./worker/ecommerce-disputes');
            await handleDisputeWebhook(env, outcome);
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
        return await epMod.handlePaymentWebhook(request, env, ecPayWhMatch[1]!);
      }

      // Sprint E8 M2 — Webhooks omnicanal Shopify / Woo (PUBLICS).
      // Auth = SIGNATURE (HMAC SHA-256 base64, vraie vérif constant-time
      // via crypto.subtle — adaptée de verifyMetaSignature, ≠ mock
      // billing.ts). DISTINCT de /api/webhook/stripe (billing SaaS
      // intouché). Idempotence + anti-echo gérés DANS le moteur M2.3
      // (channel_product_map / orders.external_id / channel_sync_log).
      const shopifyWhMatch = path.match(/^\/api\/webhook\/shopify\/([^/]+)$/);
      if (shopifyWhMatch && method === 'POST') {
        const { handleShopifyWebhook } = await import(
          './worker/ecommerce-channel-shopify'
        );
        return await handleShopifyWebhook(request, env, shopifyWhMatch[1]!);
      }
      const wooWhMatch = path.match(/^\/api\/webhook\/woo\/([^/]+)$/);
      if (wooWhMatch && method === 'POST') {
        const { handleWooWebhook } = await import(
          './worker/ecommerce-channel-woo'
        );
        return await handleWooWebhook(request, env, wooWhMatch[1]!);
      }

      // Webchat — routes publiques
      if (path === '/api/webchat/ws') return await handleWebchatConnect(request, env, url);
      if (path === '/api/webchat/prechat' && method === 'POST') return await handleWebchatPrechat(request, env);
      if (path === '/api/webchat/widget.js') {
        const { handleWebchatWidget } = await import('./worker/webchat');
        return handleWebchatWidget(env, url);
      }

      // ── Sprint 36 — Chat-session PUBLIC (Phase B) ─────────────────────
      // 3 routes pour le widget visiteur enrichi (anti-bot + fallback no-WS) :
      //   POST /api/chat-session/start          → handlePublicChatStart
      //   POST /api/chat-session/:id/message    → handlePublicChatMessage
      //   GET  /api/chat-session/:id/poll       → handlePublicChatPoll
      // Toutes PUBLIQUES (hors choke-point requireAuth) — wrapper anti-bot
      // dans handlePublicChatStart (honeypot + rate-limit + origin + Turnstile).
      if (path === '/api/chat-session/start' && method === 'POST') {
        const { handlePublicChatStart } = await import('./worker/chat-session');
        return await handlePublicChatStart(request, env);
      }
      const chatSessionMsgMatch = path.match(/^\/api\/chat-session\/([A-Za-z0-9_-]{1,128})\/message$/);
      if (chatSessionMsgMatch && method === 'POST') {
        const { handlePublicChatMessage } = await import('./worker/chat-session');
        return await handlePublicChatMessage(request, env, chatSessionMsgMatch[1]!);
      }
      const chatSessionPollMatch = path.match(/^\/api\/chat-session\/([A-Za-z0-9_-]{1,128})\/poll$/);
      if (chatSessionPollMatch && method === 'GET') {
        const { handlePublicChatPoll } = await import('./worker/chat-session');
        return await handlePublicChatPoll(env, chatSessionPollMatch[1]!, url);
      }

      // Sprint 46 M3.4 — Notifications WebSocket (auth via token query param)
      // WS ne supporte pas headers custom → token Bearer dans `?token=...`.
      // Auth validation manuelle ici (route publique) avant forward au DO room.
      if (path === '/api/notifications/ws') {
        const wsToken = url.searchParams.get('token') || '';
        if (!wsToken || wsToken.length < 10) {
          return json({ error: 'Token manquant' }, 401);
        }
        const wsSession = await (await import('./worker/helpers')).validateSession(wsToken, env);
        if (!wsSession.valid || !wsSession.userId) {
          return json({ error: 'Session expirée' }, 401);
        }
        const { handleNotificationsWsConnect } = await import('./worker/notifications-ws');
        return await handleNotificationsWsConnect(request, env, wsSession.userId);
      }
      
      // iCal feed
      const icalMatch = path.match(/^\/ical\/([^/]+)\.ics$/);
      if (icalMatch && method === 'GET') {
        const { handleGetICalFeed } = await import('./worker/calendar');
        return await handleGetICalFeed(env, icalMatch[1]!);
      }

      // ── Sprint 50 M3 — Beta invite flow (routes publiques) ──────
      if (path === '/api/beta/signup' && method === 'POST') {
        const { handleBetaSignup } = await import('./worker/beta');
        return await handleBetaSignup(request, env);
      }
      if (path === '/api/beta/count' && method === 'GET') {
        const { handleBetaCount } = await import('./worker/beta');
        return await handleBetaCount(env);
      }
      if (path === '/api/auth/magic-link' && method === 'POST') {
        const { handleMagicLinkRequest } = await import('./worker/beta');
        return await handleMagicLinkRequest(request, env);
      }
      if (path === '/api/auth/magic-verify' && method === 'GET') {
        const { handleMagicVerify } = await import('./worker/beta');
        return await handleMagicVerify(request, env, url);
      }
      if (path === '/api/roadmap' && method === 'GET') {
        const { handleGetRoadmap } = await import('./worker/beta');
        return await handleGetRoadmap(env);
      }
      const roadmapVoteMatch = path.match(/^\/api\/roadmap\/([A-Za-z0-9_-]{1,64})\/vote$/);
      if (roadmapVoteMatch && method === 'POST') {
        const { handleRoadmapVote } = await import('./worker/beta');
        return await handleRoadmapVote(request, env, roadmapVoteMatch[1]!);
      }
    } catch (err) {
      return errorResponse(err, env, path);
    }

    // ── Migration GHL Callback ──────────────────────────────────
    if (path === '/api/migration/ghl/oauth/callback' && method === 'GET') {
      const { handleGhlOauthCallback } = await import('./worker/migration-ghl-oauth');
      return handleGhlOauthCallback(request, env, url);
    }

    // ── LOT G4 — OAuth natives callback (PUBLIC hors-try : retour navigateur,
    //    pas de JWT — le tenant est porté par le state CSRF en KV). Provider
    //    whitelisté (google|slack). Préfixe /api/oauth/* neuf (ne chevauche ni
    //    /api/meta/oauth ni /api/migration/ghl/oauth).
    const oauthCallbackMatch = path.match(/^\/api\/oauth\/(google|slack)\/callback$/);
    if (oauthCallbackMatch && method === 'GET') {
      const { handleOauthCallback } = await import('./worker/oauth');
      return handleOauthCallback(request, env, oauthCallbackMatch[1] as 'google' | 'slack', url);
    }

    // ── Sprint 32 — GBP OAuth callback (PUBLIC hors-try : retour navigateur,
    //    pas de JWT — tenant porté par state CSRF en KV). Route DISTINCTE du
    //    whitelist G4 (google|slack) car GBP utilise une app Google séparée,
    //    scope business.manage, et redirige vers /settings/integrations
    //    (pas /integrations). Le start (/api/gbp/oauth/start) est authed
    //    plus bas dans le bloc /api/gbp/* avec les autres routes A2.
    if (path === '/api/gbp/oauth/callback' && method === 'GET') {
      const m = await import('./worker/gbp-oauth');
      return m.handleGbpCallback(request, env);
    }

    // ── Sprint 33 — Calendar Sync OAuth callbacks + webhooks (PUBLIC) ──────
    //    Callbacks OAuth GCal/Outlook + webhooks push notifications externes.
    //    Tous PUBLIC (hors choke-point requireAuth) :
    //      - Callbacks : tenant porté par state CSRF en KV (jamais body).
    //      - Webhooks : authent via X-Goog-Channel-Token (GCal) /
    //                   body.clientState (Outlook), validés DANS le handler
    //                   contre calendar_connections.webhook_client_state.
    //    Outlook webhook accepte aussi GET pour le handshake validationToken.
    // Callback paths DOIVENT matcher redirectUri() des handlers (calque GBP) :
    //   - gcal-oauth.ts redirectUri() = ${origin}/api/gcal/oauth/callback
    //   - outlook-oauth.ts redirectUri() = ${origin}/api/outlook/oauth/callback
    if (path === '/api/gcal/oauth/callback' && method === 'GET') {
      const m = await import('./worker/gcal-oauth');
      return m.handleGcalCallback(request, env);
    }
    if (path === '/api/outlook/oauth/callback' && method === 'GET') {
      const m = await import('./worker/outlook-oauth');
      return m.handleOutlookCallback(request, env);
    }
    if (path === '/api/calendar-sync/webhook/gcal' && method === 'POST') {
      const m = await import('./worker/calendar-sync');
      return m.handleGcalWebhook(request, env);
    }
    if (path === '/api/calendar-sync/webhook/outlook' && (method === 'POST' || method === 'GET')) {
      const m = await import('./worker/calendar-sync');
      return m.handleOutlookWebhook(request, env);
    }

    // ── Auth (login/logout/reset — pas de token requis) ─────────
    if (path === '/api/auth/login' && method === 'POST') return handleLogin(request, env);
    if (path === '/api/auth/register' && method === 'POST') {
      const { handleRegister } = await import('./worker/auth');
      return handleRegister(request, env);
    }
    if (path === '/api/auth/logout' && method === 'POST') return handleLogout(request, env);
    if (path === '/api/auth/forgot-password' && method === 'POST') {
      const { handleForgotPassword } = await import('./worker/auth');
      return handleForgotPassword(request, env);
    }
    if (path === '/api/auth/reset-password' && method === 'POST') {
      const { handleResetPassword } = await import('./worker/auth');
      return handleResetPassword(request, env);
    }

    // ── LOT TEAM A — acceptation d'invitation (PUBLIC, pré-requireAuth) ────
    // Sécurité = token hashé + expiration + single-use (par design, pas de
    // session requise). Succès = format finishLogin (contrat Lot1 §6.5).
    if (path === '/api/team/invites/accept' && method === 'POST') {
      return handleAcceptInvitation(request, env);
    }

    // ── Sprint 23 — Cookie consent (PUBLIC, pré-requireAuth) ───────────────
    // Le user peut être anonyme (anonymous_id côté client) OU authed (token
    // Bearer best-effort lu par le handler). Rate-limit 30/min/IP appliqué
    // Phase B dans le handler. Catégorie 'essential' forcée à true par schema.
    if (path === '/api/cookies/consent' && method === 'POST') {
      const m = await import('./worker/cookies-consent');
      return m.handlePostCookieConsent(request, env);
    }

    // Auth routes nécessitant le token 
    if (path === '/api/auth/me' && method === 'GET') return handleMe(request, env);
    if (path === '/api/auth/change-password' && method === 'POST') return handleChangePassword(request, env);

    // ── Routes protégées ──────────────────────────────────
    if (!path.startsWith('/api/')) return new Response('Not Found', { status: 404 });

    const auth = await requireAuth(request, env);
    if (auth instanceof Response) return auth;

    // ── Sprint 91 (seq186) — Re-check rate-limit tier 'authenticated' ─────
    // L'utilisateur est authentifié : on applique un quota plus élevé
    // (120 req/min) indexé sur le userId (et non plus l'IP). Ce 2e check
    // NE REMPLACE PAS le check public (qui a déjà filtré les abus anon),
    // il AJOUTE un quota nominal pour les utilisateurs légitimes.
    // Fail-open garanti (calque du middleware global ligne ~411).
    if (__rlResult && path.startsWith('/api/')) {
      try {
        const { checkRateLimitKV, rateLimitedResponse } = await import('./worker/lib/rate-limit-kv');
        const authRl = await checkRateLimitKV(env.RATE_LIMITER, auth.userId, 'authenticated');
        if (!authRl.allowed) {
          return rateLimitedResponse(authRl);
        }
        // On met à jour __rlResult avec le tier authentifié (headers plus précis)
        __rlResult = authRl;
      } catch {
        // Fail-open
      }
    }

    // ── LOT 1 SaaS M1 — enrichissement tenant (additif, best-effort) ──────
    // resolveTenantContext NE THROW JAMAIS : en cas de panne D1 / migration 78
    // non jouée, on retombe sur le legacy strict (clientId null) ⇒ `auth`
    // reste fonctionnellement identique à l'ancien comportement mono-tenant.
    // Le champ `clientId` est ADDITIF sur l'objet auth — déjà typé optionnel
    // chez les handlers (cf. leads.ts:133 `auth.clientId?`).
    const requestedSubAccount = request.headers.get('X-Sub-Account') || undefined;
    // LOT G9 white-label (ADDITIF) : on transmet l'en-tête `host` comme
    // FALLBACK DERNIER RECOURS de résolution tenant. Phase A : param ignoré
    // par resolveTenantContext (routing byte-identique). Phase B : lookup
    // custom_hostnames UNIQUEMENT si clientId reste null (jamais pour un user
    // existant résolu par identité).
    const hostHeader = request.headers.get('host') || undefined;
    const tenantCtx = await resolveTenantContext(
      env,
      auth.userId,
      auth.role,
      requestedSubAccount,
      hostHeader,
    );
    // ── LOT TEAM B — enrichissement capabilities (additif, best-effort) ──
    // resolveCapabilities NE THROW JAMAIS : legacy/mono-tenant ou panne D1 /
    // table seq 80 absente ⇒ set LARGE dérivé du rôle technique = comportement
    // actuel byte-équivalent. Champ `capabilities` ADDITIF sur authCtx ;
    // AUCUNE garde bloquante posée ici (les handlers sensibles appellent
    // requireCapability eux-mêmes — cf. docs/LOT-TEAM-BC.md §6.D).
    const baseAuthCtx = { ...auth, clientId: tenantCtx.clientId ?? undefined, tenant: tenantCtx };
    const capabilities = await resolveCapabilities(env, baseAuthCtx);
    const authCtx = { ...baseAuthCtx, capabilities };

    // Garde anti-IDOR globale pour les partenaires dropship
    if (tenantCtx.dropshipPartnerId) {
      const isPortalRoute =
        path === '/api/dropship-portal/orders' ||
        path.match(/^\/api\/dropship-portal\/orders\/([^/]+)\/ship$/) ||
        path === '/api/auth/logout' ||
        path === '/api/auth/me' ||
        path === '/api/me';
      
      if (!isPortalRoute) {
        return json({ error: 'Accès interdit aux utilisateurs partenaires' }, 403);
      }
    }

    try {
      // ── Sprint 94 — Cache Edge : check HIT avant dispatch ──────────────
      const { tryCacheMiddleware, maybeCacheAndReturn } = await import('./worker/edge-cache');
      const cachedResponse = await tryCacheMiddleware(request, url, authCtx);
      if (cachedResponse) {
        ctx.waitUntil(
          recordRequestMetric(env, {
            method,
            rawPath: path,
            status: cachedResponse.status,
            tenantId: (authCtx as { clientId?: string }).clientId ?? null,
            latencyMs: Date.now() - __startMs,
          }).catch(() => { /* never throws */ }),
        );
        return cachedResponse;
      }

      // ── Sprint 24 — Observabilité : capture la réponse pour enregistrer la
      // métrique requête agrégée (route × status × tenant × latence) via
      // ctx.waitUntil (best-effort, ne bloque jamais la réponse client).
      // recordRequestMetric est NEVER-THROW (try/catch interne) — le .catch
      // ici est une ceinture-bretelles défensive.
      const rawResponse = await routeProtected(request, env, ctx, url, path, method, authCtx);
      // Sprint 94 — Cache Edge : stocker en cache si éligible (arrière-plan)
      let finalResponse = await maybeCacheAndReturn(rawResponse, url, authCtx, ctx);
      // Sprint 96 — API Versioning : transformer la réponse selon la version
      if (__apiVersionCtx) {
        const { transformResponse } = await import('./worker/api-versioning');
        finalResponse = await transformResponse(finalResponse, __apiVersionCtx);
      }
      ctx.waitUntil(
        recordRequestMetric(env, {
          method,
          rawPath: path,
          status: finalResponse.status,
          tenantId: (authCtx as { clientId?: string }).clientId ?? null,
          latencyMs: Date.now() - __startMs,
        }).catch(() => { /* never throws */ }),
      );
      return finalResponse;
    } catch (err) {
      const errResponse = errorResponse(err, env, path);
      ctx.waitUntil(
        recordRequestMetric(env, {
          method,
          rawPath: path,
          status: errResponse.status,
          tenantId: (authCtx as { clientId?: string }).clientId ?? null,
          latencyMs: Date.now() - __startMs,
        }).catch(() => { /* never throws */ }),
      );
      return errResponse;
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(processWorkflowQueue(env));
    ctx.waitUntil(processOverdueTasks(env));

    // ── Sprint E7 — batch agrégats client / RFM / panier abandonné ────────
    // BEST-EFFORT, bornés (LIMIT 50, pattern processWorkflowQueue). Chargés
    // par dynamic import (noms FIGÉS au contrat E7) — un échec isolé ne casse
    // PAS le cron (waitUntil + try/catch interne aux helpers / .catch ici).
    ctx.waitUntil(
      import('./worker/ecommerce-customer-metrics')
        .then((m) => m.recomputeAllCustomerMetrics(env))
        .then(() => undefined)
        .catch(() => undefined),
    );
    ctx.waitUntil(
      import('./worker/ecommerce-rfm')
        .then((m) => m.recomputeAllRfmSegments(env))
        .then(() => undefined)
        .catch(() => undefined),
    );
    ctx.waitUntil(
      import('./worker/ecommerce-cart-recovery')
        .then((m) => m.detectAbandonedCarts(env))
        .then(() => undefined)
        .catch(() => undefined),
    );
    // ── Sprint 5 — broadcasts PROGRAMMÉS échus (scheduled_at <= now) ───────
    // BEST-EFFORT (calque EXACT du pattern E7 ci-dessus). Échec isolé ⇒ ne
    // casse PAS le cron ni processWorkflowQueue. STUB Phase A → corps Phase B.
    ctx.waitUntil(
      import('./worker/sequences')
        .then((m) => m.processScheduledBroadcasts(env))
        .then(() => undefined)
        .catch(() => undefined),
    );
    // ── LOT SCHEDREPORT Sprint A — rapports d'activité PLANIFIÉS échus ─────
    // BEST-EFFORT (calque EXACT du pattern E7 / broadcasts ci-dessus). Échec
    // isolé ⇒ ne casse PAS le cron ni RFM / workflows / broadcasts / cleanup.
    // STUB Phase A (no-op) → corps Phase B Manager-B.
    ctx.waitUntil(
      import('./worker/scheduled-reports')
        .then((m) => m.processScheduledReports(env))
        .then(() => undefined)
        .catch(() => undefined),
    );
    ctx.waitUntil(
      import('./worker/scheduled-messages')
        .then((m) => m.processScheduledMessages(env))
        .then(() => undefined)
        .catch(() => undefined),
    );
    // ── LOT PROACTIVE-C Sprint A — IA proactive batch (churn + NBA + alertes) ─
    // BEST-EFFORT (calque EXACT du pattern E7 / broadcasts / scheduled-reports).
    // Échec isolé ⇒ ne casse PAS le cron ni RFM / workflows / broadcasts /
    // scheduled-reports / cleanup. 100% DÉTERMINISTE — ZÉRO LLM en batch (contrôle
    // coût). STUB Phase A (no-op) → corps Phase B Manager-B (itération DISTINCT
    // client_id, bornage tenant strict).
    ctx.waitUntil(
      import('./worker/proactive-ai')
        .then((m) => m.runProactiveBatch(env))
        .then(() => undefined)
        .catch(() => undefined),
    );
    // ── SPRINT 13 — Scoring prédictif CALIBRÉ tenant (conversion-scoring) ───
    // BEST-EFFORT (calque EXACT du pattern proactive-ai ci-dessus). Recalcule
    // les baselines de conversion won/lost RÉELLES par tenant (déterministe SQL
    // pur, ZÉRO LLM, borné DISTINCT client_id LIMIT 50). Échec isolé ⇒ ne casse
    // NI le cron NI les autres jobs. STUB Phase A (no-op) → corps réel Phase B
    // Manager-B (conversion-engine.recomputeConversionBaselines).
    ctx.waitUntil(
      import('./worker/conversion-engine')
        .then((m) => m.recomputeConversionBaselines(env))
        .then(() => undefined)
        .catch(() => undefined),
    );
    // ── LOT BOOKING REMINDERS Sprint A — rappels automatiques AVANT RDV ────
    // BEST-EFFORT (calque EXACT du pattern E7 / broadcasts / scheduled-reports
    // / proactive-ai ci-dessus). Échec isolé ⇒ ne casse PAS le cron ni les
    // autres jobs. STUB Phase A (boucle vide) → corps réel Phase B Manager-B
    // (SELECT bookings 'confirmed' & reminder_sent_at NULL, jointure
    // applicative booking_event_types pour offset/canal, envoi email/SMS,
    // UPDATE reminder_sent_at — borné LIMIT 50, idempotent).
    ctx.waitUntil(
      import('./worker/booking-reminders')
        .then((m) => m.processBookingReminders(env))
        .then(() => undefined)
        .catch(() => undefined),
    );
    // ── LOT SOCIAL PLANNER Sprint 9 — posts PLANIFIÉS échus (publication MOCK) ─
    // BEST-EFFORT (calque EXACT du pattern broadcasts / booking-reminders
    // ci-dessus). Échec isolé ⇒ ne casse PAS le cron ni les autres jobs. STUB
    // Phase A (no-op) → corps réel Phase B Manager-B (social-publish.ts : SELECT
    // social_posts scheduled_at<=now AND status='queued' LIMIT 50 → processing →
    // publishToNetwork MOCK par réseau → published/failed + published_at).
    ctx.waitUntil(
      import('./worker/social-publish')
        .then((m) => m.processDueSocialPosts(env))
        .then(() => undefined)
        .catch(() => undefined),
    );
    // Seed des profils de scoring par défaut (idempotent)
    ctx.waitUntil(seedDefaultScoreProfiles(env));
    // Nettoyage automatique de la corbeille (leads supprimés > 30 jours)
    ctx.waitUntil(
      env.DB.prepare("DELETE FROM leads WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-30 days')").run()
    );
    // Nettoyage des sessions de migration inactives > 30min (timeout)
    ctx.waitUntil(
      env.DB.prepare("UPDATE migration_sessions SET status = 'failed', error_log_json = '[\"Timeout: Worker killed ou process abandonné\"]' WHERE status = 'running' AND updated_at < datetime('now', '-30 minutes')").run()
    );
    // Refresh automatique des tokens GHL expirants (< 1h)
    ctx.waitUntil(
      (async () => {
        const { refreshExpiringGhlTokens } = await import('./worker/migration-ghl-oauth');
        await refreshExpiringGhlTokens(env);
      })()
    );
    // ── Sprint 32 — GBP reviews sync (best-effort, calque pattern E7 ci-dessus) ─
    ctx.waitUntil(import('./worker/gbp-sync').then(m => m.processGbpReviewsSync(env)).catch(() => {}));
    // ── Sprint 33 — Calendar pull sync (Google + Outlook, best-effort, calque GBP) ─
    ctx.waitUntil(import('./worker/calendar-sync').then(m => m.processCalendarPullSync(env)).catch(() => {}));
    // ── Sprint 87 — Facturation multidevises sync (Exchange Rates) ───
    ctx.waitUntil(
      import('./worker/currencies')
        .then((m) => m.syncExchangeRates(env))
        .catch(() => {})
    );
    // ── Sprint 93 — Purge RGPD & Loi 25 automatisée (cron hebdomadaire) ─────
    // BEST-EFFORT (calque pattern E7). Échec isolé ⇒ ne casse PAS le cron.
    ctx.waitUntil(
      import('./worker/privacy-purge')
        .then((m) => m.handleScheduledPurge(env))
        .then(() => undefined)
        .catch(() => undefined),
    );
  },

  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    const { processBroadcastQueueJob } = await import('./worker/broadcast');
    if (batch.queue === 'intralys-broadcast') {
      await processBroadcastQueueJob(batch, env);
    }
    
    if (batch.queue === 'intralys-webhooks') {
      const { processWebhookDelivery } = await import('./worker/webhooks-queue');
      await processWebhookDelivery(batch, env);
    }
  }
} satisfies ExportedHandler<Env>;

// ── Routeur protégé ─────────────────────────────────────────

async function routeProtected(
  request: Request, env: Env, ctx: ExecutionContext, url: URL,
  path: string, method: string,
  auth: { userId: string; role: string; clientId?: string; tenant?: TenantContext; capabilities?: Set<string> }
): Promise<Response> {

  // Auth & Sécurité
  if (path === '/api/auth/me' && method === 'PATCH') return handleUpdateProfile(request, env);
  if (path === '/api/auth/notifications' && (method === 'GET' || method === 'PATCH')) return handleNotificationPreferences(request, env);
  if (path === '/api/auth/sessions' && method === 'GET') return handleGetSessions(request, env);
  if (path === '/api/auth/sessions/others' && method === 'DELETE') return handleDeleteOtherSessions(request, env);
  const sessionMatch = path.match(/^\/api\/auth\/sessions\/([^/]+)$/);
  if (sessionMatch && method === 'DELETE') return handleDeleteSession(request, env, sessionMatch[1]!);
  if (path === '/api/auth/2fa/backup-codes' && method === 'POST') return handleGenerateBackupCodes(request, env);

  // Dashboard
  if (path === '/api/dashboard/stats' && method === 'GET') return handleDashboardStats(env, auth);

  // Recherche globale cross-entités (LOT B / S-B2) — authentifiée, multi-tenant
  if (path === '/api/search' && method === 'GET') return handleGlobalSearch(env, auth, url);

  // Clients
  if (path === '/api/clients' && method === 'GET') return handleGetClients(env, auth);
  if (path === '/api/clients' && method === 'POST') return handleCreateClient(request, env, auth);
  const clientLeadsMatch = path.match(/^\/api\/clients\/([^/]+)\/leads$/);
  if (clientLeadsMatch && method === 'GET') return handleGetClientLeads(env, auth, clientLeadsMatch[1]!, url);
  // ── LOT TEAM C — CRUD sous-comptes + branding white-label ───────────────
  // Ordre : /branding (sous-route) AVANT /:id générique (sinon shadowing).
  const clientBrandingMatch = path.match(/^\/api\/clients\/([^/]+)\/branding$/);
  if (clientBrandingMatch && method === 'GET') return handleGetClientBranding(env, auth, clientBrandingMatch[1]!);
  if (clientBrandingMatch && method === 'PATCH') return handleUpdateClientBranding(request, env, auth, clientBrandingMatch[1]!);
  // ── LOT G9 WHITE-LABEL — custom domain (sous-routes AVANT /:id générique) ──
  const customDomainDelMatch = path.match(/^\/api\/clients\/([^/]+)\/custom-domain\/([^/]+)$/);
  if (customDomainDelMatch && method === 'DELETE') return handleDeleteCustomDomain(env, auth, customDomainDelMatch[1]!, customDomainDelMatch[2]!);
  const customDomainMatch = path.match(/^\/api\/clients\/([^/]+)\/custom-domain$/);
  if (customDomainMatch && method === 'GET') return handleGetCustomDomains(env, auth, customDomainMatch[1]!);
  if (customDomainMatch && method === 'POST') return handleAddCustomDomain(request, env, auth, customDomainMatch[1]!);
  const clientIdMatch = path.match(/^\/api\/clients\/([^/]+)$/);
  if (clientIdMatch && method === 'PATCH') return handleUpdateClient(request, env, auth, clientIdMatch[1]!);
  if (clientIdMatch && method === 'DELETE') return handleDeleteClient(request, env, auth, clientIdMatch[1]!);

  // Account Snapshots (Sprint 85 - Configurations Portables)
  if (path === '/api/account-snapshots' && method === 'GET') return handleListAccountSnapshots(env, auth);
  if (path === '/api/account-snapshots' && method === 'POST') return handleCreateAccountSnapshot(request, env, auth);
  const accountSnapshotApplyMatch = path.match(/^\/api\/account-snapshots\/([^/]+)\/apply$/);
  if (accountSnapshotApplyMatch && method === 'POST') return handleApplyAccountSnapshot(request, env, auth, accountSnapshotApplyMatch[1]!);
  const accountSnapshotIdMatch = path.match(/^\/api\/account-snapshots\/([^/]+)$/);
  if (accountSnapshotIdMatch && method === 'DELETE') return handleDeleteAccountSnapshot(request, env, auth, accountSnapshotIdMatch[1]!);

  // Leads
  if (path === '/api/leads' && method === 'GET') return handleGetLeads(env, auth, url);
  if (path === '/api/leads' && method === 'POST') return handleCreateLead(request, env, auth);
  if (path === '/api/leads/bulk' && method === 'POST') return handleBulkLeads(request, env, auth);
  if (path === '/api/leads/export' && method === 'GET') return handleExportCsv(env, auth, url);
  if (path === '/api/exports/configurable' && method === 'GET') return handleConfigurableExport(env, auth, url);
  if (path === '/api/leads/import' && method === 'POST') return handleCsvImport(request, env, auth);
  // LOT AUTOMATION BUILDER seq 105 (Sprint 4) — historique automation d'un lead
  // (sous-route SPÉCIFIQUE ; ne collisionne pas avec /api/leads/:id qui est un
  // segment unique, mais placée ici parmi les sous-routes leads par clarté).
  // Capability 'workflows.manage' DANS le handler. Corps Phase B.
  const leadAutoHistMatch = path.match(/^\/api\/leads\/([^/]+)\/automation-history$/);
  if (leadAutoHistMatch && method === 'GET') return handleGetLeadAutomationHistory(env, auth, leadAutoHistMatch[1]!);
  const leadRoutePredictiveMatch = path.match(/^\/api\/leads\/([^/]+)\/route-predictive$/);
  if (leadRoutePredictiveMatch && method === 'POST') return handleRouteLeadPredictive(request, env, auth, leadRoutePredictiveMatch[1]!);

  const leadMatch = path.match(/^\/api\/leads\/([^/]+)$/);
  if (leadMatch && method === 'GET') return handleGetLeadDetail(env, auth, leadMatch[1]!);
  if (leadMatch && method === 'PATCH') return handlePatchLead(request, env, auth, leadMatch[1]!);
  const tagsMatch = path.match(/^\/api\/leads\/([^/]+)\/tags$/);
  if (tagsMatch && method === 'POST') return handleAddTag(request, env, auth, tagsMatch[1]!);
  if (tagsMatch && method === 'DELETE') return handleRemoveTag(request, env, auth, tagsMatch[1]!);
  const leadMsgMatch = path.match(/^\/api\/leads\/([^/]+)\/messages$/);
  if (leadMsgMatch && method === 'GET') return handleGetLeadMessages(env, auth, leadMsgMatch[1]!);
  if (leadMsgMatch && method === 'POST') return handleSendMessage(request, env, auth, leadMsgMatch[1]!);
  const forgetMatch = path.match(/^\/api\/leads\/([^/]+)\/forget$/);
  if (forgetMatch && method === 'POST') return handleForgetLead(env, auth, forgetMatch[1]!);
  const exportPiiMatch = path.match(/^\/api\/leads\/([^/]+)\/export-pii$/);
  if (exportPiiMatch && method === 'GET') return handleExportPii(env, auth, exportPiiMatch[1]!);
  const cfvMatch = path.match(/^\/api\/leads\/([^/]+)\/custom-fields$/);
  if (cfvMatch && method === 'GET') return handleGetLeadCustomFields(env, auth, cfvMatch[1]!);
  if (cfvMatch && method === 'PATCH') return handleSetLeadCustomFields(request, env, auth, cfvMatch[1]!);
  // Lead scores (Phase 2.0)
  const leadScoresMatch = path.match(/^\/api\/leads\/([^/]+)\/scores$/);
  if (leadScoresMatch && method === 'GET') return handleGetLeadScores(env, auth, leadScoresMatch[1]!);
  const leadRecomputeMatch = path.match(/^\/api\/leads\/([^/]+)\/scores\/recompute$/);
  if (leadRecomputeMatch && method === 'POST') return handleRecomputeLeadScore(env, auth, leadRecomputeMatch[1]!);
  // Lead notes (Sprint 2)
  const leadNotesMatch = path.match(/^\/api\/leads\/([^/]+)\/notes$/);
  if (leadNotesMatch && method === 'GET') return handleGetLeadNotes(env, auth, leadNotesMatch[1]!);
  if (leadNotesMatch && method === 'POST') return handleCreateLeadNote(request, env, auth, leadNotesMatch[1]!);
  const leadNoteMatch = path.match(/^\/api\/leads\/([^/]+)\/notes\/([^/]+)$/);
  if (leadNoteMatch && method === 'PATCH') return handleUpdateLeadNote(request, env, auth, leadNoteMatch[1]!, leadNoteMatch[2]!);
  if (leadNoteMatch && method === 'DELETE') return handleDeleteLeadNote(env, auth, leadNoteMatch[1]!, leadNoteMatch[2]!);

  // Sprint 78 — Lead Scoring Comportemental v2 (behavioral-events)
  const leadBehavioralEventsMatch = path.match(/^\/api\/leads\/([^/]+)\/behavioral-events$/);
  if (leadBehavioralEventsMatch && method === 'GET') {
    const { handleGetLeadBehavioralEvents } = await import('./worker/behavioral');
    return await handleGetLeadBehavioralEvents(request, env, auth, leadBehavioralEventsMatch[1]!);
  }

  // Tags & Activity
  if (path === '/api/tags' && method === 'GET') return handleGetAllTags(env, auth);
  if (path === '/api/activity' && method === 'GET') return handleGetActivity(env, auth, url);
  if (path === '/api/pipeline' && method === 'GET') return handleGetPipeline(env, auth, url);

  // Messages / Inbox
  if (path === '/api/messages' && method === 'GET') return handleGetInboxMessages(env, auth, url);
  const messageTranslateMatch = path.match(/^\/api\/messages\/([^/]+)\/translate$/);
  if (messageTranslateMatch && method === 'POST') return handleTranslateMessage(env, auth, messageTranslateMatch[1]!);

  // ── LOT TELEPHONY-F — téléphonie 2-way (call_logs + IVR config) ───────────
  // Module telephony.ts NEUF (voice.ts intouché). Capabilities réutilisées :
  // leads.write (click-to-call) / settings.manage (IVR). Appels Twilio réels =
  // FLAG INACTIF (call_log mock sans credentials). Bornage tenant côté handler.
  if (path === '/api/calls' && method === 'GET') {
    const { handleGetCallLogs } = await import('./worker/telephony');
    return handleGetCallLogs(env, auth, url);
  }
  if (path === '/api/calls' && method === 'POST') {
    const { handlePlaceCall } = await import('./worker/telephony');
    return handlePlaceCall(request, env, auth);
  }
  // ── Sprint 16 (seq 116) — disposition post-appel + notes sur un call_log ──
  //   capGuard 'leads.write' (DANS le handler). Path EXACT /:id/disposition
  //   déclaré APRÈS /api/calls (anti-shadowing : aucun chevauchement). Bornage
  //   tenant côté handler (UPDATE … WHERE id = ? AND client_id = ?).
  const callDispositionMatch = path.match(/^\/api\/calls\/([^/]+)\/disposition$/);
  if (callDispositionMatch && method === 'POST') {
    const { handleSetCallDisposition } = await import('./worker/telephony');
    return handleSetCallDisposition(request, env, auth, callDispositionMatch[1]!);
  }
  // ── Sprint 80 — Compte-Rendu Automatique d'Appels & Actions ───────────────
  const callSummarizeMatch = path.match(/^\/api\/calls\/([^/]+)\/summarize$/);
  if (callSummarizeMatch && method === 'POST') {
    const { handleSummarizeCall } = await import('./worker/telephony');
    return handleSummarizeCall(request, env, auth, callSummarizeMatch[1]!);
  }
  const callSummaryMatch = path.match(/^\/api\/calls\/([^/]+)\/summary$/);
  if (callSummaryMatch && method === 'GET') {
    const { handleGetCallSummary } = await import('./worker/telephony');
    return handleGetCallSummary(env, auth, callSummaryMatch[1]!);
  }

  // ── Sprint 82 — Commissions d'Équipe de Vente ───────────────────────────
  if (path === '/api/agent-commissions' && method === 'GET') {
    const { handleGetAgentCommissions } = await import('./worker/agent-commissions');
    return await handleGetAgentCommissions(env, auth, url);
  }
  const agentCommissionStatusMatch = path.match(/^\/api\/agent-commissions\/([^/]+)\/status$/);
  if (agentCommissionStatusMatch && method === 'POST') {
    const { handleUpdateAgentCommissionStatus } = await import('./worker/agent-commissions');
    return await handleUpdateAgentCommissionStatus(request, env, auth, agentCommissionStatusMatch[1]!);
  }
  if (path === '/api/ivr-menus' && method === 'GET') {
    const { handleGetIvrMenus } = await import('./worker/telephony');
    return handleGetIvrMenus(env, auth, url);
  }
  if (path === '/api/ivr-menus' && method === 'POST') {
    const { handleSaveIvrMenu } = await import('./worker/telephony');
    return handleSaveIvrMenu(request, env, auth);
  }
  const ivrMenuIdMatch = path.match(/^\/api\/ivr-menus\/([^/]+)$/);
  if (ivrMenuIdMatch && method === 'DELETE') {
    const { handleDeleteIvrMenu } = await import('./worker/telephony');
    return handleDeleteIvrMenu(env, auth, ivrMenuIdMatch[1]!);
  }

  // ── Sprint 54 — Power Dialer campaigns ───────────────────
  if (path === '/api/dialer/campaigns' && method === 'GET') {
    return handleGetDialerCampaigns(request, env, auth);
  }
  if (path === '/api/dialer/campaigns' && method === 'POST') {
    return handleCreateDialerCampaign(request, env, auth);
  }
  const dialerCampaignLeadMatch = path.match(/^\/api\/dialer\/campaigns\/([^/]+)\/lead$/);
  if (dialerCampaignLeadMatch && method === 'GET') {
    return handleGetDialerCurrentLead(request, env, auth, dialerCampaignLeadMatch[1]!);
  }
  const dialerCampaignIdMatch = path.match(/^\/api\/dialer\/campaigns\/([^/]+)$/);
  if (dialerCampaignIdMatch && method === 'GET') {
    return handleGetDialerCampaign(request, env, auth, dialerCampaignIdMatch[1]!);
  }
  if (dialerCampaignIdMatch && method === 'PATCH') {
    return handleUpdateDialerCampaign(request, env, auth, dialerCampaignIdMatch[1]!);
  }
  if (dialerCampaignIdMatch && method === 'DELETE') {
    return handleDeleteDialerCampaign(request, env, auth, dialerCampaignIdMatch[1]!);
  }

  // ── Sprint 34 (seq 129) — Twilio Voice outbound + recording + voicemails ──
  //   Routes AUTHED câblées sur les handlers stubs implémentés par agents
  //   A2/A3/A4/C4 Phase B (calls-outbound.ts + voicemails.ts).
  //   Capabilities seq80 RÉUTILISÉES (DANS handlers) : 'leads.write' (outbound
  //   + toggle recording + signed URL + voicemail list/listen) + 'settings.manage'
  //   (RGPD delete recording + delete voicemail). ZÉRO ajout ALL_CAPABILITIES.
  //   Bornage tenant côté handler (UPDATE/DELETE WHERE id = ? AND client_id = ?).
  //   Anti-shadowing : /api/calls/:id/disposition (seq 116, ci-dessus) +
  //   /api/calls/:id/record + /api/calls/:id/recording-url + /api/calls/:id/recording
  //   sont des sous-paths distincts (suffixes différents) ⇒ aucun chevauchement.
  //   FLAG INACTIF Twilio : helpers lib/twilio-voice.ts mockent sans credentials.
  if (path === '/api/calls/outbound' && method === 'POST') {
    const m = await import('./worker/calls-outbound');
    return m.handleInitiateOutboundCall(request, env, auth);
  }
  const callRecordToggleMatch = path.match(/^\/api\/calls\/([^/]+)\/record$/);
  if (callRecordToggleMatch && method === 'POST') {
    const m = await import('./worker/calls-outbound');
    return m.handleToggleCallRecording(request, env, auth, callRecordToggleMatch[1]!);
  }
  const callRecordingUrlMatch = path.match(/^\/api\/calls\/([^/]+)\/recording-url$/);
  if (callRecordingUrlMatch && method === 'GET') {
    const m = await import('./worker/calls-outbound');
    return m.handleGetRecordingSignedUrl(env, auth, callRecordingUrlMatch[1]!);
  }
  const callRecordingDeleteMatch = path.match(/^\/api\/calls\/([^/]+)\/recording$/);
  if (callRecordingDeleteMatch && method === 'DELETE') {
    const m = await import('./worker/calls-outbound');
    return m.handleDeleteCallRecording(env, auth, callRecordingDeleteMatch[1]!);
  }
  if (path === '/api/voicemails' && method === 'GET') {
    const m = await import('./worker/voicemails');
    return m.handleListVoicemails(env, auth, url);
  }
  const voicemailListenMatch = path.match(/^\/api\/voicemails\/([^/]+)\/listen$/);
  if (voicemailListenMatch && method === 'POST') {
    const m = await import('./worker/voicemails');
    return m.handleMarkVoicemailListened(env, auth, voicemailListenMatch[1]!);
  }
  // Anti-shadowing : /:id GET et /:id DELETE déclarés APRÈS /:id/listen pour
  // éviter le shadowing du regex [^/]+ générique (qui matcherait 'xxx/listen').
  const voicemailGetMatch = path.match(/^\/api\/voicemails\/([^/]+)$/);
  if (voicemailGetMatch && method === 'GET') {
    const m = await import('./worker/voicemails');
    return m.handleGetVoicemail(env, auth, voicemailGetMatch[1]!);
  }
  if (voicemailGetMatch && method === 'DELETE') {
    const m = await import('./worker/voicemails');
    return m.handleDeleteVoicemail(env, auth, voicemailGetMatch[1]!);
  }

  // ── LOT SMS/WHATSAPP seq 104 — modèles SMS (CRUD) + config WhatsApp ───────
  //   Capability 'settings.manage' (réutilisée seq 80, côté handler). Bornage
  //   tenant côté handler. Sous-route /:id APRÈS la collection (anti-shadowing).
  if (path === '/api/sms-templates' && method === 'GET') {
    const { handleListSmsTemplates } = await import('./worker/sms-templates');
    return handleListSmsTemplates(env, auth, url);
  }
  if (path === '/api/sms-templates' && method === 'POST') {
    const { handleCreateSmsTemplate } = await import('./worker/sms-templates');
    return handleCreateSmsTemplate(request, env, auth);
  }
  const smsTemplateIdMatch = path.match(/^\/api\/sms-templates\/([^/]+)$/);
  if (smsTemplateIdMatch && method === 'PUT') {
    const { handleUpdateSmsTemplate } = await import('./worker/sms-templates');
    return handleUpdateSmsTemplate(request, env, auth, smsTemplateIdMatch[1]!);
  }
  if (smsTemplateIdMatch && method === 'DELETE') {
    const { handleDeleteSmsTemplate } = await import('./worker/sms-templates');
    return handleDeleteSmsTemplate(env, auth, smsTemplateIdMatch[1]!);
  }
  // Config connexion WhatsApp Business (squelette flag-inactif).
  if (path === '/api/integrations/whatsapp' && method === 'GET') {
    const { handleGetWhatsAppConnection } = await import('./worker/whatsapp');
    return handleGetWhatsAppConnection(env, auth, url);
  }
  if (path === '/api/integrations/whatsapp' && method === 'POST') {
    const { handleSaveWhatsAppConnection } = await import('./worker/whatsapp');
    return handleSaveWhatsAppConnection(request, env, auth);
  }

  // Compliance (CASL, Loi 25)
  if (path === '/api/unsubscribes' && method === 'GET') return handleGetUnsubscribes(env, auth, url);
  if (path === '/api/consent' && method === 'GET') return handleGetConsent(env, auth, url);
  if (path === '/api/consent' && method === 'POST') return handleLogConsent(request, env, auth);

  // ── Sprint 93 — Purge RGPD & Loi 25 automatisée ─────────────────────────
  if (path === '/api/compliance/purge/rules' && method === 'GET') return handleGetPurgeRules(env, auth, url);
  if (path === '/api/compliance/purge/rules' && method === 'POST') return handleCreatePurgeRule(request, env, auth);
  const purgeRuleMatch = path.match(/^\/api\/compliance\/purge\/rules\/([^/]+)$/);
  if (purgeRuleMatch && method === 'PATCH') return handleUpdatePurgeRule(request, env, auth, purgeRuleMatch[1]!);
  if (purgeRuleMatch && method === 'DELETE') return handleDeletePurgeRule(env, auth, purgeRuleMatch[1]!);
  if (path === '/api/compliance/purge/preview' && method === 'GET') return handlePreviewPurge(env, auth, url);
  if (path === '/api/compliance/purge/run' && method === 'POST') return handleRunPurge(request, env, auth);

  // ── Sprint 98 — Rich Push Notifications ─────────────────────────────────
  if (path === '/api/push/subscribe' && method === 'POST') {
    const { handlePushSubscribe } = await import('./worker/push-notifications');
    return handlePushSubscribe(request, env, auth);
  }
  if (path === '/api/push/unsubscribe' && method === 'DELETE') {
    const { handlePushUnsubscribe } = await import('./worker/push-notifications');
    return handlePushUnsubscribe(request, env, auth);
  }
  if (path === '/api/push/subscriptions' && method === 'GET') {
    const { handleGetPushSubscriptions } = await import('./worker/push-notifications');
    return handleGetPushSubscriptions(env, auth);
  }
  if (path === '/api/push/test' && method === 'POST') {
    const { handlePushTest } = await import('./worker/push-notifications');
    return handlePushTest(env, auth);
  }

  // Sprint 51 M2 — Sources de leads (connecteur entrant)
  if (path === '/api/lead-sources' && method === 'GET') {
    const m = await import('./worker/lead-sources');
    return m.handleGetLeadSources(env, auth);
  }
  if (path === '/api/lead-sources' && method === 'POST') {
    const m = await import('./worker/lead-sources');
    return m.handleCreateLeadSource(request, env, auth);
  }
  {
    const lsLeads = path.match(/^\/api\/lead-sources\/([^/]+)\/leads$/);
    if (lsLeads && method === 'GET') {
      const m = await import('./worker/lead-sources');
      return m.handleGetLeadSourceLeads(env, auth, lsLeads[1]!, url);
    }
    const lsRotate = path.match(/^\/api\/lead-sources\/([^/]+)\/rotate-token$/);
    if (lsRotate && method === 'POST') {
      const m = await import('./worker/lead-sources');
      return m.handleRotateLeadSourceToken(env, auth, lsRotate[1]!);
    }
    const lsId = path.match(/^\/api\/lead-sources\/([^/]+)$/);
    if (lsId && method === 'PATCH') {
      const m = await import('./worker/lead-sources');
      return m.handleUpdateLeadSource(request, env, auth, lsId[1]!);
    }
    if (lsId && method === 'DELETE') {
      const m = await import('./worker/lead-sources');
      return m.handleDeleteLeadSource(env, auth, lsId[1]!);
    }
  }


  // Conversations (Sprint 3)
  if (path === '/api/conversations' && method === 'GET') return handleGetConversations(env, auth, url);
  if (path === '/api/conversations' && method === 'POST') return handleCreateConversation(request, env, auth);
  const convMatch = path.match(/^\/api\/conversations\/([^/]+)$/);
  if (convMatch && method === 'GET') return handleGetConversationDetail(env, auth, convMatch[1]!, url);
  if (convMatch && method === 'PATCH') return handleUpdateConversation(request, env, auth, convMatch[1]!);
  const convMsgMatch = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if (convMsgMatch && method === 'POST') return handleSendConversationMessage(request, env, auth, convMsgMatch[1]!);
  const markReadMatch = path.match(/^\/api\/conversations\/([^/]+)\/mark-read$/);
  if (markReadMatch && method === 'POST') {
    await env.DB.prepare('UPDATE conversations SET unread_count = 0, updated_at = datetime(\'now\') WHERE id = ?').bind(markReadMatch[1]!).run();
    return new Response(JSON.stringify({ data: { success: true } }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Clavardage Interne Équipe (Sprint 57)
  if (path === '/api/internal/channels' && method === 'GET') {
    const { handleGetInternalChannels } = await import('./worker/internal-chat');
    return await handleGetInternalChannels(env, auth);
  }
  if (path === '/api/internal/channels' && method === 'POST') {
    const { handleCreateInternalChannel } = await import('./worker/internal-chat');
    return await handleCreateInternalChannel(request, env, auth);
  }
  const intChanMsgsMatch = path.match(/^\/api\/internal\/channels\/([^/]+)\/messages$/);
  if (intChanMsgsMatch && method === 'GET') {
    const { handleGetInternalChannelMessages } = await import('./worker/internal-chat');
    return await handleGetInternalChannelMessages(env, auth, intChanMsgsMatch[1]!);
  }
  if (intChanMsgsMatch && method === 'POST') {
    const { handleSendInternalMessage } = await import('./worker/internal-chat');
    return await handleSendInternalMessage(request, env, auth, intChanMsgsMatch[1]!);
  }

  // Softphone SIP WebRTC (Sprint 58)
  if (path === '/api/twilio/webrtc/token' && method === 'GET') {
    const { handleGetTwilioWebrtcToken } = await import('./worker/webrtc-token');
    return await handleGetTwilioWebrtcToken(env, auth);
  }

  // Notifications Push Mobile (Sprint 59)
  if (path === '/api/user/push-token' && method === 'POST') {
    const { handleRegisterPushToken } = await import('./worker/push');
    return await handleRegisterPushToken(request, env, auth);
  }

  // Templates & Snippets
  if (path === '/api/templates' && method === 'GET') return handleGetTemplates(env, auth, url);
  if (path === '/api/templates' && method === 'POST') return handleCreateTemplate(request, env, auth);
  if (path === '/api/templates/interpolate' && method === 'POST') { const { handleInterpolateTemplate } = await import('./worker/templates'); return await handleInterpolateTemplate(request, env, auth); }
  const tplMatch = path.match(/^\/api\/templates\/([^/]+)$/);
  if (tplMatch && method === 'PATCH') return handleUpdateTemplate(request, env, auth, tplMatch[1]!);
  if (tplMatch && method === 'DELETE') return handleDeleteTemplate(env, auth, tplMatch[1]!);
  const dupMatch = path.match(/^\/api\/templates\/([^/]+)\/duplicate$/);
  if (dupMatch && method === 'POST') return handleDuplicateTemplate(env, auth, dupMatch[1]!);
  const testEmailMatch = path.match(/^\/api\/templates\/([^/]+)\/test$/);
  if (testEmailMatch && method === 'POST') return handleSendTestEmail(request, env, auth);

  // Email designs (Sprint 60 Constructeur de courriels Drag-and-Drop)
  if (path === '/api/email-designs' && method === 'GET') {
    const { handleGetEmailDesigns } = await import('./worker/email-builder');
    return await handleGetEmailDesigns(env, auth);
  }
  if (path === '/api/email-designs' && method === 'POST') {
    const { handleCreateEmailDesign } = await import('./worker/email-builder');
    return await handleCreateEmailDesign(request, env, auth);
  }
  const emailDesignMatch = path.match(/^\/api\/email-designs\/([^/]+)$/);
  if (emailDesignMatch && method === 'GET') {
    const { handleGetEmailDesign } = await import('./worker/email-builder');
    return await handleGetEmailDesign(env, auth, emailDesignMatch[1]!);
  }
  if (emailDesignMatch && method === 'PUT') {
    const { handleUpdateEmailDesign } = await import('./worker/email-builder');
    return await handleUpdateEmailDesign(request, env, auth, emailDesignMatch[1]!);
  }
  if (emailDesignMatch && method === 'DELETE') {
    const { handleDeleteEmailDesign } = await import('./worker/email-builder');
    return await handleDeleteEmailDesign(env, auth, emailDesignMatch[1]!);
  }

  if (path === '/api/snippets' && method === 'GET') { const { handleGetSnippets } = await import('./worker/snippets'); return await handleGetSnippets(env, auth); }
  if (path === '/api/snippets' && method === 'POST') { const { handleCreateSnippet } = await import('./worker/snippets'); return await handleCreateSnippet(request, env, auth); }
  const snippetMatch = path.match(/^\/api\/snippets\/([^/]+)$/);
  if (snippetMatch && method === 'PATCH') { const { handleUpdateSnippet } = await import('./worker/snippets'); return await handleUpdateSnippet(request, env, auth, snippetMatch[1]!); }
  if (snippetMatch && method === 'DELETE') { const { handleDeleteSnippet } = await import('./worker/snippets'); return await handleDeleteSnippet(env, auth, snippetMatch[1]!); }

  // Workflows
  if (path === '/api/workflows' && method === 'GET') return handleGetWorkflows(env, auth, url);
  if (path === '/api/workflows' && method === 'POST') return handleCreateWorkflow(request, env, auth);
  // LOT AUTOMATION BUILDER seq 105 (Sprint 4) — sous-routes SPÉCIFIQUES câblées
  // AVANT le matcher générique /api/workflows/:id (sinon 'from-template' /
  // 'exec-log' / 'simulate' seraient avalés comme un :id). Capability
  // 'workflows.manage' appliquée DANS les handlers (capGuard). Corps Phase B.
  // /workflow-templates est un chemin DISTINCT (pas sous /workflows/:id).
  if (path === '/api/workflow-templates' && method === 'GET') return handleGetWorkflowTemplates(env, auth);
  if (path === '/api/workflows/from-template' && method === 'POST') return handleCreateWorkflowFromTemplate(request, env, auth);
  const wfExecLog = path.match(/^\/api\/workflows\/([^/]+)\/exec-log$/);
  if (wfExecLog && method === 'GET') return handleGetWorkflowExecLog(env, auth, wfExecLog[1]!);
  const wfSimulate = path.match(/^\/api\/workflows\/([^/]+)\/simulate$/);
  if (wfSimulate && method === 'POST') return handleSimulateWorkflow(request, env, auth, wfSimulate[1]!);
  const wfMatch = path.match(/^\/api\/workflows\/([^/]+)$/);
  if (wfMatch && method === 'GET') return handleGetWorkflowDetail(env, auth, wfMatch[1]!);
  if (wfMatch && method === 'PATCH') return handleUpdateWorkflow(request, env, auth, wfMatch[1]!);
  if (wfMatch && method === 'DELETE') return handleDeleteWorkflow(env, auth, wfMatch[1]!);
  const wfToggle = path.match(/^\/api\/workflows\/([^/]+)\/toggle$/);
  if (wfToggle && method === 'POST') return handleToggleWorkflow(request, env, auth, wfToggle[1]!);
  const wfEnroll = path.match(/^\/api\/workflows\/([^/]+)\/enroll$/);
  if (wfEnroll && method === 'POST') return handleEnrollLead(request, env, auth, wfEnroll[1]!);

  // Appointments
  if (path === '/api/appointments' && method === 'GET') return handleGetAppointments(env, auth, url);
  if (path === '/api/appointments' && method === 'POST') return handleCreateAppointment(request, env, auth);
  const apptMatch = path.match(/^\/api\/appointments\/([^/]+)$/);
  if (apptMatch && method === 'PATCH') return handleUpdateAppointment(request, env, auth, apptMatch[1]!);
  if (apptMatch && method === 'DELETE') return handleDeleteAppointment(env, auth, apptMatch[1]!);
  const apptRescheduleMatch = path.match(/^\/api\/appointments\/([^/]+)\/reschedule$/);
  if (apptRescheduleMatch && method === 'PATCH') {
    const { handleRescheduleAppointment } = await import('./worker/appointments');
    return await handleRescheduleAppointment(request, env, auth, apptRescheduleMatch[1]!);
  }
  const apptReminderMatch = path.match(/^\/api\/appointments\/([^/]+)\/send-reminder-now$/);
  if (apptReminderMatch && method === 'POST') {
    const { handleSendReminderNow } = await import('./worker/appointments');
    return await handleSendReminderNow(env, auth, apptReminderMatch[1]!);
  }

  // Calendar Engine (Phase 24)
  if (path === '/api/calendars' && method === 'GET') { const { handleGetCalendars } = await import('./worker/calendar'); return await handleGetCalendars(env, auth); }
  if (path === '/api/calendars' && method === 'POST') { const { handleCreateCalendar } = await import('./worker/calendar'); return await handleCreateCalendar(request, env, auth); }
  const calMatch = path.match(/^\/api\/calendars\/([^/]+)$/);
  if (calMatch && method === 'PATCH') { const { handleUpdateCalendar } = await import('./worker/calendar'); return await handleUpdateCalendar(request, env, auth, calMatch[1]!); }
  if (calMatch && method === 'DELETE') { const { handleDeleteCalendar } = await import('./worker/calendar'); return await handleDeleteCalendar(env, auth, calMatch[1]!); }

  if (path === '/api/availability-rules' && method === 'GET') { const { handleGetAvailabilityRules } = await import('./worker/calendar'); return await handleGetAvailabilityRules(env, auth); }
  if (path === '/api/availability-rules' && method === 'POST') { const { handleCreateAvailabilityRule } = await import('./worker/calendar'); return await handleCreateAvailabilityRule(request, env, auth); }
  const ruleMatch = path.match(/^\/api\/availability-rules\/([^/]+)$/);
  if (ruleMatch && method === 'DELETE') { const { handleDeleteAvailabilityRule } = await import('./worker/calendar'); return await handleDeleteAvailabilityRule(env, auth, ruleMatch[1]!); }

  if (path === '/api/date-overrides' && method === 'GET') { const { handleGetDateOverrides } = await import('./worker/calendar'); return await handleGetDateOverrides(env, auth); }
  if (path === '/api/date-overrides' && method === 'POST') { const { handleCreateDateOverride } = await import('./worker/calendar'); return await handleCreateDateOverride(request, env, auth); }
  const overrideMatch = path.match(/^\/api\/date-overrides\/([^/]+)$/);
  if (overrideMatch && method === 'DELETE') { const { handleDeleteDateOverride } = await import('./worker/calendar'); return await handleDeleteDateOverride(env, auth, overrideMatch[1]!); }

  if (path === '/api/availability' && method === 'GET') { const { handleGetAvailability } = await import('./worker/calendar'); return await handleGetAvailability(env, url); }

  // Tasks
  if (path === '/api/tasks' && method === 'GET') return handleGetTasks(env, auth, url);
  if (path === '/api/tasks' && method === 'POST') return handleCreateTask(request, env, auth);
  const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && method === 'GET') return handleGetTask(env, auth, taskMatch[1]!);
  if (taskMatch && method === 'PATCH') return handlePatchTask(request, env, auth, taskMatch[1]!);
  if (taskMatch && method === 'DELETE') return handleDeleteTask(env, auth, taskMatch[1]!);

  const subtasksMatch = path.match(/^\/api\/tasks\/([^/]+)\/subtasks$/);
  if (subtasksMatch && method === 'GET') { const { handleGetSubtasks } = await import('./worker/tasks'); return await handleGetSubtasks(env, subtasksMatch[1]!); }
  if (subtasksMatch && method === 'POST') { const { handleCreateSubtask } = await import('./worker/tasks'); return await handleCreateSubtask(request, env, subtasksMatch[1]!); }
  const subtaskMatch = path.match(/^\/api\/subtasks\/([^/]+)$/);
  if (subtaskMatch && method === 'PATCH') { const { handleUpdateSubtask } = await import('./worker/tasks'); return await handleUpdateSubtask(request, env, subtaskMatch[1]!); }
  if (subtaskMatch && method === 'DELETE') { const { handleDeleteSubtask } = await import('./worker/tasks'); return await handleDeleteSubtask(env, subtaskMatch[1]!); }

  const taskCommentsMatch = path.match(/^\/api\/tasks\/([^/]+)\/comments$/);
  if (taskCommentsMatch && method === 'GET') { const { handleGetTaskComments } = await import('./worker/tasks'); return await handleGetTaskComments(env, taskCommentsMatch[1]!); }
  if (taskCommentsMatch && method === 'POST') { const { handleCreateTaskComment } = await import('./worker/tasks'); return await handleCreateTaskComment(request, env, auth, taskCommentsMatch[1]!); }
  const taskCommentMatch = path.match(/^\/api\/task-comments\/([^/]+)$/);
  if (taskCommentMatch && method === 'DELETE') { const { handleDeleteTaskComment } = await import('./worker/tasks'); return await handleDeleteTaskComment(env, auth, taskCommentMatch[1]!); }

  if (path === '/api/task-templates' && method === 'GET') { const { handleGetTaskTemplates } = await import('./worker/tasks'); return await handleGetTaskTemplates(env, auth); }
  if (path === '/api/task-templates' && method === 'POST') { const { handleCreateTaskTemplate } = await import('./worker/tasks'); return await handleCreateTaskTemplate(request, env, auth); }
  const taskTemplateMatch = path.match(/^\/api\/task-templates\/([^/]+)$/);
  if (taskTemplateMatch && method === 'DELETE') { const { handleDeleteTaskTemplate } = await import('./worker/tasks'); return await handleDeleteTaskTemplate(env, auth, taskTemplateMatch[1]!); }
  if (path === '/api/task-templates/apply' && method === 'POST') { const { handleApplyTaskTemplate } = await import('./worker/tasks'); return await handleApplyTaskTemplate(request, env, auth); }

  // Notifications
  if (path === '/api/notifications' && method === 'GET') return handleGetNotifications(env, auth, url);
  if (path === '/api/notifications/read-all' && method === 'POST') return handleReadAllNotifications(env, auth);
  // Sprint 46 M3.3 — Bulk PUT matrix (full replace channels × events)
  if (path === '/api/notifications/preferences' && method === 'PUT') {
    const { handleSetNotificationPreferencesMatrix } = await import('./worker/notifications-ws');
    return await handleSetNotificationPreferencesMatrix(request, env, auth);
  }
  const notifMatch = path.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if (notifMatch && method === 'PATCH') return handleReadNotification(env, auth, notifMatch[1]!);

  // Pipelines
  if (path === '/api/pipelines' && method === 'GET') return handleGetPipelines(env, auth);
  if (path === '/api/pipelines' && method === 'POST') return handleCreatePipeline(request, env, auth);
  const pipeMatch = path.match(/^\/api\/pipelines\/([^/]+)$/);
  if (pipeMatch && method === 'PATCH') return handleUpdatePipeline(request, env, auth, pipeMatch[1]!);
  if (pipeMatch && method === 'DELETE') return handleDeletePipeline(env, auth, pipeMatch[1]!);
  const pipeForecastMatch = path.match(/^\/api\/pipelines\/([^/]+)\/forecast$/);
  if (pipeForecastMatch && method === 'GET') return handleGetPipelineForecast(env, auth, pipeForecastMatch[1]!, url);
  const stagesMatch = path.match(/^\/api\/pipelines\/([^/]+)\/stages$/);
  if (stagesMatch && method === 'GET') return handleGetPipelineStages(env, auth, stagesMatch[1]!);
  if (stagesMatch && method === 'POST') return handleCreatePipelineStage(request, env, auth, stagesMatch[1]!);
  const stageMatch = path.match(/^\/api\/pipelines\/([^/]+)\/stages\/([^/]+)$/);
  if (stageMatch && method === 'PATCH') return handleUpdatePipelineStage(request, env, auth, stageMatch[1]!, stageMatch[2]!);
  if (stageMatch && method === 'DELETE') return handleDeletePipelineStage(env, auth, stageMatch[1]!, stageMatch[2]!);
  if (stagesMatch && path.endsWith('/reorder') && method === 'POST') return handleReorderPipelineStages(request, env, auth, stagesMatch[1]!);

  if (path === '/api/lost-reasons' && method === 'GET') return handleGetLostReasons(env, auth);
  if (path === '/api/lost-reasons' && method === 'POST') return handleCreateLostReason(request, env, auth);

  // ── Sprint 14 — Forecasting enrichi (projection + objectifs + scénarios) ──
  //    Routes NEUVES, tenant-bornées DANS le handler (capGuard reports.view
  //    mode-agence-only). DISTINCTES de /api/pipelines/:id/forecast (forecast
  //    pondéré naïf existant — INTOUCHÉ). Anti-shadowing : la collection
  //    /api/forecast/targets et l'item /api/forecast/targets/:id sont déclarées
  //    AVANT /api/forecast (path EXACT, pas de chevauchement). STUB Phase A →
  //    corps réel Phase B Manager-B (forecast-engine.ts).
  if (path === '/api/forecast/targets' && method === 'GET') return handleGetForecastTargets(env, auth, url);
  if (path === '/api/forecast/targets' && method === 'POST') return handleCreateForecastTarget(request, env, auth);
  const forecastTargetMatch = path.match(/^\/api\/forecast\/targets\/([^/]+)$/);
  if (forecastTargetMatch && method === 'DELETE') return handleDeleteForecastTarget(env, auth, forecastTargetMatch[1]!);
  if (path === '/api/forecast' && method === 'GET') return handleGetForecast(env, auth, url);

  // SMS
  if (path === '/api/sms/send' && method === 'POST') return handleSendSmsRoute(request, env, auth);

  // 2FA TOTP
  if (path === '/api/auth/totp/setup' && method === 'POST') return handleTotpSetup(env, auth);
  if (path === '/api/auth/totp/verify' && method === 'POST') return handleTotpVerify(request, env, auth);
  if (path === '/api/auth/totp/disable' && method === 'POST') return handleTotpDisable(request, env, auth);

  // Reports
  // ── LOT TEAM C — rapports agrégés cross-sous-comptes ────────────────────
  if (path === '/api/reports/agency' && method === 'GET') return handleGetAgencyReports(env, auth, url);
  if (path === '/api/reports/overview' && method === 'GET') return handleReportsOverview(env, auth, url);
  if (path === '/api/reports/sources' && method === 'GET') return handleReportsSources(env, auth, url);
  if (path === '/api/reports/conversion' && method === 'GET') return handleReportsConversion(env, auth, url);
  // ── LOT ATTRIBUTION-D — attribution multi-touch & cohortes leads (lecture) ──
  //    2 routes NEUVES GET, tenant-bornées DANS le handler (garde capability
  //    mode-agence-only calque handleRunReportWidget). STUB Phase A → corps réel
  //    Phase B Manager-B (4 modèles + cohortes JS).
  if (path === '/api/reports/attribution' && method === 'GET') return handleReportsAttribution(env, auth, url);
  if (path === '/api/reports/lead-cohorts' && method === 'GET') return handleReportsLeadCohorts(env, auth, url);

  if (path === '/api/reports/saved' && method === 'GET') return handleGetSavedReports(env, auth);
  if (path === '/api/reports/saved' && method === 'POST') return handleCreateSavedReport(request, env, auth);
  const savedReportMatch = path.match(/^\/api\/reports\/saved\/([^/]+)$/);
  if (savedReportMatch && method === 'DELETE') return handleDeleteSavedReport(env, auth, savedReportMatch[1]!);

  // ── LOT D Reports Builder Hardening — dispatcher widget UNIQUE ──────────
  //    POST /api/reports/widget : route NEUVE, tenant-bornée (calque
  //    LOT B-bis mode-agence-only DANS le handler). Anti-prolifération
  //    d'endpoints data non-bornés. Body `{source, dimension, metric,
  //    filters?, dashboard_id?}` → dispatch interne Phase B Manager-B
  //    (ecommerce-analytics / clients-admin / leads / tasks bornés
  //    tenant). STUB Phase A → corps réel Phase B Manager-B.
  if (path === '/api/reports/widget' && method === 'POST') return handleRunReportWidget(request, env, auth);

  // Sprint 46 M1.3 — Dashboards builder (CRUD + share)
  if (path === '/api/dashboards' && method === 'GET') return handleGetDashboards(env, auth);
  if (path === '/api/dashboards' && method === 'POST') return handleCreateDashboard(request, env, auth);
  const dashMatch = path.match(/^\/api\/dashboards\/(\d+)$/);
  if (dashMatch && method === 'GET') return handleGetDashboard(env, auth, dashMatch[1]!);
  if (dashMatch && method === 'PUT') return handleUpdateDashboard(request, env, auth, dashMatch[1]!);
  if (dashMatch && method === 'DELETE') return handleDeleteDashboard(env, auth, dashMatch[1]!);
  const dashShareMatch = path.match(/^\/api\/dashboards\/(\d+)\/share$/);
  if (dashShareMatch && (method === 'POST' || method === 'GET')) return handleShareDashboard(env, auth, dashShareMatch[1]!);

  // SPRINT 15 — Reports builder templates (catalogue clonable). DISTINCT de
  // /api/reports/* (data) et /api/scheduled-reports/* (planif) — paths EXACTS.
  // Anti-shadowing : /api/report-templates/:id/apply (path EXACT) déclarée AVANT
  // la liste — pas de regex chevauchante. capGuard reports.view (lecture) /
  // workflows.manage (clone) DANS les handlers. STUB Phase A → corps Phase B.
  if (path === '/api/report-templates' && method === 'GET') return handleGetReportTemplates(env, auth);
  const reportTemplateApplyMatch = path.match(/^\/api\/report-templates\/([^/]+)\/apply$/);
  if (reportTemplateApplyMatch && method === 'POST') return handleApplyReportTemplate(env, auth, reportTemplateApplyMatch[1]!);

  // LOT SCHEDREPORT Sprint A — rapports d'activité planifiés (CRUD, cap reports.view,
  // borné tenant). Le cron (processScheduledReports) est branché best-effort dans
  // scheduled() ; ici seulement le CRUD. STUB processor/digest → corps Phase B.
  if (path === '/api/scheduled-reports' && method === 'GET') return handleListScheduledReports(env, auth, url);
  if (path === '/api/scheduled-reports' && method === 'POST') return handleCreateScheduledReport(request, env, auth);
  const schedReportMatch = path.match(/^\/api\/scheduled-reports\/([^/]+)$/);
  if (schedReportMatch && method === 'PATCH') return handleUpdateScheduledReport(request, env, auth, schedReportMatch[1]!);
  if (schedReportMatch && method === 'DELETE') return handleDeleteScheduledReport(env, auth, schedReportMatch[1]!);

  // LOT PROACTIVE-C Sprint A — IA proactive (cap ai.use, borné tenant). Lecture +
  // dismiss/seen des alertes ; le batch (runProactiveBatch) est branché best-effort
  // dans scheduled(). STUB batch/générateurs → corps Phase B Manager-B.
  if (path === '/api/ai/proactive/alerts' && method === 'GET') return handleListProactiveAlerts(env, auth, url);
  const proactiveSeenMatch = path.match(/^\/api\/ai\/proactive\/alerts\/([^/]+)\/seen$/);
  if (proactiveSeenMatch && method === 'POST') return handleMarkProactiveAlertSeen(env, auth, proactiveSeenMatch[1]!);
  const proactiveDismissMatch = path.match(/^\/api\/ai\/proactive\/alerts\/([^/]+)\/dismiss$/);
  if (proactiveDismissMatch && method === 'POST') return handleDismissProactiveAlert(env, auth, proactiveDismissMatch[1]!);

  // Broadcast
  if (path === '/api/broadcast' && method === 'POST') return handleEmailBroadcast(request, env, auth);
  if (path === '/api/broadcasts' && method === 'GET') return handleGetBroadcasts(env, auth, url);
  // LOT G6 — variantes A/B : sous-route /:id/variants AVANT le match générique
  // /api/broadcasts/:id (sinon "variants" serait avalé comme un broadcastId).
  const broadcastVariantsMatch = path.match(/^\/api\/broadcasts\/([^/]+)\/variants$/);
  if (broadcastVariantsMatch && method === 'GET') return handleGetVariants(env, auth, broadcastVariantsMatch[1]!);
  if (broadcastVariantsMatch && method === 'POST') return handleSetVariants(request, env, auth, broadcastVariantsMatch[1]!);
  const broadcastMatch = path.match(/^\/api\/broadcasts\/([^/]+)$/);
  if (broadcastMatch && method === 'GET') return handleGetBroadcastDetail(env, auth, broadcastMatch[1]!);

  // Sequences (Sprint 5 — wrapper léger sur le moteur workflows EXISTANT ;
  // capability workflows.manage réutilisée DANS les handlers ; aucun nouveau
  // scheduler). Stubs Phase A → corps Phase B.
  if (path === '/api/sequences' && method === 'GET') return handleGetSequences(env, auth, url);
  if (path === '/api/sequences' && method === 'POST') return handleCreateSequence(request, env, auth);
  const seqEnroll = path.match(/^\/api\/sequences\/([^/]+)\/enroll$/);
  if (seqEnroll && method === 'POST') return handleEnrollSequence(request, env, auth, seqEnroll[1]!);
  // Sprint 2 — Sequence Analytics : sous-route /:id/stats AVANT le match
  // générique /api/sequences/:id (sinon "stats" serait avalé comme un id).
  const seqStats = path.match(/^\/api\/sequences\/([^/]+)\/stats$/);
  if (seqStats && method === 'GET') return handleGetSequenceStats(env, auth, seqStats[1]!);
  const seqMatch = path.match(/^\/api\/sequences\/([^/]+)$/);
  if (seqMatch && method === 'GET') return handleGetSequenceDetail(env, auth, seqMatch[1]!);
  if (seqMatch && method === 'PUT') return handleUpdateSequence(request, env, auth, seqMatch[1]!);
  if (seqMatch && method === 'DELETE') return handleDeleteSequence(env, auth, seqMatch[1]!);

  // ── LOT G6 — Segments de leads dynamiques (PROTÉGÉ). Capability
  //    'workflows.manage' appliquée DANS les handlers (capGuard calque
  //    funnels.ts / sequences). Sous-routes spécifiques (/preview, /:id/enroll)
  //    AVANT /:id générique (sinon shadowing). Corps réels Phase B Manager-B.
  if (path === '/api/segments' && method === 'GET') return handleGetSegments(env, auth, url);
  if (path === '/api/segments' && method === 'POST') return handleCreateSegment(request, env, auth);
  if (path === '/api/segments/preview' && method === 'POST') return handlePreviewSegment(request, env, auth);
  const segEnroll = path.match(/^\/api\/segments\/([^/]+)\/enroll$/);
  if (segEnroll && method === 'POST') return handleEnrollSegment(request, env, auth, segEnroll[1]!);
  const segMatch = path.match(/^\/api\/segments\/([^/]+)$/);
  if (segMatch && method === 'GET') return handleGetSegment(env, auth, segMatch[1]!);
  if (segMatch && method === 'PUT') return handleUpdateSegment(request, env, auth, segMatch[1]!);
  if (segMatch && method === 'DELETE') return handleDeleteSegment(env, auth, segMatch[1]!);

  // Booking Pages
  if (path === '/api/booking-pages' && method === 'GET') return handleGetBookingPages(env, auth);
  if (path === '/api/booking-pages' && method === 'POST') return handleCreateBookingPage(request, env, auth);
  const bookingMatch = path.match(/^\/api\/booking-pages\/([^/]+)$/);
  if (bookingMatch && method === 'PATCH') return handleUpdateBookingPage(request, env, auth, bookingMatch[1]!);
  if (bookingMatch && method === 'DELETE') return handleDeleteBookingPage(env, auth, bookingMatch[1]!);
  const bookingsListMatch = path.match(/^\/api\/booking-pages\/([^/]+)\/bookings$/);
  if (bookingsListMatch && method === 'GET') return handleGetBookings(env, auth, bookingsListMatch[1]!, url);

  // ── LOT BOOKING — CRUD types de RDV (PROTÉGÉ). Garde capability
  //    'workflows.manage' appliquée DANS les handlers (calque funnels.ts /
  //    clients-admin.ts requireCapability). Sous-route /:id AVANT collection
  //    n/a (collection vs /:id discriminés par regex). Corps Phase B Manager-B.
  if (path === '/api/booking-event-types' && method === 'GET') return handleListEventTypes(env, auth, url);
  if (path === '/api/booking-event-types' && method === 'POST') return handleCreateEventType(request, env, auth);
  const eventTypeMatch = path.match(/^\/api\/booking-event-types\/([^/]+)$/);
  if (eventTypeMatch && method === 'PUT') return handleUpdateEventType(request, env, auth, eventTypeMatch[1]!);
  if (eventTypeMatch && method === 'DELETE') return handleDeleteEventType(env, auth, eventTypeMatch[1]!);

  // ── LOT BOOKING REMINDERS — no-show tracking (PROTÉGÉ). Garde capability
  //    'workflows.manage' DANS le handler (calque booking-public.ts:capGuard).
  //    Préfixe '/api/bookings/' DISJOINT de '/api/booking-pages/' &
  //    '/api/booking-event-types/' (zéro shadowing). Corps Phase B Manager-B.
  const bookingNoShowMatch = path.match(/^\/api\/bookings\/([^/]+)\/no-show$/);
  if (bookingNoShowMatch && method === 'POST') return handleMarkNoShow(env, auth, bookingNoShowMatch[1]!);

  // Forms
  if (path === '/api/forms' && method === 'GET') return handleGetForms(env, auth);
  if (path === '/api/forms' && method === 'POST') return handleCreateForm(request, env, auth);
  const formMatch = path.match(/^\/api\/forms\/([^/]+)$/);
  if (formMatch && method === 'GET') return handleGetForm(env, auth, formMatch[1]!);
  if (formMatch && method === 'PATCH') return handleUpdateForm(request, env, auth, formMatch[1]!);
  if (formMatch && method === 'DELETE') return handleDeleteForm(env, auth, formMatch[1]!);
  const statsFormMatch = path.match(/^\/api\/forms\/([^/]+)\/stats$/);
  if (statsFormMatch && method === 'GET') return handleGetFormStats(env, auth, statsFormMatch[1]!);
  // ── LOT FORMS XL (Sprint 5) — analytics drop-off par champ (PROTÉGÉ, admin
  //    via auth.role dans le handler, comme les autres handlers forms). Corps
  //    réel Phase B. Voir docs/LOT-FORMS-XL.md §6.E.
  const fieldAnalyticsMatch = path.match(/^\/api\/forms\/([^/]+)\/field-analytics$/);
  if (fieldAnalyticsMatch && method === 'GET') return handleGetFormFieldAnalytics(env, auth, fieldAnalyticsMatch[1]!);

  // ── LOT FUNNEL — builder landing pages / funnels (PROTÉGÉ). Garde
  //    capability 'workflows.manage' appliquée DANS les handlers (calque
  //    clients-admin.ts requireCapability). Sous-routes spécifiques AVANT
  //    /:id générique (sinon shadowing). Corps réels Phase B Manager-B.
  if (path === '/api/funnels' && method === 'GET') return handleGetFunnels(env, auth, url);
  if (path === '/api/funnels' && method === 'POST') return handleCreateFunnel(request, env, auth);
  const funnelPageMatch = path.match(/^\/api\/funnels\/([^/]+)\/pages\/([^/]+)$/);
  if (funnelPageMatch && method === 'PUT') return handleSaveFunnelPage(request, env, auth, funnelPageMatch[1]!, funnelPageMatch[2]!);
  const funnelPublishMatch = path.match(/^\/api\/funnels\/([^/]+)\/publish$/);
  if (funnelPublishMatch && method === 'POST') return handlePublishFunnel(request, env, auth, funnelPublishMatch[1]!);
  const funnelStatsMatch = path.match(/^\/api\/funnels\/([^/]+)\/stats$/);
  if (funnelStatsMatch && method === 'GET') return handleGetFunnelStats(env, auth, funnelStatsMatch[1]!);
  const funnelOffersMatch = path.match(/^\/api\/funnels\/([^/]+)\/offers$/);
  if (funnelOffersMatch && method === 'GET') return handleGetFunnelOffers(env, auth, funnelOffersMatch[1]!);
  if (funnelOffersMatch && method === 'POST') return handleSaveFunnelOffer(request, env, auth, funnelOffersMatch[1]!);
  const funnelOfferIdMatch = path.match(/^\/api\/funnels\/([^/]+)\/offers\/([^/]+)$/);
  if (funnelOfferIdMatch && method === 'DELETE') return handleDeleteFunnelOffer(env, auth, funnelOfferIdMatch[1]!, funnelOfferIdMatch[2]!);
  const funnelIdMatch = path.match(/^\/api\/funnels\/([^/]+)$/);
  if (funnelIdMatch && method === 'GET') return handleGetFunnel(env, auth, funnelIdMatch[1]!);
  if (funnelIdMatch && method === 'PUT') return handleUpdateFunnel(request, env, auth, funnelIdMatch[1]!);
  if (funnelIdMatch && method === 'DELETE') return handleDeleteFunnel(env, auth, funnelIdMatch[1]!);

  // ── LOT SITE BUILDER — sites multi-pages (PROTÉGÉ). Garde capability
  //    'workflows.manage' appliquée DANS les handlers (capGuard, calque
  //    funnels.ts). Sous-routes SPÉCIFIQUES (/pages, /pages/:pageId, /publish)
  //    AVANT /:id générique (anti-shadowing). Corps réels Phase B Manager-B.
  if (path === '/api/sites' && method === 'GET') return handleGetSites(env, auth, url);
  if (path === '/api/sites' && method === 'POST') return handleCreateSite(request, env, auth);
  const sitePageItemMatch = path.match(/^\/api\/sites\/([^/]+)\/pages\/([^/]+)$/);
  if (sitePageItemMatch && method === 'PUT') return handleSaveSitePage(request, env, auth, sitePageItemMatch[1]!, sitePageItemMatch[2]!);
  if (sitePageItemMatch && method === 'DELETE') return handleDeleteSitePage(env, auth, sitePageItemMatch[1]!, sitePageItemMatch[2]!);
  const sitePagesMatch = path.match(/^\/api\/sites\/([^/]+)\/pages$/);
  if (sitePagesMatch && method === 'GET') return handleGetSitePages(env, auth, sitePagesMatch[1]!);
  if (sitePagesMatch && method === 'POST') return handleCreateSitePage(request, env, auth, sitePagesMatch[1]!);
  const sitePublishMatch = path.match(/^\/api\/sites\/([^/]+)\/publish$/);
  if (sitePublishMatch && method === 'POST') return handlePublishSite(request, env, auth, sitePublishMatch[1]!);
  const siteIdMatch = path.match(/^\/api\/sites\/([^/]+)$/);
  if (siteIdMatch && method === 'GET') return handleGetSite(env, auth, siteIdMatch[1]!);
  if (siteIdMatch && method === 'PUT') return handleUpdateSite(request, env, auth, siteIdMatch[1]!);
  if (siteIdMatch && method === 'DELETE') return handleDeleteSite(env, auth, siteIdMatch[1]!);

  // ── LOT G7 MARKETPLACE — templates partageables (PROTÉGÉ). Garde
  //    'workflows.manage' appliquée DANS les handlers (capGuard, calque
  //    funnels.ts). Sous-routes SPÉCIFIQUES (/install, /reviews, /my-listings)
  //    AVANT le /:id générique (sinon shadowing). Corps réels Phase B Manager-B.
  if (path === '/api/marketplace/my-listings' && method === 'GET') return handleGetMyMarketplaceListings(env, auth);
  if (path === '/api/marketplace/listings' && method === 'POST') return handlePublishMarketplaceListing(request, env, auth);
  const mktInstallMatch = path.match(/^\/api\/marketplace\/listings\/([^/]+)\/install$/);
  if (mktInstallMatch && method === 'POST') return handleInstallMarketplaceListing(request, env, auth, mktInstallMatch[1]!);
  const mktReviewMatch = path.match(/^\/api\/marketplace\/listings\/([^/]+)\/reviews$/);
  if (mktReviewMatch && method === 'POST') return handleReviewMarketplaceListing(request, env, auth, mktReviewMatch[1]!);

  // ── LOT G1 HELPDESK — tickets de support + base de connaissances (PROTÉGÉ).
  //    Garde mode-agence-only helpdeskCapGuard ('leads.write' réutilisée)
  //    appliquée DANS les handlers (calque dashboards.ts:reportsCapGuard /
  //    LOT B-bis). Sous-route /reply AVANT /:id générique (sinon shadowing).
  //    Corps réels Phase B Manager-B (tickets.ts / kb.ts).
  if (path === '/api/tickets' && method === 'GET') return handleGetTickets(env, auth, url);
  if (path === '/api/tickets' && method === 'POST') return handleCreateTicket(request, env, auth);
  const ticketReplyMatch = path.match(/^\/api\/tickets\/([^/]+)\/reply$/);
  if (ticketReplyMatch && method === 'POST') return handleReplyTicket(request, env, auth, ticketReplyMatch[1]!);
  const ticketIdMatch = path.match(/^\/api\/tickets\/([^/]+)$/);
  if (ticketIdMatch && method === 'GET') return handleGetTicket(env, auth, ticketIdMatch[1]!);
  if (ticketIdMatch && method === 'PATCH') return handleUpdateTicket(request, env, auth, ticketIdMatch[1]!);

  if (path === '/api/kb' && method === 'GET') return handleGetKBArticles(env, auth, url);
  if (path === '/api/kb' && method === 'POST') return handleCreateKBArticle(request, env, auth);
  if (path === '/api/kb/index-all' && method === 'POST') return handleTriggerAllKbIndexing(env, auth);
  if (path === '/api/kb/index-status' && method === 'GET') return handleGetKbIndexStatus(env, auth);
  const kbIndexMatch = path.match(/^\/api\/kb\/([^/]+)\/index$/);
  if (kbIndexMatch && method === 'POST') return handleTriggerKbIndexing(env, auth, kbIndexMatch[1]!);
  const kbIdMatch = path.match(/^\/api\/kb\/([^/]+)$/);
  if (kbIdMatch && method === 'GET') return handleGetKBArticle(env, auth, kbIdMatch[1]!);
  if (kbIdMatch && method === 'PUT') return handleUpdateKBArticle(request, env, auth, kbIdMatch[1]!);
  if (kbIdMatch && method === 'DELETE') return handleDeleteKBArticle(env, auth, kbIdMatch[1]!);

  // ── LOT G2 AFFILIATION — programme d'affiliation (PROTÉGÉ). Garde
  //    mode-agence-only affiliateCapGuard ('workflows.manage' réutilisée)
  //    appliquée DANS les handlers (calque funnels.ts:capGuard / LOT B-bis).
  //    Anti-shadowing : /affiliate-commissions/export AVANT /:id ; le singleton
  //    /affiliate-program est DISTINCT de /affiliates/:id (pas de collision).
  //    Corps réels Phase B Manager-B (affiliates.ts).
  if (path === '/api/affiliates' && method === 'GET') return handleGetAffiliates(env, auth, url);
  if (path === '/api/affiliates' && method === 'POST') return handleCreateAffiliate(request, env, auth);
  // ── Sprint 49 — /affiliates/:id/metrics AVANT /:id (anti-shadowing).
  //    Cap clients.manage (handler). Voir docs/LOT-AFFILIATES-S49.md §6.
  const affiliateMetricsMatch = path.match(/^\/api\/affiliates\/([^/]+)\/metrics$/);
  if (affiliateMetricsMatch && method === 'GET') {
    const m = await import('./worker/affiliates');
    return m.handleGetAffiliateMetrics(env, auth, affiliateMetricsMatch[1]!);
  }
  const affiliateIdMatch = path.match(/^\/api\/affiliates\/([^/]+)$/);
  if (affiliateIdMatch && method === 'GET') return handleGetAffiliate(env, auth, affiliateIdMatch[1]!);
  if (affiliateIdMatch && method === 'PUT') return handleUpdateAffiliate(request, env, auth, affiliateIdMatch[1]!);
  // ── Sprint 49 — PATCH (cap clients.manage handler S49 update tier/commission).
  //    Le PUT S92 reste pour la legacy ; PATCH = chemin S49 (idempotent).
  if (affiliateIdMatch && method === 'PATCH') {
    const m = await import('./worker/affiliates');
    return m.handleUpdateAffiliateS49(request, env, auth, affiliateIdMatch[1]!);
  }
  if (affiliateIdMatch && method === 'DELETE') return handleDeleteAffiliate(env, auth, affiliateIdMatch[1]!);

  // Programme (singleton tenant) — DISTINCT de /affiliates/:id.
  if (path === '/api/affiliate-program' && method === 'GET') return handleGetAffiliateProgram(env, auth);
  if (path === '/api/affiliate-program' && method === 'PUT') return handleUpdateAffiliateProgram(request, env, auth);

  // Commissions — /export AVANT /:id (anti-shadowing).
  if (path === '/api/affiliate-commissions' && method === 'GET') return handleGetAffiliateCommissions(env, auth, url);
  if (path === '/api/affiliate-commissions/export' && method === 'GET') return handleExportAffiliateCommissions(env, auth, url);
  const commissionIdMatch = path.match(/^\/api\/affiliate-commissions\/([^/]+)$/);
  if (commissionIdMatch && method === 'PATCH') return handleUpdateCommissionStatus(request, env, auth, commissionIdMatch[1]!);

  // ── Sprint 49 — Referrals + Payouts (cap clients.manage + settings.manage)
  // 7 routes étendant le module affiliation S(G2) vers un modèle order-based
  // avec referrals confirmés/réversibles + payouts mensuels en batch.
  // Anti-shadowing : suffixes /:id/<action> AVANT /:id (jamais de collision
  // avec /affiliates/:id ci-dessus — namespace distinct affiliate-referrals/
  // affiliate-payouts).
  //   - /affiliate-referrals                        GET (list filtres)
  //   - /affiliate-referrals/:id/confirm            POST
  //   - /affiliate-referrals/:id/reverse            POST
  //   - /affiliate-payouts                          GET (list)
  //   - /affiliate-payouts                          POST (créer batch)
  //   - /affiliate-payouts/:id/mark-paid            POST
  // Caps FIGÉES : clients.manage (referrals) + settings.manage (payouts).
  // Voir docs/LOT-AFFILIATES-S49.md §6.
  if (path === '/api/affiliate-referrals' && method === 'GET') {
    const m = await import('./worker/affiliates');
    return m.handleListReferrals(env, auth, url);
  }
  const referralConfirmMatch = path.match(/^\/api\/affiliate-referrals\/([^/]+)\/confirm$/);
  if (referralConfirmMatch && method === 'POST') {
    const m = await import('./worker/affiliates');
    return m.handleConfirmReferral(env, auth, referralConfirmMatch[1]!);
  }
  const referralReverseMatch = path.match(/^\/api\/affiliate-referrals\/([^/]+)\/reverse$/);
  if (referralReverseMatch && method === 'POST') {
    const m = await import('./worker/affiliates');
    return m.handleReverseReferral(request, env, auth, referralReverseMatch[1]!);
  }
  if (path === '/api/affiliate-payouts' && method === 'GET') {
    const m = await import('./worker/affiliates');
    return m.handleListPayouts(env, auth, url);
  }
  if (path === '/api/affiliate-payouts' && method === 'POST') {
    const m = await import('./worker/affiliates');
    return m.handleCreatePayoutBatch(request, env, auth);
  }
  const payoutMarkPaidMatch = path.match(/^\/api\/affiliate-payouts\/([^/]+)\/mark-paid$/);
  if (payoutMarkPaidMatch && method === 'POST') {
    const m = await import('./worker/affiliates');
    return m.handleMarkPayoutPaid(request, env, auth, payoutMarkPaidMatch[1]!);
  }

  // ── Sprint 50 — Surveys avancés (LOT 5 FIN) + DNS records UI ─────────────
  //    Cap `settings.manage` mode-agence-only DANS les handlers (calque
  //    affiliates.ts settingsCapGuard — AUCUN ajout ALL_CAPABILITIES seq80).
  //    Sous-routes spécifiques AVANT /:id générique (anti-shadowing). Corps
  //    réels Phase B Manager-B (surveys.ts + custom-domains.ts + lib/
  //    survey-engine.ts + lib/dns-engine.ts). Routes câblées Phase A.
  //
  //    Surveys (~17 handlers — 16 AUTHED + 1 PUBLIC submit pré-requireAuth
  //    déjà câblé ~l.795 dans le bloc public) :
  //      - /surveys                          GET (list filtres) / POST (create)
  //      - /surveys/:id                      GET / PUT / DELETE
  //      - /surveys/:id/publish              POST
  //      - /surveys/:id/questions            GET / POST
  //      - /surveys/:id/responses            GET (list filtres)
  //      - /surveys/:id/nps                  GET (?period_days=30|60|90)
  //      - /survey-questions/:id             PUT / DELETE
  //      - /survey-questions/:id/branches    GET / POST
  //      - /survey-branches/:id              DELETE
  //      - /survey-responses/:id             GET
  //
  //    Custom domains + DNS records (~8 handlers) :
  //      - /custom-domains                   GET (list filtres) / POST (add)
  //      - /custom-domains/:id               DELETE
  //      - /custom-domains/:id/verify        POST
  //      - /custom-domains/:id/dns-records   GET / POST
  //      - /dns-records/:id                  PUT / DELETE
  //
  // Voir docs/LOT-SURVEYS-DNS-S50.md §6.
  if (path === '/api/surveys' && method === 'GET') {
    const m = await import('./worker/surveys');
    return m.handleListSurveys(env, auth, url);
  }
  if (path === '/api/surveys' && method === 'POST') {
    const m = await import('./worker/surveys');
    return m.handleCreateSurvey(request, env, auth);
  }
  // Sous-routes /surveys/:id/{publish,questions,responses,nps} AVANT
  // /surveys/:id générique (anti-shadowing).
  const surveyPublishMatch = path.match(/^\/api\/surveys\/([^/]+)\/publish$/);
  if (surveyPublishMatch && method === 'POST') {
    const m = await import('./worker/surveys');
    return m.handlePublishSurvey(request, env, auth, surveyPublishMatch[1]!);
  }
  const surveyQuestionsMatch = path.match(/^\/api\/surveys\/([^/]+)\/questions$/);
  if (surveyQuestionsMatch && method === 'GET') {
    const m = await import('./worker/surveys');
    return m.handleListSurveyQuestions(env, auth, surveyQuestionsMatch[1]!);
  }
  if (surveyQuestionsMatch && method === 'POST') {
    const m = await import('./worker/surveys');
    return m.handleCreateSurveyQuestion(request, env, auth, surveyQuestionsMatch[1]!);
  }
  const surveyResponsesMatch = path.match(/^\/api\/surveys\/([^/]+)\/responses$/);
  if (surveyResponsesMatch && method === 'GET') {
    const m = await import('./worker/surveys');
    return m.handleListResponses(env, auth, surveyResponsesMatch[1]!, url);
  }
  const surveyNpsMatch = path.match(/^\/api\/surveys\/([^/]+)\/nps$/);
  if (surveyNpsMatch && method === 'GET') {
    const m = await import('./worker/surveys');
    return m.handleGetNpsAggregate(env, auth, surveyNpsMatch[1]!, url);
  }
  const surveyIdMatch = path.match(/^\/api\/surveys\/([^/]+)$/);
  if (surveyIdMatch && method === 'GET') {
    const m = await import('./worker/surveys');
    return m.handleGetSurvey(env, auth, surveyIdMatch[1]!);
  }
  if (surveyIdMatch && method === 'PUT') {
    const m = await import('./worker/surveys');
    return m.handleUpdateSurvey(request, env, auth, surveyIdMatch[1]!);
  }
  if (surveyIdMatch && method === 'DELETE') {
    const m = await import('./worker/surveys');
    return m.handleDeleteSurvey(env, auth, surveyIdMatch[1]!);
  }
  // Sous-routes /survey-questions/:id/branches AVANT /survey-questions/:id.
  const questionBranchesMatch = path.match(/^\/api\/survey-questions\/([^/]+)\/branches$/);
  if (questionBranchesMatch && method === 'GET') {
    const m = await import('./worker/surveys');
    return m.handleListBranches(env, auth, questionBranchesMatch[1]!);
  }
  if (questionBranchesMatch && method === 'POST') {
    const m = await import('./worker/surveys');
    return m.handleCreateBranch(request, env, auth, questionBranchesMatch[1]!);
  }
  const surveyQuestionIdMatch = path.match(/^\/api\/survey-questions\/([^/]+)$/);
  if (surveyQuestionIdMatch && method === 'PUT') {
    const m = await import('./worker/surveys');
    return m.handleUpdateSurveyQuestion(request, env, auth, surveyQuestionIdMatch[1]!);
  }
  if (surveyQuestionIdMatch && method === 'DELETE') {
    const m = await import('./worker/surveys');
    return m.handleDeleteSurveyQuestion(env, auth, surveyQuestionIdMatch[1]!);
  }
  const surveyBranchIdMatch = path.match(/^\/api\/survey-branches\/([^/]+)$/);
  if (surveyBranchIdMatch && method === 'DELETE') {
    const m = await import('./worker/surveys');
    return m.handleDeleteBranch(env, auth, surveyBranchIdMatch[1]!);
  }
  const surveyResponseIdMatch = path.match(/^\/api\/survey-responses\/([^/]+)$/);
  if (surveyResponseIdMatch && method === 'GET') {
    const m = await import('./worker/surveys');
    return m.handleGetResponseDetail(env, auth, surveyResponseIdMatch[1]!);
  }

  // Custom domains + DNS records (Sprint 50).
  if (path === '/api/custom-domains' && method === 'GET') {
    const m = await import('./worker/custom-domains');
    return m.handleListCustomDomains(env, auth, url);
  }
  if (path === '/api/custom-domains' && method === 'POST') {
    const m = await import('./worker/custom-domains');
    return m.handleAddCustomDomain(request, env, auth);
  }
  // Sous-routes /custom-domains/:id/{verify,dns-records} AVANT
  // /custom-domains/:id générique.
  const domainVerifyMatch = path.match(/^\/api\/custom-domains\/([^/]+)\/verify$/);
  if (domainVerifyMatch && method === 'POST') {
    const m = await import('./worker/custom-domains');
    return m.handleVerifyDomain(request, env, auth, domainVerifyMatch[1]!);
  }
  const domainDnsRecordsMatch = path.match(/^\/api\/custom-domains\/([^/]+)\/dns-records$/);
  if (domainDnsRecordsMatch && method === 'GET') {
    const m = await import('./worker/custom-domains');
    return m.handleListDnsRecords(env, auth, domainDnsRecordsMatch[1]!);
  }
  if (domainDnsRecordsMatch && method === 'POST') {
    const m = await import('./worker/custom-domains');
    return m.handleCreateDnsRecord(request, env, auth, domainDnsRecordsMatch[1]!);
  }
  const domainIdMatch = path.match(/^\/api\/custom-domains\/([^/]+)$/);
  if (domainIdMatch && method === 'DELETE') {
    const m = await import('./worker/custom-domains');
    return m.handleDeleteDomain(env, auth, domainIdMatch[1]!);
  }
  const dnsRecordIdMatch = path.match(/^\/api\/dns-records\/([^/]+)$/);
  if (dnsRecordIdMatch && method === 'PUT') {
    const m = await import('./worker/custom-domains');
    return m.handleUpdateDnsRecord(request, env, auth, dnsRecordIdMatch[1]!);
  }
  if (dnsRecordIdMatch && method === 'DELETE') {
    const m = await import('./worker/custom-domains');
    return m.handleDeleteDnsRecord(env, auth, dnsRecordIdMatch[1]!);
  }

  // ── LOT MEMBERSHIPS — gestion PRO cours/modules/leçons/sites/plans
  //    (PROTÉGÉ). Garde capability 'workflows.manage' appliquée DANS les
  //    handlers (calque EXACT booking-public.ts:capGuard / funnels.ts —
  //    AUCUN ajout à ALL_CAPABILITIES). Sous-routes spécifiques AVANT /:id
  //    générique (sinon shadowing). Corps réels Phase B Manager-B
  //    (memberships.ts).
  if (path === '/api/courses' && method === 'GET') return handleListCourses(env, auth, url);
  if (path === '/api/courses' && method === 'POST') return handleCreateCourse(request, env, auth);
  const courseModulesMatch = path.match(/^\/api\/courses\/([^/]+)\/modules$/);
  if (courseModulesMatch && (method === 'GET' || method === 'POST')) return handleCourseModules(request, env, auth, courseModulesMatch[1]!);
  // LOT MEMBERSHIP ENROLL — gestion membres/inscriptions PRO (membershipCapGuard
  // 'workflows.manage' DANS le handler). Sous-routes /courses/:id/{enroll,
  // enrollments} AVANT /courses/:id générique (anti-shadowing). /api/members =
  // route NEUVE (aucun conflit). Corps réels Phase B Manager-B (memberships.ts).
  if (path === '/api/members' && method === 'GET') return handleListMembers(env, auth, url);
  const courseEnrollMatch = path.match(/^\/api\/courses\/([^/]+)\/enroll$/);
  if (courseEnrollMatch && method === 'POST') return handleAdminEnroll(request, env, auth, courseEnrollMatch[1]!);
  const courseEnrollmentsMatch = path.match(/^\/api\/courses\/([^/]+)\/enrollments$/);
  if (courseEnrollmentsMatch && method === 'GET') return handleListEnrollments(env, auth, courseEnrollmentsMatch[1]!);
  const courseIdMatch = path.match(/^\/api\/courses\/([^/]+)$/);
  if (courseIdMatch && method === 'GET') return handleGetCourse(env, auth, courseIdMatch[1]!);
  if (courseIdMatch && method === 'PUT') return handleUpdateCourse(request, env, auth, courseIdMatch[1]!);
  if (courseIdMatch && method === 'DELETE') return handleDeleteCourse(env, auth, courseIdMatch[1]!);
  if (path === '/api/lessons' && method === 'POST') return handleCreateLesson(request, env, auth);
  const lessonIdMatch = path.match(/^\/api\/lessons\/([^/]+)$/);
  if (lessonIdMatch && method === 'PUT') return handleUpdateLesson(request, env, auth, lessonIdMatch[1]!);
  if (lessonIdMatch && method === 'DELETE') return handleDeleteLesson(env, auth, lessonIdMatch[1]!);
  if (path === '/api/membership-sites' && (method === 'GET' || method === 'POST')) return handleMembershipSites(request, env, auth, url);
  if (path === '/api/membership-plans' && (method === 'GET' || method === 'POST')) return handleMembershipPlans(request, env, auth, url);

  // ── LOT STOREFRONT CHECKOUT (Sprint 7) — réglages vitrine PRO (PROTÉGÉ).
  //    Capability EXISTANTE 'settings.manage' appliquée DANS les handlers
  //    (capGuard — calque SMS/WhatsApp/IVR/OAuth ; AUCUN ajout à
  //    ALL_CAPABILITIES) + bornage tenant. Active/configure la vitrine
  //    (clients.store_slug / store_settings_json). Corps réels Phase B Manager-B
  //    (storefront-public.ts). Le tunnel acheteur est PUBLIC (cf. ~588).
  if (path === '/api/store-settings' && method === 'GET') return handleGetStoreSettings(env, auth);
  if (path === '/api/store-settings' && method === 'POST') return handleSaveStoreSettings(request, env, auth);

  // ── LOT PORTAL-E — config PRO portail client (PROTÉGÉ). Garde capability
  //    'billing.view' (RÉUTILISÉE — AUCUN ajout à ALL_CAPABILITIES) appliquée DANS
  //    les handlers (portalCapGuard) + bornage tenant. Corps réels Phase B Manager-B.
  if (path === '/api/portal-sites' && (method === 'GET' || method === 'POST')) return handlePortalSites(request, env, auth, url);
  if (path === '/api/portal-users' && (method === 'GET' || method === 'POST')) return handlePortalUsers(request, env, auth, url);

  // ── LOT G10 COMMUNAUTÉ — modération PRO (PROTÉGÉ). Garde capability
  //    'workflows.manage' mode-agence-only appliquée DANS les handlers
  //    (communityCapGuard — calque affiliates.ts:affiliateCapGuard / LOT B-bis,
  //    AUCUN ajout à ALL_CAPABILITIES) + re-borne rowInTenant AVANT action
  //    (FLAG #1). Sous-routes spécifiques AVANT /:id générique. Corps réels
  //    Phase B Manager-B (community.ts).
  if (path === '/api/community/moderate/threads' && method === 'GET') return handleModerateListThreads(request, env, auth, url);
  // Listing modération (G10) : posts d'un thread + commentaires de leçons.
  // Spécifique /threads/:tid/posts (3 segments) AVANT /threads/:id (anti-shadowing).
  const modListPostsMatch = path.match(/^\/api\/community\/moderate\/threads\/([^/]+)\/posts$/);
  if (modListPostsMatch && method === 'GET') return handleModerateListPosts(request, env, auth, modListPostsMatch[1]!);
  if (path === '/api/community/moderate/comments' && method === 'GET') return handleModerateListComments(request, env, auth, url);
  const modDelPostMatch = path.match(/^\/api\/community\/moderate\/posts\/([^/]+)$/);
  if (modDelPostMatch && method === 'DELETE') return handleModerateDeletePost(request, env, auth, modDelPostMatch[1]!);
  const modDelCommentMatch = path.match(/^\/api\/community\/moderate\/comments\/([^/]+)$/);
  if (modDelCommentMatch && method === 'DELETE') return handleModerateDeleteComment(request, env, auth, modDelCommentMatch[1]!);
  const modThreadMatch = path.match(/^\/api\/community\/moderate\/threads\/([^/]+)$/);
  if (modThreadMatch && method === 'PUT') return handleModerateThread(request, env, auth, modThreadMatch[1]!);

  // Migration GHL
  if (path === '/api/migration/ghl/oauth/start' && method === 'GET') {
    const { handleGhlOauthStart } = await import('./worker/migration-ghl-oauth');
    return handleGhlOauthStart(request, env, auth, url);
  }
  if (path === '/api/migration/ghl/csv/preview' && method === 'POST') {
    const { handleGhlCsvPreview } = await import('./worker/migration-ghl-csv');
    return handleGhlCsvPreview(request, env, auth);
  }
  if (path === '/api/migration/ghl/csv/run' && method === 'POST') {
    const { handleGhlCsvRun } = await import('./worker/migration-ghl-csv');
    return handleGhlCsvRun(request, env, auth);
  }
  if (path === '/api/migration/ghl/api/run' && method === 'POST') {
    const { handleGhlApiRun } = await import('./worker/migration-ghl-api');
    return handleGhlApiRun(request, env, ctx, auth);
  }
  const migrationSessionMatch = path.match(/^\/api\/migration\/sessions\/([^/]+)$/);
  if (migrationSessionMatch && method === 'GET') {
    const { handleGetMigrationSession } = await import('./worker/migration-ghl-api');
    return handleGetMigrationSession(env, auth, migrationSessionMatch[1]!);
  }
  const sessionErrorsMatch = path.match(/^\/api\/migration\/sessions\/([^/]+)\/errors$/);
  if (sessionErrorsMatch && method === 'GET') {
    const { handleGetMigrationErrors } = await import('./worker/migration-ghl-api');
    return handleGetMigrationErrors(env, auth, sessionErrorsMatch[1]!);
  }
  const submissionsMatch = path.match(/^\/api\/forms\/([^/]+)\/submissions$/);
  if (submissionsMatch && method === 'GET') return handleGetFormSubmissions(env, auth, submissionsMatch[1]!, url);

  // Trigger Links
  if (path === '/api/trigger-links' && method === 'GET') return handleGetTriggerLinks(env, auth, url);
  if (path === '/api/trigger-links' && method === 'POST') return handleCreateTriggerLink(request, env, auth);
  const tlMatch = path.match(/^\/api\/trigger-links\/([^/]+)$/);
  if (tlMatch && method === 'DELETE') return handleDeleteTriggerLink(env, auth, tlMatch[1]!);
  const tlStatsMatch = path.match(/^\/api\/trigger-links\/([^/]+)\/stats$/);
  if (tlStatsMatch && method === 'GET') return handleGetTriggerLinkStats(env, auth, tlStatsMatch[1]!);


  // Custom Fields
  if (path === '/api/custom-fields' && method === 'GET') return handleGetCustomFields(env, auth, url);
  if (path === '/api/custom-fields' && method === 'POST') return handleCreateCustomField(request, env, auth);
  const cfMatch = path.match(/^\/api\/custom-fields\/([^/]+)$/);
  if (cfMatch && method === 'PATCH') return handleUpdateCustomField(request, env, auth, cfMatch[1]!);
  if (cfMatch && method === 'DELETE') return handleDeleteCustomField(env, auth, cfMatch[1]!);

  const leadCfMatch = path.match(/^\/api\/leads\/([^/]+)\/custom-fields$/);
  if (leadCfMatch && method === 'GET') return handleGetLeadCustomFields(env, auth, leadCfMatch[1]!);
  if (leadCfMatch && method === 'POST') return handleSetLeadCustomFields(request, env, auth, leadCfMatch[1]!);

  // Smart Lists
  if (path === '/api/smart-lists' && method === 'GET') return handleGetSmartLists(env, auth);
  if (path === '/api/smart-lists' && method === 'POST') return handleCreateSmartList(request, env, auth);
  const slMatch = path.match(/^\/api\/smart-lists\/([^/]+)$/);
  if (slMatch && method === 'DELETE') return handleDeleteSmartList(env, auth, slMatch[1]!);
  const slExecMatch = path.match(/^\/api\/smart-lists\/([^/]+)\/execute$/);
  if (slExecMatch && method === 'GET') return handleExecuteSmartList(env, auth, slExecMatch[1]!, url);

  if (path === '/api/ai/generate' && method === 'POST') return handleAiGenerate(request, env);
  if (path === '/api/ai/suggest-workflow' && method === 'POST') return handleAiSuggestWorkflow(request, env);
  // Sprint 20
  if (path === '/api/ai/summarize-conversation' && method === 'POST') return handleAiSummarizeConversation(request, env);
  if (path === '/api/ai/suggest-next-action' && method === 'POST') return handleAiSuggestNextAction(request, env);
  // Sprint 21
  if (path === '/api/ai/summarize-leads' && method === 'POST') return handleAiSummarizeLeads(request, env);
  // Sprint 43 M3.3 — AI Drafts (3 tones Claude Haiku 4.5)
  if (path === '/api/ai/drafts' && method === 'POST') return handleAiDrafts(request, env);
  // Sprint 74 — Copilote Commercial : Suggestions de Réponses IA
  if (path === '/api/ai/suggest-replies' && method === 'POST') return handleAiSuggestReplies(request, env);
  // Sprint 75 — Sparkle Weekly Analytics Reports (Rapports Narratifs)
  if (path === '/api/ai/weekly-insight' && method === 'GET') return handleGetWeeklyInsight(request, env, auth);
  if (path === '/api/ai/weekly-insight/generate' && method === 'POST') return handleGenerateWeeklyInsight(request, env, auth);
  // Sprint 49 M1 — Smart compose : ghost-text suggest + proofread FR québécois
  if (path === '/api/ai/compose-suggest' && method === 'POST') return handleAiComposeSuggest(request, env);
  if (path === '/api/ai/proofread' && method === 'POST') return handleAiProofread(request, env);
  // Sprint 49 M3 — Auto-tag conversations + leads + NL query (suggestion only, Loi 25 friendly)
  if (path === '/api/ai/classify-conversation' && method === 'POST') return handleAiClassifyConversation(request, env);
  if (path === '/api/ai/classify-lead' && method === 'POST') return handleAiClassifyLead(request, env);
  if (path === '/api/ai/nl-query' && method === 'POST') return handleAiNlQuery(request, env);

  // ── LOT G8 — AI Workspace conversationnel (PROTÉGÉ, capability 'ai.use'
  //    appliquée DANS les handlers / capGuard mode-agence-only). Tables
  //    ai_chat_* seq 91. Sous-route /:id/message AVANT /:id générique
  //    (anti-shadowing). Corps réels Phase B Manager-B. v1 READ-ONLY/DRAFT-ONLY.
  if (path === '/api/ai/chat/threads' && method === 'GET') return handleListAiThreads(request, env, auth);
  if (path === '/api/ai/chat/threads' && method === 'POST') return handleCreateAiThread(request, env, auth);
  const aiChatMsgMatch = path.match(/^\/api\/ai\/chat\/threads\/([^/]+)\/message$/);
  if (aiChatMsgMatch && method === 'POST') return handleSendAiMessage(request, env, auth, aiChatMsgMatch[1]!);
  // SPRINT 11 (Copilot v2, ADDITIF) — confirmation humaine d'une action sûre
  // proposée. Sous-route /:id/action AVANT /:id générique (anti-shadowing,
  // calque l'ordre /message). capGuard 'ai.use' DANS le handler.
  const aiChatActionMatch = path.match(/^\/api\/ai\/chat\/threads\/([^/]+)\/action$/);
  if (aiChatActionMatch && method === 'POST') return handleConfirmAiAction(request, env, auth, aiChatActionMatch[1]!);
  const aiChatThreadMatch = path.match(/^\/api\/ai\/chat\/threads\/([^/]+)$/);
  if (aiChatThreadMatch && method === 'GET') return handleGetAiThread(request, env, auth, aiChatThreadMatch[1]!);
  if (aiChatThreadMatch && method === 'DELETE') return handleDeleteAiThread(request, env, auth, aiChatThreadMatch[1]!);

  // ── SPRINT 12 — IA contenu : atelier centralisé (PROTÉGÉ, capability 'ai.use'
  //    appliquée DANS les handlers / capGuard). Tables ai_content_items /
  //    ai_brand_voices seq 112. Bornage tenant STRICT depuis l'auth (JAMAIS le
  //    body — le legacy /api/ai/generate lit client_id du body, smell NON
  //    reproduit). Ordre anti-shadowing : collections AVANT /:id ; sous-route
  //    /items/:id/use-as-template AVANT /items/:id générique. Corps réels Phase
  //    B Manager-B (./worker/ai-content). Flag isAiContentMockMode (llm-common).
  if (path === '/api/ai/content/generate' && method === 'POST') {
    const { handleGenerateAiContent } = await import('./worker/ai-content');
    return handleGenerateAiContent(request, env, auth);
  }
  if (path === '/api/ai/content/rewrite' && method === 'POST') {
    const { handleRewriteAiContent } = await import('./worker/ai-content');
    return handleRewriteAiContent(request, env, auth);
  }
  if (path === '/api/ai/content/items' && method === 'GET') {
    const { handleListAiContentItems } = await import('./worker/ai-content');
    return handleListAiContentItems(request, env, auth);
  }
  if (path === '/api/ai/content/items' && method === 'POST') {
    const { handleSaveAiContentItem } = await import('./worker/ai-content');
    return handleSaveAiContentItem(request, env, auth);
  }
  const aiContentUseTplMatch = path.match(/^\/api\/ai\/content\/items\/([^/]+)\/use-as-template$/);
  if (aiContentUseTplMatch && method === 'POST') {
    const { handleUseAsTemplate } = await import('./worker/ai-content');
    return handleUseAsTemplate(request, env, auth, aiContentUseTplMatch[1]!);
  }
  const aiContentItemMatch = path.match(/^\/api\/ai\/content\/items\/([^/]+)$/);
  if (aiContentItemMatch && method === 'DELETE') {
    const { handleDeleteAiContentItem } = await import('./worker/ai-content');
    return handleDeleteAiContentItem(request, env, auth, aiContentItemMatch[1]!);
  }
  if (path === '/api/ai/content/brand-voices' && method === 'GET') {
    const { handleListBrandVoices } = await import('./worker/ai-content');
    return handleListBrandVoices(request, env, auth);
  }
  if (path === '/api/ai/content/brand-voices' && method === 'POST') {
    const { handleCreateBrandVoice } = await import('./worker/ai-content');
    return handleCreateBrandVoice(request, env, auth);
  }
  const aiBrandVoiceMatch = path.match(/^\/api\/ai\/content\/brand-voices\/([^/]+)$/);
  if (aiBrandVoiceMatch && method === 'PATCH') {
    const { handleUpdateBrandVoice } = await import('./worker/ai-content');
    return handleUpdateBrandVoice(request, env, auth, aiBrandVoiceMatch[1]!);
  }
  if (aiBrandVoiceMatch && method === 'DELETE') {
    const { handleDeleteBrandVoice } = await import('./worker/ai-content');
    return handleDeleteBrandVoice(request, env, auth, aiBrandVoiceMatch[1]!);
  }

  // Sprint 43 M3.1 — Reactions emoji par message
  const reactionsListMatch = path.match(/^\/api\/messages\/([^/]+)\/reactions$/);
  if (reactionsListMatch && method === 'GET') return handleGetReactions(env, auth, reactionsListMatch[1]!);
  if (reactionsListMatch && method === 'POST') return handleAddReaction(request, env, auth, reactionsListMatch[1]!);
  const reactionItemMatch = path.match(/^\/api\/messages\/([^/]+)\/reactions\/(.+)$/);
  if (reactionItemMatch && method === 'DELETE') return handleRemoveReaction(env, auth, reactionItemMatch[1]!, reactionItemMatch[2]!);

  // Sprint 43 M3.2 — Quick Replies per-lead × per-user (FIFO 3)
  const quickRepliesMatch = path.match(/^\/api\/leads\/([^/]+)\/quick-replies$/);
  if (quickRepliesMatch && method === 'GET') return handleGetQuickReplies(env, auth, quickRepliesMatch[1]!);
  if (quickRepliesMatch && method === 'POST') return handleAddQuickReply(request, env, auth, quickRepliesMatch[1]!);

  // Sprint 43 M3.4 — Lead score explainable (cache 1h)
  const leadScoreMatch = path.match(/^\/api\/leads\/([^/]+)\/score$/);
  if (leadScoreMatch && method === 'GET') return handleGetLeadScore(env, auth, leadScoreMatch[1]!);

  // Sprint 49 M2.1 — Lead score predictive 30 jours (cache D1 6h)
  const leadPredictMatch = path.match(/^\/api\/leads\/([^/]+)\/score-predict$/);
  if (leadPredictMatch && method === 'GET') return handleGetLeadPredict(env, auth, leadPredictMatch[1]!);

  // Sprint 13 — Score de conversion CALIBRÉ tenant (cache D1 conversion_predictions)
  const conversionScoreMatch = path.match(/^\/api\/leads\/([^/]+)\/conversion-score$/);
  if (conversionScoreMatch && method === 'GET') return handleGetConversionScore(env, auth, conversionScoreMatch[1]!);

  // Sprint 49 M2.2 — Pipeline bottleneck detection
  if (path === '/api/pipeline/bottlenecks' && method === 'GET') return handleGetPipelineBottlenecks(env, auth, url);

  // Sprint 49 M2.3 — Activity anomaly alerts
  if (path === '/api/analytics/anomalies' && method === 'GET') return handleGetActivityAnomalies(env, auth);

  // Sub-accounts
  if (path === '/api/sub-accounts' && method === 'GET') return handleGetSubAccounts(env, auth);
  if (path === '/api/sub-accounts' && method === 'POST') return handleCreateSubAccount(request, env, auth);
  const subMatch = path.match(/^\/api\/sub-accounts\/([^/]+)$/);
  if (subMatch && method === 'PATCH') return handleUpdateSubAccount(request, env, auth, subMatch[1]!);

  // Snapshots
  if (path === '/api/snapshots/create' && method === 'POST') return handleCreateSnapshot(request, env, auth);
  if (path === '/api/snapshots/apply' && method === 'POST') return handleApplySnapshot(request, env, auth);

  // Whitelabel
  if (path === '/api/whitelabel' && method === 'GET') return handleGetWhitelabel(env, auth);
  if (path === '/api/whitelabel' && method === 'PATCH') return handleUpdateWhitelabel(request, env, auth);

  // Google Calendar
  // Google Calendar — V2 backlog (désactivé Sprint Consolidation)
  // Routes /api/gcal/* retournent 404 par défaut (handler absent)

  // Google Business Profile — Sprint 32 (RÉACTIVÉ).
  // Routes /api/gbp/* câblées plus bas dans le bloc AUTHED (cf. ~ligne 2455).
  // Callback OAuth /api/gbp/oauth/callback = PUBLIC ~ligne 1124.

  // Meta (FB/IG)
      // Billing & Invoicing (P3.8)
      if (path === '/api/invoices' && method === 'GET') {
        const { handleGetInvoices } = await import('./worker/billing');
        return await handleGetInvoices(env, auth);
      }
      if (path === '/api/invoices' && method === 'POST') {
        const { handleCreateInvoice } = await import('./worker/billing');
        return await handleCreateInvoice(request, env, auth);
      }
      if (path.match(/^\/api\/invoices\/[a-zA-Z0-9_-]+\/status$/) && method === 'PATCH') {
        const invoiceId = path.split('/')[3];
        const { handleUpdateInvoiceStatus } = await import('./worker/billing');
        return await handleUpdateInvoiceStatus(request, env, auth, invoiceId!);
      }
      // ── LOT FACTURATION-RÉELLE — facture enrichie + données PDF ──────────
      // Ordre : /pdf-data (spécifique) AVANT /:id (générique) pour éviter le
      // shadowing ; /status (PATCH ci-dessus) reste prioritaire.
      if (path.match(/^\/api\/invoices\/[a-zA-Z0-9_-]+\/pdf-data$/) && method === 'GET') {
        const invoiceId = path.split('/')[3];
        const { handleGetInvoicePdfData } = await import('./worker/billing');
        return await handleGetInvoicePdfData(request, env, auth, invoiceId!);
      }
      if (path.match(/^\/api\/invoices\/[a-zA-Z0-9_-]+$/) && method === 'GET') {
        const invoiceId = path.split('/')[3];
        const { handleGetInvoice } = await import('./worker/billing');
        return await handleGetInvoice(request, env, auth, invoiceId!);
      }

      // ── LOT FACTURATION-RÉELLE — devis / soumission ─────────────────────
      // Ordre : /accept (spécifique) AVANT /:id (générique).
      if (path === '/api/quotes' && method === 'GET') {
        const { handleListQuotes } = await import('./worker/quotes');
        return await handleListQuotes(request, env, auth);
      }
      if (path === '/api/quotes' && method === 'POST') {
        const { handleCreateQuote } = await import('./worker/quotes');
        return await handleCreateQuote(request, env, auth);
      }
      if (path.match(/^\/api\/quotes\/[a-zA-Z0-9_-]+\/accept$/) && method === 'POST') {
        const quoteId = path.split('/')[3];
        const { handleAcceptQuote } = await import('./worker/quotes');
        return await handleAcceptQuote(request, env, auth, quoteId!);
      }
      // ── Sprint 17 PROPOSALS E-SIGN — envoyer un devis pour signature ──────
      // Path EXACT /send-for-signature (spécifique) AVANT le générique /:id —
      // pas de chevauchement. capGuard invoices.write DANS le handler.
      if (path.match(/^\/api\/quotes\/[a-zA-Z0-9_-]+\/send-for-signature$/) && method === 'POST') {
        const quoteId = path.split('/')[3];
        const { handleSendQuoteForSignature } = await import('./worker/quotes');
        return await handleSendQuoteForSignature(request, env, auth, quoteId!);
      }
      if (path.match(/^\/api\/quotes\/[a-zA-Z0-9_-]+$/) && method === 'GET') {
        const quoteId = path.split('/')[3];
        const { handleGetQuote } = await import('./worker/quotes');
        return await handleGetQuote(request, env, auth, quoteId!);
      }
      if (path.match(/^\/api\/quotes\/[a-zA-Z0-9_-]+$/) && method === 'PATCH') {
        const quoteId = path.split('/')[3];
        const { handleUpdateQuote } = await import('./worker/quotes');
        return await handleUpdateQuote(request, env, auth, quoteId!);
      }

      // ── Sprint 18 CATALOGUE DE SERVICES — /api/catalog/* ─────────────────
      // ⚠ Sous requireAuth SEUL — PAS requireModule('ecommerce') : un catalogue
      // de services doit vivre SANS Boutique (calque /api/quotes). capGuard
      // invoices.write DANS les handlers de mutation (catalog.ts). Anti-shadowing :
      // /search et /import-products (spécifiques) AVANT le générique /items/:id.
      if (path === '/api/catalog/search' && method === 'GET') {
        const { handleSearchCatalogItems } = await import('./worker/catalog');
        return await handleSearchCatalogItems(request, env, auth, url);
      }
      if (path === '/api/catalog/import-products' && method === 'POST') {
        const { handleImportCatalogFromProducts } = await import('./worker/catalog');
        return await handleImportCatalogFromProducts(request, env, auth);
      }
      if (path === '/api/catalog/items' && method === 'GET') {
        const { handleListCatalogItems } = await import('./worker/catalog');
        return await handleListCatalogItems(request, env, auth, url);
      }
      if (path === '/api/catalog/items' && method === 'POST') {
        const { handleCreateCatalogItem } = await import('./worker/catalog');
        return await handleCreateCatalogItem(request, env, auth);
      }
      if (path.match(/^\/api\/catalog\/items\/[a-zA-Z0-9_-]+$/) && method === 'PATCH') {
        const itemId = path.split('/')[4];
        const { handleUpdateCatalogItem } = await import('./worker/catalog');
        return await handleUpdateCatalogItem(request, env, auth, itemId!);
      }
      if (path.match(/^\/api\/catalog\/items\/[a-zA-Z0-9_-]+$/) && method === 'DELETE') {
        const itemId = path.split('/')[4];
        const { handleDeleteCatalogItem } = await import('./worker/catalog');
        return await handleDeleteCatalogItem(request, env, auth, itemId!);
      }

      // SaaS Configurator (P3.9)
      if (path === '/api/agencies' && method === 'GET') {
        const { handleGetAgencies } = await import('./worker/saas');
        return await handleGetAgencies(env, auth);
      }
      if (path === '/api/agencies' && method === 'POST') {
        const { handleCreateAgency } = await import('./worker/saas');
        return await handleCreateAgency(request, env, auth);
      }

      // LOT 2 SaaS M1 — switch sous-compte (stateless) + vue agence
      if (path === '/api/account/switch' && method === 'POST') {
        const { handleAccountSwitch } = await import('./worker/saas');
        return await handleAccountSwitch(request, env, auth);
      }
      if (path === '/api/agency/sub-accounts' && method === 'GET') {
        const { handleGetAgencySubAccounts } = await import('./worker/saas');
        return await handleGetAgencySubAccounts(env, auth);
      }
      if (path === '/api/agency/sub-accounts' && method === 'POST') {
        const { handleCreateAgencySubAccount } = await import('./worker/saas');
        return await handleCreateAgencySubAccount(request, env, auth);
      }

      // LOT 3 SaaS M2 — vue plan / quota agence (lecture seule, §6.15)
      if (path === '/api/agency/plan' && method === 'GET') {
        const { handleGetAgencyPlan } = await import('./worker/saas');
        return await handleGetAgencyPlan(env, auth);
      }

      // ── Sprint 22 — Billing Stripe prod (E4 flag mock) ─────────────────────
      // 9 routes SaaS billing. DISTINCT de /api/webhook/stripe (billing.ts,
      // webhook E4 marchand) et de /api/agency/plan (saas.ts, vue compacte).
      // capGuard appliqué DANS les handlers Phase B (Manager-B) :
      //   billing.view  → lectures (plans, subscription, usage, invoices, webhook-config)
      //   settings.manage → mutations (change/cancel/resume/portal-session)
      // Idiome MOCK total tant que env.STRIPE_SECRET_KEY absente OU V1 verrouillé.
      if (path === '/api/billing/plans' && method === 'GET') {
        // ── Sprint 25 — Perf : cache TTL 300s (catalogue plans lecture seule).
        // Clé canonique : cache.local/billing/plans?tenant=<clientId|anon>.
        // Best-effort dégradé : si Cache API KO (caches.default undefined dans
        // certains environnements de test/local), cacheGet → null, fall through
        // au handler normal, cachePut silent. Comportement identique pré-S25.
        const tenant = auth.clientId ?? 'anon';
        const cacheKey = new Request(
          `https://cache.local/billing/plans?tenant=${tenant}`,
          { method: 'GET' },
        );
        const hit = await cacheGet(cacheKey);
        if (hit) return hit;
        const { handleListBillingPlans } = await import('./worker/saas-billing');
        const res = await handleListBillingPlans(env, auth);
        if (res.status === 200) {
          ctx.waitUntil(cachePut(cacheKey, res.clone(), 300));
        }
        return res;
      }
      if (path === '/api/billing/subscription' && method === 'GET') {
        const { handleGetCurrentSubscription } = await import('./worker/saas-billing');
        return await handleGetCurrentSubscription(env, auth);
      }
      if (path === '/api/billing/subscriptions' && method === 'GET') {
        const { handleListBillingSubscriptions } = await import('./worker/saas-billing');
        return await handleListBillingSubscriptions(env, auth);
      }
      if (path === '/api/billing/subscription/change' && method === 'POST') {
        const { handleChangeSubscriptionPlan } = await import('./worker/saas-billing');
        const res = await handleChangeSubscriptionPlan(request, env, auth);
        // ── Sprint 25 — Perf : bust catalogue plans dès qu'un plan change pour
        // ce tenant. Best-effort silent (cacheBust never throws). Bust UNIQUEMENT
        // sur 2xx pour ne pas invalider sur 4xx (no-op côté metier).
        if (res.status >= 200 && res.status < 300) {
          const tenant = auth.clientId ?? 'anon';
          const cacheKey = new Request(
            `https://cache.local/billing/plans?tenant=${tenant}`,
            { method: 'GET' },
          );
          ctx.waitUntil(cacheBust(cacheKey));
        }
        return res;
      }
      if (path === '/api/billing/subscription/cancel' && method === 'POST') {
        const { handleCancelSubscription } = await import('./worker/saas-billing');
        return await handleCancelSubscription(request, env, auth);
      }
      if (path === '/api/billing/subscription/resume' && method === 'POST') {
        const { handleResumeSubscription } = await import('./worker/saas-billing');
        return await handleResumeSubscription(env, auth);
      }
      if (path === '/api/billing/portal-session' && method === 'POST') {
        const { handleCreatePortalSession } = await import('./worker/saas-billing');
        return await handleCreatePortalSession(request, env, auth);
      }
      if (path === '/api/billing/usage' && method === 'GET') {
        const { handleGetBillingUsage } = await import('./worker/saas-billing');
        return await handleGetBillingUsage(env, auth);
      }
      if (path === '/api/billing/invoices' && method === 'GET') {
        const { handleListBillingInvoices } = await import('./worker/saas-billing');
        return await handleListBillingInvoices(env, auth);
      }
      if (path === '/api/billing/webhook-config' && method === 'GET') {
        const { handleGetWebhookConfig } = await import('./worker/saas-billing');
        return await handleGetWebhookConfig(env, auth);
      }

      // ── Sprint 31 — Stripe Connect + Payment Methods (AUTHED, agence) ──────
      // 6 routes : 2 Connect onboarding/status + 4 Payment Methods CRUD.
      // capGuard appliqué DANS les handlers (settings.manage pour mutations,
      // billing.view pour lectures). Dégradé 503 si Stripe pas configuré.
      // Live calls déléguées à lib/saas-billing-live.ts (Agent A1).
      if (path === '/api/billing/connect/onboard' && method === 'POST') {
        const m = await import('./worker/saas-billing-connect');
        return m.handleConnectOnboard(request, env, auth);
      }
      if (path === '/api/billing/connect/status' && method === 'GET') {
        const m = await import('./worker/saas-billing-connect');
        return m.handleConnectStatus(env, auth);
      }
      if (path === '/api/billing/payment-methods' && method === 'GET') {
        const m = await import('./worker/saas-billing-payment-methods');
        return m.handleListPaymentMethods(env, auth);
      }
      if (path === '/api/billing/payment-methods/setup-intent' && method === 'POST') {
        const m = await import('./worker/saas-billing-payment-methods');
        return m.handleCreateSetupIntent(request, env, auth);
      }
      // ORDRE IMPORTANT : route :id/default AVANT route :id (sinon /default
      // matche aussi sur la régex DELETE :id qui consomme `default` comme id).
      const pmDefaultMatch = path.match(/^\/api\/billing\/payment-methods\/([^/]+)\/default$/);
      if (pmDefaultMatch && method === 'POST') {
        const m = await import('./worker/saas-billing-payment-methods');
        return m.handleSetDefaultPaymentMethod(request, env, auth);
      }
      const pmMatch = path.match(/^\/api\/billing\/payment-methods\/([^/]+)$/);
      if (pmMatch && method === 'DELETE') {
        const m = await import('./worker/saas-billing-payment-methods');
        return m.handleDeletePaymentMethod(request, env, auth);
      }

      // ── Sprint 32 — Google Business Profile (AUTHED) ───────────────────────
      // 10 routes authed : 1 oauth start (callback est PUBLIC ~ligne 1117),
      // 2 connections (list + delete), 2 locations (list + set default),
      // 2 reviews (list + reply), 1 sync trigger, 1 posts create, 1 insights.
      // capGuard (settings.manage / reputation.manage selon route) appliqué
      // DANS les handlers (gbp.ts agent A2). Bornage tenant strict via auth.
      // OAuth dédié gbp-oauth.ts (provider='google_business' isolé du LOT G4
      // qui gère google/slack pour Calendar).
      if (path === '/api/gbp/oauth/start' && method === 'GET') {
        const m = await import('./worker/gbp-oauth');
        return m.handleGbpAuthorize(request, env, auth);
      }
      if (path === '/api/gbp/connections' && method === 'GET') {
        const m = await import('./worker/gbp');
        return m.handleListGbpConnections(env, auth);
      }
      const gbpConnDeleteMatch = path.match(/^\/api\/gbp\/connections\/([^/]+)$/);
      if (gbpConnDeleteMatch && method === 'DELETE') {
        const m = await import('./worker/gbp');
        return m.handleDeleteGbpConnection(request, env, auth, gbpConnDeleteMatch[1]!);
      }
      if (path === '/api/gbp/locations' && method === 'GET') {
        const m = await import('./worker/gbp');
        return m.handleListGbpLocations(request, env, auth);
      }
      // ORDRE IMPORTANT : route :id/default AVANT route :id (anti-shadowing).
      const gbpLocDefaultMatch = path.match(/^\/api\/gbp\/locations\/([^/]+)\/default$/);
      if (gbpLocDefaultMatch && method === 'POST') {
        const m = await import('./worker/gbp');
        return m.handleSetDefaultGbpLocation(request, env, auth, gbpLocDefaultMatch[1]!);
      }
      if (path === '/api/gbp/reviews' && method === 'GET') {
        const m = await import('./worker/gbp');
        return m.handleListGbpReviews(request, env, auth);
      }
      // Review name Google = "accounts/{a}/locations/{l}/reviews/{r}" : slashs
      // imbriqués → capture greedy + decodeURIComponent côté worker.
      const gbpReviewReplyMatch = path.match(/^\/api\/gbp\/reviews\/(.+)\/reply$/);
      if (gbpReviewReplyMatch && method === 'POST') {
        const m = await import('./worker/gbp');
        return m.handleReplyGbpReview(request, env, auth, decodeURIComponent(gbpReviewReplyMatch[1]!));
      }
      if (path === '/api/gbp/sync/reviews' && method === 'POST') {
        const m = await import('./worker/gbp');
        return m.handleTriggerGbpReviewsSync(env, auth);
      }
      if (path === '/api/gbp/posts' && method === 'POST') {
        const m = await import('./worker/gbp');
        return m.handleCreateGbpPost(request, env, auth);
      }
      if (path === '/api/gbp/insights' && method === 'GET') {
        const m = await import('./worker/gbp');
        return m.handleGetGbpInsights(request, env, auth);
      }

      // ── Sprint 33 — Calendar Sync OAuth + connections (AUTHED) ─────────────
      //    2 OAuth start (GCal/Outlook), 6 CRUD connections (list/disconnect/
      //    list-external-calendars/sync-now/list-conflicts/resolve-conflict).
      //    Callbacks OAuth + webhooks = PUBLIC (zone ~ligne 1129).
      //    capGuard 'settings.manage' appliqué DANS les handlers pour les
      //    mutations (disconnect / sync-now / resolve-conflict). Bornage tenant
      //    strict via auth.clientId (defense-in-depth IDOR sur les path-params).
      //    ORDRE IMPORTANT : route /conflicts AVANT route :id (anti-shadowing).
      if (path === '/api/oauth/gcal_sync/authorize' && method === 'POST') {
        const m = await import('./worker/gcal-oauth');
        return m.handleGcalAuthorize(request, env, auth);
      }
      if (path === '/api/oauth/outlook/authorize' && method === 'POST') {
        const m = await import('./worker/outlook-oauth');
        return m.handleOutlookAuthorize(request, env, auth);
      }
      if (path === '/api/calendar-connections' && method === 'GET') {
        const m = await import('./worker/calendar-integrations');
        return m.handleListConnections(env, auth);
      }
      // ORDRE : /conflicts (plus spécifique) AVANT /:id (catch-all) sinon
      // /conflicts serait matché comme :id et router /resolve impossible.
      if (path === '/api/calendar-connections/conflicts' && method === 'GET') {
        const m = await import('./worker/calendar-integrations');
        return m.handleListConflicts(env, auth);
      }
      const calConflictMatch = path.match(/^\/api\/calendar-connections\/conflicts\/([^/]+)\/resolve$/);
      if (calConflictMatch && method === 'POST') {
        const m = await import('./worker/calendar-integrations');
        return m.handleResolveConflict(request, env, auth, calConflictMatch[1]!);
      }
      const calExternalMatch = path.match(/^\/api\/calendar-connections\/([^/]+)\/external-calendars$/);
      if (calExternalMatch && method === 'GET') {
        const m = await import('./worker/calendar-integrations');
        return m.handleListExternalCalendars(request, env, auth, calExternalMatch[1]!);
      }
      const calSyncMatch = path.match(/^\/api\/calendar-connections\/([^/]+)\/sync-now$/);
      if (calSyncMatch && method === 'POST') {
        const m = await import('./worker/calendar-integrations');
        return m.handleSyncNow(request, env, auth, calSyncMatch[1]!);
      }
      const calConnDeleteMatch = path.match(/^\/api\/calendar-connections\/([^/]+)$/);
      if (calConnDeleteMatch && method === 'DELETE') {
        const m = await import('./worker/calendar-integrations');
        return m.handleDisconnect(request, env, auth, calConnDeleteMatch[1]!);
      }

      // ── Sprint 35 — Snapshots GHL-style (AUTHED) ───────────────────────────
      // 8 routes : 1 import + 1 create/list + 5 actions (download/publish/
      // archive/get/delete) + ordre ANTI-SHADOWING strict (routes spécifiques
      // /import, /:id/download|publish|archive AVANT /:id générique).
      // Garde capability 'settings.manage' (FIGÉE seq80) appliquée DANS les
      // handlers (snapshots.ts + snapshots-import.ts). Bornage tenant strict
      // côté handler via auth.clientId (defense-in-depth IDOR sur :id).
      // Voir docs/LOT-SNAPSHOTS-S35.md §3 (routes) + §4 (handlers).
      if (path === '/api/snapshots/import' && method === 'POST') {
        const m = await import('./worker/snapshots-import');
        return m.handleImportSnapshot(request, env, auth);
      }
      if (path === '/api/snapshots' && method === 'POST') {
        const m = await import('./worker/snapshots');
        return m.handleCreateSnapshot(request, env, auth);
      }
      if (path === '/api/snapshots' && method === 'GET') {
        const m = await import('./worker/snapshots');
        return m.handleListSnapshots(env, auth, url);
      }
      const snapshotDownloadMatch = path.match(/^\/api\/snapshots\/([^/]+)\/download$/);
      if (snapshotDownloadMatch && method === 'GET') {
        const m = await import('./worker/snapshots');
        return m.handleDownloadSnapshotBundle(env, auth, snapshotDownloadMatch[1]!);
      }
      const snapshotPublishMatch = path.match(/^\/api\/snapshots\/([^/]+)\/publish$/);
      if (snapshotPublishMatch && method === 'POST') {
        const m = await import('./worker/snapshots');
        return m.handlePublishSnapshot(env, auth, snapshotPublishMatch[1]!);
      }
      const snapshotArchiveMatch = path.match(/^\/api\/snapshots\/([^/]+)\/archive$/);
      if (snapshotArchiveMatch && method === 'POST') {
        const m = await import('./worker/snapshots');
        return m.handleArchiveSnapshot(env, auth, snapshotArchiveMatch[1]!);
      }
      const snapshotGetMatch = path.match(/^\/api\/snapshots\/([^/]+)$/);
      if (snapshotGetMatch && method === 'GET') {
        const m = await import('./worker/snapshots');
        return m.handleGetSnapshot(env, auth, snapshotGetMatch[1]!);
      }
      const snapshotDeleteMatch = path.match(/^\/api\/snapshots\/([^/]+)$/);
      if (snapshotDeleteMatch && method === 'DELETE') {
        const m = await import('./worker/snapshots');
        return m.handleDeleteSnapshot(env, auth, snapshotDeleteMatch[1]!);
      }

      // ── Sprint 85 — Snapshots de Comptes / Configurations Portables (AUTHED) ──
      if (path === '/api/account-snapshots' && method === 'GET') {
        const m = await import('./worker/account-snapshots');
        return m.handleListAccountSnapshots(env, auth);
      }
      if (path === '/api/account-snapshots' && method === 'POST') {
        const m = await import('./worker/account-snapshots');
        return m.handleCreateAccountSnapshot(request, env, auth);
      }
      const accSnapshotApplyMatch = path.match(/^\/api\/account-snapshots\/([^/]+)\/apply$/);
      if (accSnapshotApplyMatch && method === 'POST') {
        const m = await import('./worker/account-snapshots');
        return m.handleApplyAccountSnapshot(request, env, auth, accSnapshotApplyMatch[1]!);
      }
      const accSnapshotDeleteMatch = path.match(/^\/api\/account-snapshots\/([^/]+)$/);
      if (accSnapshotDeleteMatch && method === 'DELETE') {
        const m = await import('./worker/account-snapshots');
        return m.handleDeleteAccountSnapshot(request, env, auth, accSnapshotDeleteMatch[1]!);
      }

      // ── Sprint 36 — Live chat widget (AUTHED) ──────────────────────────────
      // 9 routes : 5 CRUD widgets + 2 sessions (list+detail) + 2 presence agent.
      // ENRICHISSEMENT du webchat existant (DO WebchatRoom + tables seq25). Ne
      // touche PAS aux routes /api/webchat/* (publiques, câblées plus haut ~l.1067)
      // ni au DO src/worker/webchat.ts. Garde capability 'settings.manage'
      // (FIGÉE seq80) appliquée DANS les handlers (chat-widgets.ts).
      //
      // ORDRE ANTI-SHADOWING strict :
      //   1. /api/chat-widgets/:widgetId/sessions/:sessionId  (le + spécifique)
      //   2. /api/chat-widgets/:widgetId/sessions             (plus spécifique)
      //   3. /api/chat-widgets/:id  (GET/PATCH/DELETE)        (générique :id)
      //   4. /api/chat-widgets       (POST/GET collection)
      //   5. /api/chat-presence/*    (préfixe distinct)
      // Voir docs/LOT-CHAT-WIDGET-S36.md §6 (routes) + §4 (handlers).
      const chatSessionDetailMatch = path.match(/^\/api\/chat-widgets\/([^/]+)\/sessions\/([^/]+)$/);
      if (chatSessionDetailMatch && method === 'GET') {
        const m = await import('./worker/chat-widgets');
        return m.handleGetChatSessionDetail(env, auth, chatSessionDetailMatch[1]!, chatSessionDetailMatch[2]!);
      }
      const chatSessionsMatch = path.match(/^\/api\/chat-widgets\/([^/]+)\/sessions$/);
      if (chatSessionsMatch && method === 'GET') {
        const m = await import('./worker/chat-widgets');
        return m.handleListChatSessions(env, auth, chatSessionsMatch[1]!, url);
      }
      const chatWidgetMatch = path.match(/^\/api\/chat-widgets\/([^/]+)$/);
      if (chatWidgetMatch && method === 'GET') {
        const m = await import('./worker/chat-widgets');
        return m.handleGetChatWidget(env, auth, chatWidgetMatch[1]!);
      }
      if (chatWidgetMatch && method === 'PATCH') {
        const m = await import('./worker/chat-widgets');
        return m.handleUpdateChatWidget(request, env, auth, chatWidgetMatch[1]!);
      }
      if (chatWidgetMatch && method === 'DELETE') {
        const m = await import('./worker/chat-widgets');
        return m.handleDeleteChatWidget(env, auth, chatWidgetMatch[1]!);
      }
      if (path === '/api/chat-widgets' && method === 'GET') {
        const m = await import('./worker/chat-widgets');
        return m.handleListChatWidgets(env, auth);
      }
      if (path === '/api/chat-widgets' && method === 'POST') {
        const m = await import('./worker/chat-widgets');
        return m.handleCreateChatWidget(request, env, auth);
      }
      if (path === '/api/chat-presence/heartbeat' && method === 'POST') {
        const m = await import('./worker/chat-widgets');
        return m.handleChatPresenceHeartbeat(request, env, auth);
      }
      if (path === '/api/chat-presence/active' && method === 'GET') {
        const m = await import('./worker/chat-widgets');
        return m.handleGetActivePresence(env, auth);
      }

      // ── Sprint 37 — POS retail caisse (AUTHED, gated ecommerce) ───────────
      // Toutes les routes gated par requireModule('ecommerce') AVANT le
      // handler (403 JSON FR-QC si module absent). Multi-tenant strict
      // appliqué DANS les handlers (clients.manage / reports.view).
      //
      // Ordre anti-shadowing :
      //   1. /sessions/open                  (statique)
      //   2. /sessions/:id/close             (suffix)
      //   3. /sessions/:id/report            (suffix)
      //   4. /sessions/:id                   (générique :id)
      //   5. /products/scan/:barcode         (préfixe statique)
      //   6. /transactions/:id/void          (suffix)
      //   7. /transactions                   (collection)
      //   8. /registers/:id                  (générique :id)
      //   9. /registers                      (collection)
      if (path.startsWith('/api/pos/')) {
        const { requireModule } = await import('./worker/modules');
        const guard = await requireModule(env, auth.userId, 'ecommerce');
        if (guard) return guard;

        if (path === '/api/pos/registers' && method === 'GET') {
          const m = await import('./worker/pos-registers');
          return m.handleListRegisters(env, auth);
        }
        if (path === '/api/pos/registers' && method === 'POST') {
          const m = await import('./worker/pos-registers');
          return m.handleCreateRegister(request, env, auth);
        }
        const registerMatch = path.match(/^\/api\/pos\/registers\/([^/]+)$/);
        if (registerMatch && method === 'PATCH') {
          const m = await import('./worker/pos-registers');
          return m.handleUpdateRegister(request, env, auth, registerMatch[1]!);
        }
        if (path === '/api/pos/sessions/open' && method === 'POST') {
          const m = await import('./worker/pos-sessions');
          return m.handleOpenSession(request, env, auth);
        }
        const sessionCloseMatch = path.match(/^\/api\/pos\/sessions\/([^/]+)\/close$/);
        if (sessionCloseMatch && method === 'POST') {
          const m = await import('./worker/pos-sessions');
          return m.handleCloseSession(request, env, auth, sessionCloseMatch[1]!);
        }
        const sessionReportMatch = path.match(/^\/api\/pos\/sessions\/([^/]+)\/report$/);
        if (sessionReportMatch && method === 'GET') {
          const m = await import('./worker/pos-sessions');
          return m.handleSessionReport(env, auth, sessionReportMatch[1]!, url);
        }
        const sessionGetMatch = path.match(/^\/api\/pos\/sessions\/([^/]+)$/);
        if (sessionGetMatch && method === 'GET') {
          const m = await import('./worker/pos-sessions');
          return m.handleGetSession(env, auth, sessionGetMatch[1]!);
        }
        const scanMatch = path.match(/^\/api\/pos\/products\/scan\/([^/]+)$/);
        if (scanMatch && method === 'GET') {
          const m = await import('./worker/pos-transactions');
          return m.handleScanBarcode(env, auth, scanMatch[1]!);
        }
        if (path === '/api/pos/transactions' && method === 'POST') {
          const m = await import('./worker/pos-transactions');
          return m.handleCreatePosTransaction(request, env, auth);
        }
        const voidMatch = path.match(/^\/api\/pos\/transactions\/([^/]+)\/void$/);
        if (voidMatch && method === 'POST') {
          const m = await import('./worker/pos-transactions');
          return m.handleVoidPosTransaction(request, env, auth, voidMatch[1]!);
        }
      }

      // ── Sprint 38 — Gift cards (AUTHED) ───────────────────────────────────
      // Ordre anti-shadowing : /cron/expire (statique) AVANT /:id (générique),
      // /:id/redeem|void|refund|transactions (suffixes) AVANT /:id générique.
      if (path === '/api/gift-cards' && method === 'GET') {
        const m = await import('./worker/gift-cards');
        return m.handleListGiftCards(env, auth, url);
      }
      if (path === '/api/gift-cards' && method === 'POST') {
        const m = await import('./worker/gift-cards');
        return m.handleIssueGiftCard(request, env, auth);
      }
      if (path === '/api/gift-cards/cron/expire' && method === 'POST') {
        const m = await import('./worker/gift-cards');
        return m.handleRunGiftCardExpiryCron(request, env, auth);
      }
      const gcRedeemMatch = path.match(/^\/api\/gift-cards\/([^/]+)\/redeem$/);
      if (gcRedeemMatch && method === 'POST') {
        const m = await import('./worker/gift-cards');
        return m.handleRedeemGiftCard(request, env, auth, gcRedeemMatch[1]!);
      }
      const gcVoidMatch = path.match(/^\/api\/gift-cards\/([^/]+)\/void$/);
      if (gcVoidMatch && method === 'POST') {
        const m = await import('./worker/gift-cards');
        return m.handleVoidGiftCard(env, auth, gcVoidMatch[1]!);
      }
      const gcRefundMatch = path.match(/^\/api\/gift-cards\/([^/]+)\/refund$/);
      if (gcRefundMatch && method === 'POST') {
        const m = await import('./worker/gift-cards');
        return m.handleRefundToGiftCard(request, env, auth, gcRefundMatch[1]!);
      }
      const gcTxMatch = path.match(/^\/api\/gift-cards\/([^/]+)\/transactions$/);
      if (gcTxMatch && method === 'GET') {
        const m = await import('./worker/gift-cards');
        return m.handleListTransactions(env, auth, gcTxMatch[1]!);
      }
      const gcIdMatch = path.match(/^\/api\/gift-cards\/([^/]+)$/);
      if (gcIdMatch && method === 'GET') {
        const m = await import('./worker/gift-cards');
        return m.handleGetGiftCard(env, auth, gcIdMatch[1]!);
      }

      // ── Sprint 38 — Loyalty programs (AUTHED) ─────────────────────────────
      // Ordre anti-shadowing : /cron/expire-points (statique) AVANT /:id,
      // /customers/:id/balance et /customers/:id/ledger (préfixes distincts).
      if (path === '/api/loyalty/programs' && method === 'GET') {
        const m = await import('./worker/loyalty');
        return m.handleListPrograms(env, auth, url);
      }
      if (path === '/api/loyalty/programs' && method === 'POST') {
        const m = await import('./worker/loyalty');
        return m.handleCreateProgram(request, env, auth);
      }
      if (path === '/api/loyalty/cron/expire-points' && method === 'POST') {
        const m = await import('./worker/loyalty');
        return m.handleRunExpiryCron(request, env, auth);
      }
      const lpIdMatch = path.match(/^\/api\/loyalty\/programs\/([^/]+)$/);
      if (lpIdMatch && method === 'GET') {
        const m = await import('./worker/loyalty');
        return m.handleGetProgram(env, auth, lpIdMatch[1]!);
      }
      if (lpIdMatch && method === 'PATCH') {
        const m = await import('./worker/loyalty');
        return m.handleUpdateProgram(request, env, auth, lpIdMatch[1]!);
      }
      if (lpIdMatch && method === 'DELETE') {
        const m = await import('./worker/loyalty');
        return m.handleDeleteProgram(env, auth, lpIdMatch[1]!);
      }
      const lcBalanceMatch = path.match(/^\/api\/loyalty\/customers\/([^/]+)\/balance$/);
      if (lcBalanceMatch && method === 'GET') {
        const m = await import('./worker/loyalty');
        return m.handleGetCustomerBalance(env, auth, lcBalanceMatch[1]!, url);
      }
      const lcLedgerMatch = path.match(/^\/api\/loyalty\/customers\/([^/]+)\/ledger$/);
      if (lcLedgerMatch && method === 'GET') {
        const m = await import('./worker/loyalty');
        return m.handleListLedger(env, auth, lcLedgerMatch[1]!, url);
      }
      if (path === '/api/loyalty/earn' && method === 'POST') {
        const m = await import('./worker/loyalty');
        return m.handleEarnPoints(request, env, auth);
      }
      if (path === '/api/loyalty/redeem' && method === 'POST') {
        const m = await import('./worker/loyalty');
        return m.handleRedeemPoints(request, env, auth);
      }
      if (path === '/api/loyalty/adjust' && method === 'POST') {
        const m = await import('./worker/loyalty');
        return m.handleAdjustPoints(request, env, auth);
      }

      // ── Sprint 39 — Multi-currency + Tax engine multi-région (AUTHED) ──────
      // 12 routes : 4 currencies (cache + refresh + override manuel) +
      // 4 tax-regions (CRUD admin-managed) + 2 tax-rules (par région) +
      // 1 listing (collection rules) + 1 delete (rule isolée).
      // Capability `settings.manage` partout (admin-only Phase A — calque
      // ecommerce-region.ts handler PUT). Réponses normalisées { data }
      // / { error } via json() helpers — pas de champ `code`.
      // Ordre anti-shadowing strict : statiques AVANT régex, /:id/rules
      // AVANT /:id générique (calque LOT-GIFTCARDS-LOYALTY-S38 §3).

      // Currencies (statiques uniquement — pas de :id générique)
      if (path === '/api/currencies' && method === 'GET') {
        const m = await import('./worker/currencies');
        return m.handleListCurrencies(env, auth);
      }
      if (path === '/api/currencies/rates' && method === 'GET') {
        const m = await import('./worker/currencies');
        return m.handleListRates(env, auth, url);
      }
      if (path === '/api/currencies/rates/refresh' && method === 'POST') {
        const m = await import('./worker/currencies');
        return m.handleRefreshRates(request, env, auth);
      }
      if (path === '/api/currencies/rates/override' && method === 'POST') {
        const m = await import('./worker/currencies');
        return m.handleSetManualRate(request, env, auth);
      }

      // Tax regions : collection AVANT régex (statique prioritaire)
      if (path === '/api/tax-regions' && method === 'GET') {
        const m = await import('./worker/tax-regions');
        return m.handleListTaxRegions(env, auth, url);
      }
      if (path === '/api/tax-regions' && method === 'POST') {
        const m = await import('./worker/tax-regions');
        return m.handleCreateTaxRegion(request, env, auth);
      }
      // /:id/rules AVANT /:id générique (anti-shadowing impératif)
      const taxRegionRulesMatch = path.match(/^\/api\/tax-regions\/([^/]+)\/rules$/);
      if (taxRegionRulesMatch && method === 'GET') {
        const m = await import('./worker/tax-regions');
        return m.handleListTaxRules(env, auth, taxRegionRulesMatch[1]!);
      }
      if (taxRegionRulesMatch && method === 'POST') {
        const m = await import('./worker/tax-regions');
        return m.handleCreateTaxRule(request, env, auth, taxRegionRulesMatch[1]!);
      }
      // /:id générique (PUT / DELETE) — APRÈS suffixes
      const taxRegionIdMatch = path.match(/^\/api\/tax-regions\/([^/]+)$/);
      if (taxRegionIdMatch && method === 'PUT') {
        const m = await import('./worker/tax-regions');
        return m.handleUpdateTaxRegion(request, env, auth, taxRegionIdMatch[1]!);
      }
      if (taxRegionIdMatch && method === 'DELETE') {
        const m = await import('./worker/tax-regions');
        return m.handleDeleteTaxRegion(env, auth, taxRegionIdMatch[1]!);
      }
      // Tax rules — delete isolé par rule_id (pas de :region_id ici)
      const taxRuleDeleteMatch = path.match(/^\/api\/tax-rules\/([^/]+)$/);
      if (taxRuleDeleteMatch && method === 'DELETE') {
        const m = await import('./worker/tax-regions');
        return m.handleDeleteTaxRule(env, auth, taxRuleDeleteMatch[1]!);
      }

      // ── Tax rates (Sprint 70) ─────────────────────────────────────────────
      if (path === '/api/tax-rates' && method === 'GET') {
        const m = await import('./worker/ecommerce-taxes');
        return m.handleListTaxRates(env, auth);
      }
      if (path === '/api/tax-rates' && method === 'POST') {
        const m = await import('./worker/ecommerce-taxes');
        return m.handleCreateTaxRate(request, env, auth);
      }
      const taxRateIdMatch = path.match(/^\/api\/tax-rates\/([^/]+)$/);
      if (taxRateIdMatch && method === 'PUT') {
        const m = await import('./worker/ecommerce-taxes');
        return m.handleUpdateTaxRate(request, env, auth, taxRateIdMatch[1]!);
      }
      if (taxRateIdMatch && method === 'DELETE') {
        const m = await import('./worker/ecommerce-taxes');
        return m.handleDeleteTaxRate(env, auth, taxRateIdMatch[1]!);
      }


      // ── Sprint 40 — Product Reviews + Abandoned Carts (AUTHED) ─────────────
      // 6 routes AUTHED. Capability `reports.view` (lecture queue + sequence
      // states) / `clients.manage` (mutations modération + delete + recovery
      // config) — FIGÉE seq80, ZÉRO ajout à ALL_CAPABILITIES (calque
      // gift-cards.ts / loyalty.ts). Réponses normalisées { data } / { error }.
      // Ordre anti-shadowing strict : statique `/moderation-queue` AVANT régex
      // `/:id/moderate` AVANT régex `/:id` générique (DELETE).
      if (path === '/api/reviews/moderation-queue' && method === 'GET') {
        const m = await import('./worker/product-reviews');
        return m.handleModerationQueue(env, auth, url);
      }
      const reviewModerateMatch = path.match(/^\/api\/reviews\/([^/]+)\/moderate$/);
      if (reviewModerateMatch && method === 'POST') {
        const m = await import('./worker/product-reviews');
        return m.handleModerateReview(request, env, auth, reviewModerateMatch[1]!);
      }
      const reviewDeleteMatch = path.match(/^\/api\/reviews\/([^/]+)$/);
      if (reviewDeleteMatch && method === 'DELETE') {
        const m = await import('./worker/product-reviews');
        return m.handleDeleteReview(env, auth, reviewDeleteMatch[1]!);
      }
      // Abandoned carts multi-touch sequence — ne touche PAS
      // ecommerce-cart-recovery.ts existant (E7 single-touch reste actif).
      if (path === '/api/ecommerce/carts/abandoned/sequence' && method === 'GET') {
        const m = await import('./worker/abandoned-carts');
        return m.handleListRecoverySequenceStates(env, auth);
      }
      const cartRecoveryConfigMatch = path.match(/^\/api\/ecommerce\/carts\/([^/]+)\/recovery-config$/);
      if (cartRecoveryConfigMatch && method === 'PUT') {
        const m = await import('./worker/abandoned-carts');
        return m.handleUpdateRecoveryConfig(request, env, auth, cartRecoveryConfigMatch[1]!);
      }
      if (path === '/api/recovery/cron/scan' && method === 'POST') {
        const m = await import('./worker/abandoned-carts');
        return m.handleCronScan(env, auth);
      }

      // Sprint 41 — AI Voice Agent (cap settings.manage seq80)
      // Étend Sprint 34 Twilio Voice — NE TOUCHE PAS twilio-twiml.ts / lib/twilio-voice.ts / voice.ts.
      // Ordre anti-shadowing strict : /scripts/:id/test AVANT /scripts/:id (segment + spécifique).
      if (path === '/api/voice-agent/scripts' && method === 'GET') {
        const m = await import('./worker/voice-agent');
        return m.handleListScripts(env, auth);
      }
      if (path === '/api/voice-agent/scripts' && method === 'POST') {
        const m = await import('./worker/voice-agent');
        return m.handleCreateScript(request, env, auth);
      }
      const vaScriptTestMatch = path.match(/^\/api\/voice-agent\/scripts\/([^/]+)\/test$/);
      if (vaScriptTestMatch && method === 'POST') {
        const m = await import('./worker/voice-agent');
        return m.handleTestScript(request, env, auth, vaScriptTestMatch[1]!);
      }
      const vaScriptMatch = path.match(/^\/api\/voice-agent\/scripts\/([^/]+)$/);
      if (vaScriptMatch && method === 'PATCH') {
        const m = await import('./worker/voice-agent');
        return m.handleUpdateScript(request, env, auth, vaScriptMatch[1]!);
      }
      if (vaScriptMatch && method === 'DELETE') {
        const m = await import('./worker/voice-agent');
        return m.handleDeleteScript(env, auth, vaScriptMatch[1]!);
      }
      if (path === '/api/voice-agent/calls' && method === 'GET') {
        const m = await import('./worker/voice-agent');
        return m.handleListCalls(env, auth, url);
      }
      const vaCallMatch = path.match(/^\/api\/voice-agent\/calls\/([^/]+)$/);
      if (vaCallMatch && method === 'GET') {
        const m = await import('./worker/voice-agent');
        return m.handleGetCallDetail(env, auth, vaCallMatch[1]!);
      }

      // Sprint 42 — AI Chat Agent (cap settings.manage seq80)
      // Étend Sprint 36 Webchat Widget — NE TOUCHE PAS webchat.ts / chat-widgets.ts / chat-session.ts / lib/chat-session-do.ts.
      // Ordre anti-shadowing strict : /knowledge/:id AVANT /knowledge collection, /config seul, /test seul.
      if (path === '/api/chat-bot/knowledge' && method === 'GET') { const m = await import('./worker/chat-bot'); return m.handleListKnowledge(env, auth); }
      if (path === '/api/chat-bot/knowledge' && method === 'POST') { const m = await import('./worker/chat-bot'); return m.handleCreateKnowledge(request, env, auth); }
      const chatKbIdMatch = path.match(/^\/api\/chat-bot\/knowledge\/([^/]+)$/);
      if (chatKbIdMatch && method === 'PATCH') { const m = await import('./worker/chat-bot'); return m.handleUpdateKnowledge(request, env, auth, chatKbIdMatch[1]!); }
      if (chatKbIdMatch && method === 'DELETE') { const m = await import('./worker/chat-bot'); return m.handleDeleteKnowledge(env, auth, chatKbIdMatch[1]!); }
      if (path === '/api/chat-bot/config' && method === 'GET') { const m = await import('./worker/chat-bot'); return m.handleGetConfig(env, auth); }
      if (path === '/api/chat-bot/config' && method === 'PUT') { const m = await import('./worker/chat-bot'); return m.handleUpdateConfig(request, env, auth); }
      if (path === '/api/chat-bot/test' && method === 'POST') { const m = await import('./worker/chat-bot'); return m.handleTestBot(request, env, auth); }
      if (path === '/api/chat-bot/sessions' && method === 'GET') { const m = await import('./worker/chat-bot'); return m.handleListChatbotSessions(env, auth); }
      const chatbotSessionIdMatch = path.match(/^\/api\/chat-bot\/sessions\/([^/]+)$/);
      if (chatbotSessionIdMatch && method === 'PUT') { const m = await import('./worker/chat-bot'); return m.handleToggleChatbotSession(request, env, auth, chatbotSessionIdMatch[1]!); }

      // Sprint 43 — Courses LMS (cap clients.manage admin, cap leads.write member-facing)
      // Étend memberships seq87 + seq107 — NE TOUCHE PAS courses / course_enrollments
      // (uniquement 3 ALTER ADD COLUMN additifs). Ordre anti-shadowing strict :
      // /courses/:id/lessons AVANT /lessons/:id/*, /lessons/:id/complete AVANT
      // /lessons/:id seul, /lessons/:id/quizzes AVANT /lessons/:id seul,
      // /quizzes/:id/questions AVANT /quizzes/:id/attempt, /enrollments/:id/progress,
      // /certificates collection AVANT /certificates/:id/download.
      const lessonsListMatch = path.match(/^\/api\/courses\/([^/]+)\/lessons$/);
      if (lessonsListMatch && method === 'GET') { const m = await import('./worker/courses-lms'); return m.handleListLessons(env, auth, lessonsListMatch[1]!); }
      if (lessonsListMatch && method === 'POST') { const m = await import('./worker/courses-lms'); return m.handleCreateLesson(request, env, auth, lessonsListMatch[1]!); }
      const lessonCompleteMatch = path.match(/^\/api\/lessons\/([^/]+)\/complete$/);
      if (lessonCompleteMatch && method === 'POST') { const m = await import('./worker/courses-lms'); return m.handleMarkLessonComplete(request, env, auth, lessonCompleteMatch[1]!); }
      const lessonQuizzesMatch = path.match(/^\/api\/lessons\/([^/]+)\/quizzes$/);
      if (lessonQuizzesMatch && method === 'GET') { const m = await import('./worker/courses-lms'); return m.handleListLessonQuizzes(env, auth, lessonQuizzesMatch[1]!); }
      if (lessonQuizzesMatch && method === 'POST') { const m = await import('./worker/courses-lms'); return m.handleCreateQuiz(request, env, auth, lessonQuizzesMatch[1]!); }
      const lmsLessonIdMatch = path.match(/^\/api\/lessons\/([^/]+)$/);
      if (lmsLessonIdMatch && method === 'PATCH') { const m = await import('./worker/courses-lms'); return m.handleUpdateLesson(request, env, auth, lmsLessonIdMatch[1]!); }
      if (lmsLessonIdMatch && method === 'DELETE') { const m = await import('./worker/courses-lms'); return m.handleDeleteLesson(env, auth, lmsLessonIdMatch[1]!); }
      const quizQuestionsMatch = path.match(/^\/api\/quizzes\/([^/]+)\/questions$/);
      if (quizQuestionsMatch && method === 'GET') { const m = await import('./worker/courses-lms'); return m.handleListQuizQuestions(env, auth, quizQuestionsMatch[1]!); }
      if (quizQuestionsMatch && method === 'POST') { const m = await import('./worker/courses-lms'); return m.handleCreateQuestion(request, env, auth, quizQuestionsMatch[1]!); }
      const quizAttemptMatch = path.match(/^\/api\/quizzes\/([^/]+)\/attempt$/);
      if (quizAttemptMatch && method === 'POST') { const m = await import('./worker/courses-lms'); return m.handleSubmitQuizAttempt(request, env, auth, quizAttemptMatch[1]!); }
      const enrollmentProgressMatch = path.match(/^\/api\/enrollments\/([^/]+)\/progress$/);
      if (enrollmentProgressMatch && method === 'GET') { const m = await import('./worker/courses-lms'); return m.handleGetProgress(env, auth, enrollmentProgressMatch[1]!); }
      if (path === '/api/certificates' && method === 'GET') { const m = await import('./worker/courses-lms'); return m.handleListCertificates(env, auth, url); }
      const certDownloadMatch = path.match(/^\/api\/certificates\/([^/]+)\/download$/);
      if (certDownloadMatch && method === 'GET') { const m = await import('./worker/courses-lms'); return m.handleDownloadCertificate(env, auth, certDownloadMatch[1]!); }

      // Sprint 44 — Funnels Builder (cap settings.manage) — tables fb_* seq139
      // (distinctes du LOT FUNNEL S1 seq83 — voir docs/LOT-FUNNELS-S44.md §6).
      // 14 routes AUTHED CRUD + analytics. Ordre anti-shadowing strict :
      // /funnels-builder/:id/analytics AVANT /funnels-builder/:id/steps,
      // /funnels-builder/:id/steps AVANT /funnels-builder/:id,
      // /funnels-builder/steps/:id/variants AVANT /funnels-builder/steps/:id,
      // /funnels-builder/variants/:id seul,
      // /funnels-builder/:id/publish AVANT /funnels-builder/:id.
      if (path === '/api/funnels-builder' && method === 'GET') { const m = await import('./worker/funnels-builder'); return m.handleListFunnels(env, auth, url); }
      if (path === '/api/funnels-builder' && method === 'POST') { const m = await import('./worker/funnels-builder'); return m.handleCreateFunnel(request, env, auth); }
      const fbAnalyticsMatch = path.match(/^\/api\/funnels-builder\/([^/]+)\/analytics$/);
      if (fbAnalyticsMatch && method === 'GET') { const m = await import('./worker/funnels-builder'); return m.handleGetAnalytics(env, auth, fbAnalyticsMatch[1]!); }
      const fbStepsListMatch = path.match(/^\/api\/funnels-builder\/([^/]+)\/steps$/);
      if (fbStepsListMatch && method === 'GET') { const m = await import('./worker/funnels-builder'); return m.handleListSteps(env, auth, fbStepsListMatch[1]!); }
      if (fbStepsListMatch && method === 'POST') { const m = await import('./worker/funnels-builder'); return m.handleCreateStep(request, env, auth, fbStepsListMatch[1]!); }
      const fbPublishMatch = path.match(/^\/api\/funnels-builder\/([^/]+)\/publish$/);
      if (fbPublishMatch && method === 'POST') { const m = await import('./worker/funnels-builder'); return m.handlePublishFunnel(request, env, auth, fbPublishMatch[1]!); }
      const fbVariantsListMatch = path.match(/^\/api\/funnels-builder\/steps\/([^/]+)\/variants$/);
      if (fbVariantsListMatch && method === 'GET') { const m = await import('./worker/funnels-builder'); return m.handleListVariants(env, auth, fbVariantsListMatch[1]!); }
      if (fbVariantsListMatch && method === 'POST') { const m = await import('./worker/funnels-builder'); return m.handleCreateVariant(request, env, auth, fbVariantsListMatch[1]!); }
      const fbStepIdMatch = path.match(/^\/api\/funnels-builder\/steps\/([^/]+)$/);
      if (fbStepIdMatch && method === 'PATCH') { const m = await import('./worker/funnels-builder'); return m.handleUpdateStep(request, env, auth, fbStepIdMatch[1]!); }
      if (fbStepIdMatch && method === 'DELETE') { const m = await import('./worker/funnels-builder'); return m.handleDeleteStep(env, auth, fbStepIdMatch[1]!); }
      const fbVariantIdMatch = path.match(/^\/api\/funnels-builder\/variants\/([^/]+)$/);
      if (fbVariantIdMatch && method === 'PATCH') { const m = await import('./worker/funnels-builder'); return m.handleUpdateVariant(request, env, auth, fbVariantIdMatch[1]!); }
      if (fbVariantIdMatch && method === 'DELETE') { const m = await import('./worker/funnels-builder'); return m.handleDeleteVariant(env, auth, fbVariantIdMatch[1]!); }
      const fbFunnelIdMatch = path.match(/^\/api\/funnels-builder\/([^/]+)$/);
      if (fbFunnelIdMatch && method === 'PATCH') { const m = await import('./worker/funnels-builder'); return m.handleUpdateFunnel(request, env, auth, fbFunnelIdMatch[1]!); }
      if (fbFunnelIdMatch && method === 'DELETE') { const m = await import('./worker/funnels-builder'); return m.handleDeleteFunnel(env, auth, fbFunnelIdMatch[1]!); }

      // ── Sprint 45 — Community / Groups forum tenant interne (AUTHED) ──────
      // 13 routes. Tables c45_* seq140 (distinctes seq93 G10 — AUTH MEMBRE
      // SÉPARÉE intouchée). Caps FIGÉES (AUCUN ajout ALL_CAPABILITIES seq 80) :
      //   - membres   : leads.write     (create/read threads/comments + vote)
      //   - modération: settings.manage (pin/lock/hide/delete/warn/ban)
      // Ordre anti-shadowing strict :
      //   /community/moderation                              AVANT /community/vote
      //   /community/threads/:id/comments (3 segments)       AVANT /community/threads/:id
      //   /community/threads/:id/pin   (3 segments)          AVANT /community/threads/:id
      //   /community/threads/:id/lock  (3 segments)          AVANT /community/threads/:id
      //   /community/comments/:id      (CRUD comment)        seul (collection list via thread)
      if (path === '/api/community/moderation' && method === 'GET') {
        const m = await import('./worker/community-forum');
        return m.handleListModerationActions(env, auth, url);
      }
      if (path === '/api/community/moderation' && method === 'POST') {
        const m = await import('./worker/community-forum');
        return m.handleModerateTarget(request, env, auth);
      }
      if (path === '/api/community/vote' && method === 'POST') {
        const m = await import('./worker/community-forum');
        return m.handleVote(request, env, auth);
      }
      if (path === '/api/community/threads' && method === 'GET') {
        const m = await import('./worker/community-forum');
        return m.handleListThreads(env, auth, url);
      }
      if (path === '/api/community/threads' && method === 'POST') {
        const m = await import('./worker/community-forum');
        return m.handleCreateThread(request, env, auth);
      }
      const s45ThreadCommentsMatch = path.match(/^\/api\/community\/threads\/([^/]+)\/comments$/);
      if (s45ThreadCommentsMatch && method === 'GET') {
        const m = await import('./worker/community-forum');
        return m.handleListComments(env, auth, s45ThreadCommentsMatch[1]!);
      }
      if (s45ThreadCommentsMatch && method === 'POST') {
        const m = await import('./worker/community-forum');
        return m.handleCreateComment(request, env, auth, s45ThreadCommentsMatch[1]!);
      }
      const s45ThreadPinMatch = path.match(/^\/api\/community\/threads\/([^/]+)\/pin$/);
      if (s45ThreadPinMatch && method === 'POST') {
        const m = await import('./worker/community-forum');
        return m.handlePinThread(request, env, auth, s45ThreadPinMatch[1]!);
      }
      const s45ThreadLockMatch = path.match(/^\/api\/community\/threads\/([^/]+)\/lock$/);
      if (s45ThreadLockMatch && method === 'POST') {
        const m = await import('./worker/community-forum');
        return m.handleLockThread(request, env, auth, s45ThreadLockMatch[1]!);
      }
      const s45ThreadIdMatch = path.match(/^\/api\/community\/threads\/([^/]+)$/);
      if (s45ThreadIdMatch && method === 'GET') {
        const m = await import('./worker/community-forum');
        return m.handleGetThread(env, auth, s45ThreadIdMatch[1]!);
      }
      if (s45ThreadIdMatch && method === 'PATCH') {
        const m = await import('./worker/community-forum');
        return m.handleUpdateThread(request, env, auth, s45ThreadIdMatch[1]!);
      }
      if (s45ThreadIdMatch && method === 'DELETE') {
        const m = await import('./worker/community-forum');
        return m.handleDeleteThread(env, auth, s45ThreadIdMatch[1]!);
      }
      const s45CommentIdMatch = path.match(/^\/api\/community\/comments\/([^/]+)$/);
      if (s45CommentIdMatch && method === 'PATCH') {
        const m = await import('./worker/community-forum');
        return m.handleUpdateComment(request, env, auth, s45CommentIdMatch[1]!);
      }
      if (s45CommentIdMatch && method === 'DELETE') {
        const m = await import('./worker/community-forum');
        return m.handleDeleteComment(env, auth, s45CommentIdMatch[1]!);
      }

      // ── Sprint 46 — Subscriptions avancées (AUTHED) ─────────────────────────
      // 10 routes étendant les rails billing S22/S31 (saas-billing*.ts INTOUCHÉS).
      // Caps FIGÉES : settings.manage admin partout (AUCUN ajout ALL_CAPABILITIES
      // seq 80). Stripe live INACTIF par défaut — flag BILLING_LIVE_ENABLED
      // tenant-by-tenant inchangé (idiome mock:true tant que flag absent).
      // Ordre anti-shadowing strict : tous suffixes spécifiques
      //   /subscriptions/:id/proration-preview | /upgrade | /downgrade | /pause
      //   /resume | /cancel | /history | /cron/dunning
      // sont CÂBLÉS ICI, AVANT toute route générique /subscriptions/:id (qui
      // doit être ailleurs, hors scope S46 — ne JAMAIS ajouter ici une route
      // /subscriptions/:id générique sans déplacer ce bloc après).
      const subProrationMatch = path.match(/^\/api\/subscriptions\/([^/]+)\/proration-preview$/);
      if (subProrationMatch && method === 'GET') {
        const m = await import('./worker/subscriptions-advanced');
        return m.handlePreviewProration(env, auth, subProrationMatch[1]!, url);
      }
      const subUpgradeMatch = path.match(/^\/api\/subscriptions\/([^/]+)\/upgrade$/);
      if (subUpgradeMatch && method === 'POST') {
        const m = await import('./worker/subscriptions-advanced');
        return m.handleUpgrade(request, env, auth, subUpgradeMatch[1]!);
      }
      const subDowngradeMatch = path.match(/^\/api\/subscriptions\/([^/]+)\/downgrade$/);
      if (subDowngradeMatch && method === 'POST') {
        const m = await import('./worker/subscriptions-advanced');
        return m.handleDowngrade(request, env, auth, subDowngradeMatch[1]!);
      }
      const subPauseMatch = path.match(/^\/api\/subscriptions\/([^/]+)\/pause$/);
      if (subPauseMatch && method === 'POST') {
        const m = await import('./worker/subscriptions-advanced');
        return m.handlePause(request, env, auth, subPauseMatch[1]!);
      }
      const subResumeMatch = path.match(/^\/api\/subscriptions\/([^/]+)\/resume$/);
      if (subResumeMatch && method === 'POST') {
        const m = await import('./worker/subscriptions-advanced');
        return m.handleResume(env, auth, subResumeMatch[1]!);
      }
      const subCancelMatch = path.match(/^\/api\/subscriptions\/([^/]+)\/cancel$/);
      if (subCancelMatch && method === 'POST') {
        const m = await import('./worker/subscriptions-advanced');
        return m.handleCancel(request, env, auth, subCancelMatch[1]!);
      }
      const subHistoryMatch = path.match(/^\/api\/subscriptions\/([^/]+)\/history$/);
      if (subHistoryMatch && method === 'GET') {
        const m = await import('./worker/subscriptions-advanced');
        return m.handleGetHistory(env, auth, subHistoryMatch[1]!);
      }
      if (path === '/api/subscriptions/cron/dunning' && method === 'POST') {
        const m = await import('./worker/subscriptions-advanced');
        return m.handleRunDunningCron(env, auth);
      }
      if (path === '/api/billing/metrics/mrr' && method === 'GET') {
        const m = await import('./worker/subscriptions-advanced');
        return m.handleGetMrrMetrics(env, auth, url);
      }
      if (path === '/api/billing/cron/mrr-snapshot' && method === 'POST') {
        const m = await import('./worker/subscriptions-advanced');
        return m.handleRunMrrSnapshotCron(env, auth);
      }

      // ── Sprint 47 — Multi-warehouse + Dropshipping (AUTHED) ────────────────
      // 19 routes étendant le pipeline e-commerce S(E1+) (ecommerce-*.ts
      // INTOUCHÉS). Caps FIGÉES : clients.manage (warehouses / transfers /
      // routings / dropship_orders) + settings.manage (dropship_suppliers
      // admin — secrets api_key sensibles). AUCUN ajout ALL_CAPABILITIES seq80.
      // supplier_api FLAG INACTIF par défaut (api_endpoint NULL ⇒ no-op) —
      // notifySupplier retourne sent:false jusqu'à activation tenant.
      //
      // Ordre anti-shadowing strict : suffixes /:id/<action> AVANT /:id générique :
      //   /warehouses/:id/default                    AVANT /warehouses/:id
      //   /inventory-transfers/:id/complete          (1 seul suffixe — pas de générique)
      //   /dropship-suppliers/:id/import-csv         AVANT /dropship-suppliers/:id
      //   /dropship-orders/route/:orderId            AVANT /dropship-orders/:id (futur)

      // Warehouses (5)
      if (path === '/api/warehouses' && method === 'GET') {
        const m = await import('./worker/warehouse-dropship');
        return m.handleListWarehouses(env, auth);
      }
      if (path === '/api/warehouses' && method === 'POST') {
        const m = await import('./worker/warehouse-dropship');
        return m.handleCreateWarehouse(request, env, auth);
      }
      const warehouseDefaultMatch = path.match(/^\/api\/warehouses\/([^/]+)\/default$/);
      if (warehouseDefaultMatch && method === 'POST') {
        const m = await import('./worker/warehouse-dropship');
        return m.handleSetDefaultWarehouse(env, auth, warehouseDefaultMatch[1]!);
      }
      const warehouseIdMatch = path.match(/^\/api\/warehouses\/([^/]+)$/);
      if (warehouseIdMatch && method === 'PATCH') {
        const m = await import('./worker/warehouse-dropship');
        return m.handleUpdateWarehouse(request, env, auth, warehouseIdMatch[1]!);
      }
      if (warehouseIdMatch && method === 'DELETE') {
        const m = await import('./worker/warehouse-dropship');
        return m.handleDeleteWarehouse(env, auth, warehouseIdMatch[1]!);
      }

      // Inventory Transfers (3)
      if (path === '/api/inventory-transfers' && method === 'GET') {
        const m = await import('./worker/warehouse-dropship');
        return m.handleListInventoryTransfers(env, auth);
      }
      if (path === '/api/inventory-transfers' && method === 'POST') {
        const m = await import('./worker/warehouse-dropship');
        return m.handleCreateInventoryTransfer(request, env, auth);
      }
      const transferCompleteMatch = path.match(/^\/api\/inventory-transfers\/([^/]+)\/complete$/);
      if (transferCompleteMatch && method === 'POST') {
        const m = await import('./worker/warehouse-dropship');
        return m.handleCompleteInventoryTransfer(env, auth, transferCompleteMatch[1]!);
      }

      // Dropship Suppliers (5)
      if (path === '/api/dropship-suppliers' && method === 'GET') {
        const m = await import('./worker/warehouse-dropship');
        return m.handleListDropshipSuppliers(env, auth);
      }
      if (path === '/api/dropship-suppliers' && method === 'POST') {
        const m = await import('./worker/warehouse-dropship');
        return m.handleCreateDropshipSupplier(request, env, auth);
      }
      const supplierImportCsvMatch = path.match(/^\/api\/dropship-suppliers\/([^/]+)\/import-csv$/);
      if (supplierImportCsvMatch && method === 'POST') {
        const m = await import('./worker/warehouse-dropship');
        return m.handleImportSupplierCatalogCsv(request, env, auth, supplierImportCsvMatch[1]!);
      }
      const supplierIdMatch = path.match(/^\/api\/dropship-suppliers\/([^/]+)$/);
      if (supplierIdMatch && method === 'PATCH') {
        const m = await import('./worker/warehouse-dropship');
        return m.handleUpdateDropshipSupplier(request, env, auth, supplierIdMatch[1]!);
      }
      if (supplierIdMatch && method === 'DELETE') {
        const m = await import('./worker/warehouse-dropship');
        return m.handleDeleteDropshipSupplier(env, auth, supplierIdMatch[1]!);
      }

      // Dropship Routings (4)
      if (path === '/api/dropship-routings' && method === 'GET') {
        const m = await import('./worker/warehouse-dropship');
        return m.handleListDropshipRoutings(env, auth);
      }
      if (path === '/api/dropship-routings' && method === 'POST') {
        const m = await import('./worker/warehouse-dropship');
        return m.handleCreateDropshipRouting(request, env, auth);
      }
      const routingIdMatch = path.match(/^\/api\/dropship-routings\/([^/]+)$/);
      if (routingIdMatch && method === 'PATCH') {
        const m = await import('./worker/warehouse-dropship');
        return m.handleUpdateDropshipRouting(request, env, auth, routingIdMatch[1]!);
      }
      if (routingIdMatch && method === 'DELETE') {
        const m = await import('./worker/warehouse-dropship');
        return m.handleDeleteDropshipRouting(env, auth, routingIdMatch[1]!);
      }

      // Dropship Orders (2)
      const dropshipOrderRouteMatch = path.match(/^\/api\/dropship-orders\/route\/([^/]+)$/);
      if (dropshipOrderRouteMatch && method === 'POST') {
        const m = await import('./worker/warehouse-dropship');
        return m.handleRouteOrderToSupplier(env, auth, dropshipOrderRouteMatch[1]!);
      }
      if (path === '/api/dropship-orders' && method === 'GET') {
        const m = await import('./worker/warehouse-dropship');
        return m.handleListDropshipOrders(env, auth);
      }

      // ── Sprint 67 — Portail Fournisseurs & Dropshipping (AUTHED) ──────────
      // Portail Partenaire
      if (path === '/api/dropship-portal/orders' && method === 'GET') {
        const m = await import('./worker/dropship-portal');
        return m.handleListPortalDropshipOrders(env, auth);
      }
      const portalShipMatch = path.match(/^\/api\/dropship-portal\/orders\/([^/]+)\/ship$/);
      if (portalShipMatch && method === 'POST') {
        const m = await import('./worker/dropship-portal');
        return m.handleShipPortalDropshipOrder(request, env, auth, portalShipMatch[1]!);
      }
      // Administration des partenaires
      if (path === '/api/dropship-partners' && method === 'GET') {
        const m = await import('./worker/dropship-portal');
        return m.handleListDropshipPartners(env, auth);
      }
      if (path === '/api/dropship-partners' && method === 'POST') {
        const m = await import('./worker/dropship-portal');
        return m.handleCreateDropshipPartner(request, env, auth);
      }
      const partnerIdMatch = path.match(/^\/api\/dropship-partners\/([^/]+)$/);
      if (partnerIdMatch && method === 'PATCH') {
        const m = await import('./worker/dropship-portal');
        return m.handleUpdateDropshipPartner(request, env, auth, partnerIdMatch[1]!);
      }
      if (partnerIdMatch && method === 'DELETE') {
        const m = await import('./worker/dropship-portal');
        return m.handleDeleteDropshipPartner(env, auth, partnerIdMatch[1]!);
      }

      // ── Sprint 48 — B2B wholesale + Bundles + Pre-orders (AUTHED) ────────
      // 22 routes étendant le pipeline e-commerce S(E1+) (ecommerce-*.ts
      // INTOUCHÉS). Caps FIGÉES : clients.manage (groups CRUD + assign,
      // tier_prices CRUD + resolve, bundles CRUD + items, preorders list +
      // notify + cancel + convert). AUCUN ajout ALL_CAPABILITIES seq80.
      // Route PUBLIC associée (POST /api/public/preorders) câblée AVANT le
      // chokepoint requireAuth (cf. bloc Sprint 48 PUBLIC ~ligne 776).
      //
      // Ordre anti-shadowing strict : suffixes /:id/<action> AVANT /:id générique :
      //   /customer-groups/:id/assign + /remove        AVANT /customer-groups/:id
      //   /customers/:id/groups                        (suffixe unique)
      //   /tier-prices/resolve                         AVANT /tier-prices/:id
      //   /product-bundles/:id/items                   AVANT /product-bundles/:id
      //   /preorders/:id/notify + /cancel + /convert   AVANT /preorders (collection)

      // Customer Groups (4 CRUD + 3 assign)
      if (path === '/api/customer-groups' && method === 'GET') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleListCustomerGroups(env, auth);
      }
      if (path === '/api/customer-groups' && method === 'POST') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleCreateCustomerGroup(request, env, auth);
      }
      const groupAssignMatch = path.match(/^\/api\/customer-groups\/([^/]+)\/assign$/);
      if (groupAssignMatch && method === 'POST') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleAssignCustomerToGroup(request, env, auth, groupAssignMatch[1]!);
      }
      const groupRemoveMatch = path.match(/^\/api\/customer-groups\/([^/]+)\/remove$/);
      if (groupRemoveMatch && method === 'POST') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleRemoveCustomerFromGroup(request, env, auth, groupRemoveMatch[1]!);
      }
      const groupIdMatch = path.match(/^\/api\/customer-groups\/([^/]+)$/);
      if (groupIdMatch && method === 'PATCH') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleUpdateCustomerGroup(request, env, auth, groupIdMatch[1]!);
      }
      if (groupIdMatch && method === 'DELETE') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleDeleteCustomerGroup(env, auth, groupIdMatch[1]!);
      }
      const customerGroupsMatch = path.match(/^\/api\/customers\/([^/]+)\/groups$/);
      if (customerGroupsMatch && method === 'GET') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleGetCustomerGroups(env, auth, customerGroupsMatch[1]!);
      }

      // Tier Prices (4 CRUD + 1 resolve)
      if (path === '/api/tier-prices/resolve' && method === 'GET') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleResolveTierPrice(env, auth, url);
      }
      if (path === '/api/tier-prices' && method === 'GET') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleListTierPrices(env, auth, url.searchParams.get('variant_id'));
      }
      if (path === '/api/tier-prices' && method === 'POST') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleCreateTierPrice(request, env, auth);
      }
      const tierIdMatch = path.match(/^\/api\/tier-prices\/([^/]+)$/);
      if (tierIdMatch && method === 'PATCH') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleUpdateTierPrice(request, env, auth, tierIdMatch[1]!);
      }
      if (tierIdMatch && method === 'DELETE') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleDeleteTierPrice(env, auth, tierIdMatch[1]!);
      }

      // Product Bundles (5 CRUD + 2 items) + bundle_items DELETE
      if (path === '/api/product-bundles' && method === 'GET') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleListProductBundles(env, auth);
      }
      if (path === '/api/product-bundles' && method === 'POST') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleCreateBundle(request, env, auth);
      }
      const bundleItemsMatch = path.match(/^\/api\/product-bundles\/([^/]+)\/items$/);
      if (bundleItemsMatch && method === 'GET') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleListBundleItems(env, auth, bundleItemsMatch[1]!);
      }
      if (bundleItemsMatch && method === 'POST') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleAddBundleItem(request, env, auth, bundleItemsMatch[1]!);
      }
      const bundleIdMatch = path.match(/^\/api\/product-bundles\/([^/]+)$/);
      if (bundleIdMatch && method === 'GET') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleGetBundle(env, auth, bundleIdMatch[1]!);
      }
      if (bundleIdMatch && method === 'PATCH') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleUpdateBundle(request, env, auth, bundleIdMatch[1]!);
      }
      if (bundleIdMatch && method === 'DELETE') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleDeleteBundle(env, auth, bundleIdMatch[1]!);
      }
      const bundleItemDeleteMatch = path.match(/^\/api\/bundle-items\/([^/]+)$/);
      if (bundleItemDeleteMatch && method === 'DELETE') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleRemoveBundleItem(env, auth, bundleItemDeleteMatch[1]!);
      }

      // Pre-orders (1 list + 3 actions)
      const preorderNotifyMatch = path.match(/^\/api\/preorders\/([^/]+)\/notify$/);
      if (preorderNotifyMatch && method === 'POST') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleNotifyPreorder(env, auth, preorderNotifyMatch[1]!);
      }
      const preorderCancelMatch = path.match(/^\/api\/preorders\/([^/]+)\/cancel$/);
      if (preorderCancelMatch && method === 'POST') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleCancelPreorder(env, auth, preorderCancelMatch[1]!);
      }
      const preorderConvertMatch = path.match(/^\/api\/preorders\/([^/]+)\/convert$/);
      if (preorderConvertMatch && method === 'POST') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleConvertPreorder(request, env, auth, preorderConvertMatch[1]!);
      }
      if (path === '/api/preorders' && method === 'GET') {
        const m = await import('./worker/b2b-bundles-preorders');
        return m.handleListPreorders(env, auth, url);
      }

      // ── Sprint 23 — Sécurité / conformité (AUTHED) ─────────────────────────
      // 9 routes : 1 cookies/me, 4 me/privacy (Loi 25), 4 admin (audit + RBAC
      // overrides). Gardes capability appliquées DANS les handlers Phase B
      // (settings.manage audit / team.manage RBAC). Le POST /api/cookies/consent
      // est câblé en PUBLIC avant le chokepoint requireAuth.
      if (path === '/api/cookies/consent/me' && method === 'GET') {
        const m = await import('./worker/cookies-consent');
        return m.handleGetMyCookieConsent(env, auth);
      }
      if (path === '/api/me/export-data' && method === 'GET') {
        const m = await import('./worker/me-privacy');
        return m.handleGetMyDataExport(env, auth);
      }
      if (path === '/api/me/delete-account' && method === 'GET') {
        const m = await import('./worker/me-privacy');
        return m.handleGetMyDeletionRequest(env, auth);
      }
      if (path === '/api/me/delete-account' && method === 'POST') {
        const m = await import('./worker/me-privacy');
        return m.handleRequestAccountDeletion(request, env, auth);
      }
      if (path === '/api/me/delete-account/cancel' && method === 'POST') {
        const m = await import('./worker/me-privacy');
        return m.handleCancelAccountDeletion(env, auth);
      }
      if (path === '/api/admin/audit-log' && method === 'GET') {
        const m = await import('./worker/security-admin');
        return m.handleGetAuditLog(request, env, auth);
      }
      if (path.startsWith('/api/admin/capability-overrides/') && method === 'GET') {
        const m = await import('./worker/security-admin');
        return m.handleGetCapabilityOverrides(request, env, auth);
      }
      if (path.startsWith('/api/admin/capability-overrides/') && method === 'POST') {
        const m = await import('./worker/security-admin');
        return m.handleSetCapabilityOverride(request, env, auth);
      }
      if (path.startsWith('/api/admin/capability-overrides/') && method === 'DELETE') {
        const m = await import('./worker/security-admin');
        return m.handleDeleteCapabilityOverride(request, env, auth);
      }

  if (path === '/api/meta/oauth/start' && method === 'GET') {
    const { handleMetaOauthStart } = await import('./worker/meta');
    return await handleMetaOauthStart(env, auth, url);
  }
  if (path === '/api/meta/oauth/callback' && method === 'GET') {
    const { handleMetaOauthCallback } = await import('./worker/meta');
    return await handleMetaOauthCallback(request, env, auth);
  }

  // Sprint 51 M1.2 — CRUD connexions Meta Lead Ads / Google Lead Form (admin)
  if (path === '/api/integrations/meta-lead/connections' && method === 'GET') {
    const { handleListLeadConnections } = await import('./worker/meta-leadgen');
    return await handleListLeadConnections(env, auth);
  }
  if (path === '/api/integrations/meta-lead/connections' && method === 'POST') {
    const { handleCreateLeadConnection } = await import('./worker/meta-leadgen');
    return await handleCreateLeadConnection(request, env, auth);
  }
  const leadConnDelMatch = path.match(/^\/api\/integrations\/meta-lead\/connections\/(meta|google)\/([^/]+)$/);
  if (leadConnDelMatch && method === 'DELETE') {
    const { handleDeleteLeadConnection } = await import('./worker/meta-leadgen');
    return await handleDeleteLeadConnection(env, auth, leadConnDelMatch[1]!, leadConnDelMatch[2]!);
  }

  // ── LOT G4 — OAuth natives (PROTÉGÉ). Capability 'settings.manage' appliquée
  //    DANS les handlers (capGuard). Préfixe /api/oauth/* neuf. Provider
  //    whitelisté (google|slack). Le callback est PUBLIC hors-try (cf. ~785).
  //    Bornage tenant strict : client_id depuis auth/state JAMAIS body.
  const oauthAuthorizeMatch = path.match(/^\/api\/oauth\/(google|slack)\/authorize$/);
  if (oauthAuthorizeMatch && method === 'GET') {
    const { handleOauthAuthorize } = await import('./worker/oauth');
    return handleOauthAuthorize(request, env, auth, oauthAuthorizeMatch[1] as 'google' | 'slack', url);
  }
  if (path === '/api/oauth/connections' && method === 'GET') {
    const { handleListOauthConnections } = await import('./worker/oauth');
    return handleListOauthConnections(request, env, auth);
  }
  const oauthConnDelMatch = path.match(/^\/api\/oauth\/connections\/([^/]+)$/);
  if (oauthConnDelMatch && method === 'DELETE') {
    const { handleDeleteOauthConnection } = await import('./worker/oauth');
    return handleDeleteOauthConnection(request, env, auth, oauthConnDelMatch[1]!);
  }
  if (path === '/api/oauth/gcal/events' && method === 'GET') {
    const { handleOauthGcalEvents } = await import('./worker/oauth');
    return handleOauthGcalEvents(request, env, auth, url);
  }

  // ── LOT SOCIAL PLANNER (Sprint 9) — composer + file + connexions + IA (PROTÉGÉ).
  //    Capabilities EXISTANTES appliquées DANS les handlers (capGuard — AUCUN
  //    ajout à ALL_CAPABILITIES) : posts/file → 'workflows.manage', génération IA
  //    → 'ai.use', connexions → 'settings.manage'. Bornage tenant strict
  //    (client_id depuis auth, JAMAIS body). Préfixe /api/social/* neuf. Ordre :
  //    sous-routes SPÉCIFIQUES (/schedule, /generate, /accounts) AVANT le
  //    /posts/:id générique (anti-shadowing). Publication réelle + analytics =
  //    MOCK / flag INACTIF. Corps réels Phase B Manager-B (social-posts.ts /
  //    social-accounts.ts / social-ai.ts / social-publish.ts).
  if (path === '/api/social/generate' && method === 'POST') {
    const { handleGenerateSocialPost } = await import('./worker/social-ai');
    return handleGenerateSocialPost(request, env, auth);
  }
  if (path === '/api/social/generate-image' && method === 'POST') {
    const { handleGenerateSocialImage } = await import('./worker/social-ai');
    return handleGenerateSocialImage(request, env, auth);
  }
  if (path === '/api/social/accounts' && method === 'GET') {
    const { handleListSocialAccounts } = await import('./worker/social-accounts');
    return handleListSocialAccounts(request, env, auth);
  }
  if (path === '/api/social/accounts/connect' && method === 'POST') {
    const { handleConnectSocialAccount } = await import('./worker/social-accounts');
    return handleConnectSocialAccount(request, env, auth);
  }
  const socialAccountDelMatch = path.match(/^\/api\/social\/accounts\/([^/]+)$/);
  if (socialAccountDelMatch && method === 'DELETE') {
    const { handleDeleteSocialAccount } = await import('./worker/social-accounts');
    return handleDeleteSocialAccount(request, env, auth, socialAccountDelMatch[1]!);
  }
  if (path === '/api/social/posts' && method === 'GET') {
    const { handleListSocialPosts } = await import('./worker/social-posts');
    return handleListSocialPosts(request, env, auth, url);
  }
  if (path === '/api/social/posts' && method === 'POST') {
    const { handleCreateSocialPost } = await import('./worker/social-posts');
    return handleCreateSocialPost(request, env, auth);
  }
  const socialPostScheduleMatch = path.match(/^\/api\/social\/posts\/([^/]+)\/schedule$/);
  if (socialPostScheduleMatch && method === 'POST') {
    const { handleScheduleSocialPost } = await import('./worker/social-posts');
    return handleScheduleSocialPost(request, env, auth, socialPostScheduleMatch[1]!);
  }
  const socialPostIdMatch = path.match(/^\/api\/social\/posts\/([^/]+)$/);
  if (socialPostIdMatch && method === 'PATCH') {
    const { handleUpdateSocialPost } = await import('./worker/social-posts');
    return handleUpdateSocialPost(request, env, auth, socialPostIdMatch[1]!);
  }
  if (socialPostIdMatch && method === 'DELETE') {
    const { handleDeleteSocialPost } = await import('./worker/social-posts');
    return handleDeleteSocialPost(request, env, auth, socialPostIdMatch[1]!);
  }

  // Reviews
  if (path === '/api/reviews' && method === 'GET') return handleGetReviews(env, auth, url);
  if (path === '/api/reviews/stats' && method === 'GET') return handleGetReviewStats(env, auth, url);
  if (path === '/api/reviews/requests' && method === 'GET') return handleGetReviewRequests(env, auth, url);
  if (path === '/api/reviews/requests' && method === 'POST') return handleCreateReviewRequest(request, env, auth);
  if (path === '/api/reviews/requests/bulk' && method === 'POST') return handleBulkReviewRequest(request, env, auth);
  if (path === '/api/reviews/suggest-reply' && method === 'POST') return handleSuggestReviewReply(request, env, auth);
  const reviewReplyMatch = path.match(/^\/api\/reviews\/([^/]+)\/reply$/);
  if (reviewReplyMatch && method === 'POST') return handleReplyToReview(request, env, auth, reviewReplyMatch[1]!);

  // ── LOT REPUTATION (Sprint 8) — settings réputation + feedback privé (PROTÉGÉ).
  //    Capability EXISTANTE 'settings.manage' appliquée DANS les handlers
  //    (capGuard — calque storefront/SMS/IVR/OAuth ; AUCUN ajout à
  //    ALL_CAPABILITIES) + bornage tenant. Lit/écrit reputation_settings ;
  //    liste private_feedback. NE casse PAS les 7 routes /api/reviews/* (flux
  //    1st-party séparé). Corps réels Phase B Manager-B (reputation.ts).
  if (path === '/api/reputation/settings' && method === 'GET') return handleGetReputationSettings(env, auth);
  if (path === '/api/reputation/settings' && method === 'PATCH') return handleUpdateReputationSettings(request, env, auth);
  if (path === '/api/reputation/private-feedback' && method === 'GET') return handleGetPrivateFeedback(env, auth);

  // Compliance
  if (path === '/api/unsubscribes' && method === 'GET') return handleGetUnsubscribes(env, auth, url);
  if (path === '/api/consent' && method === 'POST') return handleLogConsent(request, env, auth);
  if (path === '/api/consent' && method === 'GET') return handleGetConsent(env, auth, url);


  // Documents + e-sign (P4.3)
  if (path === '/api/files' && method === 'POST') return handleUploadFile(request, env, auth);
  if (path === '/api/files' && method === 'GET') return handleGetFiles(env, auth, url);
  const fileMatch = path.match(/^\/api\/files\/([^/]+)$/);
  if (fileMatch && method === 'GET') return handleGetFile(env, auth, fileMatch[1]!);
  if (fileMatch && method === 'DELETE') return handleDeleteFile(env, auth, fileMatch[1]!);
  if (path === '/api/document-templates' && method === 'GET') return handleGetDocumentTemplates(env, auth, url);
  if (path === '/api/document-templates' && method === 'POST') return handleCreateDocumentTemplate(request, env, auth);
  const dtMatch = path.match(/^\/api\/document-templates\/([^/]+)$/);
  if (dtMatch && method === 'PATCH') return handleUpdateDocumentTemplate(request, env, auth, dtMatch[1]!);
  if (dtMatch && method === 'DELETE') return handleDeleteDocumentTemplate(env, auth, dtMatch[1]!);
  if (path === '/api/documents' && method === 'GET') return handleGetDocuments(env, auth, url);
  if (path === '/api/documents' && method === 'POST') return handleCreateDocument(request, env, auth);
  const docsMatch = path.match(/^\/api\/documents\/([^/]+)$/);
  if (docsMatch && method === 'DELETE') { const { handleDeleteDocument } = await import('./worker/documents'); return await handleDeleteDocument(env, auth, docsMatch[1]!); }

  if (path === '/api/documents/generate-oaciq' && method === 'POST') { const { handleGenerateOaciq } = await import('./worker/documents'); return await handleGenerateOaciq(request, env, auth); }
  const docSendMatch = path.match(/^\/api\/documents\/([^/]+)\/send$/);
  if (docSendMatch && method === 'POST') return handleSendDocument(request, env, auth, docSendMatch[1]!);
  // Score Profiles (Phase 2.0)
  if (path === '/api/score-profiles' && method === 'GET') return handleGetScoreProfiles(env, auth, url);
  if (path === '/api/score-profiles' && method === 'POST') return handleCreateScoreProfile(request, env, auth);
  const spMatch = path.match(/^\/api\/score-profiles\/([^/]+)$/);
  if (spMatch && method === 'PATCH') return handleUpdateScoreProfile(request, env, auth, spMatch[1]!);

  // Modules (feature-flag par tenant) — Sprint E1 M2.1
  if (path === '/api/modules' && method === 'GET') {
    const { handleGetModules } = await import('./worker/modules');
    return await handleGetModules(env, auth);
  }
  if (path === '/api/modules' && method === 'PATCH') {
    const { handlePatchModules } = await import('./worker/modules');
    return await handlePatchModules(request, env, auth);
  }

  // Settings & Compliance
  if (path === '/api/settings/preferences' && method === 'GET') return handleGetPreferences(request, env);
  if (path === '/api/settings/preferences' && method === 'PATCH') return handleUpdatePreferences(request, env);
  if (path === '/api/settings/compliance' && method === 'GET') return handleGetClientCompliance(request, env, auth);
  if (path === '/api/settings/compliance' && method === 'PATCH') return handleUpdateClientCompliance(request, env, auth);
  
  // Properties / Centris
  if (path === '/api/properties' && method === 'GET') {
    const { handleGetProperties } = await import('./worker/properties');
    return await handleGetProperties(request, env, auth);
  }
  if (path === '/api/properties/centris-sync' && method === 'POST') {
    const { handleSyncCentris } = await import('./worker/properties');
    return await handleSyncCentris(request, env, auth);
  }
  const propMatch = path.match(/^\/api\/properties\/([^/]+)$/);
  if (propMatch && method === 'DELETE') {
    const { handleDeleteProperty } = await import('./worker/properties');
    return await handleDeleteProperty(env, auth, propMatch[1]!);
  }

  // /api/settings/sessions/* — alias legacy vers les handlers auth.ts (cf. Sprint 12 D.1)
  if (path === '/api/settings/sessions' && method === 'GET') return handleGetSessions(request, env);
  const settingsSessionMatch = path.match(/^\/api\/settings\/sessions\/([^/]+)$/);
  if (settingsSessionMatch && method === 'DELETE') return handleDeleteSession(request, env, settingsSessionMatch[1]!);
  
  if (path === '/api/settings/api-keys' && method === 'GET') return handleGetApiKeys(request, env);
  if (path === '/api/settings/api-keys' && method === 'POST') return handleCreateApiKey(request, env);
  const apiKeyMatch = path.match(/^\/api\/settings\/api-keys\/([^/]+)$/);
  if (apiKeyMatch && method === 'DELETE') return handleRevokeApiKey(request, env);

  if (path === '/api/settings/webhooks' && method === 'GET') return handleGetWebhooks(request, env);
  if (path === '/api/settings/webhooks' && method === 'POST') return handleCreateWebhook(request, env);
  const webhookMatch = path.match(/^\/api\/settings\/webhooks\/([^/]+)$/);
  if (webhookMatch && method === 'DELETE') return handleDeleteWebhook(request, env);
  const whDeliveriesMatch = path.match(/^\/api\/settings\/webhooks\/([^/]+)\/deliveries$/);
  if (whDeliveriesMatch && method === 'GET') {
    const { handleGetWebhookDeliveries } = await import('./worker/settings');
    return handleGetWebhookDeliveries(request, env);
  }
  const whTestMatch = path.match(/^\/api\/settings\/webhooks\/([^/]+)\/test$/);
  if (whTestMatch && method === 'POST') {
    const { handleTestWebhook } = await import('./worker/settings');
    return handleTestWebhook(request, env);
  }

  // Routage de numéros virtuels (Sprint 51)
  if (path === '/api/phone-numbers' && method === 'GET') return handleGetPhoneNumbers(request, env, auth);
  if (path === '/api/phone-numbers/search' && method === 'GET') return handleSearchPhoneNumbers(request, env, auth);
  if (path === '/api/phone-numbers/purchase' && method === 'POST') return handlePurchasePhoneNumber(request, env, auth);
  const pnIdMatch = path.match(/^\/api\/phone-numbers\/([^/]+)$/);
  if (pnIdMatch && method === 'DELETE') return handleReleasePhoneNumber(request, env, auth, pnIdMatch[1]!);
  const pnRoutingMatch = path.match(/^\/api\/phone-numbers\/([^/]+)\/routing$/);
  if (pnRoutingMatch && method === 'GET') return handleGetRoutingRules(request, env, auth, pnRoutingMatch[1]!);
  if (pnRoutingMatch && method === 'POST') return handleSaveRoutingRules(request, env, auth, pnRoutingMatch[1]!);

  // Campagnes Power Dialer (Sprint 54)
  if (path === '/api/dialer/campaigns' && method === 'GET') return handleGetDialerCampaigns(request, env, auth);
  if (path === '/api/dialer/campaigns' && method === 'POST') return handleCreateDialerCampaign(request, env, auth);
  const dialerLeadMatch = path.match(/^\/api\/dialer\/campaigns\/([^/]+)\/lead$/);
  if (dialerLeadMatch && method === 'GET') return handleGetDialerCurrentLead(request, env, auth, dialerLeadMatch[1]!);
  const dialerIdMatch = path.match(/^\/api\/dialer\/campaigns\/([^/]+)$/);
  if (dialerIdMatch && method === 'GET') return handleGetDialerCampaign(request, env, auth, dialerIdMatch[1]!);
  if (dialerIdMatch && method === 'PATCH') return handleUpdateDialerCampaign(request, env, auth, dialerIdMatch[1]!);
  if (dialerIdMatch && method === 'DELETE') return handleDeleteDialerCampaign(request, env, auth, dialerIdMatch[1]!);

  if (path === '/api/team/users' && method === 'GET') return handleGetUsers(request, env, auth);
  if (path === '/api/team/invites' && method === 'GET') return handleListInvitations(request, env, auth);
  if (path === '/api/team/invites' && method === 'POST') return handleInviteUser(request, env, auth);
  const inviteRevokeMatch = path.match(/^\/api\/team\/invites\/([^/]+)\/revoke$/);
  if (inviteRevokeMatch && method === 'POST') return handleRevokeInvitation(request, env, auth);
  const inviteResendMatch = path.match(/^\/api\/team\/invites\/([^/]+)\/resend$/);
  if (inviteResendMatch && method === 'POST') return handleResendInvitation(request, env, auth);
  const userMatch = path.match(/^\/api\/team\/users\/([^/]+)$/);
  if (userMatch && method === 'PATCH') {
    const res = await handleUpdateUserRole(request, env, auth);
    // ── Sprint 25 — Perf : bust capabilities/me du user dont le rôle a changé.
    // Best-effort silent (cacheBust never throws). Bust UNIQUEMENT sur 2xx.
    if (res.status >= 200 && res.status < 300) {
      const targetUserId = userMatch[1]!;
      const cacheKey = new Request(
        `https://cache.local/capabilities?user=${targetUserId}`,
        { method: 'GET' },
      );
      ctx.waitUntil(cacheBust(cacheKey));
    }
    return res;
  }
  if (userMatch && method === 'DELETE') return handleDeleteUser(request, env, auth);
  if (path === '/api/team/roles' && method === 'GET') return handleGetRoles(request, env, auth);
  if (path === '/api/team/roles/permissions' && method === 'POST') return handleUpdateRolePermission(request, env, auth);
  // ── LOT TEAM B — capabilities de l'utilisateur courant ──────────────────
  // ── Sprint 25 — Perf : cache TTL 30s (capabilities user lecture seule).
  // TTL court car bust se fait sur PATCH /api/team/users/:id. Clé canonique :
  // cache.local/capabilities?user=<auth.userId>. Best-effort dégradé silent.
  if (path === '/api/team/capabilities/me' && method === 'GET') {
    const cacheKey = new Request(
      `https://cache.local/capabilities?user=${auth.userId}`,
      { method: 'GET' },
    );
    const hit = await cacheGet(cacheKey);
    if (hit) return hit;
    const res = await handleGetMyCapabilities(request, env, auth);
    if (res.status === 200) {
      ctx.waitUntil(cachePut(cacheKey, res.clone(), 30));
    }
    return res;
  }

  // ── Sprint 84 — Journal d'Audit Système (System Audit Logs) ──────────────────
  if (path === '/api/system-audit-logs' && method === 'GET') {
    return handleGetSystemAuditLogs(request, env, auth);
  }

  // Mobile Prep (P3.10)
  // Soft delete / trash
  const softDeleteMatch = path.match(/^\/api\/leads\/([^/]+)\/trash$/);
  if (softDeleteMatch && method === 'POST') {
    const { handleSoftDeleteLead } = await import('./worker/mobile');
    return await handleSoftDeleteLead(env, auth, softDeleteMatch[1]!);
  }
  const restoreMatch = path.match(/^\/api\/leads\/([^/]+)\/restore$/);
  if (restoreMatch && method === 'POST') {
    const { handleRestoreLead } = await import('./worker/mobile');
    return await handleRestoreLead(env, auth, restoreMatch[1]!);
  }
  if (path === '/api/trash' && method === 'GET') {
    const { handleGetTrash } = await import('./worker/mobile');
    return await handleGetTrash(env, auth);
  }
  if (path === '/api/trash/empty' && method === 'POST') {
    const { handleEmptyTrash } = await import('./worker/mobile');
    return await handleEmptyTrash(env, auth);
  }
  // Device tokens (push notifications)
  if (path === '/api/devices' && method === 'POST') {
    const { handleRegisterDevice } = await import('./worker/mobile');
    return await handleRegisterDevice(request, env, auth);
  }
  if (path === '/api/devices' && method === 'DELETE') {
    const { handleUnregisterDevice } = await import('./worker/mobile');
    return await handleUnregisterDevice(request, env, auth);
  }
  // SSE events stream
  if (path === '/api/events/stream' && method === 'GET') {
    const { handleEventsStream } = await import('./worker/mobile');
    return await handleEventsStream(env, auth);
  }

  // D5 — SMS signing link
  const docSmsMatch = path.match(/^\/api\/documents\/([^/]+)\/send-sms$/);
  if (docSmsMatch && method === 'POST') return handleSendSigningSms(request, env, auth, docSmsMatch[1]!);

  // D7 — Industry Packs
  if (path === '/api/packs' && method === 'GET') return handleGetPacks(env, auth);
  const packSlugMatch = path.match(/^\/api\/packs\/([^/]+)$/);
  if (packSlugMatch && method === 'GET') return handleGetPackDetail(env, auth, packSlugMatch[1]!);
  const packInstallMatch = path.match(/^\/api\/packs\/([^/]+)\/install$/);
  if (packInstallMatch && method === 'POST') return handleInstallPack(request, env, auth, packInstallMatch[1]!);

  // D4 — Dashboard layouts
  if (path === '/api/dashboard/layouts' && method === 'GET') {
    const userId = auth.userId;
    const clientId = url.searchParams.get('client_id');
    let q = 'SELECT * FROM dashboard_layouts WHERE user_id = ?';
    const p: string[] = [userId];
    if (clientId) { q += ' AND (client_id = ? OR client_id IS NULL)'; p.push(clientId); }
    q += ' ORDER BY is_default DESC, updated_at DESC';
    const { results } = await env.DB.prepare(q).bind(...p).all();
    return json({ data: results || [] });
  }
  if (path === '/api/dashboard/layouts' && method === 'POST') {
    const body = await request.json() as { name?: string; layout_json?: string; client_id?: string; is_default?: boolean };
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO dashboard_layouts (id, user_id, client_id, name, layout_json, is_default) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, auth.userId, body.client_id || null, body.name || 'Mon dashboard', body.layout_json || '[]', body.is_default ? 1 : 0).run();
    return json({ data: { id } }, 201);
  }
  const dashLayoutMatch = path.match(/^\/api\/dashboard\/layouts\/([^/]+)$/);
  if (dashLayoutMatch && method === 'PATCH') {
    const body = await request.json() as { name?: string; layout_json?: string; is_default?: boolean };
    const updates: string[] = ["updated_at = datetime('now')"];
    const params: unknown[] = [];
    if (body.name) { updates.push('name = ?'); params.push(body.name); }
    if (body.layout_json) { updates.push('layout_json = ?'); params.push(body.layout_json); }
    if (body.is_default !== undefined) { updates.push('is_default = ?'); params.push(body.is_default ? 1 : 0); }
    params.push(dashLayoutMatch[1]!);
    await env.DB.prepare(`UPDATE dashboard_layouts SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
    return json({ data: { success: true } });
  }
  if (dashLayoutMatch && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM dashboard_layouts WHERE id = ? AND user_id = ?').bind(dashLayoutMatch[1]!, auth.userId).run();
    return json({ data: { success: true } });
  }

  // Phase 10 - Onboarding, Admin Reset, Feedback, NPS
  if (path === '/api/auth/onboarding' && method === 'POST') return handleCompleteOnboarding(request, env, auth);
  // Sprint 45 M1.1 — Welcome wizard 4 steps personnalisé
  if (path === '/api/onboarding' && method === 'POST') return handleWelcomeOnboarding(request, env, auth);
  // Sprint S8 — État onboarding persistant (reprise multi-appareil)
  if (path === '/api/onboarding/state' && method === 'GET') return handleGetOnboardingState(env, auth);
  if (path === '/api/onboarding/state' && method === 'PUT') return handlePutOnboardingState(request, env, auth);
  // Sprint 21 — Onboarding durci : checklist serveur + events (seq119).
  // capGuard 'settings.manage' DANS les handlers (mode-agence-only, calque
  // catalog.ts:41-49). Best-effort dégradé si seq119 non jouée.
  if (path === '/api/onboarding/checklist' && method === 'GET') return handleGetChecklist(request, env, auth);
  if (path === '/api/onboarding/checklist/complete' && method === 'POST') return handleCompleteChecklistItem(request, env, auth);
  if (path === '/api/onboarding/checklist/skip' && method === 'POST') return handleSkipChecklistItem(request, env, auth);
  if (path === '/api/onboarding/checklist/reset' && method === 'POST') return handleResetChecklist(request, env, auth);
  if (path === '/api/admin/demo-reset' && method === 'POST') return handleDemoReset(request, env, auth);
  // ── Sprint 100 — Security Audit endpoint ────────────────────────────────
  if (path === '/api/admin/security-audit' && method === 'GET') {
    const { handleSecurityAudit } = await import('./worker/security-audit');
    return handleSecurityAudit(env, auth);
  }
  // Sprint 46 M2 — Admin analytics endpoints (admin/owner only)
  if (path === '/api/admin/overview' && method === 'GET') return handleAdminOverview(request, env, auth);
  if (path === '/api/admin/activity-heatmap' && method === 'GET') return handleAdminActivityHeatmap(request, env, auth);
  if (path === '/api/admin/features-usage' && method === 'GET') return handleAdminFeaturesUsage(request, env, auth);
  // Sprint S-D §6.3 — Dashboard observabilité web-vitals (admin/owner only).
  // Garde admin LOCALE (réplique du patron admin-analytics.ts:16-23, pas
  // d'import cross-module) — la 403 est rendue ici avant de déléguer au
  // handler observability-ops, qui re-vérifie aussi (défense en profondeur).
  if (path === '/api/admin/web-vitals' && method === 'GET') {
    if (auth.role !== 'admin' && auth.role !== 'owner') {
      return json({ error: 'Accès réservé aux administrateurs.' }, 403);
    }
    return handleAdminWebVitals(request, env, auth);
  }
  // ── Sprint 24 — Observabilité : routes admin /api/admin/observability/* ──
  // Garde admin/owner LOCALE (calque patron admin-analytics.ts:16-23, comme
  // le bloc /api/admin/web-vitals ci-dessus). Dynamic import du module pour
  // rester aligné sur le pattern lazy des autres handlers admin (cf. ligne
  // ~2342 m.handleRequestAccountDeletion). Le sous-endpoint /web-vitals est
  // un PROXY direct vers handleAdminWebVitals (S-D figé) — pas de duplication.
  if (path.startsWith('/api/admin/observability/')) {
    if (auth.role !== 'admin' && auth.role !== 'owner') {
      return json({ error: 'Accès réservé aux administrateurs.', code: 'AGENCY_ONLY' }, 403);
    }
    const m = await import('./worker/observability-admin');
    if (path === '/api/admin/observability/health' && method === 'GET') {
      return m.handleGetObservabilityHealth(env, auth);
    }
    if (path === '/api/admin/observability/request-metrics' && method === 'GET') {
      // ── Sprint 25 — Perf : cache TTL 60s (agrégat lecture seule).
      // Clé canonique : cache.local/observability/request-metrics?tenant=<id>
      // &period=<period>. Best-effort dégradé silent. TTL 60s aligne avec la
      // résolution naturelle d'un bucket request_metrics (cf. seq120 minute).
      const tenant = auth.clientId ?? 'agency';
      const period = url.searchParams.get('period') ?? '24h';
      const cacheKey = new Request(
        `https://cache.local/observability/request-metrics?tenant=${tenant}&period=${period}`,
        { method: 'GET' },
      );
      const hit = await cacheGet(cacheKey);
      if (hit) return hit;
      const res = await m.handleGetRequestMetrics(request, env, auth);
      if (res.status === 200) {
        ctx.waitUntil(cachePut(cacheKey, res.clone(), 60));
      }
      return res;
    }
    if (path === '/api/admin/observability/errors' && method === 'GET') {
      return m.handleGetErrorMetrics(request, env, auth);
    }
    if (path === '/api/admin/observability/web-vitals' && method === 'GET') {
      // Proxy direct vers S-D §6.3 (figé) — pas de duplication.
      return handleAdminWebVitals(request, env, auth);
    }
    if (path === '/api/admin/observability/alerts' && method === 'GET') {
      return m.handleListAlerts(env, auth);
    }
    if (path === '/api/admin/observability/alert-rules' && method === 'POST') {
      return m.handleCreateAlertRule(request, env, auth);
    }
    const arMatch = path.match(/^\/api\/admin\/observability\/alert-rules\/([^/]+)$/);
    if (arMatch && method === 'PATCH') {
      return m.handleUpdateAlertRule(request, env, auth, arMatch[1]!);
    }
    if (arMatch && method === 'DELETE') {
      return m.handleDeleteAlertRule(env, auth, arMatch[1]!);
    }
  }
  if (path === '/api/admin/data-reconcile' && method === 'GET') {
    if (auth.role !== 'admin' && auth.role !== 'owner') {
      return json({ error: 'Accès réservé aux administrateurs.' }, 403);
    }
    return handleDataReconcile(request, env, auth);
  }
  // ── Sprint 30 — Release Candidate / Beta : check go-live programmatique ──
  // Garde admin/owner LOCALE (calque patron observability ci-dessus). Dynamic
  // import du module pour rester aligné sur le pattern lazy des autres
  // handlers admin. Read-only ; corps des checks rempli par Manager-B.
  if (path === '/api/admin/release-gates' && method === 'GET') {
    if (auth.role !== 'admin' && auth.role !== 'owner') {
      return json({ error: 'Accès réservé aux administrateurs.', code: 'AGENCY_ONLY' }, 403);
    }
    const m = await import('./worker/release-gates');
    return m.handleReleaseGatesCheck(request, env, auth);
  }
  if (path === '/api/feedback' && method === 'POST') return handleFeedback(request, env, auth);
  if (path === '/api/nps' && method === 'POST') return handleNps(request, env, auth);
  // Sprint 50 M3.4 — Feedback widget beta (type/message/url, distinct du NPS)
  if (path === '/api/beta/feedback' && method === 'POST') {
    const { handleBetaFeedback } = await import('./worker/beta');
    return handleBetaFeedback(request, env, auth);
  }

  // Phase 11 - Push notifications / Device tokens
  if (path === '/api/devices' && method === 'POST') return handleRegisterDevice(request, env, auth);
  const deviceTokenMatch = path.match(/^\/api\/devices\/(.+)$/);
  if (deviceTokenMatch && method === 'DELETE') return handleUnregisterDevice(request, env, auth, decodeURIComponent(deviceTokenMatch[1]!));
  if (path === '/api/notifications/push' && method === 'POST') {
    if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
    return handleSendPush(request, env);
  }

  // ── E-commerce (module Boutique B2) — Sprint E1 M3.1 ─────────────────────
  // CHAQUE route gated par requireModule('ecommerce') AVANT le handler
  // (403 JSON FR-QC si module absent — helper M2). Multi-tenant strict.
  if (path.startsWith('/api/ecommerce/')) {
    const { requireModule } = await import('./worker/modules');
    const guard = await requireModule(env, auth.userId, 'ecommerce');
    if (guard) return guard;
    const ec = await import('./worker/ecommerce');

    // Order Routing Rules (Sprint 66)
    if (path === '/api/ecommerce/order-routing-rules' && method === 'GET') {
      const { handleListOrderRoutingRules } = await import('./worker/order-routing-rules');
      return await handleListOrderRoutingRules(env, auth, url);
    }
    if (path === '/api/ecommerce/order-routing-rules' && method === 'POST') {
      const { handleCreateOrderRoutingRule } = await import('./worker/order-routing-rules');
      return await handleCreateOrderRoutingRule(request, env, auth);
    }
    const ruleMatch = path.match(/^\/api\/ecommerce\/order-routing-rules\/([^/]+)$/);
    if (ruleMatch && method === 'GET') {
      const { handleGetOrderRoutingRule } = await import('./worker/order-routing-rules');
      return await handleGetOrderRoutingRule(env, auth, ruleMatch[1]!);
    }
    if (ruleMatch && method === 'PUT') {
      const { handleUpdateOrderRoutingRule } = await import('./worker/order-routing-rules');
      return await handleUpdateOrderRoutingRule(request, env, auth, ruleMatch[1]!);
    }
    if (ruleMatch && method === 'DELETE') {
      const { handleDeleteOrderRoutingRule } = await import('./worker/order-routing-rules');
      return await handleDeleteOrderRoutingRule(env, auth, ruleMatch[1]!);
    }

    // Products
    if (path === '/api/ecommerce/products' && method === 'GET') return ec.handleListProducts(env, auth, url);
    if (path === '/api/ecommerce/products' && method === 'POST') return ec.handleCreateProduct(request, env, auth);
    const prodMatch = path.match(/^\/api\/ecommerce\/products\/([^/]+)$/);
    if (prodMatch && method === 'GET') return ec.handleGetProduct(env, auth, prodMatch[1]!);
    if (prodMatch && method === 'PATCH') return ec.handleUpdateProduct(request, env, auth, prodMatch[1]!);
    if (prodMatch && method === 'DELETE') return ec.handleDeleteProduct(env, auth, prodMatch[1]!);

    // Variantes (sous un produit) — Sprint E2 M1.2
    const varListMatch = path.match(/^\/api\/ecommerce\/products\/([^/]+)\/variants$/);
    if (varListMatch && method === 'GET') return ec.handleListVariants(env, auth, varListMatch[1]!);
    if (varListMatch && method === 'POST') return ec.handleCreateVariant(request, env, auth, varListMatch[1]!);
    const varMatch = path.match(/^\/api\/ecommerce\/products\/([^/]+)\/variants\/([^/]+)$/);
    if (varMatch && method === 'PATCH') return ec.handleUpdateVariant(request, env, auth, varMatch[1]!, varMatch[2]!);
    if (varMatch && method === 'DELETE') return ec.handleDeleteVariant(env, auth, varMatch[1]!, varMatch[2]!);

    // Catégories / collections — Sprint E2 M1.3
    if (path === '/api/ecommerce/categories' && method === 'GET') return ec.handleListCategories(env, auth, url);
    if (path === '/api/ecommerce/categories' && method === 'POST') return ec.handleCreateCategory(request, env, auth);
    const catMatch = path.match(/^\/api\/ecommerce\/categories\/([^/]+)$/);
    if (catMatch && method === 'PATCH') return ec.handleUpdateCategory(request, env, auth, catMatch[1]!);
    if (catMatch && method === 'DELETE') return ec.handleDeleteCategory(env, auth, catMatch[1]!);
    const prodCatMatch = path.match(/^\/api\/ecommerce\/products\/([^/]+)\/categories$/);
    if (prodCatMatch && method === 'PUT') return ec.handleSetProductCategories(request, env, auth, prodCatMatch[1]!);

    // Images produit — Sprint E2 M1.4
    const imgListMatch = path.match(/^\/api\/ecommerce\/products\/([^/]+)\/images$/);
    if (imgListMatch && method === 'GET') return ec.handleListImages(env, auth, imgListMatch[1]!);
    if (imgListMatch && method === 'POST') return ec.handleAddImage(request, env, auth, imgListMatch[1]!);
    const imgPrimaryMatch = path.match(/^\/api\/ecommerce\/products\/([^/]+)\/images\/([^/]+)\/primary$/);
    if (imgPrimaryMatch && method === 'PUT') return ec.handleSetPrimaryImage(env, auth, imgPrimaryMatch[1]!, imgPrimaryMatch[2]!);
    const imgMatch = path.match(/^\/api\/ecommerce\/products\/([^/]+)\/images\/([^/]+)$/);
    if (imgMatch && method === 'PATCH') return ec.handleUpdateImage(request, env, auth, imgMatch[1]!, imgMatch[2]!);
    if (imgMatch && method === 'DELETE') return ec.handleDeleteImage(env, auth, imgMatch[1]!, imgMatch[2]!);

    // Orders — Sprint E3 M1 : routes SPÉCIFIQUES avant le ordMatch générique
    // (sinon /orders/manual & /orders/:id/status seraient capturés par
    // ^/orders/([^/]+)$). requireModule('ecommerce') hérité du bloc.
    if (path === '/api/ecommerce/orders' && method === 'GET') return ec.handleListOrders(env, auth, url);
    if (path === '/api/ecommerce/orders' && method === 'POST') return ec.handleCreateOrder(request, env, auth);
    if (path === '/api/ecommerce/orders/manual' && method === 'POST')
      return ec.handleCreateManualOrder(request, env, auth);
    const ordStatusMatch = path.match(/^\/api\/ecommerce\/orders\/([^/]+)\/status$/);
    if (ordStatusMatch && method === 'PATCH')
      return ec.handleUpdateOrderStatus(request, env, auth, ordStatusMatch[1]!);
    // Sprint E4 M1 — init paiement : route SPÉCIFIQUE (/:id/payment) AVANT le
    // ordMatch générique (^/orders/([^/]+)$). Gated requireModule('ecommerce')
    // hérité du bloc + multi-tenant strict dans le handler.
    const ordPayMatch = path.match(/^\/api\/ecommerce\/orders\/([^/]+)\/payment$/);
    if (ordPayMatch && method === 'POST') {
      const ep = await import('./worker/ecommerce-payments');
      return ep.handleInitPayment(request, env, auth, ordPayMatch[1]!);
    }

    // ── Sprint E5 — Fulfillment region-aware (shipments + zones M2) ────────
    // Routes SPÉCIFIQUES placées AVANT le ordMatch générique
    // (^/orders/([^/]+)$) sinon /orders/:id/shipments serait capturé.
    // requireModule('ecommerce') hérité du bloc. Multi-tenant strict + (zones)
    // role admin gérés DANS les handlers. Handlers M1/M2 chargés par dynamic
    // import (pattern ecommerce-region l.1306) — noms figés au contrat E5.

    // M1 shipments — collection par commande + ressource directe
    const shipColMatch = path.match(/^\/api\/ecommerce\/orders\/([^/]+)\/shipments$/);
    if (shipColMatch && method === 'POST') {
      const es = await import('./worker/ecommerce-shipments');
      return es.handleCreateShipment(request, env, auth, shipColMatch[1]!);
    }
    if (shipColMatch && method === 'GET') {
      const es = await import('./worker/ecommerce-shipments');
      return es.handleListShipments(env, auth, shipColMatch[1]!);
    }
    const shipStatusMatch = path.match(/^\/api\/ecommerce\/shipments\/([^/]+)\/status$/);
    if (shipStatusMatch && method === 'PATCH') {
      const es = await import('./worker/ecommerce-shipments');
      return es.handleUpdateShipmentStatus(request, env, auth, shipStatusMatch[1]!);
    }
    const shipMatch = path.match(/^\/api\/ecommerce\/shipments\/([^/]+)$/);
    if (shipMatch && method === 'GET') {
      const es = await import('./worker/ecommerce-shipments');
      return es.handleGetShipment(env, auth, shipMatch[1]!);
    }

    // M2 zones/tarifs d'expédition (handlers fournis par M2, noms figés au
    // contrat E5 — câblés ici par M1 pour éviter toute race sur worker.ts).
    if (path === '/api/ecommerce/shipping/zones' && method === 'GET') {
      const sz = await import('./worker/ecommerce-shipping-zones');
      return sz.handleListZones(env, auth);
    }
    if (path === '/api/ecommerce/shipping/zones' && method === 'POST') {
      const sz = await import('./worker/ecommerce-shipping-zones');
      return sz.handleCreateZone(request, env, auth);
    }
    const zoneMatch = path.match(/^\/api\/ecommerce\/shipping\/zones\/([^/]+)$/);
    if (zoneMatch && method === 'PATCH') {
      const sz = await import('./worker/ecommerce-shipping-zones');
      return sz.handleUpdateZone(request, env, auth, zoneMatch[1]!);
    }
    if (zoneMatch && method === 'DELETE') {
      const sz = await import('./worker/ecommerce-shipping-zones');
      return sz.handleDeleteZone(env, auth, zoneMatch[1]!);
    }
    const zoneRatesMatch = path.match(/^\/api\/ecommerce\/shipping\/zones\/([^/]+)\/rates$/);
    if (zoneRatesMatch && method === 'GET') {
      const sz = await import('./worker/ecommerce-shipping-zones');
      return sz.handleListRates(env, auth, zoneRatesMatch[1]!);
    }
    if (zoneRatesMatch && method === 'POST') {
      const sz = await import('./worker/ecommerce-shipping-zones');
      return sz.handleCreateRate(request, env, auth, zoneRatesMatch[1]!);
    }
    const rateMatch = path.match(/^\/api\/ecommerce\/shipping\/rates\/([^/]+)$/);
    if (rateMatch && method === 'PATCH') {
      const sz = await import('./worker/ecommerce-shipping-zones');
      return sz.handleUpdateRate(request, env, auth, rateMatch[1]!);
    }
    if (rateMatch && method === 'DELETE') {
      const sz = await import('./worker/ecommerce-shipping-zones');
      return sz.handleDeleteRate(env, auth, rateMatch[1]!);
    }
    if (path === '/api/ecommerce/shipping/resolve' && method === 'POST') {
      const sz = await import('./worker/ecommerce-shipping-zones');
      return sz.handleResolveShippingRate(request, env, auth);
    }

    // ── Sprint E6 — Remboursements (M1) / Retours-RMA + Litiges (M2) /
    //    Politique conso (M3) ───────────────────────────────────────────────
    // Routes SPÉCIFIQUES placées AVANT le ordMatch générique
    // (^/orders/([^/]+)$) sinon /orders/:id/refund|policy serait capturé.
    // requireModule('ecommerce') hérité du bloc. Multi-tenant strict dans les
    // handlers. Mutations admin (RMA approve/receive/reject) : role admin géré
    // DANS handleUpdateReturn (pattern handleUpdateRegion). Handlers M1/M2/M3
    // chargés par dynamic import (pattern ecommerce-region) — noms FIGÉS au
    // contrat E6. ⚠️ ZONE RÉGULÉE — chemins remboursement/litige (revue Rochdi
    // requise) ; inoffensif tant que payments_live_enabled=0.

    // Refunds M1 (handlers figés ecommerce-refunds.ts — câblés ici par M2,
    // SEUL câbleur E6, pour éviter toute race sur worker.ts).
    const ordRefundMatch = path.match(/^\/api\/ecommerce\/orders\/([^/]+)\/refund$/);
    if (ordRefundMatch && method === 'POST') {
      const er = await import('./worker/ecommerce-refunds');
      return er.handleCreateRefund(request, env, auth, ordRefundMatch[1]!);
    }
    const ordRefundsMatch = path.match(/^\/api\/ecommerce\/orders\/([^/]+)\/refunds$/);
    if (ordRefundsMatch && method === 'GET') {
      const er = await import('./worker/ecommerce-refunds');
      return er.handleListRefunds(env, auth, ordRefundsMatch[1]!);
    }

    // Politique conso M3 (handler figé ecommerce-consumer-policy.ts — M3
    // l'exporte ; M2 câble. Import optionnel défensif si M3 pas encore livré).
    const ordPolicyMatch = path.match(/^\/api\/ecommerce\/orders\/([^/]+)\/policy$/);
    if (ordPolicyMatch && method === 'GET') {
      const cp = await import('./worker/ecommerce-consumer-policy');
      return cp.handleGetOrderPolicy(env, auth, ordPolicyMatch[1]!);
    }

    // Returns / RMA M2 (collection + ressource — approve/receive/reject admin).
    if (path === '/api/ecommerce/returns' && method === 'POST') {
      const rt = await import('./worker/ecommerce-returns');
      return rt.handleCreateReturn(request, env, auth);
    }
    if (path === '/api/ecommerce/returns' && method === 'GET') {
      const rt = await import('./worker/ecommerce-returns');
      return rt.handleListReturns(env, auth, url);
    }
    const returnMatch = path.match(/^\/api\/ecommerce\/returns\/([^/]+)$/);
    if (returnMatch && method === 'PATCH') {
      const rt = await import('./worker/ecommerce-returns');
      return rt.handleUpdateReturn(request, env, auth, returnMatch[1]!);
    }

    // Disputes M2 (liste tenant — l'enregistrement passe par le webhook).
    if (path === '/api/ecommerce/disputes' && method === 'GET') {
      const dp = await import('./worker/ecommerce-disputes');
      return dp.handleListDisputes(env, auth);
    }

    const ordMatch = path.match(/^\/api\/ecommerce\/orders\/([^/]+)$/);
    if (ordMatch && method === 'GET') return ec.handleGetOrder(env, auth, ordMatch[1]!);
    if (ordMatch && method === 'PATCH') return ec.handleUpdateOrder(request, env, auth, ordMatch[1]!);
    if (ordMatch && method === 'DELETE') return ec.handleDeleteOrder(env, auth, ordMatch[1]!);

    // ── Sprint E7 — Customer 360 / RFM / panier abandonné ────────────────
    // Routes SPÉCIFIQUES placées AVANT le custMatch générique
    // (^/customers/([^/]+)$) sinon /customers/:id/360 et /customers/rfm/
    // recompute seraient capturés par la route ressource. Handlers M1
    // (customer-metrics) directs ; handlers M2 (rfm / cart-recovery) par
    // dynamic import — NOMS FIGÉS au contrat E7. requireModule('ecommerce')
    // hérité du bloc, multi-tenant strict dans les handlers.
    const cust360Match = path.match(/^\/api\/ecommerce\/customers\/([^/]+)\/360$/);
    if (cust360Match && method === 'GET') {
      const cm = await import('./worker/ecommerce-customer-metrics');
      return cm.handleGetCustomer360(env, auth, cust360Match[1]!);
    }
    if (path === '/api/ecommerce/customers/rfm/recompute' && method === 'POST') {
      const rfm = await import('./worker/ecommerce-rfm');
      return rfm.handleRecomputeRfm(request, env, auth);
    }
    if (path === '/api/ecommerce/carts/abandoned' && method === 'GET') {
      const cr = await import('./worker/ecommerce-cart-recovery');
      return cr.handleListAbandonedCarts(env, auth);
    }
    const cartRecoverMatch = path.match(/^\/api\/ecommerce\/carts\/([^/]+)\/recover$/);
    if (cartRecoverMatch && method === 'POST') {
      const cr = await import('./worker/ecommerce-cart-recovery');
      return cr.handleRecoverCart(request, env, auth, cartRecoverMatch[1]!);
    }

    // ── Sprint E9 — Analytics e-commerce + recommandations / churn ───────
    // DERNIER sprint roadmap e-comm. Routes SPÉCIFIQUES placées AVANT le
    // custMatch générique (^/customers/([^/]+)$) sinon /reco/churn/:id et
    // /analytics/* seraient mal capturés. requireModule('ecommerce') hérité
    // du bloc + multi-tenant strict DANS les handlers M2. Handlers M2
    // (ecommerce-analytics.ts / ecommerce-reco.ts) chargés par dynamic
    // import — NOMS FIGÉS au contrat E9 (M3 = SEUL câbleur E9). Dégrade
    // proprement si M2 pas encore livré runtime : le dynamic import lève,
    // capturé par le try/catch du bloc /api/ecommerce/* → l'UI gère le
    // fallback (apiFetch renvoie { error }). Aucune réimplémentation ici.
    if (path === '/api/ecommerce/analytics/revenue' && method === 'GET') {
      const an = await import('./worker/ecommerce-analytics');
      return an.handleEcommerceRevenue(env, auth, url);
    }
    if (path === '/api/ecommerce/analytics/cohorts' && method === 'GET') {
      const an = await import('./worker/ecommerce-analytics');
      return an.handleEcommerceCohorts(env, auth, url);
    }
    if (path === '/api/ecommerce/analytics/ltv' && method === 'GET') {
      const an = await import('./worker/ecommerce-analytics');
      return an.handleEcommerceLtv(env, auth, url);
    }
    if (path === '/api/ecommerce/analytics/top-products' && method === 'GET') {
      const an = await import('./worker/ecommerce-analytics');
      return an.handleEcommerceTopProducts(env, auth, url);
    }
    // MICRO-FIX Sprint 4 — route oubliée vers handleEcommerceSalesByChannel
    // (déjà écrite/exportée ecommerce-analytics.ts:484, signature identique
    // aux 4 voisines : (env, auth, url) => Promise<Response>). Pur câblage.
    if (path === '/api/ecommerce/analytics/sales-by-channel' && method === 'GET') {
      const an = await import('./worker/ecommerce-analytics');
      return an.handleEcommerceSalesByChannel(env, auth, url);
    }
    const recoProdMatch = path.match(/^\/api\/ecommerce\/reco\/products\/([^/]+)$/);
    if (recoProdMatch && method === 'GET') {
      const re = await import('./worker/ecommerce-reco');
      return re.handleProductRecommendations(env, auth, recoProdMatch[1]!);
    }
    const recoChurnMatch = path.match(/^\/api\/ecommerce\/reco\/churn\/([^/]+)$/);
    if (recoChurnMatch && method === 'GET') {
      const re = await import('./worker/ecommerce-reco');
      return re.handleCustomerChurnPredict(env, auth, recoChurnMatch[1]!);
    }

    // Customers
    if (path === '/api/ecommerce/customers' && method === 'GET') return ec.handleListCustomers(env, auth, url);
    if (path === '/api/ecommerce/customers' && method === 'POST') return ec.handleCreateCustomer(request, env, auth);
    const custMatch = path.match(/^\/api\/ecommerce\/customers\/([^/]+)$/);
    if (custMatch && method === 'GET') return ec.handleGetCustomer(env, auth, custMatch[1]!);
    if (custMatch && method === 'PATCH') return ec.handleUpdateCustomer(request, env, auth, custMatch[1]!);
    if (custMatch && method === 'DELETE') return ec.handleDeleteCustomer(env, auth, custMatch[1]!);

    // ── E-R M2 region — Config région boutique (tenant courant) ───────────
    // Route SPÉCIFIQUE /region placée AVANT le ordMatch générique
    // (^/orders/([^/]+)$) — pas capturée de toute façon (path ≠ orders),
    // ordering respecté par convention du bloc. requireModule('ecommerce')
    // hérité du bloc. PUT = admin only (check dans le handler).
    if (path === '/api/ecommerce/region' && method === 'GET') {
      const rg = await import('./worker/ecommerce-region');
      return rg.handleGetRegion(env, auth);
    }
    if (path === '/api/ecommerce/region' && method === 'PUT') {
      const rg = await import('./worker/ecommerce-region');
      return rg.handleUpdateRegion(request, env, auth);
    }

    // ── Inventaire / mouvements / alertes / import — Sprint E2 M2 ──────────
    // (héritent du gating requireModule('ecommerce') du bloc + multi-tenant)

    // M2.4 — Import bulk produits (?dryRun=1 pour aperçu sans écriture)
    if (path === '/api/ecommerce/products/import' && method === 'POST')
      return ec.handleImportProducts(request, env, auth, url);

    // M2.3 — Alertes stock faible (liste)
    if (path === '/api/ecommerce/inventory/low-stock' && method === 'GET')
      return ec.handleListLowStock(env, auth, url);

    // M2.1 — Inventaire par variante (état / set)
    const invMatch = path.match(/^\/api\/ecommerce\/variants\/([^/]+)\/inventory$/);
    if (invMatch && method === 'GET') return ec.handleGetInventory(env, auth, invMatch[1]!);
    if (invMatch && method === 'PUT') return ec.handleSetInventory(request, env, auth, invMatch[1]!);

    // M2.2 — Ajustement de stock + historique des mouvements
    const invAdjustMatch = path.match(/^\/api\/ecommerce\/variants\/([^/]+)\/inventory\/adjust$/);
    if (invAdjustMatch && method === 'POST')
      return ec.handleAdjustInventory(request, env, auth, invAdjustMatch[1]!);
    const invMovMatch = path.match(/^\/api\/ecommerce\/variants\/([^/]+)\/inventory\/movements$/);
    if (invMovMatch && method === 'GET')
      return ec.handleListMovements(env, auth, invMovMatch[1]!, url);

    // ── E3 M2 cart/invoice ────────────────────────────────────────────────
    // Panier (CRUD + conversion via createOrderCore), historique commandes
    // client, données facture PDF. requireModule('ecommerce') hérité du bloc.
    // Routes SPÉCIFIQUES (/cart/items, /cart/:id/convert) avant les génériques.
    if (path === '/api/ecommerce/cart' && method === 'GET')
      return ec.handleGetCart(env, auth, url);
    if (path === '/api/ecommerce/cart/items' && method === 'POST')
      return ec.handleAddCartItem(request, env, auth);
    const cartItemMatch = path.match(/^\/api\/ecommerce\/cart\/items\/([^/]+)$/);
    if (cartItemMatch && method === 'PATCH')
      return ec.handleUpdateCartItem(request, env, auth, cartItemMatch[1]!);
    if (cartItemMatch && method === 'DELETE')
      return ec.handleDeleteCartItem(env, auth, cartItemMatch[1]!);
    const cartConvertMatch = path.match(/^\/api\/ecommerce\/cart\/([^/]+)\/convert$/);
    if (cartConvertMatch && method === 'POST')
      return ec.handleConvertCart(request, env, auth, cartConvertMatch[1]!);
    const custOrdersMatch = path.match(/^\/api\/ecommerce\/customers\/([^/]+)\/orders$/);
    if (custOrdersMatch && method === 'GET')
      return ec.handleCustomerOrders(env, auth, custOrdersMatch[1]!);
    const ordInvoiceMatch = path.match(/^\/api\/ecommerce\/orders\/([^/]+)\/invoice$/);
    if (ordInvoiceMatch && method === 'GET')
      return ec.handleGetOrderInvoice(env, auth, ordInvoiceMatch[1]!);

    // ── Sprint E8 M2 — Omnicanal : canaux de vente + OAuth + sync ─────────
    // Handlers CRUD canaux = M1 (façade ecommerce.ts, noms FIGÉS — on CÂBLE,
    // on ne réimplémente pas). Routes connect/callback/sync/sync-log = M2.
    // Routes SPÉCIFIQUES (/channels/:id/connect|callback|sync|sync-log|
    // strategy) placées AVANT le générique /channels/:id (sinon capturé).
    // requireModule('ecommerce') hérité du bloc. Mutations = role admin
    // (vérifié dans les handlers M1 + garde explicite ci-dessous pour M2).
    if (path === '/api/ecommerce/channels' && method === 'GET')
      return ec.handleListChannels(env, auth);
    if (path === '/api/ecommerce/channels' && method === 'POST')
      return ec.handleCreateChannel(request, env, auth);
    const chStrategyMatch = path.match(/^\/api\/ecommerce\/channels\/([^/]+)\/strategy$/);
    if (chStrategyMatch && method === 'PATCH')
      return ec.handleSetInventoryStrategy(request, env, auth, chStrategyMatch[1]!);
    const chConnectMatch = path.match(/^\/api\/ecommerce\/channels\/([^/]+)\/connect$/);
    if (chConnectMatch && method === 'POST') {
      if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
      const sync = await import('./worker/ecommerce-channel-sync');
      const { getClientModules } = await import('./worker/modules');
      const { clientId } = await getClientModules(env, auth.userId);
      if (!clientId) return json({ error: 'Client introuvable' }, 400);
      const channel = await sync.loadChannel(env, clientId, chConnectMatch[1]!);
      if (!channel) return json({ error: 'Canal introuvable' }, 404);
      const origin = new URL(request.url).origin;
      if (channel.type === 'shopify') {
        const sh = await import('./worker/ecommerce-channel-shopify');
        return sh.shopifyConnect(env, channel, origin);
      }
      if (channel.type === 'woo') {
        const wo = await import('./worker/ecommerce-channel-woo');
        return wo.wooConnect(env, channel, origin);
      }
      return json({ error: 'Canal natif : aucune connexion externe' }, 400);
    }
    const chCallbackMatch = path.match(/^\/api\/ecommerce\/channels\/([^/]+)\/callback$/);
    if (chCallbackMatch && (method === 'GET' || method === 'POST')) {
      if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
      const sync = await import('./worker/ecommerce-channel-sync');
      const { getClientModules } = await import('./worker/modules');
      const { clientId } = await getClientModules(env, auth.userId);
      if (!clientId) return json({ error: 'Client introuvable' }, 400);
      const channel = await sync.loadChannel(env, clientId, chCallbackMatch[1]!);
      if (!channel) return json({ error: 'Canal introuvable' }, 404);
      if (channel.type === 'shopify') {
        const sh = await import('./worker/ecommerce-channel-shopify');
        return sh.shopifyCallback(env, channel, url);
      }
      if (channel.type === 'woo') {
        const wo = await import('./worker/ecommerce-channel-woo');
        return wo.wooCallback(env, channel, request, url);
      }
      return json({ error: 'Canal natif : pas de callback' }, 400);
    }
    const chSyncMatch = path.match(/^\/api\/ecommerce\/channels\/([^/]+)\/sync$/);
    if (chSyncMatch && method === 'POST') {
      if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
      const sync = await import('./worker/ecommerce-channel-sync');
      const { getClientModules } = await import('./worker/modules');
      const { clientId } = await getClientModules(env, auth.userId);
      if (!clientId) return json({ error: 'Client introuvable' }, 400);
      const channel = await sync.loadChannel(env, clientId, chSyncMatch[1]!);
      if (!channel) return json({ error: 'Canal introuvable' }, 404);
      // Trigger manuel : pousse le stock de toutes les variantes mappées de
      // ce canal (pull entrant = webhooks). Anti-echo géré par syncProductOut.
      const { results } = await env.DB.prepare(
        `SELECT internal_variant_id FROM channel_product_map WHERE channel_id = ?`,
      ).bind(channel.id).all();
      let products = 0;
      let pushFn: (e: string, q: number) => Promise<boolean>;
      if (channel.type === 'shopify') {
        const sh = await import('./worker/ecommerce-channel-shopify');
        pushFn = await sh.shopifyPushFn(env, channel);
      } else if (channel.type === 'woo') {
        const wo = await import('./worker/ecommerce-channel-woo');
        pushFn = await wo.wooPushFn(env, channel);
      } else {
        return json({ error: 'Canal natif : rien à synchroniser' }, 400);
      }
      for (const r of (results || []) as Array<{ internal_variant_id: string }>) {
        const out = await sync.syncProductOut(
          env, channel, r.internal_variant_id, pushFn,
        );
        if (out.pushed) products++;
      }
      return json({ data: { synced: { products, orders: 0 } } });
    }
    const chSyncLogMatch = path.match(/^\/api\/ecommerce\/channels\/([^/]+)\/sync-log$/);
    if (chSyncLogMatch && method === 'GET') {
      const { getClientModules } = await import('./worker/modules');
      const { clientId } = await getClientModules(env, auth.userId);
      if (!clientId) return json({ error: 'Client introuvable' }, 400);
      const { results } = await env.DB.prepare(
        `SELECT id, channel_id, direction, entity_type, status, external_id,
                conflict_json, created_at
           FROM channel_sync_log
          WHERE channel_id = ? AND client_id = ?
          ORDER BY created_at DESC LIMIT 100`,
      ).bind(chSyncLogMatch[1]!, clientId).all();
      return json({ data: results || [] });
    }
    // ── S7 M-C — Rotation / révocation du secret d'un canal ──────────────
    // Routes SPÉCIFIQUES placées AVANT le générique /channels/:id (sinon
    // capturées). Même pattern d'auth + résolution tenant que connect/sync :
    // admin only, clientId résolu via getClientModules, canal chargé via
    // loadChannel (404 + multi-tenant strict). Anti-fuite Loi 25 : on ne
    // logue jamais le token/secret ; rotation.ts gère le secret-store.
    const chRotateMatch = path.match(/^\/api\/ecommerce\/channels\/([^/]+)\/rotate$/);
    if (chRotateMatch && method === 'POST') {
      if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
      const sync = await import('./worker/ecommerce-channel-sync');
      const { getClientModules } = await import('./worker/modules');
      const { clientId } = await getClientModules(env, auth.userId);
      if (!clientId) return json({ error: 'Client introuvable' }, 400);
      const channel = await sync.loadChannel(env, clientId, chRotateMatch[1]!);
      if (!channel) return json({ error: 'Canal introuvable' }, 404);
      let rbody: { kind?: string };
      try { rbody = await request.json() as { kind?: string }; }
      catch { return json({ error: 'JSON invalide' }, 400); }
      const kind = String(rbody.kind || '');
      if (kind !== 'shopify_token' && kind !== 'woo_creds')
        return json({ error: "kind doit être 'shopify_token' ou 'woo_creds'" }, 400);
      const { rotateChannelSecret } = await import('./worker/ecommerce-channel-rotation');
      const r = await rotateChannelSecret(env, clientId, channel.id, kind);
      if (!r.ok) return json({ error: r.error || 'Rotation échouée' }, 400);
      return json({ ok: true });
    }
    const chRevokeMatch = path.match(/^\/api\/ecommerce\/channels\/([^/]+)\/revoke$/);
    if (chRevokeMatch && method === 'POST') {
      if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
      const sync = await import('./worker/ecommerce-channel-sync');
      const { getClientModules } = await import('./worker/modules');
      const { clientId } = await getClientModules(env, auth.userId);
      if (!clientId) return json({ error: 'Client introuvable' }, 400);
      const channel = await sync.loadChannel(env, clientId, chRevokeMatch[1]!);
      if (!channel) return json({ error: 'Canal introuvable' }, 404);
      let rbody: { kind?: string };
      try { rbody = await request.json() as { kind?: string }; }
      catch { return json({ error: 'JSON invalide' }, 400); }
      const kind = String(rbody.kind || '');
      if (kind !== 'shopify_token' && kind !== 'woo_creds')
        return json({ error: "kind doit être 'shopify_token' ou 'woo_creds'" }, 400);
      const { revokeChannelSecret } = await import('./worker/ecommerce-channel-rotation');
      const r = await revokeChannelSecret(env, clientId, channel.id, kind);
      if (!r.ok) return json({ error: r.error || 'Révocation échouée' }, 400);
      return json({ ok: true });
    }
    const chMatch = path.match(/^\/api\/ecommerce\/channels\/([^/]+)$/);
    if (chMatch && method === 'PATCH')
      return ec.handleUpdateChannel(request, env, auth, chMatch[1]!);
    if (chMatch && method === 'DELETE')
      return ec.handleDeleteChannel(env, auth, chMatch[1]!);

    // ── Sprint 4 — Coupons/promos + Abonnements produit ──────────────────
    // requireModule('ecommerce') hérité du bloc + multi-tenant strict DANS
    // les handlers. Mutations = role admin (vérifié DANS les handlers, calque
    // handleUpdateRegion). ZÉRO capability (ALL_CAPABILITIES figée). Routes
    // SPÉCIFIQUES (/coupons/validate, /subscriptions/run-due) placées AVANT
    // les génériques /coupons/:id et /subscriptions/:id (sinon capturées par
    // ^/coupons/([^/]+)$ / ^/subscriptions/([^/]+)$). Handlers chargés par
    // dynamic import (pattern ecommerce-region) — STUBS Phase A, corps réel
    // Phase B (coupons) / Phase C (abonnements). Câblés ICI par Phase A (SEUL
    // câbleur worker.ts pour ce lot) afin d'éviter toute race en Phase B/C.

    // Coupons (route /validate SPÉCIFIQUE avant le générique /coupons/:id)
    if (path === '/api/ecommerce/coupons/validate' && method === 'POST') {
      const cp = await import('./worker/ecommerce-coupons');
      return cp.handleValidateCoupon(request, env, auth);
    }
    if (path === '/api/ecommerce/coupons' && method === 'GET') {
      const cp = await import('./worker/ecommerce-coupons');
      return cp.handleListCoupons(env, auth, url);
    }
    if (path === '/api/ecommerce/coupons' && method === 'POST') {
      const cp = await import('./worker/ecommerce-coupons');
      return cp.handleCreateCoupon(request, env, auth);
    }
    const couponMatch = path.match(/^\/api\/ecommerce\/coupons\/([^/]+)$/);
    if (couponMatch && method === 'GET') {
      const cp = await import('./worker/ecommerce-coupons');
      return cp.handleGetCoupon(env, auth, couponMatch[1]!);
    }
    if (couponMatch && method === 'PATCH') {
      const cp = await import('./worker/ecommerce-coupons');
      return cp.handleUpdateCoupon(request, env, auth, couponMatch[1]!);
    }
    if (couponMatch && method === 'DELETE') {
      const cp = await import('./worker/ecommerce-coupons');
      return cp.handleDeleteCoupon(env, auth, couponMatch[1]!);
    }

    // Promo codes (Sprint 64)
    if (path === '/api/ecommerce/promo-codes' && method === 'GET') {
      const pc = await import('./worker/promo-codes');
      return pc.handleListPromoCodes(env, auth, url);
    }
    if (path === '/api/ecommerce/promo-codes' && method === 'POST') {
      const pc = await import('./worker/promo-codes');
      return pc.handleCreatePromoCode(request, env, auth);
    }
    const promoCodeMatch = path.match(/^\/api\/ecommerce\/promo-codes\/([^/]+)$/);
    if (promoCodeMatch && method === 'GET') {
      const pc = await import('./worker/promo-codes');
      return pc.handleGetPromoCode(env, auth, promoCodeMatch[1]!);
    }
    if (promoCodeMatch && method === 'PATCH') {
      const pc = await import('./worker/promo-codes');
      return pc.handleUpdatePromoCode(request, env, auth, promoCodeMatch[1]!);
    }
    if (promoCodeMatch && method === 'DELETE') {
      const pc = await import('./worker/promo-codes');
      return pc.handleDeletePromoCode(env, auth, promoCodeMatch[1]!);
    }

    // Abonnements produit (route /run-due SPÉCIFIQUE avant le générique
    // /subscriptions/:id). Cycle = createOrderCore COD/mock — AUCUN
    // prélèvement réel (§6.E). ⚠ NE PAS confondre avec les `subscriptions`
    // billing SaaS agences (seq 19, hors module ecommerce).
    if (path === '/api/ecommerce/subscriptions/run-due' && method === 'POST') {
      const su = await import('./worker/ecommerce-subscriptions');
      return su.handleRunDueSubscriptions(request, env, auth);
    }
    if (path === '/api/ecommerce/subscriptions' && method === 'GET') {
      const su = await import('./worker/ecommerce-subscriptions');
      return su.handleListSubscriptions(env, auth, url);
    }
    if (path === '/api/ecommerce/subscriptions' && method === 'POST') {
      const su = await import('./worker/ecommerce-subscriptions');
      return su.handleCreateSubscription(request, env, auth);
    }
    const subMatch = path.match(/^\/api\/ecommerce\/subscriptions\/([^/]+)$/);
    if (subMatch && method === 'GET') {
      const su = await import('./worker/ecommerce-subscriptions');
      return su.handleGetSubscription(env, auth, subMatch[1]!);
    }
    if (subMatch && method === 'PATCH') {
      const su = await import('./worker/ecommerce-subscriptions');
      return su.handleUpdateSubscription(request, env, auth, subMatch[1]!);
    }
    if (subMatch && method === 'DELETE') {
      const su = await import('./worker/ecommerce-subscriptions');
      return su.handleDeleteSubscription(env, auth, subMatch[1]!);
    }
  }

  // Lien faible lead → customer boutique (encart LeadDetail, M3.4).
  // Gated ecommerce : si module off, on renvoie data:null (pas d'encart).
  const leadLinkedCustMatch = path.match(/^\/api\/leads\/([^/]+)\/linked-customer$/);
  if (leadLinkedCustMatch && method === 'GET') {
    const { requireModule } = await import('./worker/modules');
    const guard = await requireModule(env, auth.userId, 'ecommerce');
    if (guard) return json({ data: null });
    const { getLinkedCustomerForLead } = await import('./worker/customer-reconcile');
    const linked = await getLinkedCustomerForLead(env, leadLinkedCustMatch[1]!);
    return json({ data: linked });
  }

  // Currencies / devises (Sprint 39 & Sprint 87)
  if (path === '/api/currencies' && method === 'GET') {
    const cur = await import('./worker/currencies');
    return cur.handleListCurrencies(env, auth);
  }
  if (path === '/api/currencies/rates' && method === 'GET') {
    const cur = await import('./worker/currencies');
    return cur.handleListRates(env, auth, url);
  }
  if (path === '/api/currencies/rates/refresh' && method === 'POST') {
    const cur = await import('./worker/currencies');
    return cur.handleRefreshRates(request, env, auth);
  }
  if (path === '/api/currencies/rates/override' && method === 'POST') {
    const cur = await import('./worker/currencies');
    return cur.handleSetManualRate(request, env, auth);
  }
  if (path === '/api/currencies/exchange-rates' && method === 'GET') {
    const cur = await import('./worker/currencies');
    return cur.handleGetExchangeRates(env, auth);
  }
  if (path === '/api/currencies/exchange-rates/sync' && method === 'POST') {
    const cur = await import('./worker/currencies');
    return cur.handleForceSyncExchangeRates(env, auth);
  }

  // Debug (à retirer avant prod)
  if (path === '/api/debug/run-cron' && method === 'GET') {
    if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
    await processWorkflowQueue(env);
    return json({ data: { executed: true, timestamp: new Date().toISOString() } });
  }

  return json({ error: 'Route non trouvée' }, 404);
}
