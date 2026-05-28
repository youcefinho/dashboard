import { useEffect, useState, useCallback } from 'react';
import {
  listKBArticles,
  getKbIndexStatus,
  triggerKbIndexing,
  triggerAllKbIndexing,
  type KBArticle
} from '@/lib/api';
import type { KbIndexStatus } from '@/lib/types';
import { t } from '@/lib/i18n';
import { Button, Card, Tag, Skeleton, useToast } from '@/components/ui';
import { RefreshCw, Database, Play } from 'lucide-react';

export function KbIndexManager() {
  const { success, error } = useToast();
  const [articles, setArticles] = useState<KBArticle[]>([]);
  const [indexStatus, setIndexStatus] = useState<KbIndexStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [indexingAll, setIndexingAll] = useState(false);
  const [indexingId, setIndexingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [articlesRes, statusRes] = await Promise.all([
        listKBArticles(),
        getKbIndexStatus()
      ]);

      if (articlesRes.data) {
        setArticles(articlesRes.data);
      }
      if (statusRes.data) {
        setIndexStatus(statusRes.data);
      }
    } catch (err) {
      error(t('kb.error.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleIndexSingle = async (id: string) => {
    setIndexingId(id);
    try {
      const res = await triggerKbIndexing(id);
      if (res.error) {
        error(res.error);
      } else {
        success(t('kb.toast.indexed_success') || 'Article indexé avec succès !');
        void loadData();
      }
    } catch (err) {
      error(t('kb.error.indexing_failed') || "Erreur lors de l'indexation");
    } finally {
      setIndexingId(null);
    }
  };

  const handleIndexAll = async () => {
    setIndexingAll(true);
    try {
      const res = await triggerAllKbIndexing();
      if (res.error) {
        error(res.error);
      } else {
        success(t('kb.toast.indexed_all_success') || 'Toute la base de connaissances a été réindexée !');
        void loadData();
      }
    } catch (err) {
      error(t('kb.error.indexing_failed') || "Erreur lors de l'indexation globale");
    } finally {
      setIndexingAll(false);
    }
  };

  const getStatusForArticle = (article: KBArticle) => {
    if (article.status !== 'published') {
      return {
        label: t('kb.status.draft') || 'Brouillon',
        variant: 'neutral' as const,
        icon: false,
        desc: t('kb.rag.draft_no_index') || 'Les brouillons ne sont pas indexés dans le chatbot RAG.'
      };
    }

    const stat = indexStatus.find(s => s.source_id === article.id);
    if (stat && stat.chunks_count > 0) {
      return {
        label: t('kb.rag.indexed') || 'Indexé',
        variant: 'success' as const,
        icon: true,
        desc: `${stat.chunks_count} chunk(s) vectorisé(s). Indexé le ${new Date(stat.last_indexed_at).toLocaleDateString()}`
      };
    }

    return {
      label: t('kb.rag.not_indexed') || 'Non indexé',
      variant: 'warning' as const,
      icon: false,
      desc: t('kb.rag.needs_indexing') || "Publié mais non encore indexé dans la base vectorielle."
    };
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-16 w-full rounded-[var(--radius-md)]" />
        ))}
      </div>
    );
  }

  return (
    <div className="kb-index-manager">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 className="t-h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Database size={20} className="text-[var(--brand-primary)]" />
            Base Vectorielle RAG
          </h2>
          <p className="t-caption">
            Gérez la vectorisation et l'indexation de vos articles pour le Chatbot IA.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<RefreshCw size={14} className={indexingAll ? 'animate-spin' : ''} />}
          isLoading={indexingAll}
          disabled={indexingAll || articles.length === 0}
          onClick={handleIndexAll}
        >
          Réindexer tout
        </Button>
      </div>

      {articles.length === 0 ? (
        <Card className="p-6 text-center text-[var(--text-muted)] text-sm">
          Aucun article à indexer. Créez et publiez d'abord des articles dans votre FAQ.
        </Card>
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="kb-table" role="table">
            <div className="kb-row kb-row--head" role="row">
              <span role="columnheader">Article</span>
              <span role="columnheader">Statut RAG</span>
              <span role="columnheader">Détails</span>
              <span role="columnheader" style={{ textAlign: 'right' }}>Actions</span>
            </div>

            {articles.map(a => {
              const status = getStatusForArticle(a);
              const isIndexing = indexingId === a.id;

              return (
                <div key={a.id} className="kb-row" role="row" style={{ alignItems: 'center' }}>
                  <span role="cell" style={{ fontWeight: 500 }}>
                    {a.title || 'Sans titre'}
                  </span>
                  <span role="cell">
                    <Tag
                      variant={status.variant}
                      size="xs"
                      statusIcon={status.icon}
                    >
                      {status.label}
                    </Tag>
                  </span>
                  <span role="cell" className="t-caption" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {status.desc}
                  </span>
                  <span role="cell" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    {a.status === 'published' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        leftIcon={<Play size={10} />}
                        isLoading={isIndexing}
                        disabled={isIndexing || indexingAll}
                        onClick={() => void handleIndexSingle(a.id)}
                      >
                        Vectoriser
                      </Button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
