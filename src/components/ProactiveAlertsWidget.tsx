// ── ProactiveAlertsWidget — IA proactive : alertes churn / NBA / résumés ────
//
// Sprint C IA proactive — Phase B Manager-C (front exclusif).
//
// Card "Suggestions de l'IA" (proactive.widget_title) listant les alertes
// générées côté serveur par le batch déterministe (Manager-B). Lecture seule +
// actions NON-MÉTIER : marquer vu (markProactiveAlertSeen) / ignorer
// (dismissProactiveAlert). Aucune mutation sur les entités leads/clients.
//
// Capability gating best-effort : si getProactiveAlerts() renvoie une erreur
// de capability (string-match ai.use / 403 / forbidden), le widget se masque
// entièrement (dégradation gracieuse — même pattern qu'AiAssistantPanel).
// Si zéro alerte → le widget se masque aussi (discret, pas d'empty bruyant
// sur le Dashboard). L'empty state n'est rendu que pendant le chargement
// initial déjà passé + aucune alerte n'a jamais été reçue : on masque.
//
// SUBTLE Stripe-grade : primitives Card / Tag / Button / Icon réutilisées.
// Aucun orb / glow / gradient brand.

import { useEffect, useState, useCallback } from 'react';
import { Card, Tag, Button, Icon, useToast } from '@/components/ui';
import { Sparkles, AlertTriangle, Flame, FileText, Check, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { t } from '@/lib/i18n';
import {
  getProactiveAlerts,
  markProactiveAlertSeen,
  dismissProactiveAlert,
  type ProactiveAlert,
} from '@/lib/api';

// Détection erreur capability (best-effort, dégradation gracieuse).
const CAP_RE = /cap|access|forbidden|ai\.use|403/i;

// Icône Lucide selon le kind de l'alerte.
function kindIcon(kind: ProactiveAlert['kind']): LucideIcon {
  switch (kind) {
    case 'churn':   return AlertTriangle;
    case 'nba':     return Flame;
    case 'summary': return FileText;
    default:        return Sparkles;
  }
}

// Libellé de catégorie (clés Phase A — aucune créée ici).
function kindLabel(kind: ProactiveAlert['kind']): string {
  switch (kind) {
    case 'churn':   return t('proactive.churn_risk');
    case 'nba':     return t('proactive.nba_relance');
    case 'summary': return t('proactive.widget_title');
    default:        return t('proactive.widget_title');
  }
}

// Badge risque pour les alertes churn — heuristique sur le titre/body serveur
// (les clés risk_* existent Phase A ; pas d'inférence métier, juste affichage).
function riskBadge(a: ProactiveAlert): { label: string; variant: 'danger' | 'warning' | 'neutral' } | null {
  if (a.kind !== 'churn') return null;
  const hay = `${a.title ?? ''} ${a.body ?? ''}`.toLowerCase();
  if (/élev|high|critique|critical/.test(hay)) return { label: t('proactive.risk_high'), variant: 'danger' };
  if (/moyen|medium|modér/.test(hay))          return { label: t('proactive.risk_medium'), variant: 'warning' };
  return { label: t('proactive.risk_low'), variant: 'neutral' };
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function ProactiveAlertsWidget() {
  const [alerts, setAlerts] = useState<ProactiveAlert[]>([]);
  const [loading, setLoading] = useState(true);
  // hidden : capability absente → on ne montre rien du tout.
  const [hidden, setHidden] = useState(false);
  // busy par id (action en cours) pour éviter double-clic.
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    setLoading(true);
    getProactiveAlerts()
      .then((res) => {
        if (res.data && Array.isArray(res.data)) {
          // N'affiche que les alertes encore actives (pas dismissed).
          setAlerts(res.data.filter((a) => a.status !== 'dismissed'));
          setHidden(false);
        } else if (res.error && CAP_RE.test(res.error)) {
          setHidden(true);
        }
      })
      .catch(() => { /* silencieux — widget reste masqué/vide */ })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSeen = useCallback(async (a: ProactiveAlert) => {
    if (busyId) return;
    setBusyId(a.id);
    try {
      const res = await markProactiveAlertSeen(a.id);
      if (!res.error) {
        setAlerts((prev) => prev.map((x) => (x.id === a.id ? { ...x, status: 'seen' } : x)));
      } else if (CAP_RE.test(res.error)) {
        setHidden(true);
      }
    } catch { /* silencieux */ }
    finally { setBusyId(null); }
  }, [busyId]);

  const handleDismiss = useCallback(async (a: ProactiveAlert) => {
    if (busyId) return;
    setBusyId(a.id);
    // Optimiste : retire de la liste, rollback si erreur.
    setAlerts((prev) => prev.filter((x) => x.id !== a.id));
    try {
      const res = await dismissProactiveAlert(a.id);
      if (res.error) {
        if (CAP_RE.test(res.error)) setHidden(true);
        else {
          setAlerts((prev) => [a, ...prev]); // rollback
          toast.error(res.error);
        }
      }
    } catch {
      setAlerts((prev) => [a, ...prev]); // rollback
    } finally { setBusyId(null); }
  }, [busyId, toast]);

  // Capability absente OU rien à afficher (et chargement terminé) → masquer
  // entièrement le widget (discret sur Dashboard, pas d'empty bruyant).
  if (hidden) return null;
  if (!loading && alerts.length === 0) return null;

  return (
    <Card className="proactive-widget mb-6" aria-labelledby="proactive-widget-title">
      <div className="proactive-widget-head">
        <span className="proactive-widget-icon" aria-hidden>
          <Icon as={Sparkles} size={16} />
        </span>
        <h3 id="proactive-widget-title" className="proactive-widget-title">
          {t('proactive.widget_title')}
        </h3>
      </div>

      {loading ? (
        <p className="proactive-widget-loading" role="status">…</p>
      ) : (
        <ul className="proactive-widget-list">
          {alerts.map((a) => {
            const KIcon = kindIcon(a.kind);
            const risk = riskBadge(a);
            const seen = a.status === 'seen' || a.status === 'acted';
            return (
              <li
                key={a.id}
                className={`proactive-alert proactive-alert-s18${seen ? ' proactive-alert--seen' : ''}`}
                data-kind={a.kind}
              >
                <span className="proactive-alert-kind" aria-hidden>
                  <Icon as={KIcon} size={15} />
                </span>
                <div className="proactive-alert-body">
                  <div className="proactive-alert-top">
                    <span className="proactive-alert-cat">{kindLabel(a.kind)}</span>
                    {risk && (
                      <Tag variant={risk.variant} size="xs">{risk.label}</Tag>
                    )}
                    {a.created_at && (
                      <span className="proactive-alert-date">{formatDate(a.created_at)}</span>
                    )}
                  </div>
                  {a.title && <p className="proactive-alert-headline">{a.title}</p>}
                  {a.body && <p className="proactive-alert-text">{a.body}</p>}
                </div>
                <div className="proactive-alert-actions">
                  {!seen && (
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Icon as={Check} size={14} />}
                      disabled={busyId === a.id}
                      onClick={() => void handleSeen(a)}
                    >
                      {t('notif.mark_read')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Icon as={X} size={14} />}
                    disabled={busyId === a.id}
                    onClick={() => void handleDismiss(a)}
                  >
                    {t('proactive.dismiss')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
