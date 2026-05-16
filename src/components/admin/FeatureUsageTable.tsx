// ── FeatureUsageTable — Sprint 46 M2.4 ───────────────────────
// Top 10 features utilisées avec colonnes :
//   Feature / Adoption rate % / Sessions count / Unique users / Last used
// + mini-sparkline 30j par row (trend).
// Sub-section : adoption per role (Admin / Member / Viewer).
//
// Data source : GET /api/admin/features-usage
// Réponse : { features: FeatureUsage[], byRole: { admin: FeatureRoleRow[], member: ..., viewer: ... } }
//
// Stripe-clean : table-premium pattern, pas de glow.

import { useState, useEffect, useMemo } from 'react';
import { Card, Icon, Skeleton, Sparkline, Tag } from '@/components/ui';
import { Activity, TrendingUp, TrendingDown } from 'lucide-react';

export interface FeatureUsageRow {
  id: string;
  label: string;
  adoptionRate: number;   // 0-1
  sessions: number;
  uniqueUsers: number;
  lastUsedAt: string;     // ISO
  trend30d: number[];     // 30 points
}

export interface FeatureRoleAdoption {
  feature_id: string;
  feature_label: string;
  admin: number;   // % adoption 0-1
  member: number;
  viewer: number;
}

interface ApiResponse {
  features?: FeatureUsageRow[];
  by_role?: FeatureRoleAdoption[];
  data?: { features?: FeatureUsageRow[]; by_role?: FeatureRoleAdoption[] };
}

// Mock data (fallback hors backend) — top 10 features réalistes Intralys.
function generateMockData(): { features: FeatureUsageRow[]; byRole: FeatureRoleAdoption[] } {
  const featureSeeds = [
    { id: 'cmd_palette', label: 'Command Palette (Cmd+K)', adoption: 0.78 },
    { id: 'pipeline_drag', label: 'Drag pipeline cards', adoption: 0.72 },
    { id: 'bulk_select', label: 'Bulk select leads', adoption: 0.64 },
    { id: 'ai_drafts', label: 'AI draft replies', adoption: 0.58 },
    { id: 'reactions_emoji', label: 'Réactions emoji', adoption: 0.52 },
    { id: 'quick_replies', label: 'Quick replies chips', adoption: 0.47 },
    { id: 'smart_lists', label: 'Smart Lists sauvegardées', adoption: 0.43 },
    { id: 'ai_summarize', label: 'AI résumé conversation', adoption: 0.39 },
    { id: 'pdf_export', label: 'Export PDF', adoption: 0.34 },
    { id: 'pull_to_refresh', label: 'Pull-to-refresh mobile', adoption: 0.28 },
  ];
  const now = Date.now();
  const features: FeatureUsageRow[] = featureSeeds.map((seed, i) => {
    // Trend 30 points : ramp-up cohérent (croissant + bruit)
    const trend: number[] = [];
    const base = Math.floor(seed.adoption * 80);
    for (let j = 0; j < 30; j++) {
      const linear = (base * (j + 5)) / 35;
      const jitter = Math.sin(j * 0.6 + i) * 4 + (Math.random() - 0.5) * 6;
      trend.push(Math.max(0, Math.round(linear + jitter)));
    }
    return {
      id: seed.id,
      label: seed.label,
      adoptionRate: seed.adoption,
      sessions: Math.floor(seed.adoption * 2400 + Math.random() * 200),
      uniqueUsers: Math.floor(seed.adoption * 180 + Math.random() * 20),
      lastUsedAt: new Date(now - Math.floor(Math.random() * 3 * 3600 * 1000)).toISOString(),
      trend30d: trend,
    };
  });
  const byRole: FeatureRoleAdoption[] = featureSeeds.slice(0, 6).map(seed => ({
    feature_id: seed.id,
    feature_label: seed.label,
    admin: Math.min(1, seed.adoption + 0.15 + Math.random() * 0.05),
    member: seed.adoption,
    viewer: Math.max(0.05, seed.adoption - 0.25 - Math.random() * 0.05),
  }));
  return { features, byRole };
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
    if (diffMin < 1) return 'À l\'instant';
    if (diffMin < 60) return `il y a ${diffMin} min`;
    const h = Math.floor(diffMin / 60);
    if (h < 24) return `il y a ${h}h`;
    const j = Math.floor(h / 24);
    return `il y a ${j}j`;
  } catch {
    return '—';
  }
}

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

// Compare premier-tiers vs derniers-tiers du sparkline pour direction trend.
function trendDirection(points: number[]): 'up' | 'down' | 'flat' {
  if (points.length < 4) return 'flat';
  const mid = Math.floor(points.length / 2);
  const left = points.slice(0, mid);
  const right = points.slice(mid);
  const avgL = left.reduce((a, b) => a + b, 0) / left.length;
  const avgR = right.reduce((a, b) => a + b, 0) / right.length;
  if (avgR > avgL * 1.08) return 'up';
  if (avgR < avgL * 0.92) return 'down';
  return 'flat';
}

async function fetchData(token: string | null): Promise<{ features: FeatureUsageRow[]; byRole: FeatureRoleAdoption[] }> {
  try {
    const res = await fetch('/api/admin/features-usage', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json() as ApiResponse;
    const features = data.features || data.data?.features;
    const byRole = data.by_role || data.data?.by_role;
    if (Array.isArray(features) && features.length > 0) {
      return { features, byRole: byRole || [] };
    }
    throw new Error('invalid shape');
  } catch {
    return generateMockData();
  }
}

export function FeatureUsageTable({ className = '' }: { className?: string }) {
  const [features, setFeatures] = useState<FeatureUsageRow[]>([]);
  const [byRole, setByRole] = useState<FeatureRoleAdoption[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    fetchData(token).then(({ features, byRole }) => {
      if (!cancelled) {
        setFeatures(features);
        setByRole(byRole);
        setIsLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const topFeatures = useMemo(() => features.slice(0, 10), [features]);

  return (
    <div className={`space-y-4 ${className}`.trim()}>
      <Card className="p-0 overflow-hidden">
        <header className="flex items-center justify-between gap-3 p-5 pb-3 flex-wrap border-b border-[var(--border)]">
          <div className="flex items-center gap-2 min-w-0">
            <Icon as={Activity} size={16} className="text-[var(--primary)] shrink-0" />
            <div className="min-w-0">
              <h3 className="t-h3">Top features utilisées</h3>
              <p className="t-caption text-[var(--text-muted)]">Adoption par usage 30 derniers jours.</p>
            </div>
          </div>
        </header>

        {isLoading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-premium feature-usage-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Feature</th>
                  <th className="text-right">Adoption</th>
                  <th className="text-right">Sessions</th>
                  <th className="text-right">Utilisateurs</th>
                  <th className="text-left">Tendance 30j</th>
                  <th className="text-right">Dernière</th>
                </tr>
              </thead>
              <tbody>
                {topFeatures.map((f, idx) => {
                  const dir = trendDirection(f.trend30d);
                  const TrendIcon = dir === 'up' ? TrendingUp : dir === 'down' ? TrendingDown : null;
                  const trendColor =
                    dir === 'up' ? 'var(--success)' :
                    dir === 'down' ? 'var(--danger)' : 'var(--text-muted)';
                  return (
                    <tr key={f.id} className="row-premium">
                      <td>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="t-meta tabular-nums text-[var(--text-muted)] w-6">{idx + 1}</span>
                          <span className="font-medium text-[var(--text-primary)] truncate">{f.label}</span>
                        </div>
                      </td>
                      <td className="text-right">
                        <span className="inline-flex items-center gap-2 justify-end">
                          <span
                            className="feature-adoption-bar"
                            aria-hidden
                            style={{
                              ['--bar-fill' as string]: `${Math.round(f.adoptionRate * 100)}%`,
                            }}
                          />
                          <span className="tabular-nums font-semibold text-[var(--text-primary)] min-w-[3rem]">
                            {formatPct(f.adoptionRate)}
                          </span>
                        </span>
                      </td>
                      <td className="text-right tabular-nums text-[var(--text-secondary)]">
                        {f.sessions.toLocaleString('fr-CA')}
                      </td>
                      <td className="text-right tabular-nums text-[var(--text-secondary)]">
                        {f.uniqueUsers.toLocaleString('fr-CA')}
                      </td>
                      <td>
                        <div className="inline-flex items-center gap-1.5">
                          <Sparkline data={f.trend30d} width={64} height={20} />
                          {TrendIcon && (
                            <Icon as={TrendIcon} size={12} style={{ color: trendColor }} />
                          )}
                        </div>
                      </td>
                      <td className="text-right t-caption text-[var(--text-muted)]">
                        {formatRelative(f.lastUsedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Sub-section : adoption per role */}
      <Card className="p-5">
        <header className="flex items-center gap-2 mb-4">
          <Icon as={Activity} size={14} className="text-[var(--text-muted)]" />
          <h3 className="t-h3">Adoption par rôle</h3>
        </header>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : byRole.length === 0 ? (
          <p className="t-caption text-[var(--text-muted)]">Aucune donnée disponible.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-premium feature-role-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Feature</th>
                  <th className="text-right">Admin</th>
                  <th className="text-right">Membre</th>
                  <th className="text-right">Lecteur</th>
                </tr>
              </thead>
              <tbody>
                {byRole.map(row => (
                  <tr key={row.feature_id} className="row-premium">
                    <td className="font-medium text-[var(--text-primary)]">{row.feature_label}</td>
                    <td className="text-right tabular-nums">
                      <Tag variant="brand">{formatPct(row.admin)}</Tag>
                    </td>
                    <td className="text-right tabular-nums">
                      <Tag variant="info">{formatPct(row.member)}</Tag>
                    </td>
                    <td className="text-right tabular-nums">
                      <Tag variant="neutral">{formatPct(row.viewer)}</Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
