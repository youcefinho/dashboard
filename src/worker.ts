// ══════════════════════════════════════════════════════════════
// ██  ROUTEUR API — Intralys CRM Central
// ██  ~200 lignes → délègue aux 23 modules dans src/worker/
// ══════════════════════════════════════════════════════════════

import type { Env } from './worker/types';
import { setRequestContext, corsHeaders, json, requireAuth } from './worker/helpers';

// ── Modules métier ──────────────────────────────────────────
import { handleLogin, handleLogout, handleMe, handleChangePassword } from './worker/auth';
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
  handleGetPipelineStageWorkflows, handleGetWorkflowEnrollments, handleCancelEnrollment,
  autoEnroll
} from './worker/workflows';

import {
  handleGetCustomFields, handleCreateCustomField, handleUpdateCustomField, handleDeleteCustomField,
  handleGetLeadCustomFields, handleSetLeadCustomFields,
  handleGetSmartLists, handleCreateSmartList, handleDeleteSmartList, handleExecuteSmartList
} from './worker/custom-fields';
import { handleGetAppointments, handleCreateAppointment, handleUpdateAppointment, handleDeleteAppointment } from './worker/appointments';
import { handleGetTasks, handleCreateTask, handlePatchTask, handleDeleteTask, processOverdueTasks } from './worker/tasks';
import { handleGetNotifications, handleReadNotification, handleReadAllNotifications } from './worker/notifications';
import { handleReportsOverview, handleReportsSources, handleReportsConversion, handleGetSavedReports, handleCreateSavedReport, handleDeleteSavedReport } from './worker/reports';
import {
  handleGetBookingPages, handleCreateBookingPage, handleUpdateBookingPage, handleDeleteBookingPage,
  handleGetBookings, handlePublicBookingPage, handlePublicCreateBooking,
} from './worker/bookings';
import { handleGetForms, handleGetForm, handleGetFormStats, handleCreateForm, handleUpdateForm, handleDeleteForm, handleGetFormSubmissions, handlePublicFormGet, handlePublicFormSubmit } from './worker/forms';
import { handleGetTriggerLinks, handleCreateTriggerLink, handleDeleteTriggerLink, handleTriggerLinkClick, handleGetTriggerLinkStats } from './worker/trigger-links';
import { handleAiGenerate, handleAiSuggestWorkflow } from './worker/ai';
import { handlePublicUnsubscribe, handleGetUnsubscribes, handleLogConsent, handleGetConsent, handleForgetLead, handleExportPii } from './worker/compliance';
import {
  handleGetCustomFields, handleCreateCustomField, handleUpdateCustomField, handleDeleteCustomField,
  handleGetLeadCustomFields, handleSetLeadCustomFields,
  handleGetSmartLists, handleCreateSmartList, handleDeleteSmartList, handleExecuteSmartList,
} from './worker/custom-fields';
import { handleGetSubAccounts, handleCreateSubAccount, handleUpdateSubAccount, handleCreateSnapshot, handleApplySnapshot, handleGetWhitelabel, handleUpdateWhitelabel, handleWidgetScript } from './worker/sub-accounts';
// gcal.ts et gbp.ts déplacés en _v2-backlog/ (Sprint Consolidation)

import { handleEmailBroadcast, handleGetBroadcasts, handleGetBroadcastDetail } from './worker/broadcast';
import { handleDashboardStats, handleTotpSetup, handleTotpVerify, handleTotpDisable, handleSendSmsRoute, handleCsvImport, handleExportCsv as handleExportCsvDash } from './worker/dashboard';
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
import { WebchatRoom, handleWebchatConnect, handleWebchatPrechat, handleWebchatWidget } from './worker/webchat';
import { handleStartMigration, handleGetMigrationStatus } from './worker/migrate';
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
  handleGetPreferences, handleUpdatePreferences, handleGetSessions, handleRevokeSession,
  handleGetApiKeys, handleCreateApiKey, handleRevokeApiKey,
  handleGetWebhooks, handleCreateWebhook, handleDeleteWebhook,
  handleGetClientCompliance, handleUpdateClientCompliance
} from './worker/settings';

import { handleGetUsers, handleInviteUser, handleUpdateUserRole, handleDeleteUser, handleGetRoles } from './worker/team';

import { handleFeedback, handleNps } from './worker/feedback';
import { handleDemoReset } from './worker/admin';
import { handleCompleteOnboarding } from './worker/onboarding';
import { handleRegisterDevice, handleUnregisterDevice, handleSendPush } from './worker/push';

// Export Durable Object pour Cloudflare
export { WebchatRoom };

// Injection de dépendance : autoEnroll pour les leads
setAutoEnroll(autoEnroll);

// ── Entry Point ─────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    setRequestContext(request, env);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

    // ── Routes publiques (pas d'auth) ─────────────────────
    try {
      if (path === '/api/webhook/sms' && method === 'POST') return await handleInboundSms(request, env);
      if (path === '/api/webhook/email' && method === 'POST') return await handleInboundEmail(request, env);
      if (path === '/api/webhook/meta' && (method === 'GET' || method === 'POST')) {
        const { handleMetaWebhook } = await import('./worker/meta');
        return await handleMetaWebhook(request, env);
      }
      if (path === '/api/webhook/lead' && method === 'POST') return await handleWebhookLead(request, env);
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
      // Voice
      const { handleVoiceTwiml, handleVoiceRecording } = await import('./worker/voice');
      if (path === '/api/voice/twiml' && method === 'POST') return await handleVoiceTwiml(request, env);
      if (path === '/api/voice/webhook/record' && method === 'POST') return await handleVoiceRecording(request, env);

      // Meta (Facebook / Instagram)
      const { handleMetaOauthStart, handleMetaOauthCallback, handleMetaWebhook } = await import('./worker/meta');
      if (path === '/api/meta/oauth/start' && method === 'GET') return await handleMetaOauthStart(env, auth, url);
      if (path === '/api/meta/oauth/callback' && method === 'GET') return await handleMetaOauthCallback(request, env, auth);
      if (path === '/api/meta/webhook') return await handleMetaWebhook(request, env);
      
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

      // Webchat — routes publiques
      if (path === '/api/webchat/ws') return await handleWebchatConnect(request, env, url);
      if (path === '/api/webchat/prechat' && method === 'POST') return await handleWebchatPrechat(request, env);
      if (path === '/api/webchat/widget.js') {
        const { handleWebchatWidget } = await import('./worker/webchat');
        return handleWebchatWidget(env, url);
      }
      
      // iCal feed
      const icalMatch = path.match(/^\/ical\/([^/]+)\.ics$/);
      if (icalMatch && method === 'GET') {
        const { handleGetICalFeed } = await import('./worker/calendar');
        return await handleGetICalFeed(env, icalMatch[1]!);
      }
    } catch (err) {
      console.error('Erreur route publique:', err);
      return json({ error: 'Erreur serveur' }, 500);
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
      return await routeProtected(request, env, url, path, method, auth);
    } catch (err) {
      console.error('Erreur API:', err);
      return json({ error: 'Erreur serveur interne' }, 500);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(processWorkflowQueue(env));
    ctx.waitUntil(processOverdueTasks(env));
    // Seed des profils de scoring par défaut (idempotent)
    ctx.waitUntil(seedDefaultScoreProfiles(env));
    // Nettoyage automatique de la corbeille (leads supprimés > 30 jours)
    ctx.waitUntil(
      env.DB.prepare("DELETE FROM leads WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-30 days')").run()
    );
  },

  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    const { processBroadcastQueueJob } = await import('./worker/broadcast');
    if (batch.queue === 'intralys-broadcast') {
      await processBroadcastQueueJob(batch, env);
    }
  }
} satisfies ExportedHandler<Env>;

// ── Routeur protégé ─────────────────────────────────────────

async function routeProtected(
  request: Request, env: Env, url: URL,
  path: string, method: string,
  auth: { userId: string; role: string }
): Promise<Response> {

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
  if (dupMatch && method === 'POST') return handleDuplicateTemplate(request, env, auth, dupMatch[1]!);
  const testEmailMatch = path.match(/^\/api\/templates\/([^/]+)\/test$/);
  if (testEmailMatch && method === 'POST') return handleSendTestEmail(request, env, auth, testEmailMatch[1]!);

  if (path === '/api/snippets' && method === 'GET') { const { handleGetSnippets } = await import('./worker/snippets'); return await handleGetSnippets(env, auth); }
  if (path === '/api/snippets' && method === 'POST') { const { handleCreateSnippet } = await import('./worker/snippets'); return await handleCreateSnippet(request, env, auth); }
  const snippetMatch = path.match(/^\/api\/snippets\/([^/]+)$/);
  if (snippetMatch && method === 'PATCH') { const { handleUpdateSnippet } = await import('./worker/snippets'); return await handleUpdateSnippet(request, env, auth, snippetMatch[1]!); }
  if (snippetMatch && method === 'DELETE') { const { handleDeleteSnippet } = await import('./worker/snippets'); return await handleDeleteSnippet(env, auth, snippetMatch[1]!); }

  // Workflows
  if (path === '/api/workflows' && method === 'GET') return handleGetWorkflows(env, auth);
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

  if (path === '/api/ai/generate' && method === 'POST') return handleAiGenerate(request, env, auth);
  if (path === '/api/ai/suggest-workflow' && method === 'POST') return handleAiSuggestWorkflow(request, env, auth);

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
        return await handleUpdateInvoiceStatus(request, env, auth, invoiceId);
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

      // AI Features (P3.6)
      if (path === '/api/ai/generate' && method === 'POST') {
        const { handleAiGenerate } = await import('./worker/ai');
        return await handleAiGenerate(request, env);
      }
      if (path === '/api/ai/suggest-workflow' && method === 'POST') {
        const { handleAiSuggestWorkflow } = await import('./worker/ai');
        return await handleAiSuggestWorkflow(request, env);
      }

  if (path === '/api/meta/oauth/start' && method === 'GET') {
    const { handleMetaOauthStart } = await import('./worker/meta');
    return await handleMetaOauthStart(env, auth, url);
  }
  if (path === '/api/meta/oauth/callback' && method === 'GET') {
    const { handleMetaOauthCallback } = await import('./worker/meta');
    return await handleMetaOauthCallback(request, env, auth);
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

  if (path === '/api/settings/sessions' && method === 'GET') return handleGetSessions(request, env);
  const sessionMatch = path.match(/^\/api\/settings\/sessions\/([^/]+)$/);
  if (sessionMatch && method === 'DELETE') return handleRevokeSession(request, env);
  
  if (path === '/api/settings/api-keys' && method === 'GET') return handleGetApiKeys(request, env);
  if (path === '/api/settings/api-keys' && method === 'POST') return handleCreateApiKey(request, env);
  const apiKeyMatch = path.match(/^\/api\/settings\/api-keys\/([^/]+)$/);
  if (apiKeyMatch && method === 'DELETE') return handleRevokeApiKey(request, env);

  if (path === '/api/settings/webhooks' && method === 'GET') return handleGetWebhooks(request, env);
  if (path === '/api/settings/webhooks' && method === 'POST') return handleCreateWebhook(request, env);
  const webhookMatch = path.match(/^\/api\/settings\/webhooks\/([^/]+)$/);
  if (webhookMatch && method === 'DELETE') return handleDeleteWebhook(request, env);

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
  if (path === '/api/admin/demo-reset' && method === 'POST') return handleDemoReset(request, env, auth);
  if (path === '/api/feedback' && method === 'POST') return handleFeedback(request, env, auth);
  if (path === '/api/nps' && method === 'POST') return handleNps(request, env, auth);

  // Phase 11 - Push notifications / Device tokens
  if (path === '/api/devices' && method === 'POST') return handleRegisterDevice(request, env, auth);
  const deviceTokenMatch = path.match(/^\/api\/devices\/(.+)$/);
  if (deviceTokenMatch && method === 'DELETE') return handleUnregisterDevice(request, env, auth, decodeURIComponent(deviceTokenMatch[1]!));
  if (path === '/api/notifications/push' && method === 'POST') {
    if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
    return handleSendPush(request, env);
  }

  // Debug (à retirer avant prod)
  if (path === '/api/debug/run-cron' && method === 'GET') {
    if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
    await processWorkflowQueue(env);
    return json({ data: { executed: true, timestamp: new Date().toISOString() } });
  }

  return json({ error: 'Route non trouvée' }, 404);
}
