import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { Input, Button } from '@/components/ui';
import { Shield, Ban, Download } from 'lucide-react';

interface Unsubscribe {
  id: string;
  email: string;
  phone: string;
  channel: string;
  reason: string;
  unsubscribed_at: string;
}

export function ComplianceSettings() {
  const [amfCert, setAmfCert] = useState('');
  const [amfRequired, setAmfRequired] = useState(false);
  const [unsubscribes, setUnsubscribes] = useState<Unsubscribe[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    apiFetch<Unsubscribe[]>('/unsubscribes')
      .then(res => {
        setUnsubscribes(res.data || []);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const handleSaveAmf = async () => {
    // TODO: Sauvegarder dans le client courant
  };

  const handleExportUnsubscribes = () => {
    if (!unsubscribes) return;
    const csvContent = "data:text/csv;charset=utf-8," 
      + "Email,Phone,Channel,Date\n"
      + unsubscribes.map(e => `${e.email},${e.phone},${e.channel},${e.unsubscribed_at}`).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "unsubscribes.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const timeAgo = (dateStr: string): string => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffH = Math.floor(diffMin / 60);
    const diffD = Math.floor(diffH / 24);
    if (diffMin < 1) return "À l'instant";
    if (diffMin < 60) return `Il y a ${diffMin} min`;
    if (diffH < 24) return `Il y a ${diffH}h`;
    return `Il y a ${diffD} jours`;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Shield size={24} className="text-[var(--brand-primary)]" />
          Conformité & Légal
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Gérez vos listes de désabonnement (CASL) et vos mentions légales (AMF).
        </p>
      </div>

      <div className="card p-6">
        <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
          <Shield size={16} /> Mentions AMF
        </h3>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <input 
              type="checkbox" 
              id="amf-req"
              checked={amfRequired} 
              onChange={(e: any) => setAmfRequired(e.target.checked)} 
              className="rounded border-[var(--border-default)]"
            />
            <label htmlFor="amf-req" className="text-sm">Activer le disclaimer AMF automatique dans les emails</label>
          </div>
          {amfRequired && (
            <Input 
              label="Numéro de certificat AMF" 
              value={amfCert} 
              onChange={(e: any) => setAmfCert(e.target.value)} 
              placeholder="ex: 123456" 
            />
          )}
          <Button onClick={handleSaveAmf} disabled={amfRequired && !amfCert}>Sauvegarder</Button>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-subtle)]">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Ban size={16} /> Liste de suppression (Opt-outs)
          </h3>
          <Button size="sm" variant="secondary" onClick={handleExportUnsubscribes} className="gap-2">
            <Download size={14} /> Exporter
          </Button>
        </div>
        
        {isLoading ? (
          <div className="p-8 text-center text-sm text-[var(--text-muted)]">Chargement...</div>
        ) : unsubscribes?.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--text-muted)]">
            Aucun contact désabonné.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--bg-canvas)]">
                <th className="py-2 px-4 font-medium">Contact</th>
                <th className="py-2 px-4 font-medium">Canal</th>
                <th className="py-2 px-4 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {unsubscribes?.map((unsub: any) => (
                <tr key={unsub.id} className="hover:bg-[var(--bg-subtle)] transition-colors">
                  <td className="py-2 px-4 font-medium">{unsub.email || unsub.phone}</td>
                  <td className="py-2 px-4">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[var(--danger-soft)] text-[var(--danger)] uppercase">
                      {unsub.channel}
                    </span>
                  </td>
                  <td className="py-2 px-4 text-[var(--text-secondary)]">{timeAgo(unsub.unsubscribed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
