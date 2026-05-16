// ── RolesPermissionsSettings — Sprint 23 W32 : card-premium + Tag + EmptyState
import { useState, useEffect } from 'react';
import { Card, Button, Tag, EmptyState, Icon } from '@/components/ui';
import { ShieldCheck, Plus } from 'lucide-react';

export function RolesPermissionsSettings() {
  const [roles, setRoles] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/team/roles')
      .then((res) => res.json())
      .then((data: any) => setRoles(data.data || []));
  }, []);

  return (
    <div className="space-y-6">
      <Card className="settings-card p-6">
        <header className="settings-section-header settings-section-header--with-action">
          <div>
            <h3 className="t-h3 flex items-center gap-2">
              <Icon as={ShieldCheck} size={16} className="text-[var(--primary)]" /> Rôles & permissions
            </h3>
            <p className="t-caption text-[var(--gray-500)]">Matrice rôles × actions autorisées.</p>
          </div>
          <Button variant="secondary" size="sm" leftIcon={<Icon as={Plus} size={14} />}>
            Créer un rôle (V2)
          </Button>
        </header>

        {/* Matrice permissions preview Stripe-clean.
            Sprint E1 M2.3 — colonne "Gérant de boutique" (store_manager) +
            permissions e-commerce ajoutées. Additif : la matrice Sprint 42
            (CRM) est intégralement préservée, on étend juste lignes/colonne. */}
        <div className="settings-perm-matrix" role="table" aria-label="Matrice de permissions">
          <div className="settings-perm-matrix__head settings-perm-matrix__head--e1m2" role="row">
            <span role="columnheader">Permission</span>
            <span role="columnheader">Admin</span>
            <span role="columnheader">Courtier</span>
            <span role="columnheader">Agent</span>
            <span role="columnheader" title="Gérant de boutique">Gérant boutique</span>
          </div>
          {[
            // ── CRM (Sprint 42, préservé) ──
            { label: 'Lire leads', a: true, b: true, c: true, d: false },
            { label: 'Modifier leads', a: true, b: true, c: false, d: false },
            { label: 'Supprimer leads', a: true, b: false, c: false, d: false },
            { label: 'Exporter données', a: true, b: false, c: false, d: false },
            { label: 'Gérer équipe', a: true, b: false, c: false, d: false },
            { label: 'Voir facturation', a: true, b: false, c: false, d: false },
            // ── E-commerce (Sprint E1 M2.3, additif) ──
            { label: 'Voir produits', a: true, b: false, c: false, d: true, grp: true },
            { label: 'Gérer produits', a: true, b: false, c: false, d: true },
            { label: 'Voir commandes', a: true, b: false, c: false, d: true },
            { label: 'Gérer commandes', a: true, b: false, c: false, d: true },
            { label: 'Voir clients boutique', a: true, b: false, c: false, d: true },
            { label: 'Rembourser', a: true, b: false, c: false, d: true },
            { label: 'Configurer la boutique', a: true, b: false, c: false, d: false },
          ].map((row) => (
            <div
              key={row.label}
              className={`settings-perm-matrix__row settings-perm-matrix__row--e1m2 ${row.grp ? 'settings-perm-matrix__row--group' : ''}`}
              role="row"
            >
              <span role="cell" className="settings-perm-matrix__label">{row.label}</span>
              <span role="cell" className={`settings-perm-cell ${row.a ? 'is-on' : 'is-off'}`}>{row.a ? 'Oui' : '—'}</span>
              <span role="cell" className={`settings-perm-cell ${row.b ? 'is-on' : 'is-off'}`}>{row.b ? 'Oui' : '—'}</span>
              <span role="cell" className={`settings-perm-cell ${row.c ? 'is-on' : 'is-off'}`}>{row.c ? 'Oui' : '—'}</span>
              <span role="cell" className={`settings-perm-cell ${row.d ? 'is-on' : 'is-off'}`}>{row.d ? 'Oui' : '—'}</span>
            </div>
          ))}
        </div>
        <p className="t-caption text-[var(--gray-500)] mt-2">
          Le rôle <strong>Gérant de boutique</strong> gère le module Boutique sans accès au CRM (leads, pipeline).
        </p>

        {roles.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={<ShieldCheck size={28} />}
            title="Aucun rôle défini"
            description="Les rôles système apparaîtront automatiquement ici. Vous pourrez créer des rôles personnalisés dans la V2."
          />
        ) : (
          <div className="space-y-3">
            {roles.map((r, idx) => (
              <div
                key={r.id}
                className="card-premium list-item-enter p-4 rounded-xl"
                style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'both' }}
              >
                <div className="flex justify-between items-start mb-2 gap-3">
                  <div className="min-w-0">
                    <h4 className="font-semibold text-[var(--text-primary)] truncate">{r.name}</h4>
                    <p className="text-xs text-[var(--text-muted)]">{r.description}</p>
                  </div>
                  {r.is_system ? (
                    <Tag variant="brand" dot>
                      Système
                    </Tag>
                  ) : (
                    <Tag variant="neutral" dot>
                      Personnalisé
                    </Tag>
                  )}
                </div>
                <div className="mt-3 text-[10px] uppercase text-[var(--text-secondary)] font-bold tracking-wider">
                  Permissions : lecture globale, écriture restreinte (Mock)
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
