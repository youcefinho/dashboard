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
  handleGetLeads, handlePatchLead, handleBulkLeads,
  handleGetPipeline, handleGetLeadDetail,
  handleAddTag, handleRemoveTag, handleGetAllTags,
  handleGetActivity, handleExportCsv, setAutoEnroll,
} from './worker/leads';
import {
  handleGetLeadMessages, handleSendMessage,
  handleGetInboxMessages, handleInboundSms, handleInboundEmail,
} from './worker/messages';
import { handleGetTemplates, handleCreateTemplate, handleUpdateTemplate, handleDeleteTemplate } from './worker/templates';
import {
  handleGetPipelines, handleCreatePipeline, handleUpdatePipeline, handleDeletePipeline,
  handleGetPipelineStages, handleCreatePipelineStage, handleUpdatePipelineStage, handleDeletePipelineStage,
} from './worker/pipelines';
import {
  handleGetWorkflows, handleGetWorkflowDetail, handleCreateWorkflow,
  handleUpdateWorkflow, handleDeleteWorkflow, handleToggleWorkflow,
  handleEnrollLead, autoEnroll, processWorkflowQueue,
} from './worker/workflows';
import { handleGetAppointments, handleCreateAppointment, handleUpdateAppointment, handleDeleteAppointment } from './worker/appointments';
import { handleGetTasks, handleCreateTask, handlePatchTask, handleDeleteTask } from './worker/tasks';
import { handleGetNotifications, handleReadNotification, handleReadAllNotifications } from './worker/notifications';
import { handleReportsOverview, handleReportsSources, handleReportsConversion } from './worker/reports';
import {
  handleGetBookingPages, handleCreateBookingPage, handleUpdateBookingPage, handleDeleteBookingPage,
  handleGetBookings, handlePublicBookingPage, handlePublicCreateBooking,
} from './worker/bookings';
import { handleGetForms, handleCreateForm, handleUpdateForm, handleDeleteForm, handleGetFormSubmissions, handlePublicFormGet, handlePublicFormSubmit } from './worker/forms';
import { handleAiChat, handleGetAiConversations, handleGetAiConversation, handleAiScore, handleAiGenerate, handleAiSuggestWorkflow } from './worker/ai';
import { handlePublicUnsubscribe, handleGetUnsubscribes, handleLogConsent, handleGetConsent, handleForgetLead, handleExportPii } from './worker/compliance';
import {
  handleGetCustomFields, handleCreateCustomField, handleUpdateCustomField, handleDeleteCustomField,
  handleGetLeadCustomFields, handleSetLeadCustomFields,
  handleGetSmartLists, handleCreateSmartList, handleDeleteSmartList, handleExecuteSmartList,
} from './worker/custom-fields';
import { handleGetSubAccounts, handleCreateSubAccount, handleUpdateSubAccount, handleCreateSnapshot, handleApplySnapshot, handleGetWhitelabel, handleUpdateWhitelabel, handleWidgetScript } from './worker/sub-accounts';
import { handleGcalAuthUrl, handleGcalCallback, handleGcalEvents, handleGcalSync } from './worker/gcal';
import { handleGbpReviews, handleGbpStats } from './worker/gbp';
import { handleEmailBroadcast, handleBroadcastHistory } from './worker/broadcast';
import { handleDashboardStats, handleTotpSetup, handleTotpVerify, handleTotpDisable, handleSendSmsRoute, handleCsvImport, handleExportCsv as handleExportCsvDash } from './worker/dashboard';
import { handleWebhookLead } from './worker/leads';
import {
  handleUploadFile, handleGetFile, handleGetFiles, handleDeleteFile,
  handleGetDocumentTemplates, handleCreateDocumentTemplate, handleUpdateDocumentTemplate, handleDeleteDocumentTemplate,
  handleGetDocuments, handleCreateDocument, handleSendDocument,
  handlePublicGetDocument, handlePublicSignDocument,
} from './worker/documents';
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
      if (path === '/api/webhook/lead' && method === 'POST') return await handleWebhookLead(request, env);
      if (path.startsWith('/api/book/') && method === 'GET') return await handlePublicBookingPage(env, url);
      if (path === '/api/book' && method === 'POST') return await handlePublicCreateBooking(request, env);
      if (path.startsWith('/api/form/') && method === 'GET') return await handlePublicFormGet(env, url);
      if (path === '/api/form/submit' && method === 'POST') return await handlePublicFormSubmit(request, env);
      if (path === '/api/widget.js' && method === 'GET') return await handleWidgetScript(env, url);
      const unsubMatch = path.match(/^\/api\/unsubscribe\/(.+)$/);
      if (unsubMatch && method === 'GET') return await handlePublicUnsubscribe(env, unsubMatch[1]!);
      // Documents — signature publique
      const signMatch = path.match(/^\/api\/sign\/([^/]+)$/);
      if (signMatch && method === 'GET') return await handlePublicGetDocument(env, signMatch[1]!);
      if (signMatch && method === 'POST') return await handlePublicSignDocument(request, env, signMatch[1]!);
      // Webchat — routes publiques
      if (path === '/api/webchat/ws') return await handleWebchatConnect(request, env, url);
      if (path === '/api/webchat/prechat' && method === 'POST') return await handleWebchatPrechat(request, env);
      if (path === '/api/webchat/widget.js' && method === 'GET') return handleWebchatWidget(env, url);
    } catch (err) {
      console.error('Erreur route publique:', err);
      return json({ error: 'Erreur serveur' }, 500);
    }

    // ── Auth (login/logout — pas de token requis) ─────────
    if (path === '/api/auth/login' && method === 'POST') return handleLogin(request, env);
    if (path === '/api/auth/logout' && method === 'POST') return handleLogout(request, env);
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
    // Seed des profils de scoring par défaut (idempotent)
    ctx.waitUntil(seedDefaultScoreProfiles(env));
  },
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
  if (path === '/api/pipeline' && method === 'GET') return handleGetPipeline(env, auth);

  // Messages / Inbox
  if (path === '/api/messages' && method === 'GET') return handleGetInboxMessages(env, auth, url);

  // Templates
  if (path === '/api/templates' && method === 'GET') return handleGetTemplates(env, auth, url);
  if (path === '/api/templates' && method === 'POST') return handleCreateTemplate(request, env, auth);
  const tplMatch = path.match(/^\/api\/templates\/([^/]+)$/);
  if (tplMatch && method === 'PATCH') return handleUpdateTemplate(request, env, auth, tplMatch[1]!);
  if (tplMatch && method === 'DELETE') return handleDeleteTemplate(env, auth, tplMatch[1]!);

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

  // Tasks
  if (path === '/api/tasks' && method === 'GET') return handleGetTasks(env, auth, url);
  if (path === '/api/tasks' && method === 'POST') return handleCreateTask(request, env, auth);
  const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && method === 'PATCH') return handlePatchTask(request, env, auth, taskMatch[1]!);
  if (taskMatch && method === 'DELETE') return handleDeleteTask(env, auth, taskMatch[1]!);

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
  const stagesMatch = path.match(/^\/api\/pipelines\/([^/]+)\/stages$/);
  if (stagesMatch && method === 'GET') return handleGetPipelineStages(env, auth, stagesMatch[1]!);
  if (stagesMatch && method === 'POST') return handleCreatePipelineStage(request, env, auth, stagesMatch[1]!);
  const stageMatch = path.match(/^\/api\/pipelines\/([^/]+)\/stages\/([^/]+)$/);
  if (stageMatch && method === 'PATCH') return handleUpdatePipelineStage(request, env, auth, stageMatch[1]!, stageMatch[2]!);
  if (stageMatch && method === 'DELETE') return handleDeletePipelineStage(env, auth, stageMatch[1]!, stageMatch[2]!);

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

  // Broadcast
  if (path === '/api/broadcast' && method === 'POST') return handleEmailBroadcast(request, env, auth);
  if (path === '/api/broadcast/history' && method === 'GET') return handleBroadcastHistory(env, auth, url);

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
  if (formMatch && method === 'PATCH') return handleUpdateForm(request, env, auth, formMatch[1]!);
  if (formMatch && method === 'DELETE') return handleDeleteForm(env, auth, formMatch[1]!);
  const submissionsMatch = path.match(/^\/api\/forms\/([^/]+)\/submissions$/);
  if (submissionsMatch && method === 'GET') return handleGetFormSubmissions(env, auth, submissionsMatch[1]!, url);

  // AI
  if (path === '/api/ai/chat' && method === 'POST') return handleAiChat(request, env, auth);
  if (path === '/api/ai/conversations' && method === 'GET') return handleGetAiConversations(env, auth, url);
  const aiConvMatch = path.match(/^\/api\/ai\/conversations\/([^/]+)$/);
  if (aiConvMatch && method === 'GET') return handleGetAiConversation(env, auth, aiConvMatch[1]!);
  const aiScoreMatch = path.match(/^\/api\/ai\/score\/([^/]+)$/);
  if (aiScoreMatch && method === 'POST') return handleAiScore(env, auth, aiScoreMatch[1]!);
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
  if (path === '/api/gcal/auth-url' && method === 'GET') return handleGcalAuthUrl(env);
  if (path === '/api/gcal/callback' && method === 'GET') return handleGcalCallback(env, auth, url);
  if (path === '/api/gcal/events' && method === 'GET') return handleGcalEvents(env, auth, url);
  if (path === '/api/gcal/sync' && method === 'POST') return handleGcalSync(env, auth);

  // Google Business Profile
  if (path === '/api/gbp/reviews' && method === 'GET') return handleGbpReviews(env, auth, url);
  if (path === '/api/gbp/stats' && method === 'GET') return handleGbpStats(env, auth);

  // Reviews & Reputation (P4.6)
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

  // Custom Fields
  if (path === '/api/custom-fields' && method === 'GET') return handleGetCustomFields(env, auth, url);
  if (path === '/api/custom-fields' && method === 'POST') return handleCreateCustomField(request, env, auth);
  const cfMatch = path.match(/^\/api\/custom-fields\/([^/]+)$/);
  if (cfMatch && method === 'PATCH') return handleUpdateCustomField(request, env, auth, cfMatch[1]!);
  if (cfMatch && method === 'DELETE') return handleDeleteCustomField(env, auth, cfMatch[1]!);

  // Smart Lists
  if (path === '/api/smart-lists' && method === 'GET') return handleGetSmartLists(env, auth);
  if (path === '/api/smart-lists' && method === 'POST') return handleCreateSmartList(request, env, auth);
  const slMatch = path.match(/^\/api\/smart-lists\/([^/]+)$/);
  if (slMatch && method === 'DELETE') return handleDeleteSmartList(env, auth, slMatch[1]!);
  const slExecMatch = path.match(/^\/api\/smart-lists\/([^/]+)\/execute$/);
  if (slExecMatch && method === 'GET') return handleExecuteSmartList(env, auth, slExecMatch[1]!, url);

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
  const docSendMatch = path.match(/^\/api\/documents\/([^/]+)\/send$/);
  if (docSendMatch && method === 'POST') return handleSendDocument(request, env, auth, docSendMatch[1]!);

  // Migration GHL
  if (path === '/api/migrate/ghl' && method === 'POST') return handleStartMigration(request, env, auth);
  if (path === '/api/migrate/status' && method === 'GET') return handleGetMigrationStatus(env, auth, url);

  // Score Profiles (Phase 2.0)
  if (path === '/api/score-profiles' && method === 'GET') return handleGetScoreProfiles(env, auth, url);
  if (path === '/api/score-profiles' && method === 'POST') return handleCreateScoreProfile(request, env, auth);
  const spMatch = path.match(/^\/api\/score-profiles\/([^/]+)$/);
  if (spMatch && method === 'PATCH') return handleUpdateScoreProfile(request, env, auth, spMatch[1]!);

  // Debug (à retirer avant prod)
  if (path === '/api/debug/run-cron' && method === 'GET') {
    if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
    await processWorkflowQueue(env);
    return json({ data: { executed: true, timestamp: new Date().toISOString() } });
  }

  return json({ error: 'Route non trouvée' }, 404);
}
