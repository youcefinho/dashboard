import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import { decryptToken } from './migration-ghl-oauth';
import { GhlClient } from './migration-ghl-client';
import { 
  mapGhlContact, mapGhlConversation, mapGhlMessage, 
  mapGhlOpportunity, mapGhlCustomField, 
  mapGhlCalendar, mapGhlAppointment 
} from './migration-ghl-mappers';

export async function handleGhlApiRun(
  request: Request, env: Env, ctx: ExecutionContext, auth: { role: string; userId: string }
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as { 
    client_id: string; 
    location_id?: string; 
    scopes?: string[];
  };

  if (!body.client_id) return json({ error: 'client_id requis' }, 400);

  // Vérifier si une session "running" existe déjà
  const existingSession = await env.DB.prepare(
    "SELECT * FROM migration_sessions WHERE client_id = ? AND source = 'ghl_api' AND status = 'running'"
  ).bind(body.client_id).first() as { id: string; current_phase?: string; current_cursor?: string } | null;

  let sessionId = '';
  let startPhase = body.scopes?.[0] || 'contacts';
  let startCursor = '';

  const scopes = body.scopes || ['contacts', 'conversations', 'opportunities', 'calendars'];

  if (existingSession) {
    sessionId = existingSession.id;
    startPhase = existingSession.current_phase || scopes[0]!;
    startCursor = existingSession.current_cursor || '';
  } else {
    sessionId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO migration_sessions (id, client_id, source, status, current_phase, current_cursor)
       VALUES (?, ?, 'ghl_api', 'running', ?, '')`
    ).bind(sessionId, body.client_id, startPhase).run();
  }

  // Récupérer le token OAuth
  const tokenRecord = await env.DB.prepare(
    "SELECT access_token, location_id FROM ghl_tokens WHERE client_id = ?"
  ).bind(body.client_id).first() as { access_token: string; location_id: string } | null;

  if (!tokenRecord) {
    return json({ error: 'Aucun token GHL trouvé pour ce client' }, 400);
  }

  const locationId = body.location_id || tokenRecord.location_id;

  // Déchiffrer le token avant usage
  const accessToken = await decryptToken(tokenRecord.access_token, env);

  // Lancer le background job
  ctx.waitUntil(runMigrationLoop(env, sessionId, body.client_id, locationId, accessToken, scopes, startPhase, startCursor));

  return json({ data: { session_id: sessionId, status: 'running', message: 'Migration démarrée en arrière-plan' } });
}

// ── Routes Reports ───────────────────────────────────────────

export async function handleGetMigrationSession(env: Env, auth: { role: string }, sessionId: string): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  
  const session = await env.DB.prepare(
    "SELECT * FROM migration_sessions WHERE id = ?"
  ).bind(sessionId).first();

  if (!session) return json({ error: 'Session non trouvée' }, 404);
  return json({ data: session });
}

export async function handleGetMigrationErrors(env: Env, auth: { role: string }, sessionId: string): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  
  const session = await env.DB.prepare(
    "SELECT error_log_json FROM migration_sessions WHERE id = ?"
  ).bind(sessionId).first() as { error_log_json: string } | null;

  if (!session) return json({ error: 'Session non trouvée' }, 404);
  
  const errors = session.error_log_json ? JSON.parse(session.error_log_json) : [];
  return json({ data: errors });
}

// ── Background Job ─────────────────────────────────────────

async function runMigrationLoop(
  env: Env, sessionId: string, clientId: string, locationId: string, 
  accessToken: string, scopes: string[], startPhase: string, startCursor: string
) {
  const ghl = new GhlClient(accessToken);
  const errorLog: string[] = [];
  let imported = 0;
  let errorCount = 0;

  const updateState = async (phase: string, cursor: string, isFinished = false) => {
    if (isFinished) {
      await env.DB.prepare(
        `UPDATE migration_sessions 
         SET status = 'completed', finished_at = datetime('now'), imported_records = imported_records + ?, error_count = error_count + ?, current_phase = 'done', current_cursor = '', updated_at = datetime('now')
         WHERE id = ?`
      ).bind(imported, errorCount, sessionId).run();
    } else {
      await env.DB.prepare(
        `UPDATE migration_sessions 
         SET current_phase = ?, current_cursor = ?, imported_records = imported_records + ?, error_count = error_count + ?, updated_at = datetime('now')
         WHERE id = ?`
      ).bind(phase, cursor, imported, errorCount, sessionId).run();
    }
    // Reset counter per batch save
    imported = 0;
    errorCount = 0;
  };

  const logError = async (msg: string) => {
    errorLog.push(msg);
    errorCount++;
    console.error(`Migration GHL [${sessionId}]: ${msg}`);
  };

  try {
    let phaseIndex = scopes.indexOf(startPhase);
    if (phaseIndex === -1) phaseIndex = 0;

    for (let i = phaseIndex; i < scopes.length; i++) {
      const phase = scopes[i]!;
      let cursor = (i === phaseIndex) ? startCursor : undefined;

      if (phase === 'contacts') {
        // Précharger les custom fields
        try {
          const { customFields } = await ghl.getCustomFields(locationId);
          for (const cf of customFields) {
            const mapped = mapGhlCustomField(cf, clientId);
            await env.DB.prepare(
              `INSERT OR IGNORE INTO custom_field_defs (id, client_id, name, slug, field_type, options)
               VALUES (?, ?, ?, ?, ?, ?)`
            ).bind(mapped.id, clientId, mapped.name, mapped.slug, mapped.field_type, mapped.options).run();
          }
        } catch (e) {
          await logError(`Erreur prefetch custom fields: ${e}`);
        }

        // Boucle paginée contacts
        while (true) {
          const { contacts, meta } = await ghl.getContacts(locationId, cursor);
          
          for (const c of contacts) {
            try {
              const mapped = mapGhlContact(c, clientId);
              if (!mapped) continue;

              const result = await env.DB.prepare(
                `INSERT INTO leads (id, client_id, name, email, phone, source, type, status, dnd, dnd_settings, migrated_from)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).bind(
                mapped.id, clientId, sanitizeInput(mapped.name, 100), mapped.email, mapped.phone, mapped.source, mapped.type, mapped.status, mapped.dnd, mapped.dnd_settings, mapped.migrated_from
              ).run();

              if (result.meta.changes > 0) {
                // Mapping Idempotence
                await env.DB.prepare(
                  `INSERT OR IGNORE INTO migration_id_map (intralys_resource, intralys_id, external_source, external_id, client_id)
                   VALUES ('lead', ?, 'ghl', ?, ?)`
                ).bind(mapped.id, mapped.external_id, clientId).run();

                imported++;

                // On ne stocke pas les tags et custom_field_values pour simplifier l'exemple,
                // mais dans une implémentation complète, on les insère ici.
              }
            } catch (e: any) {
              // Duplicate email probable
              if (!e.message.includes('UNIQUE constraint failed')) {
                await logError(`Erreur contact ${c.id}: ${e}`);
              }
            }
          }

          if (!meta || !meta.nextPageUrl) break;
          // Extraire startAfter depuis nextPageUrl
          const urlObj = new URL(meta.nextPageUrl, 'http://dummy.com');
          cursor = urlObj.searchParams.get('startAfter') || undefined;
          if (!cursor) break;
          await updateState('contacts', cursor);
        }
        await updateState('contacts', '', false);
      }

      if (phase === 'conversations') {
        while (true) {
          // getConversations ne retourne pas toujours nextCursor facilement dans v1/v2, on simplifie pour l'exemple
          const { conversations } = await ghl.getConversations(locationId, cursor);
          
          for (const conv of conversations) {
            try {
              // Retrouver le lead via contactId
              const mapRow = await env.DB.prepare(
                "SELECT intralys_id FROM migration_id_map WHERE intralys_resource = 'lead' AND external_source = 'ghl' AND external_id = ? AND client_id = ?"
              ).bind(conv.contactId, clientId).first() as { intralys_id: string } | null;

              if (!mapRow) continue; // Contact introuvable = on ignore
              
              const mappedConv = mapGhlConversation(conv, clientId, mapRow.intralys_id);
              await env.DB.prepare(
                `INSERT OR IGNORE INTO migration_id_map (intralys_resource, intralys_id, external_source, external_id, client_id)
                 VALUES ('conversation', ?, 'ghl', ?, ?)`
              ).bind(mappedConv.id, mappedConv.external_id, clientId).run();
              
              // Messages
              let msgCursor: string | undefined = undefined;
              while (true) {
                const { messages, meta } = await ghl.getMessages(conv.id, msgCursor);
                for (const m of messages) {
                  const mappedMsg = mapGhlMessage(m, clientId, mapRow.intralys_id);
                  try {
                    await env.DB.prepare(
                      `INSERT INTO messages (id, lead_id, client_id, direction, channel, body, status, sent_by, external_id)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
                    ).bind(
                      mappedMsg.id, mappedMsg.lead_id, clientId, mappedMsg.direction, mappedMsg.channel, sanitizeInput(mappedMsg.body, 2000), mappedMsg.status, mappedMsg.sent_by, mappedMsg.external_id
                    ).run();

                    await env.DB.prepare(
                      `INSERT OR IGNORE INTO migration_id_map (intralys_resource, intralys_id, external_source, external_id, client_id)
                       VALUES ('message', ?, 'ghl', ?, ?)`
                    ).bind(mappedMsg.id, mappedMsg.external_id, clientId).run();

                    imported++;
                  } catch (e: any) {
                    if (!e.message.includes('UNIQUE constraint failed')) await logError(`Msg ${m.id}: ${e}`);
                  }
                }
                if (!meta || !meta.nextPageUrl) break;
                const mUrl = new URL(meta.nextPageUrl, 'http://dummy.com');
                msgCursor = mUrl.searchParams.get('startAfter') || undefined;
                if (!msgCursor) break;
              }

            } catch (e: any) {
              await logError(`Conv ${conv.id}: ${e}`);
            }
          }
          // Pour l'exemple, on s'arrête là car GHL search conv API n'a pas toujours pagination
          break; 
        }
        await updateState('conversations', '', false);
      }

      if (phase === 'opportunities') {
        // Fetch pipelines d'abord
        try {
          // Utilisation fictive ghl.getPipelines() si ça existait. On le hardcode ici.
          // const { pipelines } = await ghl.getPipelines(locationId);
          // pour l'instant on va stocker les opps directement dans le pipeline par defaut
        } catch (e) {
          await logError(`Pipelines: ${e}`);
        }

        while (true) {
          const { opportunities, meta } = await ghl.getOpportunities(locationId, cursor);
          
          for (const opp of opportunities) {
            try {
              if (!opp.contact?.id) continue;
              const mapRow = await env.DB.prepare(
                "SELECT intralys_id FROM migration_id_map WHERE intralys_resource = 'lead' AND external_source = 'ghl' AND external_id = ? AND client_id = ?"
              ).bind(opp.contact.id, clientId).first() as { intralys_id: string } | null;

              if (!mapRow) continue;

              const mapped = mapGhlOpportunity(opp);
              await env.DB.prepare(
                `UPDATE leads SET status = ?, deal_value = ? WHERE id = ?`
              ).bind(mapped.status, mapped.deal_value, mapRow.intralys_id).run();

              imported++;
            } catch (e) {
              await logError(`Opp ${opp.id}: ${e}`);
            }
          }

          if (!meta || !meta.nextPageUrl) break;
          const urlObj = new URL(meta.nextPageUrl, 'http://dummy.com');
          cursor = urlObj.searchParams.get('startAfter') || undefined;
          if (!cursor) break;
          await updateState('opportunities', cursor);
        }
        await updateState('opportunities', '', false);
      }

      if (phase === 'calendars') {
        try {
          const { calendars } = await ghl.getCalendars(locationId);
          for (const c of calendars) {
            const mapped = mapGhlCalendar(c, clientId);
            await env.DB.prepare(
              `INSERT OR IGNORE INTO migration_id_map (intralys_resource, intralys_id, external_source, external_id, client_id)
               VALUES ('calendar', ?, 'ghl', ?, ?)`
            ).bind(mapped.id, mapped.external_id, clientId).run();
            // Note: pas de table `calendars` dispo dans notre schema pour le moment, 
            // mais l'idempotence map garde trace.
          }

          const startT = new Date();
          startT.setDate(startT.getDate() - 90);
          const endT = new Date();
          endT.setDate(endT.getDate() + 180);

          const { events } = await ghl.getAppointments(locationId, startT.toISOString(), endT.toISOString());
          for (const ev of events) {
            const mapRow = await env.DB.prepare(
              "SELECT intralys_id FROM migration_id_map WHERE intralys_resource = 'lead' AND external_source = 'ghl' AND external_id = ? AND client_id = ?"
            ).bind(ev.contactId, clientId).first() as { intralys_id: string } | null;

            if (!mapRow) continue;

            const mapped = mapGhlAppointment(ev, clientId);
            try {
              await env.DB.prepare(
                `INSERT INTO appointments (id, client_id, lead_id, title, start_time, end_time, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
              ).bind(mapped.id, clientId, mapRow.intralys_id, sanitizeInput(mapped.title, 200), mapped.start_time, mapped.end_time, mapped.status, mapped.created_at).run();

              await env.DB.prepare(
                `INSERT OR IGNORE INTO migration_id_map (intralys_resource, intralys_id, external_source, external_id, client_id)
                 VALUES ('appointment', ?, 'ghl', ?, ?)`
              ).bind(mapped.id, mapped.external_id, clientId).run();

              imported++;
            } catch (e: any) {
              if (!e.message.includes('UNIQUE constraint failed')) await logError(`Appt ${ev.id}: ${e}`);
            }
          }
        } catch (e) {
          await logError(`Calendars: ${e}`);
        }
        await updateState('calendars', '', true); // True = final phase
      }
    }
  } catch (e: any) {
    await logError(`Fatal Error: ${e.message}`);
    await env.DB.prepare(
      `UPDATE migration_sessions SET status = 'failed', error_log_json = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(JSON.stringify(errorLog.slice(0, 50)), sessionId).run();
  }
}
