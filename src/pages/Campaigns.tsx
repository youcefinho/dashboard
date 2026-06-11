// ── Page Campaigns — Broadcasts courriel programmés + tracking (Sprint 5) ───
//
// Corps réel Phase C (Manager-C). Export FIGÉ `CampaignsPage` (consommé par
// App.tsx route /campaigns via lazy). Réutilise les helpers api.ts FIGÉS
// Phase A : sendBroadcast (étendu scheduled_at / throttle_per_min /
// filters.tags), getBroadcastHistory, getTemplates, getAllTags. Le contenu
// du courriel s'édite dans EmailBuilder EXISTANT (on cible un template via
// son id ; on lie vers /templates/builder/$templateId — rien à recréer).
// i18n 100% `t('campaign.*')` (clés figées Phase A, AUCUNE création).
// Discrimination erreur : présence `res.data` / texte `res.error`, JAMAIS
// `res.code` (§6.A apiFetch gelé). Front n'invente aucune donnée : stats
// (envoyés/ouverts/cliqués) viennent du serveur via getBroadcastHistory.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  Button,
  Card,
  Tag,
  Icon,
  Modal,
  Input,
  Select,
  Skeleton,
  EmptyState,
  Switch,
  FilterChip,
  Textarea,
  PageHero,
  useToast,
} from '@/components/ui';
import { Plus, Send, Mail, Clock, Pencil, Trash2, FlaskConical, Trophy, MessageSquare } from 'lucide-react';
import {
  sendBroadcast,
  getBroadcastHistory,
  getTemplates,
  getAllTags,
  getSegments,
  getBroadcastVariants,
  setBroadcastVariants,
} from '@/lib/api';
import type { BroadcastVariant, LeadSegment } from '@/lib/api';
import type { EmailTemplate } from '@/lib/types';
import { LEAD_STATUSES } from '@/lib/types';
import { t } from '@/lib/i18n';

// ── LOT SMS/WHATSAPP seq 104 — calcul de segments SMS (Phase C) ────────────
// GSM-7 « basique » = 160 car / segment ; dès qu'un caractère hors du jeu GSM
// est présent (emoji, certains accents/unicode), l'encodage bascule UCS-2 et
// la limite tombe à 70 car / segment. Calcul SIMPLE volontaire (le décompte
// exact de Twilio gère le header de concaténation — ici on reste informatif).
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
// Caractères GSM-7 « extension » (comptent double mais restent GSM-7).
const GSM7_EXT = "^{}\\[~]|€";

function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (GSM7_BASIC.indexOf(ch) === -1 && GSM7_EXT.indexOf(ch) === -1) return false;
  }
  return true;
}

function smsSegmentInfo(text: string): { chars: number; segments: number } {
  const chars = [...text].length;
  if (chars === 0) return { chars: 0, segments: 0 };
  const gsm = isGsm7(text);
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67; // headers de concaténation (UDH)
  const segments = chars <= single ? 1 : Math.ceil(chars / multi);
  return { chars, segments };
}

// Normalise un row d'historique (forme serveur libre — on lit défensivement,
// le front n'invente rien : valeurs absentes ⇒ 0 / '').
type HistoryRow = {
  id: string;
  subject: string;
  status: string;
  total_recipients: number;
  sent: number;
  opened: number;
  clicked: number;
  failed: number;
  scheduled_at: string | null;
  created_at: string;
  // LOT G6 — A/B : le serveur expose ab_test_enabled (0/1). Absent ⇒ 0
  // (broadcast Sprint 5 normal, aucun changement d'affichage).
  ab_test_enabled: boolean;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRow(r: Record<string, unknown>): HistoryRow {
  return {
    id: String(r.id ?? ''),
    subject: String(r.subject ?? ''),
    status: String(r.status ?? 'queued'),
    total_recipients: num(r.total_recipients ?? r.recipients),
    sent: num(r.sent),
    opened: num(r.opened),
    clicked: num(r.clicked),
    failed: num(r.failed),
    scheduled_at: r.scheduled_at != null ? String(r.scheduled_at) : null,
    created_at: String(r.created_at ?? ''),
    ab_test_enabled: num(r.ab_test_enabled ?? r.ab_test) > 0,
  };
}

// Variante en cours d'édition dans le composeur (UI). Mappée vers
// BroadcastVariant (type figé Phase A) au submit.
type DraftVariant = {
  label: string;
  subject: string;
  template_id: string;
  split_pct: number;
};

function statusVariant(
  s: string
): 'success' | 'warning' | 'neutral' | 'danger' {
  if (s === 'completed') return 'success';
  if (s === 'failed') return 'danger';
  if (s === 'processing') return 'warning';
  return 'neutral';
}

function statusLabel(s: string): string {
  switch (s) {
    case 'completed':
      return t('campaign.status_completed');
    case 'failed':
      return t('campaign.status_failed');
    case 'processing':
      return t('campaign.status_processing');
    default:
      return t('campaign.status_queued');
  }
}

function pct(part: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

// ── Reporting par variante (read-only) — tableau variante × taux ───────────
// Le gagnant est dérivé du meilleur taux de clic (puis ouverture) — affichage
// only, pas de mutation serveur (winner_mark non exposé par l'API Phase A).
function VariantReport({
  broadcastId,
  variants,
  onMount,
}: {
  broadcastId: string;
  variants: BroadcastVariant[] | undefined;
  onMount: (id: string) => void;
}) {
  useEffect(() => {
    onMount(broadcastId);
  }, [broadcastId, onMount]);

  if (!variants || variants.length === 0) return null;

  // Gagnant : meilleur taux de clic, départage par taux d'ouverture.
  const rate = (part = 0, total = 0) => (total > 0 ? part / total : 0);
  const winnerIdx = variants.reduce((best, v, i) => {
    const cur = rate(v.clicked, v.sent) * 1000 + rate(v.opened, v.sent);
    const bst =
      rate(variants[best]!.clicked, variants[best]!.sent) * 1000 +
      rate(variants[best]!.opened, variants[best]!.sent);
    return cur > bst ? i : best;
  }, 0);

  return (
    <div className="abtest-report">
      <div className="text-xs font-medium text-muted mb-1">
        {t('abtest.results')}
      </div>
      <table className="abtest-table">
        <thead>
          <tr>
            <th>{t('abtest.variant')}</th>
            <th>{t('abtest.recipients')}</th>
            <th>{t('abtest.open_rate')}</th>
            <th>{t('abtest.click_rate')}</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((v, i) => (
            <tr key={v.id ?? i} className={i === winnerIdx ? 'abtest-winner-row' : ''}>
              <td>
                {v.label || String.fromCharCode(65 + i)}
                {i === winnerIdx ? (
                  <Tag variant="success" size="sm" className="ml-2">
                    <Icon as={Trophy} size="sm" /> {t('abtest.winner')}
                  </Tag>
                ) : null}
              </td>
              <td>{num(v.sent)}</td>
              <td>{pct(num(v.opened), num(v.sent))}</td>
              <td>{pct(num(v.clicked), num(v.sent))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CampaignsPage() {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // LOT renforcement — error inline + retry pour getBroadcastHistory/getTemplates/etc.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  // LOT G6 — segments disponibles comme cible
  const [segmentsList, setSegmentsList] = useState<LeadSegment[]>([]);

  // Composeur
  const [composeOpen, setComposeOpen] = useState(false);
  // LOT SMS/WHATSAPP seq 104 — canal d'envoi. Défaut 'email' ⇒ comportement
  // legacy strictement inchangé (rétro-compat byte : channel/body_text absents
  // de sendBroadcast en mode email).
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [smsBody, setSmsBody] = useState('');
  const [subject, setSubject] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [segStatuses, setSegStatuses] = useState<string[]>([]);
  const [segSources, setSegSources] = useState('');
  const [segTags, setSegTags] = useState<string[]>([]);
  // LOT G6 — mode cible : 'filters' (legacy Sprint 5) | 'segment'
  const [targetMode, setTargetMode] = useState<'filters' | 'segment'>('filters');
  const [targetSegmentId, setTargetSegmentId] = useState('');
  // LOT G6 — A/B testing
  const [abEnabled, setAbEnabled] = useState(false);
  const [variants, setVariants] = useState<DraftVariant[]>([]);
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [throttleOn, setThrottleOn] = useState(false);
  const [throttlePerMin, setThrottlePerMin] = useState(60);
  const [busy, setBusy] = useState(false);

  // LOT G6 — reporting par variante (lazy par broadcast, cache local)
  const [variantReports, setVariantReports] = useState<
    Record<string, BroadcastVariant[]>
  >({});

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const [histRes, tplRes, tagRes, segRes] = await Promise.all([
      getBroadcastHistory(50),
      getTemplates(),
      getAllTags(),
      getSegments(),
    ]);
    if (histRes.data) setHistory(histRes.data.map(normalizeRow));
    else if (histRes.error) setLoadError(histRes.error);
    if (tplRes.data)
      setTemplates(tplRes.data.filter((x) => x.channel === 'email'));
    if (tagRes.data) setAllTags(tagRes.data);
    if (segRes.data) setSegmentsList(segRes.data);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetCompose = () => {
    setChannel('email');
    setSmsBody('');
    setSubject('');
    setTemplateId('');
    setSegStatuses([]);
    setSegSources('');
    setSegTags([]);
    setTargetMode('filters');
    setTargetSegmentId('');
    setAbEnabled(false);
    setVariants([]);
    setScheduleOn(false);
    setScheduledAt('');
    setThrottleOn(false);
    setThrottlePerMin(60);
  };

  const toggle = (
    list: string[],
    setList: (v: string[]) => void,
    value: string
  ) => {
    setList(
      list.includes(value)
        ? list.filter((x) => x !== value)
        : [...list, value]
    );
  };

  // ── Variantes A/B ──
  const addVariant = () => {
    setVariants((prev) => {
      // Première activation : 2 variantes 50/50 prérempliés avec le sujet/template courant.
      if (prev.length === 0) {
        return [
          { label: 'A', subject: subject.trim(), template_id: templateId, split_pct: 50 },
          { label: 'B', subject: subject.trim(), template_id: templateId, split_pct: 50 },
        ];
      }
      const next = [
        ...prev,
        {
          label: String.fromCharCode(65 + prev.length),
          subject: subject.trim(),
          template_id: templateId,
          split_pct: 0,
        },
      ];
      // Réparti 100 / n également (arrondi, reste sur la dernière).
      const even = Math.floor(100 / next.length);
      return next.map((v, i) => ({
        ...v,
        split_pct: i === next.length - 1 ? 100 - even * (next.length - 1) : even,
      }));
    });
  };

  const removeVariant = (idx: number) => {
    setVariants((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateVariant = (idx: number, patch: Partial<DraftVariant>) => {
    setVariants((prev) => prev.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  };

  const splitTotal = useMemo(
    () => variants.reduce((acc, v) => acc + (Number(v.split_pct) || 0), 0),
    [variants]
  );
  const splitValid = !abEnabled || (variants.length >= 2 && splitTotal === 100);

  // Toggle A/B : à l'activation initialise 2 variantes.
  const handleToggleAb = (on: boolean) => {
    setAbEnabled(on);
    if (on && variants.length === 0) addVariant();
  };

  // LOT SMS/WHATSAPP — segments du corps SMS (informatif, recalculé live).
  const smsInfo = useMemo(() => smsSegmentInfo(smsBody), [smsBody]);

  const canSend = useMemo(() => {
    if (channel === 'sms') {
      // SMS : sujet (libellé du broadcast) + corps texte requis. Pas de
      // template / A/B (email-only) ⇒ on ignore templateId/splitValid.
      return subject.trim().length > 0 && smsBody.trim().length > 0;
    }
    return subject.trim().length > 0 && !!templateId && splitValid;
  }, [channel, subject, smsBody, templateId, splitValid]);

  // Charge (lazy) les variantes d'un broadcast A/B pour le reporting.
  const loadVariantReport = useCallback(
    async (broadcastId: string) => {
      if (variantReports[broadcastId]) return;
      const res = await getBroadcastVariants(broadcastId);
      if (res.data) {
        setVariantReports((prev) => ({ ...prev, [broadcastId]: res.data! }));
      }
    },
    [variantReports]
  );

  const handleSend = async () => {
    if (!canSend) return;
    const sources = segSources
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    setBusy(true);
    // LOT G6 — mode cible. segment ⇒ segment_id ; filters ⇒ legacy Sprint 5.
    const useSegment = targetMode === 'segment' && !!targetSegmentId;
    const isSms = channel === 'sms';
    // A/B + template = email-only. En SMS on n'attache aucune variante.
    const apiVariants: BroadcastVariant[] | undefined =
      !isSms && abEnabled
        ? variants.map((v) => ({
            label: v.label,
            subject: v.subject.trim() || subject.trim(),
            template_id: v.template_id || templateId || null,
            split_pct: v.split_pct,
          }))
        : undefined;
    const res = await sendBroadcast({
      subject: subject.trim(),
      // SMS : pas de template (corps en clair via body_text). Email : inchangé.
      ...(isSms ? {} : { template_id: templateId }),
      // LOT SMS/WHATSAPP seq 104 — channel/body_text branchés sur le helper
      // FIGÉ Phase A. Absents en mode email ⇒ broadcast legacy byte-identique.
      ...(isSms ? { channel: 'sms' as const, body_text: smsBody.trim() } : {}),
      // segment_id et filters s'excluent : si segment ⇒ pas de filters legacy.
      ...(useSegment
        ? { segment_id: targetSegmentId }
        : {
            filters: {
              ...(segStatuses.length ? { status: segStatuses } : {}),
              ...(sources.length ? { source: sources } : {}),
              ...(segTags.length ? { tags: segTags } : {}),
            },
          }),
      // LOT G6 — variants absent ⇒ broadcast Sprint 5 normal byte-identique.
      ...(apiVariants ? { variants: apiVariants } : {}),
      // Additif : absent/null ⇒ envoi immédiat (legacy). Date locale ⇒ ISO.
      scheduled_at:
        scheduleOn && scheduledAt
          ? new Date(scheduledAt).toISOString()
          : null,
      // Absent/0 ⇒ pas de limite (legacy).
      throttle_per_min: throttleOn ? Math.max(1, throttlePerMin) : 0,
    });
    if (!res.data) {
      setBusy(false);
      toastError(res.error || t('campaign.status_failed'));
      return;
    }
    // LOT G6 — si l'API renvoie un broadcast id et que l'A/B est actif, on
    // attache les variantes via setBroadcastVariants (idempotent côté serveur).
    if (apiVariants) {
      const bid =
        (res.data as unknown as Record<string, unknown>).id ??
        (res.data as unknown as Record<string, unknown>).broadcast_id;
      if (bid) await setBroadcastVariants(String(bid), apiVariants);
    }
    setBusy(false);
    setComposeOpen(false);
    resetCompose();
    success(
      scheduleOn && scheduledAt
        ? t('campaign.schedule')
        : t('campaign.send_now')
    );
    void load();
  };

  return (
    <AppLayout title={t('campaign.title')}>
      <div className="p-6">
        <PageHero
          meta={t('campaign.title')}
          title={t('campaign.title')}
          description={t('campaign.subtitle')}
          actions={
            <Button
              variant="primary"
              leftIcon={<Icon as={Plus} size="sm" />}
              onClick={() => {
                resetCompose();
                setComposeOpen(true);
              }}
            >
              {t('campaign.new')}
            </Button>
          }
        />

        {/* LOT renforcement — inline error banner (role=alert + retry) */}
        {loadError && !isLoading && (
          <div
            role="alert"
            aria-live="assertive"
            className="mb-4 p-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-[var(--danger)]">{t('common.error.title')}</p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{t('common.error.load_failed')}</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => void load()}>{t('common.retry')}</Button>
          </div>
        )}
        {isLoading ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite" aria-label={t('a11y.loading_sr')}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="p-4">
                <Skeleton className="h-5 w-1/3 mb-2" />
                <Skeleton className="h-3 w-1/2" />
              </Card>
            ))}
          </div>
        ) : history.length === 0 ? (
          <EmptyState
            icon={<Icon as={Send} size={40} />}
            title={t('campaign.empty_title')}
            description={t('campaign.empty_desc')}
            action={
              <Button
                variant="primary"
                leftIcon={<Icon as={Plus} size="sm" />}
                onClick={() => {
                  resetCompose();
                  setComposeOpen(true);
                }}
              >
                {t('campaign.new')}
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-3 animate-stagger">
            {history.map((c, idx) => (
              <Card key={c.id} className={`p-4 flex flex-col gap-3 card-interactive-bump stagger-${Math.min(idx + 1, 8)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{c.subject}</div>
                    <div className="text-xs text-muted mt-0.5">
                      {c.scheduled_at ? (
                        <>
                          <Icon as={Clock} size="sm" />{' '}
                          {new Date(c.scheduled_at).toLocaleString()}
                        </>
                      ) : (
                        new Date(c.created_at).toLocaleString()
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {c.ab_test_enabled ? (
                      <Tag variant="brand" size="sm">
                        <Icon as={FlaskConical} size="sm" /> A/B
                      </Tag>
                    ) : null}
                    <Tag
                      variant={statusVariant(c.status)}
                      size="sm"
                      statusIcon
                    >
                      {statusLabel(c.status)}
                    </Tag>
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
                  <span>
                    {t('campaign.recipients')}:{' '}
                    <strong className="t-mono-num">{c.total_recipients}</strong>
                  </span>
                  <span>
                    {t('campaign.sent')}: <strong className="t-mono-num">{c.sent}</strong>
                  </span>
                  <span>
                    {t('campaign.opened')}: <strong className="t-mono-num">{c.opened}</strong>{' '}
                    <span className="text-muted t-mono-num">
                      ({pct(c.opened, c.sent)})
                    </span>
                  </span>
                  <span>
                    {t('campaign.clicked')}: <strong className="t-mono-num">{c.clicked}</strong>{' '}
                    <span className="text-muted t-mono-num">
                      ({pct(c.clicked, c.sent)})
                    </span>
                  </span>
                  {c.failed > 0 ? (
                    <span style={{ color: 'var(--danger-text)' }}>
                      {t('campaign.failed')}: <span className="t-mono-num">{c.failed}</span>
                    </span>
                  ) : null}
                </div>

                {/* LOT G6 — reporting par variante (A/B) : lazy au montage */}
                {c.ab_test_enabled ? (
                  <VariantReport
                    broadcastId={c.id}
                    variants={variantReports[c.id]}
                    onMount={loadVariantReport}
                  />
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ── Composeur de campagne ── */}
      <Modal
        open={composeOpen}
        onOpenChange={(o) => {
          setComposeOpen(o);
          if (!o) resetCompose();
        }}
        title={t('campaign.new')}
        size="lg"
      >
        <div className="flex flex-col gap-4 p-1">
          {/* LOT SMS/WHATSAPP seq 104 — sélecteur de canal (Email / SMS).
              Défaut email ⇒ comportement legacy. SMS ⇒ corps texte + segments. */}
          <div>
            <label className="prop-label">{t('smsCampaign.channel')}</label>
            <div className="flex gap-2">
              <FilterChip
                label={t('smsCampaign.channel_email')}
                variant={channel === 'email' ? 'active' : 'available'}
                onClick={() => setChannel('email')}
              />
              <FilterChip
                label={t('smsCampaign.channel_sms')}
                variant={channel === 'sms' ? 'active' : 'available'}
                onClick={() => setChannel('sms')}
              />
            </div>
          </div>

          <div>
            <label className="prop-label">{t('campaign.subject')}</label>
            <Input
              value={subject}
              autoFocus
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          {/* Corps SMS (channel sms) — compteur de caractères + segments */}
          {channel === 'sms' ? (
            <div>
              <label className="prop-label">{t('smsCampaign.body')}</label>
              <Textarea
                value={smsBody}
                placeholder={t('smsCampaign.body_placeholder')}
                onChange={(e) => setSmsBody(e.target.value)}
                rows={4}
                resize="none"
              />
              <div className="text-xs text-muted mt-1">
                {/* La clé Phase A `smsCampaign.segments_count` utilise des
                    accolades SIMPLES (`{count}`/`{chars}`) alors que t()
                    interpole `{{var}}` ⇒ on substitue manuellement les jetons
                    sur la chaîne traduite (aucune clé inventée). */}
                {t('smsCampaign.segments_count')
                  .replace('{count}', String(smsInfo.segments))
                  .replace('{chars}', String(smsInfo.chars))}
              </div>
            </div>
          ) : (
            <div>
              <label className="prop-label">{t('campaign.template')}</label>
              <div className="flex items-center gap-2">
                <Select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="flex-1"
                >
                  <option value="">—</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </Select>
                {templateId ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Icon as={Pencil} size="sm" />}
                    onClick={() =>
                      navigate({
                        to: '/templates/builder/$templateId',
                        params: { templateId },
                      })
                    }
                    aria-label={t('campaign.template')}
                  />
                ) : null}
              </div>
            </div>
          )}

          {/* Cible — filtres inline (legacy) OU segment (LOT G6) */}
          <div>
            <label className="prop-label">{t('campaign.recipients')}</label>
            {segmentsList.length > 0 ? (
              <div className="flex gap-2 mb-3">
                <FilterChip
                  label={t('campaign.recipients')}
                  variant={targetMode === 'filters' ? 'active' : 'available'}
                  onClick={() => setTargetMode('filters')}
                />
                <FilterChip
                  label={t('segment.use_as_target')}
                  variant={targetMode === 'segment' ? 'active' : 'available'}
                  onClick={() => setTargetMode('segment')}
                />
              </div>
            ) : null}

            {targetMode === 'segment' ? (
              <Select
                value={targetSegmentId}
                onChange={(e) => setTargetSegmentId(e.target.value)}
              >
                <option value="">—</option>
                {segmentsList.map((sg) => (
                  <option key={sg.id} value={sg.id}>
                    {sg.name}
                    {sg.cached_count != null ? ` (${sg.cached_count})` : ''}
                  </option>
                ))}
              </Select>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 mb-3">
                  {LEAD_STATUSES.map((s) => (
                    <FilterChip
                      key={s}
                      label={s}
                      variant={segStatuses.includes(s) ? 'active' : 'available'}
                      onClick={() => toggle(segStatuses, setSegStatuses, s)}
                    />
                  ))}
                </div>
                <Input
                  placeholder="facebook, google, ..."
                  value={segSources}
                  onChange={(e) => setSegSources(e.target.value)}
                />
                {allTags.length > 0 ? (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {allTags.map((tag) => (
                      <FilterChip
                        key={tag}
                        label={tag}
                        variant={segTags.includes(tag) ? 'active' : 'available'}
                        onClick={() => toggle(segTags, setSegTags, tag)}
                      />
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>

          {/* A/B testing (LOT G6) — email-only (basé sur les templates). En
              SMS le corps est unique (body_text) ⇒ section masquée. */}
          {channel === 'email' ? (
          <div className="flex flex-col gap-2">
            <Switch
              checked={abEnabled}
              onCheckedChange={handleToggleAb}
              size="sm"
              label={t('abtest.enable')}
            />
            {abEnabled ? (
              <div className="flex flex-col gap-2 abtest-editor">
                {variants.map((v, idx) => (
                  <div
                    key={idx}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-subtle p-3"
                  >
                    <Input
                      value={v.label}
                      placeholder={t('abtest.label')}
                      onChange={(e) => updateVariant(idx, { label: e.target.value })}
                      className="w-20"
                      aria-label={t('abtest.label')}
                    />
                    <Input
                      value={v.subject}
                      placeholder={t('campaign.subject')}
                      onChange={(e) => updateVariant(idx, { subject: e.target.value })}
                      className="flex-1 min-w-[160px]"
                      aria-label={t('campaign.subject')}
                    />
                    <Select
                      value={v.template_id}
                      onChange={(e) =>
                        updateVariant(idx, { template_id: e.target.value })
                      }
                      className="w-40"
                      aria-label={t('campaign.template')}
                    >
                      <option value="">—</option>
                      {templates.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>
                          {tpl.name}
                        </option>
                      ))}
                    </Select>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={v.split_pct}
                        onChange={(e) =>
                          updateVariant(idx, {
                            split_pct: Math.max(
                              0,
                              Math.min(100, Number(e.target.value) || 0)
                            ),
                          })
                        }
                        className="w-20"
                        aria-label={t('abtest.split_pct')}
                      />
                      <span className="text-xs text-muted">%</span>
                    </div>
                    {variants.length > 2 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeVariant(idx)}
                        leftIcon={<Icon as={Trash2} size="sm" />}
                        aria-label={t('abtest.variant_remove')}
                      />
                    ) : null}
                  </div>
                ))}
                <div className="flex items-center justify-between gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Icon as={Plus} size="sm" />}
                    onClick={addVariant}
                  >
                    {t('abtest.variant_add')}
                  </Button>
                  <span
                    className="text-xs"
                    style={{
                      color: splitTotal === 100 ? 'var(--text-muted)' : 'var(--danger-text)',
                    }}
                  >
                    {splitTotal === 100
                      ? `${t('abtest.split_pct')}: 100%`
                      : t('abtest.split_total_err')}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
          ) : null}

          {/* Programmation */}
          <div className="flex flex-col gap-2">
            <Switch
              checked={scheduleOn}
              onCheckedChange={setScheduleOn}
              size="sm"
              label={t('campaign.schedule')}
            />
            {scheduleOn ? (
              <div>
                <label className="prop-label">
                  {t('campaign.scheduled_at')}
                </label>
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </div>
            ) : null}
          </div>

          {/* Throttle */}
          <div className="flex flex-col gap-2">
            <Switch
              checked={throttleOn}
              onCheckedChange={setThrottleOn}
              size="sm"
              label={t('campaign.throttle')}
              description={t('campaign.throttle_help')}
            />
            {throttleOn ? (
              <Input
                type="number"
                min={1}
                value={throttlePerMin}
                onChange={(e) =>
                  setThrottlePerMin(Math.max(1, Number(e.target.value) || 1))
                }
                className="w-32"
              />
            ) : null}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setComposeOpen(false)}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="primary"
              isLoading={busy}
              disabled={!canSend}
              leftIcon={
                <Icon
                  as={scheduleOn ? Clock : channel === 'sms' ? MessageSquare : Mail}
                  size="sm"
                />
              }
              onClick={() => void handleSend()}
            >
              {scheduleOn ? t('campaign.schedule') : t('campaign.send_now')}
            </Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
