// ── PortalSettings — config PRO du portail client (LOT PORTAL-E, Sprint E) ──
//
// Corps réel Phase C Manager-C. L'export nommé `PortalSettingsPage` est FIGÉ
// (App.tsx GELÉ le lazy-importe — route PROTÉGÉE `/portal-settings`, sous
// LazyGuard, calque EXACT coursesAdminRoute / bookingSettingsRoute).
//
// Calque le pattern des pages PRO existantes (CoursesAdmin.tsx) : auth CRM
// (apiFetch — capability 'billing.view' enforced côté worker), helpers api
// FIGÉS Phase A (getPortalSites / createPortalSite / getPortalUsers /
// invitePortalUser), discrimination erreur = absence `data` / champ `error`
// (JAMAIS de `code`). i18n 100% t('portal.*') (clés FIGÉES Phase A — AUCUNE
// création Phase C). L'admin crée un portail (slug → tenant) puis invite un
// client final en CHOISISSANT un lead (provisioning — pas d'auto-inscription) :
// crée portal_users + lien set-password. AUCUNE logique de paiement (E4 jamais).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  Button,
  Card,
  Tag,
  Modal,
  Input,
  Select,
  Skeleton,
  EmptyState,
  useToast,
} from '@/components/ui';
import { Plus, ExternalLink, UserPlus, AlertTriangle, RefreshCw } from 'lucide-react';
import {
  getPortalSites,
  createPortalSite,
  getPortalUsers,
  invitePortalUser,
  getLeads,
  type PortalSite,
  type PortalUser,
  type Lead,
} from '@/lib/api';
import { t } from '@/lib/i18n';

export function PortalSettingsPage() {
  const { success, error: toastError } = useToast();

  const [sites, setSites] = useState<PortalSite[]>([]);
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Modales.
  const [siteOpen, setSiteOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Champ création portail.
  const [sSlug, setSSlug] = useState('');
  const [sName, setSName] = useState('');

  // Champs invitation client (provisioning par choix de lead).
  const [iLeadId, setILeadId] = useState('');
  const [iEmail, setIEmail] = useState('');
  const [iName, setIName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [sRes, uRes, lRes] = await Promise.all([
        getPortalSites(),
        getPortalUsers(),
        getLeads(),
      ]);
      // Discrimination : on consomme `data` si présent, jamais de `code`.
      if (sRes.data) setSites(sRes.data);
      if (uRes.data) setUsers(uRes.data);
      if (lRes.data) setLeads(lRes.data);
      // Si AUCUNE des 3 requêtes critiques n'a renvoyé `data` → état d'erreur global.
      if (!sRes.data && !uRes.data && !lRes.data) setLoadError(true);
    } catch {
      setLoadError(true);
    }
    setLoading(false);
  }, []);

  // Validation email basique (côté UI uniquement — worker reste source de vérité).
  const isValidEmail = useMemo(() => {
    const email = iEmail.trim();
    return email.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }, [iEmail]);
  const showEmailHint = iEmail.length > 0 && !isValidEmail;

  useEffect(() => {
    void load();
  }, [load]);

  // ── Création d'un portail (slug → tenant) ────────────────────────────────
  const handleCreateSite = useCallback(async () => {
    const slug = sSlug.trim();
    if (!slug) return;
    setBusy(true);
    const res = await createPortalSite({
      slug,
      name: sName.trim() || null,
      is_active: 1,
    });
    setBusy(false);
    if (res.error || !res.data?.id) {
      toastError(res.error || t('portal.login.error'));
      return;
    }
    setSiteOpen(false);
    setSSlug('');
    setSName('');
    success(t('portal.admin.new_site'));
    void load();
  }, [sSlug, sName, toastError, success, load]);

  // ── Invitation client (choisir un lead → provisioning portal_users) ──────
  const handleInvite = useCallback(async () => {
    const email = iEmail.trim();
    if (!iLeadId || !email || !isValidEmail) return;
    setBusy(true);
    const res = await invitePortalUser({
      lead_id: iLeadId,
      email,
      name: iName.trim() || undefined,
    });
    setBusy(false);
    if (res.error || !res.data?.id) {
      toastError(res.error || t('portal.login.error'));
      return;
    }
    setInviteOpen(false);
    setILeadId('');
    setIEmail('');
    setIName('');
    success(t('portal.admin.invite'));
    void load();
  }, [iLeadId, iEmail, iName, toastError, success, load]);

  // Pré-remplit courriel/nom à partir du lead choisi (best-effort, modifiable).
  const onPickLead = useCallback(
    (leadId: string) => {
      setILeadId(leadId);
      const lead = leads.find((l) => l.id === leadId);
      if (lead) {
        if (lead.email) setIEmail(lead.email);
        if (lead.name) setIName(lead.name);
      }
    },
    [leads],
  );

  // Bannière d'erreur globale (les 3 endpoints ont tous renvoyé sans `data`).
  if (loadError && !loading) {
    return (
      <AppLayout title={t('portal.admin.title')}>
        <EmptyState
          variant="compact"
          icon={<AlertTriangle size={32} strokeWidth={1.8} />}
          title={t('portal.admin.title')}
          description={t('portal.login.error')}
          action={
            <Button onClick={() => void load()} leftIcon={<RefreshCw size={14} />}>
              {t('action.retry')}
            </Button>
          }
        />
      </AppLayout>
    );
  }

  return (
    <AppLayout title={t('portal.admin.title')}>
      <div className="space-y-6" aria-busy={loading ? 'true' : 'false'}>
        {/* ── Portails (sites) ─────────────────────────────────────────── */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">{t('portal.admin.sites')}</h2>
            <Button
              size="sm"
              leftIcon={<Plus size={14} />}
              onClick={() => setSiteOpen(true)}
            >
              {t('portal.admin.new_site')}
            </Button>
          </div>

          {loading ? (
            <div role="status" aria-live="polite">
              <span className="sr-only">{t('common.loading')}</span>
              <Skeleton className="h-20" />
            </div>
          ) : sites.length === 0 ? (
            <EmptyState
              variant="compact"
              title={t('portal.admin.sites')}
              action={
                <Button
                  size="sm"
                  leftIcon={<Plus size={14} />}
                  onClick={() => setSiteOpen(true)}
                >
                  {t('portal.admin.new_site')}
                </Button>
              }
            />
          ) : (
            <ul className="space-y-2">
              {sites.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="truncate font-medium">
                      {s.name || s.slug}
                    </span>
                    <Tag
                      variant={s.is_active ? 'success' : 'neutral'}
                      size="xs"
                      dot
                    >
                      {s.slug}
                    </Tag>
                  </span>
                  <a
                    href={`/portal/${s.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 shrink-0"
                  >
                    <Tag variant="neutral" size="xs">
                      /portal/{s.slug}
                    </Tag>
                    <ExternalLink size={13} className="text-[var(--text-muted)]" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── Clients invités ──────────────────────────────────────────── */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">{t('portal.admin.users')}</h2>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<UserPlus size={14} />}
              onClick={() => setInviteOpen(true)}
            >
              {t('portal.admin.invite')}
            </Button>
          </div>

          {loading ? (
            <Skeleton className="h-20" />
          ) : users.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('portal.admin.empty_users')}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {users.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center justify-between gap-2 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {u.name || u.email}
                    </p>
                    {u.name && (
                      <p
                        className="text-xs truncate"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {u.email}
                      </p>
                    )}
                  </div>
                  <Tag
                    variant={u.status === 'active' ? 'success' : 'warning'}
                    size="xs"
                  >
                    {u.status}
                  </Tag>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ── Modale nouveau portail ───────────────────────────────────────── */}
      <Modal
        open={siteOpen}
        onOpenChange={setSiteOpen}
        title={t('portal.admin.new_site')}
      >
        <div className="space-y-4">
          <Input
            label={t('portal.admin.slug')}
            value={sSlug}
            onChange={(e) => setSSlug(e.target.value)}
          />
          <Input
            label={t('portal.admin.name')}
            value={sName}
            onChange={(e) => setSName(e.target.value)}
          />
          <Button
            fullWidth
            isLoading={busy}
            onClick={() => void handleCreateSite()}
          >
            {t('portal.admin.new_site')}
          </Button>
        </div>
      </Modal>

      {/* ── Modale invitation client (choix d'un lead) ───────────────────── */}
      <Modal
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title={t('portal.admin.invite')}
      >
        <div className="space-y-4">
          <Select
            label={t('portal.admin.choose_lead')}
            value={iLeadId}
            onChange={(e) => onPickLead(e.target.value)}
          >
            <option value="">—</option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name || l.email || l.id}
              </option>
            ))}
          </Select>
          <div>
            <Input
              label={t('portal.login.email')}
              type="email"
              value={iEmail}
              onChange={(e) => setIEmail(e.target.value)}
              aria-invalid={showEmailHint ? 'true' : undefined}
              aria-describedby={showEmailHint ? 'invite-email-hint' : undefined}
            />
            {showEmailHint && (
              <p id="invite-email-hint" className="mt-1 text-[12px] text-[var(--danger)]">
                {t('portal.admin.email_required')}
              </p>
            )}
          </div>
          <Input
            label={t('portal.admin.name')}
            value={iName}
            onChange={(e) => setIName(e.target.value)}
          />
          <Button
            fullWidth
            isLoading={busy}
            disabled={!iLeadId || !iEmail.trim() || !isValidEmail}
            onClick={() => void handleInvite()}
          >
            {t('portal.admin.invite')}
          </Button>
        </div>
      </Modal>
    </AppLayout>
  );
}
