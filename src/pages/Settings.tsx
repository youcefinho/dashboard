// ── Page Settings — Centre Nerveux (Sprint 8) ────────────────
import { useState, useEffect, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth';
import { getPacks, installPack, getIvrMenus, saveIvrMenu, deleteIvrMenu, type IndustryPack, type IvrMenu } from '@/lib/api';
import { Card, Button, Tag, useToast, useConfirm, Skeleton, Input, Icon, Select } from '@/components/ui';
import {
  User, Bell, Shield, Palette,
  Columns, Package, Brain, Users, Key, FileText, CreditCard,
  Building, BookOpen, Smartphone, Search, Plug, Boxes, Globe, Truck, UploadCloud, PhoneCall,
  Plus, Trash2, Check, DollarSign
} from 'lucide-react';
import { fuzzyScoreMulti } from '@/lib/fuzzy';
import { t } from '@/lib/i18n';
import { CommissionsSettings } from '@/components/settings/CommissionsSettings';
// Sprint 21 — Onboarding durci : auto-complète 'profile_completed' dès que le
// profil user a un nom + email renseignés (idempotent, best-effort, silencieux).
import { useOnboardingItemCompletion } from '@/components/onboarding/useOnboardingItemCompletion';

// Sous-composants importés
import { ProfileSettings } from '@/components/settings/ProfileSettings';
import { SecuritySettings } from '@/components/settings/SecuritySettings';
// Surface du flux MFA/2FA (totpSetup/totpVerify/totpDisable) — écran dédié
// rendu dans l'onglet « Sécurité & Sessions » (100 % additif).
import { MfaSettings } from '@/components/settings/MfaSettings';
import { TeamSettings } from '@/components/settings/TeamSettings';
import { RolesPermissionsSettings } from '@/components/settings/RolesPermissionsSettings';
import { SubAccountsSettings } from '@/components/settings/SubAccountsSettings';
import { ApiWebhooksSettings } from '@/components/settings/ApiWebhooksSettings';
import { LeadSourcesSettings } from '@/components/settings/LeadSourcesSettings';
import { BrandingSettings } from '@/components/settings/BrandingSettings';
import { BillingSettings } from '@/components/settings/BillingSettings';
// Sprint 22 — Billing Stripe prod (E4 flag mock) — Manager-C
// Vue enrichie (plans + portal + invoices + webhook) AJOUTÉE après la vue
// compacte `<BillingSettings />` (qui reste intacte, rétro-compat absolue).
import { BillingPlanPanel } from '@/components/billing/BillingPlanPanel';
import { AuditLogSettings } from '@/components/settings/AuditLogSettings';
// ── Sprint 23 — Sécurité / conformité : mes données + permissions perso ──
import { DataPrivacyPanel } from '@/components/settings/DataPrivacyPanel';
import { RoleOverridesPanel } from '@/components/settings/RoleOverridesPanel';
import { PipelineSettings } from '@/components/settings/PipelineSettings';
import { NotificationsSettings } from '@/components/settings/NotificationsSettings';
import { SystemSettings } from '@/components/settings/SystemSettings';
import { ComplianceSettings } from './settings/ComplianceSettings';
import { CustomFieldsSettings } from './settings/CustomFieldsSettings';
// Sprint E1 M2.4 — UI activation des modules (feature-flag tenant)
import { ModulesSettings } from '@/components/settings/ModulesSettings';
// Sprint E-R M3.2 — Région & devise boutique e-commerce
import { RegionSettings } from '@/components/settings/RegionSettings';
// Sprint E4 M3.2 — Paiements multi-provider boutique e-commerce
import { PaymentSettings } from '@/components/settings/PaymentSettings';
// Sprint E5 M3.2 — Expédition (zones & tarifs) boutique e-commerce
import { ShippingSettings } from '@/components/settings/ShippingSettings';
// Sprint E6 M3.3 — conformité conso (indicatif, paramétrable, adminOnly).
import { ConsumerPolicySettings } from '@/components/settings/ConsumerPolicySettings';
// Sprint E8 M3 — canaux de vente (omnicanal : Shopify/Woo + stratégie stock)
import { ChannelSettings } from '@/components/settings/ChannelSettings';
// LOT RÉEL Manager C — Import de leads GHL CSV (wizard)
import { MigrationImportSettings } from '@/components/settings/MigrationImportSettings';
// Sprint 3 GIGA — Templates SMS (LOT SMS/WhatsApp seq104)
import { SmsTemplates } from '@/pages/settings/SmsTemplates';
// Sprint 51 — Routage Dynamique de Numéros Virtuels
import { PhoneNumbersSettings } from '@/components/settings/PhoneNumbersSettings';
// Sprint 53 — Messagerie Vocale & Transcription Whisper
import { VoicemailInbox } from '@/components/calls/VoicemailInbox';
// ── Self-service additif : white-label (getWhitelabel/updateWhitelabel),
//    préférences notifications (setNotificationPreferences), enregistrement
//    push de l'appareil (registerDevice/unregisterDevice). 100 % additif —
//    montés sous les onglets existants sans toucher aux composants en place.
import { WhitelabelSelfServiceSettings } from '@/components/settings/WhitelabelSelfServiceSettings';
import { NotificationPreferencesSelfService } from '@/components/settings/NotificationPreferencesSelfService';
import { PushDeviceSettings } from '@/components/settings/PushDeviceSettings';

type SettingsTab = 'profil' | 'notifications' | 'securite' | 'equipe' | 'roles' | 'sous_comptes' | 'branding' | 'billing' | 'commissions' | 'audit' | 'api' | 'sources_leads' | 'pipelines' | 'custom_fields' | 'conformite' | 'raccourcis' | 'systeme' | 'packs' | 'ai_scoring' | 'modules' | 'region' | 'paiements' | 'expedition' | 'conso_conformite' | 'canaux' | 'migration_import' | 'telephonie' | 'sms_templates' | 'data_privacy' | 'role_overrides';

const TABS: { id: SettingsTab; icon: typeof User; label: string; group: string; adminOnly?: boolean; description: string }[] = [
  { id: 'profil', icon: User, label: 'Mon profil', group: 'COMPTE', description: 'Nom, avatar, email, mot de passe' },
  { id: 'notifications', icon: Bell, label: 'Notifications', group: 'COMPTE', description: 'Email, push, SMS, in-app, sons' },
  { id: 'securite', icon: Shield, label: 'Sécurité & Sessions', group: 'COMPTE', description: '2FA, sessions actives, biométrie' },
  { id: 'systeme', icon: Smartphone, label: 'Appareil & Système', group: 'COMPTE', description: 'Thème, densité, sons, vibrations' },
  // ── Sprint 23 — Sécurité / conformité : entrée Loi 25 + RGPD (export / suppression / DPO) ──
  { id: 'data_privacy', icon: Shield, label: 'Mes données personnelles', group: 'COMPTE', description: 'Loi 25 + RGPD : exporter, supprimer, contacter le DPO' },

  { id: 'branding', icon: Palette, label: 'Branding & Sous-compte', group: 'CONFIGURATION', adminOnly: true, description: 'Logo, couleurs, domaine, white-label' },
  { id: 'custom_fields', icon: FileText, label: 'Champs Persos', group: 'CONFIGURATION', adminOnly: true, description: 'Custom fields lead, deal, client' },
  { id: 'pipelines', icon: Columns, label: 'Pipelines', group: 'CONFIGURATION', adminOnly: true, description: 'Stages, automations, statuts kanban' },

  { id: 'equipe', icon: Users, label: 'Équipe & Utilisateurs', group: 'AGENCE', adminOnly: true, description: 'Inviter, gérer team, assignations' },
  { id: 'roles', icon: Shield, label: 'Rôles & Permissions', group: 'AGENCE', adminOnly: true, description: 'RBAC, scopes, accès fins' },
  // ── Sprint 23 — Sécurité / conformité : surcharges de capacités par user (override RBAC) ──
  { id: 'role_overrides', icon: Key, label: 'Permissions personnalisées', group: 'AGENCE', adminOnly: true, description: 'Outrepasser le rôle d\'un utilisateur, capacité par capacité' },
  { id: 'sous_comptes', icon: Building, label: 'Sous-comptes', group: 'AGENCE', adminOnly: true, description: 'Gérer les sous-comptes clients, branding, membres' },
  { id: 'billing', icon: CreditCard, label: 'Facturation & Usage', group: 'AGENCE', adminOnly: true, description: 'Plan, paiement, quotas, factures' },
  { id: 'commissions', icon: DollarSign, label: 'Commissions d\'équipe', group: 'AGENCE', adminOnly: true, description: 'Suivi des commissions versées aux agents de vente' },
  { id: 'packs', icon: Package, label: 'Packs Industrie', group: 'AGENCE', adminOnly: true, description: 'Templates niche : courtiers, dentistes' },

  { id: 'modules', icon: Boxes, label: 'Modules', group: 'AVANCÉ', adminOnly: true, description: 'Activer CRM, Boutique e-commerce' },
  { id: 'region', icon: Globe, label: 'Région & devise', group: 'AVANCÉ', adminOnly: true, description: 'Région fiscale, devise, régime de taxes boutique' },
  { id: 'paiements', icon: CreditCard, label: 'Paiements', group: 'AVANCÉ', adminOnly: true, description: 'Fournisseurs de paiement boutique, mode test/réel, conformité' },
  { id: 'expedition', icon: Truck, label: 'Expédition', group: 'AVANCÉ', adminOnly: true, description: 'Zones d\'expédition, tarifs, paliers de livraison boutique' },
  { id: 'canaux', icon: Boxes, label: 'Canaux de vente', group: 'AVANCÉ', adminOnly: true, description: 'Shopify, WooCommerce, stratégie d\'inventaire, synchronisation omnicanal' },
  { id: 'conso_conformite', icon: BookOpen, label: 'Conformité conso', group: 'AVANCÉ', adminOnly: true, description: 'Rétractation, mentions, retours boutique (indicatif — revue légale requise)' },
  { id: 'api', icon: Key, label: 'API & Webhooks', group: 'AVANCÉ', adminOnly: true, description: 'Clés API, webhooks, scopes' },
  { id: 'sources_leads', icon: Plug, label: 'Sources de leads', group: 'AVANCÉ', adminOnly: true, description: 'Connecteur entrant, tokens, mapping, Zapier' },
  { id: 'telephonie', icon: PhoneCall, label: t('telephony.ivr.title'), group: 'AVANCÉ', adminOnly: true, description: t('telephony.ivr.config') },
  { id: 'sms_templates', icon: FileText, label: t('smsTemplate.title'), group: 'AVANCÉ', adminOnly: true, description: 'Modèles de SMS réutilisables pour campagnes et workflows' },
  { id: 'migration_import', icon: UploadCloud, label: t('migration_import.tab_label'), group: 'AVANCÉ', adminOnly: true, description: t('migration_import.tab_desc') },
  { id: 'conformite', icon: BookOpen, label: 'Conformité & RGPD', group: 'AVANCÉ', adminOnly: true, description: 'Loi 25, CASL, consentements, export' },
  { id: 'ai_scoring', icon: Brain, label: 'IA & Scoring', group: 'AVANCÉ', adminOnly: true, description: 'Scoring auto, prompts, modèles IA' },
  { id: 'audit', icon: Building, label: 'Journal d\'Audit', group: 'AVANCÉ', adminOnly: true, description: 'Logs actions, exports, historique' },
];

export function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [activeTab, setActiveTab] = useState<SettingsTab>('profil');
  // Sprint 30 vague 30-1D — Settings nav search global
  const [navQuery, setNavQuery] = useState('');

  // ── Sprint 21 (Onboarding durci) — auto-complète l'item 'profile_completed'
  //    dès que le profil user a un nom + email renseignés (condition simple,
  //    déjà disponible via useAuth()). Le hook est idempotent : un seul appel
  //    API par session (flag localStorage). Best-effort silencieux.
  const isProfileComplete = Boolean(
    user?.name && user.name.trim().length > 0 &&
    user?.email && user.email.trim().length > 0,
  );
  useOnboardingItemCompletion('profile_completed', isProfileComplete);

  // Sprint 51 M3.4 — deep-link ?tab=sources_leads (depuis Intégrations)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && TABS.some(x => x.id === t)) setActiveTab(t as SettingsTab);
  }, []);

  const visibleTabs = useMemo(() => TABS.filter(t => !t.adminOnly || isAdmin), [isAdmin]);

  // Fuzzy filter sur label + description + group + id (ex: tape "API" matche
  // "API & Webhooks", tape "team" matche "Équipe", tape "key" matche "API")
  const filteredTabs = useMemo(() => {
    const q = navQuery.trim();
    if (!q) return visibleTabs;
    const scored = visibleTabs
      .map((t) => {
        const score = fuzzyScoreMulti(q, [
          { value: t.label, weight: 1.0 },
          { value: t.description, weight: 0.60 },
          { value: t.id, weight: 0.40 },
          { value: t.group, weight: 0.30 },
        ]);
        return { t, score };
      })
      .filter((x) => x.score >= 0.30)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.t);
    return scored;
  }, [navQuery, visibleTabs]);

  // Highlight la portion du label qui matche le query (caseless)
  const highlightMatch = (text: string): React.ReactNode => {
    const q = navQuery.trim();
    if (!q) return text;
    const lcText = text.toLowerCase();
    const lcQ = q.toLowerCase();
    const idx = lcText.indexOf(lcQ);
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="settings-nav-search-mark">{text.slice(idx, idx + q.length)}</mark>
        {text.slice(idx + q.length)}
      </>
    );
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'profil': return <ProfileSettings user={user} isAdmin={isAdmin} />;
      case 'securite': return (
        <div className="space-y-6">
          <MfaSettings />
          <SecuritySettings />
        </div>
      );
      case 'equipe': return <TeamSettings />;
      case 'roles': return <RolesPermissionsSettings />;
      case 'sous_comptes': return <SubAccountsSettings />;
      case 'api': return <ApiWebhooksSettings />;
      case 'sources_leads': return <LeadSourcesSettings />;
      case 'branding': return (
        <div className="space-y-6">
          <BrandingSettings />
          {/* Self-service white-label (getWhitelabel/updateWhitelabel) — additif */}
          <WhitelabelSelfServiceSettings />
        </div>
      );
      case 'billing': return (
        <>
          <BillingSettings />
          {/* Sprint 22 — vue enrichie Stripe prod (E4 flag mock) sous la vue compacte. */}
          <BillingPlanPanel />
        </>
      );
      case 'commissions': return <CommissionsSettings />;
      case 'audit': return <AuditLogSettings />;
      // ── Sprint 23 — Sécurité / conformité ──
      case 'data_privacy': return <DataPrivacyPanel />;
      case 'role_overrides': return <RoleOverridesPanel />;
      case 'pipelines': return <PipelineSettings />;
      case 'conformite': return <ComplianceSettings />;
      case 'custom_fields': return <CustomFieldsSettings />;
      case 'packs': return <PacksSettings />;
      case 'notifications': return (
        <div className="space-y-6">
          <NotificationsSettings />
          {/* Préférences notifications self-service (setNotificationPreferences) — additif */}
          <NotificationPreferencesSelfService />
          {/* Enregistrement push de cet appareil (registerDevice/unregisterDevice) — additif */}
          <PushDeviceSettings />
        </div>
      );
      case 'systeme': return <SystemSettings />;
      case 'modules': return <ModulesSettings />;
      case 'region': return <RegionSettings />;
      case 'paiements': return <PaymentSettings />;
      case 'expedition': return <ShippingSettings />;
      case 'conso_conformite': return <ConsumerPolicySettings />;
      case 'canaux': return <ChannelSettings />;
      case 'migration_import': return <MigrationImportSettings />;
      case 'telephonie': return <TelephonyTabSettings />;
      case 'sms_templates': return <SmsTemplates />;
      // Placeholder pour les autres
      default: return (
        <div className="p-8 text-center text-[var(--text-muted)] bg-[var(--bg-surface)] rounded-xl border border-dashed border-[var(--border-strong)]">
          <h3 className="text-lg font-medium mb-2">{t('settings.default.title')}</h3>
          <p className="text-sm">{t('settings.default.desc')}</p>
        </div>
      );
    }
  };

  return (
    <AppLayout title={t('settings.page.title')}>
      {/* Mobile tabs — action-chip premium */}
      <div className="md:hidden flex gap-1.5 overflow-x-auto pb-3 mb-4 -mx-1 px-1 no-scrollbar">
        {visibleTabs.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`action-chip shrink-0 ${isActive ? 'is-active' : ''}`}
              style={isActive ? {
                background: 'linear-gradient(135deg, rgba(0,157,219,0.18) 0%, rgba(217,110,39,0.10) 100%)',
                borderColor: 'rgba(0,157,219,0.55)',
                color: 'var(--primary)',
              } : undefined}
            >
              <span className="action-chip-icon"><Icon as={tab.icon} size={12} /></span>
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex gap-6 max-w-6xl">
        {/* Sidebar navigation — Sprint 23 wave 14 : vrais boutons cohérents */}
        <nav className="hidden md:block w-56 shrink-0 h-[calc(100vh-120px)] overflow-y-auto pr-2">
          {/* Sprint 30 vague 30-1D — Settings nav search */}
          <div className="settings-nav-search">
            <Input
              type="search"
              value={navQuery}
              onChange={(e) => setNavQuery(e.target.value)}
              placeholder={t('settings.search.placeholder')}
              aria-label={t('settings.search.placeholder')}
              leftSlot={
                <span className="settings-nav-search-icon" aria-hidden="true">
                  <Icon as={Search} size={13} />
                </span>
              }
            />
            {navQuery && (
              <button
                type="button"
                onClick={() => setNavQuery('')}
                aria-label={t('settings.search.placeholder')}
                className="settings-nav-search-clear"
              >
                ×
              </button>
            )}
            {navQuery && (
              <p className="settings-nav-search-count">
                {filteredTabs.length} {filteredTabs.length > 1 ? t('settings.search.count_other', { n: filteredTabs.length }) : t('settings.search.count_one')}
              </p>
            )}
          </div>

          {filteredTabs.length === 0 && navQuery && (
            <div className="settings-nav-search-empty">
              <p className="font-semibold text-[13px] text-[var(--text-primary)]">{t('settings.search.no_results')}</p>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                Essaie « <span className="text-[var(--primary)] font-medium">team</span> » ou
                « <span className="text-[var(--primary)] font-medium">API</span> »
              </p>
            </div>
          )}

          {(() => {
            // Si query non vide : préserver l'ordre fuzzy (pas regrouper par group)
            // Sinon : groupes habituels
            if (navQuery.trim()) {
              return (
                <div className="mb-5">
                  <div className="px-3 mb-2 flex items-center gap-2">
                    <span
                      className="text-[10px] font-bold uppercase tracking-[0.14em]"
                      style={{
                        background: 'linear-gradient(90deg, #009DDB 0%, #D96E27 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                      }}
                    >
                      {t('settings.search.results')}
                    </span>
                    <span
                      aria-hidden
                      className="flex-1 h-px"
                      style={{
                        background:
                          'linear-gradient(90deg, rgba(0,157,219,0.22) 0%, rgba(0,157,219,0.06) 50%, transparent 100%)',
                      }}
                    />
                  </div>
                  {filteredTabs.map(tab => (
                    <SettingsNavButton
                      key={tab.id}
                      tab={tab}
                      isActive={activeTab === tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      labelNode={highlightMatch(tab.label)}
                    />
                  ))}
                </div>
              );
            }
            const groups = [...new Set(filteredTabs.map(t => t.group))];
            return groups.map(group => (
              <div key={group} className="mb-5">
                <div className="px-3 mb-2 flex items-center gap-2">
                  <span
                    className="text-[10px] font-bold uppercase tracking-[0.14em]"
                    style={{
                      background: 'linear-gradient(90deg, #009DDB 0%, #D96E27 100%)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      backgroundClip: 'text',
                    }}
                  >
                    {group}
                  </span>
                  <span
                    aria-hidden
                    className="flex-1 h-px"
                    style={{
                      background:
                        'linear-gradient(90deg, rgba(0,157,219,0.22) 0%, rgba(0,157,219,0.06) 50%, transparent 100%)',
                    }}
                  />
                </div>
                {filteredTabs.filter(t => t.group === group).map(tab => (
                  <SettingsNavButton
                    key={tab.id}
                    tab={tab}
                    isActive={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    labelNode={highlightMatch(tab.label)}
                  />
                ))}
              </div>
            ));
          })()}
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0 h-[calc(100vh-120px)] overflow-y-auto pb-10 pr-2">
          {renderContent()}
        </div>
      </div>
    </AppLayout>
  );
}

// ── Sprint 30 vague 30-1D — SettingsNavButton helper ──────────────
// Factorise le bouton item nav-sidebar (anciennement inline ×2). Permet de
// supporter le highlight match (labelNode = ReactNode) sans dupliquer le
// markup.
interface SettingsNavButtonProps {
  tab: { id: SettingsTab; icon: typeof User; label: string; description: string };
  isActive: boolean;
  onClick: () => void;
  labelNode: React.ReactNode;
}

function SettingsNavButton({ tab, isActive, onClick, labelNode }: SettingsNavButtonProps) {
  return (
    <button
      onClick={onClick}
      title={tab.description}
      className={`group w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] text-[13px] font-semibold text-left cursor-pointer transition-all duration-200 mb-1 relative border ${
        isActive
          ? 'bg-[var(--primary-soft)] border-[var(--primary)]/40 text-[var(--primary)] shadow-sm'
          : 'bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] hover:translate-x-0.5'
      }`}
    >
      {isActive && (
        <div
          className="absolute -left-px top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-[var(--primary)]"
        />
      )}
      <span
        className={`inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0 transition-all border ${
          isActive
            ? 'bg-[var(--primary-soft)] border-[var(--primary)]/30 text-[var(--primary)]'
            : 'bg-[var(--bg-subtle)] border-[var(--border)] text-[var(--text-secondary)]'
        }`}
      >
        <Icon as={tab.icon} size={13} />
      </span>
      <span className="flex-1 truncate">{labelNode}</span>
    </button>
  );
}

// ── Composant Inline PacksSettings ──
function PacksSettings() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const [packs, setPacks] = useState<IndustryPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  // LOT renforcement — error inline + retry sur getPacks
  const [loadError, setLoadError] = useState<string | null>(null);

  const reloadPacks = () => {
    setLoading(true);
    setLoadError(null);
    getPacks().then(res => {
      if (res.data) setPacks(res.data);
      else if (res.error) setLoadError(res.error);
      setLoading(false);
    }).catch((e: unknown) => {
      setLoadError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    });
  };

  useEffect(() => { reloadPacks(); }, []);

  const handleInstall = async (packId: string) => {
    const ok = await confirm({
      title: t('settings.packs.install_confirm'),
      description: t('settings.packs.install_desc'),
      confirmLabel: t('settings.packs.install_btn'),
    });
    if (!ok) return;

    setInstallingId(packId);
    try {
      const res = await installPack(packId, 'gatineau');
      if (res.data) {
        success(t('settings.packs.installed'), { duration: 8000 });
      } else if (res.error) {
        toastError(`${t('settings.packs.install_error')}: ${res.error}`);
      }
    } catch (err: any) {
      toastError(`Erreur: ${err.message}`);
    } finally {
      setInstallingId(null);
    }
  };

  if (loading) {
    return (
      /* Skeleton qui matche la shell Settings : sidebar 8 items + content 2 cards */
      <div className="flex gap-6" aria-busy="true" aria-live="polite" aria-label={t('a11y.loading_sr')}>
        <div className="w-56 space-y-1 shrink-0">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-lg" />
          ))}
        </div>
        <div className="flex-1 space-y-4">
          <Card className="p-5 space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-3/4" />
            <div className="grid grid-cols-3 gap-3 pt-2">
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
            </div>
            <Skeleton className="h-9 w-32 rounded-md" />
          </Card>
          <Card className="p-5 space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* LOT renforcement — inline error banner */}
      {loadError && (
        <div
          role="alert"
          aria-live="assertive"
          className="p-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-between gap-3"
        >
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-[var(--danger)]">{t('common.error.title')}</p>
            <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{t('common.error.load_failed')}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={reloadPacks}>{t('common.retry')}</Button>
        </div>
      )}
      {packs.length === 0 && !loadError ? (
        <Card className="p-8 text-center text-[var(--text-muted)] border-dashed">
          Aucun pack disponible.
        </Card>
      ) : packs.length > 0 ? (
        packs.map(pack => (
          <Card key={pack.id} className="p-5 border-[var(--primary)] hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-bold text-[var(--text-primary)]">{pack.name}</h3>
                <p className="text-sm text-[var(--text-secondary)] mt-1 max-w-xl">{pack.description}</p>
              </div>
              <Tag variant="brand" size="sm">{t('settings.packs.free')}</Tag>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5 p-4 bg-[var(--bg-subtle)] rounded-lg">
              <div>
                <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase">{t('settings.packs.custom_fields')}</p>
                <p className="text-lg font-semibold">10+ <span className="text-xs font-normal">{t('settings.packs.included')}</span></p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Templates</p>
                <p className="text-lg font-semibold">3 <span className="text-xs font-normal">{t('settings.packs.included')}</span></p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Workflows</p>
                <p className="text-lg font-semibold">2 <span className="text-xs font-normal">{t('settings.packs.included')}</span></p>
              </div>
            </div>

            <Button
              className="w-full"
              onClick={() => void handleInstall(pack.id)}
              disabled={installingId === pack.id}
              aria-busy={installingId === pack.id}
            >
              {installingId === pack.id ? t('settings.packs.installing') : t('settings.packs.install_cta')}
            </Button>
          </Card>
        ))
      ) : null}
    </div>
  );
}

// ── Sprint 51 — Routage Dynamique de Numéros Virtuels ────────────────────────
// Wrapper pour basculer entre la gestion des menus SVI (IVR) et la gestion
// des numéros de téléphone virtuels avec leurs règles de routage dynamique.
function TelephonyTabSettings() {
  const [subTab, setSubTab] = useState<'ivr' | 'numbers' | 'voicemail'>('ivr');

  return (
    <div className="space-y-6">
      {/* Sélecteur d'onglets segmenté Premium */}
      <div className="flex border-b border-[var(--border-subtle)] pb-px gap-6">
        <button
          onClick={() => setSubTab('ivr')}
          className={`pb-3 text-sm font-semibold relative px-1 transition-all cursor-pointer ${
            subTab === 'ivr'
              ? 'text-[var(--primary)] font-bold'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          }`}
        >
          {t('telephony.ivr.title')}
          {subTab === 'ivr' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--primary)] rounded-full" />
          )}
        </button>
        <button
          onClick={() => setSubTab('numbers')}
          className={`pb-3 text-sm font-semibold relative px-1 transition-all cursor-pointer ${
            subTab === 'numbers'
              ? 'text-[var(--primary)] font-bold'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          }`}
        >
          {t('telephony.phoneNumbers.title')}
          {subTab === 'numbers' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--primary)] rounded-full" />
          )}
        </button>
        <button
          onClick={() => setSubTab('voicemail')}
          className={`pb-3 text-sm font-semibold relative px-1 transition-all cursor-pointer ${
            subTab === 'voicemail'
              ? 'text-[var(--primary)] font-bold'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          }`}
        >
          {t('voice.voicemail.inbox_title')}
          {subTab === 'voicemail' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--primary)] rounded-full" />
          )}
        </button>
      </div>

      {subTab === 'ivr' ? (
        <TelephonySettings />
      ) : subTab === 'numbers' ? (
        <PhoneNumbersSettings />
      ) : (
        <VoicemailInbox />
      )}
    </div>
  );
}

// ── Sprint F Téléphonie — TelephonySettings (config IVR inline) ──────────────
// Liste les menus IVR (getIvrMenus), création / édition (name + config_json
// textarea JSON v1), activation et suppression (saveIvrMenu / deleteIvrMenu).
// i18n : clés telephony.ivr.* posées Phase A, aucune nouvelle clé créée.
function TelephonySettings() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const [menus, setMenus] = useState<IvrMenu[]>([]);
  const [loading, setLoading] = useState(true);
  // LOT renforcement — error inline + retry sur getIvrMenus
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftGreeting, setDraftGreeting] = useState('');
  const [draftOptions, setDraftOptions] = useState<Array<{ digit: string; action: 'dial' | 'voicemail'; target: string }>>([]);
  const [configError, setConfigError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = () => {
    setLoadError(null);
    getIvrMenus().then(res => {
      if (res.data) setMenus(res.data);
      else if (res.error) setLoadError(res.error);
      setLoading(false);
    }).catch((e: unknown) => {
      setLoadError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    });
  };
  useEffect(() => { reload(); }, []);

  const startNew = () => {
    setEditingId('new');
    setDraftName('');
    setDraftGreeting('Bonjour, merci d\'appeler.');
    setDraftOptions([{ digit: '1', action: 'dial', target: '' }]);
    setConfigError(null);
  };

  const startEdit = (menu: IvrMenu) => {
    setEditingId(menu.id);
    setDraftName(menu.name || '');
    let parsed: any = {};
    try {
      parsed = JSON.parse(menu.config_json || '{}');
    } catch {
      parsed = {};
    }
    setDraftGreeting(parsed.greeting || '');

    // Normaliser les options : mapper "forward" vers "dial" et "to" vers "target"
    const normalizedOptions = (parsed.options || []).map((o: any) => ({
      digit: o.digit || '1',
      action: o.action === 'forward' ? 'dial' : (o.action || 'dial'),
      target: o.target || o.to || ''
    }));
    setDraftOptions(normalizedOptions);
    setConfigError(null);
  };

  const cancel = () => { setEditingId(null); setConfigError(null); };

  const handleSave = async () => {
    if (!draftName.trim()) { setConfigError('Le nom du menu SVI est requis.'); return; }
    if (!draftGreeting.trim()) { setConfigError('Le message d\'accueil est requis.'); return; }

    // Validation des options vides
    for (let i = 0; i < draftOptions.length; i++) {
      const opt = draftOptions[i]!;
      if (opt.action === 'dial' && !opt.target.trim()) {
        setConfigError(`Veuillez spécifier un numéro de destination pour la touche ${opt.digit}.`);
        return;
      }
    }

    // Valider les doublons de touches
    const digits = draftOptions.map(o => o.digit);
    const hasDuplicates = digits.some((d, idx) => digits.indexOf(d) !== idx);
    if (hasDuplicates) {
      setConfigError('Chaque touche (chiffre) doit être unique dans le menu.');
      return;
    }

    setSaving(true);
    const res = await saveIvrMenu({
      id: editingId && editingId !== 'new' ? editingId : undefined,
      name: draftName.trim(),
      config: {
        greeting: draftGreeting.trim(),
        options: draftOptions
      },
    });
    setSaving(false);
    if (res.error) { toastError(res.error); return; }
    success(t('telephony.ivr.title'));
    setEditingId(null);
    reload();
  };

  const handleToggleActive = async (menu: IvrMenu) => {
    const res = await saveIvrMenu({
      id: menu.id,
      name: menu.name || '',
      config: (() => { try { return JSON.parse(menu.config_json || '{}'); } catch { return {}; } })(),
      is_active: !menu.is_active,
    });
    if (res.error) { toastError(res.error); return; }
    reload();
  };

  const handleDelete = async (menu: IvrMenu) => {
    const ok = await confirm({
      title: t('telephony.ivr.title'),
      description: menu.name || t('telephony.ivr.config'),
      danger: true,
    });
    if (!ok) return;
    const res = await deleteIvrMenu(menu.id);
    if (res.error) { toastError(res.error); return; }
    reload();
  };

  const handleAddOption = () => {
    const usedDigits = new Set(draftOptions.map(o => o.digit));
    const allDigits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '*', '#'];
    const available = allDigits.find(d => !usedDigits.has(d));
    if (!available) return;

    setDraftOptions([...draftOptions, { digit: available, action: 'dial', target: '' }]);
  };

  const handleRemoveOption = (index: number) => {
    setDraftOptions(draftOptions.filter((_, i) => i !== index));
  };

  const handleUpdateOption = (index: number, key: 'digit' | 'action' | 'target', value: string) => {
    const updated = [...draftOptions];
    updated[index] = { ...updated[index]!, [key]: value };
    if (key === 'action' && value === 'voicemail') {
      updated[index]!.target = '';
    }
    setDraftOptions(updated);
  };

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-live="polite" aria-label={t('a11y.loading_sr')}>
        <Card className="p-5 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* LOT renforcement — inline error banner */}
      {loadError && (
        <div
          role="alert"
          aria-live="assertive"
          className="p-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-between gap-3"
        >
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-[var(--danger)]">{t('common.error.title')}</p>
            <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{t('common.error.load_failed')}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={reload}>{t('common.retry')}</Button>
        </div>
      )}
      {/* En-tête section */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Icon as={PhoneCall} size={18} /> {t('telephony.ivr.title')}
          </h3>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">{t('telephony.ivr.config')}</p>
        </div>
        {editingId === null && (
          <Button size="sm" onClick={startNew}>
            <Icon as={Plus} size={14} className="mr-1" /> {t('telephony.ivr.title')}
          </Button>
        )}
      </div>

      {/* Éditeur (création ou édition) */}
      {editingId !== null && (
        <Card className="p-5 space-y-4 border-[var(--primary)]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Nom du menu SVI"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="ex: Réception principale"
            />
            <Input
              label="Message d'accueil vocal (lu par synthèse)"
              value={draftGreeting}
              onChange={(e) => setDraftGreeting(e.target.value)}
              placeholder="ex: Bonjour, merci d'appeler Intralys."
            />
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                Options du menu (Touches téléphoniques)
              </label>
              <Button size="sm" onClick={handleAddOption} leftIcon={<Icon as={Plus} size="sm" />}>
                Ajouter une touche
              </Button>
            </div>

            {draftOptions.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] italic text-center py-4 border border-dashed border-[var(--border-subtle)] rounded-lg">
                Aucune touche configurée. L'appel raccrochera après le message d'accueil.
              </p>
            ) : (
              <div className="space-y-3">
                {draftOptions.map((opt, idx) => (
                  <div key={idx} className="flex flex-wrap items-end gap-3 p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)]/30">
                    <div className="w-20">
                      <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                        Touche
                      </label>
                      <Select
                        size="sm"
                        value={opt.digit}
                        onChange={(e) => handleUpdateOption(idx, 'digit', e.target.value)}
                      >
                        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '*', '#'].map(d => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </Select>
                    </div>

                    <div className="w-40">
                      <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                        Action
                      </label>
                      <Select
                        size="sm"
                        value={opt.action}
                        onChange={(e) => handleUpdateOption(idx, 'action', e.target.value as any)}
                      >
                        <option value="dial">Transférer l'appel</option>
                        <option value="voicemail">Messagerie vocale</option>
                      </Select>
                    </div>

                    {opt.action === 'dial' && (
                      <div className="flex-1 min-w-[200px]">
                        <Input
                          label="Numéro de redirection"
                          placeholder="ex: +15145550100"
                          value={opt.target}
                          onChange={(e) => handleUpdateOption(idx, 'target', e.target.value)}
                        />
                      </div>
                    )}

                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleRemoveOption(idx)}
                      className="text-[var(--danger)] hover:bg-[var(--danger)]/10"
                      title="Retirer cette touche"
                    >
                      <Icon as={Trash2} size="sm" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {configError && <p className="text-xs text-[var(--danger)] mt-1">{configError}</p>}
          </div>

          <div className="flex gap-2 pt-2">
            <Button size="sm" disabled={saving} onClick={() => void handleSave()}>
              <Icon as={Check} size={14} className="mr-1" /> {t('action.save')}
            </Button>
            <Button size="sm" variant="secondary" onClick={cancel}>{t('action.cancel')}</Button>
          </div>
        </Card>
      )}

      {/* Liste des menus */}
      {menus.length === 0 && editingId === null ? (
        <Card className="p-8 text-center text-[var(--text-muted)] border-dashed">
          {t('telephony.notconfigured')}
        </Card>
      ) : (
        menus.map(menu => (
          <Card key={menu.id} className="p-4 flex items-center justify-between gap-3">
            <button onClick={() => startEdit(menu)} className="flex-1 min-w-0 text-left cursor-pointer">
              <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{menu.name || t('telephony.ivr.title')}</p>
              <p className="text-[11px] text-[var(--text-muted)] font-mono truncate">{menu.config_json || '{}'}</p>
            </button>
            <div className="flex items-center gap-2 shrink-0">
              <Tag variant={menu.is_active ? 'success' : 'neutral'} size="sm">
                {menu.is_active ? t('telephony.status.completed') : t('telephony.status.queued')}
              </Tag>
              <button
                onClick={() => void handleToggleActive(menu)}
                title={menu.is_active ? t('telephony.status.queued') : t('telephony.status.completed')}
                aria-label={menu.is_active ? t('telephony.status.queued') : t('telephony.status.completed')}
                aria-pressed={!!menu.is_active}
                className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--bg-subtle)] cursor-pointer transition-all">
                <Icon as={Check} size={15} />
              </button>
              <button
                onClick={() => void handleDelete(menu)}
                title={t('action.delete')}
                aria-label={t('a11y.delete')}
                className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 cursor-pointer transition-all">
                <Icon as={Trash2} size={15} />
              </button>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}


