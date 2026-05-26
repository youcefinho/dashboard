// ── ProfileSettings — Sprint 23 W31 : Avatar primitive + Textarea premium + row-premium
// ── Sprint 24 vague 6A — autosave debounced (1.2s) + cmd+S force save
// ── Sprint 48 M2.4 — Language switcher wired (4 langues + auto-detect)
import { useMemo, useState } from 'react';
import { Card, Button, Input, Tag, Avatar, Textarea, Skeleton, useToast, AutosaveIndicator } from '@/components/ui';
import { updateProfile } from '@/lib/api';
import { useAutosave } from '@/hooks/useAutosave';
import { getLocale, setLocale, availableLocaleOptions, t, type Locale } from '@/lib/i18n';
// Sprint 48 M3.4 — Timezone wirage
import {
  listTimezones,
  getStoredTimezone,
  setStoredTimezone,
  getDetectedTimezone,
} from '@/lib/i18n/timezone';

export function ProfileSettings({ user, isAdmin }: { user: any; isAdmin: boolean }) {
  const [profileName, setProfileName] = useState(user?.name || 'Admin');
  const [profileEmail, setProfileEmail] = useState(user?.email || '');
  const [profilePhone, setProfilePhone] = useState('');
  const [emailSignature, setEmailSignature] = useState(user?.email_signature || '');
  const [loading, setLoading] = useState(false);
  // Sprint 48 M2.4 — locale state synced avec lib/i18n
  const [currentLocale, setCurrentLocale] = useState<Locale>(getLocale());
  const localeOptions = availableLocaleOptions();
  // Sprint 48 M3.4 — timezone state synced avec lib/i18n/timezone
  const [currentTimezone, setCurrentTimezone] = useState<string>(getStoredTimezone());
  const detectedTz = useMemo(() => getDetectedTimezone(), []);
  const timezoneOptions = useMemo(() => listTimezones(), []);
  const { success, error: toastError } = useToast();

  const handleLocaleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as Locale;
    setCurrentLocale(next);
    // setLocale reload la page par défaut pour repaint complet des t()
    setLocale(next);
  };

  const handleTimezoneChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    setCurrentTimezone(next);
    setStoredTimezone(next);
  };

  // Sprint 24 vague 6A — autosave hook
  const autosaveValue = useMemo(
    () => ({ name: profileName, email_signature: emailSignature }),
    [profileName, emailSignature]
  );
  const { state: autosaveState, lastSaved, retry } = useAutosave({
    value: autosaveValue,
    disabled: !user,
    onSave: async (val) => {
      const res = await updateProfile(val);
      if (res.error) throw new Error(res.error);
    },
  });

  // Skeleton initial si user pas encore chargé — matche layout : avatar + identity + 4 fields + actions
  if (!user) {
    return (
      <Card className="p-5">
        <div className="row-premium flex items-center gap-4 p-4 mb-5 rounded-xl">
          <Skeleton className="h-16 w-16 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" style={{ animationDelay: '40ms' }} />
            <Skeleton className="h-3 w-56" style={{ animationDelay: '80ms' }} />
            <Skeleton className="h-4 w-24 rounded-md" style={{ animationDelay: '120ms' }} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1.5" style={{ animationDelay: `${(i + 4) * 40}ms` }}>
              <Skeleton className="h-2.5 w-20" style={{ animationDelay: `${(i + 4) * 40}ms` }} />
              <Skeleton className="h-9 w-full rounded-md" style={{ animationDelay: `${(i + 4) * 40 + 20}ms` }} />
            </div>
          ))}
          <div className="sm:col-span-2 space-y-1.5">
            <Skeleton className="h-2.5 w-40" style={{ animationDelay: '320ms' }} />
            <Skeleton className="h-24 w-full rounded-md" style={{ animationDelay: '360ms' }} />
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Skeleton className="h-9 w-44 rounded-lg" style={{ animationDelay: '400ms' }} />
        </div>
      </Card>
    );
  }

  const handleSave = async () => {
    setLoading(true);
    const res = await updateProfile({
      name: profileName,
      email_signature: emailSignature,
    });
    setLoading(false);
    if (!res.error) {
      success('Profil mis à jour');
    } else {
      toastError(res.error);
    }
  };

  return (
    <Card className="settings-card p-6 relative">
      {/* Autosave indicator chip top-right */}
      <div className="settings-autosave-slot">
        <AutosaveIndicator state={autosaveState} lastSaved={lastSaved} onRetry={retry} />
      </div>

      {/* Section header Stripe — accent ::before primary */}
      <header className="settings-section-header">
        <h3 className="t-h3">Profil personnel</h3>
        <p className="t-caption text-[var(--gray-500)]">{t('profile_settings.subtitle')}</p>
      </header>

      {/* Identity row Stripe-sober */}
      <div className="settings-identity-row">
        <Avatar size="xl" name={profileName} ring="active" />
        <div className="flex-1 min-w-0">
          <h4 className="t-h3 text-[var(--gray-900)]">{profileName}</h4>
          <p className="t-body text-[var(--gray-500)] truncate">{profileEmail || '—'}</p>
          <div className="mt-1.5">
            <Tag dot variant={isAdmin ? 'brand' : 'info'} size="sm">
              {isAdmin ? 'Administrateur' : 'Utilisateur'}
            </Tag>
          </div>
        </div>
      </div>

      {/* Form rows Stripe pattern */}
      <div className="settings-form-grid">
        <div className="settings-form-row">
          <label className="settings-label">Nom complet</label>
          <Input value={profileName} onChange={(e: any) => setProfileName(e.target.value)} />
        </div>
        <div className="settings-form-row">
          <label className="settings-label">Courriel</label>
          <Input value={profileEmail} onChange={(e: any) => setProfileEmail(e.target.value)} type="email" disabled />
          <p className="settings-helper">Pour changer ton courriel, contacte le support.</p>
        </div>
        <div className="settings-form-row">
          <label className="settings-label">Téléphone</label>
          <Input value={profilePhone} onChange={(e: any) => setProfilePhone(e.target.value)} placeholder="+1 819 555-0000" />
        </div>
        <div className="settings-form-row">
          <label className="settings-label">Langue</label>
          <select
            className="settings-select"
            value={currentLocale}
            onChange={handleLocaleChange}
            aria-label="Langue de l'interface"
          >
            {localeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.native}
              </option>
            ))}
          </select>
          <p className="settings-helper">
            Le changement de langue rafraîchit la page pour appliquer la traduction partout.
          </p>
        </div>
        <div className="settings-form-row settings-form-row--full">
          <label className="settings-label">Fuseau horaire</label>
          <select
            className="settings-select"
            value={currentTimezone}
            onChange={handleTimezoneChange}
            aria-label="Fuseau horaire d'affichage"
          >
            {timezoneOptions.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <p className="settings-helper">
            Dates et heures sont affichées dans ce fuseau. Détecté : {detectedTz.replace(/_/g, ' ')}.
          </p>
        </div>
        <div className="settings-form-row settings-form-row--full">
          <label className="settings-label">Signature courriel</label>
          <Textarea
            placeholder="Cordialement,<br/><b>Mon Nom</b>"
            value={emailSignature}
            onChange={(e) => setEmailSignature(e.target.value)}
            maxLength={500}
            showCounter
            className="font-mono h-24"
          />
          <p className="settings-helper">Insérée automatiquement en bas des courriels sortants. HTML accepté.</p>
        </div>
      </div>

      <div className="settings-actions">
        <Button onClick={handleSave} disabled={loading} isLoading={loading}>
          Mettre à jour le profil
        </Button>
      </div>
    </Card>
  );
}
