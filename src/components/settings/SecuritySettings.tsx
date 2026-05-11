import { useState, useEffect } from 'react';
import { Card, Button, Input } from '@/components/ui';

export function SecuritySettings() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [totpEnabled, setTotpEnabled] = useState(false);

  useEffect(() => {
    fetch('/api/settings/sessions').then(res => res.json()).then((data: any) => {
      if(data.data) setSessions(data.data);
    });
  }, []);

  const revokeSession = async (id: string) => {
    await fetch(`/api/settings/sessions/${id}`, { method: 'DELETE' });
    setSessions(s => s.filter(x => x.id !== id));
  };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h3 className="text-base font-semibold mb-2">Authentification à deux facteurs (2FA)</h3>
        <p className="text-sm text-[var(--text-muted)] mb-4">Protégez votre compte avec une couche de sécurité supplémentaire.</p>
        <div className="flex items-center justify-between p-4 bg-[var(--bg-subtle)] rounded-lg">
          <div>
            <p className="font-medium text-sm">Application d'authentification</p>
            <p className="text-xs text-[var(--text-muted)]">Utilisez Google Authenticator, Authy ou 1Password.</p>
          </div>
          <Button variant={totpEnabled ? "destructive" : "primary"} onClick={() => setTotpEnabled(!totpEnabled)}>
            {totpEnabled ? 'Désactiver' : 'Activer 2FA'}
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-base font-semibold mb-4">Sessions actives</h3>
        <div className="space-y-3">
          {sessions.length === 0 ? <p className="text-sm text-[var(--text-muted)]">Aucune autre session active.</p> : sessions.map(session => (
            <div key={session.id} className="flex justify-between items-center p-3 border border-[var(--border-subtle)] rounded-lg">
              <div>
                <p className="text-sm font-medium">{session.device_info || 'Appareil inconnu'}</p>
                <p className="text-xs text-[var(--text-muted)]">IP: {session.ip || 'Inconnue'} • Expiration: {new Date(session.expires_at).toLocaleDateString()}</p>
              </div>
              <Button variant="ghost" className="text-[var(--danger)]" onClick={() => revokeSession(session.id)}>Révoquer</Button>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-base font-semibold mb-4">Changer le mot de passe</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input type="password" placeholder="Mot de passe actuel" />
          <Input type="password" placeholder="Nouveau mot de passe" />
        </div>
        <div className="mt-4 flex justify-end">
          <Button>Mettre à jour</Button>
        </div>
      </Card>
    </div>
  );
}
