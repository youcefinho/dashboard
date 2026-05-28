// ── Client API — Helpers pour appeler le worker ─────────────

import type { ApiResponse, Client, Lead, LeadDetail, DashboardStats, ActivityLogEntry, Message, EmailTemplate, Workflow, WorkflowStep, WorkflowEnrollment, SequenceStats, Appointment, Task, Subtask, TaskComment, TaskTemplate, LeadNote, LeadScore, CustomFieldValue, Conversation, ConversationStatus, Pipeline, PipelineStage, CustomFieldDef, SmartList, Snippet, Product, Order, Customer, ProductVariant, ProductCategory, ProductImage, InventoryRecord, PaymentInitResult, PaymentMethod, PaymentStatus, Shipment, ShipmentStatus, ShippingZone, ShippingRate, ShippingRateResult, ConsumerPolicy, ReturnRequest, Customer360, AbandonedCart, EcommerceRevenue, EcommerceCohorts, EcommerceLtv, EcommerceTopProducts, EcommerceSalesByChannel, ProductRecoResult, CustomerChurnPrediction, AiChatThread, AiChatMessage, AiPageContext, CustomHostname, OauthConnection, SmsTemplate, WhatsAppConnection, ExecLogEntry, WorkflowTemplate, WorkflowSimulationResult, FormFieldAnalyticsRow, StorefrontProduct, PublicCart, StoreSettings, CheckoutInput, CheckoutResult, PrivateFeedback, ReputationSettings, PublicReviewPage, SocialAccount, SocialPost, SocialProvider, AiContentFormat, AiContentItem, AiBrandVoice, ConversionBaseline, ConversionPrediction, ForecastResponse, ForecastTarget, ReportTemplate, OnboardingChecklistItemKey, OnboardingChecklistResponse, CookieConsent, CookieConsentRecord, AccountDeletionRequest, MyDataExport, AuditLogEntry, AuditLogQuery, CapabilityOverride, AlertRule, AlertEvent, AlertConditionType, AlertChannel, ObservabilityHealth, RequestMetricsBucket, ReleaseGatesStatus } from './types';
export type { Lead };
import { Capacitor } from '@capacitor/core';
import { MOCK_DASHBOARD_STATS, MOCK_CLIENTS, MOCK_LEADS } from './mockData';
// ── Sprint 35 vague 35-2B — i18n des erreurs réseau critiques ──
import { t } from './i18n';

// Mode dev bypass — fallback mock data quand le worker n'est pas joignable
const IS_DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true';

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
  localStorage.removeItem('intralys_active_sub_account');
}

// ── Sous-compte actif (SaaS Lot 2, §6.11) ───────────────────
// Clé localStorage. Absente ⇒ legacy : aucun header X-Sub-Account
// injecté ⇒ comportement byte-identique au mono-tenant actuel.
const ACTIVE_SUB_ACCOUNT_KEY = 'intralys_active_sub_account';

export function getActiveSubAccount(): string | null {
  try {
    const v = localStorage.getItem(ACTIVE_SUB_ACCOUNT_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function setActiveSubAccount(id: string | null): void {
  try {
    if (id && id.length > 0) {
      localStorage.setItem(ACTIVE_SUB_ACCOUNT_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_SUB_ACCOUNT_KEY);
    }
  } catch {
    /* SSR / storage indisponible — best-effort, comme le reste du module */
  }
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

  // SaaS Lot 2 (§6.11) — sous-compte actif. Additif strict : absent
  // ⇒ header non ajouté ⇒ requête byte-identique au comportement actuel.
  const activeSubAccount = getActiveSubAccount();
  if (activeSubAccount) {
    headers['X-Sub-Account'] = activeSubAccount;
  }

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    // Session expirée → nettoyer et rediriger
    if (response.status === 401) {
      clearToken();
      window.location.href = '/login';
      return { error: t('api.session_expired') };
    }

    // Rate limit
    if (response.status === 429) {
      return { error: t('api.rate_limit') };
    }

    const data = await response.json() as ApiResponse<T>;

    if (!response.ok) {
      return { error: data.error || `Erreur ${response.status}` };
    }

    return data;
  } catch {
    // Réseau indisponible (pas de worker en local) — retourner une erreur propre
    return { error: t('api.unavailable') };
  }
}

// ── Auth ────────────────────────────────────────────────────

export interface LoginResponse {
  token: string;
  must_change_password?: boolean;
  user: { id: string; name: string; role: string; email: string; onboarding_step?: number; onboarding_skipped?: boolean };
}

export async function login(email: string, password: string): Promise<ApiResponse<LoginResponse>> {
  // DEV BYPASS — actif UNIQUEMENT si VITE_DEV_BYPASS_AUTH=true dans .env.local.
  // En prod, la variable n'est pas définie → vrai appel /auth/login.
  if (import.meta.env.VITE_DEV_BYPASS_AUTH === 'true') {
    const fakeData: LoginResponse = {
      token: 'dev-bypass-token',
      must_change_password: false,
      user: { id: 'admin', name: 'Rochdi (Dev)', role: 'admin', email: email || 'rochdi@intralys.com', onboarding_step: 0, onboarding_skipped: false }
    };
    setToken(fakeData.token);
    localStorage.setItem('intralys_user', JSON.stringify(fakeData.user));
    localStorage.removeItem('must_change_password');
    return { data: fakeData };
  }

  const result = await apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

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

// ── SaaS Lot 4 §6.20 — inscription (additif, calque login()) ──
// register() est PUREMENT additif : login()/apiFetch/setToken inchangés.
// POST /auth/register (handleRegister figé Lot 1 §6.5). Sur succès
// (format finishLogin) → setToken + localStorage IDENTIQUE à login().
export async function register(
  body: { email: string; password: string; name: string; company?: string }
): Promise<ApiResponse<LoginResponse>> {
  const result = await apiFetch<LoginResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const raw = result as unknown as Record<string, unknown>;
  if (raw['token'] || (result.data && 'token' in result.data)) {
    const loginData = (result.data || raw) as unknown as LoginResponse;
    setToken(loginData.token);
    localStorage.setItem('intralys_user', JSON.stringify(loginData.user));
    localStorage.removeItem('must_change_password');
    return { data: loginData };
  }

  return result;
}

// ── LOT TEAM A (Phase B / M2) — acceptation d'invitation ─────
// Calque EXACT de register()/login() : helper additif, apiFetch/setToken
// inchangés. POST PUBLIC /team/invites/accept (handleAcceptInvitation figé
// LOT-TEAM-A §6.B). Sur succès = payload finishLogin → persistance session
// IDENTIQUE à login() (setToken + intralys_user + must_change_password).
export async function acceptInvitation(
  body: { token: string; password: string; name?: string }
): Promise<ApiResponse<LoginResponse>> {
  const result = await apiFetch<LoginResponse>('/team/invites/accept', {
    method: 'POST',
    body: JSON.stringify(body),
  });

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

// ── Téléphonie & Numéros Virtuels (Sprint 51) ─────────────────
export interface VirtualPhoneNumber {
  id: string;
  client_id: string;
  phone_number: string;
  friendly_name: string;
  twilio_sid: string;
  status: 'active' | 'suspended' | 'released';
  created_at: string;
  updated_at: string;
}

export interface PhoneRoutingRule {
  id: string;
  phone_number_id: string;
  priority: number;
  condition_type: 'all' | 'area_code';
  condition_value: string;
  target_type: 'user' | 'ivr' | 'forward';
  target_id: string;
  record_call?: number;
  play_consent_msg?: number;
  created_at?: string;
  updated_at?: string;
}

export async function getVirtualPhoneNumbers(): Promise<ApiResponse<VirtualPhoneNumber[]>> {
  return apiFetch<VirtualPhoneNumber[]>('/phone-numbers');
}

export async function searchVirtualPhoneNumbers(areaCode: string): Promise<ApiResponse<Array<{
  phone_number: string;
  friendly_name: string;
  rate_center: string;
  region: string;
  iso_country: string;
}>>> {
  return apiFetch(`/phone-numbers/search?areaCode=${encodeURIComponent(areaCode)}`);
}

export async function purchaseVirtualPhoneNumber(body: {
  phone_number: string;
  friendly_name?: string;
}): Promise<ApiResponse<VirtualPhoneNumber>> {
  return apiFetch<VirtualPhoneNumber>('/phone-numbers/purchase', {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export async function releaseVirtualPhoneNumber(id: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/phone-numbers/${id}`, {
    method: 'DELETE'
  });
}

export async function getPhoneRoutingRules(numberId: string): Promise<ApiResponse<PhoneRoutingRule[]>> {
  return apiFetch<PhoneRoutingRule[]>(`/phone-numbers/${numberId}/routing`);
}

export async function savePhoneRoutingRules(numberId: string, rules: Array<Partial<PhoneRoutingRule>>): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/phone-numbers/${numberId}/routing`, {
    method: 'POST',
    body: JSON.stringify({ rules })
  });
}

// ── LOT TEAM A (Phase B / M2) — gestion d'équipe ─────────────
// Tous via apiFetch (auth + X-Sub-Account injectés). Remplace les `fetch`
// bruts sans header de l'ancien TeamSettings (mock). Endpoints figés §6.B.
export interface TeamUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  role_generic: string | null;
  last_login_at: string | null;
  created_at: string | null;
}

export interface TeamRole {
  id: string;
  name: string;
  is_system: boolean;
}

export async function getTeamUsers(): Promise<ApiResponse<TeamUser[]>> {
  return apiFetch<TeamUser[]>('/team/users');
}

export async function getTeamRoles(): Promise<ApiResponse<TeamRole[]>> {
  return apiFetch<TeamRole[]>('/team/roles');
}

export async function inviteTeamMember(body: {
  email: string;
  role?: string;
  name?: string;
  scope?: 'agency' | 'subaccount';
  client_id?: string;
  message?: string;
}): Promise<ApiResponse<{ success: boolean; message: string }>> {
  return apiFetch<{ success: boolean; message: string }>('/team/invites', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function revokeTeamInvite(id: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/team/invites/${id}/revoke`, { method: 'POST' });
}

export async function resendTeamInvite(id: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/team/invites/${id}/resend`, { method: 'POST' });
}

export async function updateTeamUserRole(
  id: string,
  role: string
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/team/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export async function deleteTeamUser(id: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/team/users/${id}`, { method: 'DELETE' });
}

// ── LOT TEAM B/C (Phase A fige les helpers + types ; corps handlers = Phase B)
// Tous via apiFetch (auth + X-Sub-Account injectés). apiFetch/ApiResponse
// GELÉS (378 appelants — docs/LOT-TEAM-BC.md §6.A) : discrimination d'erreur
// = string-match sur `error`, AUCUN champ `code` requis côté front.

// Invitation en attente (liste GET /team/invites — §6.B). Champs additifs
// tolérés null pré-back-fill ; le front ne lit QUE ce dont il a besoin.
export interface TeamInvite {
  id: string;
  email: string;
  role: string;
  scope: string;
  client_id: string | null;
  status: string;
  expires_at: string | null;
  created_at: string | null;
}

// Rôle enrichi de ses capabilities (GET /team/roles — §6.E). `capabilities`
// optionnel : tant que Manager-B n'a pas enrichi le handler, le tableau peut
// être absent (rétro-compat avec TeamRole de base).
export interface TeamRoleWithCaps {
  id: string;
  name: string;
  description?: string;
  is_system: boolean;
  capabilities?: string[];
}

// GET /team/invites — invitations en attente bornées tenant (§6.B).
export async function getTeamInvites(): Promise<ApiResponse<TeamInvite[]>> {
  return apiFetch<TeamInvite[]>('/team/invites');
}

// GET /team/capabilities/me — capabilities effectives de l'utilisateur (§6.D).
export async function getMyCapabilities(): Promise<ApiResponse<string[]>> {
  return apiFetch<string[]>('/team/capabilities/me');
}

// GET /team/roles — 4 rôles + leurs capabilities (§6.E). Calque getTeamRoles
// mais typé enrichi (capabilities lues de role_capabilities côté worker).
export async function getRolesWithCaps(): Promise<ApiResponse<TeamRoleWithCaps[]>> {
  return apiFetch<TeamRoleWithCaps[]>('/team/roles');
}

// ── LOT TEAM C — sous-comptes (CRUD) + branding white-label (§6.F) ──────────
export interface ClientBranding {
  branding: string | null;
  logo_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
}

// PATCH /clients/:id — édition d'un sous-compte (borné tenant côté worker).
export async function updateClient(
  id: string,
  body: Record<string, unknown>
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/clients/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// DELETE /clients/:id — soft-delete (UPDATE is_active = 0 côté worker).
export async function deleteClient(id: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/clients/${id}`, { method: 'DELETE' });
}

// GET /clients/:id/branding — lecture branding white-label (colonnes seq 81).
export async function getClientBranding(id: string): Promise<ApiResponse<ClientBranding>> {
  return apiFetch<ClientBranding>(`/clients/${id}/branding`);
}

// PATCH /clients/:id/branding — écriture branding (borné tenant côté worker).
export async function updateClientBranding(
  id: string,
  body: Partial<ClientBranding>
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/clients/${id}/branding`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// GET /reports/agency — agrégat cross-sous-comptes (borné accessibleClientIds).
// Réponse libre (forme finale décidée Phase B Manager-C) — typage souple.
export async function getAgencyReports(
  params?: Record<string, string | number>
): Promise<ApiResponse<Record<string, unknown>>> {
  const qs =
    params && Object.keys(params).length
      ? '?' + new URLSearchParams(
          Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
        ).toString()
      : '';
  return apiFetch<Record<string, unknown>>(`/reports/agency${qs}`);
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

// ── Onboarding unifié CRM + e-commerce (Sprint S8) ──────────
// État d'onboarding persistant côté serveur (table onboarding_state,
// migration seq 76). Permet la reprise multi-appareil. Le front Sprint 45
// garde son fallback localStorage : ces appels sont best-effort.

export interface OnboardingState {
  /** Index de l'étape courante (0-based). */
  currentStep: number;
  /** Identifiants des étapes complétées (ex: 'profile','industry'). */
  completedSteps: string[];
  /** Opt-in module e-commerce (n'active AUCUN paiement). */
  ecommerceOptedIn: boolean;
  /** Timestamp ISO de complétion, ou null si non terminé. */
  completedAt: string | null;
  /** Echo libre du payload onboarding (best-effort), ou null. */
  payload: Record<string, unknown> | null;
}

export async function getOnboardingState(): Promise<ApiResponse<OnboardingState>> {
  return apiFetch<OnboardingState>('/onboarding/state');
}

export async function putOnboardingState(
  patch: Partial<OnboardingState>,
): Promise<ApiResponse<OnboardingState>> {
  return apiFetch<OnboardingState>('/onboarding/state', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
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

// Sprint 46 M3.3 — extension channels (push + slack ajoutés)
export interface NotificationPreference {
  channel: 'email' | 'sms' | 'push' | 'in_app' | 'slack';
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

// ── Sprint 46 M3.3 — Bulk PUT (matrix complète channels × events) ────────────
// Endpoint additif : PATCH single par cell reste l'usage par défaut (toggle =
// save immédiat). Le PUT batch permet reset/import/export presets en 1 RTT.
export interface NotificationPreferencesMatrix {
  preferences: Array<{
    channel: NotificationPreference['channel'];
    event_type: string;
    enabled: boolean;
  }>;
}

export async function setNotificationPreferences(
  matrix: NotificationPreferencesMatrix,
): Promise<ApiResponse<{ success: boolean; count: number }>> {
  return apiFetch<{ success: boolean; count: number }>('/notifications/preferences', {
    method: 'PUT',
    body: JSON.stringify(matrix),
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
  const result = await apiFetch<DashboardStats>('/dashboard/stats');
  // Fallback mock data en dev quand le worker n'est pas joignable
  if (!result.data && IS_DEV_BYPASS) {
    return { data: MOCK_DASHBOARD_STATS };
  }
  return result;
}

// ── Clients ─────────────────────────────────────────────────

export async function getClients(): Promise<ApiResponse<Client[]>> {
  const result = await apiFetch<Client[]>('/clients');
  if (!result.data && IS_DEV_BYPASS) {
    return { data: MOCK_CLIENTS };
  }
  return result;
}

export async function createClient(client: Partial<Client>): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/clients', {
    method: 'POST',
    body: JSON.stringify(client),
  });
}

// ── Modules (feature-flag par tenant) — Sprint E1 M2.1 ───────

export type ModuleId = 'crm' | 'ecommerce';

export interface ModulesState {
  clientId: string | null;
  active: ModuleId[];
  available: ModuleId[];
  locked: ModuleId[];
}

export async function getModules(): Promise<ApiResponse<ModulesState>> {
  const result = await apiFetch<ModulesState>('/modules');
  // Dev bypass / réseau absent : fallback CRM seul (e-commerce off)
  if (!result.data && IS_DEV_BYPASS) {
    return { data: { clientId: null, active: ['crm'], available: ['crm', 'ecommerce'], locked: ['crm'] } };
  }
  return result;
}

// ── E-commerce (module Boutique B2) — Sprint E1 M3 ───────────
// Skeleton API frontend. Les pages /boutique* consomment ces helpers ;
// elles affichent des placeholders honnêtes tant que les données sont vides.

interface PagedResponse<T> extends ApiResponse<T[]> {
  total?: number;
}

export async function getEcommerceProducts(params?: {
  status?: string;
  category_id?: string;
  search?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}): Promise<PagedResponse<Product>> {
  const sp = new URLSearchParams();
  if (params?.status) sp.set('status', params.status);
  if (params?.category_id) sp.set('category_id', params.category_id);
  if (params?.search) sp.set('search', params.search);
  if (params?.sort) sp.set('sort', params.sort);
  if (params?.limit != null) sp.set('limit', String(params.limit));
  if (params?.offset != null) sp.set('offset', String(params.offset));
  const qs = sp.toString();
  return apiFetch<Product[]>(`/ecommerce/products${qs ? `?${qs}` : ''}`);
}

// ── E3 orders — Sprint E3 M1 ──────────────────────────────────────────────
// Helpers commandes (gated requireModule + multi-tenant côté worker).

export interface CreateOrderPayload {
  customer_id?: string | null;
  email: string;
  items: Array<{ variant_id: string; quantity: number }>;
  shipping_cents?: number;
  discount_cents?: number;
  note?: string;
  source?: string;
}

export interface CreateOrderResult {
  id: string;
  order_number: string;
  subtotal_cents: number;
  tps_cents: number;
  tvq_cents: number;
  total_cents: number;
}

export async function getEcommerceOrders(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<PagedResponse<Order>> {
  const sp = new URLSearchParams();
  if (params?.status) sp.set('status', params.status);
  if (params?.limit != null) sp.set('limit', String(params.limit));
  if (params?.offset != null) sp.set('offset', String(params.offset));
  const qs = sp.toString();
  return apiFetch<Order[]>(`/ecommerce/orders${qs ? `?${qs}` : ''}`);
}

export async function getEcommerceOrder(id: string): Promise<ApiResponse<Order>> {
  return apiFetch<Order>(`/ecommerce/orders/${id}`);
}

export async function createEcommerceOrder(
  payload: CreateOrderPayload,
): Promise<ApiResponse<CreateOrderResult>> {
  return apiFetch<CreateOrderResult>('/ecommerce/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function createManualOrder(
  payload: CreateOrderPayload,
): Promise<ApiResponse<CreateOrderResult>> {
  return apiFetch<CreateOrderResult>('/ecommerce/orders/manual', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateOrderStatus(
  id: string,
  status: string,
): Promise<ApiResponse<{ id: string; status: string }>> {
  return apiFetch<{ id: string; status: string }>(`/ecommerce/orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function getEcommerceCustomers(): Promise<PagedResponse<Customer>> {
  return apiFetch<Customer[]>('/ecommerce/customers');
}

export async function getEcommerceCustomer(id: string): Promise<ApiResponse<Customer>> {
  return apiFetch<Customer>(`/ecommerce/customers/${id}`);
}

// ── E3 cart — Sprint E3 M2 ────────────────────────────────────────────────
// Helpers panier / conversion / facture (gated requireModule + multi-tenant
// côté worker). Bloc DISTINCT du bloc « E3 orders » M1 ci-dessus (append-only).
// createManualOrder est déjà fourni par M1 (bloc E3 orders) — non dupliqué ici.

export interface CartItem {
  id: string;
  variant_id: string;
  quantity: number;
  product_title: string;
  variant_title: string | null;
  sku: string | null;
  unit_price_cents: number;
  total_cents: number;
}

export interface Cart {
  id: string;
  token: string;
  status: string;
  customer_id: string | null;
  items: CartItem[];
  subtotal_cents: number;
  preview_tps_cents: number;
  preview_tvq_cents: number;
  preview_total_cents: number;
}

export async function getCart(params: {
  customer_id?: string;
  token?: string;
}): Promise<ApiResponse<Cart>> {
  const sp = new URLSearchParams();
  if (params.customer_id) sp.set('customer_id', params.customer_id);
  if (params.token) sp.set('token', params.token);
  return apiFetch<Cart>(`/ecommerce/cart?${sp.toString()}`);
}

export async function addCartItem(payload: {
  variant_id: string;
  quantity: number;
  customer_id?: string;
  token?: string;
}): Promise<ApiResponse<Cart>> {
  return apiFetch<Cart>('/ecommerce/cart/items', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateCartItem(
  itemId: string,
  quantity: number,
): Promise<ApiResponse<Cart>> {
  return apiFetch<Cart>(`/ecommerce/cart/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ quantity }),
  });
}

export async function deleteCartItem(itemId: string): Promise<ApiResponse<Cart>> {
  return apiFetch<Cart>(`/ecommerce/cart/items/${itemId}`, { method: 'DELETE' });
}

export async function convertCart(
  cartId: string,
  payload: {
    email?: string;
    customer_id?: string;
    shipping_cents?: number;
    discount_cents?: number;
    note?: string;
  },
): Promise<ApiResponse<{ order_id: string; order_number: string; total_cents: number }>> {
  return apiFetch<{ order_id: string; order_number: string; total_cents: number }>(
    `/ecommerce/cart/${cartId}/convert`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export async function getCustomerOrders(
  customerId: string,
): Promise<PagedResponse<Order>> {
  return apiFetch<Order[]>(`/ecommerce/customers/${customerId}/orders`);
}

export interface OrderInvoiceData {
  order: Record<string, unknown>;
  items: Array<{
    product_title: string;
    variant_title: string;
    sku: string;
    unit_price_cents: number;
    quantity: number;
    total_cents: number;
    tax_cents: number;
  }>;
  totals: {
    subtotal_cents: number;
    tps_cents: number;
    tvq_cents: number;
    shipping_cents: number;
    discount_cents: number;
    total_cents: number;
  };
  client: {
    name: string | null;
    email: string | null;
    gst_number: string | null;
    qst_number: string | null;
    tax_note: string;
  };
  customer: Record<string, unknown> | null;
}

export async function getOrderInvoice(
  orderId: string,
): Promise<ApiResponse<OrderInvoiceData>> {
  return apiFetch<OrderInvoiceData>(`/ecommerce/orders/${orderId}/invoice`);
}

/** Customer boutique réconcilié à un lead (ou null si aucun / module off). */
export async function getLinkedCustomerForLead(
  leadId: string,
): Promise<ApiResponse<{ id: string; email: string; first_name: string; last_name: string } | null>> {
  return apiFetch<{ id: string; email: string; first_name: string; last_name: string } | null>(
    `/leads/${leadId}/linked-customer`,
  );
}

export async function patchModule(
  module: ModuleId,
  enabled: boolean,
): Promise<ApiResponse<{ clientId: string; active: ModuleId[] }>> {
  return apiFetch<{ clientId: string; active: ModuleId[] }>('/modules', {
    method: 'PATCH',
    body: JSON.stringify({ module, enabled }),
  });
}

// ── E-commerce catalogue (produits / variantes / catégories / stock) — Sprint E2 M3 ──
// Frontend helpers vers les endpoints M1/M2 (gated requireModule + multi-tenant côté worker).

export interface LowStockRow {
  variant_id: string;
  quantity: number;
  reserved: number;
  available: number;
  low_stock_threshold: number;
  location: string | null;
  sku: string | null;
  variant_title: string;
  product_id: string;
  product_title: string;
}

export async function getEcommerceProduct(id: string): Promise<ApiResponse<Product>> {
  return apiFetch<Product>(`/ecommerce/products/${id}`);
}

export async function createEcommerceProduct(
  body: Partial<Product>,
): Promise<ApiResponse<{ id: string; slug?: string }>> {
  return apiFetch<{ id: string; slug?: string }>('/ecommerce/products', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateEcommerceProduct(
  id: string, body: Partial<Product>,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>(`/ecommerce/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteEcommerceProduct(id: string): Promise<ApiResponse<unknown>> {
  return apiFetch(`/ecommerce/products/${id}`, { method: 'DELETE' });
}

export async function getEcommerceVariants(
  productId: string,
): Promise<ApiResponse<ProductVariant[]>> {
  return apiFetch<ProductVariant[]>(`/ecommerce/products/${productId}/variants`);
}

export async function createEcommerceVariant(
  productId: string, body: Partial<ProductVariant>,
): Promise<ApiResponse<{ id: string; success?: boolean }>> {
  return apiFetch<{ id: string; success?: boolean }>(
    `/ecommerce/products/${productId}/variants`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export async function updateEcommerceVariant(
  productId: string, variantId: string, body: Partial<ProductVariant>,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>(
    `/ecommerce/products/${productId}/variants/${variantId}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}

export async function deleteEcommerceVariant(
  productId: string, variantId: string,
): Promise<ApiResponse<unknown>> {
  return apiFetch(
    `/ecommerce/products/${productId}/variants/${variantId}`,
    { method: 'DELETE' },
  );
}

export async function getEcommerceCategories(): Promise<ApiResponse<ProductCategory[]>> {
  return apiFetch<ProductCategory[]>('/ecommerce/categories');
}

export async function createEcommerceCategory(
  body: Partial<ProductCategory>,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/ecommerce/categories', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateEcommerceCategory(
  id: string, body: Partial<ProductCategory>,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>(`/ecommerce/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteEcommerceCategory(id: string): Promise<ApiResponse<unknown>> {
  return apiFetch(`/ecommerce/categories/${id}`, { method: 'DELETE' });
}

export async function setProductCategories(
  productId: string, categoryIds: string[],
): Promise<ApiResponse<unknown>> {
  return apiFetch(`/ecommerce/products/${productId}/categories`, {
    method: 'PUT',
    body: JSON.stringify({ category_ids: categoryIds }),
  });
}

export async function addProductImage(
  productId: string, body: Partial<ProductImage>,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>(`/ecommerce/products/${productId}/images`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function setPrimaryProductImage(
  productId: string, imageId: string,
): Promise<ApiResponse<unknown>> {
  return apiFetch(
    `/ecommerce/products/${productId}/images/${imageId}/primary`,
    { method: 'PUT' },
  );
}

export async function getVariantInventory(
  variantId: string,
): Promise<ApiResponse<InventoryRecord>> {
  return apiFetch<InventoryRecord>(`/ecommerce/variants/${variantId}/inventory`);
}

export async function setVariantInventory(
  variantId: string,
  body: Partial<Pick<InventoryRecord,
    'quantity' | 'low_stock_threshold' | 'track_inventory' | 'allow_backorder' | 'location'>> & {
      location_stocks?: Array<{ location_id: string; quantity: number }>;
    },
): Promise<ApiResponse<InventoryRecord>> {
  return apiFetch<InventoryRecord>(
    `/ecommerce/variants/${variantId}/inventory`,
    { method: 'PUT', body: JSON.stringify(body) },
  );
}

export async function getLowStock(): Promise<PagedResponse<LowStockRow>> {
  return apiFetch<LowStockRow[]>('/ecommerce/inventory/low-stock');
}

// ── Sprint 4 — Coupons/promos + Abonnements produit ──────────
// Helpers + types FIGÉS additifs (docs/LOT-ECOM4.md §6.A). apiFetch /
// ApiResponse INCHANGÉS (jamais de champ `code`). Gating requireModule
// + multi-tenant côté worker. Backend = STUBS Phase A (corps Phase B/C).

export interface Coupon {
  id: string;
  client_id?: string;
  code: string;
  // Legacy seq 18 (conservées) : montant/pourcentage historiques.
  discount_amount?: number | null;
  discount_percent?: number | null;
  // Enrichissement seq 85 (ALTER additif).
  discount_type?: string | null;
  min_order_cents?: number | null;
  starts_at?: string | null;
  expires_at?: string | null;
  usage_limit?: number | null;
  times_used?: number | null;
  is_active?: number | null;
  currency?: string | null;
  agency_id?: string | null;
  created_at?: string;
}

export interface CouponInput {
  code: string;
  discount_type?: string;
  discount_amount?: number | null;
  discount_percent?: number | null;
  min_order_cents?: number;
  starts_at?: string | null;
  expires_at?: string | null;
  usage_limit?: number | null;
  is_active?: number;
  currency?: string | null;
}

export interface CouponValidation {
  valid: boolean;
  discount_cents: number;
  code?: string;
  reason?: string;
}

export async function getEcommerceCoupons(params?: {
  limit?: number;
  offset?: number;
}): Promise<PagedResponse<Coupon>> {
  const sp = new URLSearchParams();
  if (params?.limit != null) sp.set('limit', String(params.limit));
  if (params?.offset != null) sp.set('offset', String(params.offset));
  const qs = sp.toString();
  return apiFetch<Coupon[]>(`/ecommerce/coupons${qs ? `?${qs}` : ''}`);
}

export async function getEcommerceCoupon(id: string): Promise<ApiResponse<Coupon>> {
  return apiFetch<Coupon>(`/ecommerce/coupons/${id}`);
}

export async function createEcommerceCoupon(
  payload: CouponInput,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/ecommerce/coupons', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateEcommerceCoupon(
  id: string,
  payload: Partial<CouponInput>,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>(`/ecommerce/coupons/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteEcommerceCoupon(
  id: string,
): Promise<ApiResponse<unknown>> {
  return apiFetch(`/ecommerce/coupons/${id}`, { method: 'DELETE' });
}

export async function validateCoupon(payload: {
  code: string;
  subtotal_cents?: number;
  currency?: string;
}): Promise<ApiResponse<CouponValidation>> {
  return apiFetch<CouponValidation>('/ecommerce/coupons/validate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface PromoCode {
  id: string;
  client_id?: string;
  code: string;
  discount_type: string;
  value: number;
  starts_at?: string | null;
  expires_at?: string | null;
  max_uses?: number | null;
  current_uses?: number;
  rules_json?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PromoCodeInput {
  code: string;
  discount_type: string;
  value: number;
  starts_at?: string | null;
  expires_at?: string | null;
  max_uses?: number | null;
  rules_json?: string;
}

export async function getEcommercePromoCodes(params?: {
  limit?: number;
  offset?: number;
}): Promise<PagedResponse<PromoCode>> {
  const sp = new URLSearchParams();
  if (params?.limit != null) sp.set('limit', String(params.limit));
  if (params?.offset != null) sp.set('offset', String(params.offset));
  const qs = sp.toString();
  return apiFetch<PromoCode[]>(`/ecommerce/promo-codes${qs ? `?${qs}` : ''}`);
}

export async function getEcommercePromoCode(id: string): Promise<ApiResponse<PromoCode>> {
  return apiFetch<PromoCode>(`/ecommerce/promo-codes/${id}`);
}

export async function createEcommercePromoCode(
  payload: PromoCodeInput,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/ecommerce/promo-codes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateEcommercePromoCode(
  id: string,
  payload: Partial<PromoCodeInput>,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>(`/ecommerce/promo-codes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteEcommercePromoCode(
  id: string,
): Promise<ApiResponse<unknown>> {
  return apiFetch(`/ecommerce/promo-codes/${id}`, { method: 'DELETE' });
}

export interface ProductSubscription {
  id: string;
  client_id?: string;
  agency_id?: string | null;
  customer_id?: string | null;
  variant_id?: string | null;
  quantity: number;
  interval_unit: string;
  interval_count: number;
  unit_price_cents: number;
  currency: string;
  status: string;
  next_run_at?: string | null;
  last_run_at?: string | null;
  cycles_completed: number;
  created_at?: string;
  updated_at?: string;
}

export interface ProductSubscriptionInput {
  customer_id?: string | null;
  variant_id: string;
  quantity?: number;
  interval_unit?: string;
  interval_count?: number;
  unit_price_cents?: number;
  currency?: string;
}

export async function getEcommerceSubscriptions(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<PagedResponse<ProductSubscription>> {
  const sp = new URLSearchParams();
  if (params?.status) sp.set('status', params.status);
  if (params?.limit != null) sp.set('limit', String(params.limit));
  if (params?.offset != null) sp.set('offset', String(params.offset));
  const qs = sp.toString();
  return apiFetch<ProductSubscription[]>(
    `/ecommerce/subscriptions${qs ? `?${qs}` : ''}`,
  );
}

export async function getEcommerceSubscription(
  id: string,
): Promise<ApiResponse<ProductSubscription>> {
  return apiFetch<ProductSubscription>(`/ecommerce/subscriptions/${id}`);
}

export async function createEcommerceSubscription(
  payload: ProductSubscriptionInput,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/ecommerce/subscriptions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateEcommerceSubscription(
  id: string,
  payload: Partial<ProductSubscriptionInput> & { status?: string },
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>(`/ecommerce/subscriptions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteEcommerceSubscription(
  id: string,
): Promise<ApiResponse<unknown>> {
  return apiFetch(`/ecommerce/subscriptions/${id}`, { method: 'DELETE' });
}

export async function runDueSubscriptions(): Promise<
  ApiResponse<{ processed: number; orders: unknown[] }>
> {
  return apiFetch('/ecommerce/subscriptions/run-due', { method: 'POST' });
}

// ── Leads ───────────────────────────────────────────────────

// ── LOT RÉEL (Manager B) — pagination curseur opt-in additive ───────────────
// Contrat figé docs/LOT-REEL.md §6.A B.1 :
//   - `limit`/`cursor` ABSENTS → comportement ACTUEL byte-identique (aucun
//     `?limit`/`?cursor` dans l'URL, `.data` inchangé). Rétro-compat absolue :
//     les appelants existants (Dashboard/Reports/Documents/Clients/Sidebar/
//     AppLayout/CommandPalette/OnboardingProgressChip) n'envoient pas ces
//     params et ne lisent que `.data` → strictement inchangés.
//   - `limit`/`cursor` présents → transmis tels quels au backend curseur
//     `handleGetLeads` (worker/leads.ts, FIGÉ). `next_cursor` se lit du JSON
//     brut (champ additif) ; `null`/absent ⇒ plus de page.
//   ⚠ NE PAS confondre avec `getClientLeads`/`PaginatedLeadsResponse` (S9,
//     offset-based, contrat distinct figé).
export async function getLeads(params?: {
  status?: string;
  search?: string;
  source?: string;
  client_id?: string;
  tag?: string;
  sort?: string;
  language?: string;     // Sprint MULTILANG-B — émis en ?language= uniquement si défini
  limit?: number;        // NOUVEAU — émis en ?limit= uniquement si défini
  cursor?: string;       // NOUVEAU — émis en ?cursor= uniquement si défini
}): Promise<ApiResponse<Lead[]> & { next_cursor?: string | null }> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.search) searchParams.set('search', params.search);
  if (params?.source) searchParams.set('source', params.source);
  if (params?.client_id) searchParams.set('client_id', params.client_id);
  if (params?.tag) searchParams.set('tag', params.tag);
  if (params?.sort) searchParams.set('sort', params.sort);
  if (params?.language) searchParams.set('language', params.language);
  // Additif : on n'émet limit/cursor QUE s'ils sont fournis explicitement.
  // Absents → URL historique → réponse `{ data }` byte-identique.
  if (params?.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params?.cursor !== undefined) searchParams.set('cursor', params.cursor);
  const qs = searchParams.toString();
  // apiFetch renvoie le JSON brut typé : `.data` toujours lu (rétro-compat),
  // `next_cursor` traverse et est typé optionnel additif.
  const result = await apiFetch<Lead[]>(`/leads${qs ? `?${qs}` : ''}`) as
    ApiResponse<Lead[]> & { next_cursor?: string | null };
  // Fallback mock data en dev quand le worker n'est pas joignable.
  // Pas de pagination sur le mock dev (acceptable, contrat §6.A B.1).
  if (!result.data && IS_DEV_BYPASS) {
    let filtered = [...MOCK_LEADS];
    if (params?.status) filtered = filtered.filter(l => l.status === params.status);
    if (params?.source) filtered = filtered.filter(l => l.source === params.source);
    if (params?.client_id) filtered = filtered.filter(l => l.client_id === params.client_id);
    if (params?.search) {
      const q = params.search.toLowerCase();
      filtered = filtered.filter(l => l.name.toLowerCase().includes(q) || l.email.toLowerCase().includes(q));
    }
    return { data: filtered };
  }
  return result;
}

// ── LOT RÉEL (Manager B) — statut mode IA (mock vs réel) ────────────────────
// Contrat figé docs/LOT-REEL.md §6.A B.2 : GET /api/health, lit `.ai_mock`
// (champ additif snake_case ajouté par Manager A dans worker/health.ts).
// Défaut prudent : réponse KO / champ absent ⇒ { ai_mock: false } (on
// n'affiche PAS la bannière démo si on ne sait pas).
export async function getAiStatus(): Promise<{ ai_mock: boolean }> {
  const result = await apiFetch<unknown>('/health') as
    ApiResponse<unknown> & { ai_mock?: unknown };
  return { ai_mock: result.ai_mock === true };
}

// ── Sprint S9 (Manager C) — pagination opt-in additive ──────
// Contrat figé docs/PERF-S9.md §6.2 / §7.1 :
//   - `limit`/`offset` ABSENTS → réponse historique `{ data: Lead[] }`
//     byte-identique (PAS de total/limit/offset). Rétro-compat absolue :
//     le seul appelant existant (ClientLeads.tsx) ne lit que `.data`.
//   - `limit`/`offset` présents → le worker renvoie aussi `total/limit/offset`
//     dans le JSON brut. Le type de retour de base reste `ApiResponse<Lead[]>`
//     (lecture `.data` inchangée) ; les champs additifs sont exposés via la
//     variante typée optionnelle `PaginatedLeadsResponse` pour les appelants
//     qui en ont besoin, SANS casser le contrat `.data` par défaut.
export interface PaginatedLeadsResponse extends ApiResponse<Lead[]> {
  /** Total filtré (présent uniquement si limit/offset envoyés). */
  total?: number;
  /** Limit effective appliquée par le worker (clampée [1..200]). */
  limit?: number;
  /** Offset effectif appliqué par le worker (>= 0). */
  offset?: number;
}

export async function getClientLeads(clientId: string, params?: {
  status?: string;
  type?: string;
  search?: string;
  language?: string; // Sprint MULTILANG-B — émis en ?language= uniquement si défini
  limit?: number;
  offset?: number;
}): Promise<PaginatedLeadsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.type) searchParams.set('type', params.type);
  if (params?.search) searchParams.set('search', params.search);
  if (params?.language) searchParams.set('language', params.language);
  // Additif : on n'émet limit/offset QUE s'ils sont fournis explicitement.
  // Absents → query historique → réponse `{ data }` seule (byte-identique).
  if (params?.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params?.offset !== undefined) searchParams.set('offset', String(params.offset));
  const qs = searchParams.toString();
  // apiFetch renvoie le JSON brut typé : `data` toujours lu par défaut
  // (rétro-compat), `total/limit/offset` traversent et sont typés optionnels.
  return apiFetch<Lead[]>(`/clients/${clientId}/leads${qs ? `?${qs}` : ''}`) as Promise<PaginatedLeadsResponse>;
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
    // Sprint MULTILANG-B — langue préférée (additif optionnel). Valeur '' OU
    // hors-liste ⇒ le worker remet NULL (= défaut tenant).
    preferred_language?: string;
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

// ── LOT B / S-B2 — Recherche globale serveur ────────────────
// Consomme GET /api/search (Manager A, contrat §6.1). Le front lit `.data`.
// Rétro-compat : ApiResponse<T> standard, ne touche AUCUNE fn existante.

export interface GlobalSearchResult {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  url: string;
}

export async function globalSearch(
  q: string,
  opts?: { limit?: number; types?: string[] },
): Promise<ApiResponse<{ results: GlobalSearchResult[]; total: number }>> {
  const params = new URLSearchParams();
  params.set('q', q);
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.types && opts.types.length > 0) params.set('types', opts.types.join(','));
  return apiFetch<{ results: GlobalSearchResult[]; total: number }>(
    `/search?${params.toString()}`,
  );
}

// ── LOT B / S-B2 — Export CSV configurable (admin-only) ──────
// Déclenche le téléchargement du CSV configurable. Route dispatch worker.ts
// (GET /api/exports/configurable) à câbler côté Manager A/coordinateur worker
// — voir note handoff. Pattern aligné sur exportLeadsCsv ci-dessus.

export async function exportConfigurableCsv(
  entity: 'leads' | 'orders' | 'conversations',
  columns?: string[],
): Promise<void> {
  const searchParams = new URLSearchParams();
  searchParams.set('entity', entity);
  if (columns && columns.length > 0) searchParams.set('columns', columns.join(','));

  const token = getToken();
  const response = await fetch(
    `${API_BASE}/exports/configurable?${searchParams.toString()}`,
    { headers: token ? { 'Authorization': `Bearer ${token}` } : {} },
  );

  if (!response.ok) return;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${entity}-intralys-${new Date().toISOString().slice(0, 10)}.csv`;
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
  message: { body: string; subject?: string; channel?: string; scheduledAt?: string }
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

// ── Sprint 4 (LOT AUTOMATION BUILDER seq 105) — helpers ADDITIFS FIGÉS Phase A
// (Manager-A). Signatures EXACTES ; Phase B câble les routes, Phase C consomme.
// Forme {data}/{error}. Corps serveur des handlers = Phase B. Voir
// docs/LOT-AUTOMATION-BUILDER.md §6.A / §6.E.

// Journal d'exécution d'un workflow (LECTURE de workflow_execution_log via
// jointure enrollment → onglet analytics drop-off/conversion + timeline).
export async function getWorkflowExecLog(
  workflowId: string
): Promise<ApiResponse<ExecLogEntry[]>> {
  return apiFetch<ExecLogEntry[]>(`/workflows/${workflowId}/exec-log`);
}

// Historique automation d'un lead (toutes ses exécutions, tous workflows
// confondus — lecture par lead_id ADDITIF seq 105).
export async function getLeadAutomationHistory(
  leadId: string
): Promise<ApiResponse<ExecLogEntry[]>> {
  return apiFetch<ExecLogEntry[]>(`/leads/${leadId}/automation-history`);
}

// Simulation read-only d'un workflow (parcours des steps SANS effet de bord).
// `payload` = contexte de simulation (ex { lead_id?, fields? }) — forme libre
// côté front, interprétée par le handler Phase B.
export async function simulateWorkflow(
  workflowId: string,
  payload: Record<string, unknown>
): Promise<ApiResponse<WorkflowSimulationResult>> {
  return apiFetch<WorkflowSimulationResult>(`/workflows/${workflowId}/simulate`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// Galerie de modèles d'automation (catalogue serveur WORKFLOW_TEMPLATES).
export async function getWorkflowTemplates(): Promise<ApiResponse<WorkflowTemplate[]>> {
  return apiFetch<WorkflowTemplate[]>('/workflow-templates');
}

// Instancie un workflow à partir d'un modèle (persiste template_key seq 105).
export async function createWorkflowFromTemplate(
  key: string
): Promise<ApiResponse<{ id: string; success: boolean }>> {
  return apiFetch<{ id: string; success: boolean }>('/workflows/from-template', {
    method: 'POST',
    body: JSON.stringify({ template_key: key }),
  });
}

// ── Sprint 5 : Séquences drip (= workflows is_sequence=1, moteur EXISTANT
// réutilisé). Helpers FIGÉS Phase A ; corps serveur Phase B (sequences.ts).
// Réutilise les types Workflow / WorkflowStep / WorkflowEnrollment.

export async function getSequences(): Promise<ApiResponse<Workflow[]>> {
  return apiFetch<Workflow[]>('/sequences');
}

export async function getSequence(
  id: string
): Promise<ApiResponse<Workflow & { steps: WorkflowStep[]; enrollments: WorkflowEnrollment[] }>> {
  return apiFetch<Workflow & { steps: WorkflowStep[]; enrollments: WorkflowEnrollment[] }>(`/sequences/${id}`);
}

// Sprint 2 — Sequence Analytics : stats d'engagement agrégées (lecture pure).
// FIGÉ Phase A ; corps serveur Phase B (sequences.ts handleGetSequenceStats).
export async function getSequenceStats(id: string): Promise<ApiResponse<SequenceStats>> {
  return apiFetch<SequenceStats>(`/sequences/${id}/stats`);
}

export async function createSequence(
  sequence: Partial<Workflow> & { steps?: Partial<WorkflowStep>[] }
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/sequences', {
    method: 'POST',
    body: JSON.stringify(sequence),
  });
}

export async function updateSequence(
  id: string,
  updates: Partial<Workflow> & { steps?: Partial<WorkflowStep>[] }
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/sequences/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function deleteSequence(
  id: string
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/sequences/${id}`, {
    method: 'DELETE',
  });
}

export async function enrollInSequence(
  sequenceId: string,
  leadId: string
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>(`/sequences/${sequenceId}/enroll`, {
    method: 'POST',
    body: JSON.stringify({ lead_id: leadId }),
  });
}

// ── LOT G6 : Segments de leads dynamiques + A/B testing campagnes ───────────
// Helpers FIGÉS Phase A ; corps serveur Phase B (segments.ts / broadcast.ts).
// Segment = audience recompute-on-read (criteria_json). Critères v1 AND-only.

// Critères de segment v1 — combinateur AND strict (OR = v2). Tous optionnels.
export interface SegmentCriteria {
  status?: string[];
  source?: string[];
  // Sprint MULTILANG-B — langue préférée du lead (leads.preferred_language) : IN (...).
  preferred_language?: string[];
  // Score sur leads.score (colonne directe) : opérateur + valeur.
  score?: { op: 'gte' | 'lte' | 'eq'; value: number };
  tags_in?: string[];
  tags_not_in?: string[];
  created_after?: string;
  created_before?: string;
  last_activity_after?: string;
  last_activity_before?: string;
  // Comportemental : EXISTS messages JOIN message_events (open/click) sur un
  // broadcast donné, dans une fenêtre `within_days`. `negate` ⇒ not_opened /
  // not_clicked (NOT EXISTS).
  opened_campaign?: { broadcast_id: string; within_days?: number; negate?: boolean };
  clicked_campaign?: { broadcast_id: string; within_days?: number; negate?: boolean };
  // Lead actuellement enrôlé dans une séquence/workflow (EXISTS
  // workflow_enrollments active). `false` ⇒ NOT EXISTS.
  in_sequence?: boolean;
}

export interface LeadSegment {
  id: string;
  client_id?: string | null;
  agency_id?: string | null;
  name: string;
  criteria_json?: string;
  criteria?: SegmentCriteria;
  cached_count?: number;
  cached_at?: string | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface BroadcastVariant {
  id?: string;
  broadcast_id?: string;
  label?: string;
  subject?: string;
  template_id?: string | null;
  body_html?: string;
  body_text?: string;
  split_pct: number;
  sent?: number;
  opened?: number;
  clicked?: number;
  created_at?: string;
}

export async function getSegments(): Promise<ApiResponse<LeadSegment[]>> {
  return apiFetch<LeadSegment[]>('/segments');
}

export async function getSegment(id: string): Promise<ApiResponse<LeadSegment>> {
  return apiFetch<LeadSegment>(`/segments/${id}`);
}

export async function createSegment(params: {
  name: string;
  criteria: SegmentCriteria;
  client_id?: string;
}): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/segments', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function updateSegment(
  id: string,
  updates: { name?: string; criteria?: SegmentCriteria }
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/segments/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function deleteSegment(id: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/segments/${id}`, { method: 'DELETE' });
}

// Aperçu live (count + échantillon) SANS persister le segment.
export async function previewSegment(
  criteria: SegmentCriteria,
  client_id?: string
): Promise<ApiResponse<{ count: number; sample?: Array<Record<string, unknown>> }>> {
  return apiFetch<{ count: number; sample?: Array<Record<string, unknown>> }>(
    '/segments/preview',
    { method: 'POST', body: JSON.stringify({ criteria, client_id }) }
  );
}

// Enrôle EN MASSE les leads du segment dans un workflow (réutilise le moteur
// workflows EXISTANT côté serveur).
export async function enrollSegment(
  id: string,
  workflow_id: string
): Promise<ApiResponse<{ enrolled: number }>> {
  return apiFetch<{ enrolled: number }>(`/segments/${id}/enroll`, {
    method: 'POST',
    body: JSON.stringify({ workflow_id }),
  });
}

export async function getBroadcastVariants(
  broadcastId: string
): Promise<ApiResponse<BroadcastVariant[]>> {
  return apiFetch<BroadcastVariant[]>(`/broadcasts/${broadcastId}/variants`);
}

export async function setBroadcastVariants(
  broadcastId: string,
  variants: BroadcastVariant[]
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/broadcasts/${broadcastId}/variants`, {
    method: 'POST',
    body: JSON.stringify({ variants }),
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

// Sprint 22 — Single task fetch pour TaskPanel
export async function getTask(taskId: string): Promise<ApiResponse<Task>> {
  return apiFetch<Task>(`/tasks/${taskId}`);
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

// ── LOT ATTRIBUTION-D — Attribution multi-touch & cohortes leads ─────────────
// Types calque SourceReport (ci-dessus). Lecture/agrégat, bornés tenant côté
// worker. HONNÊTETÉ : attribution multi-touch PROSPECTIVE (modèles convergents
// tant qu'1 touch/lead) ; cohortes RÉTROACTIVES (sur leads.created_at + statut).

/** Conversions attribuées par source, ventilées par modèle multi-touch. */
export interface AttributionReport {
  source: string;
  first: number;       // crédit modèle « premier touch »
  last: number;        // crédit modèle « dernier touch »
  linear: number;      // crédit modèle « linéaire » (réparti)
  time_decay: number;  // crédit modèle « décroissance temporelle »
}

/** Une cohorte de leads (mois d'acquisition 'YYYY-MM') + rétention/avancement
 *  mensuel [0..N] (% atteignant un statut avancé à M+i). retention[0] = 100. */
export interface LeadCohortRow {
  month: string;        // mois d'acquisition (leads.created_at) 'YYYY-MM'
  size: number;         // nb de leads acquis ce mois
  retention: number[];  // % avancés (contacted/qualified/won/closed) à M+i
}

export async function getReportsAttribution(
  model?: 'first' | 'last' | 'linear' | 'time_decay',
  days?: number,
): Promise<ApiResponse<{ models: Record<string, number>; by_source: AttributionReport[] }>> {
  const params = new URLSearchParams();
  if (model) params.set('model', model);
  if (days) params.set('days', String(days));
  return apiFetch<{ models: Record<string, number>; by_source: AttributionReport[] }>(
    `/reports/attribution?${params.toString()}`,
  );
}

export async function getLeadCohorts(): Promise<ApiResponse<{ cohorts: LeadCohortRow[] }>> {
  return apiFetch<{ cohorts: LeadCohortRow[] }>(`/reports/lead-cohorts`);
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
    // Sprint 5 — `tags` ENFIN appliqué côté serveur (Phase B corrige le
    // gap broadcast.ts:11 déclaré / :32-33 non appliqué). Garde
    // cross-tenant : client_id requis si tags fournis (broadcast.ts:25).
    tags?: string[];
  };
  // Sprint 5 — ADDITIFS, rétro-compat byte-identique : absent / null ⇒
  // envoi immédiat (legacy). throttle_per_min absent / 0 ⇒ pas de limite.
  scheduled_at?: string | null;
  throttle_per_min?: number;
  // LOT G6 — ADDITIFS, rétro-compat byte-identique : absents ⇒ comportement
  // Sprint 5 strictement identique. segment_id ⇒ ciblage par segment
  // réutilisable (le serveur résout segment_id→leads). variants ⇒ active l'A/B
  // (broadcasts.ab_test_enabled = 1, partition d'audience par split_pct).
  segment_id?: string;
  variants?: BroadcastVariant[];
  // LOT SMS/WHATSAPP seq 104 — ADDITIFS, rétro-compat byte : absents ⇒ broadcast
  // EMAIL legacy strictement identique (channel défaut 'email' côté serveur).
  // channel 'sms' ⇒ mass-send SMS (Phase B branche le path SMS dans
  // processBroadcastQueueJob). body_text défini plus haut sert aussi de corps
  // SMS quand channel='sms' (ignoré si email).
  channel?: 'email' | 'sms';
}): Promise<ApiResponse<BroadcastResult>> {
  return apiFetch<BroadcastResult>('/broadcast', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ── LOT SMS/WHATSAPP seq 104 — modèles SMS (CRUD) + config WhatsApp (FIGÉS A) ─
// Forme {data}/{error} via apiFetch (auth Bearer + X-Sub-Account injectés).
// Phase C les CONSOMME tels quels — AUCUN nouveau helper.

export async function getSmsTemplates(): Promise<ApiResponse<SmsTemplate[]>> {
  return apiFetch<SmsTemplate[]>('/sms-templates');
}

export async function createSmsTemplate(data: { name: string; body: string }): Promise<ApiResponse<{ id: string; success: boolean }>> {
  return apiFetch<{ id: string; success: boolean }>('/sms-templates', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateSmsTemplate(id: string, data: { name: string; body: string }): Promise<ApiResponse<{ id: string; success: boolean }>> {
  return apiFetch<{ id: string; success: boolean }>(`/sms-templates/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteSmsTemplate(id: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/sms-templates/${id}`, { method: 'DELETE' });
}

export async function getWhatsAppConnection(): Promise<ApiResponse<WhatsAppConnection | null>> {
  return apiFetch<WhatsAppConnection | null>('/integrations/whatsapp');
}

export async function saveWhatsAppConnection(data: { phone_number_id?: string; access_token?: string }): Promise<ApiResponse<{ id: string; status: string; success: boolean }>> {
  return apiFetch<{ id: string; status: string; success: boolean }>('/integrations/whatsapp', { method: 'POST', body: JSON.stringify(data) });
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

// ── LOT BOOKING — moteur de réservation client pro (Sprint 3) ───────────────
//
// Types + helpers FIGÉS Phase A (Manager-A SOLO). Signatures/typage NE
// CHANGENT PAS : booking-public.ts (corps Phase B) répond exactement ces
// formes ; PublicBooking.tsx / BookingSettings.tsx (corps Phase C) les
// consomment. `apiFetch` / `ApiResponse` GELÉS (§6.A) — jamais de champ
// `code`, discrimination string-match côté appelant.

/** Type de RDV (booking_event_types seq 84). price_cents POSÉ INACTIF. */
export interface BookingEventType {
  id: string;
  client_id?: string | null;
  agency_id?: string | null;
  booking_page_id?: string | null;
  name: string;
  description?: string | null;
  duration_minutes: number;
  buffer_before_min: number;
  buffer_after_min: number;
  /** POSÉ INACTIF — aucune logique de paiement (§6.B). */
  price_cents: number;
  slot_step_min: number;
  min_notice_min: number;
  /** seq 103 — minutes AVANT le RDV pour le rappel auto (0 = pas de rappel). */
  reminder_offset_min: number;
  /** seq 103 — canal du rappel : 'email' | 'sms' | 'both' | null. */
  reminder_channel: string | null;
  is_active: number;
  created_at?: string;
  updated_at?: string;
}

/** Créneau libre — ISO8601 UTC (sortie du moteur §6.C). */
export interface BookingSlot {
  start: string;
  end?: string;
}

/** Réservation publique confirmée (bookings seq 7 — status 'confirmed'). */
export interface PublicBooking {
  id: string;
  start_time: string;
  end_time: string;
  confirmation?: string;
  redirect_url?: string;
}

/**
 * Métadonnées publiques d'une booking page (Sprint 3-bis). Projection
 * minimale stricte — ZÉRO champ tenant sensible (pas de client_id/agency_id/
 * owner_user_id/price_cents). Permet au front d'afficher un sélecteur de type
 * de RDV et de re-localiser les créneaux dans le fuseau de la page.
 */
export interface PublicBookingMeta {
  page: {
    slug: string;
    name?: string | null;
    description?: string | null;
    timezone: string;
    confirmation_message?: string | null;
  };
  event_types: Array<{
    id: string;
    name?: string | null;
    description?: string | null;
    duration_minutes: number;
    buffer_before_min: number;
    buffer_after_min: number;
  }>;
}

// ── Public (fetch brut, sans auth — calque getPublicFunnel) ─────────────────

export async function getPublicBookingMeta(
  slug: string,
): Promise<ApiResponse<PublicBookingMeta>> {
  try {
    const res = await fetch(`${API_BASE}/book/${slug}/meta`);
    const data = (await res.json()) as ApiResponse<PublicBookingMeta>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function getBookingAvailability(
  slug: string,
  date: string,
  eventTypeId?: string,
): Promise<ApiResponse<{ slots: string[] }>> {
  try {
    const params = new URLSearchParams({ date });
    if (eventTypeId) params.set('event_type_id', eventTypeId);
    const res = await fetch(`${API_BASE}/book/${slug}/availability?${params.toString()}`);
    const data = (await res.json()) as ApiResponse<{ slots: string[] }>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function createPublicBooking(
  slug: string,
  payload: {
    event_type_id?: string;
    start_time: string;
    guest_name: string;
    guest_email: string;
    guest_phone?: string;
    notes?: string;
    data?: Record<string, unknown>;
  },
): Promise<ApiResponse<PublicBooking>> {
  try {
    const res = await fetch(`${API_BASE}/book/${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as ApiResponse<PublicBooking>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function cancelPublicBooking(
  slug: string,
  payload: { booking_id: string; reason?: string },
): Promise<ApiResponse<{ success: boolean }>> {
  try {
    const res = await fetch(`${API_BASE}/book/${slug}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as ApiResponse<{ success: boolean }>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function reschedulePublicBooking(
  slug: string,
  payload: { booking_id: string; start_time: string },
): Promise<ApiResponse<PublicBooking>> {
  try {
    const res = await fetch(`${API_BASE}/book/${slug}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as ApiResponse<PublicBooking>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

// ── Protégé (CRUD types de RDV — capability 'workflows.manage' côté worker) ──

export async function getBookingEventTypes(
  bookingPageId?: string,
): Promise<ApiResponse<BookingEventType[]>> {
  const params = new URLSearchParams();
  if (bookingPageId) params.set('booking_page_id', bookingPageId);
  const qs = params.toString();
  return apiFetch<BookingEventType[]>(`/booking-event-types${qs ? `?${qs}` : ''}`);
}

export async function createBookingEventType(
  data: Partial<BookingEventType>,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/booking-event-types', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateBookingEventType(
  id: string,
  updates: Partial<BookingEventType>,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/booking-event-types/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function deleteBookingEventType(
  id: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/booking-event-types/${id}`, {
    method: 'DELETE',
  });
}

/**
 * markNoShow — marque un booking 'no_show' (seq 7) + horodate no_show_at
 * (seq 103). PROTÉGÉ (capability 'workflows.manage' côté worker). Retour
 * `{ data } | { error }` — apiFetch GELÉ, jamais de champ `code` (§6.A).
 * POST /api/bookings/:id/no-show.
 */
export async function markNoShow(
  bookingId: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/bookings/${bookingId}/no-show`, {
    method: 'POST',
  });
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

// ── LOT FORMS XL (Sprint 5) — view-tracking + drop-off ─────────
// FIGÉS Phase A (signatures EXACTES, Manager-C les consomme tels quels, Manager-B
// câble les corps réels). Voir docs/LOT-FORMS-XL.md §6.A.
//
// trackFormView / logFormFieldEvent = endpoints PUBLICS (aucun auth) ⇒ fetch
// BRUT contre API_BASE, calque la soumission publique de PublicForm.tsx
// (`fetch('/api/form/submit', ...)`), PAS `apiFetch` (qui injecte le token).
export async function trackFormView(slug: string): Promise<{ success: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/form/${encodeURIComponent(slug)}/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const json = (await res.json().catch(() => null)) as { data?: { success?: boolean } } | null;
    return { success: !!json?.data?.success };
  } catch {
    // Best-effort : le tracking ne doit JAMAIS bloquer le rendu du formulaire.
    return { success: false };
  }
}

export async function logFormFieldEvent(
  slug: string,
  payload: { field_name: string; event: string; session_id?: string },
): Promise<{ success: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/form/${encodeURIComponent(slug)}/field-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => null)) as { data?: { success?: boolean } } | null;
    return { success: !!json?.data?.success };
  } catch {
    return { success: false };
  }
}

// getFormFieldAnalytics = endpoint PROTÉGÉ (admin) ⇒ apiFetch (token injecté).
export async function getFormFieldAnalytics(formId: string): Promise<ApiResponse<FormFieldAnalyticsRow[]>> {
  return apiFetch<FormFieldAnalyticsRow[]>(`/forms/${formId}/field-analytics`);
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

// ── Snapshots — voir Sprint 35 SaaS bundle exports plus bas (~ligne 7687+) ───

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

// ── LOT G9 — White-label custom domain (par sous-compte / tenant) ────────────
// apiFetch injecte auth + X-Sub-Account. Endpoints worker bornés tenant
// (assertClientInTenant) + garde settings.manage. ApiResponse INCHANGÉ.
export async function getCustomDomains(clientId: string): Promise<ApiResponse<CustomHostname[]>> {
  return apiFetch<CustomHostname[]>(`/clients/${clientId}/custom-domain`);
}

export async function addCustomDomain(clientId: string, hostname: string): Promise<ApiResponse<{ status: string }>> {
  return apiFetch<{ status: string }>(`/clients/${clientId}/custom-domain`, {
    method: 'POST', body: JSON.stringify({ hostname }),
  });
}

export async function deleteCustomDomain(clientId: string, hostId: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/clients/${clientId}/custom-domain/${hostId}`, { method: 'DELETE' });
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

// ── Google Business Profile — voir Sprint 32 plus bas (~ligne 7560+) ────────

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
  // ── Sprint 17 PROPOSALS E-SIGN (seq 117, ADDITIF) ──
  // Lien APPLICATIF vers le devis dont ce document est la proposition de
  // signature (null = signature classique seq 11). declined_at = horodatage
  // du refus public. Voir docs/LOT-PROPOSALS-ESIGN.md §6.B.
  quote_id?: string | null;
  declined_at?: string | null;
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

// ── LOT FACTURATION-RÉELLE — types + helpers (additif, ApiResponse GELÉ) ─────
// docs/LOT-INVOICE.md §6.A : réponses { data } / { error } uniquement, JAMAIS
// de champ `code`, discrimination front = string-match sur `error`.
// Les taxes (tax_tps/tax_tvq/total) sont CALCULÉES SERVEUR (§6.C) ; le front
// AFFICHE les champs stockés, il ne les invente JAMAIS. Rétro-compat legacy :
// une facture pré-seq-82 n'a que `amount` ⇒ lire `total ?? amount` (§6.I).

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  label: string;
  qty: number;
  unit_price: number;
  line_total: number;
  created_at?: string;
}

export interface Invoice {
  id: string;
  client_id: string;
  lead_id: string | null;
  lead_name?: string | null;
  amount: number;                 // legacy global (rétro-compat — fallback)
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'cancelled';
  // payment_url HONNÊTE (§6.E) : null = règlement hors-ligne (jamais d'URL
  // Stripe factice). E4/payments_live régulé NON activé.
  payment_url: string | null;
  description: string | null;
  // Colonnes seq 82 — nullable pour les factures legacy.
  invoice_number?: string | null;
  subtotal?: number | null;
  tax_tps?: number | null;
  tax_tvq?: number | null;
  total?: number | null;
  due_date?: string | null;
  quote_id?: string | null;
  tps_number?: string | null;
  tvq_number?: string | null;
  created_at: string;
  items?: InvoiceItem[];
}

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';

export interface QuoteItem {
  id: string;
  quote_id: string;
  label: string;
  qty: number;
  unit_price: number;
  line_total: number;
  created_at?: string;
}

export interface Quote {
  id: string;
  client_id: string | null;
  lead_id: string | null;
  agency_id?: string | null;
  quote_number: string | null;
  subtotal: number | null;
  tax_tps: number | null;
  tax_tvq: number | null;
  total: number | null;
  status: QuoteStatus;
  valid_until: string | null;
  accepted_at: string | null;
  invoice_id: string | null;       // facture liée après acceptation (§6.F)
  tps_number: string | null;
  tvq_number: string | null;
  description?: string | null;
  created_at: string;
  updated_at?: string;
  items?: QuoteItem[];
  // ── Sprint 17 PROPOSALS E-SIGN (seq 117, ADDITIF) ──
  // Lien RETOUR APPLICATIF vers le document de signature émis pour ce devis
  // (null = devis non encore envoyé pour signature). Voir
  // docs/LOT-PROPOSALS-ESIGN.md §6.B. ⚠ status reste QuoteStatus (CHECK seq 82
  // FIGÉ) : la signature passe le devis en 'accepted', le refus en 'declined'.
  document_id?: string | null;
}

// Lignes envoyées au serveur — le serveur recalcule line_total + taxes (§6.C).
export interface InvoiceLineInput { label: string; qty: number; unit_price: number }

// createInvoice ENRICHI : nom distinct `createInvoiceFull` pour NE PAS muter
// la signature de `createInvoice` (ci-dessus) déjà consommée par
// Invoices.tsx:69 (fichier Manager-C, Phase B). Écart vs brief assumé et
// documenté docs/LOT-INVOICE.md §6.D (CODE > brief : zéro rupture front).
export async function createInvoiceFull(data: {
  client_id?: string;
  lead_id?: string;
  description?: string;
  due_date?: string;
  items: InvoiceLineInput[];
}): Promise<ApiResponse<{ id: string; invoice_number?: string }>> {
  return apiFetch<{ id: string; invoice_number?: string }>('/invoices', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getInvoice(id: string): Promise<ApiResponse<Invoice>> {
  return apiFetch<Invoice>(`/invoices/${id}`);
}

export interface InvoicePdfData {
  invoice: Invoice;
  items: InvoiceItem[];
  // Entête émetteur + n° d'inscription (snapshot pièce, §6.C).
  issuer?: { name?: string; tps_number?: string | null; tvq_number?: string | null };
}

export async function getInvoicePdfData(id: string): Promise<ApiResponse<InvoicePdfData>> {
  return apiFetch<InvoicePdfData>(`/invoices/${id}/pdf-data`);
}

// ── Devis / soumission ──────────────────────────────────────
export async function createQuote(data: {
  client_id?: string;
  lead_id?: string;
  description?: string;
  valid_until?: string;
  items: InvoiceLineInput[];
}): Promise<ApiResponse<{ id: string; quote_number?: string }>> {
  return apiFetch<{ id: string; quote_number?: string }>('/quotes', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function listQuotes(): Promise<ApiResponse<Quote[]>> {
  return apiFetch<Quote[]>('/quotes');
}

export async function getQuote(id: string): Promise<ApiResponse<Quote>> {
  return apiFetch<Quote>(`/quotes/${id}`);
}

export async function updateQuote(
  id: string,
  patch: { status?: QuoteStatus; description?: string; valid_until?: string; items?: InvoiceLineInput[] },
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/quotes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

// Acceptation : devis → facture liée créée serveur (taxes recalculées),
// quotes.invoice_id renseigné, option lead → won (best-effort, §6.F).
export async function acceptQuote(
  id: string,
  opts?: { mark_lead_won?: boolean },
): Promise<ApiResponse<{ invoice_id: string }>> {
  return apiFetch<{ invoice_id: string }>(`/quotes/${id}/accept`, {
    method: 'POST',
    body: JSON.stringify(opts || {}),
  });
}

// ── Sprint 17 PROPOSALS E-SIGN — pont devis↔signature (FIGÉ Phase A) ────────
// docs/LOT-PROPOSALS-ESIGN.md §6.A. apiFetch/ApiResponse GELÉS : succès
// { data }, erreur { error }, JAMAIS de champ `code`. AUCUN client_id envoyé
// (tenant re-borné worker-side). RÉUTILISE l'e-signature existante (token +
// page publique /sign/:token + capture native Loi 25), zéro DocuSign.

// Envoie un devis chiffré pour signature : crée un document de signature lié au
// devis (quote_id), renvoie l'id du document + l'URL publique de signature.
// capGuard invoices.write côté worker. Corps réel = Manager-B (quotes.ts).
export async function sendQuoteForSignature(
  quoteId: string,
): Promise<ApiResponse<{ document_id: string; sign_url: string }>> {
  return apiFetch<{ document_id: string; sign_url: string }>(
    `/quotes/${quoteId}/send-for-signature`,
    { method: 'POST' },
  );
}

// Refus PUBLIC d'un document de signature (page publique, hors auth) — calque
// l'appel public de signature existant de SignDocument.tsx (apiFetch sur
// `/sign/:token`, qui cible le worker public /api/sign/:token). Si le document
// est lié à un devis, le worker répercute le refus sur le devis
// (status='declined', valeur DÉJÀ dans le CHECK seq 82). Corps réel =
// Manager-B (documents.ts).
export async function declinePublicDocument(
  token: string,
  payload?: { reason?: string },
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/sign/${token}/decline`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

// ── Sprint 18 CATALOGUE DE SERVICES — catalogue + sélecteur devis (FIGÉ Phase A)
// docs/LOT-CATALOG.md §6.A/§6.B. apiFetch/ApiResponse GELÉS : succès { data },
// erreur { error }, JAMAIS de champ `code`. AUCUN client_id envoyé (tenant
// re-borné worker-side). Catalogue de SERVICES utilisable SANS Boutique (routes
// sous requireAuth SEUL, PAS requireModule('ecommerce')). unit_price en DOLLARS
// (REAL, aligné quote_items seq 82, PAS cents) — l'import depuis products
// convertit /100 côté worker. Corps réels = Manager-B (src/worker/catalog.ts).

// Item de catalogue (service|produit). unit_price en DOLLARS (aligné devis).
export type CatalogKind = 'service' | 'product';

export interface CatalogItem {
  id: string;
  name: string;
  description?: string | null;
  kind: CatalogKind;             // service|product — gardé applicativement (pas de CHECK SQL)
  unit_price: number;            // DOLLARS REAL (aligné quote_items, PAS cents)
  currency?: string | null;
  category?: string | null;
  recurrence?: string | null;    // one_time|recurring — gardé applicativement
  is_active?: number | boolean;
  product_id?: string | null;    // lien faible → products (import), jointure applicative
}

// Charge attendue par create/update (le serveur borne le tenant ; pas de
// client_id/agency_id dans le body).
export interface CatalogItemInput {
  name: string;
  description?: string;
  kind?: CatalogKind;
  unit_price?: number;
  currency?: string;
  category?: string;
  recurrence?: string;
  is_active?: boolean;
}

// GET /api/catalog/items — liste bornée tenant. Filtres optionnels (kind,
// category, is_active) passés en query.
export async function listCatalogItems(
  params?: { kind?: CatalogKind; category?: string; is_active?: boolean },
): Promise<ApiResponse<CatalogItem[]>> {
  const qs = new URLSearchParams();
  if (params?.kind) qs.set('kind', params.kind);
  if (params?.category) qs.set('category', params.category);
  if (params?.is_active != null) qs.set('is_active', params.is_active ? '1' : '0');
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<CatalogItem[]>(`/catalog/items${suffix}`);
}

// POST /api/catalog/items — crée un item. capGuard invoices.write côté worker.
export async function createCatalogItem(
  payload: CatalogItemInput,
): Promise<ApiResponse<CatalogItem>> {
  return apiFetch<CatalogItem>('/catalog/items', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// PATCH /api/catalog/items/:id — met à jour un item. capGuard invoices.write.
export async function updateCatalogItem(
  id: string,
  payload: Partial<CatalogItemInput>,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/catalog/items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

// DELETE /api/catalog/items/:id — supprime (ou désactive) un item. capGuard
// invoices.write côté worker.
export async function deleteCatalogItem(
  id: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/catalog/items/${id}`, { method: 'DELETE' });
}

// GET /api/catalog/search?q= — recherche plein-texte légère (name + description),
// bornée tenant. Calque handleListProducts (search title+name) côté worker.
export async function searchCatalogItems(q: string): Promise<ApiResponse<CatalogItem[]>> {
  return apiFetch<CatalogItem[]>('/catalog/search?q=' + encodeURIComponent(q));
}

// POST /api/catalog/import-products — (optionnel) importe les produits de la
// Boutique dans le catalogue (lecture products, mapping cents→dollars /100).
// capGuard invoices.write côté worker. Corps réel = Manager-B.
export async function importCatalogFromProducts(): Promise<
  ApiResponse<{ imported: number }>
> {
  return apiFetch<{ imported: number }>('/catalog/import-products', { method: 'POST' });
}

// ── Agencies (P3.9) ─────────────────────────────────────────

export async function getAgencies(): Promise<ApiResponse<Array<Record<string, unknown>>>> {
  return apiFetch<Array<Record<string, unknown>>>('/agencies');
}

export async function createAgency(data: { name: string; custom_domain?: string }): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/agencies', { method: 'POST', body: JSON.stringify(data) });
}

// ── Sous-comptes agence (SaaS Lot 2, §6.9 / §6.11) ──────────

export interface AgencySubAccount {
  id: string;
  name: string;
  email: string | null;
  created_at: string;
  leadsCount: number;
  tasksCount: number;
}

// GET /api/agency/sub-accounts — 403 AGENCY_ONLY si non-agence (géré
// par apiFetch qui remonte l'erreur du body via { error }).
export async function getAgencySubAccounts(): Promise<ApiResponse<AgencySubAccount[]>> {
  return apiFetch<AgencySubAccount[]>('/agency/sub-accounts');
}

// POST /api/account/switch — §6.11 : 200 ⇒ persiste la clé puis le
// prochain apiFetch portera X-Sub-Account ; 403/400 ⇒ NE persiste PAS,
// retourne l'erreur telle quelle (UI affiche agencies.switch.error).
export async function switchSubAccount(
  id: string
): Promise<ApiResponse<{ activeSubAccount: string; agencyId: string | null; accessibleClientIds: string[] }>> {
  const res = await apiFetch<{ activeSubAccount: string; agencyId: string | null; accessibleClientIds: string[] }>(
    '/account/switch',
    { method: 'POST', body: JSON.stringify({ subAccountId: id }) }
  );
  if (!res.error && res.data) {
    setActiveSubAccount(id);
  }
  return res;
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

export type AiAction =
  | 'email_followup' | 'email_welcome' | 'sms_followup' | 'social_post'
  | 'objection_handler' | 'meeting_agenda' | 'proposal_intro' | 'recap_call'
  // Sprint 19 — actions inline pour AiSparkles (rewrite générique)
  | 'improve_text' | 'shorten' | 'formalize' | 'casualize';

export async function aiGenerate(params: {
  action: AiAction;
  context?: string;
  /** Sprint 19 — texte source à transformer pour les actions inline (improve_text, shorten, formalize, casualize) */
  text?: string;
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

// ── Sprint 20 : AI Summarize Conversation ──────────────────
export async function aiSummarizeConversation(conversationId: string): Promise<ApiResponse<{ summary: string[]; cached?: boolean }>> {
  return apiFetch<{ summary: string[]; cached?: boolean }>('/ai/summarize-conversation', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversationId }),
  });
}

// ── LOT G8 : AI Workspace conversationnel (assistant global cmd+/) ──────────
// JSON simple (PAS de streaming v1). Routes worker /api/ai/chat/* protégées
// (capability ai.use mode-agence-only DANS les handlers). ApiResponse INCHANGÉ.
// Le bornage tenant est imposé côté worker via l'AUTH (jamais via le body) —
// ces helpers n'envoient AUCUN client_id (FLAG sécurité #1).
export async function listAiThreads(): Promise<ApiResponse<AiChatThread[]>> {
  return apiFetch<AiChatThread[]>('/ai/chat/threads');
}

export async function createAiThread(): Promise<ApiResponse<AiChatThread>> {
  return apiFetch<AiChatThread>('/ai/chat/threads', { method: 'POST' });
}

export async function getAiThread(
  id: string,
): Promise<ApiResponse<{ thread: AiChatThread; messages: AiChatMessage[] }>> {
  return apiFetch<{ thread: AiChatThread; messages: AiChatMessage[] }>(
    `/ai/chat/threads/${id}`,
  );
}

export async function deleteAiThread(id: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/ai/chat/threads/${id}`, { method: 'DELETE' });
}

// SPRINT 11 (Copilot v2, ADDITIF) — `pageContext` optionnel : transporte le
// contexte de la page courante (route/entité) avec le message. Additif strict :
// les appels existants `sendAiMessage(threadId, content)` restent valides (3ᵉ
// argument omis ⇒ `page_context` absent du body ⇒ requête byte-identique à v1).
// Le worker RE-VALIDE + RE-BORNE ce contexte tenant-side ; le front n'envoie
// AUCUN client_id (FLAG sécurité cross-tenant).
export async function sendAiMessage(
  threadId: string,
  content: string,
  pageContext?: AiPageContext,
): Promise<ApiResponse<{ message: AiChatMessage }>> {
  return apiFetch<{ message: AiChatMessage }>(`/ai/chat/threads/${threadId}/message`, {
    method: 'POST',
    body: JSON.stringify(pageContext ? { content, page_context: pageContext } : { content }),
  });
}

// SPRINT 11 (Copilot v2, ADDITIF) — confirmation HUMAINE d'une action sûre
// proposée par l'assistant. L'UI appelle ce helper APRÈS un clic explicite
// « Exécuter » de l'utilisateur. Le worker valide `action_id` contre les
// propositions du thread, RE-BORNE le tenant via l'auth (jamais le body) et
// exécute via un handler MÉTIER EXISTANT (create_task/update_lead_status/
// add_lead_tag). ApiResponse INCHANGÉ — jamais de champ `code`.
export async function confirmAiAction(
  threadId: string,
  actionId: string,
): Promise<ApiResponse<{ executed: boolean; result?: string }>> {
  return apiFetch<{ executed: boolean; result?: string }>(
    `/ai/chat/threads/${threadId}/action`,
    {
      method: 'POST',
      body: JSON.stringify({ action_id: actionId }),
    },
  );
}

// ── Sprint 20 : AI Suggest Next Action ─────────────────────
export interface AiNextAction {
  action: 'email' | 'sms' | 'call';
  reason: string;
  draft: string;
}
export async function aiSuggestNextAction(leadId: string): Promise<ApiResponse<AiNextAction>> {
  return apiFetch<AiNextAction>('/ai/suggest-next-action', {
    method: 'POST',
    body: JSON.stringify({ lead_id: leadId }),
  });
}

// ── Sprint 21 : AI Batch Summarize Leads ───────────────────
export interface AiBatchLeadSummary {
  per_lead: Array<{ lead_id: string; name: string; summary: string }>;
  overview: string;
  stats: { total: number; hot: number; warm: number; cold: number; inactiveDays: number; totalDealValue: number };
}
export async function aiSummarizeLeads(leadIds: string[]): Promise<ApiResponse<AiBatchLeadSummary>> {
  return apiFetch<AiBatchLeadSummary>('/ai/summarize-leads', {
    method: 'POST',
    body: JSON.stringify({ lead_ids: leadIds }),
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

// ── Sprint 46 M1.3 — Dashboards builder ─────────────────────

export interface DashboardRecord {
  id: number;
  user_id: string;
  name: string;
  config: { widgets: any[]; cols?: number } | null;
  share_token: string | null;
  created_at: number;
  updated_at: number;
}

export async function getDashboards(): Promise<ApiResponse<DashboardRecord[]>> {
  return apiFetch<DashboardRecord[]>('/dashboards');
}

export async function getDashboard(id: number | string): Promise<ApiResponse<DashboardRecord>> {
  return apiFetch<DashboardRecord>(`/dashboards/${id}`);
}

export async function createDashboard(payload: { name: string; config: any }): Promise<ApiResponse<DashboardRecord>> {
  return apiFetch<DashboardRecord>('/dashboards', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateDashboard(id: number | string, payload: Partial<{ name: string; config: any }>): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/dashboards/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteDashboard(id: number | string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/dashboards/${id}`, {
    method: 'DELETE',
  });
}

export async function shareDashboard(id: number | string): Promise<ApiResponse<{ share_token: string; url: string }>> {
  return apiFetch<{ share_token: string; url: string }>(`/dashboards/${id}/share`, {
    method: 'POST',
  });
}

export async function getSharedDashboard(token: string): Promise<ApiResponse<{ id: number; name: string; config: any; updated_at: number }>> {
  return apiFetch<{ id: number; name: string; config: any; updated_at: number }>(`/dashboards/shared/${token}`);
}

// ── LOT SCHEDREPORT Sprint A — rapports d'activité planifiés ─────────────────
// Helpers ADDITIFS pour l'onglet "Planifiés" de Reports.tsx (Phase B Manager-C).
// CRUD borné tenant côté serveur (capability reports.view). `ApiResponse`
// INCHANGÉ (jamais `code` — gelé depuis LOT B Team). recipients = string[].
export interface ScheduledReportRecord {
  id: string;
  client_id: string | null;
  agency_id: string | null;
  name: string | null;
  dashboard_id: number | null;
  report_kind: string;
  cadence: 'weekly' | 'monthly' | string;
  day_of_week: number | null;
  day_of_month: number | null;
  recipients: string[];
  format: 'html' | string;
  last_sent_at: string | null;
  next_run_at: string | null;
  status: 'active' | 'paused' | string;
  created_at: string | null;
  updated_at: string | null;
}

export async function getScheduledReports(): Promise<ApiResponse<ScheduledReportRecord[]>> {
  return apiFetch<ScheduledReportRecord[]>('/scheduled-reports');
}

export async function createScheduledReport(payload: Partial<{
  name: string;
  dashboard_id: number | null;
  report_kind: string;
  cadence: string;
  day_of_week: number | null;
  day_of_month: number | null;
  recipients: string[];
  format: string;
}>): Promise<ApiResponse<{ id: string; next_run_at: string }>> {
  return apiFetch<{ id: string; next_run_at: string }>('/scheduled-reports', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateScheduledReport(
  id: string,
  patch: Partial<{
    name: string;
    dashboard_id: number | null;
    cadence: string;
    day_of_week: number | null;
    day_of_month: number | null;
    recipients: string[];
    format: string;
    status: 'active' | 'paused';
  }>,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>(`/scheduled-reports/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteScheduledReport(id: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/scheduled-reports/${id}`, {
    method: 'DELETE',
  });
}

// ── LOT D Reports Builder Hardening (2026-05-20) ─────────────
// Helpers ADDITIFS pour le wiring `_dashboardCharts.tsx` (Phase B
// Manager-C remplacera `sampleSeries(seed)` par `useWidgetData(widget)`,
// hook frontal qui appellera ce `runReportWidget`). UNE SEULE route serveur
// (anti-prolifération d'endpoints non-tenant-bornés) — voir
// docs/LOT-REPORTS-D.md §6.C/§6.D. Phase A SOLO = signature FIGÉE +
// stub serveur ; Phase B Manager-B branche le dispatcher réel ; Phase B
// Manager-C consomme via `useWidgetData`.
//
// `ApiResponse` INCHANGÉ (jamais `code` — gelé depuis LOT B Team).
// Discrimination capability côté front = string-match sur `error`.

export interface WidgetRunResult {
  series: Array<{ name: string; value: number }>;
  total: number;
  delta?: number;
}

export interface RunReportWidgetPayload {
  source: string;
  dimension: string;
  metric: string;
  filters?: Record<string, unknown>;
  dashboard_id?: number;
}

export async function runReportWidget(
  payload: RunReportWidgetPayload,
): Promise<ApiResponse<WidgetRunResult>> {
  return apiFetch<WidgetRunResult>('/reports/widget', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ── E-R region — Sprint E-R M3 (config régionale boutique) ──────────────────
// Bloc DISTINCT des blocs « E3 orders » / « E3 cart » (append-only, jamais
// mélangé). Le contrat (GET/PUT /api/ecommerce/region) est défini par M2 côté
// worker ; les types canoniques RegionConfig/TaxRegime/SupportedCurrency sont
// la propriété de M2 (types.ts). On code contre le contrat partagé : ces
// alias locaux restent compatibles si/quand M2 réexporte depuis types.ts.
export type SupportedCurrency = 'CAD' | 'EUR' | 'DZD';
export type TaxRegime = 'qc' | 'eu' | 'dz' | 'exempt';

export interface RegionConfig {
  region: string;             // 'QC' | 'EU' | 'DZ'
  country: string;            // code ISO ('CA', 'FR', 'DZ', …)
  currency: SupportedCurrency;
  tax_regime: TaxRegime;
  legal_flags: {
    loi25?: boolean;
    rgpd?: boolean;
    dz_conso?: boolean;
  };
}

export async function getEcommerceRegion(): Promise<ApiResponse<RegionConfig>> {
  return apiFetch<RegionConfig>('/ecommerce/region');
}

export async function updateEcommerceRegion(
  config: RegionConfig,
): Promise<ApiResponse<RegionConfig>> {
  return apiFetch<RegionConfig>('/ecommerce/region', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

// ── E4 payments — Sprint E4 M3 (paiement multi-provider e-commerce) ──────────
// ⚠️ ZONE RÉGULÉE — paiement marchand B2. Bloc DISTINCT des blocs « E3 orders »
// / « E3 cart » / « E-R region » (append-only, jamais mélangé). Contrat FIGÉ
// M1 : seul l'endpoint d'INIT est exposé côté worker
// (POST /api/ecommerce/orders/:id/payment). M1 N'EXPOSE PAS d'endpoint de
// configuration provider (lecture/écriture de payment_provider_config) : la
// page Réglages affiche donc l'état documenté du contrat (sandbox, flag live
// défaut OFF) en attendant cet endpoint (TODO E4+). On ne devine/forge AUCUNE
// route worker (file-ownership M3 strict).

/**
 * Initie le paiement d'une commande (contrat figé M1).
 * POST /api/ecommerce/orders/:id/payment  body { method }
 *   - Si `redirect_url` présent → l'UI redirige vers le checkout HÉBERGÉ du
 *     provider (aucune saisie carte dans notre UI — PCI).
 *   - Si COD → status 'pending_cod' (la commande reste impayée, encaissement
 *     hors-ligne à la livraison).
 * Idempotent côté worker (clé déterministe order+method+montant).
 */
export async function initOrderPayment(
  orderId: string,
  method: PaymentMethod | string,
): Promise<ApiResponse<PaymentInitResult>> {
  return apiFetch<PaymentInitResult>(
    `/ecommerce/orders/${orderId}/payment`,
    { method: 'POST', body: JSON.stringify({ method }) },
  );
}

/**
 * Configuration provider de paiement exposée à la page Réglages.
 *
 * ⚠️ M1 n'expose PAS encore d'endpoint GET/PUT pour `payment_provider_config`.
 * Pour respecter le file-ownership M3 (interdit de toucher worker/), on NE
 * forge AUCUNE route. `getPaymentConfig` renvoie donc l'état documenté du
 * contrat (mode sandbox, live OFF par défaut — flag de sûreté serveur), et
 * `updatePaymentConfig` est volontairement indisponible côté serveur tant que
 * l'endpoint n'est pas livré (TODO E4+) : l'UI doit le présenter comme
 * « configuré côté serveur » (clés = bindings serveur, jamais saisies ici).
 */
export interface PaymentProviderState {
  provider: 'stripe' | 'cod' | 'dz_gateway';
  /** Activé pour ce tenant (présentation — défaut piloté serveur). */
  enabled: boolean;
  /** 'test' = sandbox (défaut sûr) · 'live' = réel (revue conformité requise). */
  mode: 'test' | 'live';
}

export interface PaymentConfigState {
  /** ⚠️ Flag de sûreté serveur : false = sandbox (défaut). Lecture seule UI
   *  tant que l'endpoint de config M1 n'est pas livré. */
  payments_live_enabled: boolean;
  providers: PaymentProviderState[];
  /** true tant que M1 n'expose pas l'endpoint config (UI = lecture + TODO). */
  read_only: boolean;
}

/**
 * État de config paiement pour la page Réglages. Pas d'appel réseau : reflète
 * le contrat M1 documenté (sandbox / live OFF par défaut). À remplacer par un
 * GET réel quand M1 exposera l'endpoint (TODO E4+).
 */
export async function getPaymentConfig(): Promise<ApiResponse<PaymentConfigState>> {
  return Promise.resolve({
    data: {
      payments_live_enabled: false, // défaut sûr — aligné worker (défaut 0)
      read_only: true,
      providers: [
        { provider: 'stripe', enabled: true, mode: 'test' },
        { provider: 'cod', enabled: true, mode: 'test' },
        { provider: 'dz_gateway', enabled: true, mode: 'test' },
      ],
    },
  });
}

/**
 * Mise à jour de la config paiement. ⚠️ Indisponible : M1 n'expose pas
 * l'endpoint (file-ownership M3 interdit de toucher worker/). On renvoie une
 * erreur explicite plutôt que de forger une route. TODO E4+.
 */
export async function updatePaymentConfig(
  _next: Partial<PaymentConfigState>,
): Promise<ApiResponse<PaymentConfigState>> {
  return Promise.resolve({
    error:
      'La configuration des paiements se fait côté serveur (revue conformité requise).',
  });
}

/** Statut paiement → libellé i18n (clé). Aligné PaymentStatus figé. */
export function paymentStatusKey(s?: PaymentStatus | string): string {
  switch (s) {
    case 'pending': return 'shop.payment.st_pending';
    case 'pending_cod': return 'shop.payment.st_pending_cod';
    case 'authorized': return 'shop.payment.st_authorized';
    case 'paid': return 'shop.payment.st_paid';
    case 'failed': return 'shop.payment.st_failed';
    default: return 'shop.payment.st_unknown';
  }
}

// ── E5 M1 shipments ───────────────────────────────────────────────────────
// Helpers expéditions (gated requireModule + multi-tenant côté worker).
// Bloc DISTINCT des blocs E3/E-R/E4 ci-dessus (append-only). L'expédition est
// une trace pure : aucun effet stock client-side, fulfillment_status recalculé
// par le worker.

export interface CreateShipmentPayload {
  carrier?: string;
  tracking_number?: string;
  tracking_url?: string;
  items: Array<{ order_item_id: string; quantity: number }>;
  note?: string;
}

export async function getOrderShipments(
  orderId: string,
): Promise<ApiResponse<Shipment[]>> {
  return apiFetch<Shipment[]>(`/ecommerce/orders/${orderId}/shipments`);
}

export async function createShipment(
  orderId: string,
  payload: CreateShipmentPayload,
): Promise<ApiResponse<Shipment>> {
  return apiFetch<Shipment>(`/ecommerce/orders/${orderId}/shipments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getShipment(
  shipmentId: string,
): Promise<ApiResponse<Shipment>> {
  return apiFetch<Shipment>(`/ecommerce/shipments/${shipmentId}`);
}

export async function updateShipmentStatus(
  shipmentId: string,
  status: ShipmentStatus,
): Promise<ApiResponse<{ id: string; status: ShipmentStatus }>> {
  return apiFetch<{ id: string; status: ShipmentStatus }>(
    `/ecommerce/shipments/${shipmentId}/status`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
  );
}

/** Statut expédition → libellé i18n (clé). Aligné ShipmentStatus figé. */
export function shipmentStatusKey(s?: ShipmentStatus | string): string {
  switch (s) {
    case 'preparing': return 'shop.shipment.st_preparing';
    case 'shipped': return 'shop.shipment.st_shipped';
    case 'in_transit': return 'shop.shipment.st_in_transit';
    case 'delivered': return 'shop.shipment.st_delivered';
    case 'failed': return 'shop.shipment.st_failed';
    default: return 'shop.shipment.st_unknown';
  }
}

// ── E5 M2 zones ───────────────────────────────────────────────────────────
// Helpers client zones/tarifs d'expédition + résolution region-aware. Bloc
// DISTINCT des blocs E3/E-R/E4/E5-M1 ci-dessus (append-only, jamais mélangé).
// Mutations gated admin côté worker (ecommerce-shipping-zones). Types
// canoniques M1 (types.ts) — IMPORTÉS, jamais redéclarés ici.

export interface ShippingZonePayload {
  name: string;
  countries: string[];
}

export interface ShippingRatePayload {
  name: string;
  price_cents: number;
  min_subtotal_cents?: number | null;
  max_subtotal_cents?: number | null;
}

export interface ResolveShippingPayload {
  country?: string | null;
  weight_grams?: number | null;
  subtotal_cents?: number | null;
  currency?: string | null;
}

export async function listShippingZones(): Promise<ApiResponse<ShippingZone[]>> {
  return apiFetch<ShippingZone[]>('/ecommerce/shipping/zones');
}

export async function createShippingZone(
  payload: ShippingZonePayload,
): Promise<ApiResponse<ShippingZone>> {
  return apiFetch<ShippingZone>('/ecommerce/shipping/zones', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateShippingZone(
  zoneId: string,
  payload: Partial<ShippingZonePayload>,
): Promise<ApiResponse<ShippingZone>> {
  return apiFetch<ShippingZone>(`/ecommerce/shipping/zones/${zoneId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteShippingZone(
  zoneId: string,
): Promise<ApiResponse<{ id: string; deleted: boolean }>> {
  return apiFetch<{ id: string; deleted: boolean }>(
    `/ecommerce/shipping/zones/${zoneId}`,
    { method: 'DELETE' },
  );
}

export async function listShippingRates(
  zoneId: string,
): Promise<ApiResponse<ShippingRate[]>> {
  return apiFetch<ShippingRate[]>(`/ecommerce/shipping/zones/${zoneId}/rates`);
}

export async function createShippingRate(
  zoneId: string,
  payload: ShippingRatePayload,
): Promise<ApiResponse<ShippingRate>> {
  return apiFetch<ShippingRate>(`/ecommerce/shipping/zones/${zoneId}/rates`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateShippingRate(
  rateId: string,
  payload: Partial<ShippingRatePayload>,
): Promise<ApiResponse<ShippingRate>> {
  return apiFetch<ShippingRate>(`/ecommerce/shipping/rates/${rateId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteShippingRate(
  rateId: string,
): Promise<ApiResponse<{ id: string; deleted: boolean }>> {
  return apiFetch<{ id: string; deleted: boolean }>(
    `/ecommerce/shipping/rates/${rateId}`,
    { method: 'DELETE' },
  );
}

export async function resolveShippingRateApi(
  payload: ResolveShippingPayload,
): Promise<ApiResponse<ShippingRateResult>> {
  return apiFetch<ShippingRateResult>('/ecommerce/shipping/resolve', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ── E5 M3 ui ──────────────────────────────────────────────────────────────
// Helpers UI-only fulfillment (ShipmentPanel / Commandes). Bloc DISTINCT des
// blocs E3/E-R/E4/E5-M1/E5-M2 ci-dessus (append-only). Consomme les helpers
// M1 (shipments) et M2 (zones/tarifs) déjà publiés — n'en redéclare aucun.

/** Statut fulfillment commande → libellé i18n (clé). Aligné E1 (intouché). */
export function fulfillmentStatusKey(s?: string): string {
  switch (s) {
    case 'unfulfilled': return 'shop.order.ful_unfulfilled';
    case 'partial': return 'shop.order.ful_partial';
    case 'fulfilled': return 'shop.order.ful_fulfilled';
    default: return 'shop.order.ful_unfulfilled';
  }
}

// ── E6 M1 refunds ──────────────────────────────────────────────────────────
// ⚠️ ZONE RÉGULÉE — remboursement marchand B2. Bloc DISTINCT des blocs E3/E-R/
// E4/E5 ci-dessus (append-only, jamais mélangé). Contrat FIGÉ M1 : endpoints
// worker câblés par M2 (POST /ecommerce/orders/:id/refund + GET .../refunds).
// Inoffensif tant que payments_live_enabled=0 (Stripe forcé sk_test_ serveur).
// On ne devine/forge AUCUNE autre route (file-ownership strict).

/** Remboursement (vue client — réfs opaques uniquement, aucune donnée carte). */
export interface RefundRecord {
  id: string;
  order_id: string;
  payment_id: string;
  amount_cents: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed' | string;
  provider_ref: string | null;
  reason: string | null;
  restocked: boolean;
  created_at: string;
}

/**
 * Crée un remboursement (total ou partiel) pour une commande (contrat figé M1).
 * POST /api/ecommerce/orders/:id/refund
 *   body { amount_cents?, reason?, restock_items?: string[] }
 *   - `amount_cents` omis → remboursement TOTAL du solde remboursable restant.
 *   - `restock_items` → variantes à remettre en stock (idempotent, anti double).
 * Idempotent côté worker (clé déterministe refund:<order>:<amount>:<seq>).
 */
export async function createOrderRefund(
  orderId: string,
  payload: { amount_cents?: number; reason?: string; restock_items?: string[] } = {},
): Promise<ApiResponse<RefundRecord>> {
  return apiFetch<RefundRecord>(
    `/ecommerce/orders/${orderId}/refund`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

/** Liste les remboursements d'une commande (récents d'abord). */
export async function listOrderRefunds(
  orderId: string,
): Promise<ApiResponse<RefundRecord[]>> {
  return apiFetch<RefundRecord[]>(`/ecommerce/orders/${orderId}/refunds`);
}

/** Statut remboursement → libellé i18n (clé). M3 fournira les traductions. */
export function refundStatusKey(s?: string): string {
  switch (s) {
    case 'pending': return 'shop.refund.st_pending';
    case 'succeeded': return 'shop.refund.st_succeeded';
    case 'failed': return 'shop.refund.st_failed';
    default: return 'shop.refund.st_unknown';
  }
}

// ── E6 M3 policy ───────────────────────────────────────────────────────────
// ⚠️ ZONE RÉGULÉE — politique conso INDICATIVE + retours (RMA) + litiges.
// Bloc DISTINCT du bloc « E6 M1 refunds » ci-dessus (M3 ne le modifie PAS —
// il RÉUTILISE createOrderRefund/listOrderRefunds/refundStatusKey publiés par
// M1). Contrats FIGÉS : policy = TU exportes côté worker (handleGetOrderPolicy,
// câblé par M2) ; returns/disputes = endpoints M2 (GET/POST/PATCH). On code
// CONTRE le contrat et on DÉGRADE proprement si l'endpoint n'est pas encore
// câblé (M2 parallèle) : ApiResponse.error renvoyé sans throw. On ne forge
// AUCUNE autre route (file-ownership strict). Money en cents INTEGER.
// (Types ConsumerPolicy/ReturnRequest importés en tête de fichier — bloc E6
// types.ts, M3 seul writer.)

/**
 * GET /api/ecommerce/orders/:id/policy — politique de rétractation INDICATIVE.
 * ⚠️ RÉGULÉ : sortie purement informative (l'UI affiche la bannière « revue
 * légale requise »). Dégrade proprement si l'endpoint n'est pas encore câblé.
 */
export async function getOrderPolicy(
  orderId: string,
): Promise<ApiResponse<ConsumerPolicy>> {
  return apiFetch<ConsumerPolicy>(`/ecommerce/orders/${orderId}/policy`);
}

/** Vue litige (réfs opaques — aucune donnée carte). Endpoint M2 GET. */
export interface DisputeRecord {
  id: string;
  order_id: string;
  payment_id: string | null;
  provider: string;
  provider_dispute_ref: string;
  status: string;
  amount_cents: number;
  created_at: string;
  updated_at: string;
}

/** GET /api/ecommerce/disputes — litiges du tenant (récents d'abord, M2). */
export async function listDisputes(): Promise<ApiResponse<DisputeRecord[]>> {
  return apiFetch<DisputeRecord[]>('/ecommerce/disputes');
}

/**
 * GET /api/ecommerce/returns?order_id= — demandes de retour d'une commande
 * (M2). Dégrade proprement (liste vide via error) si pas encore câblé.
 */
export async function listOrderReturns(
  orderId: string,
): Promise<ApiResponse<ReturnRequest[]>> {
  return apiFetch<ReturnRequest[]>(
    `/ecommerce/returns?order_id=${encodeURIComponent(orderId)}`,
  );
}

/**
 * POST /api/ecommerce/returns — crée une demande de retour (RMA) (M2).
 * body { order_id, items:[{order_item_id,quantity}], reason }.
 */
export async function createOrderReturn(
  payload: {
    order_id: string;
    items: Array<{ order_item_id: string; quantity: number }>;
    reason?: string;
  },
): Promise<ApiResponse<ReturnRequest>> {
  return apiFetch<ReturnRequest>('/ecommerce/returns', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * PATCH /api/ecommerce/returns/:id — fait avancer le RMA (M2).
 * action ∈ 'approve' | 'receive' | 'reject'. Le remboursement n'est
 * déclenché QU'À la réception (anti-abus) côté worker M2.
 */
export async function updateOrderReturn(
  returnId: string,
  action: 'approve' | 'receive' | 'reject',
): Promise<ApiResponse<ReturnRequest>> {
  return apiFetch<ReturnRequest>(`/ecommerce/returns/${returnId}`, {
    method: 'PATCH',
    body: JSON.stringify({ action }),
  });
}

/** Statut RMA → libellé i18n (clé). Traductions M3 (4 catalogues). */
export function rmaStatusKey(s?: string): string {
  switch (s) {
    case 'pending': return 'shop.rma.st_pending';
    case 'approved': return 'shop.rma.st_approved';
    case 'received': return 'shop.rma.st_received';
    case 'refunded': return 'shop.rma.st_refunded';
    case 'rejected': return 'shop.rma.st_rejected';
    default: return 'shop.rma.st_unknown';
  }
}

/** Statut litige → libellé i18n (clé). Traductions M3 (4 catalogues). */
export function disputeStatusKey(s?: string): string {
  switch (s) {
    case 'open': return 'shop.dispute.st_open';
    case 'under_review': return 'shop.dispute.st_under_review';
    case 'won': return 'shop.dispute.st_won';
    case 'lost': return 'shop.dispute.st_lost';
    case 'refunded': return 'shop.dispute.st_refunded';
    default: return 'shop.dispute.st_unknown';
  }
}

// ── E7 M3 ────────────────────────────────────────────────────
// Customer 360 + RFM recompute + paniers abandonnés. Bloc DISTINCT
// des blocs E1-E6 ci-dessus (append-only, zéro redéclaration —
// leçon E6 : coordination par contrat figé M1/M2). Types importés
// de ./types (M1 = seul writer types E7). Endpoints gated worker
// (requireModule 'ecommerce' + multi-tenant), dégrade proprement
// si M2 (rfm/cart-recovery) pas encore branché côté worker.

/** GET /api/ecommerce/customers/:id/360 — agrégat Customer 360 (M1). */
export async function getCustomer360(
  customerId: string
): Promise<ApiResponse<Customer360>> {
  return apiFetch<Customer360>(`/ecommerce/customers/${customerId}/360`);
}

/** POST /api/ecommerce/customers/rfm/recompute — recalcul FULL RFM (M2). */
export async function recomputeRfm(): Promise<ApiResponse<{ updated: number }>> {
  return apiFetch<{ updated: number }>('/ecommerce/customers/rfm/recompute', {
    method: 'POST',
  });
}

/** GET /api/ecommerce/carts/abandoned — paniers abandonnés (M2). */
export async function getAbandonedCarts(): Promise<PagedResponse<AbandonedCart>> {
  return apiFetch<AbandonedCart[]>('/ecommerce/carts/abandoned');
}

/** POST /api/ecommerce/carts/:id/recover — déclenche la relance (M2). */
export async function recoverCart(
  cartId: string
): Promise<ApiResponse<{ recovered: boolean }>> {
  return apiFetch<{ recovered: boolean }>(
    `/ecommerce/carts/${cartId}/recover`,
    { method: 'POST' }
  );
}

// ── E8 channels ──────────────────────────────────────────────
// Omnicanal concurrent : canaux de vente (natif Intralys + Shopify / Woo) +
// stratégie d'inventaire par canal + OAuth connect + sync + journal.
// Bloc DISTINCT des blocs E1-E7 ci-dessus (append-only, jamais mélangé,
// zéro redéclaration). Contrats FIGÉS M1 (CRUD + strategy via
// `sales_channels` / handlers façade `ecommerce.ts`) + M2 (connect / sync /
// sync-log, parallèle). Types channel déclarés LOCALEMENT ici (M3 ne touche
// pas types.ts — leçon E6/E7 : contrat figé, zéro doublon). Endpoints gated
// worker (requireModule 'ecommerce' + multi-tenant + admin). Dégrade
// proprement si M2 (connect/sync) pas encore branché : apiFetch renvoie
// `{ error }` sur 404 → l'UI désactive le bouton / affiche un état honnête.

/** Stratégie d'inventaire d'un canal (enum figé M1). */
export type InventoryStrategyKind =
  | 'intralys_master'
  | 'partitioned'
  | 'shared_pool';

/** Ligne `sales_channels` retournée par handleListChannels (M1). */
export interface SalesChannel {
  id: string;
  name: string;
  type: 'native' | 'shopify' | 'woo';
  inventory_strategy: InventoryStrategyKind;
  config_ref: string | null;
  shop_domain: string | null;
  external_id: string | null;
  active: number;            // 0 | 1 (SQLite)
  created_at: string;
  updated_at: string;
}

/** Entrée du journal de synchronisation d'un canal (contrat M2). */
export interface ChannelSyncLog {
  id: string;
  channel_id: string;
  direction: 'in' | 'out';
  entity: string;            // 'product' | 'order' | …
  status: 'ok' | 'conflict' | 'error';
  message?: string | null;
  conflict?: string | null;
  created_at: string;
}

/** Payload de création d'un canal (POST /api/ecommerce/channels). */
export interface CreateChannelPayload {
  name: string;
  type: 'shopify' | 'woo';
  shop_domain?: string;
  inventory_strategy?: InventoryStrategyKind;
}

/** GET /api/ecommerce/channels — liste des canaux du tenant (M1). */
export async function getChannels(): Promise<ApiResponse<SalesChannel[]>> {
  return apiFetch<SalesChannel[]>('/ecommerce/channels');
}

/** POST /api/ecommerce/channels — crée un canal externe (ADMIN, M1). */
export async function createChannel(
  payload: CreateChannelPayload,
): Promise<ApiResponse<{ id: string; success: boolean }>> {
  return apiFetch<{ id: string; success: boolean }>('/ecommerce/channels', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** PATCH /api/ecommerce/channels/:id — maj partielle d'un canal (ADMIN, M1). */
export async function updateChannel(
  id: string,
  payload: Partial<Pick<SalesChannel, 'name' | 'shop_domain' | 'config_ref' | 'external_id'>> & { active?: boolean },
): Promise<ApiResponse<{ id: string; success: boolean }>> {
  return apiFetch<{ id: string; success: boolean }>(`/ecommerce/channels/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/** DELETE /api/ecommerce/channels/:id — supprime un canal (ADMIN, M1). */
export async function deleteChannel(
  id: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/ecommerce/channels/${id}`, {
    method: 'DELETE',
  });
}

/**
 * PATCH /api/ecommerce/channels/:id/strategy — change la stratégie
 * d'inventaire d'un canal (ADMIN, M1). Enum validé strictement côté worker.
 */
export async function setChannelStrategy(
  id: string,
  strategy: InventoryStrategyKind,
): Promise<ApiResponse<{ id: string; inventory_strategy: InventoryStrategyKind; success: boolean }>> {
  return apiFetch<{ id: string; inventory_strategy: InventoryStrategyKind; success: boolean }>(
    `/ecommerce/channels/${id}/strategy`,
    {
      method: 'PATCH',
      body: JSON.stringify({ inventory_strategy: strategy }),
    },
  );
}

/**
 * POST /api/ecommerce/channels/:id/connect — démarre l'OAuth Shopify/Woo
 * (contrat M2, parallèle). Renvoie l'URL de redirection du fournisseur.
 */
export async function connectChannel(
  id: string,
): Promise<ApiResponse<{ redirect_url: string }>> {
  return apiFetch<{ redirect_url: string }>(
    `/ecommerce/channels/${id}/connect`,
    { method: 'POST' },
  );
}

/**
 * POST /api/ecommerce/channels/:id/sync — déclenche une synchronisation
 * manuelle (contrat M2, parallèle). Renvoie les compteurs synchronisés.
 */
export async function syncChannel(
  id: string,
): Promise<ApiResponse<{ synced: { products: number; orders: number } }>> {
  return apiFetch<{ synced: { products: number; orders: number } }>(
    `/ecommerce/channels/${id}/sync`,
    { method: 'POST' },
  );
}

/**
 * GET /api/ecommerce/channels/:id/sync-log — journal de synchronisation
 * (contrat M2, parallèle). Liste les opérations in/out + conflits.
 */
export async function getChannelSyncLog(
  id: string,
): Promise<ApiResponse<ChannelSyncLog[]>> {
  return apiFetch<ChannelSyncLog[]>(`/ecommerce/channels/${id}/sync-log`);
}

// ── E9 ───────────────────────────────────────────────────────
// DERNIER bloc de la roadmap e-comm B2. Analytics (revenu ventilé
// par devise, cohortes, LTV, top produits) + reco produits / churn.
// Bloc DISTINCT des blocs E1-E8 ci-dessus (append-only, zéro
// redéclaration — leçon E6/E7/E8 : contrat figé M2, zéro doublon).
// Types importés de ./types (M3 = seul writer section E9 de types.ts,
// zéro écriture src/worker/types.ts qui appartient à M2). Endpoints
// gated worker (requireModule 'ecommerce' + multi-tenant). Dégrade
// PROPREMENT si M2 (ecommerce-analytics / ecommerce-reco) pas encore
// branché : apiFetch renvoie `{ error }` → l'UI affiche un état
// honnête (widget vide, pas de faux chiffre). RÈGLE D'OR multi-devise
// héritée E7 : jamais de somme cross-devise — tout est ventilé.

/** GET /api/ecommerce/analytics/revenue — revenu net ventilé par devise. */
export async function getEcommerceRevenue(): Promise<ApiResponse<EcommerceRevenue>> {
  return apiFetch<EcommerceRevenue>('/ecommerce/analytics/revenue');
}

/** GET /api/ecommerce/analytics/cohorts — cohortes d'acquisition + rétention. */
export async function getEcommerceCohorts(): Promise<ApiResponse<EcommerceCohorts>> {
  return apiFetch<EcommerceCohorts>('/ecommerce/analytics/cohorts');
}

/** GET /api/ecommerce/analytics/ltv — LTV ventilée par devise + taux de rachat. */
export async function getEcommerceLtv(): Promise<ApiResponse<EcommerceLtv>> {
  return apiFetch<EcommerceLtv>('/ecommerce/analytics/ltv');
}

/** GET /api/ecommerce/analytics/top-products — classement produits par devise. */
export async function getEcommerceTopProducts(): Promise<ApiResponse<EcommerceTopProducts>> {
  return apiFetch<EcommerceTopProducts>('/ecommerce/analytics/top-products');
}

/** GET /api/ecommerce/analytics/sales-by-channel — ventes ventilées par
 *  mois × canal × devise (MICRO-FIX Sprint 4 : route oubliée, handler
 *  ecommerce-analytics.ts:484 déjà écrit/exporté ; pur câblage front). */
export async function getEcommerceSalesByChannel(): Promise<ApiResponse<EcommerceSalesByChannel>> {
  return apiFetch<EcommerceSalesByChannel>('/ecommerce/analytics/sales-by-channel');
}

/** GET /api/ecommerce/reco/products/:id — cross/up-sell pour un produit (M2). */
export async function getProductReco(
  productId: string,
): Promise<ApiResponse<ProductRecoResult>> {
  return apiFetch<ProductRecoResult>(`/ecommerce/reco/products/${productId}`);
}

/** GET /api/ecommerce/reco/churn/:customerId — prédiction de churn (M2). */
export async function getCustomerChurn(
  customerId: string,
): Promise<ApiResponse<CustomerChurnPrediction>> {
  return apiFetch<CustomerChurnPrediction>(`/ecommerce/reco/churn/${customerId}`);
}

// ── LOT FUNNEL — builder landing pages / funnels ───────────────────────────
//
// Helpers + types FIGÉS Phase A (Manager-A SOLO), purement ADDITIFS.
// apiFetch / ApiResponse INCHANGÉS (réponses { data } / { error }, jamais de
// champ `code`). Endpoints PROTÉGÉS via apiFetch (auth + X-Sub-Account
// injectés). Endpoints PUBLICS via fetch brut (calque src/pages/PublicForm.tsx
// — pas d'auth pour /api/p/:slug). Types consommés par le builder Phase C.

/** Bloc d'une page de funnel (sérialisé JSON dans funnel_pages.blocks).
 *  type ∈ 8 BlockType figés (src/worker/funnel-blocks.ts §6.C). */
export interface FunnelBlock {
  id: string;
  type:
    | 'hero'
    | 'text'
    | 'image'
    | 'video'
    | 'form'
    | 'button'
    | 'cta'
    | 'spacer';
  config: Record<string, unknown>;
}

/** Page rattachée à une étape (relation applicative 1:1 step → page). */
export interface FunnelPage {
  id: string;
  funnel_id: string;
  step_id: string;
  title?: string | null;
  blocks: FunnelBlock[];
  settings_json?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  seo_image?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Étape ordonnée d'un funnel (v1 linéaire). */
export interface FunnelStep {
  id: string;
  funnel_id: string;
  name: string;
  step_type: 'optin' | 'content' | 'upsell' | 'thankyou' | 'generic';
  position: number;
  page?: FunnelPage | null;
  created_at?: string;
  updated_at?: string;
}

/** Funnel — conteneur de premier ordre. */
export interface Funnel {
  id: string;
  client_id?: string | null;
  agency_id?: string | null;
  name: string;
  description?: string | null;
  status: 'draft' | 'published' | 'archived';
  industry?: string | null;
  total_views: number;
  total_submissions: number;
  total_conversions: number;
  steps?: FunnelStep[];
  publication?: { slug: string; is_active: number; url?: string } | null;
  created_at?: string;
  updated_at?: string;
}

/** Stats d'un funnel (calque la forme handleGetFormStats). */
export interface FunnelStats {
  total_views: number;
  total_submissions: number;
  total_conversions: number;
  conversion_rate: string;
  views_by_day: Array<{ day: string; count: number }>;
}

// ── Protégé (apiFetch) ──────────────────────────────────────────────────────

export async function getFunnels(): Promise<ApiResponse<Funnel[]>> {
  return apiFetch<Funnel[]>('/funnels');
}

export async function getFunnel(
  id: string,
): Promise<ApiResponse<Funnel>> {
  return apiFetch<Funnel>(`/funnels/${id}`);
}

export async function createFunnel(
  data: Partial<Funnel> & { steps?: Partial<FunnelStep>[] },
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/funnels', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateFunnel(
  id: string,
  updates: Partial<Funnel> & { steps?: Partial<FunnelStep>[] },
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/funnels/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function deleteFunnel(
  id: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/funnels/${id}`, { method: 'DELETE' });
}

export async function saveFunnelPage(
  funnelId: string,
  stepId: string,
  data: { title?: string; blocks: FunnelBlock[]; settings_json?: string; seo_title?: string; seo_description?: string; seo_image?: string },
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(
    `/funnels/${funnelId}/pages/${stepId}`,
    { method: 'PUT', body: JSON.stringify(data) },
  );
}

export async function publishFunnel(
  funnelId: string,
  data?: { slug?: string },
): Promise<ApiResponse<{ slug: string; url: string }>> {
  return apiFetch<{ slug: string; url: string }>(
    `/funnels/${funnelId}/publish`,
    { method: 'POST', body: JSON.stringify(data || {}) },
  );
}

export async function getFunnelStats(
  funnelId: string,
): Promise<ApiResponse<FunnelStats>> {
  return apiFetch<FunnelStats>(`/funnels/${funnelId}/stats`);
}

// ── Public (fetch brut, sans auth — calque PublicForm.tsx) ──────────────────

export async function getPublicFunnel(
  slug: string,
): Promise<ApiResponse<{ funnel: Funnel; steps: FunnelStep[] }>> {
  try {
    const res = await fetch(`${API_BASE}/p/${slug}`);
    const data = (await res.json()) as ApiResponse<{
      funnel: Funnel;
      steps: FunnelStep[];
    }>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function submitPublicFunnel(
  slug: string,
  payload: { step_id?: string; data: Record<string, unknown> },
): Promise<
  ApiResponse<{ id: string; success_message?: string; redirect_url?: string }>
> {
  try {
    const res = await fetch(`${API_BASE}/p/${slug}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as ApiResponse<{
      id: string;
      success_message?: string;
      redirect_url?: string;
    }>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

// ── LOT SITE BUILDER (Sprint 10) — site multi-pages réutilisant le moteur funnel
//
// Helpers + types FIGÉS Phase A (Manager-A SOLO), purement ADDITIFS. apiFetch /
// ApiResponse INCHANGÉS (réponses { data } / { error }, JAMAIS de champ `code` —
// §6.A). Le bloc d'une page de site RÉUTILISE le type `FunnelBlock` ci-dessus
// (NE PAS redéfinir les blocs — moteur funnel-blocks.ts RÉUTILISÉ). Endpoints
// PROTÉGÉS via apiFetch (auth + X-Sub-Account injectés) ; endpoints PUBLICS via
// fetch brut (calque getPublicFunnel — pas d'auth pour /api/site/:slug). Types
// consommés par le builder Phase C (Manager-C). Voir docs/LOT-SITE-BUILDER.md §6.

/** Item de la barre de navigation d'un site (nav_json sérialisé). `page_slug`
 *  cible une page interne (`/site/:siteSlug/:page_slug`) ; `url` cible un lien
 *  externe (mutuellement exclusif — page_slug prioritaire). Compilé en <nav>
 *  XSS-safe par site-nav.ts:compileNavToHtml (Manager-B). */
export interface SiteNavItem {
  label: string;
  page_slug?: string | null;
  url?: string | null;
}

/** Page d'un site — blocs = FunnelBlock[] (moteur funnel RÉUTILISÉ). */
export interface SitePage {
  id: string;
  site_id: string;
  slug: string;
  title?: string | null;
  blocks: FunnelBlock[];
  settings_json?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  seo_image?: string | null;
  position: number;
  is_home: number;
  in_nav: number;
  created_at?: string;
  updated_at?: string;
}

/** Site — conteneur multi-pages de premier ordre. */
export interface Site {
  id: string;
  client_id?: string | null;
  agency_id?: string | null;
  name: string;
  description?: string | null;
  status: 'draft' | 'published' | 'archived';
  /** Thème global (couleurs/polices) sérialisé JSON. */
  theme_json?: string | null;
  /** SiteNavItem[] sérialisé JSON (navigation/menu). */
  nav_json?: string | null;
  /** POSÉ INACTIF — jamais lu v1 (flag domaine custom, §6.E). */
  custom_domain?: string | null;
  total_views: number;
  pages?: SitePage[];
  publication?: { slug: string; is_active: number; url?: string } | null;
  created_at?: string;
  updated_at?: string;
}

// ── Protégé (apiFetch) ──────────────────────────────────────────────────────

export async function getSites(): Promise<ApiResponse<Site[]>> {
  return apiFetch<Site[]>('/sites');
}

export async function createSite(
  payload: Omit<Partial<Site>, 'pages'> & { pages?: Partial<SitePage>[] },
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/sites', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getSite(id: string): Promise<ApiResponse<Site>> {
  return apiFetch<Site>(`/sites/${id}`);
}

export async function updateSite(
  id: string,
  payload: Partial<Site>,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/sites/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteSite(
  id: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/sites/${id}`, { method: 'DELETE' });
}

export async function getSitePages(
  siteId: string,
): Promise<ApiResponse<SitePage[]>> {
  return apiFetch<SitePage[]>(`/sites/${siteId}/pages`);
}

export async function createSitePage(
  siteId: string,
  payload: Partial<SitePage>,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>(`/sites/${siteId}/pages`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function saveSitePage(
  siteId: string,
  pageId: string,
  data: {
    blocks: FunnelBlock[];
    title?: string;
    slug?: string;
    settings_json?: string;
    seo_title?: string;
    seo_description?: string;
    seo_image?: string;
    position?: number;
    is_home?: number;
    in_nav?: number;
  },
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/sites/${siteId}/pages/${pageId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteSitePage(
  siteId: string,
  pageId: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/sites/${siteId}/pages/${pageId}`, {
    method: 'DELETE',
  });
}

export async function publishSite(
  id: string,
  data?: { slug?: string },
): Promise<ApiResponse<{ slug: string; url: string }>> {
  return apiFetch<{ slug: string; url: string }>(`/sites/${id}/publish`, {
    method: 'POST',
    body: JSON.stringify(data || {}),
  });
}

// ── Public (fetch brut, sans auth — calque getPublicFunnel) ─────────────────

export async function getPublicSite(
  slug: string,
): Promise<ApiResponse<{ site: Site; pages: SitePage[]; nav: SiteNavItem[] }>> {
  try {
    const res = await fetch(`${API_BASE}/site/${slug}`);
    const data = (await res.json()) as ApiResponse<{
      site: Site;
      pages: SitePage[];
      nav: SiteNavItem[];
    }>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function getPublicSitePage(
  slug: string,
  pageSlug: string,
): Promise<ApiResponse<{ site: Site; page: SitePage; nav: SiteNavItem[] }>> {
  try {
    const res = await fetch(`${API_BASE}/site/${slug}/${pageSlug}`);
    const data = (await res.json()) as ApiResponse<{
      site: Site;
      page: SitePage;
      nav: SiteNavItem[];
    }>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

// ── LOT MEMBERSHIPS — espace membre & cours (Sprint 6) ──────────────────────
//
// Helpers ADDITIFS — signatures FIGÉES Phase A (corps réels Phase B
// Manager-B / front Phase C Manager-C). apiFetch / ApiResponse INCHANGÉS
// (jamais `code` — §6.A). Espace membre = auth membre SÉPARÉE : le token
// membre est DISTINCT du token CRM (stocké à part côté front Phase C — clé
// localStorage 'intralys_member_token', JAMAIS le token admin). Les helpers
// publics utilisent fetch brut (calque getPublicFunnel) ; les helpers PRO
// utilisent apiFetch (auth CRM, capability 'workflows.manage' côté worker).

export interface MembershipSite {
  id: string;
  client_id?: string | null;
  agency_id?: string | null;
  slug: string;
  name?: string | null;
  is_active: number;
  created_at?: string;
}

export interface MembershipPlan {
  id: string;
  client_id?: string | null;
  agency_id?: string | null;
  name: string;
  /** POSÉ INACTIF — aucune logique de paiement (§6.B). */
  price_cents: number;
  created_at?: string;
}

export interface Course {
  id: string;
  client_id?: string | null;
  agency_id?: string | null;
  site_id?: string | null;
  plan_id?: string | null;
  title: string;
  description?: string | null;
  is_published: number;
  created_at?: string;
}

export interface CourseModule {
  id: string;
  course_id?: string | null;
  title: string;
  sort_order: number;
  created_at?: string;
}

export interface Lesson {
  id: string;
  module_id?: string | null;
  course_id?: string | null;
  title: string;
  /** 'text' | 'video' (PAS de CHECK DB — applicatif §6.B). */
  content_type: string;
  body_html?: string | null;
  /** Présence vidéo gated — la clé R2 n'est JAMAIS exposée au front (§6.E). */
  has_video?: boolean;
  drip_days: number;
  sort_order: number;
  created_at?: string;
}

/** Membre authentifié (retour login/register — auth SÉPARÉE du CRM). */
export interface MemberAuthResult {
  token: string;
  member: { id: string; email: string; name?: string | null };
}

/** Cours visible côté espace membre + état inscription/progression (§6.F). */
export interface MemberCourse {
  id: string;
  title: string;
  description?: string | null;
  enrolled?: boolean;
  progress_pct?: number;
}

// ── LOT MEMBERSHIP ENROLL (Sprint 6 « fermeture boucle inscription ») ────────
//
// Types + helpers ADDITIFS — signatures FIGÉES Phase A (corps réels Phase B
// Manager-B / front Phase C Manager-C). Contrat §6 verbatim dans
// docs/LOT-MEMBERSHIP-ENROLL.md. Inscription GRATUITE (E4 inactif —
// price_cents cosmétique). apiFetch / ApiResponse INCHANGÉS (jamais `code`).

/**
 * Leçon vue côté espace membre, état drip/progress inclus (réponse de
 * getMemberCourseDetail). La clé R2 n'est JAMAIS exposée (has_video seul, §6.E).
 * `unlocked` = drip débloqué (enrolled_at + drip_days ≤ now, §6.F). `status` =
 * progression de CETTE leçon pour le membre ('started' | 'completed' | null).
 */
export interface MemberLesson {
  id: string;
  module_id?: string | null;
  course_id?: string | null;
  title: string;
  content_type: string;
  has_video?: boolean;
  drip_days: number;
  sort_order: number;
  /** Drip débloqué pour ce membre (enrolled_at + drip_days ≤ now, §6.F). */
  unlocked: boolean;
  /** Progression du membre sur cette leçon : 'started' | 'completed' | null. */
  status?: string | null;
}

/** Module (regroupement de leçons) côté espace membre. */
export interface MemberModule {
  id: string;
  course_id?: string | null;
  title: string;
  sort_order: number;
}

/**
 * Détail d'un cours côté espace membre (réponse de getMemberCourseDetail) :
 * cours + état d'inscription + arbre modules→leçons borné membre, état drip +
 * progress par leçon. `lessons` est PLAT (chaque leçon porte `module_id` pour
 * le regroupement front — calque handleGetCourse PRO). Leçons sans module_id
 * (orphelines) = section « hors module » côté front.
 */
export interface MemberCourseDetail {
  id: string;
  title: string;
  description?: string | null;
  enrolled: boolean;
  enrolled_at?: string | null;
  progress_pct: number;
  lessons_total: number;
  lessons_completed: number;
  modules: MemberModule[];
  lessons: MemberLesson[];
}

/** Membre listé côté PRO (getMembers — liste de gestion). */
export interface MemberLite {
  id: string;
  email: string;
  name?: string | null;
  status?: string | null;
  created_at?: string;
}

/** Inscription listée côté PRO (getCourseEnrollments). */
export interface CourseEnrollment {
  id: string;
  member_id?: string | null;
  course_id?: string | null;
  /** email/name du membre joints côté serveur (jointure applicative). */
  email?: string | null;
  name?: string | null;
  status: string;
  enrolled_at?: string | null;
}

// ── Espace membre PUBLIC (fetch brut, token membre SÉPARÉ — calque
//    getPublicFunnel ; le token membre est passé explicitement, JAMAIS le
//    token admin de apiFetch). Corps réels Phase B/C. ──────────────────────

export async function memberRegister(
  slug: string,
  payload: { email: string; password: string; name?: string },
): Promise<ApiResponse<MemberAuthResult>> {
  try {
    const res = await fetch(`${API_BASE}/member/${slug}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as ApiResponse<MemberAuthResult>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function memberLogin(
  slug: string,
  payload: { email: string; password: string },
): Promise<ApiResponse<MemberAuthResult>> {
  try {
    const res = await fetch(`${API_BASE}/member/${slug}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as ApiResponse<MemberAuthResult>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function memberLogout(
  slug: string,
  memberToken: string,
): Promise<ApiResponse<{ success: boolean }>> {
  try {
    const res = await fetch(`${API_BASE}/member/${slug}/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
    });
    const data = (await res.json()) as ApiResponse<{ success: boolean }>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function getMemberCourses(
  slug: string,
  memberToken: string,
): Promise<ApiResponse<MemberCourse[]>> {
  try {
    const res = await fetch(`${API_BASE}/member/${slug}/courses`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    const data = (await res.json()) as ApiResponse<MemberCourse[]>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function getMemberLesson(
  lessonId: string,
  memberToken: string,
): Promise<ApiResponse<Lesson>> {
  try {
    const res = await fetch(`${API_BASE}/member/lessons/${lessonId}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    const data = (await res.json()) as ApiResponse<Lesson>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

/**
 * URL de la vidéo d'une leçon — proxy worker GATED (§6.E). Le front pose
 * `<video src={memberLessonVideoUrl(id, token)} ...>` ; l'autorisation
 * (double borne member.client_id == lesson.client_id + enrollment + drip)
 * est faite côté worker AVANT env.FILES.get. Le token membre transite en
 * query (les balises <video> n'envoient pas de header Authorization).
 * JAMAIS d'URL R2 publique exposée.
 */
export function memberLessonVideoUrl(
  lessonId: string,
  memberToken: string,
): string {
  return `${API_BASE}/member/lessons/${lessonId}/video?token=${encodeURIComponent(memberToken)}`;
}

export async function setMemberProgress(
  memberToken: string,
  payload: { lesson_id: string; status: 'started' | 'completed' },
): Promise<ApiResponse<{ success: boolean; progress_pct?: number }>> {
  try {
    const res = await fetch(`${API_BASE}/member/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as ApiResponse<{
      success: boolean;
      progress_pct?: number;
    }>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

// ── LOT MEMBERSHIP ENROLL — espace membre (fetch BRUT + token membre EXPLICITE,
//    calque getMemberCourses / setMemberProgress, JAMAIS apiFetch admin). Corps
//    réels Phase B Manager-B / front Phase C Manager-C. ──────────────────────

/**
 * Inscrit le membre courant à un cours (GRATUIT — E4 inactif). POST
 * /member/:slug/courses/:courseId/enroll. Idempotent côté serveur (vérif
 * existant). Borné member.clientId == course.client_id + course is_published=1.
 */
export async function enrollInCourse(
  slug: string,
  memberToken: string,
  courseId: string,
): Promise<ApiResponse<{ success: boolean; enrolled: boolean }>> {
  try {
    const res = await fetch(
      `${API_BASE}/member/${slug}/courses/${courseId}/enroll`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${memberToken}`,
        },
      },
    );
    const data = (await res.json()) as ApiResponse<{
      success: boolean;
      enrolled: boolean;
    }>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

/**
 * Détail d'un cours côté membre : cours + état inscription + arbre
 * modules→leçons (état drip + progress par leçon). GET
 * /member/:slug/courses/:courseId. Renvoie {error} 403 si non inscrit (le
 * front affiche alors le bouton « S'inscrire »).
 */
export async function getMemberCourseDetail(
  slug: string,
  memberToken: string,
  courseId: string,
): Promise<ApiResponse<MemberCourseDetail>> {
  try {
    const res = await fetch(
      `${API_BASE}/member/${slug}/courses/${courseId}`,
      { headers: { Authorization: `Bearer ${memberToken}` } },
    );
    const data = (await res.json()) as ApiResponse<MemberCourseDetail>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

// ── Gestion PRO cours (apiFetch — auth CRM, capability 'workflows.manage'
//    côté worker). Corps réels Phase B Manager-B. ──────────────────────────

export async function getCourses(): Promise<ApiResponse<Course[]>> {
  return apiFetch<Course[]>('/courses');
}

export async function createCourse(
  course: Partial<Course>,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/courses', {
    method: 'POST',
    body: JSON.stringify(course),
  });
}

export async function getCourse(
  id: string,
): Promise<ApiResponse<Course & { modules: CourseModule[]; lessons: Lesson[] }>> {
  return apiFetch<Course & { modules: CourseModule[]; lessons: Lesson[] }>(
    `/courses/${id}`,
  );
}

export async function updateCourse(
  id: string,
  updates: Partial<Course>,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/courses/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function deleteCourse(
  id: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/courses/${id}`, {
    method: 'DELETE',
  });
}

export async function getCourseModules(
  courseId: string,
): Promise<ApiResponse<CourseModule[]>> {
  return apiFetch<CourseModule[]>(`/courses/${courseId}/modules`);
}

export async function createCourseModule(
  courseId: string,
  module: Partial<CourseModule>,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>(`/courses/${courseId}/modules`, {
    method: 'POST',
    body: JSON.stringify(module),
  });
}

export async function createLesson(
  lesson: Partial<Lesson>,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/lessons', {
    method: 'POST',
    body: JSON.stringify(lesson),
  });
}

export async function updateLesson(
  id: string,
  updates: Partial<Lesson>,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/lessons/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function deleteLesson(
  id: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/lessons/${id}`, {
    method: 'DELETE',
  });
}

export async function getMembershipSites(): Promise<
  ApiResponse<MembershipSite[]>
> {
  return apiFetch<MembershipSite[]>('/membership-sites');
}

export async function createMembershipSite(
  site: Partial<MembershipSite>,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/membership-sites', {
    method: 'POST',
    body: JSON.stringify(site),
  });
}

export async function getMembershipPlans(): Promise<
  ApiResponse<MembershipPlan[]>
> {
  return apiFetch<MembershipPlan[]>('/membership-plans');
}

export async function createMembershipPlan(
  plan: Partial<MembershipPlan>,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/membership-plans', {
    method: 'POST',
    body: JSON.stringify(plan),
  });
}

// ── LOT MEMBERSHIP ENROLL — gestion PRO membres / inscriptions (apiFetch —
//    auth CRM, capability 'workflows.manage' côté worker via membershipCapGuard,
//    bornage rowInTenant). Corps réels Phase B Manager-B. ───────────────────

/** Liste des membres du tenant (gestion PRO). GET /members. */
export async function getMembers(): Promise<ApiResponse<MemberLite[]>> {
  return apiFetch<MemberLite[]>('/members');
}

/**
 * Inscrit un membre à un cours côté PRO (GRATUIT — E4 inactif). POST
 * /courses/:id/enroll, body { member_id }. Idempotent côté serveur. Borne
 * member.client_id == course.client_id (rowInTenant).
 */
export async function enrollMember(
  courseId: string,
  memberId: string,
): Promise<ApiResponse<{ success: boolean; enrolled: boolean }>> {
  return apiFetch<{ success: boolean; enrolled: boolean }>(
    `/courses/${courseId}/enroll`,
    {
      method: 'POST',
      body: JSON.stringify({ member_id: memberId }),
    },
  );
}

/** Liste des inscrits à un cours (gestion PRO). GET /courses/:id/enrollments. */
export async function getCourseEnrollments(
  courseId: string,
): Promise<ApiResponse<CourseEnrollment[]>> {
  return apiFetch<CourseEnrollment[]>(`/courses/${courseId}/enrollments`);
}

// ── LOT PORTAL-E — portail client final (Sprint E) ──────────────────────────
//
// Helpers ADDITIFS — signatures FIGÉES Phase A (corps réels Phase B Manager-B /
// front Phase C Manager-C). apiFetch / ApiResponse INCHANGÉS (jamais `code`).
// DEUX populations :
//   • PORTAIL CLIENT → fetch brut + token portail EXPLICITE (calque
//     memberLogin / getMemberCourses, JAMAIS apiFetch admin). Token = localStorage
//     'intralys_portal_token' (DISTINCT du token CRM ET du token membre).
//   • PRO config → apiFetch (auth CRM, capability 'billing.view' côté worker).
// La facture est LECTURE SEULE (E4 jamais — aucun payment_url exposé).

/** Client final authentifié (retour login/set-password — auth SÉPARÉE). */
export interface PortalAuthResult {
  token: string;
  portalUser: { id: string; email: string; name?: string | null };
}

/** Facture exposée au portail — LECTURE SEULE (aucun champ de paiement). */
export interface PortalInvoice {
  id: string;
  number?: string | null;
  status?: string | null;
  total_cents?: number | null;
  currency?: string | null;
  issued_at?: string | null;
  due_at?: string | null;
}

export interface PortalQuote {
  id: string;
  number?: string | null;
  status?: string | null;
  total_cents?: number | null;
  currency?: string | null;
  created_at?: string | null;
}

export interface PortalAppointment {
  id: string;
  title?: string | null;
  status?: string | null;
  start_at?: string | null;
  end_at?: string | null;
}

export interface PortalDocument {
  id: string;
  name?: string | null;
  status?: string | null;
  signed_at?: string | null;
}

export interface PortalTicket {
  id: string;
  subject?: string | null;
  status?: string | null;
  created_at?: string | number | null;
}

/** Portail (config PRO) — calque MembershipSite. */
export interface PortalSite {
  id: string;
  client_id?: string | null;
  agency_id?: string | null;
  slug: string;
  name?: string | null;
  is_active: number;
  created_at?: string;
}

/** Client final provisionné (config PRO). password JAMAIS exposé. */
export interface PortalUser {
  id: string;
  client_id?: string | null;
  agency_id?: string | null;
  email: string;
  name?: string | null;
  lead_id?: string | null;
  status: string;
  created_at?: string;
}

// ── Portail client PUBLIC (fetch brut, token portail SÉPARÉ — passé
//    explicitement, JAMAIS le token admin de apiFetch). Corps réels Phase B/C. ──

export async function portalLogin(
  slug: string,
  payload: { email: string; password: string },
): Promise<ApiResponse<PortalAuthResult>> {
  try {
    const res = await fetch(`${API_BASE}/portal/${slug}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as ApiResponse<PortalAuthResult>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function portalSetPassword(
  slug: string,
  payload: { email: string; password: string },
): Promise<ApiResponse<PortalAuthResult>> {
  try {
    const res = await fetch(`${API_BASE}/portal/${slug}/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as ApiResponse<PortalAuthResult>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function portalLogout(
  slug: string,
  portalToken: string,
): Promise<ApiResponse<{ success: boolean }>> {
  try {
    const res = await fetch(`${API_BASE}/portal/${slug}/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${portalToken}`,
      },
    });
    const data = (await res.json()) as ApiResponse<{ success: boolean }>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function getPortalInvoices(
  slug: string,
  portalToken: string,
): Promise<ApiResponse<PortalInvoice[]>> {
  try {
    const res = await fetch(`${API_BASE}/portal/${slug}/invoices`, {
      headers: { Authorization: `Bearer ${portalToken}` },
    });
    const data = (await res.json()) as ApiResponse<PortalInvoice[]>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function getPortalQuotes(
  slug: string,
  portalToken: string,
): Promise<ApiResponse<PortalQuote[]>> {
  try {
    const res = await fetch(`${API_BASE}/portal/${slug}/quotes`, {
      headers: { Authorization: `Bearer ${portalToken}` },
    });
    const data = (await res.json()) as ApiResponse<PortalQuote[]>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function getPortalAppointments(
  slug: string,
  portalToken: string,
): Promise<ApiResponse<PortalAppointment[]>> {
  try {
    const res = await fetch(`${API_BASE}/portal/${slug}/appointments`, {
      headers: { Authorization: `Bearer ${portalToken}` },
    });
    const data = (await res.json()) as ApiResponse<PortalAppointment[]>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function getPortalDocuments(
  slug: string,
  portalToken: string,
): Promise<ApiResponse<PortalDocument[]>> {
  try {
    const res = await fetch(`${API_BASE}/portal/${slug}/documents`, {
      headers: { Authorization: `Bearer ${portalToken}` },
    });
    const data = (await res.json()) as ApiResponse<PortalDocument[]>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function getPortalTickets(
  slug: string,
  portalToken: string,
): Promise<ApiResponse<PortalTicket[]>> {
  try {
    const res = await fetch(`${API_BASE}/portal/${slug}/tickets`, {
      headers: { Authorization: `Bearer ${portalToken}` },
    });
    const data = (await res.json()) as ApiResponse<PortalTicket[]>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function createPortalTicket(
  slug: string,
  portalToken: string,
  payload: { subject: string; body: string },
): Promise<ApiResponse<{ id: string }>> {
  try {
    const res = await fetch(`${API_BASE}/portal/${slug}/tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${portalToken}`,
      },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as ApiResponse<{ id: string }>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

// ── Config PRO portail (apiFetch — auth CRM, capability 'billing.view' côté
//    worker). Corps réels Phase B Manager-B. ─────────────────────────────────

export async function getPortalSites(): Promise<ApiResponse<PortalSite[]>> {
  return apiFetch<PortalSite[]>('/portal-sites');
}

export async function createPortalSite(
  site: Partial<PortalSite>,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/portal-sites', {
    method: 'POST',
    body: JSON.stringify(site),
  });
}

export async function getPortalUsers(): Promise<ApiResponse<PortalUser[]>> {
  return apiFetch<PortalUser[]>('/portal-users');
}

export async function invitePortalUser(
  payload: { email: string; name?: string; lead_id: string },
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/portal-users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ── LOT G10 COMMUNAUTÉ — espace social membre + commentaires de leçons ───────
//
// Helpers ADDITIFS — signatures FIGÉES Phase A (corps réels Phase B Manager-B /
// front Phase C Manager-C). apiFetch / ApiResponse INCHANGÉS (jamais `code` —
// §6.D). DEUX populations :
//   • MEMBRE → fetch brut + token membre EXPLICITE (calque memberRegister /
//     getMemberCourses, JAMAIS apiFetch admin). Token = localStorage
//     'intralys_member_token' (DISTINCT du token CRM).
//   • PRO modération → apiFetch (auth CRM, capability 'workflows.manage'
//     mode-agence-only côté worker).

/** Thread du forum communautaire MEMBRES (G10 — auteur = member_id, JAMAIS users).
 *  DISTINCT du CommunityThread S45 (forum tenant interne, voir ~ligne 9696). */
export interface MembershipCommunityThread {
  id: string;
  title: string;
  member_id?: string | null;
  is_pinned?: number;
  is_locked?: number;
  created_at?: string;
}

/** Message d'un thread (PLAT v1 — parent_post_id réservé v2). */
export interface MembershipCommunityPost {
  id: string;
  member_id?: string | null;
  body?: string | null;
  created_at?: string;
}

/** Commentaire sous une leçon (auteur = member_id). */
export interface LessonComment {
  id: string;
  member_id?: string | null;
  body?: string | null;
  created_at?: string;
}

// ── Espace membre (fetch brut, token membre EXPLICITE — §6.D) ────────────────

export async function getCommunityThreads(
  slug: string,
  memberToken: string,
): Promise<ApiResponse<MembershipCommunityThread[]>> {
  try {
    const res = await fetch(`${API_BASE}/member/${slug}/community/threads`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    const data = (await res.json()) as ApiResponse<MembershipCommunityThread[]>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function createCommunityThread(
  slug: string,
  memberToken: string,
  payload: { title: string },
): Promise<ApiResponse<{ id: string }>> {
  try {
    const res = await fetch(`${API_BASE}/member/${slug}/community/threads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as ApiResponse<{ id: string }>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function getThreadPosts(
  slug: string,
  threadId: string,
  memberToken: string,
): Promise<ApiResponse<MembershipCommunityPost[]>> {
  try {
    const res = await fetch(
      `${API_BASE}/member/${slug}/community/threads/${threadId}/posts`,
      { headers: { Authorization: `Bearer ${memberToken}` } },
    );
    const data = (await res.json()) as ApiResponse<MembershipCommunityPost[]>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function createPost(
  slug: string,
  threadId: string,
  memberToken: string,
  payload: { body: string },
): Promise<ApiResponse<{ id: string }>> {
  try {
    const res = await fetch(
      `${API_BASE}/member/${slug}/community/threads/${threadId}/posts`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${memberToken}`,
        },
        body: JSON.stringify(payload),
      },
    );
    const data = (await res.json()) as ApiResponse<{ id: string }>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function deleteOwnPost(
  postId: string,
  memberToken: string,
): Promise<ApiResponse<{ success: boolean }>> {
  try {
    const res = await fetch(`${API_BASE}/member/community/posts/${postId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    const data = (await res.json()) as ApiResponse<{ success: boolean }>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function getLessonComments(
  lessonId: string,
  memberToken: string,
): Promise<ApiResponse<LessonComment[]>> {
  try {
    const res = await fetch(`${API_BASE}/member/lessons/${lessonId}/comments`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    const data = (await res.json()) as ApiResponse<LessonComment[]>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function createLessonComment(
  lessonId: string,
  memberToken: string,
  payload: { body: string },
): Promise<ApiResponse<{ id: string }>> {
  try {
    const res = await fetch(`${API_BASE}/member/lessons/${lessonId}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as ApiResponse<{ id: string }>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function deleteOwnComment(
  commentId: string,
  memberToken: string,
): Promise<ApiResponse<{ success: boolean }>> {
  try {
    const res = await fetch(
      `${API_BASE}/member/community/comments/${commentId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${memberToken}` },
      },
    );
    const data = (await res.json()) as ApiResponse<{ success: boolean }>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

// ── Modération PRO (apiFetch — auth CRM, capability 'workflows.manage') ──────

export async function getModerationThreads(): Promise<
  ApiResponse<MembershipCommunityThread[]>
> {
  return apiFetch<MembershipCommunityThread[]>('/community/moderate/threads');
}

/** Liste les posts d'un thread pour la modération (inclut is_hidden). */
export async function getModerationPosts(
  threadId: string,
): Promise<ApiResponse<MembershipCommunityPost[]>> {
  return apiFetch<MembershipCommunityPost[]>(
    `/community/moderate/threads/${threadId}/posts`,
  );
}

/** Liste les commentaires de leçons à modérer (filtre optionnel lesson_id). */
export async function getModerationComments(
  lessonId?: string,
): Promise<ApiResponse<LessonComment[]>> {
  const qs = lessonId ? `?lesson_id=${encodeURIComponent(lessonId)}` : '';
  return apiFetch<LessonComment[]>(`/community/moderate/comments${qs}`);
}

export async function moderateDeletePost(
  id: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/community/moderate/posts/${id}`, {
    method: 'DELETE',
  });
}

export async function moderateDeleteComment(
  id: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/community/moderate/comments/${id}`, {
    method: 'DELETE',
  });
}

export async function moderateThread(
  id: string,
  updates: { is_pinned?: number; is_locked?: number },
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/community/moderate/threads/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

// ── LOT G1 HELPDESK — tickets de support & base de connaissances (Sprint 8) ──
//
// Helpers ADDITIFS — signatures FIGÉES Phase A (corps réels Phase B Manager-B /
// front Phase C Manager-C). apiFetch / ApiResponse INCHANGÉS (jamais `code` —
// discrimination capability front = string-match sur `error`). Les helpers
// publics utilisent fetch brut (calque getPublicFunnel — visiteur anonyme,
// pas d'auth) ; les helpers PRO utilisent apiFetch (auth CRM, garde
// 'leads.write' mode-agence-only côté worker).

/** Statuts v1 d'un ticket (validés côté handler, PAS de CHECK SQL). */
export type TicketStatus =
  | 'ouvert'
  | 'en_cours'
  | 'attente_client'
  | 'resolu'
  | 'escale';

/** Niveau SLA v1 (enum applicatif, PAS de CHECK SQL). */
export type SlaLevel = 'none' | '1h' | '4h' | '24h' | '72h';

/** Ticket de support — conteneur de premier ordre. lead_id nullable
 *  (visiteur anonyme). */
export interface Ticket {
  id: string;
  client_id?: string | null;
  agency_id?: string | null;
  lead_id?: string | null;
  subject?: string | null;
  body?: string | null;
  requester_name?: string | null;
  requester_email?: string | null;
  requester_phone?: string | null;
  status: TicketStatus;
  priority?: string | null;
  sla_level?: SlaLevel | null;
  sla_due_at?: number | null;
  assigned_to?: string | null;
  source?: string | null;
  last_message_at?: number | null;
  created_at?: number | null;
  updated_at?: number | null;
}

/** Message dans le fil d'un ticket. direction = inbound|outbound ;
 *  is_internal = note interne équipe. */
export interface TicketMessage {
  id: string;
  ticket_id: string;
  client_id?: string | null;
  direction?: 'inbound' | 'outbound' | null;
  author_id?: string | null;
  author_name?: string | null;
  body?: string | null;
  is_internal?: number | null;
  created_at?: number | null;
}

/** Article de base de connaissances (KB). slug = unicité applicative. */
export interface KBArticle {
  id: string;
  client_id?: string | null;
  agency_id?: string | null;
  slug?: string | null;
  title?: string | null;
  body_md?: string | null;
  category?: string | null;
  status?: 'draft' | 'published' | null;
  view_count?: number | null;
  created_at?: number | null;
  updated_at?: number | null;
}

// ── Tickets — PRO (apiFetch) ────────────────────────────────────────────────

export async function listTickets(
  params?: Record<string, string>,
): Promise<ApiResponse<Ticket[]>> {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiFetch<Ticket[]>(`/tickets${qs}`);
}

export async function getTicket(
  id: string,
): Promise<ApiResponse<Ticket & { messages: TicketMessage[] }>> {
  return apiFetch<Ticket & { messages: TicketMessage[] }>(`/tickets/${id}`);
}

export async function createTicket(
  p: Partial<Ticket>,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/tickets', {
    method: 'POST',
    body: JSON.stringify(p),
  });
}

export async function updateTicket(
  id: string,
  p: Partial<Ticket>,
): Promise<ApiResponse<{ success: true }>> {
  return apiFetch<{ success: true }>(`/tickets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(p),
  });
}

export async function replyTicket(
  id: string,
  p: { body: string; is_internal?: boolean },
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>(`/tickets/${id}/reply`, {
    method: 'POST',
    body: JSON.stringify(p),
  });
}

// ── KB — PRO (apiFetch) ─────────────────────────────────────────────────────

export async function listKBArticles(
  params?: Record<string, string>,
): Promise<ApiResponse<KBArticle[]>> {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiFetch<KBArticle[]>(`/kb${qs}`);
}

export async function getKBArticle(
  id: string,
): Promise<ApiResponse<KBArticle>> {
  return apiFetch<KBArticle>(`/kb/${id}`);
}

export async function createKBArticle(
  p: Partial<KBArticle>,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/kb', {
    method: 'POST',
    body: JSON.stringify(p),
  });
}

export async function updateKBArticle(
  id: string,
  p: Partial<KBArticle>,
): Promise<ApiResponse<{ success: true }>> {
  return apiFetch<{ success: true }>(`/kb/${id}`, {
    method: 'PUT',
    body: JSON.stringify(p),
  });
}

export async function deleteKBArticle(
  id: string,
): Promise<ApiResponse<{ success: true }>> {
  return apiFetch<{ success: true }>(`/kb/${id}`, { method: 'DELETE' });
}

// ── Public (fetch brut, sans auth — calque getPublicFunnel) ─────────────────

export async function publicSubmitTicket(
  p: {
    slug?: string;
    subject?: string;
    body?: string;
    requester_name?: string;
    requester_email?: string;
    requester_phone?: string;
    data?: Record<string, unknown>;
  },
): Promise<ApiResponse<{ id: string }>> {
  try {
    const res = await fetch(`${API_BASE}/public/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    const data = (await res.json()) as ApiResponse<{ id: string }>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function publicGetKBArticle(
  slug: string,
): Promise<ApiResponse<KBArticle>> {
  try {
    const res = await fetch(`${API_BASE}/public/kb/${slug}`);
    const data = (await res.json()) as ApiResponse<KBArticle>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

// ── LOT G2 AFFILIATION — types + helpers PRO (apiFetch). ─────────────────────
// ApiResponse / apiFetch GELÉS (§6.D). Bornage tenant côté worker. Attribution
// publique via le redirect /r/:code (worker, 302 — pas d'appel front).

/** Affilié / parrain dédié. code = identifiant public (unicité applicative). */
export interface Affiliate {
  id: string;
  client_id?: string | null;
  agency_id?: string | null;
  name?: string | null;
  email?: string | null;
  code?: string | null;
  status?: 'active' | 'inactive' | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Programme d'affiliation (1 par tenant). commission_value = montant (fixed)
 *  ou pourcentage (percent). cookie_window_days = durée d'attribution. */
export interface AffiliateProgram {
  id?: string;
  client_id?: string | null;
  agency_id?: string | null;
  commission_type?: 'fixed' | 'percent' | null;
  commission_value?: number | null;
  cookie_window_days?: number | null;
  target_url?: string | null;
  status?: 'active' | 'inactive' | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Commission générée à la conversion (lead→won). Payout manuel v1. */
export interface AffiliateCommission {
  id: string;
  client_id?: string | null;
  affiliate_id?: string | null;
  referral_id?: string | null;
  lead_id?: string | null;
  amount?: number | null;
  currency?: string | null;
  status?: 'pending' | 'approved' | 'paid' | 'rejected' | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export async function getAffiliates(): Promise<ApiResponse<Affiliate[]>> {
  return apiFetch<Affiliate[]>('/affiliates');
}

export async function createAffiliate(
  b: Partial<Affiliate>,
): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/affiliates', {
    method: 'POST',
    body: JSON.stringify(b),
  });
}

export async function updateAffiliate(
  id: string,
  b: Partial<Affiliate>,
): Promise<ApiResponse<{ success: true }>> {
  return apiFetch<{ success: true }>(`/affiliates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(b),
  });
}

export async function deleteAffiliate(
  id: string,
): Promise<ApiResponse<{ success: true }>> {
  return apiFetch<{ success: true }>(`/affiliates/${id}`, { method: 'DELETE' });
}

export async function getAffiliateProgram(): Promise<
  ApiResponse<AffiliateProgram | null>
> {
  return apiFetch<AffiliateProgram | null>('/affiliate-program');
}

export async function updateAffiliateProgram(
  b: Partial<AffiliateProgram>,
): Promise<ApiResponse<{ success: true }>> {
  return apiFetch<{ success: true }>('/affiliate-program', {
    method: 'PUT',
    body: JSON.stringify(b),
  });
}

export async function getAffiliateCommissions(
  params?: Record<string, string>,
): Promise<ApiResponse<AffiliateCommission[]>> {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiFetch<AffiliateCommission[]>(`/affiliate-commissions${qs}`);
}

export async function updateCommissionStatus(
  id: string,
  status: 'pending' | 'approved' | 'paid' | 'rejected',
): Promise<ApiResponse<{ success: true }>> {
  return apiFetch<{ success: true }>(`/affiliate-commissions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

// Export CSV — réponse non-JSON (text/csv). fetch brut avec auth header (calque
// apiFetch pour le token), retourne le CSV brut en string. ApiResponse GELÉ :
// on ne touche pas apiFetch, on enveloppe à part.
// ── LOT G4 — OAuth natives (Google Calendar + Slack) ──────────────────────────
// Connexions OAuth natives par tenant (oauth_connections seq 95). ApiResponse
// GELÉ : on n'ajoute QUE des helpers, on ne touche pas apiFetch. Le démarrage du
// flow (authorize) = navigation top-level via window.location.href (calque
// EXACT du bouton Meta Integrations.tsx:668), donc on expose juste l'URL.

/** Path d'autorisation OAuth pour un provider (navigation top-level côté UI). */
export function oauthAuthorizeUrl(provider: 'google' | 'slack'): string {
  return `${API_BASE}/oauth/${provider}/authorize`;
}

/** Liste des connexions OAuth du tenant (tokens JAMAIS exposés). */
export async function getOauthConnections(): Promise<ApiResponse<OauthConnection[]>> {
  return apiFetch<OauthConnection[]>('/oauth/connections');
}

/** Supprime une connexion OAuth (re-bornée tenant côté worker). */
export async function deleteOauthConnection(
  id: string,
): Promise<ApiResponse<{ success: true }>> {
  return apiFetch<{ success: true }>(`/oauth/connections/${id}`, { method: 'DELETE' });
}

export async function exportCommissionsCsv(): Promise<ApiResponse<string>> {
  try {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const activeSubAccount = getActiveSubAccount();
    if (activeSubAccount) headers['X-Sub-Account'] = activeSubAccount;
    const res = await fetch(`${API_BASE}/affiliate-commissions/export`, {
      headers,
    });
    if (res.status === 401) {
      clearToken();
      window.location.href = '/login';
      return { error: t('api.session_expired') };
    }
    if (!res.ok) return { error: `Erreur ${res.status}` };
    const csv = await res.text();
    return { data: csv };
  } catch {
    return { error: t('api.unavailable') };
  }
}

// ── LOT G7 MARKETPLACE — templates partageables cross-tenant ─────────────────
// kind = 'funnel' | 'workflow' | 'sequence'. Catalogue public + publish/install/
// review protégés (capability 'workflows.manage'). Monétisation HORS v1 :
// price_cents existe mais reste à 0 / inactif (jamais de paiement). ApiResponse
// INCHANGÉ (calque getFunnels / getPacks).

export type MarketplaceKind = 'funnel' | 'workflow' | 'sequence';

export interface MarketplaceListing {
  id: string;
  publisher_client_id?: string | null;
  publisher_agency_id?: string | null;
  kind: MarketplaceKind;
  title: string;
  description?: string | null;
  category?: string | null;
  /** SNAPSHOT strippé (structure seule) — présent sur le détail public uniquement. */
  content_json?: string | null;
  status: 'draft' | 'published';
  install_count: number;
  rating_avg: number;
  rating_count: number;
  /** Réservé v2 — INACTIF en v1 (toujours 0, jamais de paiement). */
  price_cents: number;
  reviews?: MarketplaceReview[];
  created_at?: string;
  updated_at?: string;
}

export interface MarketplaceReview {
  id: string;
  listing_id: string;
  reviewer_client_id?: string | null;
  rating: number;
  comment?: string | null;
  created_at?: string;
}

// Sprint 19 — paramètres OPTIONNELS de recherche/filtre/tri serveur du catalogue
// public. Tous les champs sont facultatifs ; les vides sont omis du querystring.
// Filtres kind/category déjà gérés serveur (seq96) ; q (LIKE) + sort (whitelisté)
// ajoutés par Manager-B. Rétro-compat : getMarketplaceListings() sans arg = URL nue.
export interface MarketplaceListQuery {
  q?: string;
  kind?: MarketplaceKind;
  category?: string;
  sort?: 'popular' | 'recent' | 'rating';
}

// ── Public (catalogue cross-tenant, lecture seule) ──────────────────────────
// Signature ÉLARGIE rétro-compatible (Sprint 19) : l'argument est OPTIONNEL.
// Un appel SANS argument cible `/marketplace/listings` byte-identique à avant.
export async function getMarketplaceListings(
  params?: MarketplaceListQuery,
): Promise<ApiResponse<MarketplaceListing[]>> {
  const qs = new URLSearchParams();
  if (params) {
    if (params.q && params.q.trim()) qs.set('q', params.q.trim());
    if (params.kind) qs.set('kind', params.kind);
    if (params.category && params.category.trim()) qs.set('category', params.category.trim());
    if (params.sort) qs.set('sort', params.sort);
  }
  const query = qs.toString();
  return apiFetch<MarketplaceListing[]>(
    query ? `/marketplace/listings?${query}` : '/marketplace/listings',
  );
}

export async function getMarketplaceListing(
  id: string,
): Promise<ApiResponse<MarketplaceListing>> {
  return apiFetch<MarketplaceListing>(`/marketplace/listings/${id}`);
}

// ── Protégé (capability 'workflows.manage') ─────────────────────────────────
export async function publishToMarketplace(data: {
  kind: MarketplaceKind;
  source_id: string;
  title: string;
  description?: string;
  category?: string;
}): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/marketplace/listings', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function installMarketplaceListing(
  id: string,
): Promise<ApiResponse<{ installed_kind: MarketplaceKind; installed_id: string }>> {
  return apiFetch<{ installed_kind: MarketplaceKind; installed_id: string }>(
    `/marketplace/listings/${id}/install`,
    { method: 'POST' },
  );
}

export async function reviewMarketplaceListing(
  id: string,
  data: { rating: number; comment?: string },
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(
    `/marketplace/listings/${id}/reviews`,
    { method: 'POST', body: JSON.stringify(data) },
  );
}

export async function getMyMarketplaceListings(): Promise<ApiResponse<MarketplaceListing[]>> {
  return apiFetch<MarketplaceListing[]>('/marketplace/my-listings');
}

// ── LOT PROACTIVE-C — IA proactive (alertes churn / NBA / résumés) ───────────
// Lecture + dismiss/seen des alertes générées par le batch cron (côté serveur,
// 100% déterministe). `ApiResponse` INCHANGÉ (jamais `code` — gelé LOT B Team).
// Bornage tenant 100% serveur (WHERE client_id = ?, client_id ∈ auth).
export interface ProactiveAlert {
  id: string;
  client_id: string | null;
  agency_id: string | null;
  kind: 'churn' | 'nba' | 'summary' | string;
  entity_type: 'lead' | 'customer' | string | null;
  entity_id: string | null;
  title: string | null;
  body: string | null;
  status: 'new' | 'seen' | 'dismissed' | 'acted' | string;
  created_at: string | null;
}

export async function getProactiveAlerts(): Promise<ApiResponse<ProactiveAlert[]>> {
  return apiFetch<ProactiveAlert[]>('/ai/proactive/alerts');
}

export async function markProactiveAlertSeen(id: string): Promise<ApiResponse<{ id: string; status: string }>> {
  return apiFetch<{ id: string; status: string }>(`/ai/proactive/alerts/${id}/seen`, {
    method: 'POST',
  });
}

export async function dismissProactiveAlert(id: string): Promise<ApiResponse<{ id: string; status: string }>> {
  return apiFetch<{ id: string; status: string }>(`/ai/proactive/alerts/${id}/dismiss`, {
    method: 'POST',
  });
}

// ── Téléphonie 2-way (LOT TELEPHONY-F) ──────────────────────
// Calque sendSms (ApiResponse INCHANGÉ). Appels Twilio réels = flag inactif côté
// worker (call_log mock sans credentials).

export interface CallLog {
  id: string;
  client_id: string | null;
  agency_id: string | null;
  lead_id: string | null;
  conversation_id: string | null;
  direction: 'inbound' | 'outbound' | string;
  from_number: string | null;
  to_number: string | null;
  status: string;
  duration_sec: number;
  recording_url: string | null;
  transcription: string | null;
  twilio_sid: string | null;
  created_at: string | null;
  // ── Sprint 16 (seq 116) — disposition post-appel + notes libres (ADDITIF) ──
  disposition: string | null;
  notes: string | null;
  // ── Sprint 34 (seq 129) — Twilio Voice recording + transcription + consent ──
  // recording_sid : REcXXX SID Twilio. recording_duration_sec : durée enregistrement
  // (distincte de duration_sec qui couvre l'appel total). recording_r2_key : clé R2
  // pour streamer l'audio post-Twilio retention. transcription_status : enum
  // pending|done|failed|skipped (validé HANDLER). transcription_lang : BCP-47.
  // recording_consent_obtained_at : timestamp ISO du consent bi-party CRTC (NULL =
  // recording INTERDIT par politique handler).
  recording_sid: string | null;
  recording_duration_sec: number | null;
  recording_r2_key: string | null;
  transcription_status: string | null;
  transcription_lang: string | null;
  recording_consent_obtained_at: string | null;
}

// ── Sprint 34 (seq 129) — Voicemails (boîte vocale structurée) ──────────────
// Distincte de messages voice : voicemails matérialise chaque message vocal
// comme entité de premier ordre avec cycle de vie listened_at / deleted_at.
// Bornée tenant (client_id). Soft-delete (deleted_at = now, RGPD trace sans
// hard-delete immédiat). audio_url ajouté par handleGetVoicemail (signed R2
// URL TTL 1h, pas stocké en DB).
export interface Voicemail {
  id: string;
  client_id: string | null;
  agency_id: string | null;
  call_log_id: string | null;
  lead_id: string | null;
  conversation_id: string | null;
  from_number: string | null;
  to_number: string | null;
  recording_url: string | null;
  recording_sid: string | null;
  recording_r2_key: string | null;
  duration_sec: number;
  transcription: string | null;
  transcription_status: string | null;
  transcription_lang: string | null;
  listened_at: string | null;
  listened_by: string | null;
  deleted_at: string | null;
  created_at: string | null;
  // Enriché par handleGetVoicemail (signed R2 URL, non persistée).
  audio_url?: string | null;
  expires_at?: string | null;
  lead_name?: string | null;
}

export interface IvrMenu {
  id: string;
  client_id: string | null;
  agency_id: string | null;
  name: string | null;
  config_json: string | null;
  is_active: number;
  created_at: string | null;
}

// getCallLogs accepte DÉJÀ lead_id (filtre journal d'une fiche lead). Sprint 16 :
// le worker (handleGetCallLogs, Phase B) accepte AUSSI ?disposition= et
// ?direction= (filtres OPTIONNELS du journal global — page Téléphonie). Helper
// inchangé pour la rétro-compat ; Manager-C peut appeler /calls?disposition=…
// via apiFetch directement OU étendre ce helper côté front (NON requis Phase A).
export async function getCallLogs(leadId?: string): Promise<ApiResponse<CallLog[]>> {
  const qs = leadId ? `?lead_id=${encodeURIComponent(leadId)}` : '';
  return apiFetch<CallLog[]>(`/calls${qs}`);
}

// Sprint 16 (seq 116) — disposition post-appel + notes libres sur un call_log.
// ApiResponse INCHANGÉ ({ data } / { error }, jamais `code`). AUCUN client_id
// envoyé (tenant re-borné worker-side). disposition LIBRE (validée HANDLER).
export async function setCallDisposition(
  callLogId: string,
  payload: { disposition?: string; notes?: string },
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/calls/${encodeURIComponent(callLogId)}/disposition`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function placeCall(leadId: string): Promise<ApiResponse<{ id: string | null; status: string; mock?: boolean }>> {
  return apiFetch<{ id: string | null; status: string; mock?: boolean }>('/calls', {
    method: 'POST',
    body: JSON.stringify({ lead_id: leadId }),
  });
}

export async function getIvrMenus(): Promise<ApiResponse<IvrMenu[]>> {
  return apiFetch<IvrMenu[]>('/ivr-menus');
}

export async function saveIvrMenu(data: { id?: string; name: string; config?: unknown; is_active?: boolean }): Promise<ApiResponse<{ id: string; success: boolean }>> {
  return apiFetch<{ id: string; success: boolean }>('/ivr-menus', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteIvrMenu(id: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/ivr-menus/${id}`, {
    method: 'DELETE',
  });
}

// ── Sprint 34 (seq 129) — Twilio Voice outbound + recording + voicemails ────
// Calque pattern getCallLogs/placeCall/setCallDisposition (ApiResponse INCHANGÉ
// — JAMAIS de `code`). Aucun client_id envoyé (tenant re-borné worker-side).
// FLAG INACTIF Twilio côté worker : si pas de credentials → { mock: true }
// dans `data` (call_log row créé quand même).
//
// Capabilities côté worker (RÉUTILISÉES seq80, ZÉRO ajout) :
//   - initiateOutboundCall / toggleCallRecording / getCallRecordingUrl /
//     getVoicemails / getVoicemail / markVoicemailListened : 'leads.write'
//   - deleteCallRecording (RGPD) / deleteVoicemail (RGPD) : 'settings.manage'

/**
 * POST /api/calls/outbound — initie un appel sortant click-to-call avec option
 * d'enregistrement (consent bi-party CRTC obligatoire si record=true).
 * Body : { to, lead_id?, record?, consent_obtained? }.
 */
export async function initiateOutboundCall(payload: {
  to: string;
  lead_id?: string;
  record?: boolean;
  consent_obtained?: boolean;
}): Promise<ApiResponse<{ id: string | null; status: string; mock?: boolean; conversation_id?: string | null }>> {
  return apiFetch<{ id: string | null; status: string; mock?: boolean; conversation_id?: string | null }>(
    '/calls/outbound',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

/**
 * POST /api/calls/:id/record — toggle ON/OFF l'enregistrement d'un appel en
 * cours. enable=true exige consent_obtained=true côté call_log (politique
 * worker), sinon 400 'consent_required'.
 */
export async function toggleCallRecording(
  callLogId: string,
  enable: boolean,
): Promise<ApiResponse<{ success: boolean; recording_sid?: string | null; mock?: boolean }>> {
  return apiFetch<{ success: boolean; recording_sid?: string | null; mock?: boolean }>(
    `/calls/${encodeURIComponent(callLogId)}/record`,
    {
      method: 'POST',
      body: JSON.stringify({ enable }),
    },
  );
}

/**
 * GET /api/calls/:id/recording-url — URL signée R2 temporaire pour streamer
 * l'audio (TTL 1h côté worker). 404 si pas d'enregistrement.
 */
export async function getCallRecordingUrl(
  callLogId: string,
): Promise<ApiResponse<{ url: string; expires_at: string; duration_sec: number; transcription_status: string | null }>> {
  return apiFetch<{ url: string; expires_at: string; duration_sec: number; transcription_status: string | null }>(
    `/calls/${encodeURIComponent(callLogId)}/recording-url`,
  );
}

/**
 * GET /api/voicemails — liste les voicemails du tenant, filtrable.
 * Query : ?unread=true (filtre listened_at IS NULL) &lead_id=xxx &limit=50.
 */
export async function getVoicemails(filters?: {
  unread?: boolean;
  lead_id?: string;
  limit?: number;
}): Promise<ApiResponse<Voicemail[]>> {
  const params = new URLSearchParams();
  if (filters?.unread) params.set('unread', 'true');
  if (filters?.lead_id) params.set('lead_id', filters.lead_id);
  if (typeof filters?.limit === 'number') params.set('limit', String(filters.limit));
  const qs = params.toString();
  return apiFetch<Voicemail[]>(`/voicemails${qs ? `?${qs}` : ''}`);
}

/**
 * GET /api/voicemails/:id — détail d'un voicemail (avec audio_url signée R2
 * incluse si recording_r2_key présent).
 */
export async function getVoicemail(id: string): Promise<ApiResponse<Voicemail>> {
  return apiFetch<Voicemail>(`/voicemails/${encodeURIComponent(id)}`);
}

/**
 * POST /api/voicemails/:id/listen — marque un voicemail comme écouté.
 * Idempotent côté worker (COALESCE listened_at).
 */
export async function markVoicemailListened(
  id: string,
): Promise<ApiResponse<{ success: boolean; listened_at: string; listened_by: string }>> {
  return apiFetch<{ success: boolean; listened_at: string; listened_by: string }>(
    `/voicemails/${encodeURIComponent(id)}/listen`,
    { method: 'POST' },
  );
}

/**
 * DELETE /api/voicemails/:id — suppression soft (deleted_at = now) + cascade
 * delete RGPD (deleteTwilioRecording + deleteR2Recording côté worker).
 * Cap 'settings.manage' côté worker.
 */
export async function deleteVoicemail(id: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/voicemails/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ════════════════════════════════════════════════════════════════════════════
// LOT STOREFRONT CHECKOUT (Sprint 7) — helpers tunnel acheteur PUBLIC.
//
// Helpers ADDITIFS — signatures FIGÉES Phase A (corps réels Phase B Manager-B
// dans storefront-public.ts ; front Phase C Manager-C dans PublicStore.tsx /
// PublicCheckout.tsx). apiFetch / ApiResponse INCHANGÉS (JAMAIS `code` — §6.A).
//
// ⚠ Les helpers STOREFRONT PUBLICS utilisent `fetch` BRUT contre `${API_BASE}`
//   (calque EXACT getPublicFunnel / submitPublicFunnel : retour normalisé
//   { data } | { error }, `t('api.unavailable')` sur exception). JAMAIS apiFetch
//   (qui injecte le token ADMIN — fuite d'auth interdite sur des routes
//   publiques). Le cart_token est passé EXPLICITEMENT (query/header), persisté
//   côté front en localStorage. Les helpers PRO (getStoreSettings /
//   saveStoreSettings) utilisent apiFetch (auth CRM, capability boutique côté
//   worker). Contrat figé docs/LOT-STOREFRONT-CHECKOUT.md §6.A.
// ════════════════════════════════════════════════════════════════════════════

/** Vitrine PUBLIQUE : liste des produits actifs de la boutique `slug`. */
export async function getStoreProducts(
  slug: string,
): Promise<ApiResponse<{ store: StoreSettings; products: StorefrontProduct[] }>> {
  try {
    const res = await fetch(`${API_BASE}/store/${encodeURIComponent(slug)}/products`);
    const data = (await res.json()) as ApiResponse<{ store: StoreSettings; products: StorefrontProduct[] }>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

/** Fiche produit PUBLIQUE par slug produit `pslug` dans la boutique `slug`. */
export async function getStoreProduct(
  slug: string,
  pslug: string,
): Promise<ApiResponse<StorefrontProduct>> {
  try {
    const res = await fetch(
      `${API_BASE}/store/${encodeURIComponent(slug)}/products/${encodeURIComponent(pslug)}`,
    );
    const data = (await res.json()) as ApiResponse<StorefrontProduct>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

/** Récupère le panier PUBLIC ciblé par `cartToken` (vide/nouveau si absent). */
export async function getStoreCart(
  slug: string,
  cartToken: string | null,
): Promise<ApiResponse<PublicCart>> {
  try {
    const qs = cartToken ? `?token=${encodeURIComponent(cartToken)}` : '';
    const res = await fetch(`${API_BASE}/store/${encodeURIComponent(slug)}/cart${qs}`);
    const data = (await res.json()) as ApiResponse<PublicCart>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

/** Ajoute une variante au panier PUBLIC. `cartToken` null = le worker en crée un. */
export async function addStoreCartItem(
  slug: string,
  cartToken: string | null,
  item: { product_id: string; variant_id?: string; qty: number },
): Promise<ApiResponse<PublicCart>> {
  try {
    const res = await fetch(`${API_BASE}/store/${encodeURIComponent(slug)}/cart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...item, token: cartToken || undefined }),
    });
    const data = (await res.json()) as ApiResponse<PublicCart>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

/** Met à jour la quantité d'une ligne (0 = retire) du panier PUBLIC. */
export async function updateStoreCartItem(
  slug: string,
  cartToken: string,
  itemId: string,
  qty: number,
): Promise<ApiResponse<PublicCart>> {
  try {
    const res = await fetch(
      `${API_BASE}/store/${encodeURIComponent(slug)}/cart/${encodeURIComponent(itemId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty, token: cartToken }),
      },
    );
    const data = (await res.json()) as ApiResponse<PublicCart>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

/** Retire une ligne du panier PUBLIC. */
export async function removeStoreCartItem(
  slug: string,
  cartToken: string,
  itemId: string,
): Promise<ApiResponse<PublicCart>> {
  try {
    const res = await fetch(
      `${API_BASE}/store/${encodeURIComponent(slug)}/cart/${encodeURIComponent(itemId)}?token=${encodeURIComponent(cartToken)}`,
      { method: 'DELETE' },
    );
    const data = (await res.json()) as ApiResponse<PublicCart>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

/**
 * Devis de livraison PUBLIC pour l'adresse fournie (réutilise resolveShippingRate
 * + computeTax côté worker). Retour : frais de port + aperçu taxes/total.
 */
export async function getStoreShippingQuote(
  slug: string,
  cartToken: string,
  address: CheckoutInput['address'],
): Promise<ApiResponse<{
  shipping_cents: number;
  shipping_name: string | null;
  tax_cents: number;
  subtotal_cents: number;
  total_cents: number;
  currency?: string;
}>> {
  try {
    const res = await fetch(`${API_BASE}/store/${encodeURIComponent(slug)}/shipping-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: cartToken, address }),
    });
    const data = (await res.json()) as ApiResponse<{
      shipping_cents: number;
      shipping_name: string | null;
      tax_cents: number;
      subtotal_cents: number;
      total_cents: number;
      currency?: string;
    }>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

/**
 * Checkout PUBLIC : convertit le panier en commande via createOrderCore (guest,
 * source 'storefront'), paiement MOCK (E4/E6 inactif). Renvoie order_id +
 * statut ('pending'/'unpaid', JAMAIS inventé).
 */
export async function storeCheckout(
  slug: string,
  payload: CheckoutInput,
): Promise<ApiResponse<CheckoutResult>> {
  try {
    const res = await fetch(`${API_BASE}/store/${encodeURIComponent(slug)}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as ApiResponse<CheckoutResult>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

/** Récupère une commande PUBLIQUE (écran de confirmation) par id, bornée slug. */
export async function getStoreOrder(
  slug: string,
  orderId: string,
): Promise<ApiResponse<CheckoutResult & { items?: Array<{ name: string; qty: number; price_cents: number }> }>> {
  try {
    const res = await fetch(
      `${API_BASE}/store/${encodeURIComponent(slug)}/order/${encodeURIComponent(orderId)}`,
    );
    const data = (await res.json()) as ApiResponse<
      CheckoutResult & { items?: Array<{ name: string; qty: number; price_cents: number }> }
    >;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

// ── PRO (apiFetch — auth CRM, capability boutique côté worker) ───────────────

/** Réglages vitrine du tenant (gestion PRO). GET /store-settings. */
export async function getStoreSettings(): Promise<ApiResponse<StoreSettings>> {
  return apiFetch<StoreSettings>('/store-settings');
}

/** Active/configure la vitrine du tenant (gestion PRO). POST /store-settings. */
export async function saveStoreSettings(
  payload: Partial<StoreSettings>,
): Promise<ApiResponse<StoreSettings>> {
  return apiFetch<StoreSettings>('/store-settings', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ════════════════════════════════════════════════════════════════════════════
// LOT REPUTATION (Sprint 8) — collecte 1st-party + routing intelligent.
//
// Helpers ADDITIFS — signatures FIGÉES Phase A (corps réels Phase B Manager-B
// dans reputation-public.ts / reputation.ts ; front Phase C Manager-C dans
// PublicReview.tsx / Reviews.tsx). apiFetch / ApiResponse INCHANGÉS (JAMAIS
// `code` — §6.A).
//
// ⚠ Les helpers PUBLICS (page de dépôt d'avis hébergée Intralys) utilisent
//   `fetch` BRUT contre `${API_BASE}` (calque EXACT getPublicFunnel /
//   submitPublicFunnel : retour normalisé { data } | { error },
//   `t('api.unavailable')` sur exception). JAMAIS apiFetch (qui injecte le token
//   ADMIN — fuite d'auth interdite sur des routes publiques). Le token
//   d'invitation est porté DANS l'URL (/r/:token). Les helpers PRO
//   (getReputationSettings / updateReputationSettings / getPrivateFeedback)
//   utilisent apiFetch (auth CRM, capability réputation côté worker).
//   Contrat figé docs/LOT-REPUTATION.md §6.A.
// ════════════════════════════════════════════════════════════════════════════

// ── PUBLICS (fetch BRUT, sans auth — calque getPublicFunnel) ────────────────

/** Page PUBLIQUE de dépôt d'avis résolue par TOKEN. GET /api/r/:token. */
export async function getPublicReviewPage(
  token: string,
): Promise<ApiResponse<PublicReviewPage>> {
  try {
    const res = await fetch(`${API_BASE}/r/${encodeURIComponent(token)}`);
    const data = (await res.json()) as ApiResponse<PublicReviewPage>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

/**
 * Dépose un avis PUBLIC (note + commentaire) sur l'invitation `token`. Le worker
 * applique le ROUTING INTELLIGENT : note ≥ seuil ⇒ renvoie `redirect_url`
 * (Google/FB) ; note < seuil ⇒ `routed='private'` + écran remerciement. Le front
 * ne connaît JAMAIS le seuil. POST /api/r/:token/submit.
 */
export async function submitPublicReview(
  token: string,
  payload: { rating: number; comment?: string },
): Promise<ApiResponse<{ routed: string; redirect_url?: string | null; message?: string }>> {
  try {
    const res = await fetch(`${API_BASE}/r/${encodeURIComponent(token)}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as ApiResponse<{
      routed: string; redirect_url?: string | null; message?: string;
    }>;
    if (!res.ok) return { error: data.error || `Erreur ${res.status}` };
    return data;
  } catch {
    return { error: t('api.unavailable') };
  }
}

// ── PRO (apiFetch — auth CRM, capability réputation côté worker) ─────────────

/** Réglages réputation du tenant (gestion PRO). GET /api/reputation/settings. */
export async function getReputationSettings(): Promise<ApiResponse<ReputationSettings>> {
  return apiFetch<ReputationSettings>('/reputation/settings');
}

/** Met à jour les réglages réputation (seuil, URL publique, notif). PATCH /api/reputation/settings. */
export async function updateReputationSettings(
  payload: Partial<ReputationSettings>,
): Promise<ApiResponse<ReputationSettings>> {
  return apiFetch<ReputationSettings>('/reputation/settings', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/** Liste le feedback privé (note < seuil, jamais publié). GET /api/reputation/private-feedback. */
export async function getPrivateFeedback(): Promise<ApiResponse<PrivateFeedback[]>> {
  return apiFetch<PrivateFeedback[]>('/reputation/private-feedback');
}

// ── LOT SOCIAL PLANNER (Sprint 9) — helpers FIGÉS Phase A ───────────────────
// Tous PRO (apiFetch — auth CRM, capability worker) : posts/file →
// 'workflows.manage', génération IA → 'ai.use', connexions → 'settings.manage'.
// Succès { data } / erreur { error } (JAMAIS de champ `code`). Signatures FIGÉES :
// Phase C les CONSOMME tels quels, Phase B câble les corps des routes. Publication
// réelle + analytics = MOCK / flag INACTIF (connectSocialAccount renvoie l'URL
// OAuth ou une erreur flag-inactif). Contrat figé docs/LOT-SOCIAL-PLANNER.md §6.

/** Connexions sociales du tenant (tokens JAMAIS exposés). GET /api/social/accounts. */
export async function getSocialAccounts(): Promise<ApiResponse<SocialAccount[]>> {
  return apiFetch<SocialAccount[]>('/social/accounts');
}

/**
 * Lance la connexion OAuth d'un réseau social. Renvoie l'URL d'autorisation
 * (`{ data: { url } }`) si le provider est configuré, sinon une erreur
 * flag-inactif (`{ error }` 400 — credentials OAuth social absents, calque
 * oauth.ts:handleOauthAuthorize). POST /api/social/accounts/connect.
 */
export async function connectSocialAccount(
  provider: SocialProvider,
): Promise<ApiResponse<{ url: string }>> {
  return apiFetch<{ url: string }>('/social/accounts/connect', {
    method: 'POST',
    body: JSON.stringify({ provider }),
  });
}

/** Déconnecte une connexion sociale (re-borne tenant). DELETE /api/social/accounts/:id. */
export async function disconnectSocialAccount(
  id: string,
): Promise<ApiResponse<{ deleted: boolean }>> {
  return apiFetch<{ deleted: boolean }>(`/social/accounts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** Liste les posts du Social planner (optionnellement filtrés par statut). GET /api/social/posts. */
export async function getSocialPosts(
  params?: { status?: string },
): Promise<ApiResponse<SocialPost[]>> {
  const qs = params?.status ? `?status=${encodeURIComponent(params.status)}` : '';
  return apiFetch<SocialPost[]>(`/social/posts${qs}`);
}

/** Crée un post (brouillon ou planifié). POST /api/social/posts. */
export async function createSocialPost(
  payload: { content: string; media?: string[]; networks?: SocialProvider[]; scheduled_at?: string | null },
): Promise<ApiResponse<SocialPost>> {
  return apiFetch<SocialPost>('/social/posts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Met à jour un post (contenu, médias, réseaux, planification). PATCH /api/social/posts/:id. */
export async function updateSocialPost(
  id: string,
  payload: Partial<{ content: string; media: string[]; networks: SocialProvider[]; scheduled_at: string | null; status: string }>,
): Promise<ApiResponse<SocialPost>> {
  return apiFetch<SocialPost>(`/social/posts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/** Supprime un post (re-borne tenant). DELETE /api/social/posts/:id. */
export async function deleteSocialPost(
  id: string,
): Promise<ApiResponse<{ deleted: boolean }>> {
  return apiFetch<{ deleted: boolean }>(`/social/posts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** Planifie un post (status → 'queued', scheduled_at). POST /api/social/posts/:id/schedule. */
export async function scheduleSocialPost(
  id: string,
  scheduled_at: string,
): Promise<ApiResponse<SocialPost>> {
  return apiFetch<SocialPost>(`/social/posts/${encodeURIComponent(id)}/schedule`, {
    method: 'POST',
    body: JSON.stringify({ scheduled_at }),
  });
}

/** Génère un brouillon de post via IA (Claude). POST /api/social/generate. */
export async function generateSocialPost(
  payload: { prompt: string; network?: SocialProvider },
): Promise<ApiResponse<{ content: string }>> {
  return apiFetch<{ content: string }>('/social/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ── SPRINT 12 « IA contenu — atelier centralisé » (helpers FIGÉS Phase A) ───
// Routes /api/ai/content/* GARDÉES (auth + capGuard ai.use côté worker). AUCUN
// client_id envoyé dans le body : le worker borne le tenant depuis l'AUTH (le
// legacy /api/ai/generate lit client_id du body = smell NON reproduit ici).
// apiFetch / ApiResponse GELÉS — succès { data }, erreur { error }, jamais code.

/** Mode de réécriture inline d'un contenu (validé HANDLER côté worker). */
export type AiRewriteMode =
  | 'improve' | 'shorten' | 'expand' | 'formalize' | 'casualize' | 'retone';

/** Génère un contenu via le moteur IA centralisé. POST /api/ai/content/generate. */
export async function generateAiContent(
  payload: { format: AiContentFormat; brief: string; tone_preset_id?: string },
): Promise<ApiResponse<{ content: string; source_action?: string }>> {
  return apiFetch<{ content: string; source_action?: string }>('/ai/content/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Réécrit un contenu existant. POST /api/ai/content/rewrite. */
export async function rewriteAiContent(
  payload: { content: string; mode: AiRewriteMode },
): Promise<ApiResponse<{ content: string }>> {
  return apiFetch<{ content: string }>('/ai/content/rewrite', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Liste la bibliothèque de contenus (tenant-bornée). GET /api/ai/content/items. */
export async function getAiContentItems(
  params?: { format?: AiContentFormat; status?: string },
): Promise<ApiResponse<{ items: AiContentItem[] }>> {
  const qs = new URLSearchParams();
  if (params?.format) qs.set('format', params.format);
  if (params?.status) qs.set('status', params.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<{ items: AiContentItem[] }>(`/ai/content/items${suffix}`, {
    method: 'GET',
  });
}

/** Crée/sauvegarde un contenu dans la bibliothèque. POST /api/ai/content/items. */
export async function saveAiContentItem(
  payload: {
    format: AiContentFormat; content: string; title?: string; brief?: string;
    tone_preset_id?: string; source_action?: string; status?: string;
  },
): Promise<ApiResponse<{ item: AiContentItem }>> {
  return apiFetch<{ item: AiContentItem }>('/ai/content/items', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Supprime un contenu (re-borne tenant). DELETE /api/ai/content/items/:id. */
export async function deleteAiContentItem(
  id: string,
): Promise<ApiResponse<{ deleted: boolean }>> {
  return apiFetch<{ deleted: boolean }>(`/ai/content/items/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** Pont IA→templates : crée un email/sms template depuis un contenu sauvegardé.
 *  POST /api/ai/content/items/:id/use-as-template. */
export async function useAsTemplate(
  id: string,
): Promise<ApiResponse<{ template_id: string; kind: string }>> {
  return apiFetch<{ template_id: string; kind: string }>(
    `/ai/content/items/${encodeURIComponent(id)}/use-as-template`,
    { method: 'POST' },
  );
}

/** Liste les presets de voix de marque du tenant. GET /api/ai/content/brand-voices. */
export async function getBrandVoices(): Promise<ApiResponse<{ voices: AiBrandVoice[] }>> {
  return apiFetch<{ voices: AiBrandVoice[] }>('/ai/content/brand-voices', {
    method: 'GET',
  });
}

/** Crée un preset de voix de marque. POST /api/ai/content/brand-voices. */
export async function createBrandVoice(
  payload: { name: string; description?: string; is_default?: boolean },
): Promise<ApiResponse<{ voice: AiBrandVoice }>> {
  return apiFetch<{ voice: AiBrandVoice }>('/ai/content/brand-voices', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Met à jour un preset (re-borne tenant). PATCH /api/ai/content/brand-voices/:id. */
export async function updateBrandVoice(
  id: string,
  payload: { name?: string; description?: string; is_default?: boolean },
): Promise<ApiResponse<{ voice: AiBrandVoice }>> {
  return apiFetch<{ voice: AiBrandVoice }>(`/ai/content/brand-voices/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/** Supprime un preset (re-borne tenant). DELETE /api/ai/content/brand-voices/:id. */
export async function deleteBrandVoice(
  id: string,
): Promise<ApiResponse<{ deleted: boolean }>> {
  return apiFetch<{ deleted: boolean }>(`/ai/content/brand-voices/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ── SPRINT 13 — Scoring prédictif calibré tenant (conversion-scoring) ────────
// apiFetch / ApiResponse GELÉS. Le tenant est re-borné WORKER-SIDE (aucun
// client_id envoyé par ces helpers). Signatures FIGÉES Phase A.

/**
 * Score de conversion CALIBRÉ d'un lead (proba ajustée sur l'historique won/lost
 * du tenant). GET /api/leads/:id/conversion-score. Réutilise la base déterministe
 * lead-predict EN LECTURE — corps réel câblé Phase B (conversion-engine.ts).
 */
export async function getLeadConversionScore(
  leadId: string,
): Promise<ApiResponse<ConversionPrediction>> {
  return apiFetch<ConversionPrediction>(`/leads/${leadId}/conversion-score`);
}

/**
 * (Optionnel) Baselines de conversion agrégées du tenant (par source/status/
 * bucket). GET /api/conversion/baselines. Tenant re-borné worker-side.
 */
export async function getConversionBaselines(): Promise<
  ApiResponse<{ baselines: ConversionBaseline[] }>
> {
  return apiFetch<{ baselines: ConversionBaseline[] }>('/conversion/baselines');
}

// ── LOT FORECASTING — projection + objectifs + scénarios (Sprint 14) ─────────
// apiFetch/ApiResponse GELÉS — succès { data }, erreur { error }, JAMAIS `code`.
// AUCUN helper n'envoie de client_id (tenant re-borné worker-side). Signatures
// FIGÉES Phase A — Manager-C les CONSOMME, n'en AJOUTE PAS.

/**
 * Forecast enrichi (projection + scénarios + group-by). Signature FIGÉE Phase A.
 * GET /api/forecast (+ querystring). group_by ∈ 'month'|'rep'|'source' (validé
 * worker-side). NE PAS confondre avec GET /api/pipelines/:id/forecast (existant,
 * forecast pondéré naïf — INTOUCHÉ).
 */
export async function getForecast(params?: {
  pipeline_id?: string;
  group_by?: 'month' | 'rep' | 'source';
  period?: string;
}): Promise<ApiResponse<ForecastResponse>> {
  const qs = new URLSearchParams();
  if (params?.pipeline_id) qs.set('pipeline_id', params.pipeline_id);
  if (params?.group_by) qs.set('group_by', params.group_by);
  if (params?.period) qs.set('period', params.period);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<ForecastResponse>(`/forecast${suffix}`);
}

/** Objectifs / quotas de revenu du tenant. GET /api/forecast/targets. */
export async function getForecastTargets(params?: {
  pipeline_id?: string;
  period?: string;
}): Promise<ApiResponse<{ targets: ForecastTarget[] }>> {
  const qs = new URLSearchParams();
  if (params?.pipeline_id) qs.set('pipeline_id', params.pipeline_id);
  if (params?.period) qs.set('period', params.period);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<{ targets: ForecastTarget[] }>(`/forecast/targets${suffix}`);
}

/** Crée un objectif / quota de revenu. POST /api/forecast/targets. */
export async function createForecastTarget(payload: {
  pipeline_id?: string | null;
  assigned_to?: string | null;
  period_month: string;
  target_amount: number;
}): Promise<ApiResponse<{ id: string }>> {
  return apiFetch<{ id: string }>('/forecast/targets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Supprime un objectif / quota de revenu. DELETE /api/forecast/targets/:id. */
export async function deleteForecastTarget(
  id: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/forecast/targets/${id}`, {
    method: 'DELETE',
  });
}

// ── SPRINT 15 — Reports builder : templates de dashboard clonables ───────────
// Signatures FIGÉES Phase A. apiFetch/ApiResponse INCHANGÉS. AUCUN client_id
// envoyé (tenant re-borné worker-side depuis l'auth).

/** Catalogue des modèles de dashboard (système + tenant). GET /api/report-templates. */
export async function getReportTemplates(): Promise<ApiResponse<ReportTemplate[]>> {
  return apiFetch<ReportTemplate[]>('/report-templates');
}

/** Clone un modèle → nouveau dashboard. POST /api/report-templates/:id/apply. */
export async function applyReportTemplate(
  id: string,
): Promise<ApiResponse<{ dashboard_id: string }>> {
  return apiFetch<{ dashboard_id: string }>('/report-templates/' + id + '/apply', {
    method: 'POST',
  });
}

// ── Sprint 21 — Onboarding durci : checklist serveur (seq119) ───────────────
// Persistance D1 via `onboarding_state.checklist_items_json` / `skipped_items_json`
// + table `onboarding_events`. Best-effort dégradé : si la migration seq119
// n'est pas jouée, le worker renvoie un shape vide valide ({ items:{}, ... }).
// Pattern apiFetch identique aux fonctions S8 ci-dessus (getOnboardingState /
// putOnboardingState).

export async function getOnboardingChecklist(): Promise<ApiResponse<OnboardingChecklistResponse>> {
  return apiFetch<OnboardingChecklistResponse>('/onboarding/checklist');
}

export async function completeOnboardingItem(
  itemKey: OnboardingChecklistItemKey,
): Promise<ApiResponse<OnboardingChecklistResponse>> {
  return apiFetch<OnboardingChecklistResponse>('/onboarding/checklist/complete', {
    method: 'POST',
    body: JSON.stringify({ itemKey }),
  });
}

export async function skipOnboardingItem(
  itemKey: OnboardingChecklistItemKey,
  reason?: string,
): Promise<ApiResponse<OnboardingChecklistResponse>> {
  return apiFetch<OnboardingChecklistResponse>('/onboarding/checklist/skip', {
    method: 'POST',
    body: JSON.stringify(reason !== undefined ? { itemKey, reason } : { itemKey }),
  });
}

export async function resetOnboardingChecklist(): Promise<ApiResponse<OnboardingChecklistResponse>> {
  return apiFetch<OnboardingChecklistResponse>('/onboarding/checklist/reset', {
    method: 'POST',
  });
}

// ── Sprint 22 — Billing Stripe prod (E4 flag mock) ──────────────────────────
// 9 endpoints SaaS billing (DISTINCT du namespace E4 marchand). En V1 tous
// retournent `mock:true`. Manager-C consomme depuis BillingPlanPanel /
// PlanSelector / BillingPortalButton / BillingInvoicesList / WebhookConfigPanel.

import type {
  BillingPlanCatalog,
  ClientSubscription,
  BillingUsage,
  BillingPortalSession,
  BillingInvoiceMock,
  BillingWebhookConfig,
} from './types';
import type {
  BillingSubscriptionChangeBody,
  BillingPortalSessionBody,
  BillingCancelBody,
} from './schemas';

export async function getBillingPlans(): Promise<ApiResponse<BillingPlanCatalog[]>> {
  return apiFetch<BillingPlanCatalog[]>('/billing/plans');
}

export async function getCurrentSubscription(): Promise<ApiResponse<ClientSubscription>> {
  return apiFetch<ClientSubscription>('/billing/subscription');
}

export async function listBillingSubscriptions(): Promise<ApiResponse<ClientSubscription[]>> {
  return apiFetch<ClientSubscription[]>('/billing/subscriptions');
}

export async function changeSubscriptionPlan(
  body: BillingSubscriptionChangeBody,
): Promise<ApiResponse<{
  success: boolean;
  mock?: boolean;
  reason?: string;
  subscription: ClientSubscription;
}>> {
  return apiFetch('/billing/subscription/change', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function cancelSubscription(
  body: BillingCancelBody,
): Promise<ApiResponse<{ success: boolean; mock?: boolean }>> {
  return apiFetch('/billing/subscription/cancel', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function resumeSubscription(): Promise<ApiResponse<{ success: boolean; mock?: boolean }>> {
  return apiFetch('/billing/subscription/resume', { method: 'POST' });
}

export async function createBillingPortalSession(
  body: BillingPortalSessionBody = {},
): Promise<ApiResponse<BillingPortalSession>> {
  return apiFetch<BillingPortalSession>('/billing/portal-session', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function getBillingUsage(): Promise<ApiResponse<BillingUsage>> {
  return apiFetch<BillingUsage>('/billing/usage');
}

export async function listBillingInvoices(): Promise<ApiResponse<BillingInvoiceMock[]>> {
  return apiFetch<BillingInvoiceMock[]>('/billing/invoices');
}

export async function getBillingWebhookConfig(): Promise<ApiResponse<BillingWebhookConfig>> {
  return apiFetch<BillingWebhookConfig>('/billing/webhook-config');
}

// ── Sprint 23 — Sécurité / conformité ────────────────────────────────────
// Cookies
export async function getCookieConsent(): Promise<ApiResponse<CookieConsentRecord | null>> {
  return apiFetch<CookieConsentRecord | null>('/cookies/consent/me');
}
export async function postCookieConsent(input: {
  anonymous_id: string;
  categories: CookieConsent;
  policy_version?: string;
  url?: string;
}): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch('/cookies/consent', { method: 'POST', body: JSON.stringify(input) });
}

// Mes données (Loi 25)
export async function getMyDataExport(): Promise<ApiResponse<MyDataExport>> {
  return apiFetch<MyDataExport>('/me/export-data');
}
export async function getMyDeletionRequest(): Promise<ApiResponse<AccountDeletionRequest | null>> {
  return apiFetch<AccountDeletionRequest | null>('/me/delete-account');
}
export async function requestAccountDeletion(reason: string | undefined, confirm_email: string): Promise<ApiResponse<AccountDeletionRequest>> {
  return apiFetch<AccountDeletionRequest>('/me/delete-account', { method: 'POST', body: JSON.stringify({ reason, confirm_email }) });
}
export async function cancelAccountDeletion(): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch('/me/delete-account/cancel', { method: 'POST' });
}

// Admin
export async function getAuditLog(query: AuditLogQuery): Promise<ApiResponse<AuditLogEntry[]>> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null) params.set(k, String(v)); });
  return apiFetch<AuditLogEntry[]>(`/admin/audit-log?${params.toString()}`);
}
export async function getCapabilityOverrides(userId: string): Promise<ApiResponse<CapabilityOverride[]>> {
  return apiFetch<CapabilityOverride[]>(`/admin/capability-overrides/${encodeURIComponent(userId)}`);
}
export async function setCapabilityOverride(userId: string, capability: string, granted: boolean): Promise<ApiResponse<CapabilityOverride>> {
  return apiFetch<CapabilityOverride>(`/admin/capability-overrides/${encodeURIComponent(userId)}`, { method: 'POST', body: JSON.stringify({ capability, granted }) });
}
export async function deleteCapabilityOverride(userId: string, capability: string): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch(`/admin/capability-overrides/${encodeURIComponent(userId)}/${encodeURIComponent(capability)}`, { method: 'DELETE' });
}

// ── Sprint 24 — Observabilité ────────────────────────────────────────────
// 8 fonctions miroir des routes worker /api/admin/observability/*.
// `unavailable: true` est un fallback best-effort (200) — l'UI doit afficher
// "Métriques indisponibles" sans casser le rendu.

export async function fetchObservabilityHealth(): Promise<ApiResponse<ObservabilityHealth>> {
  return apiFetch<ObservabilityHealth>('/admin/observability/health');
}

export async function fetchRequestMetrics(period: '1h' | '24h' | '7d' | '30d' = '24h'): Promise<ApiResponse<{ metrics: RequestMetricsBucket[]; unavailable?: boolean }>> {
  return apiFetch<{ metrics: RequestMetricsBucket[]; unavailable?: boolean }>(`/admin/observability/request-metrics?period=${encodeURIComponent(period)}`);
}

export async function fetchErrorMetrics(period: '1h' | '24h' | '7d' | '30d' = '24h'): Promise<ApiResponse<{ errors: Array<{ action: string; count: number; last_at: string }>; unavailable?: boolean }>> {
  return apiFetch<{ errors: Array<{ action: string; count: number; last_at: string }>; unavailable?: boolean }>(`/admin/observability/errors?period=${encodeURIComponent(period)}`);
}

export async function fetchWebVitalsObservability(period: '24h' | '7d' | '30d' = '24h'): Promise<ApiResponse<{ metrics: Array<{ metric_name: string; count: number; avg: number; p75: number }>; period: string; since: string }>> {
  return apiFetch<{ metrics: Array<{ metric_name: string; count: number; avg: number; p75: number }>; period: string; since: string }>(`/admin/observability/web-vitals?period=${encodeURIComponent(period)}`);
}

export async function fetchAlerts(): Promise<ApiResponse<{ rules: AlertRule[]; events: AlertEvent[] }>> {
  return apiFetch<{ rules: AlertRule[]; events: AlertEvent[] }>('/admin/observability/alerts');
}

export async function createAlertRule(body: {
  name: string;
  condition_type: AlertConditionType;
  metric_name?: string | null;
  threshold: number;
  window_minutes?: number;
  notification_channel?: AlertChannel;
  notification_target?: string;
  enabled?: boolean;
}): Promise<ApiResponse<{ rule: AlertRule }>> {
  return apiFetch<{ rule: AlertRule }>('/admin/observability/alert-rules', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateAlertRule(id: string, body: Partial<Parameters<typeof createAlertRule>[0]>): Promise<ApiResponse<{ rule: AlertRule }>> {
  return apiFetch<{ rule: AlertRule }>(`/admin/observability/alert-rules/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function deleteAlertRule(id: string): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch<{ ok: true }>(`/admin/observability/alert-rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── Sprint 30 — Release Candidate / Beta ──────────────────────────────────
export async function fetchReleaseGates(): Promise<ApiResponse<ReleaseGatesStatus>> {
  return apiFetch<ReleaseGatesStatus>('/admin/release-gates');
}

// ── Sprint 31 — Stripe live activation ──────────────────────────────────
// 6 endpoints live billing. Calque pattern Sprint 22. En V1 (activation
// graduée) tous gardent `mock:true` tant que STRIPE_SECRET_KEY absente +
// flag `BILLING_LIVE_ENABLED` tenant non levé. Manager-C consomme depuis
// StripeConnectPanel / PaymentMethodsList / AddPaymentMethodForm.
import type {
  StripePaymentMethod,
  StripeSetupIntent,
  StripeConnectAccount,
  StripeConnectOnboardingLink,
} from './types';

export async function getStripeConnectStatus(): Promise<ApiResponse<StripeConnectAccount | null>> {
  return apiFetch<StripeConnectAccount | null>('/billing/connect/status');
}

export async function createStripeConnectOnboarding(
  body: { refreshUrl?: string; returnUrl?: string } = {},
): Promise<ApiResponse<StripeConnectOnboardingLink>> {
  return apiFetch<StripeConnectOnboardingLink>('/billing/connect/onboard', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function listStripePaymentMethods(): Promise<ApiResponse<StripePaymentMethod[]>> {
  return apiFetch<StripePaymentMethod[]>('/billing/payment-methods');
}

export async function createStripeSetupIntent(): Promise<ApiResponse<StripeSetupIntent>> {
  return apiFetch<StripeSetupIntent>('/billing/payment-methods/setup-intent', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function setDefaultStripePaymentMethod(
  pmId: string,
): Promise<ApiResponse<StripePaymentMethod>> {
  return apiFetch<StripePaymentMethod>(
    `/billing/payment-methods/${encodeURIComponent(pmId)}/default`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export async function deleteStripePaymentMethod(
  pmId: string,
): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch<{ ok: true }>(
    `/billing/payment-methods/${encodeURIComponent(pmId)}`,
    { method: 'DELETE' },
  );
}

// ── Sprint 32 — Google Business Profile (GBP) integration ────────────────
// 10 endpoints front pour OAuth GBP + locations + reviews + posts + insights.
// Calque pattern Sprint 31 (import type inline + apiFetch). Backend handlers
// dans Worker (Agent A2/A3/A4). UI Agents C1/C2/C3/C4.
import type { GbpConnection, GbpLocation, GbpInsights } from './types';

export async function connectGbp(): Promise<ApiResponse<{ url: string }>> {
  return apiFetch<{ url: string }>('/gbp/oauth/start');
}
export async function getGbpConnections(): Promise<ApiResponse<GbpConnection[]>> {
  return apiFetch<GbpConnection[]>('/gbp/connections');
}
export async function disconnectGbp(connectionId: string): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch(`/gbp/connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE' });
}
export async function getGbpLocations(accountId?: string): Promise<ApiResponse<GbpLocation[]>> {
  const q = accountId ? `?account_id=${encodeURIComponent(accountId)}` : '';
  return apiFetch<GbpLocation[]>(`/gbp/locations${q}`);
}
export async function setDefaultGbpLocation(locationId: string): Promise<ApiResponse<GbpLocation>> {
  return apiFetch<GbpLocation>(`/gbp/locations/${encodeURIComponent(locationId)}/default`, { method: 'POST', body: JSON.stringify({}) });
}
export async function getGbpReviews(locationId: string): Promise<ApiResponse<any[]>> {
  return apiFetch(`/gbp/reviews?location_id=${encodeURIComponent(locationId)}`);
}
export async function replyGbpReview(reviewName: string, comment: string): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch(`/gbp/reviews/${encodeURIComponent(reviewName)}/reply`, { method: 'POST', body: JSON.stringify({ comment }) });
}
export async function syncGbpReviews(): Promise<ApiResponse<{ processed: number; errors: number }>> {
  return apiFetch('/gbp/sync/reviews', { method: 'POST', body: JSON.stringify({}) });
}
export async function createGbpPost(input: { locationId: string; summary: string; topicType?: string; callToAction?: any; mediaUrl?: string }): Promise<ApiResponse<{ ok: true; localPostName?: string }>> {
  return apiFetch('/gbp/posts', { method: 'POST', body: JSON.stringify(input) });
}
export async function getGbpInsights(locationId: string, start: string, end: string): Promise<ApiResponse<GbpInsights>> {
  return apiFetch<GbpInsights>(`/gbp/insights?location_id=${encodeURIComponent(locationId)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
}

// ── Sprint 33 — Calendar sync ──────────────────────────────────────────
import type { CalendarConnection, CalendarConflict } from './types';

export async function getCalendarConnections(): Promise<ApiResponse<CalendarConnection[]>> {
  return apiFetch<CalendarConnection[]>('/calendar-connections');
}
export async function connectGcalSync(): Promise<ApiResponse<{ url: string }>> {
  return apiFetch<{ url: string }>('/oauth/gcal_sync/authorize', { method: 'POST', body: JSON.stringify({}) });
}
export async function connectOutlookSync(): Promise<ApiResponse<{ url: string }>> {
  return apiFetch<{ url: string }>('/oauth/outlook/authorize', { method: 'POST', body: JSON.stringify({}) });
}
export async function disconnectCalendarConnection(id: string): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch(`/calendar-connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export async function listExternalCalendars(connId: string): Promise<ApiResponse<any[]>> {
  return apiFetch(`/calendar-connections/${encodeURIComponent(connId)}/external-calendars`);
}
export async function syncCalendarNow(connId: string): Promise<ApiResponse<{ processed: number; errors: number }>> {
  return apiFetch(`/calendar-connections/${encodeURIComponent(connId)}/sync-now`, { method: 'POST', body: JSON.stringify({}) });
}
export async function getCalendarConflicts(): Promise<ApiResponse<CalendarConflict[]>> {
  return apiFetch<CalendarConflict[]>('/calendar-connections/conflicts');
}
export async function resolveCalendarConflict(syncId: string, resolution: 'keep_intralys' | 'keep_external'): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch(`/calendar-connections/conflicts/${encodeURIComponent(syncId)}/resolve`, { method: 'POST', body: JSON.stringify({ resolution }) });
}

// ── Sprint 35 — Snapshots GHL-style (export/import bundle multi-table) ────
// Types FIGÉS Phase A (inter-agent contract docs/LOT-SNAPSHOTS-S35.md §6).
// 27 entités snapshottables côté worker, signature SHA-256 deterministe,
// idempotence par (client_id, name) à l'import. Garde 'settings.manage'.

export type SnapshotStatus = 'draft' | 'published' | 'archived';
export type SnapshotImportMode = 'dry_run' | 'commit';
export type SnapshotEntityName =
  | 'pipelines'
  | 'pipeline_stages'
  | 'lost_reasons'
  | 'custom_field_defs'
  | 'smart_lists'
  | 'workflow_folders'
  | 'workflows'
  | 'workflow_steps'
  | 'trigger_links'
  | 'template_folders'
  | 'email_templates'
  | 'sms_templates'
  | 'snippets'
  | 'forms'
  | 'form_field_options'
  | 'lead_segments'
  | 'task_templates'
  | 'booking_event_types'
  | 'calendars'
  | 'availability_rules'
  | 'catalog_items'
  | 'ai_brand_voices'
  | 'ivr_menus'
  | 'quick_replies'
  | 'saved_replies'
  | 'report_templates'
  | 'reputation_settings';

export interface SnapshotMeta {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  schema_version: number;
  payload_size_bytes: number;
  tables_summary: Record<SnapshotEntityName, number> | null;
  status: SnapshotStatus;
  created_by: string;
  created_at: string;
}

export interface ImportLogEntry {
  entity: SnapshotEntityName;
  action: 'created' | 'skipped' | 'failed';
  old_id: string | null;
  new_id: string | null;
  reason?: string;
}

export interface ImportSummary {
  total_entities: number;
  totals: Record<
    SnapshotEntityName,
    { created: number; skipped: number; failed: number }
  >;
  id_mapping: Record<SnapshotEntityName, Record<string, string>>;
}

export interface SnapshotImportResult {
  import_id: string;
  summary: ImportSummary;
  log: ImportLogEntry[];
}

export async function getSnapshots(): Promise<ApiResponse<SnapshotMeta[]>> {
  return apiFetch<SnapshotMeta[]>('/snapshots');
}

export async function getSnapshot(id: string): Promise<ApiResponse<SnapshotMeta>> {
  return apiFetch<SnapshotMeta>(`/snapshots/${encodeURIComponent(id)}`);
}

export async function createSnapshot(input: {
  name: string;
  description?: string;
}): Promise<ApiResponse<SnapshotMeta>> {
  return apiFetch<SnapshotMeta>('/snapshots', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Télécharge le bundle complet en Blob (Content-Disposition attachment).
 * apiFetch n'expose pas le body brut ; on passe par fetch direct pour
 * conserver le stream binaire. Header Authorization + X-Sub-Account
 * recopiés manuellement (calque pattern existant pour les exports CSV).
 */
export async function downloadSnapshot(
  id: string,
): Promise<{ data: Blob } | { error: string }> {
  const token =
    typeof localStorage !== 'undefined' ? localStorage.getItem('intralys_token') : null;
  const activeSubAccount = getActiveSubAccount();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (activeSubAccount) headers['X-Sub-Account'] = activeSubAccount;
  try {
    const response = await fetch(
      `${API_BASE}/snapshots/${encodeURIComponent(id)}/download`,
      { headers },
    );
    if (!response.ok) {
      return { error: `Erreur ${response.status}` };
    }
    return { data: await response.blob() };
  } catch {
    return { error: t('api.unavailable') };
  }
}

export async function publishSnapshot(id: string): Promise<ApiResponse<SnapshotMeta>> {
  return apiFetch<SnapshotMeta>(`/snapshots/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function archiveSnapshot(id: string): Promise<ApiResponse<SnapshotMeta>> {
  return apiFetch<SnapshotMeta>(`/snapshots/${encodeURIComponent(id)}/archive`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function deleteSnapshot(id: string): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch<{ ok: true }>(`/snapshots/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function importSnapshot(input: {
  bundle?: unknown;
  snapshot_id?: string;
  target_client_id: string;
  mode: SnapshotImportMode;
}): Promise<ApiResponse<SnapshotImportResult>> {
  return apiFetch<SnapshotImportResult>('/snapshots/import', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ── Sprint 36 — Live chat widget (ENRICHISSEMENT webchat existant) ────────
// Types FIGÉS Phase A (inter-agent contract docs/LOT-CHAT-WIDGET-S36.md §6).
// On enrichit le webchat existant (Durable Object WebchatRoom + tables seq25)
// avec : multi-tenant agency, allowlist origins, Turnstile, presence agent,
// branding (avatar, powered_by), contexte session (UA, IP-hash, referrer).
// Garde capability 'settings.manage' (FIGÉE seq80 — ZÉRO ajout).

export type ChatWidgetPosition =
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left';

export type ChatAgentPresenceStatus = 'online' | 'away' | 'offline';

export type ChatSessionStatus = 'active' | 'closed' | 'offline_form';

export interface ChatWidget {
  id: string;
  client_id: string;
  agency_id: string | null;
  name: string | null;
  primary_color: string | null;
  welcome_message: string | null;
  offline_message: string | null;
  position: ChatWidgetPosition;
  /** JSON-array décodé côté handler (NULL en base = pas d'allowlist legacy). */
  allowed_origins: string[] | null;
  avatar_url: string | null;
  show_powered_by: 0 | 1;
  business_hours_json: string | null;
  /** JSON-array de réponses initiales du bot (string[] décodé côté handler). */
  bot_initial_replies_json: string | null;
  turnstile_enabled: 0 | 1;
  is_active: 0 | 1;
  created_at: string;
  updated_at: string | null;
}

export interface ChatSession {
  id: string;
  widget_id: string;
  conversation_id: string | null;
  visitor_name: string | null;
  visitor_email: string | null;
  page_url: string | null;
  referrer: string | null;
  user_agent: string | null;
  ip_hash: string | null;
  started_at: string;
  ended_at: string | null;
  last_seen_at: string | null;
  status: ChatSessionStatus;
  unread_agent_count: number;
  agent_user_id: string | null;
}

export interface ChatAgentPresence {
  user_id: string;
  client_id: string;
  status: ChatAgentPresenceStatus;
  last_heartbeat_at: string;
}

export interface ChatWidgetInput {
  name?: string;
  primary_color?: string;
  welcome_message?: string;
  offline_message?: string;
  position?: ChatWidgetPosition;
  allowed_origins?: string[];
  avatar_url?: string;
  show_powered_by?: boolean;
  business_hours_json?: string;
  bot_initial_replies?: string[];
  turnstile_enabled?: boolean;
  is_active?: boolean;
}

export interface ChatSessionFilters {
  status?: ChatSessionStatus;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface ChatSessionDetail extends ChatSession {
  messages: Array<{
    id: string;
    direction: 'inbound' | 'outbound';
    body: string;
    sent_by: string | null;
    created_at: string;
  }>;
}

export async function getChatWidgets(): Promise<ApiResponse<ChatWidget[]>> {
  return apiFetch<ChatWidget[]>('/chat-widgets');
}

export async function createChatWidget(
  input: ChatWidgetInput,
): Promise<ApiResponse<ChatWidget>> {
  return apiFetch<ChatWidget>('/chat-widgets', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateChatWidget(
  id: string,
  input: ChatWidgetInput,
): Promise<ApiResponse<ChatWidget>> {
  return apiFetch<ChatWidget>(`/chat-widgets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteChatWidget(
  id: string,
): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch<{ ok: true }>(`/chat-widgets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function getChatWidgetSessions(
  widgetId: string,
  filters?: ChatSessionFilters,
): Promise<ApiResponse<ChatSession[]>> {
  const qs: string[] = [];
  if (filters?.status) qs.push(`status=${encodeURIComponent(filters.status)}`);
  if (filters?.from) qs.push(`from=${encodeURIComponent(filters.from)}`);
  if (filters?.to) qs.push(`to=${encodeURIComponent(filters.to)}`);
  if (filters?.limit) qs.push(`limit=${encodeURIComponent(String(filters.limit))}`);
  if (filters?.cursor) qs.push(`cursor=${encodeURIComponent(filters.cursor)}`);
  const q = qs.length > 0 ? `?${qs.join('&')}` : '';
  return apiFetch<ChatSession[]>(
    `/chat-widgets/${encodeURIComponent(widgetId)}/sessions${q}`,
  );
}

export async function getChatSessionDetail(
  widgetId: string,
  sessionId: string,
): Promise<ApiResponse<ChatSessionDetail>> {
  return apiFetch<ChatSessionDetail>(
    `/chat-widgets/${encodeURIComponent(widgetId)}/sessions/${encodeURIComponent(sessionId)}`,
  );
}

export async function postChatPresenceHeartbeat(
  status: ChatAgentPresenceStatus,
): Promise<ApiResponse<{ ok: true; status: ChatAgentPresenceStatus }>> {
  return apiFetch<{ ok: true; status: ChatAgentPresenceStatus }>(
    '/chat-presence/heartbeat',
    {
      method: 'POST',
      body: JSON.stringify({ status }),
    },
  );
}

export async function getChatPresenceActive(): Promise<
  ApiResponse<ChatAgentPresence[]>
> {
  return apiFetch<ChatAgentPresence[]>('/chat-presence/active');
}

// ════════════════════════════════════════════════════════════════════════════
// Sprint 37 — POS retail caisse (FIGÉ Phase A, docs/LOT-POS-S37.md §5/§6)
// ════════════════════════════════════════════════════════════════════════════
//
// Toutes les routes POS sont gated AMONT par requireModule('ecommerce').
// Money TOUJOURS en cents (INTEGER). Stripe Terminal = flag-inactif (E4).
// Régression-zéro QC : pos-transactions:create RÉUTILISE createOrderCore +
// commitOrderSale d'ecommerce-orders.ts en interne (verbatim).

export type PosSessionStatus = 'open' | 'closed' | 'reconciled';
export type PosPaymentMethod = 'cash' | 'card_terminal' | 'gift_card' | 'other' | 'split';

export interface PosRegister {
  id: string;
  client_id: string;
  name: string;
  location: string;
  currency: string;
  is_active: number;
  default_tax_region: string;
  printer_config_json: string;
  created_at: string;
  updated_at: string;
}

export interface PosSession {
  id: string;
  register_id: string;
  client_id: string;
  opened_by: string | null;
  opened_at: string | null;
  closed_at: string | null;
  opening_cash_cents: number;
  closing_cash_cents: number | null;
  expected_cash_cents: number | null;
  variance_cents: number | null;
  status: PosSessionStatus;
  total_sales_cents: number;
  total_tax_cents: number;
  transaction_count: number;
  notes: string;
}

export interface PosTransaction {
  id: string;
  session_id: string;
  order_id: string | null;
  payment_method: PosPaymentMethod;
  amount_cents: number;
  tendered_cents: number | null;
  change_due_cents: number;
  card_terminal_ref: string | null;
  receipt_url: string | null;
  voided_at: string | null;
  void_reason: string | null;
  cashier_id: string | null;
  created_at: string;
}

export interface PosCartItem {
  variant_id: string;
  quantity: number;
}

export interface PosPaymentSplitInput {
  method: 'cash' | 'card_terminal' | 'gift_card' | 'other';
  amount_cents: number;
}

export interface PosPaymentInput {
  method: PosPaymentMethod;
  amount_cents: number;
  tendered_cents?: number;
  splits?: PosPaymentSplitInput[];
  card_terminal_ref?: string;
}

export interface ScanResult {
  variant: {
    id: string;
    product_id: string;
    title: string | null;
    sku: string | null;
    barcode: string | null;
    price_override: number | null;
  };
  product: {
    id: string;
    title: string;
    base_price: number;
  };
  in_stock: boolean;
  unit_price_cents: number;
}

export interface ReceiptItem {
  title: string;
  variant_title?: string;
  sku?: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
}

export interface ReceiptTaxLine {
  label: string;
  rate: number;
  amount_cents: number;
}

export interface ReceiptPayload {
  tenantName: string;
  transactionId: string;
  orderNumber: string;
  placedAt: string;
  items: ReceiptItem[];
  subtotalCents: number;
  taxLines: ReceiptTaxLine[];
  totalCents: number;
  paymentMethod: PosPaymentMethod;
  tenderedCents?: number;
  changeCents?: number;
  cashierName: string;
  registerName: string;
}

// ── Registers ───────────────────────────────────────────────────────────────

export async function listPosRegisters(): Promise<ApiResponse<PosRegister[]>> {
  return apiFetch<PosRegister[]>('/pos/registers');
}

export interface CreatePosRegisterInput {
  name: string;
  location?: string;
  currency?: string;
  default_tax_region?: string;
  printer_config_json?: string;
  is_active?: number;
}

export async function createPosRegister(
  input: CreatePosRegisterInput,
): Promise<ApiResponse<PosRegister>> {
  return apiFetch<PosRegister>('/pos/registers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface UpdatePosRegisterInput {
  name?: string;
  location?: string;
  currency?: string;
  default_tax_region?: string;
  printer_config_json?: string;
  is_active?: number;
}

export async function updatePosRegister(
  id: string,
  input: UpdatePosRegisterInput,
): Promise<ApiResponse<PosRegister>> {
  return apiFetch<PosRegister>(`/pos/registers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

// ── Sessions ────────────────────────────────────────────────────────────────

export interface OpenPosSessionInput {
  register_id: string;
  opening_cash_cents: number;
}

export async function openPosSession(
  input: OpenPosSessionInput,
): Promise<ApiResponse<PosSession>> {
  return apiFetch<PosSession>('/pos/sessions/open', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface ClosePosSessionInput {
  closing_cash_cents: number;
  notes?: string;
}

export async function closePosSession(
  id: string,
  input: ClosePosSessionInput,
): Promise<ApiResponse<PosSession>> {
  return apiFetch<PosSession>(
    `/pos/sessions/${encodeURIComponent(id)}/close`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export async function getPosSession(
  id: string,
): Promise<ApiResponse<PosSession>> {
  return apiFetch<PosSession>(`/pos/sessions/${encodeURIComponent(id)}`);
}

export interface PosSessionReportFilters {
  format?: 'json' | 'csv' | 'pdf';
  group_by?: 'payment_method' | 'product' | 'hour';
}

export interface PosSessionReport {
  session: PosSession;
  totals_by_method: Array<{ method: PosPaymentMethod; amount_cents: number; count: number }>;
  top_products: Array<{ variant_id: string; title: string; quantity: number; total_cents: number }>;
  total_sales_cents: number;
  total_tax_cents: number;
  transaction_count: number;
}

export async function getPosSessionReport(
  id: string,
  filters?: PosSessionReportFilters,
): Promise<ApiResponse<PosSessionReport>> {
  const qs: string[] = [];
  if (filters?.format) qs.push(`format=${encodeURIComponent(filters.format)}`);
  if (filters?.group_by) qs.push(`group_by=${encodeURIComponent(filters.group_by)}`);
  const q = qs.length > 0 ? `?${qs.join('&')}` : '';
  return apiFetch<PosSessionReport>(
    `/pos/sessions/${encodeURIComponent(id)}/report${q}`,
  );
}

// ── Transactions ────────────────────────────────────────────────────────────

export async function scanBarcode(
  barcode: string,
): Promise<ApiResponse<ScanResult>> {
  return apiFetch<ScanResult>(
    `/pos/products/scan/${encodeURIComponent(barcode)}`,
  );
}

export interface CreatePosTransactionInput {
  session_id: string;
  cart: PosCartItem[];
  payment: PosPaymentInput;
  customer_id?: string;
}

export async function createPosTransaction(
  input: CreatePosTransactionInput,
): Promise<ApiResponse<PosTransaction>> {
  return apiFetch<PosTransaction>('/pos/transactions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface VoidPosTransactionInput {
  reason: string;
}

export async function voidPosTransaction(
  id: string,
  input: VoidPosTransactionInput,
): Promise<ApiResponse<PosTransaction>> {
  return apiFetch<PosTransaction>(
    `/pos/transactions/${encodeURIComponent(id)}/void`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ── Sprint 38 — Gift cards + Loyalty programs (FIGÉS Phase A) ──────────────
// ════════════════════════════════════════════════════════════════════════════

// ── Gift cards : types ─────────────────────────────────────────────────────

export type GiftCardStatus = 'active' | 'redeemed' | 'expired' | 'voided';
export type GiftCardTransactionType =
  | 'issue'
  | 'credit'
  | 'debit'
  | 'refund'
  | 'expire'
  | 'void';

export interface GiftCard {
  id: string;
  code: string;
  client_id: string;
  initial_value_cents: number;
  current_balance_cents: number;
  currency: string;
  expires_at: string | null;
  issued_to_customer_id: string | null;
  issued_to_email: string | null;
  status: GiftCardStatus;
  notes: string | null;
  created_at: string | null;
}

export interface GiftCardTransaction {
  id: string;
  gift_card_id: string;
  order_id: string | null;
  amount_cents: number;
  type: GiftCardTransactionType;
  balance_after_cents: number;
  created_at: string | null;
}

export interface GiftCardBalance {
  balance_cents: number;
  currency: string;
  expires_at: string | null;
  status: GiftCardStatus;
}

export interface IssueGiftCardInput {
  initial_value_cents: number;
  currency?: string;
  expires_at?: string | null;
  issued_to_customer_id?: string | null;
  issued_to_email?: string | null;
  notes?: string;
}

export interface RedeemGiftCardInput {
  amount_cents: number;
  order_id?: string;
}

export interface RefundGiftCardInput {
  amount_cents: number;
  order_id?: string;
}

// ── Gift cards : helpers async ─────────────────────────────────────────────

export async function getGiftCards(): Promise<ApiResponse<GiftCard[]>> {
  return apiFetch<GiftCard[]>('/gift-cards');
}

export async function issueGiftCard(
  input: IssueGiftCardInput,
): Promise<ApiResponse<GiftCard>> {
  return apiFetch<GiftCard>('/gift-cards', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** PUBLIC : lookup balance par code (visiteur anonyme — pas d'auth). */
export async function getGiftCardBalance(
  code: string,
): Promise<ApiResponse<GiftCardBalance>> {
  return apiFetch<GiftCardBalance>(
    `/public/gift-cards/${encodeURIComponent(code)}/balance`,
  );
}

export async function redeemGiftCard(
  id: string,
  input: RedeemGiftCardInput,
): Promise<ApiResponse<GiftCardTransaction>> {
  return apiFetch<GiftCardTransaction>(
    `/gift-cards/${encodeURIComponent(id)}/redeem`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export async function voidGiftCard(
  id: string,
): Promise<ApiResponse<GiftCard>> {
  return apiFetch<GiftCard>(`/gift-cards/${encodeURIComponent(id)}/void`, {
    method: 'POST',
  });
}

export async function refundToGiftCard(
  id: string,
  input: RefundGiftCardInput,
): Promise<ApiResponse<GiftCardTransaction>> {
  return apiFetch<GiftCardTransaction>(
    `/gift-cards/${encodeURIComponent(id)}/refund`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export async function getGiftCardTransactions(
  cardId: string,
): Promise<ApiResponse<GiftCardTransaction[]>> {
  return apiFetch<GiftCardTransaction[]>(
    `/gift-cards/${encodeURIComponent(cardId)}/transactions`,
  );
}

// ── Loyalty : types ────────────────────────────────────────────────────────

export type LoyaltyLedgerType =
  | 'earn'
  | 'redeem'
  | 'adjust'
  | 'expire'
  | 'tier_bonus';

export interface LoyaltyProgram {
  id: string;
  name: string;
  earn_rate_per_dollar: number;
  redeem_rate_cents_per_point: number;
  min_redeem_points: number;
  points_expiry_days: number | null;
  tier_thresholds_json: string | null;
  tier_benefits_json: string | null;
  is_active: number;
  created_at: string | null;
}

export interface LoyaltyLedgerEntry {
  id: string;
  customer_id: string;
  points: number;
  type: LoyaltyLedgerType;
  source_order_id: string | null;
  tier_snapshot: string;
  balance_after: number;
  expires_at: string | null;
  created_at: string | null;
}

export interface LoyaltyCustomerBalance {
  customer_id: string;
  program_id: string;
  current_balance: number;
  lifetime_earned: number;
  current_tier: string;
  last_earn_at: string | null;
  last_redeem_at: string | null;
}

export interface CreateLoyaltyProgramInput {
  name: string;
  currency?: string;
  earn_rate_per_dollar?: number;
  redeem_rate_cents_per_point?: number;
  min_redeem_points?: number;
  points_expiry_days?: number | null;
  tier_thresholds_json?: string;
  tier_benefits_json?: string;
}

export interface UpdateLoyaltyProgramInput {
  name?: string;
  earn_rate_per_dollar?: number;
  redeem_rate_cents_per_point?: number;
  min_redeem_points?: number;
  points_expiry_days?: number | null;
  tier_thresholds_json?: string;
  tier_benefits_json?: string;
  is_active?: number;
}

export interface EarnLoyaltyPointsInput {
  program_id: string;
  customer_id: string;
  subtotal_cents: number;
  source_order_id?: string;
}

export interface RedeemLoyaltyPointsInput {
  program_id: string;
  customer_id: string;
  points: number;
  source_order_id?: string;
}

export interface AdjustLoyaltyPointsInput {
  program_id: string;
  customer_id: string;
  points: number;
  reason: string;
}

// ── Loyalty : helpers async ────────────────────────────────────────────────

export async function getLoyaltyPrograms(): Promise<
  ApiResponse<LoyaltyProgram[]>
> {
  return apiFetch<LoyaltyProgram[]>('/loyalty/programs');
}

export async function getLoyaltyProgram(
  id: string,
): Promise<ApiResponse<LoyaltyProgram>> {
  return apiFetch<LoyaltyProgram>(
    `/loyalty/programs/${encodeURIComponent(id)}`,
  );
}

export async function createLoyaltyProgram(
  input: CreateLoyaltyProgramInput,
): Promise<ApiResponse<LoyaltyProgram>> {
  return apiFetch<LoyaltyProgram>('/loyalty/programs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateLoyaltyProgram(
  id: string,
  input: UpdateLoyaltyProgramInput,
): Promise<ApiResponse<LoyaltyProgram>> {
  return apiFetch<LoyaltyProgram>(
    `/loyalty/programs/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
}

export async function deleteLoyaltyProgram(
  id: string,
): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch<{ ok: true }>(
    `/loyalty/programs/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

export async function getCustomerLoyaltyBalance(
  customerId: string,
): Promise<ApiResponse<LoyaltyCustomerBalance>> {
  return apiFetch<LoyaltyCustomerBalance>(
    `/loyalty/customers/${encodeURIComponent(customerId)}/balance`,
  );
}

export async function earnLoyaltyPoints(
  input: EarnLoyaltyPointsInput,
): Promise<ApiResponse<LoyaltyLedgerEntry>> {
  return apiFetch<LoyaltyLedgerEntry>('/loyalty/earn', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function redeemLoyaltyPoints(
  input: RedeemLoyaltyPointsInput,
): Promise<ApiResponse<LoyaltyLedgerEntry>> {
  return apiFetch<LoyaltyLedgerEntry>('/loyalty/redeem', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function adjustLoyaltyPoints(
  input: AdjustLoyaltyPointsInput,
): Promise<ApiResponse<LoyaltyLedgerEntry>> {
  return apiFetch<LoyaltyLedgerEntry>('/loyalty/adjust', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getLoyaltyLedger(
  customerId: string,
  programId?: string,
): Promise<ApiResponse<LoyaltyLedgerEntry[]>> {
  const qs = programId
    ? `?program_id=${encodeURIComponent(programId)}`
    : '';
  return apiFetch<LoyaltyLedgerEntry[]>(
    `/loyalty/customers/${encodeURIComponent(customerId)}/ledger${qs}`,
  );
}

// ── Sprint 39 — Multi-currency + Tax engine multi-région ───────────────────
// Helpers async pour les nouvelles routes (12 helpers, signatures FIGÉES §6).
// PRÉSERVATION : aucun ré-export ni reshape des types existants. Les types
// CurrencyRate / TaxRegion / TaxRule sont importés depuis ./types (Phase A).
// Réponses normalisées { data } / { error } via apiFetch (pas de champ `code`).

import type {
  CurrencyRate,
  SupportedCurrencyExt,
  TaxRegion,
  TaxRule,
} from './types';

export interface CurrencyRateFilters {
  base?: SupportedCurrencyExt;
  quote?: SupportedCurrencyExt;
  source?: 'ecb' | 'frankfurter' | 'manual';
}

export interface SetManualCurrencyRateInput {
  base_currency: SupportedCurrencyExt;
  quote_currency: SupportedCurrencyExt;
  rate: number;
}

export interface CreateTaxRegionInput {
  code: string;
  name: string;
  country: string;
  country_subdiv?: string | null;
  type: 'vat' | 'gst_pst' | 'sales_tax' | 'tva_dz' | 'exempt';
  rates_json?: Record<string, number>;
  tax_inclusive?: boolean;
  active?: boolean;
}

export type UpdateTaxRegionInput = Partial<CreateTaxRegionInput>;

export interface CreateTaxRuleInput {
  product_category: string;
  rate: number;
  compound?: boolean;
  applies_from?: string;
}

// ── Currencies ─────────────────────────────────────────────────────────────

export async function getCurrencies(): Promise<
  ApiResponse<SupportedCurrencyExt[]>
> {
  return apiFetch<SupportedCurrencyExt[]>('/currencies');
}

export async function listCurrencyRates(
  filters?: CurrencyRateFilters,
): Promise<ApiResponse<CurrencyRate[]>> {
  const params: string[] = [];
  if (filters?.base) params.push(`base=${encodeURIComponent(filters.base)}`);
  if (filters?.quote) params.push(`quote=${encodeURIComponent(filters.quote)}`);
  if (filters?.source) params.push(`source=${encodeURIComponent(filters.source)}`);
  const qs = params.length ? `?${params.join('&')}` : '';
  return apiFetch<CurrencyRate[]>(`/currencies/rates${qs}`);
}

export async function refreshCurrencyRates(): Promise<
  ApiResponse<{ refreshed: number }>
> {
  return apiFetch<{ refreshed: number }>('/currencies/rates/refresh', {
    method: 'POST',
  });
}

export async function setManualCurrencyRate(
  input: SetManualCurrencyRateInput,
): Promise<ApiResponse<CurrencyRate>> {
  return apiFetch<CurrencyRate>('/currencies/rates/override', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ── Tax regions ────────────────────────────────────────────────────────────

export async function listTaxRegions(): Promise<ApiResponse<TaxRegion[]>> {
  return apiFetch<TaxRegion[]>('/tax-regions');
}

export async function createTaxRegion(
  input: CreateTaxRegionInput,
): Promise<ApiResponse<TaxRegion>> {
  return apiFetch<TaxRegion>('/tax-regions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateTaxRegion(
  id: string,
  input: UpdateTaxRegionInput,
): Promise<ApiResponse<TaxRegion>> {
  return apiFetch<TaxRegion>(`/tax-regions/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function deleteTaxRegion(
  id: string,
): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch<{ ok: true }>(`/tax-regions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ── Tax rules ──────────────────────────────────────────────────────────────

export async function listTaxRules(
  regionId: string,
): Promise<ApiResponse<TaxRule[]>> {
  return apiFetch<TaxRule[]>(
    `/tax-regions/${encodeURIComponent(regionId)}/rules`,
  );
}

export async function createTaxRule(
  regionId: string,
  input: CreateTaxRuleInput,
): Promise<ApiResponse<TaxRule>> {
  return apiFetch<TaxRule>(
    `/tax-regions/${encodeURIComponent(regionId)}/rules`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export async function deleteTaxRule(
  ruleId: string,
): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch<{ ok: true }>(`/tax-rules/${encodeURIComponent(ruleId)}`, {
    method: 'DELETE',
  });
}

// ════════════════════════════════════════════════════════════
// ── Sprint 40 ── Product Reviews + Abandoned Carts Recovery (seq135)
// ════════════════════════════════════════════════════════════

import type {
  ProductReview,
  ProductReviewStatus,
  ProductReviewSubmitInput,
  RecoverySequenceState,
} from './types';

export interface ProductReviewFilters {
  status?: ProductReviewStatus;
  rating_min?: number;
  rating_max?: number;
  verified_only?: boolean;
  limit?: number;
}

export interface ModerationQueueFilters {
  status?: ProductReviewStatus;
  product_id?: string;
  limit?: number;
}

export interface ModerateReviewInput {
  action: 'approve' | 'reject' | 'flag';
  notes?: string;
}

export interface UpdateRecoveryConfigInput {
  /** Skip la séquence pour ce panier (pause manuelle opérateur). */
  skip?: boolean;
  /** Force le re-trigger de la prochaine étape (resend manuel). */
  force_resend?: boolean;
  /** Override coupon manuel (sinon généré via engine `coupons`). */
  override_coupon_code?: string;
}

// ── Product Reviews (PUBLIC submit + AUTHED moderation) ────────────────────

export async function getProductReviews(
  productId: string,
  filters?: ProductReviewFilters,
): Promise<ApiResponse<ProductReview[]>> {
  const params: string[] = [];
  if (filters?.status) params.push(`status=${encodeURIComponent(filters.status)}`);
  if (typeof filters?.rating_min === 'number')
    params.push(`rating_min=${encodeURIComponent(String(filters.rating_min))}`);
  if (typeof filters?.rating_max === 'number')
    params.push(`rating_max=${encodeURIComponent(String(filters.rating_max))}`);
  if (filters?.verified_only) params.push('verified_only=1');
  if (typeof filters?.limit === 'number')
    params.push(`limit=${encodeURIComponent(String(filters.limit))}`);
  const qs = params.length ? `?${params.join('&')}` : '';
  return apiFetch<ProductReview[]>(
    `/products/${encodeURIComponent(productId)}/reviews${qs}`,
  );
}

export async function submitProductReview(
  productId: string,
  input: ProductReviewSubmitInput,
): Promise<ApiResponse<{ id: string; status: ProductReviewStatus }>> {
  return apiFetch<{ id: string; status: ProductReviewStatus }>(
    `/products/${encodeURIComponent(productId)}/reviews`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export async function voteReviewHelpful(
  reviewId: string,
): Promise<ApiResponse<{ helpful_count: number }>> {
  return apiFetch<{ helpful_count: number }>(
    `/reviews/${encodeURIComponent(reviewId)}/helpful`,
    { method: 'POST' },
  );
}

// ── Moderation queue (AUTHED — cap reports.view / clients.manage) ──────────

export async function getModerationQueue(
  filters?: ModerationQueueFilters,
): Promise<ApiResponse<ProductReview[]>> {
  const params: string[] = [];
  if (filters?.status) params.push(`status=${encodeURIComponent(filters.status)}`);
  if (filters?.product_id)
    params.push(`product_id=${encodeURIComponent(filters.product_id)}`);
  if (typeof filters?.limit === 'number')
    params.push(`limit=${encodeURIComponent(String(filters.limit))}`);
  const qs = params.length ? `?${params.join('&')}` : '';
  return apiFetch<ProductReview[]>(`/reviews/moderation-queue${qs}`);
}

export async function moderateReview(
  id: string,
  input: ModerateReviewInput,
): Promise<ApiResponse<ProductReview>> {
  return apiFetch<ProductReview>(`/reviews/${encodeURIComponent(id)}/moderate`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteReview(
  id: string,
): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch<{ ok: true }>(`/reviews/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ── Abandoned Carts — sequence multi-touch (AUTHED) ────────────────────────

export async function getRecoverySequenceStates(): Promise<
  ApiResponse<RecoverySequenceState[]>
> {
  return apiFetch<RecoverySequenceState[]>(
    '/ecommerce/carts/abandoned/sequence',
  );
}

export async function updateRecoveryConfig(
  cartId: string,
  input: UpdateRecoveryConfigInput,
): Promise<ApiResponse<RecoverySequenceState>> {
  return apiFetch<RecoverySequenceState>(
    `/ecommerce/carts/${encodeURIComponent(cartId)}/recovery-config`,
    { method: 'PUT', body: JSON.stringify(input) },
  );
}

// ── Sprint 41 — AI Voice Agent (étend Twilio Voice S34) ────────────────────
// Tables seq136 : voice_agent_scripts + voice_agent_calls.
// ALTER call_logs : agent_handled (int 0/1) + agent_script_id (text nullable).
// Capability : settings.manage (FIGÉE seq80 — réutilisation).
// Réponses normalisées { data } / { error }, JAMAIS de champ `code`.

/** Raison d'escalade (enum HANDLER, validé side-handler — pas de CHECK SQL). */
export type VoiceAgentEscalationReason =
  | 'low_confidence'
  | 'user_request'
  | 'no_match'
  | 'error';

/** Script de réponse AI configuré par tenant (1 par intent). */
export interface VoiceAgentScript {
  id: string;
  client_id: string;
  name: string;
  /** Array de mots-clés pour fallback keyword matching (env.AI absent). */
  intent_keywords: string[];
  /** Template texte avec variables {{visitor_name}} interpolées HANDLER. */
  response_template: string;
  /** Confidence min (0..1) pour répondre sans escalader (default 0.7). */
  escalation_threshold: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Appel traité par l'AI agent (historique par tenant). */
export interface VoiceAgentCall {
  id: string;
  call_log_id: string;
  script_id: string | null;
  intent_detected: string | null;
  confidence: number | null;
  response_text: string | null;
  escalated: boolean;
  escalation_reason: VoiceAgentEscalationReason | null;
  duration_sec: number;
  transcript_full: string | null;
  created_at: string;
}

/** Input PATCH/POST pour create/update d'un script. */
export interface VoiceAgentScriptInput {
  name?: string;
  intent_keywords?: string[];
  response_template?: string;
  escalation_threshold?: number;
  is_active?: boolean;
}

/** Filtres list calls (cursor pagination). */
export interface VoiceAgentCallFilters {
  escalated?: boolean;
  script_id?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

/** Détail d'un appel AI (avec transcript complet). */
export interface VoiceAgentCallDetail extends VoiceAgentCall {
  script?: VoiceAgentScript | null;
}

/** Résultat d'un test de prédiction (handleTestScript). */
export interface VoiceAgentTestResult {
  matched: boolean;
  intent: string | null;
  confidence: number;
  response_preview: string | null;
  would_escalate: boolean;
  escalation_reason: VoiceAgentEscalationReason | null;
}

// ── Helpers AUTHED — paritaire avec routes worker.ts seq136 ────────────────

export async function listVoiceAgentScripts(): Promise<
  ApiResponse<VoiceAgentScript[]>
> {
  return apiFetch<VoiceAgentScript[]>('/voice-agent/scripts');
}

export async function createVoiceAgentScript(
  input: VoiceAgentScriptInput,
): Promise<ApiResponse<VoiceAgentScript>> {
  return apiFetch<VoiceAgentScript>('/voice-agent/scripts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateVoiceAgentScript(
  id: string,
  input: VoiceAgentScriptInput,
): Promise<ApiResponse<VoiceAgentScript>> {
  return apiFetch<VoiceAgentScript>(
    `/voice-agent/scripts/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
}

export async function deleteVoiceAgentScript(
  id: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(
    `/voice-agent/scripts/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

export async function getVoiceAgentCalls(
  filters?: VoiceAgentCallFilters,
): Promise<ApiResponse<VoiceAgentCall[]>> {
  const qs = new URLSearchParams();
  if (filters?.escalated !== undefined) qs.set('escalated', filters.escalated ? '1' : '0');
  if (filters?.script_id) qs.set('script_id', filters.script_id);
  if (filters?.from) qs.set('from', filters.from);
  if (filters?.to) qs.set('to', filters.to);
  if (filters?.limit !== undefined) qs.set('limit', String(filters.limit));
  if (filters?.cursor) qs.set('cursor', filters.cursor);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<VoiceAgentCall[]>(`/voice-agent/calls${suffix}`);
}

export async function getVoiceAgentCallDetail(
  id: string,
): Promise<ApiResponse<VoiceAgentCallDetail>> {
  return apiFetch<VoiceAgentCallDetail>(
    `/voice-agent/calls/${encodeURIComponent(id)}`,
  );
}

/**
 * Teste un script avec un input échantillon : retourne la prédiction
 * (intent + confidence + would_escalate) SANS effectuer de véritable appel
 * Twilio / TTS / D1 INSERT. Permet le preview UI Phase C.
 */
export async function testVoiceAgentScript(
  scriptId: string,
  sampleInput: string,
): Promise<ApiResponse<VoiceAgentTestResult>> {
  return apiFetch<VoiceAgentTestResult>(
    `/voice-agent/scripts/${encodeURIComponent(scriptId)}/test`,
    { method: 'POST', body: JSON.stringify({ sample_input: sampleInput }) },
  );
}

// ── Sprint 42 — AI Chat Agent (étend Webchat Widget S36) ───────────────────
// Tables seq137 : chat_knowledge_base + chat_bot_config.
// ALTER webchat_sessions : bot_handled (int 0/1) + bot_messages_count (int).
// Capability : settings.manage (FIGÉE seq80 — réutilisation).
// Réponses normalisées { data } / { error }, JAMAIS de champ `code`.
// AI : Haiku 4.5 via env.AI (Workers AI), FLAG INACTIF si binding absent →
// fallback keyword/LIKE search dans knowledge base (lib/chat-bot-engine.ts).

/** Source d'une entrée KB (enum HANDLER, validé side-handler — pas de CHECK SQL). */
export type ChatKnowledgeSource = 'manual' | 'url' | 'faq';

/** Entrée knowledge base RAG (FAQ / extrait doc / contenu scrapé URL). */
export interface ChatKnowledgeBaseEntry {
  id: string;
  client_id: string;
  title: string;
  content: string;
  /** Source de l'entrée — validation HANDLER. */
  source: ChatKnowledgeSource;
  /** 1 = disponible pour RAG, 0 = désactivée (soft-delete). */
  is_active: boolean;
  created_at: string;
}

/** Configuration globale du bot AI Chat par tenant (1 row par client_id). */
export interface ChatBotConfig {
  id: string;
  client_id: string;
  /** Optionnel : widget précis (NULL = config globale tous widgets du tenant). */
  widget_id: string | null;
  /** Prompt système Haiku ("You are a helpful assistant for <tenant>…"). */
  system_prompt: string;
  /** Confidence min (0..1) pour répondre sans escalader (default 0.7). */
  confidence_threshold: number;
  /** Texte affiché au visiteur lors d'une escalade vers humain. */
  escalation_message: string;
  /** 0 = bot OFF (default), 1 = bot actif sur les widgets concernés. */
  enabled: boolean;
  /** Hard cap applicatif messages bot par session (anti-abuse, default 20). */
  max_messages_per_session: number;
}

/** Input POST/PATCH pour create/update d'une entrée KB. */
export interface ChatKnowledgeBaseInput {
  title?: string;
  content?: string;
  source?: ChatKnowledgeSource;
  is_active?: boolean;
}

/** Input PUT pour update de la config bot (upsert HANDLER côté serveur). */
export interface ChatBotConfigInput {
  widget_id?: string | null;
  system_prompt?: string;
  confidence_threshold?: number;
  escalation_message?: string;
  enabled?: boolean;
  max_messages_per_session?: number;
}

/** Résultat d'un test bot (preview sans persistance D1 / webchat_sessions). */
export interface ChatBotTestResult {
  response: string | null;
  confidence: number;
  would_escalate: boolean;
  matched_kb_entries: number;
}

// ── Helpers AUTHED — paritaire avec routes worker.ts seq137 ────────────────

/** GET /api/chat-bot/knowledge — liste KB entries du tenant courant. */
export async function listChatKnowledge(): Promise<
  ApiResponse<ChatKnowledgeBaseEntry[]>
> {
  return apiFetch<ChatKnowledgeBaseEntry[]>('/chat-bot/knowledge');
}

/** POST /api/chat-bot/knowledge — créer une KB entry. */
export async function createChatKnowledge(
  input: ChatKnowledgeBaseInput,
): Promise<ApiResponse<ChatKnowledgeBaseEntry>> {
  return apiFetch<ChatKnowledgeBaseEntry>('/chat-bot/knowledge', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** PATCH /api/chat-bot/knowledge/:id — update partial d'une KB entry. */
export async function updateChatKnowledge(
  id: string,
  input: ChatKnowledgeBaseInput,
): Promise<ApiResponse<ChatKnowledgeBaseEntry>> {
  return apiFetch<ChatKnowledgeBaseEntry>(
    `/chat-bot/knowledge/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
}

/** DELETE /api/chat-bot/knowledge/:id — soft-disable (is_active=0). */
export async function deleteChatKnowledge(
  id: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(
    `/chat-bot/knowledge/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

/** GET /api/chat-bot/config — récupère la config bot du tenant (1 row). */
export async function getChatBotConfig(): Promise<ApiResponse<ChatBotConfig>> {
  return apiFetch<ChatBotConfig>('/chat-bot/config');
}

/** PUT /api/chat-bot/config — upsert config bot (1 row par tenant). */
export async function updateChatBotConfig(
  input: ChatBotConfigInput,
): Promise<ApiResponse<ChatBotConfig>> {
  return apiFetch<ChatBotConfig>('/chat-bot/config', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/**
 * POST /api/chat-bot/test — teste le bot avec un message échantillon. Retourne
 * la réponse prédite (text + confidence + would_escalate + nb d'entries KB
 * matchées) SANS persister webchat_sessions / bot_messages_count. Permet le
 * preview UI Phase C.
 */
export async function testChatBot(
  input: { message: string },
): Promise<ApiResponse<ChatBotTestResult>> {
  return apiFetch<ChatBotTestResult>('/chat-bot/test', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SPRINT 43 — Courses LMS avancé (quiz + certificats PDF + drip + progress)
// ════════════════════════════════════════════════════════════════════════════
// 6 interfaces + 13 helpers AUTHED — paritaire avec routes worker.ts seq138.
// Étend memberships seq87 + seq107 (course_enrollments). Capabilities
// FIGÉES : `clients.manage` pour admin CRUD lessons/quizzes/questions,
// `leads.write` pour member-facing (mark lesson complete + submit quiz
// attempt). Contrat réponses : json({ data }) succès / json({ error })
// erreur — PAS de champ `code`. Voir docs/LOT-COURSES-LMS-S43.md §6.

/** Type d'une question de quiz (whitelist HANDLER — pas de CHECK SQL). */
export type QuizQuestionType = 'multiple_choice' | 'text' | 'true_false';

/** Leçon LMS avancée (distincte de `lessons` seq87 — drip + ordre + publish). */
export interface CourseLesson {
  id: string;
  course_id: string;
  title: string;
  /** Corps HTML ou markdown (rendu Phase C). */
  content: string | null;
  /** URL externe optionnelle (YouTube/Vimeo/MP4) — embed iframe Phase C. */
  video_url: string | null;
  /** Position dans le cours (ASC). */
  order_index: number;
  /** Jours après enrollment avant déblocage (drip content). */
  drip_delay_days: number;
  /** 0 = draft, 1 = publié. */
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

/** Quiz attaché à une leçon (1+ par leçon possible). */
export interface CourseQuiz {
  id: string;
  lesson_id: string;
  title: string | null;
  /** Seuil 0..1 pour considérer le quiz « passé » (default 0.7). */
  passing_score: number;
  /** Hard cap tentatives HANDLER (default 3). */
  max_attempts: number;
  created_at: string;
  updated_at: string;
}

/** Question d'un quiz (MC / text / true_false). */
export interface QuizQuestion {
  id: string;
  quiz_id: string;
  question_text: string;
  type: QuizQuestionType;
  /** JSON array pour MC (`["A","B","C","D"]`), null sinon. */
  options_json: string | null;
  /** Bonne réponse (validation HANDLER case-insensitive pour text). */
  correct_answer: string;
  /** Pondération du calcul score. */
  points: number;
  order_index: number;
}

/** Tentative d'un membre (enrollment_id) sur un quiz. */
export interface QuizAttempt {
  id: string;
  quiz_id: string;
  enrollment_id: string;
  customer_id: string | null;
  /** JSON object { question_id: answer } pour rejeu / audit. */
  answers_json: string | null;
  /** 0..1 — pourcentage bonnes réponses pondérées (HANDLER computed). */
  score: number;
  /** 0/1 — HANDLER deduce vs course_quizzes.passing_score. */
  passed: boolean;
  attempted_at: string;
  /** null = attempt en cours. */
  completed_at: string | null;
}

/** Progression d'un membre sur une leçon (bornée enrollment_id). */
export interface LessonProgress {
  id: string;
  lesson_id: string;
  enrollment_id: string;
  customer_id: string | null;
  started_at: string;
  /** null = en cours. */
  completed_at: string | null;
  /** Temps cumulé HANDLER (sec). */
  time_spent_sec: number;
}

/** Certificat PDF émis à la completion d'un cours (R2 binding). */
export interface CourseCertificate {
  id: string;
  course_id: string;
  enrollment_id: string;
  customer_id: string | null;
  /** Clé R2 (env.R2 binding) — null si FLAG INACTIF. */
  certificate_url: string | null;
  /** 16 chars hex unique par tenant (HANDLER). */
  certificate_number: string | null;
  issued_at: string;
}

/** Input POST/PATCH pour create/update d'une leçon LMS. */
export interface CourseLessonInput {
  title?: string;
  content?: string | null;
  video_url?: string | null;
  order_index?: number;
  drip_delay_days?: number;
  is_published?: boolean;
}

/** Input POST pour create d'un quiz. */
export interface CourseQuizInput {
  title?: string | null;
  passing_score?: number;
  max_attempts?: number;
}

/** Input POST pour create d'une question de quiz. */
export interface QuizQuestionInput {
  question_text: string;
  type?: QuizQuestionType;
  options_json?: string | null;
  correct_answer: string;
  points?: number;
  order_index?: number;
}

/** Input POST submit d'une attempt (enrollment_id + answers). */
export interface QuizAttemptInput {
  enrollment_id: string;
  /** Map { question_id: answer } — answers HANDLER-grade. */
  answers: Record<string, string>;
}

/** Résultat agrégé de progression sur un enrollment. */
export interface EnrollmentProgress {
  completed_lessons: number;
  total_lessons: number;
  /** 0..1 — completed_lessons / total_lessons. */
  progress_pct: number;
  /** true si progress_pct >= course.completion_threshold. */
  can_get_certificate: boolean;
}

// ── Helpers AUTHED — paritaire avec routes worker.ts seq138 ────────────────

/** GET /api/courses/:id/lessons — liste leçons d'un cours. */
export async function listCourseLessons(
  courseId: string,
): Promise<ApiResponse<CourseLesson[]>> {
  return apiFetch<CourseLesson[]>(
    `/courses/${encodeURIComponent(courseId)}/lessons`,
  );
}

/** POST /api/courses/:id/lessons — créer une leçon. */
export async function createCourseLesson(
  courseId: string,
  input: CourseLessonInput,
): Promise<ApiResponse<CourseLesson>> {
  return apiFetch<CourseLesson>(
    `/courses/${encodeURIComponent(courseId)}/lessons`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

/** PATCH /api/lessons/:id — update partial d'une leçon. */
export async function updateCourseLesson(
  id: string,
  input: CourseLessonInput,
): Promise<ApiResponse<CourseLesson>> {
  return apiFetch<CourseLesson>(`/lessons/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** DELETE /api/lessons/:id — soft-disable d'une leçon (is_published=0). */
export async function deleteCourseLesson(
  id: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/lessons/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** GET /api/lessons/:id/quizzes — liste quizzes d'une leçon. */
export async function listLessonQuizzes(
  lessonId: string,
): Promise<ApiResponse<CourseQuiz[]>> {
  return apiFetch<CourseQuiz[]>(
    `/lessons/${encodeURIComponent(lessonId)}/quizzes`,
  );
}

/** POST /api/lessons/:id/quizzes — créer un quiz attaché à une leçon. */
export async function createQuiz(
  lessonId: string,
  input: CourseQuizInput,
): Promise<ApiResponse<CourseQuiz>> {
  return apiFetch<CourseQuiz>(
    `/lessons/${encodeURIComponent(lessonId)}/quizzes`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

/** GET /api/quizzes/:id/questions — liste questions d'un quiz. */
export async function getQuizQuestions(
  quizId: string,
): Promise<ApiResponse<QuizQuestion[]>> {
  return apiFetch<QuizQuestion[]>(
    `/quizzes/${encodeURIComponent(quizId)}/questions`,
  );
}

/** POST /api/quizzes/:id/questions — créer une question dans un quiz. */
export async function createQuizQuestion(
  quizId: string,
  input: QuizQuestionInput,
): Promise<ApiResponse<QuizQuestion>> {
  return apiFetch<QuizQuestion>(
    `/quizzes/${encodeURIComponent(quizId)}/questions`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

/** POST /api/quizzes/:id/attempt — submit une tentative (member-facing). */
export async function submitQuizAttempt(
  quizId: string,
  input: QuizAttemptInput,
): Promise<ApiResponse<QuizAttempt>> {
  return apiFetch<QuizAttempt>(
    `/quizzes/${encodeURIComponent(quizId)}/attempt`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

/** GET /api/enrollments/:id/progress — progression agrégée d'un enrollment. */
export async function getLessonProgress(
  enrollmentId: string,
): Promise<ApiResponse<EnrollmentProgress>> {
  return apiFetch<EnrollmentProgress>(
    `/enrollments/${encodeURIComponent(enrollmentId)}/progress`,
  );
}

/** POST /api/lessons/:id/complete — marque une leçon complétée (member-facing). */
export async function markLessonComplete(
  lessonId: string,
  enrollmentId: string,
): Promise<ApiResponse<LessonProgress>> {
  return apiFetch<LessonProgress>(
    `/lessons/${encodeURIComponent(lessonId)}/complete`,
    { method: 'POST', body: JSON.stringify({ enrollment_id: enrollmentId }) },
  );
}

/** GET /api/certificates?customer=:id — liste certificats d'un customer. */
export async function getCustomerCertificates(
  customerId: string,
): Promise<ApiResponse<CourseCertificate[]>> {
  return apiFetch<CourseCertificate[]>(
    `/certificates?customer=${encodeURIComponent(customerId)}`,
  );
}

/**
 * GET /api/certificates/:id/download — télécharge le PDF du certificat
 * (streaming R2 GET). Retourne le Blob via fetch direct (PAS apiFetch JSON).
 */
export async function downloadCertificate(
  id: string,
): Promise<ApiResponse<{ url: string }>> {
  return apiFetch<{ url: string }>(
    `/certificates/${encodeURIComponent(id)}/download`,
  );
}

// ════════════════════════════════════════════════════════════════════════════
// LOT FUNNELS BUILDER — Sprint 44 (seq139) — multi-step pages + A/B testing +
// analytics conversion par étape.
//
// 4 interfaces + 4 inputs + 18 helpers (15 AUTHED CRUD/analytics + 3 PUBLIC
// track/render). Routes câblées dans `src/worker.ts` :
//   - AUTHED : `/api/funnels-builder/*` (cap settings.manage, après bloc S43)
//   - PUBLIC : `/api/public/funnels/track-view`, `/track-conversion`,
//              `/:slug/render?step=N&variant=A` (pré-requireAuth, anti-bot
//              rate-limit côté worker).
//
// Tables SQL préfixées `fb_*` (collision seq83 — voir migration-funnels-seq139.sql).
// Côté TS, alias logiques (FunnelBuilder, FunnelBuilderStep, FunnelStepVariant). Contrat
// réponses : json({ data }) succès / json({ error }) erreur — PAS de champ
// `code`. Voir docs/LOT-FUNNELS-S44.md §6.
// ════════════════════════════════════════════════════════════════════════════

/** Goal primaire d'un funnel (whitelist HANDLER — pas de CHECK SQL). */
export type FunnelPrimaryGoal = 'lead_capture' | 'sale' | 'webinar' | 'other';

/** Type d'une étape d'un funnel (whitelist HANDLER). */
export type FunnelStepType =
  | 'landing'
  | 'optin'
  | 'upsell'
  | 'downsell'
  | 'thank_you'
  | 'custom';

/** FunnelBuilder multi-step builder (1 par tenant, slug UNIQUE par client). */
export interface FunnelBuilder {
  id: string;
  client_id: string;
  name: string;
  /** Slug UNIQUE par client (URL publique `/api/public/funnels/:slug/render`). */
  slug: string;
  description: string | null;
  primary_goal: FunnelPrimaryGoal;
  is_published: boolean;
  /** ISO timestamp du dernier publish (null si jamais publié). */
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Étape d'un funnel (ordonnée par order_index ASC). */
export interface FunnelBuilderStep {
  id: string;
  funnel_id: string;
  name: string;
  step_type: FunnelStepType;
  order_index: number;
  /** URL externe pour rediriger après conversion (null = step suivant). */
  redirect_after_url: string | null;
  created_at: string;
  updated_at: string;
}

/** Variante A/B/C... d'une étape (1+ par step). */
export interface FunnelStepVariant {
  id: string;
  step_id: string;
  /** Label libre — convention 'A'/'B'/'C'... */
  variant_name: string;
  /** HTML page complète (rendu serveur via `/render`). */
  content_html: string | null;
  /** 0..1 — fraction du trafic dirigée vers cette variante. */
  traffic_pct: number;
  /** true = variante de contrôle (flag UI breakdown). */
  is_control: boolean;
  created_at: string;
  updated_at: string;
}

/** Analytics agrégées d'un funnel (breakdown par étape + variante). */
export interface FunnelStepAnalytics {
  /** Breakdown par étape (avec compteurs views + conversions + rate). */
  steps_breakdown: Array<{
    step_id: string;
    step_name: string;
    step_type: FunnelStepType;
    order_index: number;
    views: number;
    conversions: number;
    /** 0..1 — conversions / views. */
    conversion_rate: number;
    /** Breakdown par variante de cette étape. */
    variants: Array<{
      variant_id: string;
      variant_name: string;
      is_control: boolean;
      views: number;
      conversions: number;
      conversion_rate: number;
    }>;
  }>;
  /** Taux de conversion global du funnel (visiteurs uniques arrivés à thank_you / vues étape 1). */
  conversion_rate: number;
  /** Top variantes performantes du funnel (sorted DESC conversion_rate). */
  top_variants: Array<{
    variant_id: string;
    step_id: string;
    variant_name: string;
    conversion_rate: number;
  }>;
}

/** Input POST/PATCH pour create/update d'un funnel. */
export interface FunnelInput {
  name?: string;
  slug?: string;
  description?: string | null;
  primary_goal?: FunnelPrimaryGoal;
}

/** Input POST/PATCH pour create/update d'une étape. */
export interface FunnelStepInput {
  name?: string;
  step_type?: FunnelStepType;
  order_index?: number;
  redirect_after_url?: string | null;
}

/** Input POST/PATCH pour create/update d'une variante. */
export interface FunnelStepVariantInput {
  variant_name?: string;
  content_html?: string | null;
  traffic_pct?: number;
  is_control?: boolean;
}

/** Input PUBLIC pour tracker une vue de variante. */
export interface FunnelTrackViewInput {
  step_id: string;
  variant_id: string;
  visitor_id: string;
}

/** Input PUBLIC pour tracker une conversion. */
export interface FunnelTrackConversionInput {
  step_id: string;
  variant_id: string;
  visitor_id: string;
  next_step_id?: string | null;
  conversion_value_cents?: number;
}

// ── Helpers AUTHED — paritaire avec routes worker.ts seq139 (cap settings.manage)

/** GET /api/funnels-builder — liste funnels du tenant. */
export async function listFunnels(): Promise<ApiResponse<FunnelBuilder[]>> {
  return apiFetch<FunnelBuilder[]>('/funnels-builder');
}

/** POST /api/funnels-builder — créer un funnel. */
export async function createFunnelBuilder(
  input: FunnelInput,
): Promise<ApiResponse<FunnelBuilder>> {
  return apiFetch<FunnelBuilder>('/funnels-builder', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** PATCH /api/funnels-builder/:id — update partial d'un funnel. */
export async function updateFunnelBuilder(
  id: string,
  input: FunnelInput,
): Promise<ApiResponse<FunnelBuilder>> {
  return apiFetch<FunnelBuilder>(`/funnels-builder/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** DELETE /api/funnels-builder/:id — soft-delete d'un funnel. */
export async function deleteFunnelBuilder(
  id: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(
    `/funnels-builder/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

/** POST /api/funnels-builder/:id/publish — toggle publication on/off. */
export async function publishFunnelBuilder(
  id: string,
  publish: boolean,
): Promise<ApiResponse<FunnelBuilder>> {
  return apiFetch<FunnelBuilder>(
    `/funnels-builder/${encodeURIComponent(id)}/publish`,
    { method: 'POST', body: JSON.stringify({ publish }) },
  );
}

/** GET /api/funnels-builder/:id/steps — liste étapes d'un funnel. */
export async function listFunnelSteps(
  funnelId: string,
): Promise<ApiResponse<FunnelBuilderStep[]>> {
  return apiFetch<FunnelBuilderStep[]>(
    `/funnels-builder/${encodeURIComponent(funnelId)}/steps`,
  );
}

/** POST /api/funnels-builder/:id/steps — créer une étape. */
export async function createFunnelStep(
  funnelId: string,
  input: FunnelStepInput,
): Promise<ApiResponse<FunnelBuilderStep>> {
  return apiFetch<FunnelBuilderStep>(
    `/funnels-builder/${encodeURIComponent(funnelId)}/steps`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

/** PATCH /api/funnels-builder/steps/:id — update partial d'une étape. */
export async function updateFunnelStep(
  id: string,
  input: FunnelStepInput,
): Promise<ApiResponse<FunnelBuilderStep>> {
  return apiFetch<FunnelBuilderStep>(
    `/funnels-builder/steps/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
}

/** DELETE /api/funnels-builder/steps/:id — supprime une étape. */
export async function deleteFunnelStep(
  id: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(
    `/funnels-builder/steps/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

/** GET /api/funnels-builder/steps/:id/variants — liste variantes d'une étape. */
export async function listStepVariants(
  stepId: string,
): Promise<ApiResponse<FunnelStepVariant[]>> {
  return apiFetch<FunnelStepVariant[]>(
    `/funnels-builder/steps/${encodeURIComponent(stepId)}/variants`,
  );
}

/** POST /api/funnels-builder/steps/:id/variants — créer une variante. */
export async function createStepVariant(
  stepId: string,
  input: FunnelStepVariantInput,
): Promise<ApiResponse<FunnelStepVariant>> {
  return apiFetch<FunnelStepVariant>(
    `/funnels-builder/steps/${encodeURIComponent(stepId)}/variants`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

/** PATCH /api/funnels-builder/variants/:id — update partial d'une variante. */
export async function updateStepVariant(
  id: string,
  input: FunnelStepVariantInput,
): Promise<ApiResponse<FunnelStepVariant>> {
  return apiFetch<FunnelStepVariant>(
    `/funnels-builder/variants/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
}

/** DELETE /api/funnels-builder/variants/:id — supprime une variante. */
export async function deleteStepVariant(
  id: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(
    `/funnels-builder/variants/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

/** GET /api/funnels-builder/:id/analytics — analytics agrégées du funnel. */
export async function getFunnelAnalytics(
  funnelId: string,
): Promise<ApiResponse<FunnelStepAnalytics>> {
  return apiFetch<FunnelStepAnalytics>(
    `/funnels-builder/${encodeURIComponent(funnelId)}/analytics`,
  );
}

// ── Helpers PUBLIC — anti-bot rate-limit côté worker (pré-requireAuth) ──────

/** POST /api/public/funnels/track-view — track vue anonyme (visitor_id cookie). */
export async function trackFunnelStepView(
  input: FunnelTrackViewInput,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(
    '/public/funnels/track-view',
    { method: 'POST', body: JSON.stringify(input) },
  );
}

/** POST /api/public/funnels/track-conversion — track conversion anonyme. */
export async function trackFunnelConversion(
  input: FunnelTrackConversionInput,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(
    '/public/funnels/track-conversion',
    { method: 'POST', body: JSON.stringify(input) },
  );
}

/**
 * GET /api/public/funnels/:slug/render?step=N&variant=A — render HTML d'une
 * variante d'étape (résolution A/B déterministe par visitor_id hash).
 * Retourne le HTML brut (PAS apiFetch JSON) — caller utilise fetch direct.
 */
export async function renderFunnelStep(
  slug: string,
  step?: number,
  variant?: string,
): Promise<ApiResponse<{ html: string }>> {
  const params = new URLSearchParams();
  if (step != null) params.set('step', String(step));
  if (variant) params.set('variant', variant);
  const qs = params.toString();
  return apiFetch<{ html: string }>(
    `/public/funnels/${encodeURIComponent(slug)}/render${qs ? `?${qs}` : ''}`,
  );
}

// ════════════════════════════════════════════════════════════════════════════
// LOT COMMUNITY S45 — Sprint 45 (seq140) — forum tenant interne (threads +
// comments + votes + moderation). Feature signature anti-Mighty-Networks /
// Circle pour vertical coaching/training.
//
// 4 interfaces + 4 inputs + ~22 helpers AUTHED (CRUD threads/comments + votes
// + moderation). Routes câblées dans `src/worker.ts` :
//   AUTHED : `/api/community/*` (cap leads.write membres / settings.manage
//            modération admin — AUCUN ajout à ALL_CAPABILITIES seq 80).
//
// Tables SQL préfixées `c45_*` (collision seq93 G10 — voir
// migration-community-seq140.sql). Côté TS, alias logiques (CommunityThread,
// CommunityComment, CommunityVote, CommunityModerationAction). Contrat
// réponses : json({ data }) succès / json({ error }) erreur — PAS de champ
// `code`. Voir docs/LOT-COMMUNITY-S45.md §6.
// ════════════════════════════════════════════════════════════════════════════

/** Status d'un thread (whitelist HANDLER — pas de CHECK SQL). */
export type CommunityThreadStatus = 'open' | 'hidden' | 'deleted';

/** Status d'un commentaire (whitelist HANDLER). */
export type CommunityCommentStatus = 'visible' | 'hidden' | 'deleted';

/** Cible d'un vote / d'une action modération. */
export type CommunityTargetType = 'thread' | 'comment';

/** Direction d'un vote (up = +1 / none = retrait). */
export type CommunityVoteDirection = 'up' | 'none';

/** Action de modération (whitelist HANDLER). */
export type CommunityModerationActionType = 'hide' | 'delete' | 'warn' | 'ban';

/** Rôle community sur user (whitelist HANDLER, ajouté seq 140 sur users). */
export type CommunityRole = 'member' | 'moderator' | 'admin';

/** Thread forum tenant interne (table c45_threads). */
export interface CommunityThread {
  id: string;
  client_id: string;
  author_user_id: string | null;
  title: string;
  body: string;
  category: string;
  is_pinned: boolean;
  is_locked: boolean;
  status: CommunityThreadStatus;
  upvotes_count: number;
  comments_count: number;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

/** Commentaire d'un thread (table c45_comments). Replies nested 1 level. */
export interface CommunityComment {
  id: string;
  thread_id: string;
  author_user_id: string | null;
  /** NULL si commentaire racine, sinon id du commentaire parent (1 level only). */
  parent_comment_id: string | null;
  body: string;
  status: CommunityCommentStatus;
  upvotes_count: number;
  created_at: string;
  updated_at: string;
}

/** Vote utilisateur sur thread/comment (table c45_votes). */
export interface CommunityVote {
  id: string;
  target_type: CommunityTargetType;
  target_id: string;
  voter_user_id: string;
  /** SHA-256 anonymisé de l'IP (anti-spam rate-limit). Jamais l'IP brute. */
  voter_ip_hash: string | null;
  created_at: string;
}

/** Journal d'une action de modération (table c45_moderation_actions). */
export interface CommunityModerationAction {
  id: string;
  target_type: CommunityTargetType;
  target_id: string;
  action: CommunityModerationActionType;
  moderator_user_id: string | null;
  reason: string | null;
  client_id: string;
  created_at: string;
}

/** Input POST/PATCH pour create/update d'un thread. */
export interface CommunityThreadInput {
  title?: string;
  body?: string;
  category?: string;
}

/** Input POST/PATCH pour create/update d'un commentaire. */
export interface CommunityCommentInput {
  body?: string;
  /** Optionnel : id du commentaire parent pour reply nested (1 level only). */
  parent_comment_id?: string | null;
}

/** Input POST pour un vote (target_type + target_id + direction). */
export interface CommunityVoteInput {
  target_type: CommunityTargetType;
  target_id: string;
  direction: CommunityVoteDirection;
}

/** Input POST pour modérer une cible (hide|delete|warn|ban). */
export interface CommunityModerateInput {
  target_type: CommunityTargetType;
  target_id: string;
  action: CommunityModerationActionType;
  reason?: string;
}

/** Filtres optionnels pour listing threads (category / status / search). */
export interface CommunityListThreadsFilters {
  category?: string;
  status?: CommunityThreadStatus;
  search?: string;
}

/** Filtres optionnels pour listing actions modération. */
export interface CommunityListModerationFilters {
  target_type?: CommunityTargetType;
  action?: CommunityModerationActionType;
}

// ── Helpers AUTHED — paritaire avec routes worker.ts seq140 ────────────────

/** GET /api/community/threads — liste threads du tenant. */
export async function listThreads(
  filters?: CommunityListThreadsFilters,
): Promise<ApiResponse<CommunityThread[]>> {
  const params = new URLSearchParams();
  if (filters?.category) params.set('category', filters.category);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.search) params.set('search', filters.search);
  const qs = params.toString();
  return apiFetch<CommunityThread[]>(
    `/community/threads${qs ? `?${qs}` : ''}`,
  );
}

/** POST /api/community/threads — créer un thread (cap leads.write). */
export async function createThread(
  input: CommunityThreadInput,
): Promise<ApiResponse<CommunityThread>> {
  return apiFetch<CommunityThread>('/community/threads', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** GET /api/community/threads/:id — détail d'un thread. */
export async function getThread(
  id: string,
): Promise<ApiResponse<CommunityThread>> {
  return apiFetch<CommunityThread>(
    `/community/threads/${encodeURIComponent(id)}`,
  );
}

/** PATCH /api/community/threads/:id — update partiel (auteur ou modérateur). */
export async function updateThread(
  id: string,
  input: CommunityThreadInput,
): Promise<ApiResponse<CommunityThread>> {
  return apiFetch<CommunityThread>(
    `/community/threads/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
}

/** DELETE /api/community/threads/:id — soft-delete (status=deleted). */
export async function deleteThread(
  id: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(
    `/community/threads/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

/** POST /api/community/threads/:id/pin — toggle pinned (cap settings.manage). */
export async function pinThread(
  id: string,
  is_pinned: boolean,
): Promise<ApiResponse<CommunityThread>> {
  return apiFetch<CommunityThread>(
    `/community/threads/${encodeURIComponent(id)}/pin`,
    { method: 'POST', body: JSON.stringify({ is_pinned }) },
  );
}

/** POST /api/community/threads/:id/lock — toggle locked (cap settings.manage). */
export async function lockThread(
  id: string,
  is_locked: boolean,
): Promise<ApiResponse<CommunityThread>> {
  return apiFetch<CommunityThread>(
    `/community/threads/${encodeURIComponent(id)}/lock`,
    { method: 'POST', body: JSON.stringify({ is_locked }) },
  );
}

/** GET /api/community/threads/:id/comments — liste commentaires d'un thread. */
export async function listComments(
  threadId: string,
): Promise<ApiResponse<CommunityComment[]>> {
  return apiFetch<CommunityComment[]>(
    `/community/threads/${encodeURIComponent(threadId)}/comments`,
  );
}

/** POST /api/community/threads/:id/comments — créer commentaire (cap leads.write). */
export async function createComment(
  threadId: string,
  input: CommunityCommentInput,
): Promise<ApiResponse<CommunityComment>> {
  return apiFetch<CommunityComment>(
    `/community/threads/${encodeURIComponent(threadId)}/comments`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

/** PATCH /api/community/comments/:id — update partiel (auteur ou modérateur). */
export async function updateComment(
  id: string,
  input: CommunityCommentInput,
): Promise<ApiResponse<CommunityComment>> {
  return apiFetch<CommunityComment>(
    `/community/comments/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
}

/** DELETE /api/community/comments/:id — soft-delete (status=deleted). */
export async function deleteComment(
  id: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(
    `/community/comments/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

/** POST /api/community/vote — voter sur un thread. */
export async function voteThread(
  threadId: string,
  direction: CommunityVoteDirection,
): Promise<ApiResponse<{ ok: boolean; newCount: number }>> {
  return apiFetch<{ ok: boolean; newCount: number }>('/community/vote', {
    method: 'POST',
    body: JSON.stringify({
      target_type: 'thread' as const,
      target_id: threadId,
      direction,
    }),
  });
}

/** POST /api/community/vote — voter sur un commentaire. */
export async function voteComment(
  commentId: string,
  direction: CommunityVoteDirection,
): Promise<ApiResponse<{ ok: boolean; newCount: number }>> {
  return apiFetch<{ ok: boolean; newCount: number }>('/community/vote', {
    method: 'POST',
    body: JSON.stringify({
      target_type: 'comment' as const,
      target_id: commentId,
      direction,
    }),
  });
}

/** GET /api/community/moderation — queue actions modération (cap settings.manage). */
export async function listModerationActions(
  filters?: CommunityListModerationFilters,
): Promise<ApiResponse<CommunityModerationAction[]>> {
  const params = new URLSearchParams();
  if (filters?.target_type) params.set('target_type', filters.target_type);
  if (filters?.action) params.set('action', filters.action);
  const qs = params.toString();
  return apiFetch<CommunityModerationAction[]>(
    `/community/moderation${qs ? `?${qs}` : ''}`,
  );
}

/** POST /api/community/moderation — modérer une cible (cap settings.manage). */
export async function moderateTarget(
  input: CommunityModerateInput,
): Promise<ApiResponse<CommunityModerationAction>> {
  return apiFetch<CommunityModerationAction>('/community/moderation', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ════════════════════════════════════════════════════════════════════════════
// LOT SUBSCRIPTIONS ADVANCED S46 — Sprint 46 (seq141) — extension billing S22/S31
//
// Étend les rails billing existants (saas-billing*.ts INTOUCHÉS) avec :
//   - trials configurables (7/14/30 jours)
//   - proration upgrades/downgrades (calcul HANDLER pure subscription-engine)
//   - dunning smart retries (1d / 3d / 7d)
//   - pause/resume
//   - métriques MRR/ARR/churn (snapshots cron)
//   - history audit toutes mutations
//
// 4 interfaces (SubscriptionChange, MrrSnapshot, ProrationPreview,
// DunningLogEntry) + 10 helpers AUTHED. Cap FIGÉE settings.manage admin partout
// (AUCUN ajout à ALL_CAPABILITIES seq 80). Stripe live INACTIF par défaut —
// flag BILLING_LIVE_ENABLED tenant-by-tenant. Contrat réponses : json({ data })
// succès / json({ error }) erreur — PAS de champ `code`. Voir docs/LOT-
// SUBSCRIPTIONS-ADV-S46.md §6.
// ════════════════════════════════════════════════════════════════════════════

/** Type de changement audité dans subscription_changes (whitelist HANDLER). */
export type SubscriptionChangeType =
  | 'upgrade'
  | 'downgrade'
  | 'pause'
  | 'resume'
  | 'trial_start'
  | 'trial_end'
  | 'dunning_attempt'
  | 'cancel'
  | 'reactivate';

/** Politique d'annulation (enum HANDLER — pas CHECK SQL). */
export type SubscriptionCancellationPolicy = 'immediate' | 'end_of_period';

/** Ligne du log dunning (encodée dans subscriptions.dunning_log_json). */
export interface DunningLogEntry {
  /** Numéro de tentative (1-indexé). */
  attempt: number;
  /** Timestamp ISO de la tentative. */
  attempted_at: string;
  /** Raison de l'échec retournée par Stripe (ou 'mock' en mode live_branch_locked). */
  failure_reason: string | null;
  /** Timestamp ISO du prochain retry planifié (NULL si abandon final). */
  next_retry_at: string | null;
}

/** Audit d'une mutation subscription (table subscription_changes). */
export interface SubscriptionChange {
  id: string;
  subscription_id: string;
  client_id: string | null;
  change_type: SubscriptionChangeType;
  from_plan_id: string | null;
  to_plan_id: string | null;
  prorated_amount_cents: number;
  effective_at: string | null;
  reason: string | null;
  /** Payload libre HANDLER (proration breakdown, dunning response Stripe, etc.). */
  metadata_json: string | null;
  created_at: string;
}

/** Snapshot MRR/ARR/churn pour un tenant à une date donnée (table mrr_snapshots). */
export interface MrrSnapshot {
  id: string;
  client_id: string | null;
  agency_id: string | null;
  snapshot_date: string;
  mrr_cents: number;
  arr_cents: number;
  active_subscriptions: number;
  new_subscriptions: number;
  churned_subscriptions: number;
  currency: string;
  created_at: string;
}

/** Preview proration avant upgrade/downgrade (pure HANDLER, pas de mutation). */
export interface ProrationPreview {
  /** Plan actuel (id). */
  from_plan_id: string | null;
  /** Plan cible demandé. */
  to_plan_id: string;
  /** Montant prorata appliqué (positif = crédit dû au client, négatif = surcharge). */
  prorated_amount_cents: number;
  /** Devise (CAD V1). */
  currency: string;
  /** true si upgrade (prix supérieur), false si downgrade. */
  is_upgrade: boolean;
  /** Jours restants dans la période courante. */
  days_remaining: number;
  /** Durée totale de la période en jours (référence calcul). */
  period_days: number;
  /** true tant que Stripe live inactif pour ce tenant (live_branch_locked). */
  mock?: boolean;
}

/** Métriques MRR retournées par GET /api/billing/metrics/mrr. */
export interface MrrMetrics {
  mrr_cents: number;
  arr_cents: number;
  /** Taux de churn période (0..1). */
  churn_rate: number;
  /** Taux de croissance période (peut être négatif). */
  growth_rate: number;
  currency: string;
  /** Série de snapshots ordonnés snapshot_date ASC. */
  snapshots: MrrSnapshot[];
}

/** GET /api/subscriptions/:id/proration-preview — preview prorata upgrade/downgrade. */
export async function previewProration(
  subscriptionId: string,
  params: { to_plan_id: string },
): Promise<ApiResponse<ProrationPreview>> {
  const qs = new URLSearchParams({ to_plan_id: params.to_plan_id }).toString();
  return apiFetch<ProrationPreview>(
    `/subscriptions/${subscriptionId}/proration-preview?${qs}`,
  );
}

/** POST /api/subscriptions/:id/upgrade — upgrade vers un plan supérieur (proration auto). */
export async function upgradeSubscription(
  subscriptionId: string,
  body: { to_plan_id: string },
): Promise<ApiResponse<{ subscription: ClientSubscription; mock?: boolean; reason?: string }>> {
  return apiFetch(`/subscriptions/${subscriptionId}/upgrade`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** POST /api/subscriptions/:id/downgrade — downgrade vers un plan inférieur (proration auto). */
export async function downgradeSubscription(
  subscriptionId: string,
  body: { to_plan_id: string },
): Promise<ApiResponse<{ subscription: ClientSubscription; mock?: boolean; reason?: string }>> {
  return apiFetch(`/subscriptions/${subscriptionId}/downgrade`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** POST /api/subscriptions/:id/pause — mettre en pause (until? = ISO date pour auto-resume). */
export async function pauseSubscription(
  subscriptionId: string,
  body: { until?: string } = {},
): Promise<ApiResponse<{ subscription: ClientSubscription; mock?: boolean; reason?: string }>> {
  return apiFetch(`/subscriptions/${subscriptionId}/pause`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** POST /api/subscriptions/:id/resume — reprendre une subscription paused. */
export async function resumeSubscriptionAdv(
  subscriptionId: string,
): Promise<ApiResponse<{ subscription: ClientSubscription; mock?: boolean; reason?: string }>> {
  return apiFetch(`/subscriptions/${subscriptionId}/resume`, { method: 'POST' });
}

/** POST /api/subscriptions/:id/cancel — annuler (policy = immediate | end_of_period). */
export async function cancelSubscriptionAdv(
  subscriptionId: string,
  body: { policy?: SubscriptionCancellationPolicy } = {},
): Promise<ApiResponse<{ subscription: ClientSubscription; mock?: boolean; reason?: string }>> {
  return apiFetch(`/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** POST /api/subscriptions/cron/dunning — relance le runner dunning (cron). */
export async function runDunningCron(): Promise<
  ApiResponse<{ processed: number; succeeded: number; failed: number; mock?: boolean }>
> {
  return apiFetch('/subscriptions/cron/dunning', { method: 'POST' });
}

/** GET /api/subscriptions/:id/history — liste audit toutes mutations subscription. */
export async function getSubscriptionHistory(
  subscriptionId: string,
): Promise<ApiResponse<SubscriptionChange[]>> {
  return apiFetch<SubscriptionChange[]>(`/subscriptions/${subscriptionId}/history`);
}

/** GET /api/billing/metrics/mrr — métriques MRR/ARR/churn/growth (cap settings.manage). */
export async function getMrrMetrics(
  params: { period_days?: number } = {},
): Promise<ApiResponse<MrrMetrics>> {
  const qs = new URLSearchParams();
  if (params.period_days != null) qs.set('period_days', String(params.period_days));
  const tail = qs.toString();
  return apiFetch<MrrMetrics>(
    `/billing/metrics/mrr${tail ? `?${tail}` : ''}`,
  );
}

/** POST /api/billing/cron/mrr-snapshot — snapshot MRR quotidien (cron idempotent). */
export async function runMrrSnapshotCron(): Promise<
  ApiResponse<{ snapshot: MrrSnapshot | null; mock?: boolean }>
> {
  return apiFetch('/billing/cron/mrr-snapshot', { method: 'POST' });
}


// ════════════════════════════════════════════════════════════════════════════
// Sprint 47 — Multi-warehouse + Dropshipping (seq142) — Manager-A Phase A
// ════════════════════════════════════════════════════════════════════════════
//
// Étend le pipeline e-commerce S(E1+) avec stock multi-warehouse + transferts
// inter-warehouse + dropshipping fournisseurs (CSV catalog import + routing
// auto order vers supplier). Caps FIGÉES : clients.manage (warehouses /
// transfers / routings / dropship_orders) + settings.manage (suppliers admin
// — secrets api_key). AUCUN ajout ALL_CAPABILITIES seq80.
//
// 5 interfaces (Warehouse + InventoryTransfer + DropshipSupplier + DropshipRouting
// + DropshipOrder) + 19 helpers AUTHED. supplier_api FLAG INACTIF par défaut
// (api_endpoint NULL ⇒ no-op). api_key_encrypted MASQUÉ en GET (jamais en clair).
// Contrat réponses : json({ data }) succès / json({ error }) erreur — PAS de
// champ `code`. Voir docs/LOT-WAREHOUSE-DROPSHIP-S47.md §6.
// ════════════════════════════════════════════════════════════════════════════

/** Statut d'un transfer inter-warehouse (whitelist HANDLER — pas CHECK SQL). */
export type InventoryTransferStatus =
  | 'pending'
  | 'in_transit'
  | 'completed'
  | 'cancelled';

/** Statut d'un dropship_order (whitelist HANDLER — pas CHECK SQL). */
export type DropshipOrderStatus =
  | 'pending'
  | 'sent'
  | 'confirmed'
  | 'shipped'
  | 'delivered'
  | 'failed';

/** Warehouse — lieu physique de stock tenant-scoped. */
export interface Warehouse {
  id: string;
  client_id: string;
  name: string;
  address: string | null;
  country: string | null;
  country_subdiv: string | null;
  is_active: number;
  is_default: number;
  contact_email: string | null;
  contact_phone: string | null;
  created_at: string;
  updated_at: string;
}

/** Input création/mise à jour warehouse. */
export interface WarehouseInput {
  name?: string;
  address?: string | null;
  country?: string | null;
  country_subdiv?: string | null;
  is_active?: 0 | 1;
  contact_email?: string | null;
  contact_phone?: string | null;
}

/** Transfer inter-warehouse (table inventory_transfers). */
export interface InventoryTransfer {
  id: string;
  client_id: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  variant_id: string;
  quantity: number;
  status: InventoryTransferStatus;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: string;
  completed_at: string | null;
}

/** Input création transfer inter-warehouse. */
export interface InventoryTransferInput {
  from_warehouse_id: string;
  to_warehouse_id: string;
  variant_id: string;
  quantity: number;
  notes?: string | null;
}

/** Supplier dropshipping (table dropship_suppliers). */
export interface DropshipSupplier {
  id: string;
  client_id: string;
  name: string;
  api_endpoint: string | null;
  /** Masqué en GET — `'***'` si chiffré, `null` si pas configuré. */
  api_key_set: '***' | null;
  csv_format_json: string | null;
  contact_email: string | null;
  default_shipping_cost_cents: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

/** Input création/mise à jour supplier (api_key en clair → chiffrée HANDLER). */
export interface DropshipSupplierInput {
  name?: string;
  api_endpoint?: string | null;
  /** Clair côté client — chiffré HANDLER via TOKEN_KEY HMAC avant DB. */
  api_key?: string | null;
  csv_format_json?: string | null;
  contact_email?: string | null;
  default_shipping_cost_cents?: number;
  is_active?: 0 | 1;
}

/** Routing variant → supplier (table dropship_routings). UNIQUE par variant×client. */
export interface DropshipRouting {
  id: string;
  client_id: string;
  variant_id: string;
  supplier_id: string;
  auto_route: number;
  supplier_sku: string | null;
  cost_cents: number;
  created_at: string;
  updated_at: string;
}

/** Input création/mise à jour routing. */
export interface DropshipRoutingInput {
  variant_id?: string;
  supplier_id?: string;
  auto_route?: 0 | 1;
  supplier_sku?: string | null;
  cost_cents?: number;
}

/** Dropship order — order e-commerce dispatché chez un supplier. */
export interface DropshipOrder {
  id: string;
  client_id: string | null;
  order_id: string | null;
  supplier_id: string | null;
  supplier_order_ref: string | null;
  status: DropshipOrderStatus;
  tracking_number: string | null;
  created_at: string;
  updated_at: string;
}

/** Résultat retourné par POST /api/dropship-orders/route/:orderId. */
export interface RouteOrderToSupplierResult {
  items_routed: number;
  dropship_orders: Array<{
    id: string;
    supplier_id: string;
    order_id: string;
  }>;
}

// ── Warehouses CRUD (5) ───────────────────────────────────────────────────

/** GET /api/warehouses — liste warehouses tenant (cap clients.manage). */
export async function listWarehouses(): Promise<ApiResponse<Warehouse[]>> {
  return apiFetch<Warehouse[]>('/warehouses');
}

/** POST /api/warehouses — créer warehouse (cap clients.manage). */
export async function createWarehouse(
  body: WarehouseInput,
): Promise<ApiResponse<Warehouse>> {
  return apiFetch<Warehouse>('/warehouses', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** PATCH /api/warehouses/:id — mise à jour warehouse (cap clients.manage). */
export async function updateWarehouse(
  warehouseId: string,
  body: WarehouseInput,
): Promise<ApiResponse<Warehouse>> {
  return apiFetch<Warehouse>(`/warehouses/${warehouseId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** DELETE /api/warehouses/:id — soft-delete warehouse (cap clients.manage). */
export async function deleteWarehouse(
  warehouseId: string,
): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch<{ ok: true }>(`/warehouses/${warehouseId}`, { method: 'DELETE' });
}

/** POST /api/warehouses/:id/default — set warehouse par défaut tenant (cap clients.manage). */
export async function setDefaultWarehouse(
  warehouseId: string,
): Promise<ApiResponse<Warehouse>> {
  return apiFetch<Warehouse>(`/warehouses/${warehouseId}/default`, { method: 'POST' });
}

// ── Inventory Transfers (3) ────────────────────────────────────────────────

/** GET /api/inventory-transfers — liste transfers tenant (cap clients.manage). */
export async function listInventoryTransfers(): Promise<
  ApiResponse<InventoryTransfer[]>
> {
  return apiFetch<InventoryTransfer[]>('/inventory-transfers');
}

/** POST /api/inventory-transfers — créer transfer (cap clients.manage). */
export async function createInventoryTransfer(
  body: InventoryTransferInput,
): Promise<ApiResponse<InventoryTransfer>> {
  return apiFetch<InventoryTransfer>('/inventory-transfers', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** POST /api/inventory-transfers/:id/complete — applique transfer (cap clients.manage). */
export async function completeInventoryTransfer(
  transferId: string,
): Promise<ApiResponse<InventoryTransfer>> {
  return apiFetch<InventoryTransfer>(
    `/inventory-transfers/${transferId}/complete`,
    { method: 'POST' },
  );
}

// ── Dropship Suppliers CRUD (5) ────────────────────────────────────────────

/** GET /api/dropship-suppliers — liste suppliers (cap settings.manage). */
export async function listDropshipSuppliers(): Promise<
  ApiResponse<DropshipSupplier[]>
> {
  return apiFetch<DropshipSupplier[]>('/dropship-suppliers');
}

/** POST /api/dropship-suppliers — créer supplier (cap settings.manage). */
export async function createDropshipSupplier(
  body: DropshipSupplierInput,
): Promise<ApiResponse<DropshipSupplier>> {
  return apiFetch<DropshipSupplier>('/dropship-suppliers', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** PATCH /api/dropship-suppliers/:id — mise à jour supplier (cap settings.manage). */
export async function updateDropshipSupplier(
  supplierId: string,
  body: DropshipSupplierInput,
): Promise<ApiResponse<DropshipSupplier>> {
  return apiFetch<DropshipSupplier>(`/dropship-suppliers/${supplierId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** DELETE /api/dropship-suppliers/:id — soft-delete supplier (cap settings.manage). */
export async function deleteDropshipSupplier(
  supplierId: string,
): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch<{ ok: true }>(`/dropship-suppliers/${supplierId}`, {
    method: 'DELETE',
  });
}

/**
 * POST /api/dropship-suppliers/:id/import-csv — import catalogue CSV (cap settings.manage).
 *
 * Body JSON : `{ csv: string }`. Le CSV est passé en string (pas multipart) —
 * parseSupplierCsv() HANDLER applique le mapping configuré sur supplier.csv_format_json.
 * Retourne `imported` (nb d'items insérés) + `skipped` (lignes invalides).
 */
export async function importSupplierCatalogCsv(
  supplierId: string,
  csvText: string,
): Promise<ApiResponse<{ imported: number; skipped: number }>> {
  return apiFetch<{ imported: number; skipped: number }>(
    `/dropship-suppliers/${supplierId}/import-csv`,
    {
      method: 'POST',
      body: JSON.stringify({ csv: csvText }),
    },
  );
}

// ── Dropship Routings CRUD (4) ─────────────────────────────────────────────

/** GET /api/dropship-routings — liste routings tenant (cap clients.manage). */
export async function listDropshipRoutings(): Promise<
  ApiResponse<DropshipRouting[]>
> {
  return apiFetch<DropshipRouting[]>('/dropship-routings');
}

/** POST /api/dropship-routings — créer routing (cap clients.manage). UNIQUE par variant×client. */
export async function createDropshipRouting(
  body: DropshipRoutingInput,
): Promise<ApiResponse<DropshipRouting>> {
  return apiFetch<DropshipRouting>('/dropship-routings', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** PATCH /api/dropship-routings/:id — mise à jour routing (cap clients.manage). */
export async function updateDropshipRouting(
  routingId: string,
  body: DropshipRoutingInput,
): Promise<ApiResponse<DropshipRouting>> {
  return apiFetch<DropshipRouting>(`/dropship-routings/${routingId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** DELETE /api/dropship-routings/:id — supprimer routing (cap clients.manage). */
export async function deleteDropshipRouting(
  routingId: string,
): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch<{ ok: true }>(`/dropship-routings/${routingId}`, {
    method: 'DELETE',
  });
}

// ── Dropship Orders (2) ────────────────────────────────────────────────────

/** GET /api/dropship-orders — liste dropship_orders tenant (cap clients.manage). */
export async function listDropshipOrders(): Promise<
  ApiResponse<DropshipOrder[]>
> {
  return apiFetch<DropshipOrder[]>('/dropship-orders');
}

/**
 * POST /api/dropship-orders/route/:orderId — dispatch order vers supplier(s).
 *
 * Pour chaque item de l'order, lookup dropship_routings.auto_route=1 ⇒ INSERT
 * dropship_orders (status='pending'). Items sans routing ⇒ assignés au
 * warehouse par défaut tenant (Phase B). Cap clients.manage.
 */
export async function routeOrderToSupplier(
  orderId: string,
): Promise<ApiResponse<RouteOrderToSupplierResult>> {
  return apiFetch<RouteOrderToSupplierResult>(
    `/dropship-orders/route/${orderId}`,
    { method: 'POST' },
  );
}


// ════════════════════════════════════════════════════════════════════════════
// Sprint 48 — B2B wholesale + Bundles + Pre-orders (seq143) — Manager-A Phase A
// ════════════════════════════════════════════════════════════════════════════
//
// Étend le pipeline e-commerce S(E1+) avec :
//   1) Customer groups (retail / wholesale / VIP / custom-named) + tier pricing
//      (variant × group × min_quantity).
//   2) Product bundles (groupage avec discount calculé vs sum items).
//   3) Pre-orders / waitlist queue (visiteur join via PUBLIC endpoint, email
//      seul requis ; conversion → order quand restock).
//
// Caps FIGÉES : clients.manage (groups CRUD + assign, tier_prices CRUD +
// resolve, bundles CRUD + items, preorders list + notify + cancel + convert).
// PUBLIC (pré-requireAuth) : POST /api/public/preorders — visitor join waitlist
// (rate-limit + honeypot HANDLER, calque /api/public/tickets). AUCUN ajout
// ALL_CAPABILITIES seq80.
//
// 6 interfaces + 1 résolution résultat + ~25 helpers. Contrat réponses :
// json({ data }) succès / json({ error }) erreur — PAS de champ `code`.
// Voir docs/LOT-B2B-BUNDLES-PREORDERS-S48.md §6.
// ════════════════════════════════════════════════════════════════════════════

/** Statut d'un preorder_queue (whitelist HANDLER — pas CHECK SQL). */
export type PreorderStatus =
  | 'queued'
  | 'notified'
  | 'converted'
  | 'cancelled';

/** Customer group — segment tarifaire tenant-scoped. */
export interface CustomerGroup {
  id: string;
  client_id: string;
  name: string;
  slug: string | null;
  description: string | null;
  default_discount_pct: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

/** Input création/mise à jour customer_group. */
export interface CustomerGroupInput {
  name?: string;
  slug?: string | null;
  description?: string | null;
  default_discount_pct?: number;
  is_active?: 0 | 1;
}

/** Assignation customer → group (table customer_group_assignments). */
export interface CustomerGroupAssignment {
  id: string;
  group_id: string;
  customer_id: string;
  client_id: string;
  assigned_at: string;
  expires_at: string | null;
}

/** Tier price (variant × group × min_quantity). UNIQUE par triplet. */
export interface TierPrice {
  id: string;
  product_variant_id: string;
  group_id: string;
  client_id: string;
  price_cents: number;
  min_quantity: number;
  created_at: string;
  updated_at: string;
}

/** Input création/mise à jour tier_price. */
export interface TierPriceInput {
  product_variant_id?: string;
  group_id?: string;
  price_cents?: number;
  min_quantity?: number;
}

/** Product bundle (table product_bundles). */
export interface ProductBundle {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  total_price_cents: number | null;
  discount_pct: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

/** Input création/mise à jour bundle. */
export interface ProductBundleInput {
  name?: string;
  description?: string | null;
  total_price_cents?: number | null;
  discount_pct?: number;
  is_active?: 0 | 1;
}

/** Item composant d'un bundle (table bundle_items). */
export interface BundleItem {
  id: string;
  bundle_id: string;
  product_variant_id: string;
  quantity: number;
  created_at: string;
}

/** Input ajout item à un bundle. */
export interface BundleItemInput {
  product_variant_id: string;
  quantity?: number;
}

/** Preorder / waitlist entry (table preorder_queue). */
export interface PreorderEntry {
  id: string;
  variant_id: string;
  customer_id: string;
  client_id: string;
  quantity: number;
  email: string | null;
  status: PreorderStatus;
  notified_at: string | null;
  converted_order_id: string | null;
  created_at: string;
}

/** Input création preorder (PUBLIC visitor join). */
export interface PreorderInput {
  variant_id: string;
  email: string;
  quantity?: number;
  /** Honeypot — DOIT être vide. Visiteur humain ne le remplit pas. */
  website?: string;
}

/** Résolution prix HANDLER pour un (variant, customer, qty). */
export interface ResolvePriceResult {
  price_cents: number;
  group_applied: string | null;
  discount_pct: number;
}

/** Filtres optionnels listPreorders (admin). */
export interface PreorderFilters {
  variant_id?: string;
  customer_id?: string;
  status?: PreorderStatus;
}

// ── Customer Groups CRUD (4 + 3 assign) ────────────────────────────────────

/** GET /api/customer-groups — liste groups tenant (cap clients.manage). */
export async function listCustomerGroups(): Promise<
  ApiResponse<CustomerGroup[]>
> {
  return apiFetch<CustomerGroup[]>('/customer-groups');
}

/** POST /api/customer-groups — créer group (cap clients.manage). */
export async function createCustomerGroup(
  body: CustomerGroupInput,
): Promise<ApiResponse<CustomerGroup>> {
  return apiFetch<CustomerGroup>('/customer-groups', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** PATCH /api/customer-groups/:id — mise à jour group (cap clients.manage). */
export async function updateCustomerGroup(
  groupId: string,
  body: CustomerGroupInput,
): Promise<ApiResponse<CustomerGroup>> {
  return apiFetch<CustomerGroup>(`/customer-groups/${groupId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** DELETE /api/customer-groups/:id — soft-delete group (cap clients.manage). */
export async function deleteCustomerGroup(
  groupId: string,
): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch<{ ok: true }>(`/customer-groups/${groupId}`, {
    method: 'DELETE',
  });
}

/** POST /api/customer-groups/:id/assign — assigner customer au group (cap clients.manage). */
export async function assignCustomerToGroup(
  groupId: string,
  customerId: string,
  expiresAt?: string | null,
): Promise<ApiResponse<CustomerGroupAssignment>> {
  return apiFetch<CustomerGroupAssignment>(
    `/customer-groups/${groupId}/assign`,
    {
      method: 'POST',
      body: JSON.stringify({ customer_id: customerId, expires_at: expiresAt ?? null }),
    },
  );
}

/** POST /api/customer-groups/:id/remove — retirer customer du group (cap clients.manage). */
export async function removeFromGroup(
  groupId: string,
  customerId: string,
): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch<{ ok: true }>(`/customer-groups/${groupId}/remove`, {
    method: 'POST',
    body: JSON.stringify({ customer_id: customerId }),
  });
}

/** GET /api/customers/:id/groups — liste groups d'un customer (cap clients.manage). */
export async function getCustomerGroups(
  customerId: string,
): Promise<ApiResponse<CustomerGroup[]>> {
  return apiFetch<CustomerGroup[]>(`/customers/${customerId}/groups`);
}

// ── Tier Pricing CRUD + resolve (5) ────────────────────────────────────────

/** GET /api/tier-prices — liste tier_prices tenant (cap clients.manage). */
export async function listTierPrices(
  variantId?: string,
): Promise<ApiResponse<TierPrice[]>> {
  const qs = variantId ? `?variant_id=${encodeURIComponent(variantId)}` : '';
  return apiFetch<TierPrice[]>(`/tier-prices${qs}`);
}

/** POST /api/tier-prices — créer tier (cap clients.manage). UNIQUE par variant×group×min_qty. */
export async function createTierPrice(
  body: TierPriceInput,
): Promise<ApiResponse<TierPrice>> {
  return apiFetch<TierPrice>('/tier-prices', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** PATCH /api/tier-prices/:id — mise à jour tier (cap clients.manage). */
export async function updateTierPrice(
  tierId: string,
  body: TierPriceInput,
): Promise<ApiResponse<TierPrice>> {
  return apiFetch<TierPrice>(`/tier-prices/${tierId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** DELETE /api/tier-prices/:id — supprimer tier (cap clients.manage). */
export async function deleteTierPrice(
  tierId: string,
): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch<{ ok: true }>(`/tier-prices/${tierId}`, { method: 'DELETE' });
}

/**
 * GET /api/tier-prices/resolve — résout le prix applicable pour
 * (variant, customer, quantity). Lookup groups du customer + meilleur tier
 * matching min_quantity ≤ qty. Cap clients.manage.
 */
export async function resolvePriceForCustomer(
  variantId: string,
  customerId: string,
  quantity: number,
): Promise<ApiResponse<ResolvePriceResult>> {
  const qs = `?variant_id=${encodeURIComponent(variantId)}&customer_id=${encodeURIComponent(customerId)}&quantity=${encodeURIComponent(String(quantity))}`;
  return apiFetch<ResolvePriceResult>(`/tier-prices/resolve${qs}`);
}

// ── Product Bundles CRUD + items (7) ───────────────────────────────────────

/** GET /api/product-bundles — liste bundles tenant (cap clients.manage). */
export async function listProductBundles(): Promise<
  ApiResponse<ProductBundle[]>
> {
  return apiFetch<ProductBundle[]>('/product-bundles');
}

/** POST /api/product-bundles — créer bundle (cap clients.manage). */
export async function createBundle(
  body: ProductBundleInput,
): Promise<ApiResponse<ProductBundle>> {
  return apiFetch<ProductBundle>('/product-bundles', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** GET /api/product-bundles/:id — détail bundle (cap clients.manage). */
export async function getBundle(
  bundleId: string,
): Promise<ApiResponse<ProductBundle>> {
  return apiFetch<ProductBundle>(`/product-bundles/${bundleId}`);
}

/** PATCH /api/product-bundles/:id — mise à jour bundle (cap clients.manage). */
export async function updateBundle(
  bundleId: string,
  body: ProductBundleInput,
): Promise<ApiResponse<ProductBundle>> {
  return apiFetch<ProductBundle>(`/product-bundles/${bundleId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** DELETE /api/product-bundles/:id — soft-delete bundle (cap clients.manage). */
export async function deleteBundle(
  bundleId: string,
): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch<{ ok: true }>(`/product-bundles/${bundleId}`, {
    method: 'DELETE',
  });
}

/** GET /api/product-bundles/:id/items — liste items d'un bundle (cap clients.manage). */
export async function getBundleItems(
  bundleId: string,
): Promise<ApiResponse<BundleItem[]>> {
  return apiFetch<BundleItem[]>(`/product-bundles/${bundleId}/items`);
}

/** POST /api/product-bundles/:id/items — ajouter item au bundle (cap clients.manage). */
export async function addBundleItem(
  bundleId: string,
  body: BundleItemInput,
): Promise<ApiResponse<BundleItem>> {
  return apiFetch<BundleItem>(`/product-bundles/${bundleId}/items`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** DELETE /api/bundle-items/:id — supprimer un item d'un bundle (cap clients.manage). */
export async function removeBundleItem(
  itemId: string,
): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch<{ ok: true }>(`/bundle-items/${itemId}`, {
    method: 'DELETE',
  });
}

// ── Pre-orders CRUD (1 PUBLIC + 4 admin) ───────────────────────────────────

/** GET /api/preorders — liste preorders tenant (cap clients.manage). */
export async function listPreorders(
  filters?: PreorderFilters,
): Promise<ApiResponse<PreorderEntry[]>> {
  const parts: string[] = [];
  if (filters?.variant_id) parts.push(`variant_id=${encodeURIComponent(filters.variant_id)}`);
  if (filters?.customer_id) parts.push(`customer_id=${encodeURIComponent(filters.customer_id)}`);
  if (filters?.status) parts.push(`status=${encodeURIComponent(filters.status)}`);
  const qs = parts.length > 0 ? `?${parts.join('&')}` : '';
  return apiFetch<PreorderEntry[]>(`/preorders${qs}`);
}

/**
 * POST /api/public/preorders — PUBLIC visitor join waitlist.
 *
 * Endpoint AUCUNE auth — rate-limit + honeypot HANDLER (champ `website` doit
 * être vide). Email seul requis. Phase B : envoi email confirmation + Loi 25
 * consent stocké à part. Cap : aucune (pré-requireAuth).
 */
export async function createPreorder(
  body: PreorderInput,
): Promise<ApiResponse<{ id: string; status: PreorderStatus }>> {
  return apiFetch<{ id: string; status: PreorderStatus }>('/public/preorders', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** POST /api/preorders/:id/notify — notify customer (cap clients.manage). */
export async function notifyPreorder(
  preorderId: string,
): Promise<ApiResponse<{ notified: boolean; email_sent: boolean }>> {
  return apiFetch<{ notified: boolean; email_sent: boolean }>(
    `/preorders/${preorderId}/notify`,
    { method: 'POST' },
  );
}

/** POST /api/preorders/:id/cancel — cancel preorder (cap clients.manage). */
export async function cancelPreorder(
  preorderId: string,
): Promise<ApiResponse<PreorderEntry>> {
  return apiFetch<PreorderEntry>(`/preorders/${preorderId}/cancel`, {
    method: 'POST',
  });
}

/**
 * POST /api/preorders/:id/convert — convertit le preorder en order (cap
 * clients.manage). Body optionnel `{ order_id }` pour lier un order existant,
 * sinon HANDLER crée un draft order minimal.
 */
export async function convertPreorderToOrder(
  preorderId: string,
  orderId?: string,
): Promise<ApiResponse<{ preorder: PreorderEntry; order_id: string }>> {
  return apiFetch<{ preorder: PreorderEntry; order_id: string }>(
    `/preorders/${preorderId}/convert`,
    {
      method: 'POST',
      body: JSON.stringify(orderId ? { order_id: orderId } : {}),
    },
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Sprint 49 — AFFILIATES / REFERRALS (seq144)
//
// Extension du module affiliation S(G2) (seq92, types `Affiliate` /
// `AffiliateProgram` / `AffiliateCommission` déjà déclarés ci-dessus) vers un
// modèle order-based avec :
//   - tiers (starter|silver|gold ⇒ commission_pct 5/10/15%)
//   - referrals attribués à un ORDER (vs lead S92)
//   - payouts mensuels en batch (status pending|paid|failed)
//   - link click tracking (visitor_id cookie 1st-party + landing page)
//   - PUBLIC signup (opt-in programme affilié) + track-click (script tracking
//     site marchand).
//
// Capabilities FIGÉES :
//   - clients.manage : affiliates CRUD + metrics, referrals confirm/reverse
//   - settings.manage : payouts createBatch + markPaid (action sensible)
//   - PUBLIC : signup + track-click (rate-limit HANDLER)
//
// ApiResponse / apiFetch GELÉS — on n'ajoute que types + helpers, AUCUN
// changement de signature.
// ════════════════════════════════════════════════════════════════════════════

/** Tier d'affilié — détermine la commission par défaut. Validé HANDLER. */
export type AffiliateTier = 'starter' | 'silver' | 'gold';

/** Statut d'un referral order-based — pending|confirmed|paid|reversed. Validé HANDLER. */
export type AffiliateReferralStatus =
  | 'pending'
  | 'confirmed'
  | 'paid'
  | 'reversed';

/** Statut d'un payout batch — pending|paid|failed. Validé HANDLER. */
export type AffiliatePayoutStatus = 'pending' | 'paid' | 'failed';

/** Méthode de versement — manual|stripe_connect. stripe_connect INACTIF V1. */
export type AffiliatePayoutMethod = 'manual' | 'stripe_connect';

/**
 * Sprint 49 — interface Affiliate (étend `Affiliate` S92 ci-dessus). Réutilise
 * les colonnes S92 (id/client_id/agency_id/name/email/code/status/timestamps)
 * + colonnes additives seq144 (customer_id/tier/commission_pct/totals/payout).
 *
 * NB : on conserve `Affiliate` (S92) comme alias commun front. Les colonnes
 * additives sont OPTIONNELLES côté TS — coexistence des 2 modèles le temps de
 * la migration.
 */
export interface AffiliateExtended extends Affiliate {
  customer_id?: string | null;
  tier?: AffiliateTier | null;
  commission_pct?: number | null;
  total_commissions_cents?: number | null;
  total_referrals_count?: number | null;
  payout_method?: AffiliatePayoutMethod | null;
  payout_account_ref?: string | null;
}

/**
 * Referral order-based Sprint 49. La colonne legacy `lead_id` (S92) coexiste
 * dans la table — non exposée ici. Champs additifs : order_id, customer_id,
 * commission_cents, status, confirmed_at, paid_at, payout_id.
 */
export interface AffiliateReferral {
  id: string;
  affiliate_id: string;
  order_id?: string | null;
  customer_id?: string | null;
  client_id?: string | null;
  commission_cents?: number | null;
  status?: AffiliateReferralStatus | null;
  confirmed_at?: string | null;
  paid_at?: string | null;
  payout_id?: string | null;
  code?: string | null;
  created_at?: string | null;
}

/**
 * Payout batch mensuel. Regroupe N referrals confirmés en 1 versement.
 * stripe_transfer_id PRÉSENT mais flag INACTIF V1 (payout manuel admin).
 */
export interface AffiliatePayout {
  id: string;
  affiliate_id: string;
  client_id: string;
  period_start?: string | null;
  period_end?: string | null;
  total_cents?: number | null;
  referrals_count?: number | null;
  status?: AffiliatePayoutStatus | null;
  paid_at?: string | null;
  /** Flag INACTIF V1 (payout manuel admin). Phase B câblera Stripe Connect. */
  stripe_transfer_id?: string | null;
  notes?: string | null;
  created_at?: string | null;
}

/**
 * Click sur un lien d'affiliation. PII Loi 25 : ip_hash + user_agent_hash
 * (SHA256 HANDLER, pas brut). La colonne legacy `ip` (S92) coexiste — non
 * exposée ici.
 */
export interface AffiliateClick {
  id: string;
  affiliate_id: string;
  visitor_id?: string | null;
  source_url?: string | null;
  landing_page?: string | null;
  ip_hash?: string | null;
  user_agent_hash?: string | null;
  country?: string | null;
  converted_order_id?: string | null;
  clicked_at?: string | null;
  converted_at?: string | null;
}

/**
 * Métriques agrégées d'un affilié — clicks/conversions/total commission/taux.
 * Calculées SERVEUR (computeAffiliateMetrics). UI MyDashboard + admin metrics.
 */
export interface AffiliateMetrics {
  affiliate_id: string;
  clicks: number;
  conversions: number;
  /** Total des commissions confirmées (cents). */
  total_commission_cents: number;
  /** Ratio conversions / clicks ∈ [0..1]. */
  conversion_rate: number;
  /** Total referrals (toutes status confondues — pour le ratio). */
  total_referrals?: number;
}

/** Body POST /api/affiliates (admin) — create affiliate avec tier/commission. */
export interface AffiliateCreateInput {
  name?: string;
  email?: string;
  code?: string;
  tier?: AffiliateTier;
  commission_pct?: number;
  customer_id?: string;
  payout_method?: AffiliatePayoutMethod;
  payout_account_ref?: string;
}

/** Body POST /api/public/affiliates/signup (PUBLIC opt-in). */
export interface AffiliateSignupInput {
  name: string;
  email: string;
  /** Anti-bot honeypot — doit rester vide. */
  website?: string;
  /** Code souhaité — slugify HANDLER + collision check. */
  desired_code?: string;
}

/** Body POST /api/public/affiliates/track-click (script tracking). */
export interface AffiliateTrackClickInput {
  /** Code affilié (depuis URL `?aff=` ou cookie aff_attr). */
  code: string;
  /** Page source (document.referrer). */
  source_url?: string;
  /** Landing page courante (location.href). */
  landing_page?: string;
}

/** Filtres optionnels list referrals. */
export interface ReferralsListFilters {
  affiliate_id?: string;
  status?: AffiliateReferralStatus;
  order_id?: string;
}

/** Filtres optionnels list payouts. */
export interface PayoutsListFilters {
  affiliate_id?: string;
  status?: AffiliatePayoutStatus;
  period_end_after?: string;
}

/** Body POST /api/affiliate-payouts (admin) — créer batch mensuel. */
export interface PayoutBatchInput {
  /** ISO date début période (ex 2026-05-01). */
  period_start: string;
  /** ISO date fin période (ex 2026-05-31). */
  period_end: string;
}

// ── Helpers Sprint 49 — Affiliates CRUD (admin + public signup) ─────────────

/**
 * GET /api/affiliates — liste affiliés du tenant. Cap `clients.manage`. Réutilise
 * l'endpoint S92 ; le HANDLER retourne désormais les colonnes additives seq144
 * (tier, commission_pct, totals, payout).
 */
export async function listAffiliates(): Promise<ApiResponse<AffiliateExtended[]>> {
  return apiFetch<AffiliateExtended[]>('/affiliates');
}

/**
 * POST /api/affiliates — création admin d'un affilié. Cap `clients.manage`.
 * NB : helper Sprint 49 distinct de `createAffiliate` S92 (qui prenait juste
 * `Partial<Affiliate>`) — accepte les champs additifs tier/commission_pct/etc.
 */
export async function createAffiliateAdmin(
  body: AffiliateCreateInput,
): Promise<ApiResponse<{ id: string; code: string }>> {
  return apiFetch<{ id: string; code: string }>('/affiliates', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * POST /api/public/affiliates/signup — opt-in PUBLIC affilié (visitor join).
 * Rate-limit `aff_signup:<ip>` 3/3600s + honeypot `website`. PAS de cap
 * (pré-requireAuth). Le HANDLER résout le client_id via l'origine de l'appel
 * (referer ou storefront tracking — Phase B).
 */
export async function signupAffiliatePublic(
  body: AffiliateSignupInput,
): Promise<ApiResponse<{ id: string; code: string; status: 'active' | 'pending' }>> {
  return apiFetch<{ id: string; code: string; status: 'active' | 'pending' }>(
    '/public/affiliates/signup',
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/** GET /api/affiliates/:id — détail affilié (cap clients.manage). */
export async function getAffiliateById(
  id: string,
): Promise<ApiResponse<AffiliateExtended>> {
  return apiFetch<AffiliateExtended>(`/affiliates/${id}`);
}

/**
 * PATCH /api/affiliates/:id — update affilié (tier/commission/payout/status).
 * Sprint 49 utilise PATCH (vs PUT S92) — handler accepte les 2 méthodes pour
 * compat. Cap `clients.manage`.
 */
export async function updateAffiliateS49(
  id: string,
  body: Partial<AffiliateCreateInput> & { status?: 'active' | 'paused' | 'disabled' },
): Promise<ApiResponse<{ success: true }>> {
  return apiFetch<{ success: true }>(`/affiliates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** DELETE /api/affiliates/:id — alias S92 (re-déclaration omise). */

/**
 * GET /api/affiliates/:id/metrics — métriques agrégées d'un affilié.
 * Cap `clients.manage`.
 */
export async function getAffiliateMetrics(
  affiliateId: string,
): Promise<ApiResponse<AffiliateMetrics>> {
  return apiFetch<AffiliateMetrics>(`/affiliates/${affiliateId}/metrics`);
}

// ── Helpers Sprint 49 — Referrals (list / confirm / reverse) ───────────────

/**
 * GET /api/affiliate-referrals — liste referrals tenant. Filtres optionnels
 * `affiliate_id`, `status`, `order_id`. Cap `clients.manage`.
 */
export async function listReferrals(
  filters?: ReferralsListFilters,
): Promise<ApiResponse<AffiliateReferral[]>> {
  const params = new URLSearchParams();
  if (filters?.affiliate_id) params.set('affiliate_id', filters.affiliate_id);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.order_id) params.set('order_id', filters.order_id);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<AffiliateReferral[]>(`/affiliate-referrals${qs}`);
}

/**
 * POST /api/affiliate-referrals/:id/confirm — passe referral pending→confirmed.
 * Cap `clients.manage`. Idempotent côté handler (re-confirm = no-op).
 */
export async function confirmReferral(
  id: string,
): Promise<ApiResponse<AffiliateReferral>> {
  return apiFetch<AffiliateReferral>(`/affiliate-referrals/${id}/confirm`, {
    method: 'POST',
  });
}

/**
 * POST /api/affiliate-referrals/:id/reverse — annule referral (refund / fraude).
 * Cap `clients.manage`. Le handler ajuste `affiliates.total_commissions_cents`
 * en conséquence (Phase B).
 */
export async function reverseReferral(
  id: string,
  reason?: string,
): Promise<ApiResponse<AffiliateReferral>> {
  return apiFetch<AffiliateReferral>(`/affiliate-referrals/${id}/reverse`, {
    method: 'POST',
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

// ── Helpers Sprint 49 — Payouts (list / createBatch / markPaid) ────────────

/**
 * GET /api/affiliate-payouts — liste payouts tenant. Cap `settings.manage`
 * (action sensible — escalade vs clients.manage). Filtres optionnels.
 */
export async function listPayouts(
  filters?: PayoutsListFilters,
): Promise<ApiResponse<AffiliatePayout[]>> {
  const params = new URLSearchParams();
  if (filters?.affiliate_id) params.set('affiliate_id', filters.affiliate_id);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.period_end_after) params.set('period_end_after', filters.period_end_after);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<AffiliatePayout[]>(`/affiliate-payouts${qs}`);
}

/**
 * POST /api/affiliate-payouts — crée un batch de payouts pour la période.
 * Cap `settings.manage`. Phase B : sélectionne les referrals confirmed dans
 * la fenêtre [period_start, period_end] → groupe par affiliate_id → insère
 * N affiliate_payouts.
 */
export async function createPayoutBatch(
  body: PayoutBatchInput,
): Promise<ApiResponse<{ payouts_created: number; total_cents: number }>> {
  return apiFetch<{ payouts_created: number; total_cents: number }>(
    '/affiliate-payouts',
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/**
 * POST /api/affiliate-payouts/:id/mark-paid — admin marque payout paid (V1
 * payout MANUEL — pas de Stripe). Cap `settings.manage`.
 */
export async function markPayoutPaid(
  id: string,
  body?: { stripe_transfer_id?: string; notes?: string },
): Promise<ApiResponse<AffiliatePayout>> {
  return apiFetch<AffiliatePayout>(`/affiliate-payouts/${id}/mark-paid`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });
}

// ── Helper PUBLIC Sprint 49 — Track click (script tracking site marchand) ──

/**
 * POST /api/public/affiliates/track-click — log d'un clic sur un lien
 * d'affiliation. Rate-limit `aff_click:<ip>` 60/60s + honeypot. PAS de cap
 * (pré-requireAuth). Le handler hash l'IP + UA (SHA256) — PII Loi 25.
 */
export async function trackAffiliateClick(
  body: AffiliateTrackClickInput,
): Promise<ApiResponse<{ id: string; visitor_id: string }>> {
  return apiFetch<{ id: string; visitor_id: string }>(
    '/public/affiliates/track-click',
    { method: 'POST', body: JSON.stringify(body) },
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sprint 50 — SURVEYS AVANCÉS + DNS RECORDS UI (seq145, LOT 5 FIN)
//
// Module surveys avancés : questionnaires multi-pages avec branching logic
// conditionnel, NPS scores (-100..+100), CSAT, types variés. DISTINCT du
// module Forms (S5, seq106) single-step capture lead.
//
// Module white-label custom domains + DNS records via Cloudflare for SaaS
// (flag INACTIF V1 — câblé Phase B Manager-B).
//
// Cap admin (FIGÉE — AUCUN ajout ALL_CAPABILITIES seq80) :
//   - settings.manage (surveys CRUD + custom_domains + DNS records).
//   - PUBLIC : POST /api/public/surveys/:id/submit (rate-limit + honeypot).
//
// Voir docs/LOT-SURVEYS-DNS-S50.md §6 pour les choix figés Phase A.
// ──────────────────────────────────────────────────────────────────────────

// ── Types : Surveys ───────────────────────────────────────────────────────

/** Type de survey — détermine le rendu UI et l'agrégation. */
export type SurveyType = 'standard' | 'nps' | 'csat' | 'custom';

/** Type de question — détermine le widget de saisie et le typage answer. */
export type SurveyQuestionType =
  | 'text'
  | 'multiple_choice'
  | 'rating'
  | 'nps'
  | 'csat'
  | 'date';

/** Statut d'une session de réponse (visitor). */
export type SurveyResponseStatus = 'in_progress' | 'completed' | 'abandoned';

/** Survey (questionnaire — record top-level). */
export interface Survey {
  id: string;
  client_id: string;
  title: string;
  description?: string | null;
  type?: SurveyType | null;
  is_published?: number | null;
  published_at?: string | null;
  target_audience_json?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Question d'un survey (multi-pages + ordering intra-page). */
export interface SurveyQuestion {
  id: string;
  survey_id: string;
  question_text: string;
  type?: SurveyQuestionType | null;
  /** JSON serialized config — type-dependent. Ex multiple_choice ⇒ string[], rating/nps/csat ⇒ {min,max,scale}. */
  options_json?: string | null;
  required?: number | null;
  order_index?: number | null;
  page_number?: number | null;
  created_at?: string | null;
}

/** Branche conditionnelle d'une question (HANDLER resolveNextQuestion). */
export interface SurveyBranch {
  id: string;
  question_id: string;
  /** Si la réponse textuelle égale cette valeur ⇒ branche s'applique. */
  condition_value?: string | null;
  /** ID de la question suivante (null si jump_to_end=1). */
  next_question_id?: string | null;
  /** 1 ⇒ terminer le survey sur match. */
  jump_to_end?: number | null;
  created_at?: string | null;
}

/** Session de réponse d'un visitor (in_progress → completed | abandoned). */
export interface SurveyResponse {
  id: string;
  survey_id: string;
  client_id: string;
  respondent_email?: string | null;
  respondent_name?: string | null;
  /** SHA256 (PII Loi 25 — pas brut). */
  ip_hash?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  status?: SurveyResponseStatus | null;
  created_at?: string | null;
}

/** Réponse individuelle à une question (1 par (response, question)). */
export interface SurveyResponseAnswer {
  id: string;
  response_id: string;
  question_id: string;
  /** text/multiple_choice/date. */
  answer_text?: string | null;
  /** rating/nps/csat (typed numeric pour agrégats SQL rapides). */
  answer_value?: number | null;
  created_at?: string | null;
}

/** Agrégat NPS pré-calculé (rolling 30/60/90j). */
export interface NpsAggregate {
  id: string;
  client_id: string;
  survey_id: string;
  period_days?: number | null;
  promoters_count?: number | null;
  passives_count?: number | null;
  detractors_count?: number | null;
  total_responses?: number | null;
  /** Score NPS ∈ [-100..+100]. */
  nps_score?: number | null;
  calculated_at?: string | null;
  created_at?: string | null;
}

// ── Types : Custom domains + DNS records ─────────────────────────────────

/** Statut d'un custom domain. */
export type CustomDomainStatus = 'pending' | 'verified' | 'active' | 'failed';

/** Statut SSL Cloudflare for SaaS. */
export type CustomDomainSslStatus = 'pending' | 'provisioned' | 'failed';

/** Type d'un DNS record. */
export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV';

/** Custom domain (white-label par client, Cloudflare for SaaS). */
export interface CustomDomain {
  id: string;
  client_id: string;
  domain: string;
  status?: CustomDomainStatus | null;
  cloudflare_zone_id?: string | null;
  verification_token?: string | null;
  verified_at?: string | null;
  ssl_status?: CustomDomainSslStatus | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** DNS record d'un custom domain (push to Cloudflare via syncDnsRecords). */
export interface DnsRecord {
  id: string;
  domain_id: string;
  type?: DnsRecordType | null;
  name?: string | null;
  content?: string | null;
  ttl?: number | null;
  /** Requis pour MX/SRV. */
  priority?: number | null;
  /** Orange cloud Cloudflare (A/AAAA/CNAME). */
  proxied?: number | null;
  cloudflare_record_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

// ── Inputs / Filtres ──────────────────────────────────────────────────────

export interface SurveyCreateInput {
  title: string;
  description?: string;
  type?: SurveyType;
  target_audience_json?: string;
}

export interface SurveyUpdateInput {
  title?: string;
  description?: string;
  type?: SurveyType;
  target_audience_json?: string;
  is_published?: number;
}

export interface SurveyQuestionCreateInput {
  question_text: string;
  type: SurveyQuestionType;
  options_json?: string;
  required?: number;
  order_index?: number;
  page_number?: number;
}

export interface SurveyQuestionUpdateInput {
  question_text?: string;
  type?: SurveyQuestionType;
  options_json?: string;
  required?: number;
  order_index?: number;
  page_number?: number;
}

export interface SurveyBranchCreateInput {
  condition_value: string;
  next_question_id?: string | null;
  jump_to_end?: number;
}

export interface SurveyResponsesListFilters {
  status?: SurveyResponseStatus;
  after?: string;
  before?: string;
}

export interface SurveySubmitInput {
  /** Honeypot — DOIT être absent ou vide. */
  website?: string;
  respondent_email?: string;
  respondent_name?: string;
  /** Réponses partielles ou finales. */
  answers: Array<{ question_id: string; answer_text?: string; answer_value?: number }>;
  /** true ⇒ accumule + reste in_progress ; false ⇒ finalize (completed). */
  partial?: boolean;
}

export interface CustomDomainCreateInput {
  domain: string;
  client_id?: string;
}

export interface DnsRecordCreateInput {
  type: DnsRecordType;
  name: string;
  content: string;
  ttl?: number;
  priority?: number;
  proxied?: number;
}

export interface DnsRecordUpdateInput {
  content?: string;
  ttl?: number;
  priority?: number;
  proxied?: number;
}

// ── Helpers Sprint 50 — Surveys CRUD (admin) ──────────────────────────────

/**
 * GET /api/surveys — liste les surveys du tenant. Cap `settings.manage`
 * (handler). Filtres optionnels : `published`, `type`.
 */
export async function listSurveys(
  filters?: { published?: number; type?: SurveyType },
): Promise<ApiResponse<Survey[]>> {
  const params = new URLSearchParams();
  if (filters?.published != null) params.set('published', String(filters.published));
  if (filters?.type) params.set('type', filters.type);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<Survey[]>(`/surveys${qs}`);
}

/**
 * POST /api/surveys — crée un survey vide. Cap `settings.manage`. type
 * validé HANDLER ∈ SURVEY_TYPES (survey-engine.ts).
 */
export async function createSurvey(
  body: SurveyCreateInput,
): Promise<ApiResponse<Survey>> {
  return apiFetch<Survey>('/surveys', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * GET /api/surveys/:id — détail d'un survey (sans questions, à demander
 * via listSurveyQuestions). Borné tenant.
 */
export async function getSurvey(id: string): Promise<ApiResponse<Survey>> {
  return apiFetch<Survey>(`/surveys/${id}`);
}

/**
 * PUT /api/surveys/:id — update title/description/type/audience/publish.
 * Le flip is_published 0→1 pose `published_at` HANDLER.
 */
export async function updateSurvey(
  id: string,
  body: SurveyUpdateInput,
): Promise<ApiResponse<Survey>> {
  return apiFetch<Survey>(`/surveys/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/**
 * DELETE /api/surveys/:id — supprime survey + questions + responses
 * (cascade applicative). Cap `settings.manage`.
 */
export async function deleteSurvey(
  id: string,
): Promise<ApiResponse<{ deleted: boolean }>> {
  return apiFetch<{ deleted: boolean }>(`/surveys/${id}`, { method: 'DELETE' });
}

/**
 * POST /api/surveys/:id/publish — flip is_published 0→1 + posent
 * `published_at`. Idempotent (déjà publié ⇒ 200 sans changement).
 */
export async function publishSurvey(
  id: string,
): Promise<ApiResponse<Survey>> {
  return apiFetch<Survey>(`/surveys/${id}/publish`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// ── Helpers Sprint 50 — Questions CRUD ────────────────────────────────────

/**
 * GET /api/surveys/:id/questions — liste les questions d'un survey
 * ordonnées par (page_number ASC, order_index ASC). Cap `settings.manage`.
 */
export async function listSurveyQuestions(
  surveyId: string,
): Promise<ApiResponse<SurveyQuestion[]>> {
  return apiFetch<SurveyQuestion[]>(`/surveys/${surveyId}/questions`);
}

/**
 * POST /api/surveys/:id/questions — ajoute une question. type validé
 * HANDLER ∈ QUESTION_TYPES (survey-engine.ts). options_json validé HANDLER
 * selon type (multiple_choice ⇒ array ; rating/nps/csat ⇒ {min,max,scale}).
 */
export async function createSurveyQuestion(
  surveyId: string,
  body: SurveyQuestionCreateInput,
): Promise<ApiResponse<SurveyQuestion>> {
  return apiFetch<SurveyQuestion>(`/surveys/${surveyId}/questions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * PUT /api/survey-questions/:id — update une question. Borné tenant via
 * JOIN surveys.client_id (HANDLER Phase B).
 */
export async function updateSurveyQuestion(
  id: string,
  body: SurveyQuestionUpdateInput,
): Promise<ApiResponse<SurveyQuestion>> {
  return apiFetch<SurveyQuestion>(`/survey-questions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/**
 * DELETE /api/survey-questions/:id — supprime question + branches +
 * answers (cascade applicative). Borné tenant.
 */
export async function deleteSurveyQuestion(
  id: string,
): Promise<ApiResponse<{ deleted: boolean }>> {
  return apiFetch<{ deleted: boolean }>(`/survey-questions/${id}`, {
    method: 'DELETE',
  });
}

// ── Helpers Sprint 50 — Branches (logic conditionnelle) ───────────────────

/**
 * GET /api/survey-questions/:id/branches — liste les branches d'une
 * question (HANDLER resolveNextQuestion consomme).
 */
export async function listBranches(
  questionId: string,
): Promise<ApiResponse<SurveyBranch[]>> {
  return apiFetch<SurveyBranch[]>(`/survey-questions/${questionId}/branches`);
}

/**
 * POST /api/survey-questions/:id/branches — ajoute une branche : si la
 * réponse égale condition_value, aller à next_question_id (ou jump_to_end).
 */
export async function createBranch(
  questionId: string,
  body: SurveyBranchCreateInput,
): Promise<ApiResponse<SurveyBranch>> {
  return apiFetch<SurveyBranch>(`/survey-questions/${questionId}/branches`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * DELETE /api/survey-branches/:id — supprime une branche. Borné tenant
 * via JOIN survey_questions → surveys.client_id.
 */
export async function deleteBranch(
  id: string,
): Promise<ApiResponse<{ deleted: boolean }>> {
  return apiFetch<{ deleted: boolean }>(`/survey-branches/${id}`, {
    method: 'DELETE',
  });
}

// ── Helpers Sprint 50 — Responses + NPS analytics ─────────────────────────

/**
 * GET /api/surveys/:id/responses — liste les réponses d'un survey.
 * Filtres : `status`, `after` (ISO), `before` (ISO).
 */
export async function listResponses(
  surveyId: string,
  filters?: SurveyResponsesListFilters,
): Promise<ApiResponse<SurveyResponse[]>> {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.after) params.set('after', filters.after);
  if (filters?.before) params.set('before', filters.before);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<SurveyResponse[]>(`/surveys/${surveyId}/responses${qs}`);
}

/**
 * GET /api/survey-responses/:id — détail d'une session de réponse +
 * answers joined.
 */
export async function getSurveyResponse(
  id: string,
): Promise<ApiResponse<SurveyResponse & { answers: SurveyResponseAnswer[] }>> {
  return apiFetch<SurveyResponse & { answers: SurveyResponseAnswer[] }>(
    `/survey-responses/${id}`,
  );
}

/**
 * POST /api/public/surveys/:id/submit — PUBLIC (pré-requireAuth). Visitor
 * répond au questionnaire. Rate-limit `survey_submit:<ip>` 10/3600s +
 * honeypot champ `website` HANDLER + PII Loi 25 (ip_hash SHA256, pas brut).
 * `partial=true` ⇒ accumule answers + reste in_progress ; `partial=false`
 * ⇒ finalize (status='completed', completed_at=now, déclenche éventuelle
 * agrégation NPS Phase B).
 */
export async function submitSurveyResponse(
  surveyId: string,
  body: SurveySubmitInput,
): Promise<ApiResponse<{ id: string; status: SurveyResponseStatus }>> {
  return apiFetch<{ id: string; status: SurveyResponseStatus }>(
    `/public/surveys/${surveyId}/submit`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/**
 * GET /api/surveys/:id/nps?period_days=30|60|90 — lit le dernier agrégat
 * NPS d'un survey pour la période donnée. Si aucun agrégat ⇒ déclenche un
 * calcul on-demand via aggregateNpsForPeriod (Phase B).
 */
export async function getNpsAggregate(
  surveyId: string,
  periodDays: 30 | 60 | 90,
): Promise<ApiResponse<NpsAggregate | null>> {
  return apiFetch<NpsAggregate | null>(
    `/surveys/${surveyId}/nps?period_days=${periodDays}`,
  );
}

// ── Helpers Sprint 50 — Custom domains + DNS records ──────────────────────

/**
 * GET /api/custom-domains — liste les custom domains du tenant. Cap
 * `settings.manage` (handler). Filtres : `status`.
 *
 * NB : DISTINCT de l'endpoint legacy /api/clients/:id/custom-domains
 * (S94 sub-accounts.ts) qui gère le whitelabel basique. Sprint 50 = full
 * DNS dédié.
 */
export async function listCustomDomains(
  filters?: { status?: CustomDomainStatus },
): Promise<ApiResponse<CustomDomain[]>> {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<CustomDomain[]>(`/custom-domains${qs}`);
}

/**
 * POST /api/custom-domains — ajoute un domaine. UNIQUE INDEX
 * uniq_custom_domains_domain ⇒ HANDLER retourne 409 si le domain existe
 * déjà. Provisioning Cloudflare for SaaS INACTIF V1 (zone_id null —
 * client configure DNS manuellement Phase B).
 *
 * NB : nommé `addCustomDomainS50` pour ne pas collisionner avec l'helper
 * legacy `addCustomDomain(clientId, hostname)` (api.ts:2786 — module
 * sub-accounts S94 whitelabel basique, consommé par
 * components/settings/BrandingSettings.tsx). Les deux endpoints coexistent.
 */
export async function addCustomDomainS50(
  body: CustomDomainCreateInput,
): Promise<ApiResponse<CustomDomain>> {
  return apiFetch<CustomDomain>('/custom-domains', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * POST /api/custom-domains/:id/verify — déclenche le lookup DNS TXT
 * `_intralys-verify.<domain>` (HANDLER verifyDomainOwnership). Si match ⇒
 * UPDATE status='verified', verified_at=now.
 */
export async function verifyDomain(
  id: string,
): Promise<ApiResponse<CustomDomain>> {
  return apiFetch<CustomDomain>(`/custom-domains/${id}/verify`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/**
 * DELETE /api/custom-domains/:id — supprime domaine + dns_records
 * (cascade applicative). Si zone_id présent ⇒ Phase B DELETE /zones/:id
 * (flag INACTIF V1 ⇒ no-op).
 */
export async function deleteDomain(
  id: string,
): Promise<ApiResponse<{ deleted: boolean }>> {
  return apiFetch<{ deleted: boolean }>(`/custom-domains/${id}`, {
    method: 'DELETE',
  });
}

/**
 * GET /api/custom-domains/:id/dns-records — liste les DNS records d'un
 * custom domain.
 */
export async function listDnsRecords(
  domainId: string,
): Promise<ApiResponse<DnsRecord[]>> {
  return apiFetch<DnsRecord[]>(`/custom-domains/${domainId}/dns-records`);
}

/**
 * POST /api/custom-domains/:id/dns-records — crée un DNS record. type
 * validé HANDLER ∈ DNS_RECORD_TYPES. MX/SRV ⇒ priority requis.
 */
export async function createDnsRecord(
  domainId: string,
  body: DnsRecordCreateInput,
): Promise<ApiResponse<DnsRecord>> {
  return apiFetch<DnsRecord>(`/custom-domains/${domainId}/dns-records`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * PUT /api/dns-records/:id — update un DNS record (content/ttl/priority/
 * proxied). Sync Cloudflare INACTIF V1 (cloudflare_record_id reste cohérent).
 */
export async function updateDnsRecord(
  id: string,
  body: DnsRecordUpdateInput,
): Promise<ApiResponse<DnsRecord>> {
  return apiFetch<DnsRecord>(`/dns-records/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/**
 * DELETE /api/dns-records/:id — supprime un DNS record. Borné tenant via
 * JOIN custom_domains.client_id.
 */
export async function deleteDnsRecord(
  id: string,
): Promise<ApiResponse<{ deleted: boolean }>> {
  return apiFetch<{ deleted: boolean }>(`/dns-records/${id}`, {
    method: 'DELETE',
  });
}

// ── Sprint 54 — Power Dialer (Moteur d'Appels en Rafale) ───────────────────

export interface DialerCampaign {
  id: string;
  client_id: string;
  name: string;
  lead_ids: string[];
  status: 'draft' | 'active' | 'paused' | 'completed';
  current_index: number;
  script_markdown: string;
  created_at?: string;
  updated_at?: string;
}

export interface DialerCurrentLeadResponse {
  campaign_completed: boolean;
  current_index: number;
  total_leads: number;
  lead?: {
    id: string;
    client_id: string;
    name: string;
    email: string;
    phone?: string;
    [key: string]: any;
  };
  script?: string;
}

/**
 * GET /api/dialer/campaigns — Récupère toutes les campagnes du client.
 */
export async function getDialerCampaigns(): Promise<ApiResponse<DialerCampaign[]>> {
  return apiFetch<DialerCampaign[]>('/dialer/campaigns');
}

/**
 * POST /api/dialer/campaigns — Crée une nouvelle campagne.
 */
export async function createDialerCampaign(body: {
  name: string;
  lead_ids: string[];
  script_markdown?: string;
}): Promise<ApiResponse<DialerCampaign>> {
  return apiFetch<DialerCampaign>('/dialer/campaigns', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * GET /api/dialer/campaigns/:id — Récupère une campagne par son ID.
 */
export async function getDialerCampaign(id: string): Promise<ApiResponse<DialerCampaign>> {
  return apiFetch<DialerCampaign>(`/dialer/campaigns/${encodeURIComponent(id)}`);
}

/**
 * PATCH /api/dialer/campaigns/:id — Met à jour les informations d'une campagne.
 */
export async function updateDialerCampaign(
  id: string,
  body: {
    name?: string;
    status?: 'draft' | 'active' | 'paused' | 'completed';
    current_index?: number;
    script_markdown?: string;
  }
): Promise<ApiResponse<DialerCampaign>> {
  return apiFetch<DialerCampaign>(`/dialer/campaigns/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * DELETE /api/dialer/campaigns/:id — Supprime une campagne.
 */
export async function deleteDialerCampaign(id: string): Promise<ApiResponse<{ success: boolean; message?: string }>> {
  return apiFetch<{ success: boolean; message?: string }>(`/dialer/campaigns/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/**
 * GET /api/dialer/campaigns/:id/lead?direction=... — Récupère le prospect courant et gère la progression.
 */
export async function getDialerCurrentLead(
  id: string,
  direction: 'current' | 'next' | 'prev' = 'current'
): Promise<ApiResponse<DialerCurrentLeadResponse>> {
  return apiFetch<DialerCurrentLeadResponse>(
    `/dialer/campaigns/${encodeURIComponent(id)}/lead?direction=${direction}`
  );
}


