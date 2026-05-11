import { useState, useEffect } from 'react';
import { Card, Button, Input, Modal, Badge } from '@/components/ui';

export function TeamSettings() {
  const [users, setUsers] = useState<any[]>([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('agent');

  useEffect(() => {
    fetch('/api/team/users').then(res => res.json()).then((data: any) => setUsers(data.data || []));
  }, []);

  const inviteUser = async () => {
    const res = await fetch('/api/team/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newEmail, role: newRole })
    });
    if(res.ok) {
      setShowInviteModal(false);
      setNewEmail('');
      // Optimistic refresh
      setUsers([{ id: Date.now().toString(), email: newEmail, role: newRole, created_at: new Date().toISOString() }, ...users]);
    }
  };

  const removeUser = async (id: string) => {
    await fetch(`/api/team/users/${id}`, { method: 'DELETE' });
    setUsers(users.filter(u => u.id !== id));
  };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-semibold">Équipe & Utilisateurs</h3>
          <Button onClick={() => setShowInviteModal(true)}>+ Inviter un utilisateur</Button>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-[var(--text-muted)] bg-[var(--bg-subtle)] uppercase">
              <tr>
                <th className="px-4 py-3 rounded-tl-lg">Utilisateur</th>
                <th className="px-4 py-3">Rôle</th>
                <th className="px-4 py-3">Dernière connexion</th>
                <th className="px-4 py-3 rounded-tr-lg">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b border-[var(--border-subtle)]">
                  <td className="px-4 py-3 font-medium">
                    {u.name || u.email.split('@')[0]}
                    <div className="text-[10px] text-[var(--text-muted)] font-normal">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={u.role === 'admin' ? 'var(--brand-primary)' : 'var(--info)'}>{u.role}</Badge>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">Il y a 2 jours</td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" className="text-[var(--danger)] text-xs h-8 px-2" onClick={() => removeUser(u.id)}>Retirer</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal isOpen={showInviteModal} onClose={() => setShowInviteModal(false)} title="Inviter un collaborateur">
        <div className="space-y-3">
          <Input placeholder="Email" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
          <select className="w-full px-3 py-2 text-sm border border-[var(--border-subtle)] rounded bg-[var(--bg-surface)]" value={newRole} onChange={e => setNewRole(e.target.value)}>
            <option value="admin">Administrateur</option>
            <option value="broker">Courtier</option>
            <option value="agent">Agent (Limité)</option>
          </select>
          <Button className="w-full" onClick={inviteUser} disabled={!newEmail}>Envoyer l'invitation</Button>
        </div>
      </Modal>
    </div>
  );
}
