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
      <div className="pt-20 pb-24 px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto">
        {isLoading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-10 bg-[var(--bg-muted)] rounded w-1/3 mb-8"></div>
            <div className="h-6 bg-[var(--bg-muted)] rounded w-1/4 mb-4"></div>
            <div className="h-4 bg-[var(--bg-muted)] rounded w-full"></div>
            <div className="h-4 bg-[var(--bg-muted)] rounded w-5/6"></div>
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
