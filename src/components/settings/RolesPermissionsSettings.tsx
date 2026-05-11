import { useState, useEffect } from 'react';
import { Card, Button, Badge } from '@/components/ui';

export function RolesPermissionsSettings() {
  const [roles, setRoles] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/team/roles').then(res => res.json()).then((data: any) => setRoles(data.data || []));
  }, []);

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-semibold">Rôles & Permissions</h3>
          <Button variant="secondary">+ Créer un rôle (V2)</Button>
        </div>
        
        <div className="space-y-3">
          {roles.map(r => (
            <div key={r.id} className="p-4 border border-[var(--border-subtle)] rounded-lg">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h4 className="font-medium">{r.name}</h4>
                  <p className="text-xs text-[var(--text-muted)]">{r.description}</p>
                </div>
                {r.is_system ? <Badge>Système</Badge> : <Badge color="var(--brand-primary)">Personnalisé</Badge>}
              </div>
              <div className="mt-3 text-[10px] uppercase text-[var(--text-secondary)] font-bold tracking-wider">
                Permissions : lecture globale, écriture restreinte (Mock)
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
