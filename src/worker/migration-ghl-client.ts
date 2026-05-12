import type { GhlApiResponse, GhlContact, GhlConversation, GhlMessage, GhlOpportunity, GhlCalendar, GhlCalendarEvent, GhlCustomField } from './migration-ghl-types';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const TIMEOUT_MS = 30000;

export class GhlClient {
  constructor(private accessToken: string) {}

  private async fetchWithRetry<T>(
    path: string,
    params?: Record<string, string>
  ): Promise<GhlApiResponse<T>> {
    const url = new URL(`${GHL_API_BASE}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v) url.searchParams.set(k, v);
      });
    }

    const backoffs = [1000, 5000, 30000];
    let attempt = 0;

    while (true) {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const resp = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Version': '2021-07-28',
            'Accept': 'application/json',
          },
          signal: controller.signal,
        });

        clearTimeout(id);

        const remaining = parseInt(resp.headers.get('x-ratelimit-remaining') || '100', 10);
        if (remaining < 10) {
          // Throttle préventif si on s'approche de la limite (max 100/10s en général)
          await new Promise(r => setTimeout(r, 2000));
        }

        if (resp.status === 429 || resp.status === 503) {
          if (attempt < backoffs.length) {
            console.warn(`GHL API ${resp.status} sur ${path}, retry dans ${backoffs[attempt]}ms`);
            await new Promise(r => setTimeout(r, backoffs[attempt]));
            attempt++;
            continue;
          }
          throw new Error(`GHL API error ${resp.status} après ${attempt} retries: ${await resp.text()}`);
        }

        if (!resp.ok) {
          throw new Error(`GHL API error ${resp.status}: ${await resp.text()}`);
        }

        return (await resp.json()) as GhlApiResponse<T>;
      } catch (err: any) {
        clearTimeout(id);
        if (err.name === 'AbortError') {
          if (attempt < backoffs.length) {
            console.warn(`GHL API timeout sur ${path}, retry dans ${backoffs[attempt]}ms`);
            await new Promise(r => setTimeout(r, backoffs[attempt]));
            attempt++;
            continue;
          }
          throw new Error(`GHL API timeout après ${attempt} retries sur ${path}`);
        }
        throw err;
      }
    }
  }

  async getContacts(locationId: string, cursor?: string): Promise<{ contacts: GhlContact[]; meta?: any }> {
    const params: Record<string, string> = { locationId, limit: '100' };
    if (cursor) params.startAfter = cursor;
    
    // GHL retourne { contacts: [], meta: {} }
    const resp = await this.fetchWithRetry<{ contacts: GhlContact[] }>('/contacts/', params);
    // Cas spécial: parfois les données sont dans resp.data.contacts, parfois directement dans resp.contacts selon la version
    const contacts = (resp.data as any)?.contacts || (resp as any).contacts || [];
    return { contacts, meta: resp.meta || (resp as any).meta };
  }

  async getConversations(locationId: string, cursor?: string): Promise<{ conversations: GhlConversation[] }> {
    // Note: getConversations n'est pas standardisé de la même façon (limit/cursor peut varier)
    // L'API officielle de search conversations :
    // GET /conversations/search?locationId={locationId}
    const params: Record<string, string> = { locationId, limit: '100' };
    if (cursor) params.startAfter = cursor;

    const resp = await this.fetchWithRetry<{ conversations: GhlConversation[] }>('/conversations/search', params);
    const conversations = (resp.data as any)?.conversations || (resp as any).conversations || [];
    return { conversations };
  }

  async getMessages(conversationId: string, cursor?: string): Promise<{ messages: GhlMessage[]; meta?: any }> {
    // GET /conversations/{conversationId}/messages
    const params: Record<string, string> = { limit: '100' };
    if (cursor) params.startAfter = cursor;

    const resp = await this.fetchWithRetry<{ messages: GhlMessage[] }>(`/conversations/${conversationId}/messages`, params);
    const messages = (resp.data as any)?.messages || (resp as any).messages || [];
    return { messages, meta: resp.meta || (resp as any).meta };
  }

  async getOpportunities(locationId: string, cursor?: string): Promise<{ opportunities: GhlOpportunity[]; meta?: any }> {
    // GET /opportunities/search?location_id={locationId}
    const params: Record<string, string> = { location_id: locationId, limit: '100' };
    if (cursor) params.startAfter = cursor;

    const resp = await this.fetchWithRetry<{ opportunities: GhlOpportunity[] }>('/opportunities/search', params);
    const opportunities = (resp.data as any)?.opportunities || (resp as any).opportunities || [];
    return { opportunities, meta: resp.meta || (resp as any).meta };
  }

  async getCalendars(locationId: string): Promise<{ calendars: GhlCalendar[] }> {
    // GET /calendars/?locationId={locationId}
    const params: Record<string, string> = { locationId };
    const resp = await this.fetchWithRetry<{ calendars: GhlCalendar[] }>('/calendars/', params);
    const calendars = (resp.data as any)?.calendars || (resp as any).calendars || [];
    return { calendars };
  }

  async getAppointments(locationId: string, startTime: string, endTime: string): Promise<{ events: GhlCalendarEvent[] }> {
    // GET /calendars/events?locationId={locationId}&startTime={startTime}&endTime={endTime}
    const params: Record<string, string> = { locationId, startTime, endTime };
    const resp = await this.fetchWithRetry<{ events: GhlCalendarEvent[] }>('/calendars/events', params);
    const events = (resp.data as any)?.events || (resp as any).events || [];
    return { events };
  }

  async getCustomFields(locationId: string): Promise<{ customFields: GhlCustomField[] }> {
    // GET /locations/{locationId}/customFields
    const resp = await this.fetchWithRetry<{ customFields: GhlCustomField[] }>(`/locations/${locationId}/customFields`);
    const customFields = (resp.data as any)?.customFields || (resp as any).customFields || [];
    return { customFields };
  }
}
