import { useState, useEffect } from 'react';
import { Card, Button, Modal, useToast } from '@/components/ui';
import { getSessions, deleteSession, deleteOtherSessions, generateBackupCodes, type AdminSession } from '@/lib/api';
import { Smartphone, Monitor, Download, Copy, AlertTriangle } from 'lucide-react';

export function SecuritySettings() {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [loading, setLoading] = useState(true);
  const { success, error: toastError } = useToast();

  const fetchSessions = async () => {
    setLoading(true);
    const res = await getSessions();
    if (res.data) setSessions(res.data);
    setLoading(false);
  };

  useEffect(() => {
    void fetchSessions();
  }, []);

  const revokeSession = async (token: string) => {
    const res = await deleteSession(token);
    if (!res.error) {
      success('Session révoquée avec succès');
      setSessions(s => s.filter(x => x.token !== token));
    } else toastError(res.error);
  };

  const revokeOtherSessions = async () => {
    if (!confirm('Voulez-vous vraiment fermer toutes les autres sessions ?')) return;
    const res = await deleteOtherSessions();
    if (!res.error) {
      success('Toutes les autres sessions ont été fermées');
      void fetchSessions();
    } else toastError(res.error);
  };

  const handleGenerateBackupCodes = async () => {
    if (!confirm('Générer de nouveaux codes de secours invalidere les anciens. Continuer ?')) return;
    const res = await generateBackupCodes();
    if (res.data) {
      setBackupCodes(res.data.codes);
      setShowBackupCodes(true);
      success('Codes de secours générés avec succès');
    } else toastError(res.error || 'Erreur lors de la génération');
  };

  const copyCodes = () => {
    navigator.clipboard.writeText(backupCodes.join('\n'));
    success('Codes copiés dans le presse-papiers');
  };

  const downloadCodes = () => {
    const element = document.createElement('a');
    const file = new Blob([backupCodes.join('\n')], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = 'intralys-backup-codes.txt';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h3 className="text-base font-semibold mb-2">Authentification à deux facteurs (2FA)</h3>
        <p className="text-sm text-[var(--text-muted)] mb-4">Protégez votre compte avec une couche de sécurité supplémentaire.</p>
        <div className="flex items-center justify-between p-4 bg-[var(--bg-subtle)] rounded-lg mb-4">
          <div>
            <p className="font-medium text-sm">Application d'authentification</p>
            <p className="text-xs text-[var(--text-muted)]">Utilisez Google Authenticator, Authy ou 1Password.</p>
          </div>
          <Button variant={totpEnabled ? "destructive" : "primary"} onClick={() => setTotpEnabled(!totpEnabled)}>
            {totpEnabled ? 'Désactiver' : 'Activer 2FA'}
          </Button>
        </div>
        
        {totpEnabled && (
          <div className="flex items-center justify-between p-4 border border-[var(--border-subtle)] rounded-lg">
            <div>
              <p className="font-medium text-sm">Codes de secours</p>
              <p className="text-xs text-[var(--text-muted)]">En cas de perte de votre appareil.</p>
            </div>
            <Button variant="secondary" size="sm" onClick={handleGenerateBackupCodes}>Générer nouveaux codes</Button>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-semibold">Sessions actives</h3>
          <Button variant="secondary" size="sm" onClick={revokeOtherSessions} className="text-[var(--danger)] border-[var(--danger)]/20 hover:bg-[var(--danger)]/10">
            Fermer autres sessions
          </Button>
        </div>
        <div className="space-y-3">
          {loading ? <p className="text-sm text-[var(--text-muted)]">Chargement...</p> : 
           sessions.length === 0 ? <p className="text-sm text-[var(--text-muted)]">Aucune session active.</p> : sessions.map(session => (
            <div key={session.token} className="flex justify-between items-center p-3 border border-[var(--border-subtle)] rounded-lg">
              <div className="flex gap-3 items-center">
                <div className="w-8 h-8 rounded-full bg-[var(--brand-tint)] flex items-center justify-center text-[var(--brand-primary)]">
                  {session.user_agent?.toLowerCase().includes('mobile') ? <Smartphone size={16} /> : <Monitor size={16} />}
                </div>
                <div>
                  <p className="text-sm font-medium flex items-center gap-2">
                    {session.user_agent || 'Appareil inconnu'}
                    {session.is_current && <span className="text-[10px] bg-[var(--brand-primary)]/10 text-[var(--brand-primary)] px-2 py-0.5 rounded-full font-semibold">Actuelle</span>}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">IP: {session.ip || 'Inconnue'} • Actif le {new Date(session.last_active_at).toLocaleString()}</p>
                </div>
              </div>
              {!session.is_current && (
                <Button variant="ghost" className="text-[var(--danger)]" onClick={() => revokeSession(session.token)}>Révoquer</Button>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Modal isOpen={showBackupCodes} onClose={() => setShowBackupCodes(false)} title="Codes de secours 2FA">
        <div className="p-4 space-y-4">
          <div className="flex items-start gap-3 p-3 bg-[var(--warning)]/10 text-[var(--warning)] rounded-lg">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <p className="text-sm">Ces codes ne seront affichés qu'une seule fois. Veuillez les copier ou les télécharger immédiatement et les conserver en lieu sûr.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 font-mono text-center text-sm p-4 bg-[var(--bg-subtle)] rounded border border-[var(--border-subtle)]">
            {backupCodes.map((code, i) => (
              <div key={i} className="tracking-widest">{code}</div>
            ))}
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" onClick={copyCodes} leftIcon={<Copy size={16} />}>Copier</Button>
            <Button variant="primary" onClick={downloadCodes} leftIcon={<Download size={16} />}>Télécharger</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
