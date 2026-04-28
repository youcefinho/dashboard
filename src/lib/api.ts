// ── Client API — Helpers pour appeler le worker ─────────────

import type { ApiResponse, Client, Lead, DashboardStats } from './types';

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
}): Promise<ApiResponse<Lead[]>> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.search) searchParams.set('search', params.search);
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

export async function updateLead(
  leadId: string,
  updates: { status?: string; notes?: string }
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/leads/${leadId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

// ── Pipeline ────────────────────────────────────────────────

export async function getPipeline(): Promise<ApiResponse<Lead[]>> {
  return apiFetch<Lead[]>('/pipeline');
}
