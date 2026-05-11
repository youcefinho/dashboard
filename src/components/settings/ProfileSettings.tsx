import { useState } from 'react';
import { Card, Button, Input, Badge } from '@/components/ui';

export function ProfileSettings({ user, isAdmin }: { user: any; isAdmin: boolean }) {
  const [profileName, setProfileName] = useState(user?.name || 'Admin');
  const [profileEmail, setProfileEmail] = useState(user?.email || '');
  const [profilePhone, setProfilePhone] = useState('');
  const [saveMsg, setSaveMsg] = useState('');

  const handleSave = () => {
    setSaveMsg('✓ Enregistré');
    setTimeout(() => setSaveMsg(''), 2000);
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-4 mb-5">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[var(--brand-primary)] to-[var(--info)] flex items-center justify-center text-2xl font-bold text-white shadow-lg">
          {profileName.charAt(0).toUpperCase()}
        </div>
        <div>
          <h3 className="text-base font-semibold">{profileName}</h3>
          <p className="text-sm text-[var(--text-muted)]">{profileEmail || '—'}</p>
          <Badge color={isAdmin ? 'var(--brand-primary)' : 'var(--info)'}>{isAdmin ? 'Administrateur' : 'Utilisateur'}</Badge>
        </div>
        {saveMsg && <span className="ml-auto text-sm text-[var(--success)]">{saveMsg}</span>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Nom complet</label>
          <Input value={profileName} onChange={(e: any) => setProfileName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Courriel</label>
          <Input value={profileEmail} onChange={(e: any) => setProfileEmail(e.target.value)} type="email" />
        </div>
        <div>
          <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Téléphone</label>
          <Input value={profilePhone} onChange={(e: any) => setProfilePhone(e.target.value)} placeholder="+1 819 555-0000" />
        </div>
        <div>
          <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Signature Email</label>
          <textarea className="w-full h-[38px] p-2 text-sm border border-[var(--border-subtle)] rounded-lg" placeholder="Cordialement, ..."></textarea>
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <Button onClick={handleSave}>Mettre à jour le profil</Button>
      </div>
    </Card>
  );
}
