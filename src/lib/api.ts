// ── Client API — Helpers pour appeler le worker ─────────────

import type { ApiResponse, Client, Lead, LeadDetail, DashboardStats, ActivityLogEntry, Message, EmailTemplate, Workflow, WorkflowStep, WorkflowEnrollment, Appointment, Task } from './types';

const API_BASE = '/api';

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

async function apiFetch<T>(
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
  user: { id: string; name: string; role: string; email: string };
}

export async function login(email: string, password: string): Promise<ApiResponse<LoginResponse>> {
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

export async function getPipeline(): Promise<ApiResponse<Lead[]>> {
  return apiFetch<Lead[]>('/pipeline');
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

// ── Phase 3 : Workflows & Automations ────────────────────

export async function getWorkflows(): Promise<ApiResponse<Workflow[]>> {
  return apiFetch<Workflow[]>('/workflows');
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

export interface Pipeline {
  id: string;
  name: string;
  description: string;
  is_default: number;
  position: number;
  stages: PipelineStage[];
}

export interface PipelineStage {
  id: string;
  pipeline_id: string;
  name: string;
  slug: string;
  color: string;
  position: number;
  is_win_stage: number;
  is_loss_stage: number;
  lead_count: number;
}

export async function getPipelines(): Promise<ApiResponse<Pipeline[]>> {
  return apiFetch<Pipeline[]>('/pipelines');
}

export async function createPipeline(name: string, description?: string): Promise<ApiResponse<{ id: string; success: boolean }>> {
  return apiFetch<{ id: string; success: boolean }>('/pipelines', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
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

export async function createPipelineStage(pipelineId: string, data: { name: string; slug: string; color?: string }): Promise<ApiResponse<{ id: string; success: boolean }>> {
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
