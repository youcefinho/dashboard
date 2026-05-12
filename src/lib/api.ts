// ── Client API — Helpers pour appeler le worker ─────────────

import type { ApiResponse, Client, Lead, LeadDetail, DashboardStats, ActivityLogEntry, Message, EmailTemplate, Workflow, WorkflowStep, WorkflowEnrollment, Appointment, Task, Subtask, TaskComment, TaskTemplate, LeadNote, LeadScore, CustomFieldValue, Conversation, ConversationStatus, Pipeline, PipelineStage, CustomFieldDef, SmartList, Snippet } from './types';
import { Capacitor } from '@capacitor/core';

// En natif (iOS/Android), les requêtes partent de capacitor://localhost
// donc on doit utiliser une URL absolue vers le backend Cloudflare
const API_BASE = Capacitor.isNativePlatform()
  ? (import.meta.env.VITE_API_URL || 'https://crm.intralys.com') + '/api'
  : '/api';

// ── Gestion du token ────────────────────────────────────────

function getToken(): string | null {
  return localStorage.getItem('intralys_token');
}

function setToken(token: string): void {
  localStorage.setItem('intralys_token', token);
}

function clearToken(): void {
  localStorage.removeItem('intralys_token');
  localStorage.removeItem('intralys_user');
}

// ── Fetch wrapper ───────────────────────────────────────────

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  // Session expirée → nettoyer et rediriger
  if (response.status === 401) {
    clearToken();
    window.location.href = '/login';
    return { error: 'Session expirée' };
  }

  // Rate limit
  if (response.status === 429) {
    return { error: 'Trop de tentatives. Réessayez dans 1 heure.' };
  }

  const data = await response.json() as ApiResponse<T>;

  if (!response.ok) {
    return { error: data.error || `Erreur ${response.status}` };
  }

  return data;
}

// ── Auth ────────────────────────────────────────────────────

export interface LoginResponse {
  token: string;
  must_change_password?: boolean;
  user: { id: string; name: string; role: string; email: string; onboarding_step?: number; onboarding_skipped?: boolean };
}

export async function login(_email: string, _password: string): Promise<ApiResponse<LoginResponse>> {
  // BYPASS PROVISOIRE : Fausse réponse pour éviter le worker qui ne recharge pas
  const fakeData: LoginResponse = {
    token: 'fake-bypass-token-123456',
    must_change_password: false,
    user: { id: 'admin', name: 'Rochdi (Bypass)', role: 'admin', email: 'rochdi@intralys.com', onboarding_step: 0, onboarding_skipped: false }
  };
  setToken(fakeData.token);
  localStorage.setItem('intralys_user', JSON.stringify(fakeData.user));
  localStorage.removeItem('must_change_password');
  return { data: fakeData };

  /*
  const result = await apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  // Le worker renvoie {success, token, user} directement
  const raw = result as unknown as Record<string, unknown>;
  if (raw['token'] || (result.data && 'token' in result.data)) {
    const loginData = (result.data || raw) as unknown as LoginResponse;
    setToken(loginData.token);
    localStorage.setItem('intralys_user', JSON.stringify(loginData.user));
    if (loginData.must_change_password) {
      localStorage.setItem('must_change_password', '1');
    } else {
      localStorage.removeItem('must_change_password');
    }
    return { data: loginData };
  }

  return result;
  */
}

export async function logout(): Promise<void> {
  await apiFetch('/auth/logout', { method: 'POST' });
  clearToken();
}

export function getStoredUser(): LoginResponse['user'] | null {
  const stored = localStorage.getItem('intralys_user');
  if (!stored) return null;
  try {
    return JSON.parse(stored) as LoginResponse['user'];
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export async function changePassword(current: string, next: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current, next }),
  });
}

export async function forgotPassword(email: string): Promise<ApiResponse<{ success: boolean; message?: string }>> {
  return apiFetch<{ success: boolean; message?: string }>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(token: string, password: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}

export async function updateProfile(data: { name?: string; email_signature?: string }): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>('/auth/me', {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
}

export interface NotificationPreference {
  channel: 'email' | 'sms' | 'push' | 'in_app';
  event_type: string;
  enabled: 0 | 1;
}

export async function getNotificationPreferences(): Promise<ApiResponse<NotificationPreference[]>> {
  return apiFetch<NotificationPreference[]>('/auth/notifications');
}

export async function updateNotificationPreference(channel: string, event_type: string, enabled: boolean): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>('/auth/notifications', {
    method: 'PATCH',
    body: JSON.stringify({ channel, event_type, enabled })
  });
}

// ── Security & Sessions (Phase D) ───────────────────────────

export interface AdminSession {
  token: string;
  ip: string;
  user_agent: string;
  created_at: string;
  last_active_at: string;
  expires_at: string;
  is_current: boolean;
}

export async function getSessions(): Promise<ApiResponse<AdminSession[]>> {
  return apiFetch<AdminSession[]>('/auth/sessions');
}

export async function deleteSession(token: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/auth/sessions/${token}`, { method: 'DELETE' });
}

export async function deleteOtherSessions(): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>('/auth/sessions/others', { method: 'DELETE' });
}

export async function generateBackupCodes(): Promise<ApiResponse<{ codes: string[] }>> {
  return apiFetch<{ codes: string[] }>('/auth/2fa/backup-codes', { method: 'POST' });
}

// ── Dashboard ───────────────────────────────────────────────

export async function getDashboardStats(): Promise<ApiResponse<DashboardStats>> {
  return apiFetch<DashboardStats>('/dashboard/stats');
}

// ── Clients ─────────────────────────────────────────────────

export async function getClients(): Promise<ApiResponse<Client[]>> {
  return apiFetch<Client[]>('/clients');
}

export async function createClient(client: Partial<Client>): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/clients', {
    method: 'POST',
    body: JSON.stringify(client),
  });
}

// ── Leads ───────────────────────────────────────────────────

export async function getLeads(params?: {
  status?: string;
  search?: string;
  source?: string;
  client_id?: string;
  tag?: string;
  sort?: string;
}): Promise<ApiResponse<Lead[]>> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.search) searchParams.set('search', params.search);
  if (params?.source) searchParams.set('source', params.source);
  if (params?.client_id) searchParams.set('client_id', params.client_id);
  if (params?.tag) searchParams.set('tag', params.tag);
  if (params?.sort) searchParams.set('sort', params.sort);
  const qs = searchParams.toString();
  return apiFetch<Lead[]>(`/leads${qs ? `?${qs}` : ''}`);
}

export async function getClientLeads(clientId: string, params?: {
  status?: string;
  type?: string;
  search?: string;
}): Promise<ApiResponse<Lead[]>> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.type) searchParams.set('type', params.type);
  if (params?.search) searchParams.set('search', params.search);
  const qs = searchParams.toString();
  return apiFetch<Lead[]>(`/clients/${clientId}/leads${qs ? `?${qs}` : ''}`);
}

// ── Lead détail ─────────────────────────────────────────────

export async function getLeadDetail(leadId: string): Promise<ApiResponse<LeadDetail>> {
  return apiFetch<LeadDetail>(`/leads/${leadId}`);
}

export async function updateLead(
  leadId: string,
  updates: {
    status?: string;
    notes?: string;
    deal_value?: number;
    assigned_to?: string;
    score?: number;
    pipeline_id?: string;
    stage_id?: string;
  }
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/leads/${leadId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

// ── Tags ────────────────────────────────────────────────────

export async function addTag(leadId: string, tag: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/leads/${leadId}/tags`, {
    method: 'POST',
    body: JSON.stringify({ tag }),
  });
}

export async function removeTag(leadId: string, tag: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/leads/${leadId}/tags`, {
    method: 'DELETE',
    body: JSON.stringify({ tag }),
  });
}

export async function getAllTags(): Promise<ApiResponse<string[]>> {
  return apiFetch<string[]>('/tags');
}

// ── Activité ────────────────────────────────────────────────

export async function getRecentActivity(limit = 20): Promise<ApiResponse<ActivityLogEntry[]>> {
  return apiFetch<ActivityLogEntry[]>(`/activity?limit=${limit}`);
}

// ── Pipeline ────────────────────────────────────────────────

export async function getPipeline(pipelineId?: string): Promise<ApiResponse<Lead[]>> {
  return apiFetch<Lead[]>(pipelineId ? `/pipeline?pipeline_id=${pipelineId}` : '/pipeline');
}

// ── Export ───────────────────────────────────────────────────

export async function exportLeadsCsv(params?: {
  status?: string;
  client_id?: string;
}): Promise<void> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.client_id) searchParams.set('client_id', params.client_id);
  const qs = searchParams.toString();

  const token = getToken();
  const response = await fetch(`${API_BASE}/leads/export${qs ? `?${qs}` : ''}`, {
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
  });

  if (!response.ok) return;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `leads-intralys-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Sprint 2 : Notes multiples ─────────────────────────────

export async function getLeadNotes(leadId: string): Promise<ApiResponse<LeadNote[]>> {
  return apiFetch<LeadNote[]>(`/leads/${leadId}/notes`);
}

export async function createLeadNote(
  leadId: string, note: { body: string; category?: string; is_pinned?: boolean }
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>(`/leads/${leadId}/notes`, { method: 'POST', body: JSON.stringify(note) });
}

export async function updateLeadNote(
  leadId: string, noteId: string, updates: { body?: string; category?: string; is_pinned?: boolean }
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/leads/${leadId}/notes/${noteId}`, { method: 'PATCH', body: JSON.stringify(updates) });
}

export async function deleteLeadNote(leadId: string, noteId: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/leads/${leadId}/notes/${noteId}`, { method: 'DELETE' });
}

// ── Sprint 2 : Scores ──────────────────────────────────────

export async function getLeadScores(leadId: string): Promise<ApiResponse<LeadScore[]>> {
  return apiFetch<LeadScore[]>(`/leads/${leadId}/scores`);
}

export async function recomputeLeadScore(leadId: string): Promise<ApiResponse<LeadScore[]>> {
  return apiFetch<LeadScore[]>(`/leads/${leadId}/scores/recompute`, { method: 'POST' });
}

// ── Sprint 2 : Custom Field Values ─────────────────────────

export async function getLeadCustomFields(leadId: string): Promise<ApiResponse<CustomFieldValue[]>> {
  return apiFetch<CustomFieldValue[]>(`/leads/${leadId}/custom-fields`);
}

// ── Sprint 2 : Création de lead ────────────────────────────

export async function createLead(lead: {
  client_id: string; name: string; email: string; phone?: string;
  type?: string; source?: string; message?: string;
}): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/leads', { method: 'POST', body: JSON.stringify(lead) });
}

// ── Phase 2 : Messages & Conversations ─────────────────────

export async function getLeadMessages(leadId: string): Promise<ApiResponse<Message[]>> {
  return apiFetch<Message[]>(`/leads/${leadId}/messages`);
}

export async function sendMessage(
  leadId: string,
  message: {
    channel: 'email' | 'sms' | 'internal_note';
    subject?: string;
    body: string;
    template_id?: string;
  }
): Promise<ApiResponse<{ id: string; success: boolean }>> {
  return apiFetch<{ id: string; success: boolean }>(`/leads/${leadId}/messages`, {
    method: 'POST',
    body: JSON.stringify(message),
  });
}

export async function getInboxMessages(params?: {
  channel?: string;
  limit?: number;
}): Promise<ApiResponse<Message[]>> {
  const searchParams = new URLSearchParams();
  if (params?.channel) searchParams.set('channel', params.channel);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const qs = searchParams.toString();
  return apiFetch<Message[]>(`/messages${qs ? `?${qs}` : ''}`);
}

// ── Sprint 3 : Conversations ────────────────────────────────

export async function getConversations(params?: {
  channel?: string;
  status?: string;
  search?: string;
  assigned?: string;
  limit?: number;
}): Promise<ApiResponse<Conversation[]> & { meta?: { counts: Array<{ status: string; count: number }> } }> {
  const q = new URLSearchParams();
  if (params?.channel) q.set('channel', params.channel);
  if (params?.status) q.set('status', params.status);
  if (params?.search) q.set('search', params.search);
  if (params?.assigned) q.set('assigned', params.assigned);
  if (params?.limit) q.set('limit', String(params.limit));
  const qs = q.toString();
  return apiFetch<Conversation[]>(`/conversations${qs ? `?${qs}` : ''}`);
}

export async function getConversation(id: string, cursor?: string): Promise<ApiResponse<Conversation & { messages: Message[] }>> {
  const q = new URLSearchParams();
  if (cursor) q.set('cursor', cursor);
  const qs = q.toString();
  return apiFetch<Conversation & { messages: Message[] }>(`/conversations/${id}${qs ? `?${qs}` : ''}`);
}

export async function createConversation(params: {
  lead_id: string;
  channel: string;
  subject?: string;
}): Promise<ApiResponse<{ id: string; existing: boolean }>> {
  return apiFetch<{ id: string; existing: boolean }>('/conversations', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function sendConversationMessage(
  conversationId: string,
  message: { body: string; subject?: string }
): Promise<ApiResponse<{ id: string; success: boolean; status: string }>> {
  return apiFetch<{ id: string; success: boolean; status: string }>(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify(message),
  });
}

export async function updateConversation(
  id: string,
  updates: { status?: ConversationStatus; assigned_to?: string; is_starred?: number; snoozed_until?: string | null }
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/conversations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function markConversationRead(
  id: string
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/conversations/${id}/mark-read`, {
    method: 'POST',
  });
}

// ── Phase 2 : Templates d'emails ───────────────────────────

export async function getTemplates(category?: string): Promise<ApiResponse<EmailTemplate[]>> {
  const qs = category ? `?category=${category}` : '';
  return apiFetch<EmailTemplate[]>(`/templates${qs}`);
}

export async function getTemplate(templateId: string): Promise<ApiResponse<EmailTemplate>> {
  return apiFetch<EmailTemplate>(`/templates/${templateId}`);
}

export async function createTemplate(
  template: Partial<EmailTemplate>
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/templates', {
    method: 'POST',
    body: JSON.stringify(template),
  });
}

export async function updateTemplate(
  templateId: string,
  updates: Partial<EmailTemplate>
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/templates/${templateId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteTemplate(
  templateId: string
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/templates/${templateId}`, {
    method: 'DELETE',
  });
}

export async function interpolateTemplate(
  text: string,
  leadId: string
): Promise<ApiResponse<{ text: string }>> {
  return apiFetch<{ text: string }>('/templates/interpolate', {
    method: 'POST',
    body: JSON.stringify({ text, lead_id: leadId }),
  });
}

// ── Snippets ────────────────────────────────────────────────

export async function getSnippets(): Promise<ApiResponse<Snippet[]>> {
  return apiFetch<Snippet[]>('/snippets');
}

export async function createSnippet(
  snippet: Partial<Snippet>
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/snippets', {
    method: 'POST',
    body: JSON.stringify(snippet),
  });
}

export async function updateSnippet(
  snippetId: string,
  updates: Partial<Snippet>
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/snippets/${snippetId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteSnippet(
  snippetId: string
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/snippets/${snippetId}`, {
    method: 'DELETE',
  });
}

// ── Phase 3 : Workflows & Automations ────────────────────

export async function getWorkflows(folderId?: string): Promise<ApiResponse<Workflow[]>> {
  return apiFetch<Workflow[]>(folderId ? `/workflows?folder_id=${folderId}` : '/workflows');
}

export async function getWorkflow(id: string): Promise<ApiResponse<Workflow & { steps: WorkflowStep[]; enrollments: WorkflowEnrollment[] }>> {
  return apiFetch<Workflow & { steps: WorkflowStep[]; enrollments: WorkflowEnrollment[] }>(`/workflows/${id}`);
}

export async function createWorkflow(
  workflow: Partial<Workflow> & { steps?: Partial<WorkflowStep>[] }
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/workflows', {
    method: 'POST',
    body: JSON.stringify(workflow),
  });
}

export async function updateWorkflow(
  id: string,
  updates: Partial<Workflow> & { steps?: Partial<WorkflowStep>[] }
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/workflows/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function toggleWorkflow(
  id: string,
  isActive: boolean
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/workflows/${id}/toggle`, {
    method: 'POST',
    body: JSON.stringify({ is_active: isActive ? 1 : 0 }),
  });
}

export async function deleteWorkflow(
  id: string
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/workflows/${id}`, {
    method: 'DELETE',
  });
}

export async function enrollLead(
  workflowId: string,
  leadId: string
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>(`/workflows/${workflowId}/enroll`, {
    method: 'POST',
    body: JSON.stringify({ lead_id: leadId }),
  });
}

// ── Phase 4 : Calendrier & RDV ──────────────────────────

export async function getAppointments(
  params?: { start?: string; end?: string; clientId?: string }
): Promise<ApiResponse<Appointment[]>> {
  const query = new URLSearchParams();
  if (params?.start) query.set('start', params.start);
  if (params?.end) query.set('end', params.end);
  if (params?.clientId) query.set('client_id', params.clientId);
  const qs = query.toString();
  return apiFetch<Appointment[]>(`/appointments${qs ? `?${qs}` : ''}`);
}

export async function createAppointment(
  appointment: Partial<Appointment>
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/appointments', {
    method: 'POST',
    body: JSON.stringify(appointment),
  });
}

export async function updateAppointment(
  id: string,
  updates: Partial<Appointment>
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/appointments/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteAppointment(
  id: string
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/appointments/${id}`, {
    method: 'DELETE',
  });
}

export async function rescheduleAppointment(
  id: string, start_time: string, end_time: string
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/appointments/${id}/reschedule`, {
    method: 'PATCH',
    body: JSON.stringify({ start_time, end_time }),
  });
}

export async function sendAppointmentReminderNow(
  id: string
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/appointments/${id}/send-reminder-now`, {
    method: 'POST',
  });
}

// ── Calendars & Availability ──────────────────────────────

export interface Calendar {
  id: string;
  user_id: string;
  name: string;
  color: string;
  is_default: number;
  is_visible: number;
}

export async function getCalendars(): Promise<ApiResponse<Calendar[]>> {
  return apiFetch<Calendar[]>('/calendars');
}

export async function createCalendar(params: Partial<Calendar>): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/calendars', { method: 'POST', body: JSON.stringify(params) });
}

export async function updateCalendar(id: string, params: Partial<Calendar>): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/calendars/${id}`, { method: 'PATCH', body: JSON.stringify(params) });
}

export async function deleteCalendar(id: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/calendars/${id}`, { method: 'DELETE' });
}

export interface AvailabilityRule {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: number;
}

export async function getAvailabilityRules(): Promise<ApiResponse<AvailabilityRule[]>> {
  return apiFetch<AvailabilityRule[]>('/availability-rules');
}

export async function getAvailability(userId: string, date: string): Promise<ApiResponse<{ slots: string[] }>> {
  return apiFetch<{ slots: string[] }>(`/availability?user_id=${userId}&date=${date}`);
}

// ── Phase 7 : Tâches ────────────────────────────────────────

export async function getTasks(params?: {
  status?: string;
  priority?: string;
  lead_id?: string;
}): Promise<ApiResponse<Task[]>> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.priority) query.set('priority', params.priority);
  if (params?.lead_id) query.set('lead_id', params.lead_id);
  const qs = query.toString();
  return apiFetch<Task[]>(`/tasks${qs ? `?${qs}` : ''}`);
}

export async function createTask(
  task: Partial<Task>
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/tasks', {
    method: 'POST',
    body: JSON.stringify(task),
  });
}

export async function updateTask(
  id: string,
  updates: Partial<Task>
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteTask(
  id: string
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/tasks/${id}`, {
    method: 'DELETE',
  });
}

// ── Subtasks, Comments & Templates (Phase 25) ─────────────────

export async function getSubtasks(taskId: string): Promise<ApiResponse<Subtask[]>> {
  return apiFetch<Subtask[]>(`/tasks/${taskId}/subtasks`);
}

export async function createSubtask(taskId: string, title: string): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>(`/tasks/${taskId}/subtasks`, { method: 'POST', body: JSON.stringify({ title }) });
}

export async function updateSubtask(subtaskId: string, is_done: boolean): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/subtasks/${subtaskId}`, { method: 'PATCH', body: JSON.stringify({ is_done }) });
}

export async function deleteSubtask(subtaskId: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/subtasks/${subtaskId}`, { method: 'DELETE' });
}

export async function getTaskComments(taskId: string): Promise<ApiResponse<TaskComment[]>> {
  return apiFetch<TaskComment[]>(`/tasks/${taskId}/comments`);
}

export async function createTaskComment(taskId: string, body: string): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>(`/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
}

export async function deleteTaskComment(commentId: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/task-comments/${commentId}`, { method: 'DELETE' });
}

export async function getTaskTemplates(): Promise<ApiResponse<TaskTemplate[]>> {
  return apiFetch<TaskTemplate[]>('/task-templates');
}

export async function applyTaskTemplate(templateId: string, leadId?: string): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/task-templates/apply', { method: 'POST', body: JSON.stringify({ template_id: templateId, lead_id: leadId }) });
}

// ── Notifications ───────────────────────────────────────────

export interface NotificationItem {
  id: string;
  icon: string;
  title: string;
  description: string;
  link: string;
  is_read: number;
  created_at: string;
}

export async function getNotifications(params?: {
  unread?: boolean;
  limit?: number;
}): Promise<ApiResponse<NotificationItem[]> & { unread_count?: number }> {
  const query = new URLSearchParams();
  if (params?.unread) query.set('unread', '1');
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return apiFetch<NotificationItem[]>(`/notifications${qs ? `?${qs}` : ''}`);
}

export async function markNotificationRead(id: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/notifications/${id}/read`, { method: 'PATCH' });
}

export async function markAllNotificationsRead(): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>('/notifications/read-all', { method: 'POST' });
}

// ── Bulk actions ────────────────────────────────────────────

export async function bulkLeads(ids: string[], action: string, value?: string): Promise<ApiResponse<{ success: boolean; affected: number }>> {
  return apiFetch<{ success: boolean; affected: number }>('/leads/bulk', {
    method: 'POST',
    body: JSON.stringify({ ids, action, value }),
  });
}

// ── SMS ─────────────────────────────────────────────────────

export async function sendSms(leadId: string, message: string): Promise<ApiResponse<{ success: boolean; sid?: string }>> {
  return apiFetch<{ success: boolean; sid?: string }>('/sms/send', {
    method: 'POST',
    body: JSON.stringify({ lead_id: leadId, message }),
  });
}

// ── Pipelines ───────────────────────────────────────────────

export async function getPipelines(): Promise<ApiResponse<Pipeline[]>> {
  return apiFetch<Pipeline[]>('/pipelines');
}

export async function createPipeline(data: { name: string; client_id?: string; color?: string; is_default?: boolean }): Promise<ApiResponse<{ id: string; success: boolean }>> {
  return apiFetch<{ id: string; success: boolean }>('/pipelines', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updatePipeline(id: string, data: Partial<Pipeline>): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/pipelines/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deletePipeline(id: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/pipelines/${id}`, {
    method: 'DELETE',
  });
}

export async function createPipelineStage(pipelineId: string, data: { name: string; color?: string; probability?: number; wip_limit?: number; sla_days?: number }): Promise<ApiResponse<{ id: string; success: boolean }>> {
  return apiFetch<{ id: string; success: boolean }>(`/pipelines/${pipelineId}/stages`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updatePipelineStage(pipelineId: string, stageId: string, data: Partial<PipelineStage>): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/pipelines/${pipelineId}/stages/${stageId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deletePipelineStage(pipelineId: string, stageId: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/pipelines/${pipelineId}/stages/${stageId}`, {
    method: 'DELETE',
  });
}

export async function reorderPipelineStages(pipelineId: string, stages: { id: string; sort_order: number }[]): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/pipelines/${pipelineId}/stages/reorder`, {
    method: 'POST',
    body: JSON.stringify({ stages }),
  });
}

export async function getLostReasons(): Promise<ApiResponse<{ id: string; label: string; sort_order: number }[]>> {
  return apiFetch<{ id: string; label: string; sort_order: number }[]>('/lost-reasons');
}

export async function createLostReason(data: { label: string; client_id: string }): Promise<ApiResponse<{ id: string; success: boolean }>> {
  return apiFetch<{ id: string; success: boolean }>('/lost-reasons', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── 2FA TOTP ────────────────────────────────────────────────

export async function totpSetup(): Promise<ApiResponse<{ secret: string; otpauth_url: string }>> {
  return apiFetch<{ secret: string; otpauth_url: string }>('/auth/totp/setup', {
    method: 'POST',
  });
}

export async function totpVerify(token: string): Promise<ApiResponse<{ enabled: boolean }>> {
  return apiFetch<{ enabled: boolean }>('/auth/totp/verify', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export async function totpDisable(params: { token?: string; password?: string }): Promise<ApiResponse<{ enabled: boolean }>> {
  return apiFetch<{ enabled: boolean }>('/auth/totp/disable', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ── Bulk CSV Import ─────────────────────────────────────────

export interface CsvImportResult {
  total: number;
  imported: number;
  skipped: number;
  errors: Array<{ line: number; error: string }>;
}

export async function importLeadsCsv(
  clientId: string, csvData: string, fieldMapping?: Record<string, string>
): Promise<ApiResponse<CsvImportResult>> {
  return apiFetch<CsvImportResult>('/leads/import', {
    method: 'POST',
    body: JSON.stringify({ client_id: clientId, csv_data: csvData, field_mapping: fieldMapping }),
  });
}

// ── Reports ─────────────────────────────────────────────────

export interface ReportsOverview {
  period_days: number;
  kpis: {
    total_leads: number;
    converted_leads: number;
    lost_leads: number;
    conversion_rate: number;
    avg_conversion_days: number | null;
  };
  charts: {
    daily_leads: Array<{ date: string; count: number }>;
    by_status: Array<{ status: string; count: number }>;
    by_type: Array<{ type: string; count: number }>;
  };
}

export async function getReportsOverview(days?: number, clientId?: string): Promise<ApiResponse<ReportsOverview>> {
  const params = new URLSearchParams();
  if (days) params.set('days', String(days));
  if (clientId) params.set('client_id', clientId);
  return apiFetch<ReportsOverview>(`/reports/overview?${params.toString()}`);
}

export interface SourceReport {
  source: string;
  total_leads: number;
  converted: number;
  lost: number;
  conversion_rate: number;
}

export async function getReportsSources(days?: number): Promise<ApiResponse<{ period_days: number; sources: SourceReport[] }>> {
  const params = new URLSearchParams();
  if (days) params.set('days', String(days));
  return apiFetch<{ period_days: number; sources: SourceReport[] }>(`/reports/sources?${params.toString()}`);
}

export interface ConversionFunnel {
  period_days: number;
  total_leads: number;
  funnel: Array<{ stage: string; label: string; count: number; percentage: number }>;
  avg_stage_times: Array<{ action: string; avg_days_from_creation: number }>;
}

export async function getReportsConversion(days?: number): Promise<ApiResponse<ConversionFunnel>> {
  const params = new URLSearchParams();
  if (days) params.set('days', String(days));
  return apiFetch<ConversionFunnel>(`/reports/conversion?${params.toString()}`);
}

// ── Email Broadcast ─────────────────────────────────────────

export interface BroadcastResult {
  broadcast_id: string;
  total_recipients: number;
  sent: number;
  failed: number;
  errors: Array<{ email: string; error: string }>;
}

export async function sendBroadcast(params: {
  subject: string;
  body_html?: string;
  body_text?: string;
  template_id?: string;
  client_id?: string;
  filters?: {
    status?: string[];
    type?: string[];
    source?: string[];
  };
}): Promise<ApiResponse<BroadcastResult>> {
  return apiFetch<BroadcastResult>('/broadcast', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function getBroadcastHistory(limit?: number): Promise<ApiResponse<Array<Record<string, unknown>>>> {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  return apiFetch<Array<Record<string, unknown>>>(`/broadcast/history?${params.toString()}`);
}

// ── Booking Pages ───────────────────────────────────────────

export async function getBookingPages(): Promise<ApiResponse<Array<Record<string, unknown>>>> {
  return apiFetch<Array<Record<string, unknown>>>('/booking-pages');
}

export async function createBookingPage(data: { client_id: string; title: string; slug: string; description?: string; duration_minutes?: number; color?: string }): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/booking-pages', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateBookingPage(id: string, data: Record<string, unknown>): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/booking-pages/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteBookingPage(id: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/booking-pages/${id}`, { method: 'DELETE' });
}

export async function getBookings(pageId: string, status?: string): Promise<ApiResponse<Array<Record<string, unknown>>>> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  return apiFetch<Array<Record<string, unknown>>>(`/booking-pages/${pageId}/bookings?${params.toString()}`);
}

// ── Forms ────────────────────────────────────────────────────

export async function getForms(): Promise<ApiResponse<Array<Record<string, unknown>>>> {
  return apiFetch<Array<Record<string, unknown>>>('/forms');
}

export async function createForm(data: { client_id: string; name: string; slug: string; fields?: unknown[]; submit_action?: string }): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/forms', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateForm(id: string, data: Record<string, unknown>): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/forms/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteForm(id: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/forms/${id}`, { method: 'DELETE' });
}

export async function getFormSubmissions(formId: string, limit?: number): Promise<ApiResponse<Array<Record<string, unknown>>>> {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  return apiFetch<Array<Record<string, unknown>>>(`/forms/${formId}/submissions?${params.toString()}`);
}

// ── AI Bot ───────────────────────────────────────────────────

export async function aiChat(params: { lead_id?: string; conversation_id?: string; message: string }): Promise<ApiResponse<{ conversation_id: string; reply: string; tokens_used: number }>> {
  return apiFetch<{ conversation_id: string; reply: string; tokens_used: number }>('/ai/chat', { method: 'POST', body: JSON.stringify(params) });
}

export async function getAiConversations(limit?: number): Promise<ApiResponse<Array<Record<string, unknown>>>> {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  return apiFetch<Array<Record<string, unknown>>>(`/ai/conversations?${params.toString()}`);
}

export async function getAiConversation(id: string): Promise<ApiResponse<Record<string, unknown>>> {
  return apiFetch<Record<string, unknown>>(`/ai/conversations/${id}`);
}

// ── Sub-accounts ────────────────────────────────────────────

export async function getSubAccounts(): Promise<ApiResponse<Array<Record<string, unknown>>>> {
  return apiFetch<Array<Record<string, unknown>>>('/sub-accounts');
}

export async function createSubAccount(data: { name: string; email: string; password: string; role?: string; account_level?: string; max_clients?: number }): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/sub-accounts', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateSubAccount(id: string, data: Record<string, unknown>): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/sub-accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

// ── Snapshots ────────────────────────────────────────────────

export async function createSnapshot(sourceClientId: string, name?: string): Promise<ApiResponse<{ id: string; name: string; items: Record<string, number> }>> {
  return apiFetch<{ id: string; name: string; items: Record<string, number> }>('/snapshots/create', {
    method: 'POST', body: JSON.stringify({ source_client_id: sourceClientId, name }),
  });
}

export async function applySnapshot(snapshotId: string, targetClientId: string): Promise<ApiResponse<{ applied: Record<string, number> }>> {
  return apiFetch<{ applied: Record<string, number> }>('/snapshots/apply', {
    method: 'POST', body: JSON.stringify({ snapshot_id: snapshotId, target_client_id: targetClientId }),
  });
}

// ── White-label ──────────────────────────────────────────────

export async function getWhitelabel(): Promise<ApiResponse<Record<string, unknown>>> {
  return apiFetch<Record<string, unknown>>('/whitelabel');
}

export async function updateWhitelabel(data: {
  company_name?: string; logo_url?: string; primary_color?: string;
  accent_color?: string; custom_domain?: string; support_email?: string;
}): Promise<ApiResponse<Record<string, unknown>>> {
  return apiFetch<Record<string, unknown>>('/whitelabel', { method: 'PATCH', body: JSON.stringify(data) });
}

// ── Google Calendar ──────────────────────────────────────────

export async function getGcalAuthUrl(): Promise<ApiResponse<{ auth_url: string }>> {
  return apiFetch<{ auth_url: string }>('/gcal/auth-url');
}

export async function getGcalEvents(timeMin?: string, timeMax?: string): Promise<ApiResponse<{ events: Array<Record<string, unknown>> }>> {
  const params = new URLSearchParams();
  if (timeMin) params.set('time_min', timeMin);
  if (timeMax) params.set('time_max', timeMax);
  return apiFetch<{ events: Array<Record<string, unknown>> }>(`/gcal/events?${params.toString()}`);
}

export async function syncGcal(): Promise<ApiResponse<{ synced: number; total: number }>> {
  return apiFetch<{ synced: number; total: number }>('/gcal/sync', { method: 'POST' });
}

// ── Google Business Profile ─────────────────────────────────

export async function getGbpReviews(accountId: string, locationId: string): Promise<ApiResponse<{ reviews: Array<Record<string, unknown>>; average_rating: number; total_count: number }>> {
  return apiFetch<{ reviews: Array<Record<string, unknown>>; average_rating: number; total_count: number }>(
    `/gbp/reviews?account_id=${accountId}&location_id=${locationId}`
  );
}

export async function getGbpStats(): Promise<ApiResponse<{ accounts: Array<{ id: string; name: string }> }>> {
  return apiFetch<{ accounts: Array<{ id: string; name: string }> }>('/gbp/stats');
}

// ── Conformité CASL / Loi 25 ────────────────────────────────

export async function getUnsubscribes(params?: { limit?: number; offset?: number }): Promise<ApiResponse<Array<Record<string, unknown>>>> {
  const search = new URLSearchParams();
  if (params?.limit) search.set('limit', params.limit.toString());
  if (params?.offset) search.set('offset', params.offset.toString());
  return apiFetch<Array<Record<string, unknown>>>(`/unsubscribes?${search.toString()}`);
}

export async function logConsent(data: {
  lead_id: string; consent_type: string; granted: boolean;
}): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>('/consent', {
    method: 'POST', body: JSON.stringify(data),
  });
}

export async function getConsent(leadId: string): Promise<ApiResponse<Array<Record<string, unknown>>>> {
  return apiFetch<Array<Record<string, unknown>>>(`/consent?lead_id=${leadId}`);
}

export async function forgetLead(leadId: string): Promise<ApiResponse<{ success: boolean; anonymized: boolean }>> {
  return apiFetch<{ success: boolean; anonymized: boolean }>(`/leads/${leadId}/forget`, {
    method: 'POST',
  });
}

export async function exportLeadPii(leadId: string): Promise<ApiResponse<Record<string, unknown>>> {
  return apiFetch<Record<string, unknown>>(`/leads/${leadId}/export-pii`);
}

// ── Custom Fields (P3.4) ────────────────────────────────────

export async function getCustomFields(clientId?: string): Promise<ApiResponse<CustomFieldDef[]>> {
  const params = clientId ? `?client_id=${clientId}` : '';
  return apiFetch<CustomFieldDef[]>(`/custom-fields${params}`);
}

export async function createCustomField(data: {
  client_id: string; name: string; field_type: string;
  options?: string[]; is_required?: boolean; sort_order?: number;
}): Promise<ApiResponse<{ id: string; slug: string }>> {
  return apiFetch<{ id: string; slug: string }>('/custom-fields', {
    method: 'POST', body: JSON.stringify(data),
  });
}

export async function updateCustomField(fieldId: string, data: Partial<CustomFieldDef>): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/custom-fields/${fieldId}`, {
    method: 'PATCH', body: JSON.stringify(data),
  });
}

export async function deleteCustomField(fieldId: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/custom-fields/${fieldId}`, { method: 'DELETE' });
}

// getLeadCustomFields déplacé dans Sprint 2 section (ligne ~289)

export async function setLeadCustomFields(leadId: string, fields: Array<{ field_id: string; value: string }>): Promise<ApiResponse<{ success: boolean; updated: number }>> {
  return apiFetch<{ success: boolean; updated: number }>(`/leads/${leadId}/custom-fields`, {
    method: 'PATCH', body: JSON.stringify({ fields }),
  });
}

// ── Smart Lists (P3.4) ──────────────────────────────────────

export async function getSmartLists(): Promise<ApiResponse<SmartList[]>> {
  return apiFetch<SmartList[]>('/smart-lists');
}

export async function createSmartList(data: {
  name: string; client_id?: string; filters: Record<string, unknown>;
}): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/smart-lists', {
    method: 'POST', body: JSON.stringify(data),
  });
}

export async function deleteSmartList(listId: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/smart-lists/${listId}`, { method: 'DELETE' });
}

export async function executeSmartList(listId: string, params?: { limit?: number; offset?: number }): Promise<ApiResponse<{ data: any[]; total: number; filters: Record<string, unknown> }>> {
  const search = new URLSearchParams();
  if (params?.limit) search.set('limit', params.limit.toString());
  if (params?.offset) search.set('offset', params.offset.toString());
  return apiFetch<{ data: any[]; total: number; filters: Record<string, unknown> }>(`/smart-lists/${listId}/execute?${search.toString()}`);
}

// ── AI Features (P3.6) ──────────────────────────────────────

export async function aiScoreLead(leadId: string): Promise<ApiResponse<{ score: number; reason: string }>> {
  return apiFetch<{ score: number; reason: string }>(`/ai/score/${leadId}`, { method: 'POST' });
}

// aiGenerate et aiSuggestWorkflow → déplacés en Sprint 6 (fin de fichier)

// ── Documents & E-Signature (P3.2) ──────────────────────────

export interface DocumentTemplate {
  id: string;
  client_id?: string;
  name: string;
  description?: string;
  body_html: string;
  variables: string;
  category: string;
  is_active: number;
  created_at: string;
}

export interface Document {
  id: string;
  template_id?: string;
  lead_id: string;
  client_id: string;
  title: string;
  status: 'draft' | 'sent' | 'viewed' | 'signed' | 'expired';
  body_html: string;
  token: string;
  expires_at?: string;
  sent_at?: string;
  signed_at?: string;
  created_at: string;
  lead_name?: string;
  lead_email?: string;
  template_name?: string;
}

export async function getDocumentTemplates(clientId?: string): Promise<ApiResponse<DocumentTemplate[]>> {
  return apiFetch<DocumentTemplate[]>(clientId ? `/document-templates?client_id=${clientId}` : '/document-templates');
}

export async function createDocumentTemplate(data: Partial<DocumentTemplate>): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/document-templates', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateDocumentTemplate(id: string, data: Partial<DocumentTemplate>): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/document-templates/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteDocumentTemplate(id: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/document-templates/${id}`, { method: 'DELETE' });
}

export async function getDocuments(leadId?: string, status?: string): Promise<ApiResponse<Document[]>> {
  const search = new URLSearchParams();
  if (leadId) search.set('lead_id', leadId);
  if (status) search.set('status', status);
  return apiFetch<Document[]>(`/documents?${search.toString()}`);
}

export async function createDocument(data: { template_id?: string; lead_id: string; title: string; body_html?: string }): Promise<ApiResponse<{ id: string; sign_url: string }>> {
  return apiFetch<{ id: string; sign_url: string }>('/documents', { method: 'POST', body: JSON.stringify(data) });
}

export async function sendDocument(id: string): Promise<ApiResponse<{ success: boolean; sign_url: string }>> {
  return apiFetch<{ success: boolean; sign_url: string }>(`/documents/${id}/send`, { method: 'POST' });
}

// ── Invoices (P3.8) ─────────────────────────────────────────

export async function getInvoices(): Promise<ApiResponse<Array<Record<string, unknown>>>> {
  return apiFetch<Array<Record<string, unknown>>>('/invoices');
}

export async function createInvoice(data: { amount: number; description?: string; lead_id?: string; client_id?: string }): Promise<ApiResponse<{ id: string; payment_url: string }>> {
  return apiFetch<{ id: string; payment_url: string }>('/invoices', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateInvoiceStatus(id: string, status: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/invoices/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
}

// ── Agencies (P3.9) ─────────────────────────────────────────

export async function getAgencies(): Promise<ApiResponse<Array<Record<string, unknown>>>> {
  return apiFetch<Array<Record<string, unknown>>>('/agencies');
}

export async function createAgency(data: { name: string; custom_domain?: string }): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/agencies', { method: 'POST', body: JSON.stringify(data) });
}

// ── Trash / Soft Delete (P3.10) ─────────────────────────────

export async function softDeleteLead(leadId: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/leads/${leadId}/trash`, { method: 'POST' });
}

export async function restoreLead(leadId: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/leads/${leadId}/restore`, { method: 'POST' });
}

export async function getTrash(): Promise<ApiResponse<Array<Record<string, unknown>>>> {
  return apiFetch<Array<Record<string, unknown>>>('/trash');
}

export async function emptyTrash(): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>('/trash/empty', { method: 'POST' });
}

// ── Device Tokens (P3.10) ───────────────────────────────────

export async function registerDevice(token: string, platform?: string): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/devices', { method: 'POST', body: JSON.stringify({ token, platform }) });
}

export async function unregisterDevice(token: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>('/devices', { method: 'DELETE', body: JSON.stringify({ token }) });
}

// ── Sprint 6 : AI Content Generator (D2) ────────────────────

export type AiAction = 'email_followup' | 'email_welcome' | 'sms_followup' | 'social_post' | 'objection_handler' | 'meeting_agenda' | 'proposal_intro' | 'recap_call';

export async function aiGenerate(params: {
  action: AiAction;
  context?: string;
  lead_id?: string;
  client_id?: string;
  brand_voice?: string;
}): Promise<ApiResponse<{ content: string; action: string }>> {
  return apiFetch<{ content: string; action: string }>('/ai/generate', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function aiSuggestWorkflow(prompt: string): Promise<ApiResponse<{ steps: Array<Record<string, unknown>> }>> {
  return apiFetch<{ steps: Array<Record<string, unknown>> }>('/ai/suggest-workflow', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  });
}

// ── Sprint 6 : Dashboard Layouts (D4) ───────────────────────

export interface DashboardLayout {
  id: string;
  user_id: string;
  client_id: string | null;
  name: string;
  layout_json: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export async function getDashboardLayouts(clientId?: string): Promise<ApiResponse<DashboardLayout[]>> {
  const qs = clientId ? `?client_id=${clientId}` : '';
  return apiFetch<DashboardLayout[]>(`/dashboard/layouts${qs}`);
}

export async function createDashboardLayout(params: {
  name: string;
  layout_json: string;
  client_id?: string;
  is_default?: boolean;
}): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/dashboard/layouts', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function updateDashboardLayout(id: string, params: {
  name?: string;
  layout_json?: string;
  is_default?: boolean;
}): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/dashboard/layouts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(params),
  });
}

export async function deleteDashboardLayout(id: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/dashboard/layouts/${id}`, {
    method: 'DELETE',
  });
}

// ── Sprint 6 : Industry Packs (D7) ─────────────────────────

export interface IndustryPack {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  industries: string;
  is_published: number;
}

export interface PackInstallResult {
  success: boolean;
  pack_name: string;
  installed: {
    custom_fields: number;
    workflows: number;
    templates: number;
    smart_lists: number;
    skipped: number;
  };
  message: string;
}

export async function getPacks(): Promise<ApiResponse<IndustryPack[]>> {
  return apiFetch<IndustryPack[]>('/packs');
}

export async function getPackDetail(slug: string): Promise<ApiResponse<IndustryPack & { snapshot: Record<string, unknown> }>> {
  return apiFetch<IndustryPack & { snapshot: Record<string, unknown> }>(`/packs/${slug}`);
}

export async function installPack(slug: string, clientId: string): Promise<ApiResponse<PackInstallResult>> {
  return apiFetch<PackInstallResult>(`/packs/${slug}/install`, {
    method: 'POST',
    body: JSON.stringify({ client_id: clientId }),
  });
}

// ── Sprint 6 : SMS Signing (D5) ────────────────────────────

export async function sendSigningSms(docId: string): Promise<ApiResponse<{ success: boolean; sms_sent_to: string; sign_url: string }>> {
  return apiFetch<{ success: boolean; sms_sent_to: string; sign_url: string }>(`/documents/${docId}/send-sms`, {
    method: 'POST',
  });
}

// ── Sprint 6 : Client business config (D1) ─────────────────

export async function updateClientBusinessConfig(clientId: string, config: {
  business_type?: string;
  brand_voice?: string;
  scoring_prompt_extra?: string;
}): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/clients/${clientId}`, {
    method: 'PATCH',
    body: JSON.stringify(config),
  });
}

// ── Sprint 7 : Email Builder ────────────────────────────────

export async function saveTemplateBlocks(
  templateId: string,
  blocks: unknown[],
  preheader?: string
): Promise<ApiResponse<{ success: boolean; html_length: number }>> {
  return apiFetch<{ success: boolean; html_length: number }>(`/templates/${templateId}/blocks`, {
    method: 'PUT',
    body: JSON.stringify({ blocks, preheader }),
  });
}

export async function sendTestEmail(
  templateId: string,
  toEmail: string
): Promise<ApiResponse<{ success: boolean; mock?: boolean; message?: string }>> {
  return apiFetch<{ success: boolean; mock?: boolean; message?: string }>('/templates/send-test', {
    method: 'POST',
    body: JSON.stringify({ template_id: templateId, to_email: toEmail }),
  });
}

export async function duplicateTemplate(
  templateId: string
): Promise<ApiResponse<{ id: string; parent_id: string }>> {
  return apiFetch<{ id: string; parent_id: string }>(`/templates/${templateId}/duplicate`, {
    method: 'POST',
  });
}

export async function getTemplateFolders(): Promise<ApiResponse<Array<{ id: string; name: string; sort_order: number }>>> {
  return apiFetch<Array<{ id: string; name: string; sort_order: number }>>('/templates/folders');
}

export async function createTemplateFolder(name: string): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/templates/folders', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

// ── Sprint 7 : Forms Builder ────────────────────────────────

export async function getForm(formId: string): Promise<ApiResponse<Record<string, unknown>>> {
  return apiFetch<Record<string, unknown>>(`/forms/${formId}`);
}

export async function getFormStats(formId: string): Promise<ApiResponse<{
  total_views: number; total_submissions: number; conversion_rate: string;
  views_by_day: Array<{ day: string; count: number }>;
}>> {
  return apiFetch(`/forms/${formId}/stats`);
}

// ── Sprint 7 : Trigger Links ────────────────────────────────

export async function getTriggerLinks(): Promise<ApiResponse<Array<{
  id: string; name: string; target_url: string; click_count: number; total_clicks: number; created_at: string;
}>>> {
  return apiFetch('/trigger-links');
}

export async function createTriggerLink(data: {
  name: string; target_url: string; tag_to_apply?: string; client_id?: string;
}): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/trigger-links', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteTriggerLink(linkId: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/trigger-links/${linkId}`, {
    method: 'DELETE',
  });
}

// ── Sprint 7 : AI Workflow Assistant enrichi ─────────────────

export async function aiSuggestWorkflowEnriched(prompt: string, clientId?: string): Promise<ApiResponse<{
  name: string; description: string; trigger_type: string;
  steps: Array<{ id: string; type: string; config: Record<string, unknown> }>;
}>> {
  return apiFetch('/ai/suggest-workflow', {
    method: 'POST',
    body: JSON.stringify({ prompt, client_id: clientId }),
  });
}
