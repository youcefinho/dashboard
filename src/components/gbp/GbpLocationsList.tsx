// ── GbpLocationsList — Sprint 32 C2 ────────────────────────────────────────
// Liste des locations Google Business Profile pour une connexion donnée.
//
// Pattern :
//   - Au montage (et au changement d'accountId), charge getGbpLocations().
//   - Affiche titre + catégorie + téléphone + badge "défaut" si isDefault.
//   - Clic sur une ligne → onLocationSelect (sélection pour l'onglet reviews/posts).
//   - Bouton "Définir par défaut" si !isDefault → setDefaultGbpLocation + reload.
//   - EmptyState si aucune location (connexion vide / pas encore synchronisée).
//
// Honnêteté UI : skeleton pendant load ; jamais d'état mort silencieux.

import { useEffect, useState, useCallback } from 'react';
import { t } from '@/lib/i18n';
import { getGbpLocations, setDefaultGbpLocation } from '@/lib/api';
import type { GbpLocation } from '@/lib/types';
import { Card, Button, Badge, EmptyState } from '@/components/ui';

interface Props {
  /** Optionnel : filtre la liste par compte GBP (multi-connexions futures). */
  accountId?: string;
  /** Callback de sélection d'une location (ex : pour charger ses reviews). */
  onLocationSelect?: (locId: string) => void;
}

export function GbpLocationsList({ accountId, onLocationSelect }: Props) {
  const [locations, setLocations] = useState<GbpLocation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getGbpLocations(accountId);
    setLoading(false);
    if (res.data) setLocations(res.data);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSetDefault(locId: string) {
    await setDefaultGbpLocation(locId);
    await load();
  }

  if (loading) {
    return (
      <div data-component="GbpLocationsList" data-loading className="text-xs text-[var(--text-muted)]">
        …
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <EmptyState
        variant="first-time"
        title={t('gbp.locations.empty')}
      />
    );
  }

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-3">{t('gbp.locations.title')}</h3>
      <ul className="space-y-2">
        {locations.map((loc) => (
          <li
            key={loc.id}
            className="flex justify-between items-center p-3 border border-[var(--border-subtle)] rounded-[var(--radius-md)]"
          >
            <div
              onClick={() => onLocationSelect?.(loc.id)}
              className={`flex-1 ${onLocationSelect ? 'cursor-pointer' : ''}`}
            >
              <div className="font-medium text-[13px] text-[var(--text-primary)]">
                {loc.locationTitle || loc.gbpLocationId}
              </div>
              {loc.primaryCategory && (
                <div className="text-xs text-[var(--text-muted)]">{loc.primaryCategory}</div>
              )}
              {loc.primaryPhone && (
                <div className="text-xs text-[var(--text-muted)]">{loc.primaryPhone}</div>
              )}
              {loc.isDefault && (
                <Badge intent="success" size="sm" className="mt-1">
                  {t('gbp.locations.default')}
                </Badge>
              )}
            </div>
            {!loc.isDefault && (
              <Button variant="ghost" size="sm" onClick={() => void handleSetDefault(loc.id)}>
                {t('gbp.locations.set_default')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
