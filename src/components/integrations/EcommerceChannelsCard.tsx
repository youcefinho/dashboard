// ── EcommerceChannelsCard — gestion des canaux de vente e-commerce ──────────
// Surface la config (jusque-là invisible) des canaux Shopify / WooCommerce
// exposée par l'API e-comm (M1 CRUD + strategy, M2 connect/sync/sync-log).
//
// Honnêteté UI (FLAG-AWARE) :
//  - module 'ecommerce' non activé / pas de credentials → getChannels renvoie
//    { error } sur 404 → carte affiche un état vide "non configuré", jamais un
//    crash. Aucune création n'est tentée silencieusement.
//  - connect/sync (M2) peuvent ne pas être branchés → apiFetch renvoie { error }
//    → on toast l'erreur honnêtement sans casser la liste.
//
// 100 % ADDITIF : ne consomme que les helpers FIGÉS de @/lib/api
// (getChannels / updateChannel / connectChannel / syncChannel / getChannelSyncLog).

import { useState, useEffect, useCallback } from 'react';
import {
  Card, Button, Input, SlidePanel, Tag, Icon, useToast, useConfirm,
} from '@/components/ui';
import { ShoppingBag, RefreshCw, Link2, Settings2, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  getChannels, updateChannel, connectChannel, syncChannel, getChannelSyncLog,
  type SalesChannel, type ChannelSyncLog,
} from '@/lib/api';
import { t } from '@/lib/i18n';

const TYPE_META: Record<string, { label: string; icon: string }> = {
  shopify: { label: 'Shopify', icon: '🛍️' },
  woo: { label: 'WooCommerce', icon: '🟣' },
  native: { label: 'Intralys', icon: '🏠' },
};

function syncStatusVariant(status: ChannelSyncLog['status']): 'success' | 'warning' | 'danger' {
  if (status === 'ok') return 'success';
  if (status === 'conflict') return 'warning';
  return 'danger';
}

// ── Panneau de config d'un canal : édition métadonnées + journal de sync ────
function ChannelConfigPanel({
  channel, open, onClose, onSaved,
}: {
  channel: SalesChannel;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [name, setName] = useState(channel.name);
  const [shopDomain, setShopDomain] = useState(channel.shop_domain ?? '');
  const [externalId, setExternalId] = useState(channel.external_id ?? '');
  const [active, setActive] = useState(channel.active === 1);
  const [saving, setSaving] = useState(false);

  // Journal de sync (M2) — peut renvoyer { error } si pas encore branché.
  const [logs, setLogs] = useState<ChannelSyncLog[] | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);

  // Re-synchronise les champs quand on ouvre sur un autre canal.
  useEffect(() => {
    if (!open) return;
    setName(channel.name);
    setShopDomain(channel.shop_domain ?? '');
    setExternalId(channel.external_id ?? '');
    setActive(channel.active === 1);
  }, [open, channel]);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    setLogsError(null);
    const res = await getChannelSyncLog(channel.id);
    if (res.error) {
      // Honnêteté : M2 (sync-log) non branché → état neutre, pas de crash.
      setLogs([]);
      setLogsError(res.error);
    } else {
      setLogs(res.data ?? []);
    }
    setLogsLoading(false);
  }, [channel.id]);

  useEffect(() => { if (open) void loadLogs(); }, [open, loadLogs]);

  const save = async () => {
    if (!name.trim()) { toastError(t('chanx.name_required')); return; }
    setSaving(true);
    const res = await updateChannel(channel.id, {
      name: name.trim(),
      shop_domain: shopDomain.trim() || null,
      external_id: externalId.trim() || null,
      active,
    });
    setSaving(false);
    if (res.error) { toastError(res.error); return; }
    success(t('chanx.saved'));
    onSaved();
    onClose();
  };

  const meta = TYPE_META[channel.type] ?? { label: channel.type, icon: '🔌' };

  return (
    <SlidePanel
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={`${meta.icon} ${channel.name}`}
      size="lg"
      description={t('chanx.panel_desc')}
    >
      <div className="space-y-6">
        {/* Édition des métadonnées du canal */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">{t('chanx.config_title')}</h4>
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">{t('chanx.field_name')}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={meta.label} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">{t('chanx.field_shop_domain')}</label>
              <Input
                value={shopDomain}
                onChange={(e) => setShopDomain(e.target.value)}
                placeholder={channel.type === 'shopify' ? 'ma-boutique.myshopify.com' : 'https://ma-boutique.com'}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">{t('chanx.field_external_id')}</label>
              <Input value={externalId} onChange={(e) => setExternalId(e.target.value)} placeholder="gid://shopify/Shop/123" />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="rounded border-[var(--border-subtle)]"
            />
            {t('chanx.field_active')}
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose}>{t('chanx.cancel')}</Button>
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? t('chanx.saving') : t('chanx.save')}
            </Button>
          </div>
        </div>

        {/* Journal de synchronisation */}
        <div className="border-t border-[var(--border-subtle)] pt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold">{t('chanx.synclog_title')}</h4>
            <Button variant="ghost" size="sm" onClick={() => void loadLogs()} disabled={logsLoading}>
              <Icon as={RefreshCw} size={12} /> {t('chanx.refresh')}
            </Button>
          </div>
          {logsLoading ? (
            <p className="text-xs text-[var(--text-muted)]" aria-busy="true">{t('chanx.loading')}</p>
          ) : logsError ? (
            // Honnêteté : sync-log indispo → message neutre (M2 pas branché).
            <p className="text-xs text-[var(--text-muted)]">{t('chanx.synclog_unavailable')}</p>
          ) : !logs || logs.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">{t('chanx.synclog_empty')}</p>
          ) : (
            <ul className="space-y-2">
              {logs.map((log) => (
                <li key={log.id} className="flex items-start gap-2 p-2.5 rounded-[var(--radius-md)] bg-[var(--bg-subtle)]">
                  <Tag dot size="xs" variant={syncStatusVariant(log.status)}>{log.status}</Tag>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">
                      {log.entity} · {log.direction === 'in' ? t('chanx.dir_in') : t('chanx.dir_out')}
                    </p>
                    {(log.message || log.conflict) && (
                      <p className="text-[10px] text-[var(--text-muted)] truncate">{log.conflict || log.message}</p>
                    )}
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)] shrink-0">{log.created_at}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SlidePanel>
  );
}

export function EcommerceChannelsCard() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const [channels, setChannels] = useState<SalesChannel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SalesChannel | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getChannels();
    if (res.error) {
      // Honnêteté FLAG-AWARE : module non activé (404) → état "non configuré"
      // plutôt qu'une bannière d'erreur bruyante. On garde channels = [] afin
      // d'afficher l'empty state. On retient l'erreur pour le mode debug only
      // si elle n'est pas un simple "non disponible".
      setChannels([]);
      // On ne traite comme une vraie erreur (role=alert) que si ce n'est pas un
      // 404 / not-found classique de module désactivé.
      const e = res.error.toLowerCase();
      if (!e.includes('not found') && !e.includes('404') && !e.includes('not_configured') && !e.includes('disabled')) {
        setError(res.error);
      }
    } else {
      setChannels(res.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const doConnect = async (ch: SalesChannel) => {
    setBusyId(ch.id);
    const res = await connectChannel(ch.id);
    setBusyId(null);
    if (res.error || !res.data?.redirect_url) {
      toastError(res.error || t('chanx.connect_unavailable'));
      return;
    }
    window.location.href = res.data.redirect_url;
  };

  const doSync = async (ch: SalesChannel) => {
    const ok = await confirm({
      title: t('chanx.sync_confirm_title'),
      description: t('chanx.sync_confirm_desc', { name: ch.name }),
      confirmLabel: t('chanx.sync_now'),
    });
    if (!ok) return;
    setBusyId(ch.id);
    const res = await syncChannel(ch.id);
    setBusyId(null);
    if (res.error || !res.data) {
      toastError(res.error || t('chanx.sync_unavailable'));
      return;
    }
    const { products, orders } = res.data.synced;
    success(t('chanx.sync_done', { products: String(products), orders: String(orders) }));
    void load();
  };

  return (
    <Card className="p-4 mb-6 border-l-4 border-l-[var(--brand-cyan,var(--primary))]">
      <div className="flex items-center gap-2 mb-3">
        <Icon as={ShoppingBag} size={14} className="text-[var(--primary)]" />
        <h3 className="text-sm font-semibold">{t('chanx.title')}</h3>
        {channels && channels.length > 0 && (
          <Tag dot size="xs" variant="info">{channels.length}</Tag>
        )}
      </div>
      <p className="text-xs text-[var(--text-muted)] mb-3 max-w-prose">{t('chanx.subtitle')}</p>

      {loading ? (
        <p className="text-xs text-[var(--text-muted)]" aria-busy="true">{t('chanx.loading')}</p>
      ) : error ? (
        <div
          role="alert"
          className="p-3 rounded-[var(--radius-md)] bg-[var(--danger)]/10 text-[var(--danger)] text-xs flex items-center gap-2"
        >
          <Icon as={AlertCircle} size={13} /> {error}
        </div>
      ) : !channels || channels.length === 0 ? (
        // Empty / non configuré : pas de canal branché. On reste honnête : pas
        // de faux bouton de création si le module n'est pas exposé.
        <div className="text-center py-5 bg-[var(--bg-subtle)] rounded-[var(--radius-md)]">
          <p className="text-sm text-[var(--text-muted)]">{t('chanx.empty_title')}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">{t('chanx.empty_desc')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {channels.map((ch) => {
            const meta = TYPE_META[ch.type] ?? { label: ch.type, icon: '🔌' };
            const isActive = ch.active === 1;
            const isBusy = busyId === ch.id;
            const isExternal = ch.type === 'shopify' || ch.type === 'woo';
            return (
              <div
                key={ch.id}
                className="flex items-center justify-between gap-3 p-3 rounded-[var(--radius-md)] bg-[var(--bg-subtle)]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xl shrink-0" aria-hidden="true">{meta.icon}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">{ch.name}</p>
                    <p className="text-[10px] text-[var(--text-muted)] truncate">
                      {meta.label}
                      {ch.shop_domain ? ` · ${ch.shop_domain}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Tag dot size="xs" variant={isActive ? 'success' : 'neutral'}>
                    {isActive ? (
                      <>
                        <Icon as={CheckCircle2} size={10} /> {t('chanx.status_active')}
                      </>
                    ) : t('chanx.status_inactive')}
                  </Tag>
                  {isExternal && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => void doConnect(ch)}
                        aria-label={`${t('chanx.connect')} — ${ch.name}`}
                      >
                        <Icon as={Link2} size={12} /> {t('chanx.connect')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => void doSync(ch)}
                        aria-label={`${t('chanx.sync_now')} — ${ch.name}`}
                      >
                        <Icon as={RefreshCw} size={12} /> {t('chanx.sync_now')}
                      </Button>
                    </>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditing(ch)}
                    aria-label={`${t('chanx.configure')} — ${ch.name}`}
                  >
                    <Icon as={Settings2} size={12} /> {t('chanx.configure')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ChannelConfigPanel
          channel={editing}
          open={!!editing}
          onClose={() => setEditing(null)}
          onSaved={() => void load()}
        />
      )}
    </Card>
  );
}
