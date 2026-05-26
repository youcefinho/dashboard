// ── TeamSettings — Sprint 23 W32 : cards row-premium + Avatar + Select premium + DropdownMenu + KpiStrip
// ── Sprint 26 vague 26-3A — bouton "Inviter membres" CTA déclenche <Wizard> 3 steps (Membres / Rôles / Invitations)
// ── LOT TEAM A (Phase B / M2) — câblage RÉEL : fetch via helpers api.ts
//    (auth + X-Sub-Account injectés, fini les `fetch` bruts sans header) ;
//    re-fetch après chaque mutation ; sélecteur rôle générique (4 rôles via
//    GET /team/roles) + scope agency|subaccount + sélecteur sous-compte ;
//    mapping générique→technique VERROUILLÉ pour PATCH ; last_login_at réel ;
//    toasts sur revoke/resend/delete. Aucun état optimiste mock.
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Card,
  Button,
  Input,
  Select,
  Tag,
  Avatar,
  AvatarGroup,
  KpiStrip,
  EmptyState,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Textarea,
  Wizard,
  type WizardStep,
  Icon,
} from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/lib/i18n';
import {
  getTeamUsers,
  getTeamRoles,
  inviteTeamMember,
  revokeTeamInvite,
  resendTeamInvite,
  updateTeamUserRole,
  deleteTeamUser,
  getClients,
  getTeamInvites,
  type TeamUser,
  type TeamRole,
  type TeamInvite,
} from '@/lib/api';
import type { Client } from '@/lib/types';
import {
  Users,
  Shield,
  UserCog,
  MoreVertical,
  Pencil,
  Ban,
  Trash2,
  UserPlus,
  Mail,
  Send,
  Plus,
  X,
  Sparkles,
} from 'lucide-react';

// ── Rôles génériques (contrat figé LOT-TEAM-A §6.B) ──────────
type GenericRole = 'owner' | 'manager' | 'member' | 'viewer';
type Scope = 'agency' | 'subaccount';

// Mapping générique → technique VERROUILLÉ (LOT-TEAM-A "Mapping rôles").
// Le PATCH /team/users/:id attend le rôle TECHNIQUE.
const GENERIC_TO_TECH: Record<GenericRole, string> = {
  owner: 'admin',
  manager: 'broker',
  member: 'store_manager',
  viewer: 'store_manager',
};

// Mapping technique → générique (best-effort affichage si role_generic null).
const TECH_TO_GENERIC: Record<string, GenericRole> = {
  admin: 'owner',
  broker: 'manager',
  store_manager: 'member',
};

const GENERIC_ROLE_LABEL: Record<GenericRole, string> = {
  owner: t('team.roles.owner'),
  manager: t('team.roles.manager'),
  member: t('team.roles.member'),
  viewer: t('team.roles.viewer'),
};

// Rôle générique effectif d'un user (role_generic prioritaire, sinon dérivé
// du rôle technique, sinon 'member' par défaut sûr).
function effectiveGeneric(u: TeamUser): GenericRole {
  if (u.role_generic && u.role_generic in GENERIC_ROLE_LABEL) {
    return u.role_generic as GenericRole;
  }
  return TECH_TO_GENERIC[u.role] || 'member';
}

// Formatage last_login_at (lecture seule, fr-CA). null → tiret, PAS de
// fausse valeur. Pas d'import src/lib/i18n/* (zone M3 exclusive).
function formatLastLogin(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface PendingInvite {
  id: string;
  email: string;
  role: GenericRole;
}

export function TeamSettings() {
  const toast = useToast();
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [roles, setRoles] = useState<TeamRole[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  // LOT TEAM B (§6.B) — vraie liste serveur des invitations (GET /team/invites)
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<GenericRole>('member');
  const [newScope, setNewScope] = useState<Scope>('agency');
  const [newClientId, setNewClientId] = useState('');
  const [scopeError, setScopeError] = useState('');
  const [inviting, setInviting] = useState(false);

  // ── Sprint 26 vague 26-3A — wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [pendingEmail, setPendingEmail] = useState('');
  const [pendingRole, setPendingRole] = useState<GenericRole>('member');
  const [wizardScope, setWizardScope] = useState<Scope>('agency');
  const [wizardClientId, setWizardClientId] = useState('');
  const [inviteMessage, setInviteMessage] = useState(
    "Bonjour,\n\nJe t'invite à rejoindre notre équipe sur Intralys CRM. Tu auras accès à nos pipelines et pourras collaborer en temps réel.\n\nÀ bientôt !"
  );

  // Liste des rôles génériques effective (API → fallback aux 4 figés).
  const roleKeys = useMemo<GenericRole[]>(() => {
    const fromApi = roles
      .map((r) => r.id || r.name)
      .filter((id): id is GenericRole => id in GENERIC_ROLE_LABEL);
    return fromApi.length > 0 ? fromApi : (['owner', 'manager', 'member', 'viewer'] as GenericRole[]);
  }, [roles]);

  // ── Fetch RÉEL (helpers api.ts → apiFetch, auth + tenant injectés) ──
  const refreshUsers = useCallback(async () => {
    const res = await getTeamUsers();
    if (res.data) setUsers(res.data);
  }, []);

  // LOT TEAM B (§6.B) — invitations en attente (status pending) du tenant.
  // apiFetch GELÉ (§6.A) : discrimination sur absence de `data`, jamais `code`.
  const refreshInvites = useCallback(async () => {
    const res = await getTeamInvites();
    if (res.data) {
      setInvites(res.data.filter((i) => i.status === 'pending'));
    }
  }, []);

  useEffect(() => {
    void refreshUsers();
    void refreshInvites();
    void getTeamRoles().then((r) => { if (r.data) setRoles(r.data); });
    // Sous-comptes accessibles = liste clients du tenant courant (même
    // source que le reste de l'app, tenant-scoped via apiFetch). Pas
    // d'endpoint dédié inventé.
    void getClients().then((c) => { if (c.data) setClients(c.data); });
  }, [refreshUsers, refreshInvites]);

  // ── Invitation rapide (modale) ──────────────────────────────
  const inviteUser = async () => {
    setScopeError('');
    if (!newEmail.trim()) return;
    if (newScope === 'subaccount' && !newClientId) {
      setScopeError(t('team.invite.error_scope'));
      return;
    }
    setInviting(true);
    const res = await inviteTeamMember({
      email: newEmail.trim(),
      role: newRole,
      ...(newName.trim() ? { name: newName.trim() } : {}),
      scope: newScope,
      ...(newScope === 'subaccount' ? { client_id: newClientId } : {}),
    });
    setInviting(false);

    if (res.data && res.data.success) {
      toast.success(t('team.invite.success'));
      setShowInviteModal(false);
      setNewEmail('');
      setNewName('');
      setNewRole('member');
      setNewScope('agency');
      setNewClientId('');
      // Re-fetch (un compte peut être créé côté serveur à l'acceptation —
      // ici l'invitation seule n'ajoute pas d'utilisateur, mais on garde
      // la liste cohérente après toute mutation).
      void refreshUsers();
      void refreshInvites();
      return;
    }

    // Mapping erreur sur le `error` string (apiFetch DROP le `code`,
    // contrainte figée api.ts:103-105 — cf. Signup.tsx).
    const msg = ((res as { error?: string }).error || '').toLowerCase();
    if (msg.includes('sous-compte')) {
      setScopeError(t('team.invite.error_scope'));
    } else if (msg.includes('existe déjà')) {
      toast.error(t('team.invite.error_exists'));
    } else if (msg.includes('email')) {
      toast.error(t('team.invite.error_email'));
    } else {
      toast.error(t('team.invite.error_email'));
    }
  };

  // ── Changement de rôle utilisateur (générique → technique) ──
  const changeUserRole = async (u: TeamUser, generic: GenericRole) => {
    const res = await updateTeamUserRole(u.id, GENERIC_TO_TECH[generic]);
    if (res.data && res.data.success) {
      toast.success(t('team.users.role_label'));
      void refreshUsers();
      return;
    }
    const msg = ((res as { error?: string }).error || '').toLowerCase();
    if (msg.includes('introuvable')) {
      toast.error(t('team.users.not_found'));
    } else {
      toast.error(t('team.users.not_found'));
    }
  };

  const removeUser = async (id: string) => {
    const res = await deleteTeamUser(id);
    if (res.data && res.data.success) {
      toast.success(t('team.users.delete'));
      void refreshUsers();
      return;
    }
    // code:'NOT_FOUND' 404 → hors périmètre tenant (apiFetch DROP le code,
    // on mappe sur le message 'Utilisateur introuvable').
    toast.error(t('team.users.not_found'));
  };

  // ── Revoke / Resend invitation ──────────────────────────────
  // LOT TEAM B (§6.B) : GET /team/invites expose désormais la vraie liste
  // serveur des invitations pending avec leur `id`. revoke/resend sont
  // câblés sur ces ids RÉELS (plus aucun id fabriqué). apiFetch GELÉ
  // (§6.A) : succès = présence de `res.data.success`.
  const revokeInvite = async (id: string) => {
    const res = await revokeTeamInvite(id);
    if (res.data && res.data.success) {
      toast.success(t('team.invite.revoked'));
      void refreshInvites();
    } else {
      toast.error(t('team.invite.error_email'));
    }
  };

  const resendInvite = async (id: string) => {
    const res = await resendTeamInvite(id);
    if (res.data && res.data.success) {
      toast.success(t('team.invite.resent'));
      void refreshInvites();
    } else {
      toast.error(t('team.invite.error_email'));
    }
  };

  // ── Sprint 26 vague 26-3A — wizard handlers
  const openWizard = () => {
    setPendingInvites([]);
    setPendingEmail('');
    setPendingRole('member');
    setWizardScope('agency');
    setWizardClientId('');
    setWizardStep(0);
    setWizardOpen(true);
  };

  const addPendingInvite = () => {
    const trimmed = pendingEmail.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return;
    if (pendingInvites.some((i) => i.email.toLowerCase() === trimmed.toLowerCase())) return;
    setPendingInvites([
      ...pendingInvites,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, email: trimmed, role: pendingRole },
    ]);
    setPendingEmail('');
  };

  const removePendingInvite = (id: string) => {
    setPendingInvites(pendingInvites.filter((i) => i.id !== id));
  };

  const updateInviteRole = (id: string, role: GenericRole) => {
    setPendingInvites(pendingInvites.map((i) => (i.id === id ? { ...i, role } : i)));
  };

  const sendAllInvites = async () => {
    const results = await Promise.all(
      pendingInvites.map((inv) =>
        inviteTeamMember({
          email: inv.email,
          role: inv.role,
          message: inviteMessage,
          scope: wizardScope,
          ...(wizardScope === 'subaccount' && wizardClientId ? { client_id: wizardClientId } : {}),
        })
      )
    );
    const ok = results.filter((r) => r.data && r.data.success).length;
    const failed = results.length - ok;
    if (ok > 0) toast.success(`${ok} ${t('team.invite.success')}`);
    if (failed > 0) toast.error(`${failed} ${t('team.invite.error_email')}`);
    void refreshUsers();
    void refreshInvites();
    setWizardOpen(false);
    setPendingInvites([]);
    setWizardStep(0);
  };

  // ── Sprint 26 vague 26-3A — steps definition (memo)
  const wizardSteps: WizardStep[] = useMemo(
    () => [
      {
        id: 'members',
        label: t('set.team.members_step'),
        icon: <Icon as={Users} size={14} />,
        isValid: () => pendingInvites.length > 0,
        content: (
          <div className="space-y-5">
            <div className="flex items-start gap-3 p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
              <div className="p-2 rounded-lg bg-[var(--brand-tint)] text-[var(--primary)] shrink-0">
                <UserPlus size={16} />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">{t('set.team.add_collab')}</h4>
                <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
                  {t('set.team.add_collab_desc')}
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="prenom@entreprise.com"
                value={pendingEmail}
                onChange={(e) => setPendingEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addPendingInvite();
                  }
                }}
                containerClassName="flex-1"
              />
              <Button
                onClick={addPendingInvite}
                leftIcon={<Plus size={14} />}
                disabled={!pendingEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pendingEmail.trim())}
              >
                {t('set.team.add')}
              </Button>
            </div>

            {/* Scope d'invitation (agency défaut | subaccount) */}
            <div className="grid grid-cols-2 gap-3">
              <Select
                label={t('team.invite.scope_label')}
                value={wizardScope}
                onChange={(e) => setWizardScope(e.target.value as Scope)}
              >
                <option value="agency">{t('team.invite.scope_agency')}</option>
                <option value="subaccount">{t('team.invite.scope_subaccount')}</option>
              </Select>
              {wizardScope === 'subaccount' && (
                <Select
                  label={t('team.invite.subaccount_label')}
                  value={wizardClientId}
                  onChange={(e) => setWizardClientId(e.target.value)}
                >
                  <option value="">—</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              )}
            </div>

            {pendingInvites.length === 0 ? (
              <div className="text-center py-8 px-4 rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-subtle)]">
                <Mail size={28} className="mx-auto text-[var(--text-muted)] mb-2" />
                <p className="text-sm text-[var(--text-muted)]">{t('set.team.no_pending')}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">{t('set.team.add_email')}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                  {pendingInvites.length} {pendingInvites.length > 1 ? t('set.team.invitations') : t('set.team.invitation')} {t('set.team.pending')}
                </p>
                {pendingInvites.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center gap-3 p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]"
                  >
                    <Avatar size="sm" name={inv.email} />
                    <span className="text-sm text-[var(--text-primary)] truncate flex-1">{inv.email}</span>
                    <Tag dot variant={inv.role === 'owner' ? 'brand' : 'info'} size="sm">
                      {GENERIC_ROLE_LABEL[inv.role]}
                    </Tag>
                    <button
                      type="button"
                      onClick={() => removePendingInvite(inv.id)}
                      className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
                      aria-label={t('team.invite.action_revoke')}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'roles',
        label: t('set.team.roles_step'),
        icon: <Icon as={Shield} size={14} />,
        isValid: () => pendingInvites.length > 0,
        content: (
          <div className="space-y-5">
            <div className="flex items-start gap-3 p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
              <div className="p-2 rounded-lg bg-[var(--brand-tint)] text-[var(--primary)] shrink-0">
                <Shield size={16} />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">{t('set.team.assign_role')}</h4>
                <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
                  {t('set.team.assign_role_desc')}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {pendingInvites.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]"
                >
                  <Avatar size="sm" name={inv.email} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{inv.email}</p>
                  </div>
                  <Select
                    value={inv.role}
                    onChange={(e) => updateInviteRole(inv.id, e.target.value as GenericRole)}
                    className="w-[170px] shrink-0"
                  >
                    {roleKeys.map((rk) => (
                      <option key={rk} value={rk}>{GENERIC_ROLE_LABEL[rk]}</option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          </div>
        ),
      },
      {
        id: 'invitations',
        label: t('set.team.invitations_step'),
        icon: <Icon as={Send} size={14} />,
        isOptional: false,
        isValid: () => inviteMessage.trim().length > 0 && pendingInvites.length > 0,
        content: (
          <div className="space-y-5">
            <div className="flex items-start gap-3 p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
              <div className="p-2 rounded-lg bg-[var(--brand-tint)] text-[var(--primary)] shrink-0">
                <Sparkles size={16} />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">{t('set.team.custom_msg')}</h4>
                <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
                  {t('set.team.custom_msg_desc')}
                </p>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5 block">
                {t('set.team.your_msg')}
              </label>
              <Textarea
                value={inviteMessage}
                onChange={(e) => setInviteMessage(e.target.value)}
                className="h-[110px]"
                maxLength={500}
                showCounter
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5 block">
                {t('set.team.email_preview')}
              </label>
              <div className="settings-email-preview">
                <div className="settings-email-preview__head">
                  <div className="settings-email-preview__brandchip">IL</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold text-[var(--text-primary)] truncate">
                      {t('set.team.invite_subject')}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)]">de Intralys &lt;noreply@intralys.com&gt;</p>
                  </div>
                </div>
                <div className="settings-email-preview__body">
                  {inviteMessage || <span className="italic text-[var(--text-muted)]">{t('set.team.msg_placeholder')}</span>}
                </div>
                <div className="settings-email-preview__cta-wrap">
                  <span className="settings-email-preview__cta">
                    {t('set.team.accept_invite')}
                  </span>
                </div>
              </div>
            </div>

            <div className="settings-info-banner settings-info-banner--primary">
              <div>
                <p className="settings-info-banner__title">
                  {pendingInvites.length} {pendingInvites.length > 1 ? 'courriels' : 'courriel'} à envoyer
                </p>
                <p className="settings-info-banner__body">
                  {pendingInvites.map((i) => i.email).join(', ')}
                </p>
              </div>
            </div>
          </div>
        ),
      },
    ],
    [pendingInvites, pendingEmail, inviteMessage, roleKeys, wizardScope, wizardClientId, clients]
  );

  const kpiItems = useMemo(() => {
    const owners = users.filter((u) => effectiveGeneric(u) === 'owner').length;
    const managers = users.filter((u) => effectiveGeneric(u) === 'manager').length;
    const members = users.filter((u) => {
      const g = effectiveGeneric(u);
      return g === 'member' || g === 'viewer';
    }).length;
    return [
      { label: t('set.team.total_users'), value: users.length, color: 'brand' as const, icon: <Users size={12} /> },
      { label: t('team.roles.owner'), value: owners, color: 'accent' as const, icon: <Shield size={12} /> },
      { label: t('team.roles.manager'), value: managers, color: 'info' as const },
      { label: t('team.roles.member'), value: members, color: 'neutral' as const, icon: <UserCog size={12} /> },
    ];
  }, [users]);

  return (
    <div className="space-y-6">
      <KpiStrip items={kpiItems} />

      <Card className="settings-card p-6">
        <header className="settings-section-header settings-section-header--with-action">
          <div className="flex items-center gap-3 min-w-0">
            <div>
              <h3 className="t-h3">{t('set.team.title')}</h3>
              <p className="t-caption text-[var(--gray-500)]">{t('set.team.subtitle')}</p>
            </div>
            {users.length > 0 && (
              <AvatarGroup
                avatars={users.map((u) => ({ name: u.name || u.email }))}
                max={5}
                size="md"
                onClick={() => setShowInviteModal(true)}
                aria-label={`${users.length} membres dans l'équipe`}
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowInviteModal(true)} leftIcon={<Icon as={UserPlus} size={14} />}>
              {t('set.team.invite')}
            </Button>
            <Button variant="primary" size="sm" onClick={openWizard} leftIcon={<Icon as={Sparkles} size={14} />}>
              {t('set.team.invite_assisted')}
            </Button>
          </div>
        </header>

        {users.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={<Users size={32} />}
            title={t('set.team.no_member')}
            description={t('set.team.no_member_desc')}
            action={
              <Button onClick={openWizard} leftIcon={<UserPlus size={14} />} variant="primary">
                {t('set.team.invite')}
              </Button>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {users.map((u, idx) => {
              const displayName = u.name || u.email.split('@')[0] || u.email;
              const generic = effectiveGeneric(u);
              return (
                <div
                  key={u.id}
                  className="row-premium list-item-enter flex items-center gap-3 p-3 rounded-xl"
                  style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'both' }}
                >
                  <Avatar size="sm" name={displayName} ring={generic === 'owner' ? 'active' : 'none'} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{displayName}</p>
                    <p className="text-[11px] text-[var(--text-muted)] truncate">{u.email}</p>
                  </div>
                  <div className="hidden sm:block">
                    <Select
                      value={generic}
                      onChange={(e) => void changeUserRole(u, e.target.value as GenericRole)}
                      className="w-[150px]"
                      aria-label={t('team.users.role_label')}
                    >
                      {roleKeys.map((rk) => (
                        <option key={rk} value={rk}>{GENERIC_ROLE_LABEL[rk]}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="hidden md:block text-xs text-[var(--text-muted)] min-w-[110px] text-right" title={t('team.users.last_login')}>
                    {formatLastLogin(u.last_login_at)}
                  </div>
                  <DropdownMenu
                    trigger={
                      <button
                        type="button"
                        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
                        aria-label="Actions"
                      >
                        <MoreVertical size={16} />
                      </button>
                    }
                  >
                    <DropdownMenuItem leftIcon={<Pencil size={14} />}>{t('set.team.edit')}</DropdownMenuItem>
                    <DropdownMenuItem leftIcon={<Ban size={14} />}>{t('set.team.disable')}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="danger"
                      leftIcon={<Trash2 size={14} />}
                      onSelect={() => void removeUser(u.id)}
                    >
                      {t('team.users.delete')}
                    </DropdownMenuItem>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── LOT TEAM B (§6.B) — invitations en attente RÉELLES (serveur) ── */}
      {invites.length > 0 && (
        <Card className="settings-card p-6">
          <header className="settings-section-header">
            <div>
              <h3 className="t-h3 flex items-center gap-2">
                <Icon as={Mail} size={16} className="text-[var(--primary)]" />{' '}
                {t('team.invite.pending_title')}
              </h3>
            </div>
          </header>
          <div className="space-y-2.5">
            {invites.map((inv, idx) => (
              <div
                key={inv.id}
                className="row-premium list-item-enter flex items-center gap-3 p-3 rounded-xl"
                style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'both' }}
              >
                <Avatar size="sm" name={inv.email} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {inv.email}
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)] truncate">
                    {formatLastLogin(inv.expires_at)}
                  </p>
                </div>
                <Tag
                  dot
                  variant={inv.role === 'owner' ? 'brand' : 'info'}
                  size="sm"
                >
                  {GENERIC_ROLE_LABEL[
                    (inv.role in GENERIC_ROLE_LABEL
                      ? inv.role
                      : 'member') as GenericRole
                  ]}
                </Tag>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void resendInvite(inv.id)}
                  leftIcon={<Icon as={Send} size={14} />}
                >
                  {t('team.invite.action_resend')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void revokeInvite(inv.id)}
                  leftIcon={<Icon as={Ban} size={14} />}
                >
                  {t('team.invite.action_revoke')}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Mode existant : modale rapide pour un seul invité */}
      <Modal open={showInviteModal} onOpenChange={() => setShowInviteModal(false)} title={t('team.invite.title')}>
        <div className="space-y-3">
          <Input
            label={t('team.invite.email_label')}
            placeholder="prenom@entreprise.com"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <Input
            label={t('team.invite.name_label')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Select
            label={t('team.invite.role_label')}
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as GenericRole)}
          >
            {roleKeys.map((rk) => (
              <option key={rk} value={rk}>{GENERIC_ROLE_LABEL[rk]}</option>
            ))}
          </Select>
          <Select
            label={t('team.invite.scope_label')}
            value={newScope}
            onChange={(e) => { setNewScope(e.target.value as Scope); setScopeError(''); }}
          >
            <option value="agency">{t('team.invite.scope_agency')}</option>
            <option value="subaccount">{t('team.invite.scope_subaccount')}</option>
          </Select>
          {newScope === 'subaccount' && (
            <Select
              label={t('team.invite.subaccount_label')}
              value={newClientId}
              onChange={(e) => { setNewClientId(e.target.value); setScopeError(''); }}
              error={scopeError || undefined}
            >
              <option value="">—</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          )}
          {scopeError && newScope !== 'subaccount' && (
            <p className="text-xs text-[var(--danger)]">{scopeError}</p>
          )}
          <Button
            className="w-full"
            onClick={() => void inviteUser()}
            disabled={!newEmail || inviting}
            isLoading={inviting}
          >
            {t('team.invite.submit')}
          </Button>
        </div>
      </Modal>

      {/* ── Sprint 26 vague 26-3A — Wizard d'onboarding nouveau membre (3 steps) ── */}
      <Wizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        title={t('set.team.wizard_title')}
        description={t('set.team.wizard_desc')}
        steps={wizardSteps}
        currentIndex={wizardStep}
        onStepChange={setWizardStep}
        onComplete={sendAllInvites}
        onCancel={() => {
          setWizardStep(0);
          setPendingInvites([]);
        }}
        persistKey="team-invite"
        completeLabel={`Envoyer ${pendingInvites.length || ''} invitation${pendingInvites.length > 1 ? 's' : ''}`.trim()}
      />
    </div>
  );
}
