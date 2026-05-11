import type { Env } from './types';
import { json } from './helpers';

// Hash function for Facebook CAPI (SHA-256)
async function hashData(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function handleTrackConversion(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as {
    lead_id: string;
    event_name: string; // e.g., 'Lead', 'Purchase'
    client_id: string;
    source: string; // 'facebook', 'google'
    value?: number;
    currency?: string;
  };

  const { lead_id, event_name, client_id, source, value = 0, currency = 'CAD' } = body;

  if (!lead_id || !event_name || !client_id) {
    return json({ error: 'Missing required parameters' }, 400);
  }

  // Get lead details
  const lead = await env.DB.prepare('SELECT email, phone, name, utm_source, utm_medium, utm_campaign FROM leads WHERE id = ?')
    .bind(lead_id).first() as { email?: string; phone?: string; name?: string; utm_source?: string } | null;

  if (!lead) {
    return json({ error: 'Lead not found' }, 404);
  }

  // Find integration configuration for the client
  // For simplicity, we assume integrations are stored in `clients` or a new table. We'll use a mocked lookup.
  const integrations = await env.DB.prepare('SELECT meta_pixel_id, meta_access_token, google_ads_id FROM clients WHERE id = ?')
    .bind(client_id).first() as { meta_pixel_id?: string; meta_access_token?: string; google_ads_id?: string } | null;

  const results: { success: boolean; events_sent: any[] } = { success: true, events_sent: [] };

  if ((source === 'facebook' || lead.utm_source === 'facebook' || lead.utm_source === 'fb') && integrations?.meta_pixel_id && integrations?.meta_access_token) {
    // Send to Facebook CAPI
    const emailHash = lead.email ? await hashData(lead.email) : undefined;
    const phoneHash = lead.phone ? await hashData(lead.phone) : undefined;
    
    // Facebook API payload
    const fbPayload = {
      data: [
        {
          event_name: event_name,
          event_time: Math.floor(Date.now() / 1000),
          action_source: "system_generated",
          user_data: {
            em: emailHash ? [emailHash] : undefined,
            ph: phoneHash ? [phoneHash] : undefined,
            // You can add fn, ln (hashed) if we split lead.name
          },
          custom_data: {
            currency: currency,
            value: value
          }
        }
      ]
    };

    try {
      const res = await fetch(`https://graph.facebook.com/v18.0/${integrations.meta_pixel_id}/events?access_token=${integrations.meta_access_token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fbPayload)
      });
      const data = await res.json();
      results.events_sent.push({ platform: 'facebook', response: data });
    } catch (err) {
      console.error('Meta CAPI error:', err);
      results.events_sent.push({ platform: 'facebook', error: String(err) });
    }
  }

  // Google Ads (stub - requires specific developer token and Google Ads setup)
  if ((source === 'google' || lead.utm_source === 'google') && integrations?.google_ads_id) {
    results.events_sent.push({ platform: 'google_ads', status: 'pending_implementation' });
  }

  return json(results);
}
