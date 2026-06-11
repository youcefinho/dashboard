// ── Blog article template — Sprint 47 M3.2 (2026-05-15) ────────────────
// Lit le markdown depuis /public/blog/$slug.md, parse les H2/H3 pour TOC,
// utilise `react-markdown` (lazy chunk Sprint 43 vendor-markdown).
// Stripe-clean SUBTLE.

import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { PublicLayout } from '@/pages/landing/PublicLayout';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon } from '@/components/ui/Icon';
import {
  Calendar as CalendarIcon, Clock, ArrowLeft, ArrowRight,
  Link2, Quote, Info, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { BLOG_POSTS, BLOG_TAGS, getPostBySlug } from '@/content/blog';

// Icônes de marques sociales (retirées de lucide-react 1.x)
const TwitterSvg = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden><path d="M23 3a10.9 10.9 0 01-3.14 1.53A4.48 4.48 0 0012 7.5v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2c9 5 20 0 20-11.5 0-.28-.03-.56-.08-.83A7.72 7.72 0 0023 3z"/></svg>;
const LinkedinSvg = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-4 0v7h-4v-7a6 6 0 016-6zM2 9h4v12H2zm2-5a2 2 0 110 4 2 2 0 010-4z"/></svg>;
const FacebookSvg = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg>;

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-CA', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch { return iso; }
}

interface TocEntry { id: string; text: string; level: 2 | 3; }

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

function extractToc(markdown: string): TocEntry[] {
  const lines = markdown.split('\n');
  const toc: TocEntry[] = [];
  let inCodeFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) { inCodeFence = !inCodeFence; continue; }
    if (inCodeFence) continue;
    const m2 = line.match(/^##\s+(.+?)\s*$/);
    const m3 = line.match(/^###\s+(.+?)\s*$/);
    if (m2) toc.push({ id: slugifyHeading(m2[1]!), text: m2[1]!, level: 2 });
    else if (m3) toc.push({ id: slugifyHeading(m3[1]!), text: m3[1]!, level: 3 });
  }
  return toc;
}

export function BlogArticlePage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const post = getPostBySlug(slug);

  const [markdown, setMarkdown] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);

  // Fetch markdown
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/blog/${slug}.md`)
      .then((res) => res.text())
      .then((text) => {
        if (cancelled) return;
        setMarkdown(text);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setMarkdown('# Article introuvable\n\nDésolé, cet article n’existe pas ou plus.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [slug]);

  // Reading progress (scroll-based)
  useEffect(() => {
    const handler = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      const ratio = max > 0 ? (h.scrollTop / max) : 0;
      setProgress(Math.round(ratio * 100));
    };
    handler();
    window.addEventListener('scroll', handler, { passive: true });
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler);
      window.removeEventListener('resize', handler);
    };
  }, []);

  const toc = useMemo(() => extractToc(markdown), [markdown]);

  const related = useMemo(() => {
    if (!post) return [];
    return BLOG_POSTS
      .filter((p) => p.slug !== post.slug)
      .sort((a, b) => (a.tag === post.tag ? -1 : 1) - (b.tag === post.tag ? -1 : 1))
      .slice(0, 3);
  }, [post]);

  // Share buttons
  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
  const shareTitle = post?.title ?? '';
  const shareLinks = {
    twitter: `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareTitle)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
  };

  const copyLink = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(shareUrl);
    }
  };

  if (!post) {
    return (
      <PublicLayout>
        <div className="max-w-2xl mx-auto px-4 py-24 text-center">
          <h1 className="text-2xl font-bold mb-4">Article introuvable</h1>
          <p className="text-[var(--text-secondary)] mb-6">
            Cet article n’existe pas ou a été déplacé.
          </p>
          <Link to="/blog" className="text-[var(--primary)] font-semibold hover:underline">
            <Icon as={ArrowLeft} size={14} aria-hidden /> Retour au blog
          </Link>
        </div>
      </PublicLayout>
    );
  }

  const tagMeta = BLOG_TAGS[post.tag];

  return (
    <PublicLayout>
      <a href="#article-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-[var(--bg-surface)] focus:border focus:border-[var(--primary)] focus:rounded-md">
        Aller au contenu
      </a>

      {/* Reading progress bar (top, 4px) */}
      <div
        aria-hidden
        className="blog-progress"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${progress}%` }} />
      </div>

      {/* Hero cover */}
      <header
        className="blog-article-hero"
        style={{
          background:
            `linear-gradient(135deg, ${post.coverColor}1A 0%, ${post.coverColor}0A 60%, var(--bg-subtle) 100%)`,
        }}
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <Link to="/blog" className="blog-article-back">
            <Icon as={ArrowLeft} size={12} aria-hidden /> Retour au blog
          </Link>
          <div className="blog-article-tag" style={{ color: tagMeta.color, borderColor: `${tagMeta.color}40`, background: `${tagMeta.color}10` }}>
            <span aria-hidden className="blog-tag-pill-dot" style={{ background: tagMeta.color }} />
            {tagMeta.label}
          </div>
          <h1 className="blog-article-title">{post.title}</h1>
          <div className="blog-article-meta">
            <div className="blog-article-author">
              <span className="blog-card-avatar" aria-hidden>{post.author.initials}</span>
              <div className="leading-tight">
                <span className="blog-card-author-name">{post.author.name}</span>
                <span className="block text-[11px] text-[var(--text-muted)]">{post.author.role}</span>
              </div>
            </div>
            <span className="blog-article-meta-sep" aria-hidden>·</span>
            <span className="blog-card-date">
              <Icon as={CalendarIcon} size={11} aria-hidden /> {formatDate(post.date)}
            </span>
            <span className="blog-card-date">
              <Icon as={Clock} size={11} aria-hidden /> {post.readingTime} min de lecture
            </span>
          </div>
        </div>
      </header>

      {/* Layout : TOC sidebar + content */}
      <div className="blog-article-layout max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* TOC sticky */}
        <aside className="blog-article-toc" aria-label="Table des matières">
          <p className="blog-toc-heading">Sommaire</p>
          {toc.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">Pas de sections.</p>
          ) : (
            <ul className="blog-toc-list">
              {toc.map((entry) => (
                <li key={entry.id} data-level={entry.level}>
                  <a href={`#${entry.id}`} className="blog-toc-link">
                    {entry.text}
                  </a>
                </li>
              ))}
            </ul>
          )}

          {/* Share buttons */}
          <div className="blog-share">
            <p className="blog-toc-heading">Partager</p>
            <div className="blog-share-row">
              <a href={shareLinks.twitter} target="_blank" rel="noopener noreferrer" className="blog-share-btn" aria-label="Partager sur Twitter">
                <TwitterSvg />
              </a>
              <a href={shareLinks.linkedin} target="_blank" rel="noopener noreferrer" className="blog-share-btn" aria-label="Partager sur LinkedIn">
                <LinkedinSvg />
              </a>
              <a href={shareLinks.facebook} target="_blank" rel="noopener noreferrer" className="blog-share-btn" aria-label="Partager sur Facebook">
                <FacebookSvg />
              </a>
              <button type="button" onClick={copyLink} className="blog-share-btn" aria-label="Copier le lien">
                <Icon as={Link2} size={14} />
              </button>
            </div>
          </div>
        </aside>

        {/* Article content */}
        <article id="article-content" className="blog-article-content">
          {loading ? (
            <div className="blog-article-skeleton">
              <span /><span /><span /><span /><span />
            </div>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h2: ({ children, ...props }) => {
                  const text = String(children);
                  return <h2 id={slugifyHeading(text)} {...props}>{children}</h2>;
                },
                h3: ({ children, ...props }) => {
                  const text = String(children);
                  return <h3 id={slugifyHeading(text)} {...props}>{children}</h3>;
                },
                blockquote: ({ children }) => (
                  <Callout tone="quote">{children}</Callout>
                ),
                img: ({ src, alt }) => (
                  <figure className="blog-mdx-figure">
                    <img src={src} alt={alt ?? ''} loading="lazy" />
                    {alt && <figcaption>{alt}</figcaption>}
                  </figure>
                ),
              }}
            >
              {markdown}
            </ReactMarkdown>
          )}

          {/* Footer article */}
          <div className="blog-article-footer">
            <div className="blog-author-bio">
              <span className="blog-author-bio-avatar" aria-hidden>{post.author.initials}</span>
              <div>
                <p className="blog-author-bio-name">{post.author.name}</p>
                <p className="blog-author-bio-role">{post.author.role}</p>
                <p className="blog-author-bio-text">
                  {post.author.id === 'rochdi'
                    ? 'Fondateur d’Intralys. Basé à Montréal, je construis le CRM que j’aurais voulu avoir comme entrepreneur québécois.'
                    : 'L’équipe Intralys partage ses meilleurs trucs pour aider les PMEs francophones à automatiser sans se compliquer la vie.'}
                </p>
              </div>
            </div>

            {/* Related articles */}
            {related.length > 0 && (
              <div className="blog-related">
                <p className="blog-toc-heading mb-3">Articles liés</p>
                <ul className="blog-related-list">
                  {related.map((r) => {
                    const rTag = BLOG_TAGS[r.tag];
                    return (
                      <li key={r.slug}>
                        <Link to="/blog/$slug" params={{ slug: r.slug }} className="blog-related-item">
                          <span className="blog-related-tag" style={{ color: rTag.color }}>{rTag.label}</span>
                          <span className="blog-related-title">{r.title}</span>
                          <Icon as={ArrowRight} size={12} className="text-[var(--text-muted)]" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Comments stub */}
            <div className="blog-comments-stub" aria-label="Commentaires">
              <p className="text-xs text-[var(--text-muted)]">
                💬 Les commentaires arrivent bientôt (intégration Discourse/Disqus en cours).
              </p>
            </div>
          </div>
        </article>
      </div>
    </PublicLayout>
  );
}

// ── MDX custom components (exportés au cas où d'autres pages en aient besoin) ──

interface CalloutProps {
  tone?: 'info' | 'warning' | 'success' | 'quote';
  children: React.ReactNode;
}

export function Callout({ tone = 'info', children }: CalloutProps) {
  const icon = tone === 'warning' ? AlertTriangle
    : tone === 'success' ? CheckCircle2
    : tone === 'quote' ? Quote
    : Info;
  return (
    <aside className={`blog-mdx-callout blog-mdx-callout--${tone}`} role="note">
      <Icon as={icon} size={14} aria-hidden />
      <div>{children}</div>
    </aside>
  );
}
