// ── NotificationPreferencesSelfService — surface setNotificationPreferences ──
// 100 % additif. Carte self-service : toggles email / SMS appliqués à TOUS les
// types d'événements connus puis poussés via setNotificationPreferences (PUT
// matrix). État initial chargé via getNotificationPreferences (pair de lecture).
// Flag-aware : si /auth/notifications renvoie une erreur, on part d'un état
// neutre (toggles OFF) sans crasher ; le PUT reste utilisable.
// i18n : clés notifx.* (NON ajoutées aux catalogues — t() renvoie la clé si absente).
import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Switch, Button, Skeleton, useToast } from '@/components/ui';
import {
  getNotificationPreferences,
  setNotificationPreferences,
  type NotificationPreference,
} from '@/lib/api';
import { t } from '@/lib/i18n';
import { Bell } from 'lucide-react';

// Types d'événements de base couverts par les toggles globaux email / SMS.
// (best-effort : si le backend en connaît d'autres, ils sont préservés via la
//  fusion dans buildMatrix.)
const BASE_EVENT_TYPES = ['lead_new', 'deal_won', 'task_due', 'message_received'];

export function NotificationPreferencesSelfService() {
  const { success, error: toastError } = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [emailOn, setEmailOn] = useState(false);
  const [smsOn, setSmsOn] = useState(false);

  // Toutes les prefs connues du backend (pour préserver les channels non gérés
  // ici — in_app / push / slack — lors du PUT matrix).
  const knownPrefs = useRef<NotificationPreference[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    getNotificationPreferences()
      .then((res) => {
        if (res.error) {
          setLoadError(res.error);
        } else {
          // Défensif : si `data` n'est pas un tableau, on traite comme vide.
          const arr = Array.isArray(res.data) ? res.data : [];
          knownPrefs.current = arr;
          // ON si AU MOINS un event_type est activé sur le channel.
          setEmailOn(arr.some((p) => p.channel === 'email' && p.enabled));
          setSmsOn(arr.some((p) => p.channel === 'sms' && p.enabled));
        }
        setLoading(false);
      })
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const buildMatrix = (email: boolean, sms: boolean) => {
    // Types couverts = base ∪ ceux déjà connus du backend.
    const eventTypes = new Set<string>(BASE_EVENT_TYPES);
    for (const p of knownPrefs.current) eventTypes.add(p.event_type);
    const preferences: Array<{
      channel: NotificationPreference['channel'];
      event_type: string;
      enabled: boolean;
    }> = [];
    for (const event_type of eventTypes) {
      preferences.push({ channel: 'email', event_type, enabled: email });
      preferences.push({ channel: 'sms', event_type, enabled: sms });
    }
    return { preferences };
  };

  const handleSave = async () => {
    if (saving) return; // anti double-submit
    setSaving(true);
    try {
      const res = await setNotificationPreferences(buildMatrix(emailOn, smsOn));
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('notifx.saved'));
    } catch (e: unknown) {
      toastError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card
        className="p-5 space-y-3"
        aria-busy="true"
        aria-live="polite"
        aria-label={t('a11y.loading_sr')}
      >
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-8 w-full rounded-md" />
        <Skeleton className="h-8 w-full rounded-md" />
        <Skeleton className="h-9 w-40 rounded-md" />
      </Card>
    );
  }

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
          <Bell size={18} /> {t('notifx.title')}
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mt-0.5">{t('notifx.desc')}</p>
      </div>

      {loadError && (
        <div
          role="alert"
          aria-live="assertive"
          className="p-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-between gap-3"
        >
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-[var(--danger)]">{t('common.error.title')}</p>
            <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{t('notifx.unavailable')}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={load}>{t('common.retry')}</Button>
        </div>
      )}

      <Switch
        checked={emailOn}
        onCheckedChange={setEmailOn}
        label={t('notifx.email')}
        description={t('notifx.email_desc')}
      />
      <Switch
        checked={smsOn}
        onCheckedChange={setSmsOn}
        label={t('notifx.sms')}
        description={t('notifx.sms_desc')}
      />

      <div>
        <Button onClick={() => void handleSave()} disabled={saving} aria-busy={saving}>
          {saving ? t('notifx.saving') : t('notifx.save')}
        </Button>
      </div>
    </Card>
  );
}
