// ── Client API — Helpers pour appeler le worker ─────────────

import type { ApiResponse, Client, Lead, LeadDetail, DashboardStats, ActivityLogEntry, Message, EmailTemplate, Workflow, WorkflowStep, WorkflowEnrollment, Appointment, Task, Subtask, TaskComment, TaskTemplate, LeadNote, LeadScore, CustomFieldValue, Conversation, ConversationStatus, Pipeline, PipelineStage, CustomFieldDef, SmartList, Snippet, Product, Order, Customer, ProductVariant, ProductCategory, ProductImage, InventoryRecord, PaymentInitResult, PaymentMethod, PaymentStatus, Shipment, ShipmentStatus, ShippingZone, ShippingRate, ShippingRateResult, ConsumerPolicy, ReturnRequest, Customer360, AbandonedCart, EcommerceRevenue, EcommerceCohorts, EcommerceLtv, EcommerceTopProducts, ProductRecoResult, CustomerChurnPrediction } from './types';
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
    'quantity' | 'low_stock_threshold' | 'track_inventory' | 'allow_backorder' | 'location'>>,
): Promise<ApiResponse<InventoryRecord>> {
  return apiFetch<InventoryRecord>(
    `/ecommerce/variants/${variantId}/inventory`,
    { method: 'PUT', body: JSON.stringify(body) },
  );
}

export async function getLowStock(): Promise<PagedResponse<LowStockRow>> {
  return apiFetch<LowStockRow[]>('/ecommerce/inventory/low-stock');
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
  const result = await apiFetch<Lead[]>(`/leads${qs ? `?${qs}` : ''}`);
  // Fallback mock data en dev quand le worker n'est pas joignable
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
  limit?: number;
  offset?: number;
}): Promise<PaginatedLeadsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.type) searchParams.set('type', params.type);
  if (params?.search) searchParams.set('search', params.search);
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
