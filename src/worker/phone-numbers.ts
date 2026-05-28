import type { Env } from './types';
import { json, sanitizeInput, audit } from './helpers';

// Helper pour formater les numéros de téléphone au format canadien
function formatFriendlyPhoneNumber(phoneNumber: string): string {
  const cleaned = phoneNumber.replace(/\D/g, '');
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    const area = cleaned.slice(1, 4);
    const prefix = cleaned.slice(4, 7);
    const line = cleaned.slice(7);
    return `(${area}) ${prefix}-${line}`;
  }
  return phoneNumber;
}

// ── GET /api/phone-numbers ──────────────────────────────────
export async function handleGetPhoneNumbers(_request: Request, env: Env, auth: { role: string; clientId?: string }): Promise<Response> {
  if (!auth.clientId) {
    return json({ error: 'Client ID requis' }, 400);
  }

  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM phone_numbers WHERE client_id = ? AND status = "active" ORDER BY created_at DESC'
    ).bind(auth.clientId).all();
    return json({ data: results || [] });
  } catch (err: any) {
    return json({ error: `Erreur D1 : ${err.message}` }, 500);
  }
}

// ── GET /api/phone-numbers/search ───────────────────────────
export async function handleSearchPhoneNumbers(request: Request, env: Env, auth: { role: string; clientId?: string }): Promise<Response> {
  if (!auth.clientId) {
    return json({ error: 'Client ID requis' }, 400);
  }

  const url = new URL(request.url);
  const areaCode = sanitizeInput(url.searchParams.get('areaCode') || '450', 3);

  // Vérifier si Twilio est configuré
  const twilioConfigured = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN;

  if (!twilioConfigured) {
    // Mode Simulation (Mock/Bypass)
    const simulatedNumbers = Array.from({ length: 5 }).map((_, i) => {
      const lineNum = String(100 + i + Math.floor(Math.random() * 800));
      const rawNumber = `+1${areaCode}5550${lineNum}`;
      return {
        phone_number: rawNumber,
        friendly_name: formatFriendlyPhoneNumber(rawNumber),
        rate_center: 'Montréal',
        region: 'QC',
        iso_country: 'CA'
      };
    });
    return json({ data: simulatedNumbers });
  }

  // Requête réelle vers Twilio
  try {
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/AvailablePhoneNumbers/CA/Local.json?AreaCode=${areaCode}`;
    const authStr = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
    
    const res = await fetch(twilioUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${authStr}`,
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      const errData = await res.json() as any;
      throw new Error(errData.message || `Twilio HTTP ${res.status}`);
    }

    const data = await res.json() as { available_phone_numbers?: any[] };
    const numbers = (data.available_phone_numbers || []).map((num: any) => ({
      phone_number: num.phone_number,
      friendly_name: num.friendly_name,
      rate_center: num.rate_center || 'Montréal',
      region: num.region || 'QC',
      iso_country: 'CA'
    }));

    return json({ data: numbers });
  } catch (err: any) {
    return json({ error: `Erreur de recherche Twilio : ${err.message}` }, 500);
  }
}

// ── POST /api/phone-numbers/purchase ────────────────────────
export async function handlePurchasePhoneNumber(request: Request, env: Env, auth: { role: string; clientId?: string; userId: string }): Promise<Response> {
  if (!auth.clientId) {
    return json({ error: 'Client ID requis' }, 400);
  }

  let body: { phone_number?: string; friendly_name?: string };
  try {
    body = await request.json() as any;
  } catch {
    return json({ error: 'JSON invalide' }, 400);
  }

  const rawPhoneNumber = sanitizeInput(body.phone_number || '', 15);
  const friendlyName = sanitizeInput(body.friendly_name || formatFriendlyPhoneNumber(rawPhoneNumber), 50);

  if (!rawPhoneNumber) {
    return json({ error: 'Numéro de téléphone requis' }, 400);
  }

  const twilioConfigured = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN;
  let twilioSid = `PN_mock_${crypto.randomUUID().replace(/-/g, '')}`;

  if (twilioConfigured) {
    try {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json`;
      const authStr = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
      const params = new URLSearchParams({
        PhoneNumber: rawPhoneNumber
      });

      const res = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authStr}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: params.toString()
      });

      if (!res.ok) {
        const errData = await res.json() as any;
        throw new Error(errData.message || `Twilio HTTP ${res.status}`);
      }

      const twilioNum = await res.json() as { sid: string };
      twilioSid = twilioNum.sid;
    } catch (err: any) {
      return json({ error: `Erreur d'achat Twilio : ${err.message}` }, 500);
    }
  }

  try {
    const numberId = crypto.randomUUID();
    
    // Insérer le numéro virtuellement provisionné
    await env.DB.prepare(
      'INSERT INTO phone_numbers (id, client_id, phone_number, friendly_name, twilio_sid, status) VALUES (?, ?, ?, ?, ?, "active")'
    ).bind(numberId, auth.clientId, rawPhoneNumber, friendlyName, twilioSid).run();

    // Insérer une règle de redirection par défaut (renvoi externe)
    const ruleId = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO phone_routing_rules (id, phone_number_id, priority, condition_type, condition_value, target_type, target_id) VALUES (?, ?, 1, "all", "", "forward", "+15145550100")'
    ).bind(ruleId, numberId).run();

    // Audit Loi 25 (sans secrets dans les détails de l'audit)
    await audit(env, auth.userId, 'phone_number.purchase', 'phone_number', numberId, {
      phone_number: rawPhoneNumber,
      friendly_name: friendlyName,
      client_id: auth.clientId
    });

    return json({
      data: {
        id: numberId,
        phone_number: rawPhoneNumber,
        friendly_name: friendlyName,
        status: 'active'
      }
    }, 201);
  } catch (err: any) {
    return json({ error: `Erreur d'enregistrement DB : ${err.message}` }, 500);
  }
}

// ── DELETE /api/phone-numbers/:id ───────────────────────────
export async function handleReleasePhoneNumber(_request: Request, env: Env, auth: { role: string; clientId?: string; userId: string }, id: string): Promise<Response> {
  if (!auth.clientId) {
    return json({ error: 'Client ID requis' }, 400);
  }

  try {
    // Vérifier l'appartenance du numéro
    const number = await env.DB.prepare(
      'SELECT id, phone_number, twilio_sid FROM phone_numbers WHERE id = ? AND client_id = ?'
    ).bind(id, auth.clientId).first() as { id: string; phone_number: string; twilio_sid: string } | null;

    if (!number) {
      return json({ error: 'Numéro introuvable ou non autorisé' }, 404);
    }

    const twilioConfigured = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN;

    if (twilioConfigured && number.twilio_sid && !number.twilio_sid.startsWith('PN_mock_')) {
      try {
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers/${number.twilio_sid}.json`;
        const authStr = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
        
        const res = await fetch(twilioUrl, {
          method: 'DELETE',
          headers: {
            'Authorization': `Basic ${authStr}`
          }
        });

        if (!res.ok && res.status !== 404) {
          const errData = await res.json() as any;
          throw new Error(errData.message || `Twilio HTTP ${res.status}`);
        }
      } catch (err: any) {
        return json({ error: `Erreur de libération Twilio : ${err.message}` }, 500);
      }
    }

    // Supprimer de la base de données (la cascade SQL supprimera les règles de routage associées)
    await env.DB.prepare('DELETE FROM phone_numbers WHERE id = ?').bind(id).run();

    // Audit Loi 25
    await audit(env, auth.userId, 'phone_number.release', 'phone_number', id, {
      phone_number: number.phone_number,
      client_id: auth.clientId
    });

    return json({ data: { success: true } });
  } catch (err: any) {
    return json({ error: `Erreur D1 : ${err.message}` }, 500);
  }
}

// ── GET /api/phone-numbers/:id/routing ──────────────────────
export async function handleGetRoutingRules(_request: Request, env: Env, auth: { role: string; clientId?: string }, id: string): Promise<Response> {
  if (!auth.clientId) {
    return json({ error: 'Client ID requis' }, 400);
  }

  try {
    // Vérifier l'appartenance du numéro
    const number = await env.DB.prepare(
      'SELECT id FROM phone_numbers WHERE id = ? AND client_id = ?'
    ).bind(id, auth.clientId).first() as { id: string } | null;

    if (!number) {
      return json({ error: 'Numéro introuvable ou non autorisé' }, 404);
    }

    const { results } = await env.DB.prepare(
      'SELECT * FROM phone_routing_rules WHERE phone_number_id = ? ORDER BY priority ASC'
    ).bind(id).all();

    return json({ data: results || [] });
  } catch (err: any) {
    return json({ error: `Erreur D1 : ${err.message}` }, 500);
  }
}

// ── POST /api/phone-numbers/:id/routing ─────────────────────
export async function handleSaveRoutingRules(request: Request, env: Env, auth: { role: string; clientId?: string; userId: string }, id: string): Promise<Response> {
  if (!auth.clientId) {
    return json({ error: 'Client ID requis' }, 400);
  }

  let body: { rules?: Array<{ priority?: number; condition_type?: string; condition_value?: string; target_type?: string; target_id?: string }> };
  try {
    body = await request.json() as any;
  } catch {
    return json({ error: 'JSON invalide' }, 400);
  }

  const newRules = body.rules || [];

  try {
    // Vérifier l'appartenance du numéro
    const number = await env.DB.prepare(
      'SELECT id, phone_number FROM phone_numbers WHERE id = ? AND client_id = ?'
    ).bind(id, auth.clientId).first() as { id: string; phone_number: string } | null;

    if (!number) {
      return json({ error: 'Numéro introuvable ou non autorisé' }, 404);
    }

    // Supprimer toutes les règles existantes pour ce numéro
    await env.DB.prepare('DELETE FROM phone_routing_rules WHERE phone_number_id = ?').bind(id).run();

    // Insérer les nouvelles règles
    for (let i = 0; i < newRules.length; i++) {
      const r = newRules[i]!;
      const ruleId = crypto.randomUUID();
      const priority = Number(r.priority || i + 1);
      const conditionType = sanitizeInput(r.condition_type || 'all', 20);
      const conditionValue = sanitizeInput(r.condition_value || '', 100);
      const targetType = sanitizeInput(r.target_type || 'forward', 20);
      const targetId = sanitizeInput(r.target_id || '', 100);

      // Validation de base des enums pour éviter les injections de valeurs non whitelistées
      if (!['all', 'area_code'].includes(conditionType)) continue;
      if (!['user', 'ivr', 'forward'].includes(targetType)) continue;

      await env.DB.prepare(
        `INSERT INTO phone_routing_rules (id, phone_number_id, priority, condition_type, condition_value, target_type, target_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(ruleId, id, priority, conditionType, conditionValue, targetType, targetId).run();
    }

    // Audit Loi 25
    await audit(env, auth.userId, 'phone_routing.update_rules', 'phone_number', id, {
      phone_number: number.phone_number,
      client_id: auth.clientId,
      rules_count: newRules.length
    });

    return json({ data: { success: true } });
  } catch (err: any) {
    return json({ error: `Erreur d'enregistrement DB : ${err.message}` }, 500);
  }
}
