import { useState } from 'react';
import { Card, Button, Input } from '@/components/ui';

export function BrandingSettings() {
  const [saveMsg, setSaveMsg] = useState('');

  const handleSave = () => {
    setSaveMsg('✓ Enregistré');
    setTimeout(() => setSaveMsg(''), 2000);
  };

  return (
    <Card className="p-5">
      <h3 className="text-base font-semibold mb-4">Branding & Sous-compte</h3>
      
      <div className="flex items-center gap-6 mb-6">
        <div className="w-24 h-24 border-2 border-dashed border-[var(--border-strong)] rounded-lg flex flex-col items-center justify-center text-[var(--text-muted)] cursor-pointer hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)] transition-colors">
          <span className="text-2xl mb-1">📷</span>
          <span className="text-[10px] font-medium">Uploader Logo</span>
        </div>
        <div className="flex-1">
          <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Couleur Principale (HEX)</label>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded border border-[var(--border-subtle)] bg-[#009DDB]"></div>
            <Input defaultValue="#009DDB" className="w-32 font-mono" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 mb-6">
        <div>
          <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Nom de l'entreprise</label>
          <Input defaultValue="Intralys Demo" />
        </div>
        <div>
          <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Adresse</label>
          <textarea className="w-full h-[60px] p-2 text-sm border border-[var(--border-subtle)] rounded-lg" defaultValue="123 rue de la Demo, Québec"></textarea>
        </div>
      </div>

      <div className="flex justify-between items-center">
        {saveMsg && <span className="text-sm text-[var(--success)]">{saveMsg}</span>}
        <Button onClick={handleSave} className="ml-auto">Sauvegarder les modifications</Button>
      </div>
    </Card>
  );
}
