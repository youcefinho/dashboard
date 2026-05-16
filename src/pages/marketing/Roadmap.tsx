// ── Sprint 50 M3.4 — Roadmap publique (/roadmap) ───────────────────────────
// Kanban 3 colonnes (En réflexion / En cours / Livré) + upvote par feature.
// Stripe SUBTLE strict. Données via GET /api/roadmap, vote via POST.

import { useEffect, useState } from 'react';
import { ChevronUp, Loader2 } from 'lucide-react';
import { PublicLayout } from '../landing/PublicLayout';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { MarketingMeta } from './_meta';

interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  column: 'idea' | 'progress' | 'done';
  votes: number;
}

const COLUMNS: Array<{ key: RoadmapItem['column']; label: string; hint: string }> = [
  { key: 'idea', label: 'En réflexion', hint: 'On évalue selon vos votes' },
  { key: 'progress', label: 'En cours', hint: 'En développement actif' },
  { key: 'done', label: 'Livré', hint: 'Disponible dans l\'app' },
];

const VOTED_KEY = 'intralys_roadmap_voted';

function getVoted(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(VOTED_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

export function RoadmapPage() {
  const toast = useToast();
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [voted, setVoted] = useState<Set<string>>(() => getVoted());

  useEffect(() => {
    let alive = true;
    fetch('/api/roadmap')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j?.data) setItems(j.data as RoadmapItem[]);
      })
      .catch(() => { /* best-effort */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  async function vote(id: string) {
    if (voted.has(id)) return;
    // Optimiste
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, votes: it.votes + 1 } : it)));
    const next = new Set(voted);
    next.add(id);
    setVoted(next);
    try {
      localStorage.setItem(VOTED_KEY, JSON.stringify([...next]));
    } catch { /* ignore */ }
    try {
      const res = await fetch(`/api/roadmap/${id}/vote`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (res.ok && typeof j?.data?.votes === 'number') {
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, votes: j.data.votes } : it)));
        if (!j.data.already) toast.success('Merci pour ton vote !');
      }
    } catch {
      toast.error('Vote non enregistré, réessaye plus tard.');
    }
  }

  return (
    <PublicLayout>
      <MarketingMeta
        title="Roadmap publique — Intralys CRM"
        description="Découvre ce qu'on construit chez Intralys et vote pour les fonctionnalités qui comptent le plus pour ton entreprise."
        path="/roadmap"
      />

      <div className="mk-roadmap">
        <header className="mk-roadmap__header">
          <h1 className="mk-roadmap__title">Roadmap publique</h1>
          <p className="mk-roadmap__sub">
            On construit Intralys avec vous. Vote pour les fonctionnalités qui
            comptent le plus — ça oriente nos priorités.
          </p>
        </header>

        {loading ? (
          <div className="mk-roadmap__loading" role="status">
            <Icon as={Loader2} size={22} className="animate-spin" aria-hidden />
            <span>Chargement de la roadmap…</span>
          </div>
        ) : (
          <div className="mk-roadmap__board">
            {COLUMNS.map((col) => {
              const colItems = items
                .filter((it) => it.column === col.key)
                .sort((a, b) => b.votes - a.votes);
              return (
                <section key={col.key} className="mk-roadmap__col" aria-label={col.label}>
                  <header className="mk-roadmap__col-head">
                    <h2 className="mk-roadmap__col-title">{col.label}</h2>
                    <span className="mk-roadmap__col-hint">{col.hint}</span>
                    <span className="mk-roadmap__col-count">{colItems.length}</span>
                  </header>
                  <div className="mk-roadmap__cards">
                    {colItems.map((it) => {
                      const hasVoted = voted.has(it.id);
                      return (
                        <article key={it.id} className="mk-roadmap__card">
                          <button
                            type="button"
                            className={`mk-roadmap__vote ${hasVoted ? 'is-voted' : ''}`}
                            onClick={() => vote(it.id)}
                            disabled={hasVoted}
                            aria-label={`Voter pour ${it.title} (${it.votes} votes)`}
                            aria-pressed={hasVoted}
                          >
                            <Icon as={ChevronUp} size={15} aria-hidden />
                            <span className="mk-roadmap__vote-count">{it.votes}</span>
                          </button>
                          <div className="mk-roadmap__card-body">
                            <h3 className="mk-roadmap__card-title">{it.title}</h3>
                            <p className="mk-roadmap__card-desc">{it.description}</p>
                          </div>
                        </article>
                      );
                    })}
                    {colItems.length === 0 && (
                      <p className="mk-roadmap__empty">Rien ici pour l'instant.</p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </PublicLayout>
  );
}

export default RoadmapPage;
