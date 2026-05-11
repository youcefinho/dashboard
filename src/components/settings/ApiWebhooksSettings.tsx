import { useState, useEffect } from 'react';
import { Card, Button, Input, Modal, Badge } from '@/components/ui';

export function ApiWebhooksSettings() {
  const [keys, setKeys] = useState<any[]>([]);
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [showWhModal, setShowWhModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newWhUrl, setNewWhUrl] = useState('');
  const [newWhEvents, setNewWhEvents] = useState('lead.created');
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings/api-keys').then(res => res.json()).then((data: any) => setKeys(data.data || []));
    fetch('/api/settings/webhooks').then(res => res.json()).then((data: any) => setWebhooks(data.data || []));
  }, []);

  const createApiKey = async () => {
    const res = await fetch('/api/settings/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newKeyName })
    });
    const data: any = await res.json();
    if(data.data) {
      setKeys([...keys, data.data]);
      setCreatedKey(data.data.key); // Montre la clé brute une seule fois
    }
  };

  const createWebhook = async () => {
    const res = await fetch('/api/settings/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: newWhUrl, events: newWhEvents })
    });
    const data: any = await res.json();
    if(data.data) {
      setWebhooks([...webhooks, data.data]);
      setShowWhModal(false);
      setNewWhUrl('');
    }
  };

  const deleteKey = async (id: string) => {
    await fetch(`/api/settings/api-keys/${id}`, { method: 'DELETE' });
    setKeys(keys.filter(k => k.id !== id));
  };

  const deleteWebhook = async (id: string) => {
    await fetch(`/api/settings/webhooks/${id}`, { method: 'DELETE' });
    setWebhooks(webhooks.filter(w => w.id !== id));
  };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-semibold">Clés API (v2)</h3>
          <Button onClick={() => setShowKeyModal(true)}>+ Créer une clé</Button>
        </div>
        <div className="space-y-3">
          {keys.map(k => (
            <div key={k.id} className="flex justify-between items-center p-3 border border-[var(--border-subtle)] rounded-lg">
              <div>
                <p className="text-sm font-medium">{k.name}</p>
                <p className="text-xs text-[var(--text-muted)]">Créée le {new Date(k.created_at).toLocaleDateString()} • {k.scopes}</p>
              </div>
              <Button variant="ghost" className="text-[var(--danger)]" onClick={() => deleteKey(k.id)}>Révoquer</Button>
            </div>
          ))}
          {keys.length === 0 && <p className="text-sm text-[var(--text-muted)]">Aucune clé API configurée.</p>}
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-semibold">Webhooks Sortants</h3>
          <Button onClick={() => setShowWhModal(true)}>+ Ajouter</Button>
        </div>
        <div className="space-y-3">
          {webhooks.map(w => (
            <div key={w.id} className="flex justify-between items-center p-3 border border-[var(--border-subtle)] rounded-lg">
              <div>
                <p className="text-sm font-medium">{w.url}</p>
                <div className="flex gap-2 mt-1">
                  <Badge>{w.events}</Badge>
                  {w.fail_count > 0 && <Badge color="var(--danger)">{w.fail_count} échecs</Badge>}
                </div>
              </div>
              <Button variant="ghost" className="text-[var(--danger)]" onClick={() => deleteWebhook(w.id)}>Supprimer</Button>
            </div>
          ))}
          {webhooks.length === 0 && <p className="text-sm text-[var(--text-muted)]">Aucun webhook configuré.</p>}
        </div>
      </Card>

      <Modal isOpen={showKeyModal} onClose={() => setShowKeyModal(false)} title="Créer une clé API">
        {createdKey ? (
          <div>
            <p className="text-sm text-[var(--warning)] mb-3 font-semibold">Copiez cette clé maintenant, elle ne sera plus jamais affichée !</p>
            <Input value={createdKey} readOnly className="font-mono text-sm bg-[var(--bg-subtle)]" />
            <Button className="mt-4 w-full" onClick={() => { setShowKeyModal(false); setCreatedKey(null); }}>J'ai copié ma clé</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Input placeholder="Nom de la clé (ex: Zapier)" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} />
            <Button className="w-full" onClick={createApiKey} disabled={!newKeyName}>Générer</Button>
          </div>
        )}
      </Modal>

      <Modal isOpen={showWhModal} onClose={() => setShowWhModal(false)} title="Ajouter un Webhook">
        <div className="space-y-3">
          <Input placeholder="https://votre-serveur.com/webhook" value={newWhUrl} onChange={e => setNewWhUrl(e.target.value)} />
          <select className="w-full px-3 py-2 text-sm border border-[var(--border-subtle)] rounded bg-[var(--bg-surface)]" value={newWhEvents} onChange={e => setNewWhEvents(e.target.value)}>
            <option value="lead.created">Lead Créé</option>
            <option value="lead.updated">Lead Mis à jour</option>
            <option value="deal.won">Deal Gagné</option>
          </select>
          <Button className="w-full" onClick={createWebhook} disabled={!newWhUrl}>Créer Webhook</Button>
        </div>
      </Modal>
    </div>
  );
}
