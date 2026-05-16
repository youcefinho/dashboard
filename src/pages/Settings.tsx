// ── Page Settings — Centre Nerveux (Sprint 8) ────────────────
import { useState, useEffect, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth';
import { getPacks, installPack, type IndustryPack } from '@/lib/api';
import { Card, Button, Tag, useToast, useConfirm, Skeleton, Input, Icon } from '@/components/ui';
import {
  User, Bell, Shield, Palette,
  Columns, Package, Brain, Users, Key, FileText, CreditCard,
  Building, BookOpen, Smartphone, Search, Plug, Boxes, Globe, Truck
} from 'lucide-react';
import { fuzzyScoreMulti } from '@/lib/fuzzy';

// Sous-composants importés
import { ProfileSettings } from '@/components/settings/ProfileSettings';
import { SecuritySettings } from '@/components/settings/SecuritySettings';
import { TeamSettings } from '@/components/settings/TeamSettings';
import { RolesPermissionsSettings } from '@/components/settings/RolesPermissionsSettings';
import { ApiWebhooksSettings } from '@/components/settings/ApiWebhooksSettings';
import { LeadSourcesSettings } from '@/components/settings/LeadSourcesSettings';
import { BrandingSettings } from '@/components/settings/BrandingSettings';
import { BillingSettings } from '@/components/settings/BillingSettings';
import { AuditLogSettings } from '@/components/settings/AuditLogSettings';
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

type SettingsTab = 'profil' | 'notifications' | 'securite' | 'equipe' | 'roles' | 'branding' | 'billing' | 'audit' | 'api' | 'sources_leads' | 'pipelines' | 'custom_fields' | 'conformite' | 'raccourcis' | 'systeme' | 'packs' | 'ai_scoring' | 'modules' | 'region' | 'paiements' | 'expedition' | 'conso_conformite' | 'canaux';

const TABS: { id: SettingsTab; icon: typeof User; label: string; group: string; adminOnly?: boolean; description: string }[] = [
  { id: 'profil', icon: User, label: 'Mon profil', group: 'COMPTE', description: 'Nom, avatar, email, mot de passe' },
  { id: 'notifications', icon: Bell, label: 'Notifications', group: 'COMPTE', description: 'Email, push, SMS, in-app, sons' },
  { id: 'securite', icon: Shield, label: 'Sécurité & Sessions', group: 'COMPTE', description: '2FA, sessions actives, biométrie' },
  { id: 'systeme', icon: Smartphone, label: 'Appareil & Système', group: 'COMPTE', description: 'Thème, densité, sons, vibrations' },

  { id: 'branding', icon: Palette, label: 'Branding & Sous-compte', group: 'CONFIGURATION', adminOnly: true, description: 'Logo, couleurs, domaine, white-label' },
  { id: 'custom_fields', icon: FileText, label: 'Champs Persos', group: 'CONFIGURATION', adminOnly: true, description: 'Custom fields lead, deal, client' },
  { id: 'pipelines', icon: Columns, label: 'Pipelines', group: 'CONFIGURATION', adminOnly: true, description: 'Stages, automations, statuts kanban' },

  { id: 'equipe', icon: Users, label: 'Équipe & Utilisateurs', group: 'AGENCE', adminOnly: true, description: 'Inviter, gérer team, assignations' },
  { id: 'roles', icon: Shield, label: 'Rôles & Permissions', group: 'AGENCE', adminOnly: true, description: 'RBAC, scopes, accès fins' },
  { id: 'billing', icon: CreditCard, label: 'Facturation & Usage', group: 'AGENCE', adminOnly: true, description: 'Plan, paiement, quotas, factures' },
  { id: 'packs', icon: Package, label: 'Packs Industrie', group: 'AGENCE', adminOnly: true, description: 'Templates niche : courtiers, dentistes' },

  { id: 'modules', icon: Boxes, label: 'Modules', group: 'AVANCÉ', adminOnly: true, description: 'Activer CRM, Boutique e-commerce' },
  { id: 'region', icon: Globe, label: 'Région & devise', group: 'AVANCÉ', adminOnly: true, description: 'Région fiscale, devise, régime de taxes boutique' },
  { id: 'paiements', icon: CreditCard, label: 'Paiements', group: 'AVANCÉ', adminOnly: true, description: 'Fournisseurs de paiement boutique, mode test/réel, conformité' },
  { id: 'expedition', icon: Truck, label: 'Expédition', group: 'AVANCÉ', adminOnly: true, description: 'Zones d\'expédition, tarifs, paliers de livraison boutique' },
  { id: 'canaux', icon: Boxes, label: 'Canaux de vente', group: 'AVANCÉ', adminOnly: true, description: 'Shopify, WooCommerce, stratégie d\'inventaire, synchronisation omnicanal' },
  { id: 'conso_conformite', icon: BookOpen, label: 'Conformité conso', group: 'AVANCÉ', adminOnly: true, description: 'Rétractation, mentions, retours boutique (indicatif — revue légale requise)' },
  { id: 'api', icon: Key, label: 'API & Webhooks', group: 'AVANCÉ', adminOnly: true, description: 'Clés API, webhooks, scopes' },
  { id: 'sources_leads', icon: Plug, label: 'Sources de leads', group: 'AVANCÉ', adminOnly: true, description: 'Connecteur entrant, tokens, mapping, Zapier' },
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
      case 'securite': return <SecuritySettings />;
      case 'equipe': return <TeamSettings />;
      case 'roles': return <RolesPermissionsSettings />;
      case 'api': return <ApiWebhooksSettings />;
      case 'sources_leads': return <LeadSourcesSettings />;
      case 'branding': return <BrandingSettings />;
      case 'billing': return <BillingSettings />;
      case 'audit': return <AuditLogSettings />;
      case 'pipelines': return <PipelineSettings />;
      case 'conformite': return <ComplianceSettings />;
      case 'custom_fields': return <CustomFieldsSettings />;
      case 'packs': return <PacksSettings />;
      case 'notifications': return <NotificationsSettings />;
      case 'systeme': return <SystemSettings />;
      case 'modules': return <ModulesSettings />;
      case 'region': return <RegionSettings />;
      case 'paiements': return <PaymentSettings />;
      case 'expedition': return <ShippingSettings />;
      case 'conso_conformite': return <ConsumerPolicySettings />;
      case 'canaux': return <ChannelSettings />;
      // Placeholder pour les autres
      default: return (
        <div className="p-8 text-center text-[var(--text-muted)] bg-[var(--bg-surface)] rounded-xl border border-dashed border-[var(--border-strong)]">
          <h3 className="text-lg font-medium mb-2">Module en construction</h3>
          <p className="text-sm">Le module "{activeTab}" sera disponible dans une prochaine mise à jour.</p>
        </div>
      );
    }
  };

  return (
    <AppLayout title="Paramètres">
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
              placeholder="Rechercher (API, équipe, RGPD…)"
              aria-label="Rechercher dans les paramètres"
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
                aria-label="Effacer la recherche"
                className="settings-nav-search-clear"
              >
                ×
              </button>
            )}
            {navQuery && (
              <p className="settings-nav-search-count">
                {filteredTabs.length} résultat{filteredTabs.length > 1 ? 's' : ''}
              </p>
            )}
          </div>

          {filteredTabs.length === 0 && navQuery && (
            <div className="settings-nav-search-empty">
              <p className="font-semibold text-[13px] text-[var(--text-primary)]">Aucun paramètre</p>
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
                      Résultats
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
      className="group w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] text-[13px] font-semibold text-left cursor-pointer transition-all duration-200 mb-1 relative"
      style={
        isActive
          ? {
              background:
                'linear-gradient(90deg, rgba(0,157,219,0.18) 0%, rgba(217,110,39,0.06) 100%)',
              color: 'var(--primary)',
              border: '1px solid rgba(0,157,219,0.40)',
              boxShadow:
                '0 2px 8px -2px rgba(0,157,219,0.25), 0 0 16px -6px rgba(217,110,39,0.18), inset 0 1px 0 rgba(255,255,255,0.7)',
            }
          : {
              background:
                'linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-subtle) 100%)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 1px 2px rgba(15,23,42,0.03)',
            }
      }
      onMouseEnter={(e) => {
        if (isActive) return;
        e.currentTarget.style.background =
          'linear-gradient(90deg, rgba(0,157,219,0.10) 0%, rgba(217,110,39,0.04) 100%)';
        e.currentTarget.style.borderColor = 'rgba(0,157,219,0.32)';
        e.currentTarget.style.color = 'var(--text-primary)';
        e.currentTarget.style.transform = 'translateX(2px)';
      }}
      onMouseLeave={(e) => {
        if (isActive) return;
        e.currentTarget.style.background =
          'linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-subtle) 100%)';
        e.currentTarget.style.borderColor = 'var(--border-subtle)';
        e.currentTarget.style.color = 'var(--text-secondary)';
        e.currentTarget.style.transform = 'translateX(0)';
      }}
    >
      {isActive && (
        <div
          className="absolute -left-px top-1.5 bottom-1.5 w-[3px] rounded-r-full"
          style={{
            background: 'linear-gradient(180deg, #009DDB 0%, #D96E27 100%)',
            boxShadow: '0 0 8px rgba(0,157,219,0.7), 2px 0 6px rgba(217,110,39,0.4)',
          }}
        />
      )}
      <span
        className="inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0 transition-all"
        style={
          isActive
            ? {
                background:
                  'linear-gradient(135deg, rgba(0,157,219,0.30) 0%, rgba(217,110,39,0.18) 100%)',
                border: '1px solid rgba(0,157,219,0.45)',
                color: 'var(--primary)',
                boxShadow: '0 0 8px rgba(0,157,219,0.30)',
              }
            : {
                background: 'rgba(0,157,219,0.06)',
                border: '1px solid rgba(0,157,219,0.12)',
                color: 'var(--text-secondary)',
              }
        }
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

  useEffect(() => {
    getPacks().then(res => {
      if (res.data) setPacks(res.data);
      setLoading(false);
    });
  }, []);

  const handleInstall = async (packId: string) => {
    const ok = await confirm({
      title: 'Installer ce pack industrie ?',
      description: 'L\'installation va ajouter des champs personnalisés, des templates email et des pipelines à votre CRM. Vous pourrez désinstaller à tout moment depuis les paramètres.',
      confirmLabel: 'Installer',
    });
    if (!ok) return;

    setInstallingId(packId);
    try {
      const res = await installPack(packId, 'gatineau');
      if (res.data) {
        success('Pack installé. Rechargez la page pour voir les changements.', { duration: 8000 });
      } else if (res.error) {
        toastError(`Échec de l'installation: ${res.error}`);
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
      <div className="flex gap-6">
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
      {packs.length === 0 ? (
        <Card className="p-8 text-center text-[var(--text-muted)] border-dashed">
          Aucun pack disponible.
        </Card>
      ) : (
        packs.map(pack => (
          <Card key={pack.id} className="p-5 border-[var(--primary)] hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-bold text-[var(--text-primary)]">{pack.name}</h3>
                <p className="text-sm text-[var(--text-secondary)] mt-1 max-w-xl">{pack.description}</p>
              </div>
              <Tag variant="brand" size="sm">Gratuit</Tag>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5 p-4 bg-[var(--bg-subtle)] rounded-lg">
              <div>
                <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Champs Persos</p>
                <p className="text-lg font-semibold">10+ <span className="text-xs font-normal">inclus</span></p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Templates</p>
                <p className="text-lg font-semibold">3 <span className="text-xs font-normal">inclus</span></p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Workflows</p>
                <p className="text-lg font-semibold">2 <span className="text-xs font-normal">inclus</span></p>
              </div>
            </div>

            <Button 
              className="w-full" 
              onClick={() => void handleInstall(pack.id)}
              disabled={installingId === pack.id}
            >
              {installingId === pack.id ? 'Installation en cours...' : '📦 Installer ce pack (1-clic)'}
            </Button>
          </Card>
        ))
      )}
    </div>
  );
}


