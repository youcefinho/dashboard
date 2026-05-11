// ── Module Migration GHL — Intralys CRM ─────────────────────
// Migration idempotente depuis GoHighLevel via Private Integration Token
import type { Env } from './types';
import { sanitizeInput, json, audit } from './helpers';

// ── Types ───────────────────────────────────────────────────

interface GhlContact {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  source?: string;
  dateOfBirth?: string;
  country?: string;
  timezone?: string;
  dnd?: boolean;
  dndSettings?: { sms?: { status: string }; email?: { status: string }; call?: { status: string } };
  customFields?: Array<{ id: string; value: unknown }>;
  dateAdded?: string;
}

interface GhlConversation {
  id: string;
  contactId: string;
  type?: string;
  dateAdded?: string;
}

interface GhlMessage {
  id: string;
  body?: string;
  type?: number; // 1=TYPE_SMS, 2=TYPE_EMAIL, etc.
  direction?: string; // 'inbound' | 'outbound'
  dateAdded?: string;
  status?: string;
}

interface GhlPipeline {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string; position: number }>;
}

interface GhlOpportunity {
  id: string;
  name: string;
  pipelineId: string;
  pipelineStageId: string;
  status: string;
  monetaryValue?: number;
  contact?: { id: string };
  dateAdded?: string;
}

interface GhlCustomField {
  id: string;
  name: string;
  dataType: string;
  placeholder?: string;
  position?: number;
  picklistOptions?: string[];
}

interface GhlCalendar {
  id: string;
  name: string;
  description?: string;
}

interface GhlCalendarEvent {
  id: string;
  title?: string;
  startTime?: string;
  endTime?: string;
  contactId?: string;
  calendarId?: string;
  status?: string;
}

// ── GHL API Helper ──────────────────────────────────────────

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const RATE_LIMIT_DELAY = 200; // ms entre chaque requête

async function ghlFetch<T>(
  path: string, pitToken: string, params?: Record<string, string>
): Promise<{ data: T; meta?: { nextPageUrl?: string; startAfter?: string; startAfterId?: string; total?: number } }> {
  const url = new URL(`${GHL_API_BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const resp = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${pitToken}`,
      'Version': '2021-07-28',
      'Accept': 'application/json',
    },
  });

  if (resp.status === 429) {
    // Rate limited — on attend et on retry une fois
    await new Promise(r => setTimeout(r, 2000));
    const retry = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${pitToken}`,
        'Version': '2021-07-28',
        'Accept': 'application/json',
      },
    });
    if (!retry.ok) throw new Error(`GHL API error ${retry.status}: ${await retry.text()}`);
    return retry.json() as Promise<{ data: T; meta?: { nextPageUrl?: string; startAfter?: string; startAfterId?: string; total?: number } }>;
  }

  if (!resp.ok) throw new Error(`GHL API error ${resp.status}: ${await resp.text()}`);
  return resp.json() as Promise<{ data: T; meta?: { nextPageUrl?: string; startAfter?: string; startAfterId?: string; total?: number } }>;
}

// ── API Routes ──────────────────────────────────────────────

export async function handleStartMigration(
  request: Request, env: Env, auth: { userId: string; role: string }
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as {
    location_id: string;
    pit_token: string;
    client_id: string;
    modules?: string[];
  };

  if (!body.location_id || !body.pit_token) {
    return json({ error: 'location_id et pit_token requis' }, 400);
  }

  const modules = body.modules || ['contacts', 'custom_fields', 'conversations', 'pipelines', 'calendars'];
  const migrationId = crypto.randomUUID();

  // Créer les jobs de migration
  for (const mod of modules) {
    const jobId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO migration_jobs (id, sub_account_id, job_type, status, started_at)
       VALUES (?, ?, ?, 'running', datetime('now'))`
    ).bind(jobId, body.location_id, mod).run();
  }

  // Exécuter la migration de manière synchrone (Cloudflare Workers — pas de Queue pour l'instant)
  // On process chaque module séquentiellement dans la limite du timeout
  const results: Record<string, { imported: number; skipped: number; errors: number }> = {};

  for (const mod of modules) {
    try {
      const job = await env.DB.prepare(
        "SELECT id FROM migration_jobs WHERE sub_account_id = ? AND job_type = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1"
      ).bind(body.location_id, mod).first() as { id: string } | null;

      if (!job) continue;

      let result: { imported: number; skipped: number; errors: number };

      switch (mod) {
        case 'custom_fields':
          result = await migrateCustomFields(env, body.location_id, body.pit_token, body.client_id, job.id);
          break;
        case 'contacts':
          result = await migrateContacts(env, body.location_id, body.pit_token, body.client_id, job.id);
          break;
        case 'conversations':
          result = await migrateConversations(env, body.location_id, body.pit_token, body.client_id, job.id);
          break;
        case 'pipelines':
          result = await migratePipelines(env, body.location_id, body.pit_token, body.client_id, job.id);
          break;
        case 'calendars':
          result = await migrateCalendars(env, body.location_id, body.pit_token, body.client_id, job.id);
          break;
        default:
          result = { imported: 0, skipped: 0, errors: 0 };
      }

      results[mod] = result;

      await env.DB.prepare(
        `UPDATE migration_jobs SET status = 'completed', completed_at = datetime('now'),
         total_imported = ?, total_skipped = ?, total_errors = ? WHERE id = ?`
      ).bind(result.imported, result.skipped, result.errors, job.id).run();

    } catch (err) {
      results[mod] = { imported: 0, skipped: 0, errors: 1 };
      console.error(`Migration ${mod} failed:`, err);
    }
  }

  await audit(env, auth.userId, 'migration.start', 'migration', migrationId, { location_id: body.location_id, modules, results });
  return json({ data: { migration_id: migrationId, results } });
}

export async function handleGetMigrationStatus(
  env: Env, auth: { userId: string; role: string }, url: URL
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const locationId = url.searchParams.get('location_id');
  let query = 'SELECT * FROM migration_jobs ORDER BY created_at DESC LIMIT 50';
  const params: string[] = [];
  if (locationId) {
    query = 'SELECT * FROM migration_jobs WHERE sub_account_id = ? ORDER BY created_at DESC LIMIT 50';
    params.push(locationId);
  }

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return json({ data: results || [] });
}

// ── M3 — Custom Fields ─────────────────────────────────────

async function migrateCustomFields(
  env: Env, locationId: string, pitToken: string, clientId: string, _jobId: string
): Promise<{ imported: number; skipped: number; errors: number }> {
  let imported = 0, skipped = 0, errors = 0;

  try {
    const resp = await ghlFetch<GhlCustomField[]>(
      `/locations/${locationId}/customFields`, pitToken
    );
    // GHL retourne { customFields: [...] } — pas sous .data
    const rawResp = resp as unknown as Record<string, unknown>;
    const fields = (rawResp.customFields || resp.data || []) as GhlCustomField[];

    for (const field of fields) {
      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY));

      try {
        // Mapper le type GHL vers notre type
        const typeMap: Record<string, string> = {
          'TEXT': 'text', 'LARGE_TEXT': 'textarea', 'NUMERICAL': 'number',
          'PHONE': 'phone', 'MONETARY': 'number', 'CHECKBOX': 'checkbox',
          'SINGLE_OPTIONS': 'select', 'MULTIPLE_OPTIONS': 'multiselect',
          'DATE': 'date', 'FILE_UPLOAD': 'file', 'SIGNATURE': 'text',
        };
        const fieldType = typeMap[field.dataType] || 'text';

        // INSERT OR IGNORE — idempotent
        const fieldId = crypto.randomUUID();
        // Générer un slug à partir du nom
        const slug = field.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        const result = await env.DB.prepare(
          `INSERT OR IGNORE INTO custom_field_defs (id, client_id, name, slug, field_type, options, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          fieldId, clientId, sanitizeInput(field.name, 200), slug, fieldType,
          field.picklistOptions ? JSON.stringify(field.picklistOptions) : '[]',
          field.position || 0
        ).run();

        if (result.meta.changes > 0) {
          // Sauvegarder le mapping GHL ID → notre ID
          await env.DB.prepare(
            `INSERT OR IGNORE INTO migration_field_map (id, sub_account_id, source_type, source_id, target_id, metadata)
             VALUES (?, ?, 'custom_field', ?, ?, ?)`
          ).bind(crypto.randomUUID(), locationId, field.id, fieldId, JSON.stringify({ name: field.name, ghl_type: field.dataType })).run();
          imported++;
        } else {
          skipped++;
        }
      } catch (err) {
        errors++;
        console.error(`Erreur migration custom field ${field.name}:`, err);
      }
    }
  } catch (err) {
    errors++;
    console.error('Erreur fetch custom fields GHL:', err);
  }

  return { imported, skipped, errors };
}

// ── M1 — Contacts ──────────────────────────────────────────

async function migrateContacts(
  env: Env, locationId: string, pitToken: string, clientId: string, jobId: string
): Promise<{ imported: number; skipped: number; errors: number }> {
  let imported = 0, skipped = 0, errors = 0;
  let hasMore = true;
  let startAfter = '';

  // Charger le mapping custom fields pour ce sub-account
  const { results: fieldMaps } = await env.DB.prepare(
    "SELECT source_id, target_id FROM migration_field_map WHERE sub_account_id = ? AND source_type = 'custom_field'"
  ).bind(locationId).all();
  const cfMap = new Map<string, string>();
  for (const fm of (fieldMaps || []) as Array<{ source_id: string; target_id: string }>) {
    cfMap.set(fm.source_id, fm.target_id);
  }

  while (hasMore) {
    try {
      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY));

      const params: Record<string, string> = { locationId, limit: '100' };
      if (startAfter) params.startAfter = startAfter;

      const resp = await ghlFetch<{ contacts: GhlContact[] }>('/contacts/', pitToken, params);
      const contacts = resp.data?.contacts || (resp as unknown as { contacts: GhlContact[] }).contacts || [];

      if (contacts.length === 0) {
        hasMore = false;
        break;
      }

      for (const contact of contacts) {
        try {
          const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || '';
          const email = (contact.email || '').toLowerCase();
          const phone = contact.phone || '';

          // DND mapping
          let dnd = 0;
          let dndSettings: Record<string, boolean> = {};
          if (contact.dnd) {
            dnd = 1;
            if (contact.dndSettings) {
              dndSettings = {
                sms: contact.dndSettings.sms?.status === 'active',
                email: contact.dndSettings.email?.status === 'active',
                call: contact.dndSettings.call?.status === 'active',
              };
            }
          }

          const leadId = crypto.randomUUID();
          const result = await env.DB.prepare(
            `INSERT OR IGNORE INTO leads
             (id, client_id, name, email, phone, source, type, status, dnd, dnd_settings,
              date_of_birth, country, timezone, external_id, migrated_from, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'inbound', 'new', ?, ?, ?, ?, ?, ?, 'ghl', ?)`
          ).bind(
            leadId, clientId, sanitizeInput(name, 200), email, phone,
            sanitizeInput(contact.source || 'ghl_import', 100),
            dnd, JSON.stringify(dndSettings),
            contact.dateOfBirth || null,
            sanitizeInput(contact.country || 'CA', 10),
            sanitizeInput(contact.timezone || 'America/Toronto', 50),
            contact.id,
            contact.dateAdded || new Date().toISOString()
          ).run();

          if (result.meta.changes > 0) {
            // Tags
            if (contact.tags?.length) {
              for (const tag of contact.tags) {
                await env.DB.prepare(
                  'INSERT OR IGNORE INTO lead_tags (lead_id, tag) VALUES (?, ?)'
                ).bind(leadId, tag.toLowerCase()).run();
              }
            }

            // Custom field values
            if (contact.customFields?.length) {
              for (const cf of contact.customFields) {
                const targetFieldId = cfMap.get(cf.id);
                if (targetFieldId && cf.value !== null && cf.value !== undefined) {
                  await env.DB.prepare(
                    'INSERT OR IGNORE INTO custom_field_values (lead_id, field_id, value) VALUES (?, ?, ?)'
                  ).bind(leadId, targetFieldId, String(cf.value)).run();
                }
              }
            }

            // Sauvegarder le mapping
            await env.DB.prepare(
              `INSERT OR IGNORE INTO migration_field_map (id, sub_account_id, source_type, source_id, target_id)
               VALUES (?, ?, 'contact', ?, ?)`
            ).bind(crypto.randomUUID(), locationId, contact.id, leadId).run();

            imported++;
          } else {
            skipped++;
          }
        } catch (err) {
          errors++;
          console.error(`Erreur migration contact ${contact.id}:`, err);
        }
      }

      // Pagination
      startAfter = (resp.meta?.startAfter || resp.meta?.startAfterId || '') as string;
      if (!startAfter || contacts.length < 100) hasMore = false;

      // Update progress
      await env.DB.prepare(
        'UPDATE migration_jobs SET total_processed = total_processed + ?, total_imported = ?, total_skipped = ?, total_errors = ? WHERE id = ?'
      ).bind(contacts.length, imported, skipped, errors, jobId).run();

    } catch (err) {
      console.error('Erreur fetch contacts GHL:', err);
      errors++;
      hasMore = false;
    }
  }

  return { imported, skipped, errors };
}

// ── M2 — Conversations + Messages ──────────────────────────

async function migrateConversations(
  env: Env, locationId: string, pitToken: string, _clientId: string, jobId: string
): Promise<{ imported: number; skipped: number; errors: number }> {
  let imported = 0, skipped = 0, errors = 0;

  try {
    await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY));

    const resp = await ghlFetch<{ conversations: GhlConversation[] }>(
      '/conversations/search', pitToken, { locationId }
    );
    const conversations = resp.data?.conversations || (resp as unknown as { conversations: GhlConversation[] }).conversations || [];

    for (const conv of conversations) {
      try {
        // Trouver le lead correspondant via external_id
        const lead = await env.DB.prepare(
          "SELECT id, client_id FROM leads WHERE external_id = ? AND migrated_from = 'ghl'"
        ).bind(conv.contactId).first() as { id: string; client_id: string } | null;

        if (!lead) {
          skipped++;
          continue;
        }

        // Fetch messages de cette conversation
        await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY));
        const msgResp = await ghlFetch<{ messages: GhlMessage[] }>(
          `/conversations/${conv.id}/messages`, pitToken
        );
        const messages = msgResp.data?.messages || (msgResp as unknown as { messages: GhlMessage[] }).messages || [];

        for (const msg of messages) {
          if (!msg.body) continue;

          // Mapper le type GHL vers notre channel
          const channelMap: Record<number, string> = {
            1: 'sms', 2: 'email', 3: 'sms', // TYPE_SMS, TYPE_EMAIL, TYPE_SMS_REVIEW
            4: 'email', 5: 'webchat', 6: 'webchat', // TYPE_EMAIL, TYPE_LIVE_CHAT, TYPE_FACEBOOK
            7: 'webchat', 8: 'email', // TYPE_INSTAGRAM, TYPE_ACTIVITY
          };
          const channel = channelMap[msg.type || 0] || 'email';
          const direction = msg.direction === 'outbound' ? 'outbound' : 'inbound';

          await env.DB.prepare(
            `INSERT OR IGNORE INTO messages
             (id, lead_id, client_id, direction, channel, body, status, sent_by, external_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'delivered', 'ghl_import', ?, ?)`
          ).bind(
            crypto.randomUUID(), lead.id, lead.client_id,
            direction, channel, sanitizeInput(msg.body, 10000),
            msg.id, msg.dateAdded || new Date().toISOString()
          ).run();

          imported++;
        }

        // Update progress
        await env.DB.prepare(
          'UPDATE migration_jobs SET total_processed = total_processed + 1 WHERE id = ?'
        ).bind(jobId).run();

      } catch (err) {
        errors++;
        console.error(`Erreur migration conversation ${conv.id}:`, err);
      }
    }
  } catch (err) {
    errors++;
    console.error('Erreur fetch conversations GHL:', err);
  }

  return { imported, skipped, errors };
}

// ── M4 — Pipelines + Opportunities ─────────────────────────

async function migratePipelines(
  env: Env, locationId: string, pitToken: string, clientId: string, _jobId: string
): Promise<{ imported: number; skipped: number; errors: number }> {
  let imported = 0, skipped = 0, errors = 0;

  try {
    // Fetch pipelines
    await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY));
    const pResp = await ghlFetch<{ pipelines: GhlPipeline[] }>(
      '/opportunities/pipelines', pitToken, { locationId }
    );
    const pipelines = pResp.data?.pipelines || (pResp as unknown as { pipelines: GhlPipeline[] }).pipelines || [];

    for (const pipeline of pipelines) {
      const pipelineId = crypto.randomUUID();
      const result = await env.DB.prepare(
        `INSERT OR IGNORE INTO pipelines (id, client_id, name) VALUES (?, ?, ?)`
      ).bind(pipelineId, clientId, sanitizeInput(pipeline.name, 200)).run();

      if (result.meta.changes > 0) {
        // Stages
        for (const stage of (pipeline.stages || [])) {
          await env.DB.prepare(
            `INSERT OR IGNORE INTO pipeline_stages (id, pipeline_id, name, position) VALUES (?, ?, ?, ?)`
          ).bind(crypto.randomUUID(), pipelineId, sanitizeInput(stage.name, 200), stage.position).run();
        }

        // Mapping
        await env.DB.prepare(
          `INSERT OR IGNORE INTO migration_field_map (id, sub_account_id, source_type, source_id, target_id)
           VALUES (?, ?, 'pipeline', ?, ?)`
        ).bind(crypto.randomUUID(), locationId, pipeline.id, pipelineId).run();

        // Mapping des stages
        for (const stage of (pipeline.stages || [])) {
          const ourStage = await env.DB.prepare(
            'SELECT id FROM pipeline_stages WHERE pipeline_id = ? AND name = ?'
          ).bind(pipelineId, sanitizeInput(stage.name, 200)).first() as { id: string } | null;
          if (ourStage) {
            await env.DB.prepare(
              `INSERT OR IGNORE INTO migration_field_map (id, sub_account_id, source_type, source_id, target_id)
               VALUES (?, ?, 'pipeline_stage', ?, ?)`
            ).bind(crypto.randomUUID(), locationId, stage.id, ourStage.id).run();
          }
        }

        imported++;
      } else {
        skipped++;
      }
    }

    // Fetch opportunities
    await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY));
    const oResp = await ghlFetch<{ opportunities: GhlOpportunity[] }>(
      '/opportunities/search', pitToken, { location_id: locationId }
    );
    const opps = oResp.data?.opportunities || (oResp as unknown as { opportunities: GhlOpportunity[] }).opportunities || [];

    for (const opp of opps) {
      try {
        // Trouver le lead
        const contactId = opp.contact?.id;
        if (!contactId) continue;

        const lead = await env.DB.prepare(
          "SELECT id FROM leads WHERE external_id = ? AND migrated_from = 'ghl'"
        ).bind(contactId).first() as { id: string } | null;
        if (!lead) continue;

        // Trouver le pipeline et stage mappés
        const pMap = await env.DB.prepare(
          "SELECT target_id FROM migration_field_map WHERE sub_account_id = ? AND source_type = 'pipeline' AND source_id = ?"
        ).bind(locationId, opp.pipelineId).first() as { target_id: string } | null;

        const sMap = await env.DB.prepare(
          "SELECT target_id FROM migration_field_map WHERE sub_account_id = ? AND source_type = 'pipeline_stage' AND source_id = ?"
        ).bind(locationId, opp.pipelineStageId).first() as { target_id: string } | null;

        if (pMap && sMap) {
          await env.DB.prepare(
            "UPDATE leads SET pipeline_id = ?, pipeline_stage_id = ?, deal_value = ? WHERE id = ?"
          ).bind(pMap.target_id, sMap.target_id, opp.monetaryValue || 0, lead.id).run();
        }

        imported++;
      } catch (err) {
        errors++;
        console.error(`Erreur migration opportunity ${opp.id}:`, err);
      }
    }

  } catch (err) {
    errors++;
    console.error('Erreur fetch pipelines GHL:', err);
  }

  return { imported, skipped, errors };
}

// ── M5 — Calendars + Events ────────────────────────────────

async function migrateCalendars(
  env: Env, locationId: string, pitToken: string, clientId: string, _jobId: string
): Promise<{ imported: number; skipped: number; errors: number }> {
  let imported = 0, skipped = 0, errors = 0;

  try {
    // Fetch calendars
    await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY));
    const cResp = await ghlFetch<{ calendars: GhlCalendar[] }>(
      '/calendars/', pitToken, { locationId }
    );
    const calendars = cResp.data?.calendars || (cResp as unknown as { calendars: GhlCalendar[] }).calendars || [];

    for (const cal of calendars) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO migration_field_map (id, sub_account_id, source_type, source_id, target_id, metadata)
         VALUES (?, ?, 'calendar', ?, ?, ?)`
      ).bind(crypto.randomUUID(), locationId, cal.id, cal.id, JSON.stringify({ name: cal.name })).run();
    }

    // Fetch events
    await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY));
    const eResp = await ghlFetch<{ events: GhlCalendarEvent[] }>(
      '/calendars/events', pitToken, { locationId }
    );
    const events = eResp.data?.events || (eResp as unknown as { events: GhlCalendarEvent[] }).events || [];

    for (const event of events) {
      try {
        // Trouver le lead si un contact est associé
        let leadId: string | null = null;
        if (event.contactId) {
          const lead = await env.DB.prepare(
            "SELECT id FROM leads WHERE external_id = ? AND migrated_from = 'ghl'"
          ).bind(event.contactId).first() as { id: string } | null;
          if (lead) leadId = lead.id;
        }

        await env.DB.prepare(
          `INSERT OR IGNORE INTO appointments
           (id, client_id, lead_id, title, start_time, end_time, status, external_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        ).bind(
          crypto.randomUUID(), clientId, leadId,
          sanitizeInput(event.title || 'Rendez-vous importé', 200),
          event.startTime || '', event.endTime || '',
          event.status || 'confirmed', event.id
        ).run();

        imported++;
      } catch (err) {
        errors++;
        console.error(`Erreur migration event ${event.id}:`, err);
      }
    }

  } catch (err) {
    errors++;
    console.error('Erreur fetch calendars GHL:', err);
  }

  return { imported, skipped, errors };
}
