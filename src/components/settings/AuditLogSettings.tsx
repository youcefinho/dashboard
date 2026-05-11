import { useState } from 'react';
import { Card, Button, Input, Badge } from '@/components/ui';

export function AuditLogSettings() {
  const [logs] = useState([
    { id: 1, action: 'user.login', user: 'rochdi@intralys.com', resource: 'auth', ip: '192.168.1.1', date: new Date().toISOString() },
    { id: 2, action: 'api_key.create', user: 'rochdi@intralys.com', resource: 'settings', ip: '192.168.1.1', date: new Date(Date.now() - 3600000).toISOString() },
    { id: 3, action: 'lead.export', user: 'mathis@guimont.com', resource: 'leads', ip: '10.0.0.5', date: new Date(Date.now() - 86400000).toISOString() },
  ]);

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-semibold">Journal d'Audit</h3>
          <Button variant="secondary">Exporter CSV</Button>
        </div>
        
        <div className="flex gap-3 mb-4">
          <Input placeholder="Rechercher un utilisateur..." className="max-w-xs" />
          <select className="px-3 py-2 text-sm border border-[var(--border-subtle)] rounded bg-[var(--bg-surface)]">
            <option value="">Toutes les actions</option>
            <option value="login">Connexions</option>
            <option value="export">Exports</option>
            <option value="delete">Suppressions</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-[var(--text-muted)] bg-[var(--bg-subtle)] uppercase">
              <tr>
                <th className="px-4 py-3 rounded-tl-lg">Date</th>
                <th className="px-4 py-3">Utilisateur</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Ressource</th>
                <th className="px-4 py-3 rounded-tr-lg">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {logs.map(log => (
                <tr key={log.id}>
                  <td className="px-4 py-3 font-medium whitespace-nowrap">{new Date(log.date).toLocaleString()}</td>
                  <td className="px-4 py-3">{log.user}</td>
                  <td className="px-4 py-3"><Badge>{log.action}</Badge></td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{log.resource}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)] text-xs font-mono">{log.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
