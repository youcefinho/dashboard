// ── TeamSettings — Sprint 23 W32 : cards row-premium + Avatar + Select premium + DropdownMenu + KpiStrip
// ── Sprint 26 vague 26-3A — bouton "Inviter membres" CTA déclenche <Wizard> 3 steps (Membres / Rôles / Invitations)
import { useState, useEffect, useMemo } from 'react';
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
import { t } from '@/lib/i18n';
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

type RoleKey = 'admin' | 'broker' | 'agent';

interface PendingInvite {
  id: string;
  email: string;
  role: RoleKey;
}

const ROLE_LABEL: Record<RoleKey, string> = {
  admin: t('set.team.admin'),
  broker: t('set.team.broker'),
  agent: t('set.team.agent_limited'),
};

const ROLE_DESCRIPTION: Record<RoleKey, string> = {
  admin: t('set.team.admin_desc'),
  broker: t('set.team.broker_desc'),
  agent: t('set.team.agent_desc'),
};

export function TeamSettings() {
  const [users, setUsers] = useState<any[]>([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('agent');

  // ── Sprint 26 vague 26-3A — wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [pendingEmail, setPendingEmail] = useState('');
  const [pendingRole, setPendingRole] = useState<RoleKey>('agent');
  const [inviteMessage, setInviteMessage] = useState(
    "Bonjour,\n\nJe t'invite à rejoindre notre équipe sur Intralys CRM. Tu auras accès à nos pipelines et pourras collaborer en temps réel.\n\nÀ bientôt !"
  );

  useEffect(() => {
    fetch('/api/team/users')
      .then((res) => res.json())
      .then((data: any) => setUsers(data.data || []));
  }, []);

  const inviteUser = async () => {
    const res = await fetch('/api/team/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newEmail, role: newRole }),
    });
    if (res.ok) {
      setShowInviteModal(false);
      setNewEmail('');
      setUsers([
        { id: Date.now().toString(), email: newEmail, role: newRole, created_at: new Date().toISOString() },
        ...users,
      ]);
    }
  };

  const removeUser = async (id: string) => {
    await fetch(`/api/team/users/${id}`, { method: 'DELETE' });
    setUsers(users.filter((u) => u.id !== id));
  };

  // ── Sprint 26 vague 26-3A — wizard handlers
  const openWizard = () => {
    setPendingInvites([]);
    setPendingEmail('');
    setPendingRole('agent');
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

  const updateInviteRole = (id: string, role: RoleKey) => {
    setPendingInvites(pendingInvites.map((i) => (i.id === id ? { ...i, role } : i)));
  };

  const sendAllInvites = async () => {
    try {
      await Promise.all(
        pendingInvites.map((inv) =>
          fetch('/api/team/invites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: inv.email, role: inv.role, message: inviteMessage }),
          })
        )
      );
      setUsers([
        ...pendingInvites.map((inv) => ({
          id: inv.id,
          email: inv.email,
          role: inv.role,
          created_at: new Date().toISOString(),
        })),
        ...users,
      ]);
    } catch {
      /* swallow — UI feedback via toast pourrait être ajouté */
    } finally {
      setWizardOpen(false);
      setPendingInvites([]);
      setWizardStep(0);
    }
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
                    <Tag dot variant={inv.role === 'admin' ? 'brand' : 'info'} size="sm">
                      {ROLE_LABEL[inv.role]}
                    </Tag>
                    <button
                      type="button"
                      onClick={() => removePendingInvite(inv.id)}
                      className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
                      aria-label={t('set.team.remove_invite')}
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
                    <p className="text-[11px] text-[var(--text-muted)] truncate">{ROLE_DESCRIPTION[inv.role]}</p>
                  </div>
                  <Select
                    value={inv.role}
                    onChange={(e) => updateInviteRole(inv.id, e.target.value as RoleKey)}
                    className="w-[170px] shrink-0"
                  >
                    <option value="admin">{t('set.team.admin')}</option>
                    <option value="broker">{t('set.team.broker')}</option>
                    <option value="agent">{t('set.team.agent_limited')}</option>
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
    [pendingInvites, pendingEmail, pendingRole, inviteMessage]
  );

  const kpiItems = useMemo(() => {
    const admins = users.filter((u) => u.role === 'admin').length;
    const agents = users.filter((u) => u.role === 'agent').length;
    const brokers = users.filter((u) => u.role === 'broker').length;
    return [
      { label: t('set.team.total_users'), value: users.length, color: 'brand' as const, icon: <Users size={12} /> },
      { label: t('set.team.admin'), value: admins, color: 'accent' as const, icon: <Shield size={12} /> },
      { label: t('set.team.broker'), value: brokers, color: 'info' as const },
      { label: t('set.team.agent_limited'), value: agents, color: 'neutral' as const, icon: <UserCog size={12} /> },
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
                avatars={users.map((u) => ({ name: u.name || u.email, src: u.avatar_url }))}
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
              const displayName = u.name || u.email.split('@')[0];
              return (
                <div
                  key={u.id}
                  className="row-premium list-item-enter flex items-center gap-3 p-3 rounded-xl"
                  style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'both' }}
                >
                  <Avatar size="sm" name={displayName} ring={u.role === 'admin' ? 'active' : 'none'} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{displayName}</p>
                    <p className="text-[11px] text-[var(--text-muted)] truncate">{u.email}</p>
                  </div>
                  <div className="hidden sm:block">
                    <Tag dot variant={u.role === 'admin' ? 'brand' : 'info'} size="sm">
                      {u.role}
                    </Tag>
                  </div>
                  <div className="hidden md:block text-xs text-[var(--text-muted)] min-w-[110px] text-right">
                    Il y a 2 jours
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
                      onSelect={() => removeUser(u.id)}
                    >
                      {t('set.team.remove')}
                    </DropdownMenuItem>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Mode existant : modale rapide pour un seul invité */}
      <Modal open={showInviteModal} onOpenChange={() => setShowInviteModal(false)} title={t('set.team.invite_modal')}>
        <div className="space-y-3">
          <Input placeholder="Email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          <Select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            <option value="admin">{t('set.team.admin')}</option>
            <option value="broker">{t('set.team.broker')}</option>
            <option value="agent">{t('set.team.agent_limited')}</option>
          </Select>
          <Button className="w-full" onClick={inviteUser} disabled={!newEmail}>
            {t('set.team.send_invite')}
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
