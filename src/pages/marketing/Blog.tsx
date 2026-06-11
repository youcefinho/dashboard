// ── Blog list page — Sprint 47 M3.1 (2026-05-15) ────────────────────────
// Liste des articles blog Intralys. Stripe-clean SUBTLE.
// Filter pills (tags) + search fuzzy + grid 3 cols + pagination "Charger plus".

import { useState, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { PublicLayout } from '@/pages/landing/PublicLayout';
import { Input } from '@/components/ui/Input';
import { Search, Calendar as CalendarIcon, Clock, ArrowRight } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { BLOG_POSTS, BLOG_TAGS, type BlogPost, type BlogTag } from '@/content/blog';

const PAGE_SIZE = 12;

type TagFilter = BlogTag | 'all';

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

/** Fuzzy match très simple (substring case-insensitive sur title + excerpt + tag label). */
function matchesSearch(post: BlogPost, q: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  const haystack = [
    post.title,
    post.excerpt,
    post.author.name,
    BLOG_TAGS[post.tag].label,
  ].join(' ').toLowerCase();
  return haystack.includes(needle);
}

export function BlogPage() {
  const [tag, setTag] = useState<TagFilter>('all');
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    return BLOG_POSTS
      .filter((p) => tag === 'all' || p.tag === tag)
      .filter((p) => matchesSearch(p, query))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [tag, query]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  const tagEntries = Object.entries(BLOG_TAGS) as Array<[BlogTag, { label: string; color: string }]>;

  return (
    <PublicLayout>
      <a href="#blog-list" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-[var(--bg-surface)] focus:border focus:border-[var(--primary)] focus:rounded-md">
        Aller au contenu
      </a>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="blog-hero">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-10 text-center">
          <p className="blog-eyebrow">Blog Intralys</p>
          <h1 className="blog-title">Le blog Intralys</h1>
          <p className="blog-sub">
            Conseils, études de cas, mises à jour produit. Tout pour faire de ton CRM un vrai levier de croissance.
          </p>
          <div className="blog-search">
            <Input
              type="search"
              placeholder="Rechercher un article…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setVisibleCount(PAGE_SIZE); }}
              leftIcon={<Search size={16} />}
              aria-label="Rechercher dans le blog"
            />
          </div>
        </div>
      </section>

      {/* ── Filter pills tags ────────────────────────────────────────── */}
      <nav aria-label="Filtres par catégorie" className="blog-filters">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap gap-2 justify-center">
          <button
            type="button"
            onClick={() => { setTag('all'); setVisibleCount(PAGE_SIZE); }}
            className={`blog-tag-pill ${tag === 'all' ? 'is-active' : ''}`}
            aria-pressed={tag === 'all'}
          >
            Tous les articles
          </button>
          {tagEntries.map(([id, meta]) => (
            <button
              key={id}
              type="button"
              onClick={() => { setTag(id); setVisibleCount(PAGE_SIZE); }}
              className={`blog-tag-pill ${tag === id ? 'is-active' : ''}`}
              style={tag === id ? { borderColor: meta.color, color: meta.color } : undefined}
              aria-pressed={tag === id}
            >
              <span aria-hidden className="blog-tag-pill-dot" style={{ background: meta.color }} />
              {meta.label}
            </button>
          ))}
        </div>
      </nav>

      {/* ── Grid articles ───────────────────────────────────────────── */}
      <section id="blog-list" className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {visible.length === 0 ? (
          <div className="blog-empty">
            <p className="text-sm text-[var(--text-muted)]">
              Aucun article ne correspond à ta recherche.
            </p>
          </div>
        ) : (
          <ul className="blog-grid">
            {visible.map((post) => (
              <li key={post.slug}>
                <BlogCard post={post} />
              </li>
            ))}
          </ul>
        )}

        {hasMore && (
          <div className="text-center mt-10">
            <button
              type="button"
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              className="blog-load-more"
            >
              Charger plus d’articles
            </button>
          </div>
        )}
      </section>
    </PublicLayout>
  );
}

// ── Card ──────────────────────────────────────────────────────────────

function BlogCard({ post }: { post: BlogPost }) {
  const tagMeta = BLOG_TAGS[post.tag];
  return (
    <article className="blog-card">
      <Link to="/blog/$slug" params={{ slug: post.slug }} className="blog-card-link" aria-label={`Lire : ${post.title}`}>
        {/* Cover 16:9 placeholder gradient subtil */}
        <div
          className="blog-card-cover"
          aria-hidden
          style={{
            background:
              `linear-gradient(135deg, ${post.coverColor}22 0%, ${post.coverColor}10 60%, var(--bg-subtle) 100%)`,
          }}
        >
          <span
            className="blog-card-cover-glyph"
            style={{ color: post.coverColor }}
          >
            {tagMeta.label}
          </span>
        </div>

        <div className="blog-card-body">
          <div className="blog-card-tag" style={{ color: tagMeta.color, borderColor: `${tagMeta.color}40`, background: `${tagMeta.color}10` }}>
            <span aria-hidden className="blog-tag-pill-dot" style={{ background: tagMeta.color }} />
            {tagMeta.label}
          </div>

          <h3 className="blog-card-title">{post.title}</h3>
          <p className="blog-card-excerpt">{post.excerpt}</p>

          <footer className="blog-card-meta">
            <div className="blog-card-author">
              <span className="blog-card-avatar" aria-hidden>{post.author.initials}</span>
              <span className="blog-card-author-name">{post.author.name}</span>
            </div>
            <div className="blog-card-meta-right">
              <span className="blog-card-date">
                <Icon as={CalendarIcon} size={11} aria-hidden /> {formatDate(post.date)}
              </span>
              <span className="blog-card-date">
                <Icon as={Clock} size={11} aria-hidden /> {post.readingTime} min
              </span>
            </div>
          </footer>

          <span className="blog-card-cta" aria-hidden>
            Lire l’article <Icon as={ArrowRight} size={12} />
          </span>
        </div>
      </Link>
    </article>
  );
}
