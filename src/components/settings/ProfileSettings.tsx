import { useState } from 'react';
import { Card, Button, Input, Badge, useToast } from '@/components/ui';
import { updateProfile } from '@/lib/api';

export function ProfileSettings({ user, isAdmin }: { user: any; isAdmin: boolean }) {
  const [profileName, setProfileName] = useState(user?.name || 'Admin');
  const [profileEmail, setProfileEmail] = useState(user?.email || '');
  const [profilePhone, setProfilePhone] = useState('');
  const [emailSignature, setEmailSignature] = useState(user?.email_signature || '');
  const [loading, setLoading] = useState(false);
  const { success, error: toastError } = useToast();

  const handleSave = async () => {
    setLoading(true);
    const res = await updateProfile({
      name: profileName,
      email_signature: emailSignature
    });
    setLoading(false);
    if (!res.error) {
      success('Profil mis à jour');
    } else {
      toastError(res.error);
    }
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
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Nom complet</label>
          <Input value={profileName} onChange={(e: any) => setProfileName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Courriel</label>
          <Input value={profileEmail} onChange={(e: any) => setProfileEmail(e.target.value)} type="email" disabled />
        </div>
        <div>
          <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Téléphone</label>
          <Input value={profilePhone} onChange={(e: any) => setProfilePhone(e.target.value)} placeholder="+1 819 555-0000" />
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Signature Email (HTML accepté)</label>
          <textarea 
            className="w-full h-24 p-3 text-sm border border-[var(--border-subtle)] rounded-lg font-mono focus:ring-2 focus:ring-[var(--brand-primary)] focus:border-transparent outline-none" 
            placeholder="Cordialement,<br/><b>Mon Nom</b>"
            value={emailSignature}
            onChange={(e) => setEmailSignature(e.target.value)}
          ></textarea>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">Cette signature sera automatiquement insérée en bas des emails que vous envoyez depuis le CRM.</p>
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <Button onClick={handleSave} disabled={loading} isLoading={loading}>Mettre à jour le profil</Button>
      </div>
    </Card>
  );
}
