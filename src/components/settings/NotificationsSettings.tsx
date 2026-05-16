// ── NotificationsSettings — Sprint 23 W31 : Switch primitives + KpiStrip + row-premium
// ── Sprint 24 vague 6A — AutosaveIndicator (toggles already save instant)
// ── Sprint 25 vague 4B — Section "Feedback sensoriel" (sons + haptic + previews)
// ── Sprint 46 M3.3 — Grille 8 events × 5 channels (push + Slack ajoutés)
import { useState, useEffect, useMemo, useRef } from 'react';
import { Card, Switch, KpiStrip, EmptyState, Skeleton, useToast, AutosaveIndicator, Button, Icon as UIcon } from '@/components/ui';
import type { AutosaveState } from '@/components/ui/AutosaveIndicator';
import {
  getNotificationPreferences,
  updateNotificationPreference,
  type NotificationPreference,
} from '@/lib/api';
import { Bell, Mail, Smartphone, Monitor, BellOff, Volume2, Vibrate, ToggleLeft, CheckCircle2, AlertCircle, BellRing, Send, Sparkles, MousePointer2, MessageSquare } from 'lucide-react';

// Slack n'est plus exporté par lucide-react 1.x — icône SVG inline
const SlackIcon = (props: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={props.size || 16} height={props.size || 16} fill="currentColor" aria-hidden>
    <path d="M14.5 2a2.5 2.5 0 00-.5 4.95V10h3.05A2.5 2.5 0 1014.5 2zM2 9.5A2.5 2.5 0 006.95 10H10V6.95A2.5 2.5 0 102 9.5zM9.5 22a2.5 2.5 0 00.5-4.95V14H6.95A2.5 2.5 0 109.5 22zM22 14.5a2.5 2.5 0 00-4.95-.5H14v3.05A2.5 2.5 0 1022 14.5z"/>
  </svg>
);
import { useSound, type SoundName } from '@/hooks/useSound';
import { useHaptic, type HapticIntensity } from '@/hooks/useHaptic';

// Sprint 46 M3.3 — 8 events × 5 channels (push + Slack ajoutés).
// IDs alignés avec le worker `createNotification` (lead.created, lead.assigned,
// task.due, task.assigned, message.received, message.mention, calendar.upcoming,
// system.error).
const EVENTS = [
  { id: 'lead.created', label: 'Nouveau lead', desc: 'Quand un prospect soumet un formulaire ou arrive via webhook' },
  { id: 'lead.assigned', label: 'Lead assigné', desc: 'Quand un lead t\'est attribué' },
  { id: 'task.due', label: 'Tâche échue', desc: 'Rappel quand l\'échéance d\'une tâche arrive' },
  { id: 'task.assigned', label: 'Tâche assignée', desc: 'Quand une tâche t\'est attribuée par un coéquipier' },
  { id: 'message.received', label: 'Message reçu', desc: 'Quand un lead te répond (SMS / email / webchat)' },
  { id: 'message.mention', label: 'Mention dans conversation', desc: 'Quand un coéquipier te @mentionne dans une note ou conversation' },
  { id: 'calendar.upcoming', label: 'Événement à venir', desc: 'Rappel 15 min avant un rendez-vous' },
  { id: 'system.error', label: 'Erreur système', desc: 'Alertes techniques (workflow planté, intégration brisée, etc.)' },
] as const;

type Channel = 'in_app' | 'email' | 'sms' | 'push' | 'slack';
const CHANNELS: { key: Channel; label: string; icon: any; variant: 'brand' | 'success' | 'danger' }[] = [
  { key: 'in_app', label: 'In-App', icon: Monitor, variant: 'brand' },
  { key: 'email', label: 'Email', icon: Mail, variant: 'brand' },
  { key: 'push', label: 'Push', icon: MessageSquare, variant: 'brand' },
  { key: 'sms', label: 'SMS', icon: Smartphone, variant: 'success' },
  { key: 'slack', label: 'Slack', icon: SlackIcon, variant: 'brand' },
];

export function NotificationsSettings() {
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const { success, error: toastError } = useToast();
  // Sprint 24 vague 6A — autosave state (toggle = save immédiat)
  const [autosaveState, setAutosaveState] = useState<AutosaveState>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const lastRetryRef = useRef<(() => void) | null>(null);
  const decayTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (decayTimerRef.current) window.clearTimeout(decayTimerRef.current);
    };
  }, []);

  useEffect(() => {
    getNotificationPreferences().then((res) => {
      if (res.data) setPreferences(res.data);
      setLoading(false);
    });
  }, []);

  const isEnabled = (channel: string, eventType: string) => {
    const pref = preferences.find((p) => p.channel === channel && p.event_type === eventType);
    // Defaults: Email + in_app enabled, others disabled
    return pref ? pref.enabled === 1 : channel === 'email' || channel === 'in_app';
  };

  const togglePref = async (channel: Channel, eventType: string, currentEnabled: boolean) => {
    const nextEnabled = !currentEnabled;
    const isNew = !preferences.find((p) => p.channel === channel && p.event_type === eventType);

    if (isNew) {
      setPreferences((prev) => [...prev, { channel, event_type: eventType, enabled: nextEnabled ? 1 : 0 }]);
    } else {
      setPreferences((prev) =>
        prev.map((p) =>
          p.channel === channel && p.event_type === eventType
            ? { ...p, enabled: nextEnabled ? 1 : 0 }
            : p
        )
      );
    }

    // Sprint 24 vague 6A — saving → saved (toggle = save immédiat)
    setAutosaveState('saving');
    lastRetryRef.current = () => void togglePref(channel, eventType, currentEnabled);
    const res = await updateNotificationPreference(channel, eventType, nextEnabled);
    if (res.error) {
      toastError(res.error);
      setAutosaveState('error');
      // Revert on error
      setPreferences((prev) =>
        prev.map((p) =>
          p.channel === channel && p.event_type === eventType
            ? { ...p, enabled: currentEnabled ? 1 : 0 }
            : p
        )
      );
    } else {
      success('Préférences mises à jour');
      setAutosaveState('saved');
      setLastSaved(new Date());
      if (decayTimerRef.current) window.clearTimeout(decayTimerRef.current);
      decayTimerRef.current = window.setTimeout(() => {
        setAutosaveState((s) => (s === 'saved' ? 'idle' : s));
      }, 5000);
    }
  };

  const retrySave = () => {
    lastRetryRef.current?.();
  };

  // KPI counts
  const kpis = useMemo(() => {
    const total = EVENTS.length * CHANNELS.length;
    let enabled = 0;
    const perChannel: Record<Channel, number> = { in_app: 0, email: 0, sms: 0, push: 0, slack: 0 };
    for (const evt of EVENTS) {
      for (const ch of CHANNELS) {
        if (isEnabled(ch.key, evt.id)) {
          enabled++;
          perChannel[ch.key]++;
        }
      }
    }
    return { total, enabled, perChannel };
  }, [preferences]);

  if (!loading && (EVENTS as readonly unknown[]).length === 0) {
    return (
      <Card className="p-5">
        <EmptyState
          icon={<BellOff size={32} />}
          title="Aucune préférence à configurer"
          description="Les types d'événements seront listés ici dès qu'ils seront disponibles."
        />
      </Card>
    );
  }

  // Skeleton initial matche layout : KpiStrip 5 items + 6-8 toggle rows
  if (loading) {
    return (
      <div className="space-y-6">
        <div
          className="relative flex flex-wrap items-stretch rounded-2xl overflow-hidden mb-5"
          style={{
            background: 'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 50%, #F5FBFE 100%)',
            border: '1px solid var(--border-subtle)',
            boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -8px rgba(0,157,219,0.10)',
          }}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 min-w-[140px] px-5 py-4 space-y-2"
              style={{
                borderLeft: i > 0 ? '1px solid rgba(0,157,219,0.10)' : 'none',
                animationDelay: `${i * 40}ms`,
              }}
            >
              <Skeleton className="h-2 w-16" style={{ animationDelay: `${i * 40}ms` }} />
              <Skeleton className="h-6 w-12" style={{ animationDelay: `${i * 40 + 20}ms` }} />
            </div>
          ))}
        </div>

        <Card className="p-5">
          <Skeleton className="h-4 w-56 mb-2" />
          <Skeleton className="h-3 w-80 mb-6" style={{ animationDelay: '40ms' }} />
          <div className="space-y-2.5">
            {Array.from({ length: 7 }).map((_, i) => (
              <div
                key={i}
                className="row-premium flex items-center gap-4 p-4 rounded-xl"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', animationDelay: `${i * 50}ms` }}
              >
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-40" style={{ animationDelay: `${i * 50}ms` }} />
                  <Skeleton className="h-2.5 w-3/4" style={{ animationDelay: `${i * 50 + 20}ms` }} />
                </div>
                <div className="flex items-center gap-5 shrink-0">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="inline-flex items-center gap-2">
                      <Skeleton className="h-5 w-9 rounded-full" style={{ animationDelay: `${i * 50 + 40 + j * 20}ms` }} />
                      <Skeleton className="h-3 w-12" style={{ animationDelay: `${i * 50 + 60 + j * 20}ms` }} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <KpiStrip
        items={[
          { label: 'Activées', value: kpis.enabled, color: 'brand', icon: <Bell size={12} /> },
          { label: 'Total', value: kpis.total, color: 'neutral' },
          { label: 'In-App', value: kpis.perChannel.in_app, color: 'info', icon: <Monitor size={12} /> },
          { label: 'Email', value: kpis.perChannel.email, color: 'brand', icon: <Mail size={12} /> },
          { label: 'Push', value: kpis.perChannel.push, color: 'brand', icon: <MessageSquare size={12} /> },
          { label: 'SMS', value: kpis.perChannel.sms, color: 'success', icon: <Smartphone size={12} /> },
          { label: 'Slack', value: kpis.perChannel.slack, color: 'brand', icon: <SlackIcon size={12} /> },
        ]}
      />

      <Card className="settings-card p-6 relative">
        <div className="settings-autosave-slot">
          <AutosaveIndicator state={autosaveState} lastSaved={lastSaved} onRetry={retrySave} />
        </div>

        <header className="settings-section-header">
          <h3 className="t-h3">Préférences de notifications</h3>
          <p className="t-caption text-[var(--gray-500)]">
            Choisis comment être averti pour chaque type d'événement.
          </p>
        </header>

        <div className="settings-notif-list">
          {EVENTS.map((event, idx) => (
            <div
              key={event.id}
              className="settings-notif-row list-item-enter"
              style={{ animationDelay: `${idx * 60}ms`, animationFillMode: 'both' }}
            >
              <div className="settings-notif-row__meta">
                <p className="t-body settings-notif-row__title">{event.label}</p>
                <p className="t-caption text-[var(--gray-500)]">{event.desc}</p>
              </div>

              <div className="settings-notif-row__channels">
                {CHANNELS.map((ch) => {
                  const Icon = ch.icon;
                  const enabled = isEnabled(ch.key, event.id);
                  return (
                    <div key={ch.key} className="settings-notif-channel">
                      <Switch
                        size="sm"
                        variant={ch.variant}
                        checked={enabled}
                        onCheckedChange={() => togglePref(ch.key, event.id, enabled)}
                        disabled={loading}
                      />
                      <span className="settings-notif-channel__label">
                        <Icon size={12} />
                        {ch.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Sprint 25 vague 4B — Feedback sensoriel (sons + haptic) ── */}
      <SensorialFeedbackSection />
    </div>
  );
}

// ── SensorialFeedbackSection — Sprint 25 vague 4B ─────────────────────────
// Toggle sons + slider volume + toggle haptic + 7 boutons preview.
// Save instant via localStorage (pas d'API distante).

const SOUND_PREVIEWS: { name: SoundName; label: string; icon: any }[] = [
  { name: 'toggle', label: 'Toggle', icon: ToggleLeft },
  { name: 'success', label: 'Succès', icon: CheckCircle2 },
  { name: 'error', label: 'Erreur', icon: AlertCircle },
  { name: 'notif', label: 'Notif', icon: BellRing },
  { name: 'send', label: 'Send', icon: Send },
  { name: 'celebrate', label: 'Celebrate', icon: Sparkles },
  { name: 'tick', label: 'Tick', icon: MousePointer2 },
];

const HAPTIC_PREVIEWS: { name: HapticIntensity; label: string }[] = [
  { name: 'light', label: 'Light' },
  { name: 'medium', label: 'Medium' },
  { name: 'heavy', label: 'Heavy' },
  { name: 'success', label: 'Succès' },
  { name: 'error', label: 'Erreur' },
];

function SensorialFeedbackSection() {
  const sound = useSound();
  const haptic = useHaptic();

  const lockedByReducedMotion = sound.reducedMotion || haptic.reducedMotion;

  return (
    <Card className="settings-card p-6">
      <header className="settings-section-header">
        <h3 className="t-h3 flex items-center gap-2">
          <UIcon as={Volume2} size={16} className="text-[var(--primary)]" />
          Feedback sensoriel
        </h3>
        <p className="t-caption text-[var(--gray-500)]">
          Sons procéduraux et vibrations subtils. Génération en code, aucun téléchargement.
        </p>
      </header>

      {lockedByReducedMotion && (
        <div className="settings-info-banner settings-info-banner--warning" role="status">
          <UIcon as={AlertCircle} size={16} className="settings-info-banner__icon" />
          <div>
            <p className="settings-info-banner__title">Désactivé par préférence système</p>
            <p className="settings-info-banner__body">
              <code className="settings-inline-code">prefers-reduced-motion: reduce</code> est actif. Sons et vibrations sont automatiquement désactivés.
            </p>
          </div>
        </div>
      )}

      {/* ── Sons ── */}
      <div className="row-premium flex flex-col gap-4 p-4 rounded-xl mb-3">
        <div className="flex items-center justify-between gap-4">
          <Switch
            size="md"
            variant="brand"
            checked={sound.isEnabled}
            onCheckedChange={(v) => sound.setEnabled(v)}
            disabled={sound.reducedMotion}
            label="Sons activés"
            description="7 micro-sons procéduraux (toggle, success, send…)"
          />
        </div>

        {/* Slider volume */}
        <div className={`flex items-center gap-3 ${!sound.isEnabled ? 'opacity-60' : ''}`}>
          <label
            htmlFor="intralys-sound-volume"
            className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide shrink-0 w-16"
          >
            Volume
          </label>
          <input
            id="intralys-sound-volume"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={sound.volume}
            onChange={(e) => sound.setVolume(parseFloat(e.target.value))}
            disabled={!sound.isEnabled || sound.reducedMotion}
            className="flex-1 h-2 rounded-full appearance-none cursor-pointer accent-[var(--primary)]"
            style={{
              background: `linear-gradient(90deg, var(--primary) 0%, var(--primary) ${sound.volume * 100}%, var(--gray-200) ${sound.volume * 100}%, var(--gray-200) 100%)`,
            }}
            aria-label="Volume des sons"
          />
          <span className="text-xs font-mono text-[var(--text-secondary)] tabular-nums w-10 text-right">
            {Math.round(sound.volume * 100)}%
          </span>
        </div>

        {/* Preview buttons */}
        <div>
          <p className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-2">
            Tester les 7 sons
          </p>
          <div className="flex flex-wrap gap-2">
            {SOUND_PREVIEWS.map(({ name, label, icon: Icon }) => (
              <Button
                key={name}
                variant="secondary"
                size="sm"
                leftIcon={<Icon size={14} />}
                disabled={!sound.isEnabled || sound.reducedMotion}
                onClick={() => sound.play(name)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Haptic ── */}
      <div className="row-premium flex flex-col gap-4 p-4 rounded-xl">
        <Switch
          size="md"
          variant="brand"
          checked={haptic.isEnabled}
          onCheckedChange={(v) => haptic.setEnabled(v)}
          disabled={haptic.reducedMotion || !haptic.isSupported}
          label="Vibrations (haptic feedback)"
          description={
            haptic.isSupported
              ? 'Web Vibration API — appareils tactiles uniquement'
              : 'Appareil non tactile détecté — disponible sur mobile/tablette'
          }
        />

        {haptic.isSupported && (
          <div>
            <p className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-2">
              Tester les patterns
            </p>
            <div className="flex flex-wrap gap-2">
              {HAPTIC_PREVIEWS.map(({ name, label }) => (
                <Button
                  key={name}
                  variant="secondary"
                  size="sm"
                  leftIcon={<UIcon as={Vibrate} size={14} />}
                  disabled={!haptic.isEnabled || haptic.reducedMotion}
                  onClick={() => haptic.vibrate(name)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
