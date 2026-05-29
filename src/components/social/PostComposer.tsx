// ── PostComposer — composer multi-réseau + média + IA + prévisualisation ────
// LOT SOCIAL PLANNER (Sprint 9) — Manager-C (front). Cœur du composer :
//   • zone de texte (contenu)
//   • chips multi-sélection des réseaux cibles (SocialProvider)
//   • ajout de médias (liste d'URLs → media_json ; pas d'upload réel)
//   • date de planification optionnelle
//   • bouton « Générer avec l'IA » → generateSocialPost({ prompt, network? })
//   • prévisualisation sobre par réseau sélectionné (NetworkPreview)
// Actions remontées au parent : enregistrer le brouillon / planifier.
// AUCUN CSS global. Libellés via t('social.*'). Pas de crash si IA indisponible.

import { useState } from 'react';
import { Button, Card, useToast, Modal, AiLoadingShimmer } from '@/components/ui';
import { Plus, X, Sparkles } from 'lucide-react';
import type { SocialPost, SocialProvider } from '@/lib/types';
import { generateSocialPost, generateSocialImage } from '@/lib/api';
import { NetworkPreview, NetworkIcon, networkLabel } from './NetworkPreview';
import { t } from '@/lib/i18n';

const ALL_NETWORKS: SocialProvider[] = ['facebook', 'instagram', 'linkedin', 'google_business'];

export interface ComposerDraft {
  content: string;
  media: string[];
  networks: SocialProvider[];
  scheduled_at: string | null;
}

interface PostComposerProps {
  /** Brouillon initial (édition d'un post existant), sinon composer vierge. */
  initial?: Partial<ComposerDraft>;
  /** Post en cours d'édition (null = création). Sert au libellé / à l'état. */
  editing?: SocialPost | null;
  saving?: boolean;
  /** Enregistre comme brouillon (scheduled_at = null) ou planifié (si date posée). */
  onSave: (draft: ComposerDraft) => void;
  /** Annule l'édition en cours (retour à la création). */
  onCancelEdit?: () => void;
}

export function PostComposer({ initial, editing = null, saving = false, onSave, onCancelEdit }: PostComposerProps) {
  const toast = useToast();
  const [content, setContent] = useState(initial?.content ?? '');
  const [networks, setNetworks] = useState<SocialProvider[]>(initial?.networks ?? []);
  const [media, setMedia] = useState<string[]>(initial?.media ?? []);
  const [mediaInput, setMediaInput] = useState('');
  const [scheduledAt, setScheduledAt] = useState<string>(
    initial?.scheduled_at ? toLocalInput(initial.scheduled_at) : '',
  );
  const [aiPrompt, setAiPrompt] = useState('');
  const [generating, setGenerating] = useState(false);

  // États pour le générateur d'images IA
  const [aiImageModalOpen, setAiImageModalOpen] = useState(false);
  const [aiImagePrompt, setAiImagePrompt] = useState('');
  const [generatingImage, setGeneratingImage] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const toggleNetwork = (n: SocialProvider) => {
    setNetworks((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]));
  };

  const addMedia = () => {
    const url = mediaInput.trim();
    if (!url) return;
    setMedia((cur) => (cur.includes(url) ? cur : [...cur, url]));
    setMediaInput('');
  };

  const removeMedia = (url: string) => setMedia((cur) => cur.filter((u) => u !== url));

  // Génération IA — calque consommation helper FIGÉ generateSocialPost. Best-effort,
  // jamais de crash : si le worker renvoie { error } (ex. clé Anthropic absente),
  // on l'affiche proprement via toast (§6.A : discrimination res.error / !res.data).
  const generate = async () => {
    if (!aiPrompt.trim() || generating) return;
    setGenerating(true);
    try {
      const res = await generateSocialPost({
        prompt: aiPrompt.trim(),
        network: networks[0], // réseau principal si sélectionné (optionnel côté API)
      });
      if (res.data?.content) {
        setContent(res.data.content);
      } else {
        toast.error(res.error ?? t('social.not_configured'));
      }
    } catch {
      toast.error(t('social.not_configured'));
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateImage = async () => {
    if (!aiImagePrompt.trim() || generatingImage) return;
    setGeneratingImage(true);
    setGenerationError(null);
    setGeneratedImageUrl(null);
    try {
      const res = await generateSocialImage(aiImagePrompt.trim());
      if (res.data?.url) {
        setGeneratedImageUrl(res.data.url);
      } else {
        setGenerationError(res.error ?? t('social.ai.image.error'));
        toast.error(res.error ?? t('social.ai.image.error'));
      }
    } catch (err) {
      console.error(err);
      setGenerationError(t('social.ai.image.error'));
      toast.error(t('social.ai.image.error'));
    } finally {
      setGeneratingImage(false);
    }
  };

  const handleInsertGeneratedImage = () => {
    if (!generatedImageUrl) return;
    setMedia((cur) => (cur.includes(generatedImageUrl) ? cur : [...cur, generatedImageUrl]));
    setAiImageModalOpen(false);
    setGeneratedImageUrl(null);
    setAiImagePrompt('');
  };

  const buildDraft = (): ComposerDraft => ({
    content: content.trim(),
    media,
    networks,
    scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
  });

  const canSave = content.trim().length > 0 && !saving;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* ── Colonne composer ── */}
      <Card>
        <div className="space-y-4">
          {/* Génération IA */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
              {t('social.generate_prompt')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void generate(); } }}
                placeholder={t('social.generate_prompt')}
                className="flex-1 px-3 py-2 text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] focus:border-[var(--primary)] focus:outline-none"
              />
              <Button
                variant="secondary"
                leftIcon={<Sparkles size={14} />}
                isLoading={generating}
                disabled={!aiPrompt.trim()}
                onClick={() => void generate()}
              >
                {generating ? t('social.generating') : t('social.generate')}
              </Button>
            </div>
          </div>

          {/* Contenu */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1" htmlFor="social-content">
              {t('social.content_label')}
            </label>
            <textarea
              id="social-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              placeholder={t('social.content_placeholder')}
              className="w-full px-3 py-2 text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] focus:border-[var(--primary)] focus:outline-none resize-y"
            />
          </div>

          {/* Réseaux (chips multi) */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
              {t('social.networks_label')}
            </label>
            <div className="flex flex-wrap gap-2">
              {ALL_NETWORKS.map((n) => {
                const active = networks.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => toggleNetwork(n)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-[var(--radius-md)] border transition-all cursor-pointer ${
                      active
                        ? 'border-[var(--primary)] bg-[var(--primary-subtle,var(--bg-subtle))] text-[var(--text-primary)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <NetworkIcon provider={n} />
                    {networkLabel(n)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Médias (URLs) */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
              {t('social.media_label')}
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                type="url"
                value={mediaInput}
                onChange={(e) => setMediaInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMedia(); } }}
                placeholder="https://…"
                className="flex-1 min-w-[200px] px-3 py-2 text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] focus:border-[var(--primary)] focus:outline-none"
              />
              <Button variant="secondary" leftIcon={<Plus size={14} />} disabled={!mediaInput.trim()} onClick={addMedia}>
                {t('social.media_add')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                leftIcon={<Sparkles size={14} className="text-violet-500" />}
                onClick={() => setAiImageModalOpen(true)}
              >
                {t('social.ai.image.button')}
              </Button>
            </div>
            {media.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {media.map((url) => (
                  <span
                    key={url}
                    className="inline-flex items-center gap-1.5 max-w-[220px] px-2 py-1 text-[11px] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                  >
                    <span className="truncate">{url}</span>
                    <button type="button" onClick={() => removeMedia(url)} aria-label={t('common.close')} className="shrink-0 hover:text-[var(--text-primary)]">
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Planification optionnelle */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1" htmlFor="social-schedule">
              {t('social.schedule_at')}
            </label>
            <input
              id="social-schedule"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="px-3 py-2 text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] focus:border-[var(--primary)] focus:outline-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <Button disabled={!canSave} isLoading={saving} onClick={() => onSave(buildDraft())}>
              {scheduledAt ? t('social.schedule') : t('social.save_draft')}
            </Button>
            {editing && onCancelEdit && (
              <Button variant="ghost" onClick={onCancelEdit}>{t('common.close')}</Button>
            )}
          </div>
        </div>
      </Card>

      {/* ── Colonne prévisualisation par réseau ── */}
      <div>
        <p className="text-sm font-medium text-[var(--text-primary)] mb-2">{t('social.preview')}</p>
        {networks.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">
            {t('social.networks_label')}
          </div>
        ) : (
          <div className="space-y-3">
            {networks.map((n) => (
              <NetworkPreview key={n} provider={n} content={content} media={media} />
            ))}
          </div>
        )}
      </div>

      <Modal
        open={aiImageModalOpen}
        onOpenChange={(open) => {
          setAiImageModalOpen(open);
          if (!open) {
            setGeneratedImageUrl(null);
            setGenerationError(null);
            setGeneratingImage(false);
          }
        }}
        title={t('social.ai.image.title')}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
              {t('social.ai.image.prompt_label')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={aiImagePrompt}
                onChange={(e) => setAiImagePrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleGenerateImage(); } }}
                placeholder={t('social.ai.image.prompt_placeholder')}
                className="flex-1 px-3 py-2 text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] focus:border-[var(--primary)] focus:outline-none"
                disabled={generatingImage}
              />
              <Button
                variant="primary"
                leftIcon={<Sparkles size={14} />}
                isLoading={generatingImage}
                disabled={!aiImagePrompt.trim() || generatingImage}
                onClick={() => void handleGenerateImage()}
              >
                {t('social.ai.image.generate')}
              </Button>
            </div>
          </div>

          {generatingImage && (
            <div className="flex flex-col items-center justify-center p-8 border border-dashed border-[var(--border-subtle)] rounded-[var(--radius-lg)] bg-[var(--bg-subtle)] space-y-3">
              <AiLoadingShimmer text={t('social.ai.image.generating')} />
            </div>
          )}

          {generationError && (
            <div className="p-4 border border-red-200 bg-red-50 text-red-700 text-sm rounded-[var(--radius-lg)]">
              {generationError}
            </div>
          )}

          {generatedImageUrl && (
            <div className="space-y-3">
              <div className="relative aspect-video w-full rounded-[var(--radius-lg)] border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-subtle)]">
                <img
                  src={generatedImageUrl}
                  alt="Visuel généré par l'IA"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setAiImageModalOpen(false)}>
                  {t('common.close')}
                </Button>
                <Button variant="primary" onClick={handleInsertGeneratedImage}>
                  {t('social.ai.image.insert')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

/** ISO → valeur d'un <input type="datetime-local"> (heure locale, sans secondes). */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
