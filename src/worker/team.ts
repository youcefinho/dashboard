import type { Env } from './types';
import { json, sanitizeInput } from './helpers';

export async function handleGetUsers(_request: Request, env: Env): Promise<Response> {
  // Dans un vrai système, on filtrerait par agence ou client_id.
  // Ici pour le MVP du dashboard Intralys CRM :
  const { results } = await env.DB.prepare('SELECT id, name, email, role, created_at FROM users LIMIT 50').all();
  return json({ data: results || [] });
}

export async function handleInviteUser(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as any;
  const email = sanitizeInput(body.email);
  const role = sanitizeInput(body.role) || 'agent';
  const name = sanitizeInput(body.name) || email?.split('@')[0];

  if (!email || !email.includes('@')) {
    return json({ error: 'Email invalide' }, 400);
  }

  // Vérifier si l'utilisateur existe déjà
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    return json({ error: 'Cet utilisateur existe déjà' }, 400);
  }

  const id = crypto.randomUUID();
  // On insère l'utilisateur avec un statut "pending" (ici symbolisé par l'absence de mot de passe)
  await env.DB.prepare(
    'INSERT INTO users (id, name, email, role, password_hash) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, name, email, role, 'PENDING_INVITE').run();

  // Mock envoi d'email via Resend
  console.log(`[Resend Mock] Invitation envoyée à ${email} pour le rôle ${role}`);

  return json({ data: { success: true, message: 'Invitation envoyée avec succès' } }, 201);
}

export async function handleUpdateUserRole(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.pathname.split('/').pop() || '';
  const body = await request.json() as any;
  const newRole = sanitizeInput(body.role);

  if (!newRole) return json({ error: 'Rôle manquant' }, 400);

  await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(newRole, userId).run();
  return json({ data: { success: true } });
}

export async function handleDeleteUser(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.pathname.split('/').pop() || '';
  
  // Hard delete pour le MVP.
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
  return json({ data: { success: true } });
}

// Custom Roles MVP (Mock / Database table optionnelle)
export async function handleGetRoles(_request: Request, _env: Env): Promise<Response> {
  // Mock data car la gestion poussée des permissions est complexe
  const roles = [
    { id: 'admin', name: 'Administrateur', description: 'Accès complet', is_system: true },
    { id: 'broker', name: 'Courtier', description: 'Accès aux leads et pipelines', is_system: true },
    { id: 'agent', name: 'Agent', description: 'Accès restreint aux conversations', is_system: true },
    { id: 'custom_1', name: 'Manager Marketing', description: 'Gère les workflows et templates', is_system: false },
  ];
  return json({ data: roles });
}
