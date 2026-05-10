// ── Module AI — Intralys CRM ────────────────────────────────
import type { Env } from './types';
import { sanitizeInput, json, audit } from './helpers';

async function callClaude(env: Env, systemPrompt: string, userMessage: string, maxTokens = 500): Promise<string> {
  const apiKey = env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY non configurée');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, system: systemPrompt, messages: [{ role: 'user', content: userMessage }] }),
  });
  if (!res.ok) { const err = await res.text(); throw new Error(`Anthropic API ${res.status}: ${err}`); }
  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  return data.content?.[0]?.text || '';
}

export async function handleAiChat(request: Request, env: Env, _auth: { userId: string; role: string }): Promise<Response> {
  if (!env.OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY non configurée' }, 500);
  const body = await request.json() as { lead_id?: string; message?: string; conversation_id?: string };
  if (!body.message) return json({ error: 'Message requis' }, 400);
  if (!body.lead_id && !body.conversation_id) return json({ error: 'lead_id ou conversation_id requis' }, 400);
  let convId = body.conversation_id || '';
  if (!convId && body.lead_id) {
    const lead = await env.DB.prepare('SELECT client_id FROM leads WHERE id = ?').bind(body.lead_id).first() as { client_id: string } | null;
    if (!lead) return json({ error: 'Lead introuvable' }, 404);
    convId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO ai_conversations (id, lead_id, client_id, channel, status) VALUES (?, ?, ?, 'web', 'active')").bind(convId, body.lead_id, lead.client_id).run();
  }
  const { results: history } = await env.DB.prepare('SELECT role, content FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 20').bind(convId).all();
  const messages = [
    { role: 'system', content: 'Tu es un assistant CRM pour courtiers immobiliers au Québec. Sois professionnel, chaleureux et concis. Réponds en français.' },
    ...((history || []) as Array<{ role: string; content: string }>),
    { role: 'user', content: body.message },
  ];
  const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages, max_tokens: 500, temperature: 0.7 }),
  });
  const aiData = await aiRes.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { total_tokens?: number } };
  const reply = aiData.choices?.[0]?.message?.content || 'Désolé, je ne peux pas répondre.';
  const tokens = aiData.usage?.total_tokens || 0;
  await env.DB.prepare('INSERT INTO ai_messages (id, conversation_id, role, content, tokens_used) VALUES (?, ?, ?, ?, 0)').bind(crypto.randomUUID(), convId, 'user', sanitizeInput(body.message, 2000)).run();
  await env.DB.prepare('INSERT INTO ai_messages (id, conversation_id, role, content, tokens_used) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), convId, 'assistant', reply, tokens).run();
  return json({ data: { conversation_id: convId, reply, tokens_used: tokens } });
}

export async function handleGetAiConversations(env: Env, auth: { role: string }, url: URL): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
  const { results } = await env.DB.prepare(`SELECT c.*, l.name as lead_name, (SELECT COUNT(*) FROM ai_messages WHERE conversation_id = c.id) as message_count FROM ai_conversations c LEFT JOIN leads l ON c.lead_id = l.id ORDER BY c.updated_at DESC LIMIT ?`).bind(limit).all();
  return json({ data: results || [] });
}

export async function handleGetAiConversation(env: Env, auth: { role: string }, convId: string): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const conv = await env.DB.prepare('SELECT * FROM ai_conversations WHERE id = ?').bind(convId).first();
  if (!conv) return json({ error: 'Conversation non trouvée' }, 404);
  const { results: msgs } = await env.DB.prepare('SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC').bind(convId).all();
  return json({ data: { ...conv, messages: msgs || [] } });
}

export async function handleAiScore(env: Env, auth: { userId: string; role: string }, leadId: string): Promise<Response> {
  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first() as Record<string, unknown> | null;
  if (!lead) return json({ error: 'Lead non trouvé' }, 404);
  const { results: msgs } = await env.DB.prepare('SELECT direction, body, channel FROM messages WHERE lead_id = ? ORDER BY sent_at DESC LIMIT 10').bind(leadId).all();
  const sp = 'Tu es un expert en qualification de leads immobiliers QC. Score 0-100. Réponds JSON: {"score": <number>, "reason": "<français>"}';
  const um = `Lead: ${JSON.stringify({ name: lead.name, type: lead.type, source: lead.source, budget: lead.budget, status: lead.status })}\nMessages: ${(msgs || []).length}`;
  try {
    const result = await callClaude(env, sp, um, 200);
    const parsed = JSON.parse(result) as { score: number; reason: string };
    await env.DB.prepare("UPDATE leads SET score = ?, updated_at = datetime('now') WHERE id = ?").bind(String(parsed.score), leadId).run();
    await audit(env, auth.userId, 'ai.score', 'lead', leadId, { score: parsed.score });
    return json({ data: parsed });
  } catch (err) { console.error('AI scoring erreur:', err); return json({ error: 'Erreur scoring AI', details: String(err) }, 500); }
}

export async function handleAiGenerate(request: Request, env: Env, auth: { userId: string; role: string }): Promise<Response> {
  const body = await request.json() as { action: string; context?: Record<string, unknown>; lead_id?: string; client_id?: string };
  const allowed = ['email_followup', 'centris_description', 'social_post', 'objection_handler', 'sms_followup'];
  if (!body.action || !allowed.includes(body.action)) return json({ error: `action requise: ${allowed.join(', ')}` }, 400);
  let bv = 'Ton professionnel québécois.';
  if (body.client_id) { const c = await env.DB.prepare('SELECT name FROM clients WHERE id = ?').bind(body.client_id).first() as { name: string } | null; if (c) bv += ` Client: ${c.name}.`; }
  let lc = '';
  if (body.lead_id) { const l = await env.DB.prepare('SELECT name, type, budget FROM leads WHERE id = ?').bind(body.lead_id).first(); if (l) lc = `\nLead: ${JSON.stringify(l)}`; }
  const sp = `${bv} Action: ${body.action}. Réponds en JSON.`;
  const um = `${body.action}${lc}\n${body.context ? JSON.stringify(body.context) : ''}`;
  try {
    const result = await callClaude(env, sp, um, 500);
    const parsed = JSON.parse(result);
    await audit(env, auth.userId, `ai.generate.${body.action}`, 'ai', '', { lead_id: body.lead_id });
    return json({ data: parsed });
  } catch (err) { console.error('AI generate erreur:', err); return json({ error: 'Erreur génération AI', details: String(err) }, 500); }
}

export async function handleAiSuggestWorkflow(request: Request, env: Env, auth: { userId: string; role: string }): Promise<Response> {
  const body = await request.json() as { description: string };
  if (!body.description) return json({ error: 'description requise' }, 400);
  const sp = 'Expert automatisation CRM QC. Convertis description en JSON workflow steps. Format: {"name":"...","trigger_type":"...","steps":[{"step_order":1,"action_type":"...","config":{}}]}';
  try {
    const result = await callClaude(env, sp, body.description, 800);
    const parsed = JSON.parse(result);
    await audit(env, auth.userId, 'ai.suggest_workflow', 'ai', '', { description: body.description.slice(0, 100) });
    return json({ data: parsed });
  } catch (err) { console.error('AI suggest erreur:', err); return json({ error: 'Erreur suggestion AI', details: String(err) }, 500); }
}
