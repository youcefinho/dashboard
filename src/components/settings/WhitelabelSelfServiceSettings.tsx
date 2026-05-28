// ── WhitelabelSelfServiceSettings — surface getWhitelabel/updateWhitelabel ──
// 100 % additif. Carte self-service white-label : nom société, logo URL,
// couleur de marque. Flag-aware : si l'endpoint /whitelabel renvoie une erreur
// ou un payload vide, la carte affiche un état neutre sans crasher.
// i18n : clés wlx.* (NON ajoutées aux catalogues — t() renvoie la clé si absente).
import { useState, useEffect, useCallback } from 'react';
import { Card, Button, Input, Skeleton, useToast } from '@/components/ui';
import { getWhitelabel, updateWhitelabel } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Palette } from 'lucide-react';

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// Validation défensive — formats acceptés AVANT envoi serveur.
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
function isValidHex(v: string): boolean {
  return HEX_RE.test(v.trim());
}
function isValidImageUrl(v: string): boolean {
  const s = v.trim();
  if (!s) return true; // vide = pas d'erreur (champ optionnel)
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function WhitelabelSelfServiceSettings() {
  const { success, error: toastError } = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [companyName, setCompanyName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#009DDB');

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    getWhitelabel()
      .then((res) => {
        if (res.error) {
          // Flag-aware : endpoint désactivé / non provisionné → état neutre.
          setLoadError(res.error);
        } else if (res.data) {
          const d = res.data;
          setCompanyName(asString(d.company_name));
          setLogoUrl(asString(d.logo_url));
          const pc = asString(d.primary_color);
          if (pc) setPrimaryColor(pc);
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

  // Validation UI préventive (additif — n'altère pas le happy-path serveur).
  const colorInvalid = primaryColor.trim().length > 0 && !isValidHex(primaryColor);
  const logoInvalid = !isValidImageUrl(logoUrl);
  const canSave = !saving && !colorInvalid && !logoInvalid;

  const handleSave = async () => {
    if (saving) return; // anti double-submit
    if (colorInvalid) { toastError(t('wlx.color_invalid')); return; }
    if (logoInvalid) { toastError(t('wlx.logo_invalid')); return; }
    setSaving(true);
    try {
      const res = await updateWhitelabel({
        company_name: companyName.trim() || undefined,
        logo_url: logoUrl.trim() || undefined,
        primary_color: primaryColor || undefined,
      });
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('wlx.saved'));
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
        <Skeleton className="h-9 w-full rounded-md" />
        <Skeleton className="h-9 w-full rounded-md" />
        <Skeleton className="h-9 w-40 rounded-md" />
      </Card>
    );
  }

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
          <Palette size={18} /> {t('wlx.title')}
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mt-0.5">{t('wlx.desc')}</p>
      </div>

      {loadError && (
        <div
          role="alert"
          aria-live="assertive"
          className="p-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-between gap-3"
        >
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-[var(--danger)]">{t('common.error.title')}</p>
            <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{t('wlx.unavailable')}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={load}>{t('common.retry')}</Button>
        </div>
      )}

      <Input
        label={t('wlx.company_name')}
        value={companyName}
        onChange={(e) => setCompanyName(e.target.value)}
        placeholder={t('wlx.company_name_ph')}
      />
      <Input
        label={t('wlx.logo_url')}
        value={logoUrl}
        onChange={(e) => setLogoUrl(e.target.value)}
        placeholder="https://…/logo.svg"
        type="url"
        aria-invalid={logoInvalid || undefined}
        aria-describedby={logoInvalid ? 'wlx-logo-err' : undefined}
      />
      {logoInvalid && (
        <p id="wlx-logo-err" role="alert" className="text-[11px] text-[var(--danger)] -mt-2">
          {t('wlx.logo_invalid')}
        </p>
      )}
      <div>
        <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
          {t('wlx.brand_color')}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            aria-label={t('wlx.brand_color')}
            className="h-9 w-12 rounded-md border border-[var(--border-subtle)] cursor-pointer bg-transparent"
          />
          <Input
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            placeholder="#009DDB"
            aria-label={t('wlx.brand_color')}
            aria-invalid={colorInvalid || undefined}
            aria-describedby={colorInvalid ? 'wlx-color-err' : undefined}
            className="font-mono"
          />
        </div>
        {colorInvalid && (
          <p id="wlx-color-err" role="alert" className="text-[11px] text-[var(--danger)] mt-1">
            {t('wlx.color_invalid')}
          </p>
        )}
      </div>

      <div>
        <Button onClick={() => void handleSave()} disabled={!canSave} aria-busy={saving}>
          {saving ? t('wlx.saving') : t('wlx.save')}
        </Button>
      </div>
    </Card>
  );
}
