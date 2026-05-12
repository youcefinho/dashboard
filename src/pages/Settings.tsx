// ── Page Settings — Centre Nerveux (Sprint 8) ────────────────
import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth';
import { getPacks, installPack, type IndustryPack } from '@/lib/api';
import { Card, Button, Badge } from '@/components/ui';
import { 
  User, Bell, Shield, Palette, 
  Columns, Package, Brain, Users, Key, FileText, CreditCard,
  Building, BookOpen, Fingerprint, Smartphone
} from 'lucide-react';

// Sous-composants importés
import { ProfileSettings } from '@/components/settings/ProfileSettings';
import { SecuritySettings } from '@/components/settings/SecuritySettings';
import { TeamSettings } from '@/components/settings/TeamSettings';
import { RolesPermissionsSettings } from '@/components/settings/RolesPermissionsSettings';
import { ApiWebhooksSettings } from '@/components/settings/ApiWebhooksSettings';
import { BrandingSettings } from '@/components/settings/BrandingSettings';
import { BillingSettings } from '@/components/settings/BillingSettings';
import { AuditLogSettings } from '@/components/settings/AuditLogSettings';
import { PipelineSettings } from '@/components/settings/PipelineSettings';
import { ComplianceSettings } from './settings/ComplianceSettings';
import { CustomFieldsSettings } from './settings/CustomFieldsSettings';

type SettingsTab = 'profil' | 'notifications' | 'securite' | 'equipe' | 'roles' | 'branding' | 'billing' | 'audit' | 'api' | 'pipelines' | 'custom_fields' | 'conformite' | 'raccourcis' | 'systeme' | 'packs' | 'ai_scoring';

const TABS: { id: SettingsTab; icon: typeof User; label: string; group: string; adminOnly?: boolean }[] = [
  { id: 'profil', icon: User, label: 'Mon profil', group: 'COMPTE' },
  { id: 'notifications', icon: Bell, label: 'Notifications', group: 'COMPTE' },
  { id: 'securite', icon: Shield, label: 'Sécurité & Sessions', group: 'COMPTE' },
  
  { id: 'branding', icon: Palette, label: 'Branding & Sous-compte', group: 'CONFIGURATION', adminOnly: true },
  { id: 'custom_fields', icon: FileText, label: 'Champs Persos', group: 'CONFIGURATION', adminOnly: true },
  { id: 'pipelines', icon: Columns, label: 'Pipelines', group: 'CONFIGURATION', adminOnly: true },
  
  { id: 'equipe', icon: Users, label: 'Équipe & Utilisateurs', group: 'AGENCE', adminOnly: true },
  { id: 'roles', icon: Shield, label: 'Rôles & Permissions', group: 'AGENCE', adminOnly: true },
  { id: 'billing', icon: CreditCard, label: 'Facturation & Usage', group: 'AGENCE', adminOnly: true },
  { id: 'packs', icon: Package, label: 'Packs Industrie', group: 'AGENCE', adminOnly: true },

  { id: 'api', icon: Key, label: 'API & Webhooks', group: 'AVANCÉ', adminOnly: true },
  { id: 'conformite', icon: BookOpen, label: 'Conformité & RGPD', group: 'AVANCÉ', adminOnly: true },
  { id: 'ai_scoring', icon: Brain, label: 'IA & Scoring', group: 'AVANCÉ', adminOnly: true },
  { id: 'audit', icon: Building, label: 'Journal d\'Audit', group: 'AVANCÉ', adminOnly: true },
];

export function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [activeTab, setActiveTab] = useState<SettingsTab>('profil');

  const visibleTabs = TABS.filter(t => !t.adminOnly || isAdmin);

  const renderContent = () => {
    switch (activeTab) {
      case 'profil': return <ProfileSettings user={user} isAdmin={isAdmin} />;
      case 'securite': return <SecuritySettings />;
      case 'equipe': return <TeamSettings />;
      case 'roles': return <RolesPermissionsSettings />;
      case 'api': return <ApiWebhooksSettings />;
      case 'branding': return <BrandingSettings />;
      case 'billing': return <BillingSettings />;
      case 'audit': return <AuditLogSettings />;
      case 'pipelines': return <PipelineSettings />;
      case 'conformite': return <ComplianceSettings />;
      case 'custom_fields': return <CustomFieldsSettings />;
      case 'packs': return <PacksSettings />;
      case 'notifications': return <NotificationsSettings />;
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
      {/* Mobile tabs */}
      <div className="md:hidden flex gap-1.5 overflow-x-auto pb-3 mb-4 -mx-1 px-1 no-scrollbar">
        {visibleTabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer border whitespace-nowrap shrink-0 transition-all ${activeTab === tab.id ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]' : 'border-[var(--border-subtle)] text-[var(--text-muted)]'}`}>
            <tab.icon size={13} /> {tab.label}
          </button>
        ))}
      </div>

      <div className="flex gap-6 max-w-6xl">
        {/* Sidebar navigation */}
        <nav className="hidden md:block w-56 shrink-0 h-[calc(100vh-120px)] overflow-y-auto pr-2">
          {(() => {
            const groups = [...new Set(visibleTabs.map(t => t.group))];
            return groups.map(group => (
              <div key={group} className="mb-6">
                <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.1em] px-3 mb-2">{group}</p>
                {visibleTabs.filter(t => t.group === group).map(tab => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left cursor-pointer transition-all mb-0.5
                      ${activeTab === tab.id ? 'bg-[var(--brand-tint)] text-[var(--brand-primary)] font-medium shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'}`}>
                    <tab.icon size={16} /> {tab.label}
                  </button>
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

// ── Composant Inline PacksSettings ──
function PacksSettings() {
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
    if (!confirm('Attention : L\'installation d\'un pack va ajouter des champs, templates et pipelines à votre CRM. Continuer ?')) return;
    
    setInstallingId(packId);
    try {
      const res = await installPack(packId, 'gatineau');
      if (res.data) {
        alert('✅ Pack installé avec succès ! Rechargez la page pour voir les changements.');
      } else if (res.error) {
        alert(`❌ Erreur: ${res.error}`);
      }
    } catch (err: any) {
      alert(`❌ Erreur: ${err.message}`);
    } finally {
      setInstallingId(null);
    }
  };

  if (loading) return <div className="p-8 text-center text-[var(--text-muted)]">Chargement des packs...</div>;

  return (
    <div className="space-y-4">
      {packs.length === 0 ? (
        <Card className="p-8 text-center text-[var(--text-muted)] border-dashed">
          Aucun pack disponible.
        </Card>
      ) : (
        packs.map(pack => (
          <Card key={pack.id} className="p-5 border-[var(--brand-primary)] hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-bold text-[var(--text-primary)]">{pack.name}</h3>
                <p className="text-sm text-[var(--text-secondary)] mt-1 max-w-xl">{pack.description}</p>
              </div>
              <Badge color="var(--brand-primary)">Gratuit</Badge>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-5 p-4 bg-[var(--bg-subtle)] rounded-lg">
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

// ── Composant Inline NotificationsSettings ──
function NotificationsSettings() {
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [isNative, setIsNative] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    import('@capacitor/core').then(({ Capacitor }) => {
      setIsNative(Capacitor.isNativePlatform());
      if (Capacitor.isNativePlatform()) {
        import('@/lib/biometric').then(({ isBiometricAvailable }) => {
          isBiometricAvailable().then(setBiometricAvailable);
        });
        setBiometricEnabled(localStorage.getItem('biometric_enabled') === '1');
      }
    });
    import('@/lib/offline/db').then(({ getPendingMutationCount }) => {
      getPendingMutationCount().then(setPendingCount);
    });
  }, []);

  const toggleBiometric = async () => {
    if (biometricEnabled) {
      // Désactiver
      const { deleteBiometricCredentials } = await import('@/lib/biometric');
      await deleteBiometricCredentials('crm.intralys.com');
      localStorage.removeItem('biometric_enabled');
      setBiometricEnabled(false);
    } else {
      // Activer — les credentials seront sauvés au prochain login
      localStorage.setItem('biometric_enabled', '1');
      setBiometricEnabled(true);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Bell size={16} className="text-[var(--brand-primary)]" /> Notifications Push
        </h3>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          Les notifications push vous alertent en temps réel quand un nouveau lead arrive,
          une tâche est en retard, ou un message est reçu.
        </p>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-subtle)]">
            <div className="flex items-center gap-2 text-sm">
              <span>📥</span> Nouveau lead
            </div>
            <span className="text-xs text-[var(--success)] font-medium">Activé</span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-subtle)]">
            <div className="flex items-center gap-2 text-sm">
              <span>💬</span> Nouveau message
            </div>
            <span className="text-xs text-[var(--success)] font-medium">Activé</span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-subtle)]">
            <div className="flex items-center gap-2 text-sm">
              <span>⏰</span> Tâche en retard
            </div>
            <span className="text-xs text-[var(--success)] font-medium">Activé</span>
          </div>
        </div>
      </Card>

      {isNative && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Fingerprint size={16} className="text-[var(--brand-primary)]" /> Authentification biométrique
          </h3>
          {biometricAvailable ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">Connexion par FaceID / TouchID</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {biometricEnabled ? 'Activé — déverrouillage rapide au prochain login' : 'Désactivé — connectez-vous avec vos identifiants'}
                </p>
              </div>
              <button
                onClick={() => void toggleBiometric()}
                className={`w-12 h-6 rounded-full relative transition-all cursor-pointer ${biometricEnabled ? 'bg-[var(--brand-primary)]' : 'bg-[var(--border-default)]'}`}
              >
                <span className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all shadow-sm ${biometricEnabled ? 'left-[27px]' : 'left-[3px]'}`} />
              </button>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              La biométrie n'est pas disponible sur cet appareil.
            </p>
          )}
        </Card>
      )}

      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Smartphone size={16} className="text-[var(--brand-primary)]" /> Mode hors ligne
        </h3>
        <p className="text-sm text-[var(--text-muted)] mb-3">
          L'app met en cache vos leads, conversations et tâches pour un accès rapide même sans connexion.
          Les modifications faites hors ligne sont automatiquement synchronisées au retour online.
        </p>
        <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-subtle)]">
          <span className="text-sm">Actions en attente de sync</span>
          <Badge color={pendingCount > 0 ? 'var(--warning)' : 'var(--success)'}>{pendingCount}</Badge>
        </div>
      </Card>
    </div>
  );
}
