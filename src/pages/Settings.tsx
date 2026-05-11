// ── Page Settings — Refonte Sprint Design 2 (D2.7) ──────────

import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Badge } from '@/components/ui';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/lib/auth';
import { getLeads } from '@/lib/api';
import { User, Bell, Shield, Palette, Webhook, Keyboard, Settings } from 'lucide-react';

type SettingsTab = 'profil' | 'notifications' | 'securite' | 'apparence' | 'webhook' | 'raccourcis' | 'systeme';

const TABS: { id: SettingsTab; icon: typeof User; label: string; group: string; adminOnly?: boolean }[] = [
  { id: 'profil', icon: User, label: 'Mon profil', group: 'COMPTE' },
  { id: 'notifications', icon: Bell, label: 'Notifications', group: 'COMPTE' },
  { id: 'securite', icon: Shield, label: 'Sécurité', group: 'COMPTE' },
  { id: 'apparence', icon: Palette, label: 'Apparence', group: 'CONFIGURATION' },
  { id: 'webhook', icon: Webhook, label: 'Webhook', group: 'AVANCÉ', adminOnly: true },
  { id: 'raccourcis', icon: Keyboard, label: 'Raccourcis', group: 'AVANCÉ' },
  { id: 'systeme', icon: Settings, label: 'Système', group: 'AVANCÉ' },
];

export function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [activeTab, setActiveTab] = useState<SettingsTab>('profil');
  const [webhookCopied, setWebhookCopied] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [exportStatus, setExportStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [saveMsg, setSaveMsg] = useState('');

  // Profil éditable
  const [profileName, setProfileName] = useState(user?.name || 'Admin');
  const [profileEmail, setProfileEmail] = useState(user?.email || '');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileCompany, setProfileCompany] = useState('Intralys');

  const webhookUrl = `${window.location.origin}/api/webhook/lead`;

  const copyWebhookUrl = () => {
    void navigator.clipboard.writeText(webhookUrl);
    setWebhookCopied(true);
    setTimeout(() => setWebhookCopied(false), 2000);
  };

  const testWebhook = async () => {
    setTestStatus('loading');
    try {
      const res = await fetch('/api/webhook/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'dev-webhook-secret-123', 'X-Client-Id': 'gatineau' },
        body: JSON.stringify({ name: 'Test Lead', email: `test-${Date.now()}@intralys.com`, phone: '819-555-0000', message: 'Lead de test', type: 'buy' }),
      });
      setTestStatus(res.ok ? 'success' : 'error');
    } catch { setTestStatus('error'); }
    setTimeout(() => setTestStatus('idle'), 3000);
  };

  const exportCSV = async () => {
    setExportStatus('loading');
    const result = await getLeads();
    if (result.data && result.data.length > 0) {
      const headers = ['Nom', 'Email', 'Téléphone', 'Type', 'Statut', 'Source', 'Client', 'Créé le'];
      const rows = result.data.map(l => [l.name, l.email, l.phone || '', l.type, l.status, l.source, l.client_name || l.client_id, l.created_at]);
      const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `intralys-leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      URL.revokeObjectURL(url);
    }
    setExportStatus('done');
    setTimeout(() => setExportStatus('idle'), 2000);
  };

  const flashSave = () => { setSaveMsg('✓ Enregistré'); setTimeout(() => setSaveMsg(''), 2000); };

  const visibleTabs = TABS.filter(t => !t.adminOnly || isAdmin);

  return (
    <AppLayout title="Paramètres">
      {/* Mobile tabs — au dessus du contenu */}
      <div className="md:hidden flex gap-1.5 overflow-x-auto pb-3 mb-4 -mx-1 px-1">
        {visibleTabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer border whitespace-nowrap shrink-0 transition-all ${activeTab === tab.id ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]' : 'border-[var(--border-subtle)] text-[var(--text-muted)]'}`}>
            <tab.icon size={13} /> {tab.label}
          </button>
        ))}
      </div>

      <div className="flex gap-6 max-w-5xl">
        {/* Sidebar navigation — desktop */}
        <nav className="hidden md:block w-52 shrink-0">
          {(() => {
            const groups = [...new Set(visibleTabs.map(t => t.group))];
            return groups.map(group => (
              <div key={group} className="mb-4">
                <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-[0.12em] px-3 mb-1.5">{group}</p>
                {visibleTabs.filter(t => t.group === group).map(tab => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-left cursor-pointer transition-all mb-0.5
                      ${activeTab === tab.id ? 'bg-[var(--brand-tint)] text-[var(--brand-primary)] font-medium' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'}`}>
                    <tab.icon size={15} /> {tab.label}
                  </button>
                ))}
              </div>
            ));
          })()}
        </nav>

        {/* Content */}
        <div className="flex-1 space-y-5 min-w-0">
          {/* Profil */}
          {activeTab === 'profil' && (
            <>
              <Card className="p-5">
                <div className="flex items-center gap-4 mb-5">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[var(--brand-primary)] to-[var(--info)] flex items-center justify-center text-2xl font-bold text-white shadow-lg">
                    {profileName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-base font-semibold">{profileName}</h3>
                    <p className="text-sm text-[var(--text-muted)]">{profileEmail || '—'}</p>
                    <Badge color={isAdmin ? 'var(--brand-primary)' : 'var(--info)'}>{isAdmin ? 'Administrateur' : 'Courtier'}</Badge>
                  </div>
                  {saveMsg && <span className="ml-auto text-sm text-[var(--success)]">{saveMsg}</span>}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Nom complet</label>
                    <Input value={profileName} onChange={e => setProfileName(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Courriel</label>
                    <Input value={profileEmail} onChange={e => setProfileEmail(e.target.value)} type="email" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Téléphone</label>
                    <Input value={profilePhone} onChange={e => setProfilePhone(e.target.value)} placeholder="+1 819 555-0000" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Entreprise</label>
                    <Input value={profileCompany} onChange={e => setProfileCompany(e.target.value)} />
                  </div>
                </div>
                <div className="flex justify-end mt-4">
                  <Button onClick={flashSave}>💾 Enregistrer</Button>
                </div>
              </Card>
            </>
          )}

          {/* Notifications */}
          {activeTab === 'notifications' && (
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-4">🔔 Notifications</h3>
              <div className="space-y-1">
                {[
                  { label: 'Email nouveau lead', desc: 'Recevoir un email quand un nouveau lead arrive', on: true },
                  { label: 'Rappel RDV', desc: 'Rappel 1h avant chaque rendez-vous', on: true },
                  { label: 'Lead score élevé', desc: 'Notification quand un lead atteint un score ≥ 70', on: false },
                  { label: 'Résumé hebdomadaire', desc: 'Résumé des leads et performances chaque lundi', on: false },
                  { label: 'Workflow terminé', desc: 'Notification quand un lead termine un workflow', on: true },
                  { label: 'Tâche en retard', desc: 'Alerte quand une tâche dépasse sa date limite', on: true },
                ].map(n => (
                  <div key={n.label} className="flex items-center justify-between py-3 border-b border-[var(--border-subtle)] last:border-0">
                    <div>
                      <p className="text-sm">{n.label}</p>
                      <p className="text-xs text-[var(--text-muted)]">{n.desc}</p>
                    </div>
                    <ToggleSwitch defaultChecked={n.on} />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Sécurité */}
          {activeTab === 'securite' && (
            <>
              <Card className="p-5">
                <h3 className="text-sm font-semibold mb-4">🔒 Changer le mot de passe</h3>
                <div className="space-y-3 max-w-md">
                  <div>
                    <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Mot de passe actuel</label>
                    <Input type="password" placeholder="••••••••" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Nouveau mot de passe</label>
                    <Input type="password" placeholder="Minimum 8 caractères" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Confirmer</label>
                    <Input type="password" placeholder="Répétez le mot de passe" />
                  </div>
                  <Button onClick={flashSave}>🔐 Mettre à jour</Button>
                </div>
              </Card>
              <Card className="p-5">
                <h3 className="text-sm font-semibold mb-3">📋 Sessions actives</h3>
                <div className="space-y-2">
                  {[
                    { device: '💻 Chrome · Windows', ip: '192.168.1.x', time: 'Maintenant', current: true },
                    { device: '📱 Safari · iPhone', ip: '10.0.0.x', time: 'Il y a 2h', current: false },
                  ].map(s => (
                    <div key={s.device} className="flex items-center justify-between py-2 px-3 bg-[var(--bg-subtle)] rounded-[var(--radius-md)]">
                      <div>
                        <p className="text-sm">{s.device} {s.current && <Badge color="var(--success)">Active</Badge>}</p>
                        <p className="text-[10px] text-[var(--text-muted)]">{s.ip} · {s.time}</p>
                      </div>
                      {!s.current && <button className="text-xs text-[var(--danger)] hover:underline cursor-pointer">Déconnecter</button>}
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}

          {/* Apparence */}
          {activeTab === 'apparence' && (
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-4">🎨 Apparence</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-[var(--text-muted)] mb-2 block">Thème</label>
                  <div className="flex gap-3">
                    {[
                      { id: 'light', label: '☀️ Clair', active: true },
                      { id: 'dark', label: '🌙 Sombre', active: false },
                      { id: 'auto', label: '🖥️ Système', active: false },
                    ].map(t => (
                      <button key={t.id}
                        className={`px-4 py-3 rounded-[var(--radius-md)] border text-sm cursor-pointer transition-all ${t.active ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]' : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--brand-primary)]'}`}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-[var(--text-muted)] mb-2 block">Couleur d'accent</label>
                  <div className="flex gap-2">
                    {['oklch(0.55 0.24 265)', 'oklch(0.60 0.19 155)', 'oklch(0.65 0.20 30)', 'oklch(0.55 0.22 330)', 'oklch(0.60 0.18 245)'].map(c => (
                      <button key={c} className="w-8 h-8 rounded-full border-2 border-transparent hover:border-white cursor-pointer transition-all hover:scale-110" style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-[var(--text-muted)] mb-2 block">Sidebar</label>
                  <div className="flex gap-3">
                    <button className="px-4 py-2 rounded-[var(--radius-md)] border border-[var(--brand-primary)] bg-[var(--brand-primary)]/10 text-[var(--brand-primary)] text-xs cursor-pointer">📌 Épinglée</button>
                    <button className="px-4 py-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] text-[var(--text-muted)] text-xs cursor-pointer">📁 Rétractable</button>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Webhook */}
          {activeTab === 'webhook' && isAdmin && (
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-1">Webhook — Réception des leads</h3>
              <p className="text-xs text-[var(--text-muted)] mb-4">Configurez vos sites clients pour envoyer les leads vers cette URL.</p>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-[var(--text-muted)] mb-1 block">URL du webhook</label>
                  <div className="flex gap-2">
                    <div className="flex-1 px-3 py-2.5 text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-secondary)] font-mono truncate">{webhookUrl}</div>
                    <Button variant="secondary" size="sm" onClick={copyWebhookUrl}>{webhookCopied ? '✓ Copié' : 'Copier'}</Button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-[var(--text-muted)] mb-2 block">Headers requis</label>
                  <div className="bg-[var(--bg-canvas)] rounded-[var(--radius-md)] p-3 space-y-1.5 font-mono text-xs">
                    <div className="flex"><span className="text-[var(--brand-primary)] w-40">Content-Type</span><span className="text-[var(--text-secondary)]">application/json</span></div>
                    <div className="flex"><span className="text-[var(--brand-primary)] w-40">X-Webhook-Secret</span><span className="text-[var(--text-muted)]">votre-secret-webhook</span></div>
                    <div className="flex"><span className="text-[var(--brand-primary)] w-40">X-Client-Id</span><span className="text-[var(--text-muted)]">id-du-client</span></div>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-[var(--text-muted)] mb-2 block">Corps de la requête (JSON)</label>
                  <pre className="bg-[var(--bg-canvas)] rounded-[var(--radius-md)] p-3 font-mono text-xs text-[var(--text-secondary)] overflow-x-auto">{`{
  "name": "Nom du lead",
  "email": "email@example.com",
  "phone": "819-555-0000",
  "message": "Message optionnel",
  "type": "buy"
}`}</pre>
                </div>
                <div className="flex items-center gap-3 pt-2 border-t border-[var(--border-subtle)]">
                  <Button variant="secondary" size="sm" onClick={() => void testWebhook()} isLoading={testStatus === 'loading'}>🧪 Tester le webhook</Button>
                  {testStatus === 'success' && <span className="text-xs text-[var(--success)]">✓ Lead de test créé !</span>}
                  {testStatus === 'error' && <span className="text-xs text-[var(--danger)]">✗ Erreur — vérifiez le worker</span>}
                </div>
              </div>
            </Card>
          )}

          {/* Raccourcis clavier */}
          {activeTab === 'raccourcis' && (
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-4">⌨️ Raccourcis clavier</h3>
              <div className="space-y-1">
                {[
                  { keys: '⌘ K', desc: 'Recherche globale' },
                  { keys: '⌘ /', desc: 'Aide' },
                  { keys: 'G → D', desc: 'Aller au Dashboard' },
                  { keys: 'G → L', desc: 'Aller aux Leads' },
                  { keys: 'G → P', desc: 'Aller au Pipeline' },
                  { keys: 'G → C', desc: 'Aller au Calendrier' },
                  { keys: 'G → T', desc: 'Aller aux Tâches' },
                  { keys: 'G → R', desc: 'Aller aux Rapports' },
                  { keys: 'Esc', desc: 'Fermer le dialogue actif' },
                  { keys: '↑ ↓', desc: 'Naviguer dans les listes' },
                  { keys: '↵', desc: 'Ouvrir l\'élément sélectionné' },
                ].map(s => (
                  <div key={s.keys} className="flex items-center justify-between py-2.5 border-b border-[var(--border-subtle)] last:border-0">
                    <span className="text-sm text-[var(--text-secondary)]">{s.desc}</span>
                    <div className="flex gap-1">
                      {s.keys.split(' ').map((k, i) => (
                        k === '→' ? <span key={i} className="text-[var(--text-muted)] text-xs">→</span> :
                        <kbd key={i} className="px-2 py-0.5 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded text-xs font-mono text-[var(--text-muted)]">{k}</kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Système */}
          {activeTab === 'systeme' && (
            <>
              <Card className="p-5">
                <h3 className="text-sm font-semibold mb-4">⚙️ Informations système</h3>
                <div className="space-y-0">
                  {[
                    ['Version', '2.0.0 — Phase 6'],
                    ['Hébergement', 'Cloudflare Workers + D1'],
                    ['Base de données', 'intralys-crm (SQLite)'],
                    ['Frontend', 'React + TypeScript + Tailwind v4'],
                    ['Graphiques', 'Recharts'],
                    ['Router', 'TanStack Router'],
                    ['Modules', 'CRM · Inbox · Workflows · Calendrier · Intégrations · Rapports'],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between py-2.5 border-b border-[var(--border-subtle)] last:border-0">
                      <span className="text-sm text-[var(--text-secondary)]">{label}</span>
                      <span className="text-sm font-medium text-[var(--text-muted)]">{value}</span>
                    </div>
                  ))}
                </div>
              </Card>
              {isAdmin && (
                <Card className="p-5 border-[var(--danger)]/30">
                  <h3 className="text-sm font-semibold text-[var(--danger)] mb-2">⚠️ Zone dangereuse</h3>
                  <p className="text-xs text-[var(--text-muted)] mb-3">Actions sensibles. Procédez avec prudence.</p>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => void exportCSV()} isLoading={exportStatus === 'loading'}>
                      {exportStatus === 'done' ? '✓ Exporté' : '📥 Exporter leads (CSV)'}
                    </Button>
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

// ── Toggle Switch ───────────────────────────────────────────

function ToggleSwitch({ defaultChecked = false }: { defaultChecked?: boolean }) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <button type="button" onClick={() => setChecked(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${checked ? 'bg-[var(--brand-primary)]' : 'bg-[var(--bg-subtle)]'}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 mt-0.5 ${checked ? 'translate-x-4 ml-0.5' : 'translate-x-0.5'}`} />
    </button>
  );
}
