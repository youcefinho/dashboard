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
  AutosaveIndicator,
  Switch,
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
} from 'lucide-react';
import { useAutosave } from '@/hooks/useAutosave';

const BRAND_PRESETS = ['#009DDB', '#D96E27', '#37CA37', '#FF9A00', '#E93D3D', '#188BF6', '#8B5CF6'];

// ── Sprint 26 vague 26-3B — presets palettes prédéfinies (primary + accent cohérents)
const COLOR_PALETTES: Array<{ id: string; name: string; primary: string; accent: string }> = [
  { id: 'intralys', name: 'Intralys', primary: '#009DDB', accent: '#D96E27' },
  { id: 'forest', name: 'Forêt', primary: '#10B981', accent: '#84CC16' },
  { id: 'sunset', name: 'Coucher', primary: '#F59E0B', accent: '#EF4444' },
  { id: 'ocean', name: 'Océan', primary: '#0EA5E9', accent: '#6366F1' },
  { id: 'royal', name: 'Royal', primary: '#8B5CF6', accent: '#EC4899' },
];

export function BrandingSettings() {
  const { success } = useToast();
  const [primary, setPrimary] = useState<string>('#009DDB');
  const [accent, setAccent] = useState<string>('#D96E27');
  const [companyName, setCompanyName] = useState('Intralys Demo');
  const [address, setAddress] = useState('123 rue de la Demo, Québec');
  const [logoFile, setLogoFile] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // ── Sprint 26 vague 26-3B — wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [publicPagesEnabled, setPublicPagesEnabled] = useState(false);
  const [publicSlug, setPublicSlug] = useState('');

  const handleSave = () => {
    success('Branding mis à jour');
  };

  // Sprint 24 vague 6A — autosave (stub : endpoint branding pas dispo encore)
  const autosaveValue = useMemo(
    () => ({ primary, accent, companyName, address, websiteUrl, shortDescription, publicPagesEnabled, publicSlug }),
    [primary, accent, companyName, address, websiteUrl, shortDescription, publicPagesEnabled, publicSlug]
  );
  const { state: autosaveState, lastSaved, retry } = useAutosave({
    value: autosaveValue,
    onSave: async () => {
      try {
        localStorage.setItem('intralys_branding_draft', JSON.stringify(autosaveValue));
      } catch {
        throw new Error('Échec sauvegarde locale');
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
    success('Marque configurée avec succès !');
  };

  // ── Sprint 26 vague 26-3B — steps definition
  const wizardSteps: WizardStep[] = useMemo(
    () => [
      {
        id: 'logo',
        label: 'Logo',
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
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">Logo de votre entreprise</h4>
                <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
                  PNG ou SVG transparent recommandé. Affiché en haut de votre dashboard et sur les courriels.
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
                      {isDragOver ? 'Déposez ici' : 'Glissez ou cliquez'}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] mt-0.5">PNG, JPG ou SVG</span>
                  </>
                )}
              </label>

              {/* Preview circular crop */}
              <div className="flex flex-col items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Aperçu rond</p>
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
                    Retirer
                  </button>
                )}
              </div>
            </div>

            <p className="text-[11px] text-center text-[var(--text-muted)] italic">
              Étape facultative — vous pouvez l'ajouter plus tard.
            </p>
          </div>
        ),
      },
      {
        id: 'colors',
        label: 'Couleurs',
        icon: <Palette size={14} />,
        isValid: () => /^#[0-9A-Fa-f]{6}$/.test(primary) && /^#[0-9A-Fa-f]{6}$/.test(accent),
        content: (
          <div className="space-y-5">
            <div className="flex items-start gap-3 p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
              <div className="p-2 rounded-lg bg-[var(--brand-tint)] text-[var(--primary)] shrink-0">
                <Palette size={16} />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">Palette de votre marque</h4>
                <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
                  Choisissez une palette suggérée ou personnalisez chaque couleur.
                </p>
              </div>
            </div>

            {/* Palettes prédéfinies */}
            <div>
              <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2 block">
                Palettes suggérées
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
                label="Couleur principale"
                value={primary}
                onChange={setPrimary}
                presets={BRAND_PRESETS}
                size="md"
              />
              <ColorSwatch
                label="Couleur d'accent"
                value={accent}
                onChange={setAccent}
                presets={BRAND_PRESETS}
                size="md"
              />
            </div>

            {/* Preview gradient brand */}
            <div className="p-4 rounded-xl border border-[var(--border-subtle)]">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                Aperçu gradient
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
        label: 'Société',
        icon: <Building2 size={14} />,
        isValid: () => companyName.trim().length > 0,
        content: (
          <div className="space-y-5">
            <div className="flex items-start gap-3 p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
              <div className="p-2 rounded-lg bg-[var(--brand-tint)] text-[var(--primary)] shrink-0">
                <Building2 size={16} />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">Informations société</h4>
                <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
                  Ces informations apparaissent sur vos pages publiques et signatures.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5 block">
                  Nom de l'entreprise <span className="text-[var(--danger)]">*</span>
                </label>
                <Input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Ex. Agence Tremblay Immobilier"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5 block">
                  URL du site web
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
                  Description courte
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
                  Adresse
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
        label: 'Pages publiques',
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
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">Page de capture publique</h4>
                <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
                  Activez une landing page hébergée avec votre branding pour collecter des leads en ligne.
                </p>
              </div>
            </div>

            <Switch
              checked={publicPagesEnabled}
              onCheckedChange={setPublicPagesEnabled}
              label="Activer la page publique"
              description="Vous obtenez une URL unique à partager."
            />

            {publicPagesEnabled && (
              <>
                <div>
                  <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5 block">
                    URL publique
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
                    <p className="text-[11px] text-[var(--danger)] mt-1">Le slug doit faire au moins 3 caractères.</p>
                  )}
                </div>

                {/* Aperçu landing */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                      Aperçu landing
                    </label>
                    {publicSlug.trim().length > 2 && (
                      <a
                        href={`https://intralys.app/p/${publicSlug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-semibold text-[var(--primary)] hover:underline inline-flex items-center gap-1"
                      >
                        <ExternalLink size={11} />
                        Ouvrir
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
                        {companyName || 'Votre marque'}
                      </h3>
                      <p className="text-xs text-[var(--text-secondary)] mb-4 leading-relaxed">
                        {shortDescription || 'Votre description courte apparaîtra ici.'}
                      </p>
                      <span
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-white text-xs font-semibold"
                        style={{
                          background: `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)`,
                          boxShadow: `0 4px 14px -2px ${primary}66`,
                        }}
                      >
                        Prendre rendez-vous
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}

            <p className="text-[11px] text-center text-[var(--text-muted)] italic">
              Étape facultative — vous pourrez activer la page publique plus tard.
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
              <Icon as={Palette} size="md" className="text-[var(--primary)]" /> Branding
            </h3>
            <p className="t-caption text-[var(--gray-500)]">Logo, couleurs et infos société.</p>
          </div>
          <Button variant="primary" size="sm" onClick={openWizard} leftIcon={<Icon as={Sparkles} size="sm" />}>
            Configurer ma marque
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
                    {isDragOver ? 'Déposer ici' : 'Uploader logo'}
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
            <label className="settings-label">Nom de l'entreprise</label>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>
          <div className="settings-form-row settings-form-row--full">
            <label className="settings-label">Adresse</label>
            <Textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="h-[72px]"
              maxLength={240}
              showCounter
            />
          </div>
        </div>

        <div className="settings-actions">
          <Button onClick={handleSave}>Enregistrer les modifications</Button>
        </div>
      </Card>

      {/* ── Sprint 26 vague 26-3B — Wizard 4 steps (Logo / Couleurs / Société / Public) ── */}
      <Wizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        title="Configurer votre marque"
        description="Personnalisez votre branding en 4 étapes — vous pourrez tout modifier plus tard."
        steps={wizardSteps}
        currentIndex={wizardStep}
        onStepChange={setWizardStep}
        onComplete={completeWizard}
        onCancel={() => setWizardStep(0)}
        persistKey="branding-setup"
        completeLabel="Appliquer mon branding"
      />
    </>
  );
}
