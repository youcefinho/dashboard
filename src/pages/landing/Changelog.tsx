import { useState, useEffect } from 'react';
import { PublicLayout } from './PublicLayout';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function ChangelogPage() {
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch('/changelog.md')
      .then(res => res.text())
      .then(text => {
        setContent(text);
        setIsLoading(false);
      })
      .catch(() => {
        setContent('# Erreur\nImpossible de charger le changelog.');
        setIsLoading(false);
      });
  }, []);

  return (
    <PublicLayout>
      <div className="relative pt-20 pb-24 px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto overflow-hidden">
        <div className="hero-stat-orb absolute w-[500px] h-[500px] rounded-full -top-60 left-1/2 -translate-x-1/2 pointer-events-none -z-10"
          style={{ background: 'radial-gradient(circle, rgba(0,157,219,0.12) 0%, transparent 70%)', filter: 'blur(60px)' }} />
        <div className="text-center mb-12">
          <p className="heading-premium mb-3">Évolutions du produit</p>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight" style={{ letterSpacing: '-0.03em' }}>
            <span className="text-gradient-brand">Changelog</span>
          </h1>
        </div>
        {isLoading ? (
          <div className="space-y-4">
            <div className="skeleton-brand h-10 rounded w-1/3 mb-8"></div>
            <div className="skeleton-brand h-6 rounded w-1/4 mb-4"></div>
            <div className="skeleton-brand h-4 rounded w-full"></div>
            <div className="skeleton-brand h-4 rounded w-5/6"></div>
          </div>
        ) : (
          <article className="prose prose-neutral max-w-none prose-headings:text-[var(--text-primary)] prose-a:text-[var(--brand-primary)] prose-h1:text-4xl prose-h1:font-extrabold prose-h1:mb-8">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </article>
        )}
      </div>
    </PublicLayout>
  );
}
