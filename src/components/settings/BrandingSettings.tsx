// ── BrandingSettings — Sprint 23 W32 : ColorSwatch + Textarea premium + useToast + dropzone visual
// ── Sprint 24 vague 6A — autosave debounced (1.2s) + cmd+S
// ── Sprint 26 vague 26-3B — bouton "Configurer ma marque" CTA déclenche <Wizard> 4 steps (Logo / Couleurs / Société / Pages publiques)
import { useMemo, useState, useCallback, useEffect, type DragEvent as ReactDragEvent } from 'react';
import {
  Card,
  Button,
  Input,
  Textarea,
  ColorSwatch,
  useToast,
  useConfirm,
  AutosaveIndicator,
  Switch,
  Tag,
  Wizard,
  type WizardStep,
  Icon,
} from '@/components/ui';
import {
  ImagePlus,
  Palette,
  Sparkles,
  Building2,
  Globe,
  ExternalLink,
  X,
  Check,
  Link2,
  Trash2,
  Plus,
} from 'lucide-react';
import { useAutosave } from '@/hooks/useAutosave';
import {
  getActiveSubAccount,
  getClientBranding,
  updateClientBranding,
  getCustomDomains,
  addCustomDomain,
  deleteCustomDomain,
} from '@/lib/api';
import type { CustomHostname } from '@/lib/types';
import { t } from '@/lib/i18n';

const BRAND_PRESETS = ['#009DDB', '#D96E27', '#37CA37', '#FF9A00', '#E93D3D', '#188BF6', '#8B5CF6'];

// ── Sprint 26 vague 26-3B — presets palettes prédéfinies (primary + accent cohérents)
const COLOR_PALETTES: Array<{ id: string; name: string; primary: string; accent: string }> = [
  { id: 'intralys', name: 'Intralys', primary: '#009DDB', accent: '#D96E27' },
  { id: 'forest', name: 'Forêt', primary: '#10B981', accent: '#84CC16' },
  { id: 'sunset', name: 'Coucher', primary: '#F59E0B', accent: '#EF4444' },
  { id: 'ocean', name: 'Océan', primary: '#0EA5E9', accent: '#6366F1' },
  { id: 'royal', name: 'Royal', primary: '#8B5CF6', accent: '#EC4899' },
];

// ── LOT G9 White-label — mapping statut hostname → variant Tag + libellé i18n.
//    pending → warning · active → success · failed → danger (clés whitelabel.*).
function domainStatusTag(status: string): { variant: 'warning' | 'success' | 'danger'; label: string } {
  switch (status) {
    case 'active':
      return { variant: 'success', label: t('whitelabel.status_active') };
    case 'failed':
      return { variant: 'danger', label: t('whitelabel.status_failed') };
    default:
      return { variant: 'warning', label: t('whitelabel.status_pending') };
  }
}

export function BrandingSettings() {
  const { success, error } = useToast();
  const confirm = useConfirm();
  const [primary, setPrimary] = useState<string>('#009DDB');
  const [accent, setAccent] = useState<string>('#D96E27');
  const [companyName, setCompanyName] = useState('Intralys Demo');
  const [address, setAddress] = useState('123 rue de la Demo, Québec');
  const [logoFile, setLogoFile] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  // ── LOT WHITE-LABEL APPLY (Sprint 20) — nouveaux champs white-label, sérialisés
  //    dans le MÊME JSON `branding` (clés additionnelles, AUCUNE migration) :
  //    favicon (URL ou data-URI base64 comme le logo), sender_name (nom
  //    d'expéditeur email), remove_powered_by (masque « Propulsé par Intralys »).
  const [favicon, setFavicon] = useState<string>('');
  const [senderName, setSenderName] = useState<string>('');
  const [removePoweredBy, setRemovePoweredBy] = useState<boolean>(false);

  // ── Sprint 26 vague 26-3B — wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [publicPagesEnabled, setPublicPagesEnabled] = useState(false);
  const [publicSlug, setPublicSlug] = useState('');

  // ── LOT TEAM C — sous-compte cible = résolution canonique SaaS
  //    (getActiveSubAccount, même clé que le header X-Sub-Account injecté par
  //    apiFetch). Null en legacy/mono-tenant : on dégrade alors sur le brouillon
  //    local (pas d'endpoint sous-compte côté legacy), sans casser l'UX.
  const subAccountId = useMemo(() => getActiveSubAccount(), []);

  // ── LOT G9 White-label — état domaine personnalisé (par sous-compte/tenant) ──
  // getCustomDomains/addCustomDomain/deleteCustomDomain (api.ts GELÉ Phase A).
  // Le provisioning auto est INACTIF (flag worker off) : un domaine ajouté
  // reste 'pending' tant que l'admin n'a pas activé Cloudflare for SaaS.
  const [domains, setDomains] = useState<CustomHostname[]>([]);
  const [newHostname, setNewHostname] = useState('');
  const [domainBusy, setDomainBusy] = useState(false);

  const loadDomains = useCallback(async () => {
    if (!subAccountId) return;
    const res = await getCustomDomains(subAccountId);
    // ApiResponse INCHANGÉ : on lit `data`, jamais de res.code (§6.A).
    if (res.data) setDomains(res.data);
  }, [subAccountId]);

  useEffect(() => {
    void loadDomains();
  }, [loadDomains]);

  const handleAddDomain = useCallback(async () => {
    const hostname = newHostname.trim().toLowerCase();
    if (!hostname || !subAccountId || domainBusy) return;
    setDomainBusy(true);
    const res = await addCustomDomain(subAccountId, hostname);
    setDomainBusy(false);
    // Discrimination erreur = string-match / absence `data` (apiFetch GELÉ).
    if (res.error || !res.data) {
      error(res.error || t('whitelabel.add'));
      return;
    }
    setNewHostname('');
    success(t('whitelabel.add'));
    void loadDomains();
  }, [newHostname, subAccountId, domainBusy, error, success, loadDomains]);

  const handleDeleteDomain = useCallback(
    async (host: CustomHostname) => {
      if (!subAccountId) return;
      const ok = await confirm({
        title: t('whitelabel.delete'),
        description: host.hostname,
        confirmLabel: t('whitelabel.delete'),
        danger: true,
      });
      if (!ok) return;
      const res = await deleteCustomDomain(subAccountId, host.id);
      if (res.error || !res.data) {
        error(res.error || t('whitelabel.delete'));
        return;
      }
      success(t('whitelabel.delete'));
      void loadDomains();
    },
    [subAccountId, confirm, error, success, loadDomains]
  );

  // Charge le branding réel du sous-compte actif (best-effort, jamais throw).
  useEffect(() => {
    if (!subAccountId) return;
    let cancelled = false;
    void (async () => {
      const res = await getClientBranding(subAccountId);
      if (cancelled || !res.data) return;
      const d = res.data;
      if (d.primary_color) setPrimary(d.primary_color);
      if (d.accent_color) setAccent(d.accent_color);
      if (d.logo_url) setLogoFile(d.logo_url);
      if (d.branding) {
        try {
          const meta = JSON.parse(d.branding) as {
            companyName?: string;
            company_name?: string;
            address?: string;
            websiteUrl?: string;
            shortDescription?: string;
            favicon?: string | null;
            sender_name?: string | null;
            remove_powered_by?: boolean;
          };
          // company_name canonique (propagation) ; companyName = repli historique.
          if (meta.company_name || meta.companyName) setCompanyName((meta.company_name || meta.companyName)!);
          if (meta.address) setAddress(meta.address);
          if (meta.websiteUrl) setWebsiteUrl(meta.websiteUrl);
          if (meta.shortDescription) setShortDescription(meta.shortDescription);
          // ── LOT WHITE-LABEL APPLY (Sprint 20) — relecture des nouvelles clés.
          if (typeof meta.favicon === 'string') setFavicon(meta.favicon);
          if (typeof meta.sender_name === 'string') setSenderName(meta.sender_name);
          if (typeof meta.remove_powered_by === 'boolean') setRemovePoweredBy(meta.remove_powered_by);
        } catch {
          /* branding non-JSON (legacy) : on ignore, valeurs par défaut */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subAccountId]);

  // Construit le payload branding (colonnes seq 81 ; les méta textuelles sont
  // sérialisées dans la colonne `branding` JSON — colonnes dédiées = couleurs/
  // logo, alignées sur le contrat §6.F).
  const buildBrandingBody = useCallback(
    () => ({
      branding: JSON.stringify({
        // company_name = graphie canonique (propagation Sidebar/footer/title) ;
        // companyName conservé en repli pour rétro-compat lecture (§6.G/§6.I-12).
        company_name: companyName,
        companyName,
        address,
        websiteUrl,
        shortDescription,
        // ── LOT WHITE-LABEL APPLY (Sprint 20) — clés additionnelles (même JSON,
        //    aucune migration). favicon/sender_name normalisés à null si vides.
        favicon: favicon.trim().length > 0 ? favicon.trim() : null,
        sender_name: senderName.trim().length > 0 ? senderName.trim() : null,
        remove_powered_by: removePoweredBy,
      }),
      logo_url: logoFile,
      primary_color: primary,
      accent_color: accent,
    }),
    [companyName, address, websiteUrl, shortDescription, favicon, senderName, removePoweredBy, logoFile, primary, accent]
  );

  const handleSave = async () => {
    if (!subAccountId) {
      success(t('set.brand.success'));
      return;
    }
    const res = await updateClientBranding(subAccountId, buildBrandingBody());
    // Discrimination erreur = string-match / absence `data` (apiFetch GELÉ,
    // §6.A — JAMAIS de res.code).
    if (res.error || !res.data) {
      error(t('branding.subaccount.error'));
      return;
    }
    // LOT WHITE-LABEL APPLY (Sprint 20) — confirme l'application de la marque.
    success(t('whitelabel.applied'));
  };

  // Sprint 24 vague 6A — autosave : endpoint branding réel (sous-compte actif)
  // ou brouillon local en legacy/mono-tenant (pas d'endpoint sous-compte).
  const autosaveValue = useMemo(
    () => ({ primary, accent, companyName, address, websiteUrl, shortDescription, favicon, senderName, removePoweredBy, publicPagesEnabled, publicSlug }),
    [primary, accent, companyName, address, websiteUrl, shortDescription, favicon, senderName, removePoweredBy, publicPagesEnabled, publicSlug]
  );
  const { state: autosaveState, lastSaved, retry } = useAutosave({
    value: autosaveValue,
    onSave: async () => {
      if (!subAccountId) {
        try {
          localStorage.setItem('intralys_branding_draft', JSON.stringify(autosaveValue));
        } catch {
          throw new Error('Échec sauvegarde locale');
        }
        return;
      }
      const res = await updateClientBranding(subAccountId, buildBrandingBody());
      if (res.error || !res.data) {
        throw new Error(res.error || t('branding.subaccount.error'));
      }
    },
  });

  // ── Sprint 26 vague 26-3B — autotrigger wizard si branding vide (premier login)
  useEffect(() => {
    try {
      const flagKey = 'intralys_branding_wizard_seen';
      const seen = localStorage.getItem(flagKey);
      const draft = localStorage.getItem('intralys_branding_draft');
      if (!seen && !draft) {
        // Pas de wizard auto-open en mode démo (companyName preset), mais flag posé
        // pour bypass au prochain mount. Décommenter pour real production :
        // setWizardOpen(true);
        localStorage.setItem(flagKey, '1');
      }
    } catch {
      /* ignore */
    }
  }, []);

  const handleDragOver = useCallback((e: ReactDragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: ReactDragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleFile = useCallback((file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setLogoFile(ev.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: ReactDragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  }, [handleFile]);

  const openWizard = () => {
    setWizardStep(0);
    setWizardOpen(true);
  };

  const completeWizard = () => {
    setWizardOpen(false);
    setWizardStep(0);
    success(t('set.brand.wizard_success'));
  };

  // ── Sprint 26 vague 26-3B — steps definition
  const wizardSteps: WizardStep[] = useMemo(
    () => [
      {
        id: 'logo',
        label: 'Logo',  // universal
        icon: <ImagePlus size={14} />,
        isOptional: true,
        isValid: () => true,
        content: (
          <div className="space-y-5">
            <div className="flex items-start gap-3 p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
              <div className="p-2 rounded-lg bg-[var(--brand-tint)] text-[var(--primary)] shrink-0">
                <ImagePlus size={16} />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">{t('set.brand.logo_title')}</h4>
                <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
                  {t('set.brand.logo_desc')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-6 flex-wrap justify-center">
              {/* Dropzone */}
              <label
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`relative w-44 h-44 rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer transition-all border-2 border-dashed
                  ${isDragOver
                    ? 'border-[var(--primary)] bg-[linear-gradient(135deg,rgba(0,157,219,0.18)_0%,rgba(217,110,39,0.12)_100%)] scale-[1.02] shadow-[0_0_24px_-4px_rgba(0,157,219,0.45)]'
                    : 'border-[var(--border-strong)] bg-[var(--bg-subtle)] hover:border-[var(--primary)] hover:bg-[linear-gradient(135deg,rgba(0,157,219,0.10)_0%,rgba(217,110,39,0.06)_100%)] hover:shadow-[0_4px_16px_-4px_rgba(0,157,219,0.30)] hover:-translate-y-px'
                  }`}
              >
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                  className="sr-only"
                />
                {logoFile ? (
                  /* Sprint 43 M1.3 — loading=lazy + decoding=async (preview Settings hors AT) */
                  <img src={logoFile} alt="Logo" className="max-w-[80%] max-h-[80%] rounded-lg object-contain" loading="lazy" decoding="async" />
                ) : (
                  <>
                    <ImagePlus size={32} className={`mb-2 transition-colors ${isDragOver ? 'text-[var(--primary)]' : 'text-[var(--text-muted)]'}`} />
                    <span className="text-xs font-semibold text-[var(--text-secondary)]">
                      {isDragOver ? t('set.brand.drop_here') : t('set.brand.drag_click')}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] mt-0.5">PNG, JPG ou SVG</span>
                  </>
                )}
              </label>

              {/* Preview circular crop */}
              <div className="flex flex-col items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{t('set.brand.preview_round')}</p>
                <div
                  className="w-24 h-24 rounded-full flex items-center justify-center overflow-hidden"
                  style={{
                    background: logoFile
                      ? 'var(--bg-surface)'
                      : 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
                    border: '2px solid rgba(0,157,219,0.20)',
                    boxShadow: '0 4px 16px -4px rgba(0,157,219,0.35)',
                  }}
                >
                  {logoFile ? (
                    <img src={logoFile} alt="Logo aperçu" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  ) : (
                    <span className="text-white font-bold text-2xl">
                      {companyName.slice(0, 2).toUpperCase() || 'IL'}
                    </span>
                  )}
                </div>
                {logoFile && (
                  <button
                    type="button"
                    onClick={() => setLogoFile(null)}
                    className="text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--danger)] inline-flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <X size={12} />
                    {t('set.brand.remove')}
                  </button>
                )}
              </div>
            </div>

            <p className="text-[11px] text-center text-[var(--text-muted)] italic">
              {t('set.brand.optional_step')}
            </p>
          </div>
        ),
      },
      {
        id: 'colors',
        label: t('set.brand.colors_step'),
        icon: <Palette size={14} />,
        isValid: () => /^#[0-9A-Fa-f]{6}$/.test(primary) && /^#[0-9A-Fa-f]{6}$/.test(accent),
        content: (
          <div className="space-y-5">
            <div className="flex items-start gap-3 p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
              <div className="p-2 rounded-lg bg-[var(--brand-tint)] text-[var(--primary)] shrink-0">
                <Palette size={16} />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">{t('set.brand.colors_title')}</h4>
                <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
                  {t('set.brand.colors_desc')}
                </p>
              </div>
            </div>

            {/* Palettes prédéfinies */}
            <div>
              <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2 block">
                {t('set.brand.suggested')}
              </label>
              <div className="flex gap-2 flex-wrap">
                {COLOR_PALETTES.map((palette) => {
                  const isActive = primary === palette.primary && accent === palette.accent;
                  return (
                    <button
                      key={palette.id}
                      type="button"
                      onClick={() => {
                        setPrimary(palette.primary);
                        setAccent(palette.accent);
                      }}
                      className={`relative flex items-center gap-2 px-3 py-2 rounded-xl border transition-all cursor-pointer ${
                        isActive
                          ? 'border-[var(--primary)] shadow-[0_4px_16px_-4px_rgba(0,157,219,0.45)]'
                          : 'border-[var(--border-default)] hover:border-[var(--primary)] hover:-translate-y-px'
                      }`}
                      style={{
                        background: isActive
                          ? 'linear-gradient(135deg, rgba(0,157,219,0.08) 0%, rgba(217,110,39,0.05) 100%)'
                          : 'var(--bg-surface)',
                      }}
                    >
                      <span className="flex -space-x-1.5">
                        <span
                          className="w-5 h-5 rounded-full border-2 border-white shadow-sm"
                          style={{ background: palette.primary }}
                        />
                        <span
                          className="w-5 h-5 rounded-full border-2 border-white shadow-sm"
                          style={{ background: palette.accent }}
                        />
                      </span>
                      <span className="text-xs font-semibold text-[var(--text-primary)]">{palette.name}</span>
                      {isActive && (
                        <Check size={12} className="text-[var(--primary)]" strokeWidth={3} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ColorSwatch
                label={t('set.brand.primary')}
                value={primary}
                onChange={setPrimary}
                presets={BRAND_PRESETS}
                size="md"
              />
              <ColorSwatch
                label={t('set.brand.accent')}
                value={accent}
                onChange={setAccent}
                presets={BRAND_PRESETS}
                size="md"
              />
            </div>

            {/* Preview gradient brand */}
            <div className="p-4 rounded-xl border border-[var(--border-subtle)]">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                {t('set.brand.gradient_preview')}
              </p>
              <div
                className="h-14 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                style={{
                  background: `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)`,
                  boxShadow: `0 4px 18px -4px ${primary}88, 0 0 24px -8px ${accent}55`,
                }}
              >
                {companyName || 'Votre marque'}
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'company',
        label: t('set.brand.company_step'),
        icon: <Building2 size={14} />,
        isValid: () => companyName.trim().length > 0,
        content: (
          <div className="space-y-5">
            <div className="flex items-start gap-3 p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
              <div className="p-2 rounded-lg bg-[var(--brand-tint)] text-[var(--primary)] shrink-0">
                <Building2 size={16} />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">{t('set.brand.company_title')}</h4>
                <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
                  {t('set.brand.company_desc')}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5 block">
                  {t('set.brand.company_name')} <span className="text-[var(--danger)]">*</span>
                </label>
                <Input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Ex. Agence Tremblay Immobilier"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5 block">
                  {t('set.brand.website')}
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-muted)] px-2.5 py-2 rounded-md bg-[var(--bg-subtle)] border border-[var(--border-subtle)] shrink-0">
                    https://
                  </span>
                  <Input
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder="agence-tremblay.com"
                    className="flex-1"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5 block">
                  {t('set.brand.short_desc')}
                </label>
                <Textarea
                  value={shortDescription}
                  onChange={(e) => setShortDescription(e.target.value)}
                  placeholder="Une phrase qui décrit votre activité — visible sur vos pages publiques."
                  className="h-[80px]"
                  maxLength={200}
                  showCounter
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5 block">
                  {t('set.brand.address')}
                </label>
                <Textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="h-[72px]"
                  maxLength={240}
                  showCounter
                />
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'public',
        label: t('set.brand.public_step'),
        icon: <Globe size={14} />,
        isOptional: true,
        isValid: () => !publicPagesEnabled || publicSlug.trim().length > 2,
        content: (
          <div className="space-y-5">
            <div className="flex items-start gap-3 p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
              <div className="p-2 rounded-lg bg-[var(--brand-tint)] text-[var(--primary)] shrink-0">
                <Globe size={16} />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">{t('set.brand.public_title')}</h4>
                <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
                  {t('set.brand.public_desc')}
                </p>
              </div>
            </div>

            <Switch
              checked={publicPagesEnabled}
              onCheckedChange={setPublicPagesEnabled}
              label={t('set.brand.public_toggle')}
              description={t('set.brand.public_toggle_desc')}
            />

            {publicPagesEnabled && (
              <>
                <div>
                  <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5 block">
                    {t('set.brand.public_url')}
                  </label>
                  <div className="flex items-center gap-0">
                    <span className="text-xs text-[var(--text-muted)] px-2.5 py-2 rounded-l-md bg-[var(--bg-subtle)] border border-r-0 border-[var(--border-subtle)] shrink-0">
                      intralys.app/p/
                    </span>
                    <Input
                      value={publicSlug}
                      onChange={(e) =>
                        setPublicSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
                      }
                      placeholder="agence-tremblay"
                      className="flex-1 rounded-l-none"
                    />
                  </div>
                  {publicSlug.trim().length > 0 && publicSlug.trim().length <= 2 && (
                    <p className="text-[11px] text-[var(--danger)] mt-1">{t('set.brand.slug_min')}</p>
                  )}
                </div>

                {/* Aperçu landing */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                      {t('set.brand.preview_landing')}
                    </label>
                    {publicSlug.trim().length > 2 && (
                      <a
                        href={`https://intralys.app/p/${publicSlug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-semibold text-[var(--primary)] hover:underline inline-flex items-center gap-1"
                      >
                        <ExternalLink size={11} />
                        {t('set.brand.open')}
                      </a>
                    )}
                  </div>
                  <div
                    className="rounded-xl border border-[var(--border-subtle)] overflow-hidden"
                    style={{
                      background: `linear-gradient(180deg, ${primary}14 0%, rgba(255,255,255,1) 50%)`,
                    }}
                  >
                    <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center gap-2 bg-white/60">
                      <div
                        className="w-8 h-8 rounded-md flex items-center justify-center overflow-hidden"
                        style={{
                          background: logoFile ? 'transparent' : `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)`,
                        }}
                      >
                        {logoFile ? (
                          <img src={logoFile} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                        ) : (
                          <span className="text-white text-[10px] font-bold">
                            {companyName.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <span className="text-sm font-bold text-[var(--text-primary)]">{companyName}</span>
                    </div>
                    <div className="p-6 text-center">
                      <h3
                        className="text-xl font-bold mb-2"
                        style={{
                          background: `linear-gradient(90deg, ${primary} 0%, ${accent} 100%)`,
                          WebkitBackgroundClip: 'text',
                          WebkitTextFillColor: 'transparent',
                          backgroundClip: 'text',
                        }}
                      >
                        {companyName || t('set.brand.your_brand')}
                      </h3>
                      <p className="text-xs text-[var(--text-secondary)] mb-4 leading-relaxed">
                        {shortDescription || t('set.brand.desc_placeholder')}
                      </p>
                      <span
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-white text-xs font-semibold"
                        style={{
                          background: `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)`,
                          boxShadow: `0 4px 14px -2px ${primary}66`,
                        }}
                      >
                        {t('set.brand.cta')}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}

            <p className="text-[11px] text-center text-[var(--text-muted)] italic">
              {t('set.brand.optional_public')}
            </p>
          </div>
        ),
      },
    ],
    [
      logoFile,
      isDragOver,
      primary,
      accent,
      companyName,
      websiteUrl,
      shortDescription,
      address,
      publicPagesEnabled,
      publicSlug,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      handleFile,
    ]
  );

  return (
    <>
      <Card className="settings-card p-6 relative">
        <div className="settings-autosave-slot">
          <AutosaveIndicator state={autosaveState} lastSaved={lastSaved} onRetry={retry} />
        </div>

        <header className="settings-section-header settings-section-header--with-action">
          <div>
            <h3 className="t-h3 flex items-center gap-2">
               <Icon as={Palette} size="md" className="text-[var(--primary)]" /> {t('set.brand.title')}
            </h3>
            <p className="t-caption text-[var(--gray-500)]">{t('set.brand.subtitle')}</p>
          </div>
          <Button variant="primary" size="sm" onClick={openWizard} leftIcon={<Icon as={Sparkles} size="sm" />}>
             {t('set.brand.configure')}
          </Button>
        </header>

        <div className="settings-branding-grid">
          {/* Logo dropzone — Stripe sober */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`settings-dropzone ${isDragOver ? 'is-drag-over' : ''}`}
          >
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleFile(e.target.files?.[0])}
              className="sr-only"
              id="branding-logo-input"
            />
            <label htmlFor="branding-logo-input" className="settings-dropzone__label">
              {logoFile ? (
                <img src={logoFile} alt="Logo" className="settings-dropzone__preview" loading="lazy" decoding="async" />
              ) : (
                <>
                  <Icon as={ImagePlus} size="lg" className="settings-dropzone__icon" />
                  <span className="settings-dropzone__title">
                    {isDragOver ? t('set.brand.drop_here_main') : t('set.brand.upload_logo')}
                  </span>
                  <span className="settings-dropzone__hint">PNG, JPG, SVG</span>
                </>
              )}
            </label>
          </div>

          <div className="settings-color-block">
            <ColorSwatch
              label="Couleur principale"
              value={primary}
              onChange={setPrimary}
              presets={BRAND_PRESETS}
              size="md"
            />
          </div>
        </div>

        <div className="settings-form-grid">
          <div className="settings-form-row settings-form-row--full">
            <label className="settings-label">{t('set.brand.company_name')}</label>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>
          <div className="settings-form-row settings-form-row--full">
            <label className="settings-label">{t('set.brand.address')}</label>
            <Textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="h-[72px]"
              maxLength={240}
              showCounter
            />
          </div>
        </div>

        {/* ── LOT WHITE-LABEL APPLY (Sprint 20) — champs white-label additionnels.
            favicon (URL ou base64 comme le logo) + sender_name + toggle
            remove_powered_by, sérialisés dans le MÊME JSON `branding`. */}
        <div className="settings-form-grid">
          <div className="settings-form-row settings-form-row--full">
            <label className="settings-label">{t('whitelabel.favicon')}</label>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-md flex items-center justify-center shrink-0 overflow-hidden bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                {favicon.trim().length > 0 ? (
                  <img src={favicon.trim()} alt="Favicon" className="w-full h-full object-contain" loading="lazy" decoding="async" />
                ) : (
                  <Icon as={ImagePlus} size="sm" className="text-[var(--text-muted)]" />
                )}
              </div>
              <Input
                value={favicon}
                onChange={(e) => setFavicon(e.target.value)}
                placeholder="https://… (ou data:image/…)"
                className="flex-1"
              />
              <input
                type="file"
                accept="image/*"
                id="branding-favicon-input"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => setFavicon(ev.target?.result as string);
                  reader.readAsDataURL(file);
                }}
              />
              <label
                htmlFor="branding-favicon-input"
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer shrink-0"
              >
                <Icon as={ImagePlus} size="sm" />
                {t('whitelabel.favicon')}
              </label>
              {favicon.trim().length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setFavicon('')} leftIcon={<Icon as={X} size="sm" />}>
                  {t('set.brand.remove')}
                </Button>
              )}
            </div>
          </div>

          <div className="settings-form-row settings-form-row--full">
            <label className="settings-label">{t('whitelabel.sender_name')}</label>
            <Input
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder="Ex. Agence Tremblay"
            />
          </div>

          <div className="settings-form-row settings-form-row--full">
            <Switch
              checked={removePoweredBy}
              onCheckedChange={setRemovePoweredBy}
              label={t('whitelabel.remove_powered_by')}
            />
          </div>
        </div>

        {/* Aperçu sobre — wordmark/logo Sidebar tel qu'appliqué (Stripe-clean). */}
        <div className="settings-form-grid">
          <div className="settings-form-row settings-form-row--full">
            <label className="settings-label">{t('whitelabel.preview')}</label>
            <div className="flex items-center gap-2.5 p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
              <div
                className="w-9 h-9 rounded-md flex items-center justify-center shrink-0 overflow-hidden text-white font-bold text-[15px]"
                style={{ background: logoFile ? 'var(--bg-surface)' : `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)` }}
              >
                {logoFile ? (
                  <img src={logoFile} alt="" className="w-full h-full object-contain" loading="lazy" decoding="async" />
                ) : (
                  (companyName.trim().charAt(0) || 'I').toUpperCase()
                )}
              </div>
              <div className="overflow-hidden">
                <span className="block text-[15px] font-bold leading-tight text-[var(--primary)] truncate">
                  {companyName.trim() || 'Intralys'}
                </span>
                {!companyName.trim() && (
                  <span className="block text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">CRM</span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="settings-actions">
          <Button onClick={handleSave}>{t('set.brand.save')}</Button>
        </div>
      </Card>

      {/* ── LOT G9 White-label — Domaine personnalisé (par sous-compte/tenant) ── */}
      <Card className="settings-card p-6">
        <header className="settings-section-header">
          <div>
            <h3 className="t-h3 flex items-center gap-2">
              <Icon as={Link2} size="md" className="text-[var(--primary)]" /> {t('whitelabel.title')}
            </h3>
          </div>
        </header>

        {/* Liste des domaines mappés au tenant */}
        {domains.length === 0 ? (
          <p className="g9-domain-empty">{t('whitelabel.empty')}</p>
        ) : (
          <ul className="g9-domain-list">
            {domains.map((host) => {
              const st = domainStatusTag(host.status);
              return (
                <li key={host.id} className="g9-domain-row">
                  <div className="g9-domain-info">
                    <span className="g9-domain-host">{host.hostname}</span>
                    <span className="g9-domain-meta">
                      {t('whitelabel.dkim_status')} : {host.dkim_status}
                    </span>
                  </div>
                  <div className="g9-domain-actions">
                    <Tag variant={st.variant} statusIcon>
                      {st.label}
                    </Tag>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteDomain(host)}
                      leftIcon={<Icon as={Trash2} size="sm" />}
                    >
                      {t('whitelabel.delete')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Ajout d'un hostname */}
        <div className="g9-domain-add">
          <Input
            value={newHostname}
            onChange={(e) => setNewHostname(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleAddDomain();
              }
            }}
            placeholder={t('whitelabel.hostname_placeholder')}
            className="flex-1"
          />
          <Button
            variant="primary"
            onClick={handleAddDomain}
            disabled={domainBusy || newHostname.trim().length === 0}
            leftIcon={<Icon as={Plus} size="sm" />}
          >
            {t('whitelabel.add')}
          </Button>
        </div>

        {/* Note flag : provisioning auto inactif → domaine reste 'pending'. */}
        <p className="g9-domain-note">{t('whitelabel.provisioning_disabled')}</p>
      </Card>

      {/* ── Sprint 26 vague 26-3B — Wizard 4 steps (Logo / Couleurs / Société / Public) ── */}
      <Wizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        title={t('set.brand.wizard_title')}
        description={t('set.brand.wizard_desc')}
        steps={wizardSteps}
        currentIndex={wizardStep}
        onStepChange={setWizardStep}
        onComplete={completeWizard}
        onCancel={() => setWizardStep(0)}
        persistKey="branding-setup"
        completeLabel={t('set.brand.wizard_done')}
      />
    </>
  );
}
