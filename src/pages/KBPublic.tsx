// ── KBPublic — article de base de connaissances public (LOT G1 HELPDESK) ───
//
// Phase B Manager-C (front exclusif). Page PUBLIQUE (hors LazyGuard/auth) :
// lecture d'un article KB publié par slug via publicGetKBArticle (fetch brut,
// sans auth — calque PublicFunnel SPA hydraté). Rendu Markdown via react-markdown
// + remark-gfm (renderer maison du projet, cf. HelpArticle — pas de dépendance
// nouvelle). 404 propre si article introuvable/non publié. i18n t('kb.*').

import { useEffect, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Skeleton } from '@/components/ui';
import { publicGetKBArticle, type KBArticle } from '@/lib/api';
import { t } from '@/lib/i18n';

export function KBPublicPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const [article, setArticle] = useState<KBArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    setLoading(true);
    publicGetKBArticle(slug)
      .then((res) => {
        if (!alive) return;
        // Article introuvable / non publié → worker renvoie error (string-match,
        // jamais `code` — ApiResponse INCHANGÉ).
        if (res.error || !res.data) {
          setNotFound(true);
          return;
        }
        setArticle(res.data);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white px-4 py-10 flex justify-center font-inter">
        <div
          className="kb-public-skeleton"
          style={{ width: '100%', maxWidth: 720 }}
          aria-hidden="true"
        >
          <Skeleton className="h-3.5 w-24 rounded-[var(--radius-sm)] mb-3" />
          <Skeleton className="h-8 w-3/4 rounded-[var(--radius-md)] mb-6" />
          <Skeleton className="h-4 w-full rounded-[var(--radius-sm)] mb-2.5" />
          <Skeleton className="h-4 w-11/12 rounded-[var(--radius-sm)] mb-2.5" />
          <Skeleton className="h-4 w-full rounded-[var(--radius-sm)] mb-2.5" />
          <Skeleton className="h-4 w-2/3 rounded-[var(--radius-sm)] mb-6" />
          <Skeleton className="h-4 w-full rounded-[var(--radius-sm)] mb-2.5" />
          <Skeleton className="h-4 w-5/6 rounded-[var(--radius-sm)]" />
        </div>
      </div>
    );
  }

  if (notFound || !article) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center bg-white">
        <div style={{ maxWidth: 480 }}>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              marginBottom: 8,
              color: 'var(--text-primary)',
            }}
          >
            Article introuvable
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>
            Cet article n’existe pas ou n’est pas publié.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white px-4 py-10 flex justify-center font-inter">
      <article className="kb-public-article" style={{ width: '100%', maxWidth: 720 }}>
        {article.category && (
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--primary)',
              marginBottom: 8,
            }}
          >
            {article.category}
          </div>
        )}
        <h1
          className="text-balance"
          style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.2, marginBottom: 20 }}
        >
          {article.title || t('kb.title')}
        </h1>
        <div className="help-prose kb-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {article.body_md || ''}
          </ReactMarkdown>
        </div>
        <p
          style={{
            marginTop: 40,
            paddingTop: 20,
            borderTop: '1px solid var(--border-subtle)',
            fontSize: 11,
            color: 'var(--text-muted)',
            textAlign: 'center',
          }}
        >
          Propulsé par <strong>Intralys</strong>
        </p>
      </article>
    </div>
  );
}
