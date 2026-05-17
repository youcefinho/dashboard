// ══════════════════════════════════════════════════════════════
// ██  ROUTEUR API — Intralys CRM Central
// ██  ~200 lignes → délègue aux 23 modules dans src/worker/
// ══════════════════════════════════════════════════════════════

import type { Env } from './worker/types';
import { setRequestContext, corsHeaders, json, requireAuth } from './worker/helpers';
import { errorResponse } from './worker/lib/error-response';

const START_TIME = Date.now();

// ── Modules métier ──────────────────────────────────────────
import { handleLogin, handleLogout, handleMe, handleChangePassword, handleGetSessions, handleDeleteSession, handleDeleteOtherSessions, handleGenerateBackupCodes, handleUpdateProfile, handleNotificationPreferences } from './worker/auth';
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
  autoEnroll
} from './worker/workflows';

import {
  handleGetCustomFields, handleCreateCustomField, handleUpdateCustomField, handleDeleteCustomField,
  handleGetLeadCustomFields, handleSetLeadCustomFields,
  handleGetSmartLists, handleCreateSmartList, handleDeleteSmartList, handleExecuteSmartList
} from './worker/custom-fields';
import { handleGetAppointments, handleCreateAppointment, handleUpdateAppointment, handleDeleteAppointment } from './worker/appointments';
import { handleGetTasks, handleGetTask, handleCreateTask, handlePatchTask, handleDeleteTask, processOverdueTasks } from './worker/tasks';
import { handleGetNotifications, handleReadNotification, handleReadAllNotifications } from './worker/notifications';
import { handleReportsOverview, handleReportsSources, handleReportsConversion, handleGetSavedReports, handleCreateSavedReport, handleDeleteSavedReport } from './worker/reports';
// Sprint 46 M1.3 — Custom dashboards builder
import {
  handleGetDashboards, handleGetDashboard, handleCreateDashboard,
  handleUpdateDashboard, handleDeleteDashboard, handleShareDashboard,
  handleGetSharedDashboard,
} from './worker/dashboards';
import {
  handleGetBookingPages, handleCreateBookingPage, handleUpdateBookingPage, handleDeleteBookingPage,
  handleGetBookings, handlePublicBookingPage, handlePublicCreateBooking,
} from './worker/bookings';
import { handleGetForms, handleGetForm, handleGetFormStats, handleCreateForm, handleUpdateForm, handleDeleteForm, handleGetFormSubmissions, handlePublicFormGet, handlePublicFormSubmit } from './worker/forms';
import { handleGetTriggerLinks, handleCreateTriggerLink, handleDeleteTriggerLink, handleTriggerLinkClick, handleGetTriggerLinkStats } from './worker/trigger-links';
import { handleAiGenerate, handleAiSuggestWorkflow, handleAiSummarizeConversation, handleAiSuggestNextAction, handleAiSummarizeLeads, handleAiDrafts, handleAiClassifyConversation, handleAiClassifyLead, handleAiNlQuery, handleAiComposeSuggest, handleAiProofread } from './worker/ai';
// Sprint 43 M3 — Reactions / QuickReplies / LeadScore backend
import { handleGetReactions, handleAddReaction, handleRemoveReaction } from './worker/reactions';
import { handleGetQuickReplies, handleAddQuickReply } from './worker/quick-replies';
import { handleGetLeadScore } from './worker/lead-score';
// Sprint 49 M2 — Predictive + bottleneck + anomalies
import { handleGetLeadPredict } from './worker/lead-predict';
import { handleGetPipelineBottlenecks, handleGetActivityAnomalies } from './worker/pipeline-insights';
import { handlePublicUnsubscribe, handleGetUnsubscribes, handleLogConsent, handleGetConsent, handleForgetLead, handleExportPii } from './worker/compliance';
import { handleGetSubAccounts, handleCreateSubAccount, handleUpdateSubAccount, handleCreateSnapshot, handleApplySnapshot, handleGetWhitelabel, handleUpdateWhitelabel, handleWidgetScript } from './worker/sub-accounts';
// gcal.ts et gbp.ts déplacés en _v2-backlog/ (Sprint Consolidation)

import { handleEmailBroadcast, handleGetBroadcasts, handleGetBroadcastDetail } from './worker/broadcast';
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

import { handleGetUsers, handleInviteUser, handleUpdateUserRole, handleDeleteUser, handleGetRoles } from './worker/team';

import { handleFeedback, handleNps } from './worker/feedback';
import { handleDemoReset } from './worker/admin';
// Sprint 46 M2 — Admin analytics (overview / heatmap / features-usage)
import {
  handleAdminOverview, handleAdminActivityHeatmap, handleAdminFeaturesUsage,
} from './worker/admin-analytics';
import { handleCompleteOnboarding, handleWelcomeOnboarding, handleGetOnboardingState, handlePutOnboardingState } from './worker/onboarding';
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
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ── Sprint 47 M2.4 — SSR meta snapshot pour crawlers (Google/Twitter/FB/LinkedIn)
    // Non destructif : ne s'active QUE si UA = crawler ET path = route marketing
    // connue (cf. src/worker/route-meta-ssr.ts). Sinon, traverse vers le SPA.
    try {
      const { maybeServeSsrMeta } = await import('./worker/route-meta-ssr');
      const ssrResponse = maybeServeSsrMeta(request);
      if (ssrResponse) return ssrResponse;
    } catch {
      // Si le module échoue, on laisse traverser au SPA — pas de blocking
    }

    // CORS preflight
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

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
        return await handlePostWebVitals(request, env);
      }

      if (path === '/api/webhook/sms' && method === 'POST') return await handleInboundSms(request, env);
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
      if (path.startsWith('/api/book/') && method === 'GET') return await handlePublicBookingPage(env, url);
      if (path === '/api/book' && method === 'POST') return await handlePublicCreateBooking(request, env);
      if (path.startsWith('/api/form/') && method === 'GET') return await handlePublicFormGet(env, url);
      if (path === '/api/form/submit' && method === 'POST') return await handlePublicFormSubmit(request, env);
      
      // Trigger Links Public Redirect
      const linkMatch = path.match(/^\/l\/([^/]+)$/);
      if (linkMatch && method === 'GET') return await handleTriggerLinkClick(request, env, linkMatch[1]!);
      if (path === '/api/widget.js' && method === 'GET') return await handleWidgetScript(env, url);
      const unsubMatch = path.match(/^\/api\/unsubscribe\/(.+)$/);
      if (unsubMatch && method === 'GET') return await handlePublicUnsubscribe(env, unsubMatch[1]!);
      // Documents — signature publique
      const signMatch = path.match(/^\/api\/sign\/([^/]+)$/);
      if (signMatch && method === 'GET') return await handlePublicGetDocument(env, signMatch[1]!);
      if (signMatch && method === 'POST') return await handlePublicSignDocument(request, env, signMatch[1]!);
      // Sprint 46 M1.3 — Dashboards partagés (token public)
      const sharedDashMatch = path.match(/^\/api\/dashboards\/shared\/([A-Za-z0-9_-]{8,64})$/);
      if (sharedDashMatch && method === 'GET') return await handleGetSharedDashboard(env, sharedDashMatch[1]!);
      // Voice
      const { handleVoiceTwiml, handleVoiceRecording } = await import('./worker/voice');
      if (path === '/api/voice/twiml' && method === 'POST') return await handleVoiceTwiml(request, env);
      if (path === '/api/voice/webhook/record' && method === 'POST') return await handleVoiceRecording(request, env);

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

    // ── Auth (login/logout/reset — pas de token requis) ─────────
    if (path === '/api/auth/login' && method === 'POST') return handleLogin(request, env);
    if (path === '/api/auth/logout' && method === 'POST') return handleLogout(request, env);
    if (path === '/api/auth/forgot-password' && method === 'POST') {
      const { handleForgotPassword } = await import('./worker/auth');
      return handleForgotPassword(request, env);
    }
    if (path === '/api/auth/reset-password' && method === 'POST') {
      const { handleResetPassword } = await import('./worker/auth');
      return handleResetPassword(request, env);
    }
    
    // Auth routes nécessitant le token 
    if (path === '/api/auth/me' && method === 'GET') return handleMe(request, env);
    if (path === '/api/auth/change-password' && method === 'POST') return handleChangePassword(request, env);

    // ── Routes protégées ──────────────────────────────────
    if (!path.startsWith('/api/')) return new Response('Not Found', { status: 404 });

    const auth = await requireAuth(request, env);
    if (auth instanceof Response) return auth;

    try {
      return await routeProtected(request, env, ctx, url, path, method, auth);
    } catch (err) {
      return errorResponse(err, env, path);
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
  auth: { userId: string; role: string }
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

  // Clients
  if (path === '/api/clients' && method === 'GET') return handleGetClients(env, auth);
  if (path === '/api/clients' && method === 'POST') return handleCreateClient(request, env, auth);
  const clientLeadsMatch = path.match(/^\/api\/clients\/([^/]+)\/leads$/);
  if (clientLeadsMatch && method === 'GET') return handleGetClientLeads(env, auth, clientLeadsMatch[1]!, url);

  // Leads
  if (path === '/api/leads' && method === 'GET') return handleGetLeads(env, auth, url);
  if (path === '/api/leads' && method === 'POST') return handleCreateLead(request, env, auth);
  if (path === '/api/leads/bulk' && method === 'POST') return handleBulkLeads(request, env, auth);
  if (path === '/api/leads/export' && method === 'GET') return handleExportCsv(env, auth, url);
  if (path === '/api/leads/import' && method === 'POST') return handleCsvImport(request, env, auth);
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

  // Tags & Activity
  if (path === '/api/tags' && method === 'GET') return handleGetAllTags(env, auth);
  if (path === '/api/activity' && method === 'GET') return handleGetActivity(env, auth, url);
  if (path === '/api/pipeline' && method === 'GET') return handleGetPipeline(env, auth, url);

  // Messages / Inbox
  if (path === '/api/messages' && method === 'GET') return handleGetInboxMessages(env, auth, url);

  // Compliance (CASL, Loi 25)
  if (path === '/api/unsubscribes' && method === 'GET') return handleGetUnsubscribes(env, auth, url);
  if (path === '/api/consent' && method === 'GET') return handleGetConsent(env, auth, url);
  if (path === '/api/consent' && method === 'POST') return handleLogConsent(request, env, auth);

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

  if (path === '/api/snippets' && method === 'GET') { const { handleGetSnippets } = await import('./worker/snippets'); return await handleGetSnippets(env, auth); }
  if (path === '/api/snippets' && method === 'POST') { const { handleCreateSnippet } = await import('./worker/snippets'); return await handleCreateSnippet(request, env, auth); }
  const snippetMatch = path.match(/^\/api\/snippets\/([^/]+)$/);
  if (snippetMatch && method === 'PATCH') { const { handleUpdateSnippet } = await import('./worker/snippets'); return await handleUpdateSnippet(request, env, auth, snippetMatch[1]!); }
  if (snippetMatch && method === 'DELETE') { const { handleDeleteSnippet } = await import('./worker/snippets'); return await handleDeleteSnippet(env, auth, snippetMatch[1]!); }

  // Workflows
  if (path === '/api/workflows' && method === 'GET') return handleGetWorkflows(env, auth, url);
  if (path === '/api/workflows' && method === 'POST') return handleCreateWorkflow(request, env, auth);
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

  // SMS
  if (path === '/api/sms/send' && method === 'POST') return handleSendSmsRoute(request, env, auth);

  // 2FA TOTP
  if (path === '/api/auth/totp/setup' && method === 'POST') return handleTotpSetup(env, auth);
  if (path === '/api/auth/totp/verify' && method === 'POST') return handleTotpVerify(request, env, auth);
  if (path === '/api/auth/totp/disable' && method === 'POST') return handleTotpDisable(request, env, auth);

  // Reports
  if (path === '/api/reports/overview' && method === 'GET') return handleReportsOverview(env, auth, url);
  if (path === '/api/reports/sources' && method === 'GET') return handleReportsSources(env, auth, url);
  if (path === '/api/reports/conversion' && method === 'GET') return handleReportsConversion(env, auth, url);
  
  if (path === '/api/reports/saved' && method === 'GET') return handleGetSavedReports(env, auth);
  if (path === '/api/reports/saved' && method === 'POST') return handleCreateSavedReport(request, env, auth);
  const savedReportMatch = path.match(/^\/api\/reports\/saved\/([^/]+)$/);
  if (savedReportMatch && method === 'DELETE') return handleDeleteSavedReport(env, auth, savedReportMatch[1]!);

  // Sprint 46 M1.3 — Dashboards builder (CRUD + share)
  if (path === '/api/dashboards' && method === 'GET') return handleGetDashboards(env, auth);
  if (path === '/api/dashboards' && method === 'POST') return handleCreateDashboard(request, env, auth);
  const dashMatch = path.match(/^\/api\/dashboards\/(\d+)$/);
  if (dashMatch && method === 'GET') return handleGetDashboard(env, auth, dashMatch[1]!);
  if (dashMatch && method === 'PUT') return handleUpdateDashboard(request, env, auth, dashMatch[1]!);
  if (dashMatch && method === 'DELETE') return handleDeleteDashboard(env, auth, dashMatch[1]!);
  const dashShareMatch = path.match(/^\/api\/dashboards\/(\d+)\/share$/);
  if (dashShareMatch && (method === 'POST' || method === 'GET')) return handleShareDashboard(env, auth, dashShareMatch[1]!);

  // Broadcast
  if (path === '/api/broadcast' && method === 'POST') return handleEmailBroadcast(request, env, auth);
  if (path === '/api/broadcasts' && method === 'GET') return handleGetBroadcasts(env, auth, url);
  const broadcastMatch = path.match(/^\/api\/broadcasts\/([^/]+)$/);
  if (broadcastMatch && method === 'GET') return handleGetBroadcastDetail(env, auth, broadcastMatch[1]!);

  // Booking Pages
  if (path === '/api/booking-pages' && method === 'GET') return handleGetBookingPages(env, auth);
  if (path === '/api/booking-pages' && method === 'POST') return handleCreateBookingPage(request, env, auth);
  const bookingMatch = path.match(/^\/api\/booking-pages\/([^/]+)$/);
  if (bookingMatch && method === 'PATCH') return handleUpdateBookingPage(request, env, auth, bookingMatch[1]!);
  if (bookingMatch && method === 'DELETE') return handleDeleteBookingPage(env, auth, bookingMatch[1]!);
  const bookingsListMatch = path.match(/^\/api\/booking-pages\/([^/]+)\/bookings$/);
  if (bookingsListMatch && method === 'GET') return handleGetBookings(env, auth, bookingsListMatch[1]!, url);

  // Forms
  if (path === '/api/forms' && method === 'GET') return handleGetForms(env, auth);
  if (path === '/api/forms' && method === 'POST') return handleCreateForm(request, env, auth);
  const formMatch = path.match(/^\/api\/forms\/([^/]+)$/);
  if (formMatch && method === 'GET') return handleGetForm(env, auth, formMatch[1]!);
  if (formMatch && method === 'PATCH') return handleUpdateForm(request, env, auth, formMatch[1]!);
  if (formMatch && method === 'DELETE') return handleDeleteForm(env, auth, formMatch[1]!);
  const statsFormMatch = path.match(/^\/api\/forms\/([^/]+)\/stats$/);
  if (statsFormMatch && method === 'GET') return handleGetFormStats(env, auth, statsFormMatch[1]!);

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
  // Sprint 49 M1 — Smart compose : ghost-text suggest + proofread FR québécois
  if (path === '/api/ai/compose-suggest' && method === 'POST') return handleAiComposeSuggest(request, env);
  if (path === '/api/ai/proofread' && method === 'POST') return handleAiProofread(request, env);
  // Sprint 49 M3 — Auto-tag conversations + leads + NL query (suggestion only, Loi 25 friendly)
  if (path === '/api/ai/classify-conversation' && method === 'POST') return handleAiClassifyConversation(request, env);
  if (path === '/api/ai/classify-lead' && method === 'POST') return handleAiClassifyLead(request, env);
  if (path === '/api/ai/nl-query' && method === 'POST') return handleAiNlQuery(request, env);

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

  // Google Business Profile — V2 backlog (désactivé Sprint Consolidation)
  // Routes /api/gbp/* retournent 404 par défaut (handler absent)

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

      // SaaS Configurator (P3.9)
      if (path === '/api/agencies' && method === 'GET') {
        const { handleGetAgencies } = await import('./worker/saas');
        return await handleGetAgencies(env, auth);
      }
      if (path === '/api/agencies' && method === 'POST') {
        const { handleCreateAgency } = await import('./worker/saas');
        return await handleCreateAgency(request, env, auth);
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

  // Reviews
  if (path === '/api/reviews' && method === 'GET') return handleGetReviews(env, auth, url);
  if (path === '/api/reviews/stats' && method === 'GET') return handleGetReviewStats(env, auth, url);
  if (path === '/api/reviews/requests' && method === 'GET') return handleGetReviewRequests(env, auth, url);
  if (path === '/api/reviews/requests' && method === 'POST') return handleCreateReviewRequest(request, env, auth);
  if (path === '/api/reviews/requests/bulk' && method === 'POST') return handleBulkReviewRequest(request, env, auth);
  if (path === '/api/reviews/suggest-reply' && method === 'POST') return handleSuggestReviewReply(request, env, auth);
  const reviewReplyMatch = path.match(/^\/api\/reviews\/([^/]+)\/reply$/);
  if (reviewReplyMatch && method === 'POST') return handleReplyToReview(request, env, auth, reviewReplyMatch[1]!);

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

  if (path === '/api/team/users' && method === 'GET') return handleGetUsers(request, env);
  if (path === '/api/team/invites' && method === 'POST') return handleInviteUser(request, env);
  const userMatch = path.match(/^\/api\/team\/users\/([^/]+)$/);
  if (userMatch && method === 'PATCH') return handleUpdateUserRole(request, env);
  if (userMatch && method === 'DELETE') return handleDeleteUser(request, env);
  if (path === '/api/team/roles' && method === 'GET') return handleGetRoles(request, env);

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
  if (path === '/api/admin/demo-reset' && method === 'POST') return handleDemoReset(request, env, auth);
  // Sprint 46 M2 — Admin analytics endpoints (admin/owner only)
  if (path === '/api/admin/overview' && method === 'GET') return handleAdminOverview(request, env, auth);
  if (path === '/api/admin/activity-heatmap' && method === 'GET') return handleAdminActivityHeatmap(request, env, auth);
  if (path === '/api/admin/features-usage' && method === 'GET') return handleAdminFeaturesUsage(request, env, auth);
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

  // Debug (à retirer avant prod)
  if (path === '/api/debug/run-cron' && method === 'GET') {
    if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
    await processWorkflowQueue(env);
    return json({ data: { executed: true, timestamp: new Date().toISOString() } });
  }

  return json({ error: 'Route non trouvée' }, 404);
}
