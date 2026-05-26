// ── GbpPostComposer — composer post Google Business Profile (Sprint 32) ─────
// Manager-C (front). Composer dédié pour publier un post GBP (LocalPost) via
// l'helper figé `createGbpPost`. Discrimine res.error / !res.data (§6.A) :
//   • succès → callback onPublished(localPostName) + reset
//   • erreur → message d'erreur en ligne (et toast best-effort si dispo)
//
// Couvre : sélection location (défaut auto), type de post (STANDARD/OFFER/EVENT),
// résumé (maxLength 1500), call-to-action (BOOK/ORDER/SHOP/LEARN_MORE/SIGN_UP/CALL)
// + URL, média (URL). AUCUN CSS global, libellés via t('gbp.*') avec fallback
// littéral (les clés sont injectées par C1 quand prêtes).

import { useEffect, useState, type ChangeEvent } from 'react';
import { t } from '@/lib/i18n';
import { getGbpLocations, createGbpPost } from '@/lib/api';
import type { GbpLocation, GbpPostInput } from '@/lib/types';
import { Button, Card, Input, Select, Textarea, useToast } from '@/components/ui';

interface Props {
  /** Pré-remplit le champ résumé (ex : depuis un draft social existant). */
  initialSummary?: string;
  /** Callback après publication réussie — reçoit le `localPostName` GBP. */
  onPublished?: (localPostName: string) => void;
}

type TopicType = NonNullable<GbpPostInput['topicType']>;
type CtaType = NonNullable<GbpPostInput['callToAction']>['actionType'];

const TOPIC_OPTIONS: ReadonlyArray<{ value: TopicType; label: string }> = [
  { value: 'STANDARD', label: 'Standard' },
  { value: 'OFFER', label: 'Offre' },
  { value: 'EVENT', label: 'Événement' },
];

const CTA_OPTIONS: ReadonlyArray<{ value: CtaType | ''; label: string }> = [
  { value: '', label: '—' },
  { value: 'BOOK', label: 'Réserver' },
  { value: 'ORDER', label: 'Commander' },
  { value: 'SHOP', label: 'Acheter' },
  { value: 'LEARN_MORE', label: 'En savoir plus' },
  { value: 'SIGN_UP', label: "S'inscrire" },
  { value: 'CALL', label: 'Appeler' },
];

/** Tente t(key) avec fallback littéral si la clé n'existe pas encore (i18n C1). */
function ti(key: string, fallback: string): string {
  try {
    const out = t(key);
    return out && out !== key ? out : fallback;
  } catch {
    return fallback;
  }
}

export function GbpPostComposer({ initialSummary = '', onPublished }: Props) {
  const toast = useToast();
  const [locations, setLocations] = useState<GbpLocation[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [locationId, setLocationId] = useState<string>('');
  const [summary, setSummary] = useState(initialSummary);
  const [topicType, setTopicType] = useState<TopicType>('STANDARD');
  const [ctaType, setCtaType] = useState<CtaType | ''>('');
  const [ctaUrl, setCtaUrl] = useState<string>('');
  const [mediaUrl, setMediaUrl] = useState<string>('');
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingLocations(true);
    void getGbpLocations()
      .then((res) => {
        if (cancelled) return;
        if (res.data) {
          setLocations(res.data);
          const def = res.data.find((l) => l.isDefault) ?? res.data[0];
          if (def) setLocationId(def.id);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingLocations(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync summary if parent change le initialSummary après mount.
  useEffect(() => {
    if (initialSummary && !summary) setSummary(initialSummary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSummary]);

  const canPublish =
    !publishing && summary.trim().length > 0 && locationId.length > 0;

  async function handlePublish() {
    if (!canPublish) return;
    setPublishing(true);
    setError(null);
    const input: GbpPostInput = {
      locationId,
      summary: summary.trim(),
      topicType,
      ...(ctaType
        ? {
            callToAction: {
              actionType: ctaType,
              ...(ctaUrl.trim() ? { url: ctaUrl.trim() } : {}),
            },
          }
        : {}),
      ...(mediaUrl.trim() ? { mediaUrl: mediaUrl.trim() } : {}),
    };
    try {
      const res = await createGbpPost(input);
      if (res.error || !res.data) {
        const msg = res.error ?? ti('gbp.posts.error', 'Échec de la publication');
        setError(msg);
        toast.error(msg);
        return;
      }
      // Le worker renvoie { localPostName } ou un objet contenant `name`/`localPostName`.
      const data = res.data as { localPostName?: string; name?: string };
      const localPostName = data.localPostName ?? data.name ?? '';
      toast.success(ti('gbp.posts.published', 'Publication GBP envoyée'));
      if (onPublished) onPublished(localPostName);
      // Reset (on garde la location choisie pour publications successives).
      setSummary('');
      setMediaUrl('');
      setCtaUrl('');
      setCtaType('');
      setTopicType('STANDARD');
    } catch (e) {
      const msg = e instanceof Error ? e.message : ti('gbp.posts.error', 'Échec de la publication');
      setError(msg);
      toast.error(msg);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <Card>
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
        {ti('gbp.posts.create', 'Créer un post Google Business')}
      </h3>

      {loadingLocations ? (
        <div className="skeleton h-20 rounded-[var(--radius-md)]" />
      ) : locations.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          {ti('gbp.locations.empty', 'Aucun établissement GBP connecté. Connectez votre compte Google Business dans Intégrations.')}
        </p>
      ) : (
        <div className="space-y-3">
          {/* Location */}
          <Select
            label={ti('gbp.locations.title', 'Établissement')}
            value={locationId}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setLocationId(e.target.value)}
          >
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.locationTitle || loc.gbpLocationId}
              </option>
            ))}
          </Select>

          {/* Type de post */}
          <Select
            label={ti('gbp.posts.topic_type', 'Type')}
            value={topicType}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setTopicType(e.target.value as TopicType)}
          >
            {TOPIC_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>

          {/* Résumé */}
          <Textarea
            label={ti('gbp.posts.summary', 'Texte du post')}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder={ti('gbp.posts.summary_placeholder', 'Annoncez une nouveauté, un événement, une offre...')}
            maxLength={1500}
            showCounter
            rows={4}
            resize="vertical"
          />

          {/* CTA + URL */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label={ti('gbp.posts.cta_type', "Appel à l'action")}
              value={ctaType}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setCtaType(e.target.value as CtaType | '')}
            >
              {CTA_OPTIONS.map((opt) => (
                <option key={opt.value || 'none'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
            <Input
              label={ti('gbp.posts.cta_url', 'URL du CTA')}
              type="url"
              value={ctaUrl}
              onChange={(e) => setCtaUrl(e.target.value)}
              placeholder="https://..."
              disabled={!ctaType || ctaType === 'CALL'}
            />
          </div>

          {/* Média */}
          <Input
            label={ti('gbp.posts.media_url', 'URL d’une image (optionnel)')}
            type="url"
            value={mediaUrl}
            onChange={(e) => setMediaUrl(e.target.value)}
            placeholder="https://..."
          />

          {error && (
            <p className="text-[13px] text-[var(--danger)]" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end pt-1">
            <Button
              disabled={!canPublish}
              isLoading={publishing}
              onClick={() => void handlePublish()}
            >
              {publishing
                ? ti('gbp.posts.publishing', 'Publication…')
                : ti('gbp.posts.publish', 'Publier sur GBP')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
