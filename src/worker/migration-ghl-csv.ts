import type { Env } from './types';
import { json, sanitizeInput, audit } from './helpers';

// ── Parser CSV robuste ──────────────────────────────────────

export function parseCsvRobust(csvData: string): string[][] {
  // Retirer le BOM UTF-8 s'il y est
  if (csvData.charCodeAt(0) === 0xFEFF) {
    csvData = csvData.substring(1);
  }

  const lines = csvData.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return [];

  // Auto-détection du séparateur sur la première ligne
  const firstLine = lines[0]!;
  let sep = ',';
  if (firstLine.includes('\t')) sep = '\t';
  else if (firstLine.split(';').length > firstLine.split(',').length) sep = ';';

  const result: string[][] = [];

  for (const line of lines) {
    const row: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i]!;
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === sep) {
          row.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
    }
    row.push(current.trim());
    result.push(row);
  }
  return result;
}

// ── Auto-détection du mapping GHL ──────────────────────────

const GHL_STANDARD_FIELDS = ['first name', 'last name', 'name', 'email', 'phone', 'tags'];

function autoDetectMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  
  headers.forEach((h) => {
    const lower = h.toLowerCase().trim();
    if (['first name', 'prénom'].includes(lower)) mapping[h] = 'firstName';
    else if (['last name', 'nom'].includes(lower)) mapping[h] = 'lastName';
    else if (['name', 'full name', 'nom complet'].includes(lower)) mapping[h] = 'name';
    else if (['email', 'courriel'].includes(lower)) mapping[h] = 'email';
    else if (['phone', 'téléphone', 'tel', 'cellulaire'].includes(lower)) mapping[h] = 'phone';
    else if (['tags', 'étiquettes'].includes(lower)) mapping[h] = 'tags';
    else if (['source', 'lead source'].includes(lower)) mapping[h] = 'source';
    else if (!GHL_STANDARD_FIELDS.includes(lower) && h.length > 0) {
      // Les champs inconnus deviennent des custom fields (cf_*)
      mapping[h] = `cf_${h.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    }
  });

  return mapping;
}

// ── Route: POST /api/migration/ghl/csv/preview ─────────────

export async function handleGhlCsvPreview(
  request: Request, env: Env, auth: { role: string; userId: string }
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as { client_id: string; csv_data: string; field_mapping?: Record<string, string> };
  if (!body.client_id || !body.csv_data) {
    return json({ error: 'client_id et csv_data requis' }, 400);
  }

  // Si on reçoit en base64, on décode (certains frontends l'envoient en base64 pour éviter les soucis d'encoding)
  let rawCsv = body.csv_data;
  if (!rawCsv.includes('\n') && rawCsv.length > 50 && !rawCsv.includes(',')) {
    try {
      rawCsv = atob(rawCsv);
    } catch (e) {
      // fallback
    }
  }

  const rows = parseCsvRobust(rawCsv);
  if (rows.length < 2) {
    return json({ error: 'Le fichier CSV doit contenir au moins un en-tête et une ligne de données.' }, 400);
  }

  const headers = rows[0]!;
  const mapping = body.field_mapping || autoDetectMapping(headers);

  let rowsValid = 0;
  let rowsSkipped = 0;
  const duplicateEmails: string[] = [];
  const existingContacts: string[] = [];
  const customFieldsDetected: string[] = [];

  // Extraire les custom fields détectés
  for (const [csvHeader, intralysField] of Object.entries(mapping)) {
    if (intralysField.startsWith('cf_')) {
      customFieldsDetected.push(csvHeader);
    }
  }

  // Simuler sur un sample et récupérer les emails du DB
  const emailsToInsert = new Set<string>();
  const emailsFromCsv = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      const key = mapping[h];
      if (key && row[idx]) record[key] = row[idx]!;
    });

    const email = (record.email || '').toLowerCase();
    const phone = record.phone || '';

    if (!email && !phone) {
      rowsSkipped++;
      continue;
    }

    if (email) {
      if (emailsToInsert.has(email)) {
        duplicateEmails.push(email);
        rowsSkipped++;
        continue;
      }
      emailsToInsert.add(email);
      emailsFromCsv.push(email);
    }

    rowsValid++;
  }

  // Vérifier en base pour identifier les conflits réels (existing_contacts)
  if (emailsFromCsv.length > 0) {
    // SQLite limits IN to 999. Si gros fichier, preview partiel ou chunks. On prend les 50 premiers pour la preview.
    const sampleEmails = emailsFromCsv.slice(0, 50);
    const placeholders = sampleEmails.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT email FROM leads WHERE client_id = ? AND email IN (${placeholders})`
    ).bind(body.client_id, ...sampleEmails).all();
    
    for (const r of (results || [])) {
      if (r.email) existingContacts.push(r.email as string);
    }
  }

  // Sample des 10 premières lignes
  const sampleData = rows.slice(1, 11).map(row => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      const mappedKey = mapping[h];
      if (mappedKey && row[idx]) obj[mappedKey] = row[idx]!;
    });
    return obj;
  });

  return json({
    data: {
      rows_total: rows.length - 1,
      rows_valid: rowsValid,
      rows_skipped: rowsSkipped,
      sample_first_10: sampleData,
      custom_fields_detected: customFieldsDetected,
      conflicts: {
        duplicate_emails_in_csv: duplicateEmails.slice(0, 10), // Limit pour la preview
        existing_contacts: existingContacts,
      },
      mapping_used: mapping
    }
  });
}

// ── Route: POST /api/migration/ghl/csv/run ─────────────────

export async function handleGhlCsvRun(
  request: Request, env: Env, auth: { role: string; userId: string }
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as { client_id: string; csv_data: string; field_mapping: Record<string, string> };
  if (!body.client_id || !body.csv_data || !body.field_mapping) {
    return json({ error: 'client_id, csv_data et field_mapping requis' }, 400);
  }

  const rows = parseCsvRobust(body.csv_data.includes('\n') ? body.csv_data : (function(){ try { return atob(body.csv_data) } catch { return body.csv_data } })());
  if (rows.length < 2) return json({ error: 'CSV vide' }, 400);

  const headers = rows[0]!;
  const mapping = body.field_mapping;

  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO migration_sessions (id, client_id, source, status, total_records)
     VALUES (?, ?, 'ghl_csv', 'running', ?)`
  ).bind(sessionId, body.client_id, rows.length - 1).run();

  let imported = 0;
  let skipped = 0;
  let errorCount = 0;
  const errorLog: string[] = [];

  // Création à la volée des champs personnalisés
  const cfCache = new Map<string, string>(); // slug -> id
  for (const [csvHeader, intralysField] of Object.entries(mapping)) {
    if (intralysField.startsWith('cf_')) {
      const cfId = crypto.randomUUID();
      const result = await env.DB.prepare(
        `INSERT OR IGNORE INTO custom_field_defs (id, client_id, name, slug, field_type)
         VALUES (?, ?, ?, ?, 'text')`
      ).bind(cfId, body.client_id, sanitizeInput(csvHeader, 200), intralysField).run();
      
      if (result.meta.changes > 0) {
        cfCache.set(intralysField, cfId);
      } else {
        // Fetch l'existant
        const existingCf = await env.DB.prepare(
          "SELECT id FROM custom_field_defs WHERE client_id = ? AND slug = ?"
        ).bind(body.client_id, intralysField).first() as { id: string } | null;
        if (existingCf) cfCache.set(intralysField, existingCf.id);
      }
    }
  }

  // Import batch par batch
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      const key = mapping[h];
      if (key && row[idx]) record[key] = row[idx]!.trim();
    });

    const email = (record.email || '').toLowerCase();
    const phone = record.phone || '';

    if (!email && !phone) {
      skipped++;
      continue;
    }

    // Fusion de firstName et lastName si name n'existe pas
    let finalName = record.name || '';
    if (!finalName && (record.firstName || record.lastName)) {
      finalName = [record.firstName, record.lastName].filter(Boolean).join(' ');
    }

    try {
      // Check duplicate explicit (email + client_id)
      let existingLeadId: string | null = null;
      if (email) {
        const existing = await env.DB.prepare(
          'SELECT id FROM leads WHERE LOWER(email) = ? AND client_id = ?'
        ).bind(email, body.client_id).first() as { id: string } | null;
        if (existing) {
          existingLeadId = existing.id;
        }
      }

      if (existingLeadId) {
        skipped++;
        errorLog.push(`Ligne ${i + 1}: Lead existant (${email})`);
        continue;
      }

      const leadId = crypto.randomUUID();
      const tagsString = record.tags || '';
      const source = sanitizeInput(record.source || 'ghl_csv', 100);

      const result = await env.DB.prepare(
        `INSERT INTO leads (id, client_id, name, email, phone, source, type, status, migrated_from, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'inbound', 'new', 'ghl_csv', datetime('now'))`
      ).bind(
        leadId, body.client_id, sanitizeInput(finalName, 200), email, phone, source
      ).run();

      if (result.meta.changes > 0) {
        // Map idempotence
        await env.DB.prepare(
          `INSERT OR IGNORE INTO migration_id_map (intralys_resource, intralys_id, external_source, external_id, client_id)
           VALUES ('lead', ?, 'ghl_csv', ?, ?)`
        ).bind(leadId, email || phone, body.client_id).run();

        // Tags
        if (tagsString) {
          const tags = tagsString.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
          for (const tag of tags) {
            await env.DB.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag) VALUES (?, ?)').bind(leadId, tag).run();
          }
        }

        // Custom fields
        for (const [key, value] of Object.entries(record)) {
          if (key.startsWith('cf_') && value) {
            const defId = cfCache.get(key);
            if (defId) {
              await env.DB.prepare(
                'INSERT INTO custom_field_values (lead_id, field_id, value) VALUES (?, ?, ?)'
              ).bind(leadId, defId, sanitizeInput(value, 2000)).run();
            }
          }
        }

        imported++;
      }
    } catch (err) {
      errorCount++;
      errorLog.push(`Ligne ${i + 1}: ${String(err)}`);
    }

    // Update progession
    if (i % 50 === 0) {
      await env.DB.prepare(
        'UPDATE migration_sessions SET imported_records = ?, error_count = ?, updated_at = datetime("now") WHERE id = ?'
      ).bind(imported, errorCount, sessionId).run();
    }
  }

  // Clôturer la session
  await env.DB.prepare(
    `UPDATE migration_sessions 
     SET status = 'completed', finished_at = datetime('now'), imported_records = ?, error_count = ?, error_log_json = ? 
     WHERE id = ?`
  ).bind(imported, errorCount, JSON.stringify(errorLog.slice(0, 100)), sessionId).run();

  await audit(env, auth.userId, 'migration.csv.run', 'client', body.client_id, { imported, skipped, errorCount });

  return json({
    data: {
      session_id: sessionId,
      imported,
      skipped,
      errors: errorCount,
      log: errorLog.slice(0, 100)
    }
  });
}
