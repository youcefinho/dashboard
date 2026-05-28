// ── Page AiContent — Atelier de contenu IA centralisé ───────────────────────
// SPRINT 12 « IA contenu » — Manager-C (front). Export nommé FIGÉ
// `AiContentPage` (route /ai-content, App.tsx FIGÉ Phase A).
//
// Atelier : brief → format → preset de ton → générer → éditer → réécrire (6
// modes) → sauvegarder dans la bibliothèque / « utiliser comme gabarit » +
// bibliothèque (rouvrir/supprimer) + panneau Brand Voice CRUD des presets.
//
// Helpers FIGÉS §6.A consommés tels quels (AUCUN client_id envoyé — tenant
// borné worker-side). Discrimination res.error / !res.data (JAMAIS de champ
// `code`). Mock-safe : si l'IA n'est pas configurée, le worker renvoie un
// contenu mock déterministe → affiché normalement. Libellés via t('aicontent.*').
// AUCUN CSS global (styles inline locaux légers + tokens existants).

import { useState, useEffect, useCallback } from 'react';
import { Sparkles, Save, FileStack, Trash2, Plus, RefreshCw, BookOpen, PenLine, MessageSquare } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  Button, Card, Select, Textarea, Input, EmptyState, Badge, Modal, Switch,
  Tabs, TabsList, TabsTrigger, TabsContent,
  useToast, useConfirm,
} from '@/components/ui';
import { AiAssistantChat } from '@/components/ai/AiAssistantChat';
import {
  generateAiContent,
  rewriteAiContent,
  getAiContentItems,
  saveAiContentItem,
  deleteAiContentItem,
  useAsTemplate,
  getBrandVoices,
  createBrandVoice,
  updateBrandVoice,
  deleteBrandVoice,
  type AiRewriteMode,
} from '@/lib/api';
import type { AiContentFormat, AiContentItem, AiBrandVoice } from '@/lib/types';
import { t } from '@/lib/i18n';

const FORMATS: AiContentFormat[] = ['email', 'sms', 'social', 'blog', 'landing'];
const FORMAT_LABEL: Record<AiContentFormat, string> = {
  email: 'aicontent.format_email',
  sms: 'aicontent.format_sms',
  social: 'aicontent.format_social',
  blog: 'aicontent.format_blog',
  landing: 'aicontent.format_landing',
};

const REWRITE_MODES: AiRewriteMode[] = [
  'improve', 'shorten', 'expand', 'formalize', 'casualize', 'retone',
];
const REWRITE_LABEL: Record<AiRewriteMode, string> = {
  improve: 'aicontent.rewrite_improve',
  shorten: 'aicontent.rewrite_shorten',
  expand: 'aicontent.rewrite_expand',
  formalize: 'aicontent.rewrite_formalize',
  casualize: 'aicontent.rewrite_casualize',
  retone: 'aicontent.rewrite_retone',
};

// « Utiliser comme gabarit » s'applique aux formats template-isables (email/sms).
const TEMPLATABLE: AiContentFormat[] = ['email', 'sms'];

interface VoiceDraft {
  id: string | null;
  name: string;
  description: string;
  is_default: boolean;
}

export function AiContentPage() {
  const toast = useToast();
  const confirm = useConfirm();

  // ── Atelier (brief → génération → édition) ────────────────────────────────
  const [format, setFormat] = useState<AiContentFormat>('email');
  const [brief, setBrief] = useState('');
  const [tonePresetId, setTonePresetId] = useState('');
  const [content, setContent] = useState('');
  const [sourceAction, setSourceAction] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [rewriting, setRewriting] = useState<AiRewriteMode | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Bibliothèque ──────────────────────────────────────────────────────────
  const [items, setItems] = useState<AiContentItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [itemsError, setItemsError] = useState<string | null>(null);

  // ── Brand voices (presets) ────────────────────────────────────────────────
  const [voices, setVoices] = useState<AiBrandVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [voiceModal, setVoiceModal] = useState<VoiceDraft | null>(null);
  const [savingVoice, setSavingVoice] = useState(false);

  const loadItems = useCallback(async () => {
    setLoadingItems(true);
    setItemsError(null);
    const res = await getAiContentItems();
    if (res.data) setItems(res.data.items);
    else if (res.error) setItemsError(res.error);
    setLoadingItems(false);
  }, []);

  const loadVoices = useCallback(async () => {
    setLoadingVoices(true);
    setVoicesError(null);
    const res = await getBrandVoices();
    if (res.data) setVoices(res.data.voices);
    else if (res.error) setVoicesError(res.error);
    setLoadingVoices(false);
  }, []);

  useEffect(() => { void loadItems(); void loadVoices(); }, [loadItems, loadVoices]);

  // ── Génération ──────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (generating || !brief.trim()) return;
    setGenerating(true);
    try {
      const res = await generateAiContent({
        format,
        brief: brief.trim(),
        tone_preset_id: tonePresetId || undefined,
      });
      if (res.data) {
        setContent(res.data.content);
        setSourceAction(res.data.source_action);
        // Nouveau contenu généré → on détache d'un éventuel item ouvert.
        setEditingItemId(null);
      } else {
        toast.error(res.error ?? t('aicontent.error'));
      }
    } catch {
      toast.error(t('aicontent.error'));
    } finally {
      setGenerating(false);
    }
  };

  // ── Réécriture (6 modes) ──────────────────────────────────────────────────
  const handleRewrite = async (mode: AiRewriteMode) => {
    if (rewriting || !content.trim()) return;
    setRewriting(mode);
    try {
      const res = await rewriteAiContent({ content, mode });
      if (res.data) {
        setContent(res.data.content);
      } else {
        toast.error(res.error ?? t('aicontent.error'));
      }
    } catch {
      toast.error(t('aicontent.error'));
    } finally {
      setRewriting(null);
    }
  };

  // ── Sauvegarde dans la bibliothèque ───────────────────────────────────────
  const handleSave = async () => {
    if (saving || !content.trim()) return;
    setSaving(true);
    try {
      const res = await saveAiContentItem({
        format,
        content,
        title: title.trim() || undefined,
        brief: brief.trim() || undefined,
        tone_preset_id: tonePresetId || undefined,
        source_action: sourceAction,
      });
      if (res.data) {
        toast.success(t('aicontent.saved'));
        setEditingItemId(res.data.item.id);
        await loadItems();
      } else {
        toast.error(res.error ?? t('aicontent.error'));
      }
    } catch {
      toast.error(t('aicontent.error'));
    } finally {
      setSaving(false);
    }
  };

  // ── Pont IA → templates (email/sms) ───────────────────────────────────────
  const handleUseAsTemplate = async (id: string) => {
    const res = await useAsTemplate(id);
    if (res.data) {
      toast.success(t('aicontent.use_as_template'));
    } else {
      toast.error(res.error ?? t('aicontent.error'));
    }
  };

  // ── Rouvrir / supprimer un contenu sauvegardé ─────────────────────────────
  const handleOpenItem = (item: AiContentItem) => {
    setFormat(item.format);
    setBrief(item.brief ?? '');
    setContent(item.content);
    setTitle(item.title ?? '');
    setTonePresetId(item.tone_preset_id ?? '');
    setSourceAction(item.source_action ?? undefined);
    setEditingItemId(item.id);
    document.getElementById('main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteItem = async (item: AiContentItem) => {
    const ok = await confirm({ title: t('aicontent.delete'), danger: true });
    if (!ok) return;
    const res = await deleteAiContentItem(item.id);
    if (res.data?.deleted) {
      if (editingItemId === item.id) setEditingItemId(null);
      await loadItems();
    } else {
      toast.error(res.error ?? t('aicontent.error'));
    }
  };

  // ── Brand voices : CRUD presets ───────────────────────────────────────────
  const openNewVoice = () =>
    setVoiceModal({ id: null, name: '', description: '', is_default: false });
  const openEditVoice = (v: AiBrandVoice) =>
    setVoiceModal({
      id: v.id,
      name: v.name,
      description: v.description ?? '',
      is_default: v.is_default,
    });

  const handleSaveVoice = async () => {
    if (!voiceModal || savingVoice || !voiceModal.name.trim()) return;
    setSavingVoice(true);
    try {
      const payload = {
        name: voiceModal.name.trim(),
        description: voiceModal.description.trim() || undefined,
        is_default: voiceModal.is_default,
      };
      const res = voiceModal.id
        ? await updateBrandVoice(voiceModal.id, payload)
        : await createBrandVoice(payload);
      if (res.data) {
        toast.success(t('aicontent.saved'));
        setVoiceModal(null);
        await loadVoices();
      } else {
        toast.error(res.error ?? t('aicontent.error'));
      }
    } catch {
      toast.error(t('aicontent.error'));
    } finally {
      setSavingVoice(false);
    }
  };

  const handleDeleteVoice = async (v: AiBrandVoice) => {
    const ok = await confirm({ title: t('aicontent.delete'), danger: true });
    if (!ok) return;
    const res = await deleteBrandVoice(v.id);
    if (res.data?.deleted) {
      if (tonePresetId === v.id) setTonePresetId('');
      await loadVoices();
    } else {
      toast.error(res.error ?? t('aicontent.error'));
    }
  };

  const headingCls = 'text-sm font-semibold text-[var(--text-primary)] mb-3';

  return (
    <AppLayout title={t('aicontent.title')}>
      {/* ── En-tête sobre ── */}
      <div
        className="rounded-2xl mb-6"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          padding: '1.5rem 1.75rem',
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={18} className="text-[var(--primary)]" />
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            {t('aicontent.title')}
          </h1>
        </div>
        <p className="text-sm text-[var(--text-muted)]">{t('aicontent.subtitle')}</p>
      </div>

      <Tabs defaultValue="writer">
        <TabsList aria-label={t('aiassist.tabs_label')}>
          <TabsTrigger value="writer">
            <span className="inline-flex items-center gap-1.5">
              <PenLine size={14} />
              {t('aicontent.title')}
            </span>
          </TabsTrigger>
          <TabsTrigger value="assistant">
            <span className="inline-flex items-center gap-1.5">
              <MessageSquare size={14} />
              {t('aiassist.tab')}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="writer">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Colonne principale : atelier + bibliothèque ── */}
        <div className="lg:col-span-2 space-y-6">
          {/* ── Brief → génération ── */}
          <section>
            <h2 className={headingCls}>{t('aicontent.title')}</h2>
            <Card className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Select
                  label={t('aicontent.format_label')}
                  value={format}
                  onChange={(e) => setFormat(e.target.value as AiContentFormat)}
                >
                  {FORMATS.map((f) => (
                    <option key={f} value={f}>{t(FORMAT_LABEL[f])}</option>
                  ))}
                </Select>
                <Select
                  label={t('aicontent.brand_voice')}
                  value={tonePresetId}
                  onChange={(e) => setTonePresetId(e.target.value)}
                  disabled={loadingVoices}
                >
                  <option value="">—</option>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}{v.is_default ? ` · ${t('aicontent.brand_voice_default')}` : ''}
                    </option>
                  ))}
                </Select>
              </div>

              <Textarea
                label={t('aicontent.brief_label')}
                placeholder={t('aicontent.brief_placeholder')}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={3}
              />

              <div>
                <Button
                  variant="primary"
                  leftIcon={<Sparkles size={14} />}
                  isLoading={generating}
                  disabled={generating || !brief.trim()}
                  onClick={() => void handleGenerate()}
                >
                  {generating ? t('aicontent.generating') : t('aicontent.generate')}
                </Button>
              </div>
            </Card>
          </section>

          {/* ── Édition + réécriture + sauvegarde ── */}
          {content.trim() !== '' && (
            <section>
              <h2 className={headingCls}>{t('aicontent.rewrite')}</h2>
              <Card className="p-4 space-y-4">
                <Input
                  label={t('aicontent.brand_voice_name')}
                  placeholder={t('aicontent.title')}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />

                <Textarea
                  label={t('aicontent.title')}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={10}
                />

                {/* Réécriture par mode */}
                <div className="flex flex-wrap gap-2">
                  {REWRITE_MODES.map((m) => (
                    <Button
                      key={m}
                      variant="secondary"
                      size="sm"
                      leftIcon={<RefreshCw size={13} />}
                      isLoading={rewriting === m}
                      disabled={rewriting !== null || !content.trim()}
                      onClick={() => void handleRewrite(m)}
                    >
                      {t(REWRITE_LABEL[m])}
                    </Button>
                  ))}
                </div>

                {/* Sauvegarde + use-as-template */}
                <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--border)]">
                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<Save size={14} />}
                    isLoading={saving}
                    disabled={saving || !content.trim()}
                    onClick={() => void handleSave()}
                  >
                    {t('aicontent.save')}
                  </Button>
                  {editingItemId && TEMPLATABLE.includes(format) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<FileStack size={14} />}
                      onClick={() => void handleUseAsTemplate(editingItemId)}
                    >
                      {t('aicontent.use_as_template')}
                    </Button>
                  )}
                </div>
              </Card>
            </section>
          )}

          {/* ── Bibliothèque ── */}
          <section>
            <h2 className={headingCls}>{t('aicontent.library')}</h2>
            {itemsError && !loadingItems ? (
              <Card
                role="alert"
                aria-live="polite"
                className="p-4 mb-3 border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-between gap-3"
              >
                <span className="text-sm">{itemsError}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadItems()}
                >
                  {t('action.retry')}
                </Button>
              </Card>
            ) : null}
            {loadingItems ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton h-20 rounded-[var(--radius-lg)]" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <EmptyState
                variant="first-time"
                icon={<BookOpen size={28} />}
                title={t('aicontent.library_empty')}
                description={t('aicontent.subtitle')}
              />
            ) : (
              <div className="space-y-3">
                {items.map((item) => (
                  <Card key={item.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        className="flex-1 text-left min-w-0"
                        onClick={() => handleOpenItem(item)}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Badge intent="neutral">
                            {t(FORMAT_LABEL[item.format])}
                          </Badge>
                          <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                            {item.title || (item.brief ?? '').slice(0, 60) || item.content.slice(0, 60)}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] line-clamp-2">
                          {item.content}
                        </p>
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        {TEMPLATABLE.includes(item.format) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title={t('aicontent.use_as_template')}
                            aria-label={t('aicontent.use_as_template')}
                            onClick={() => void handleUseAsTemplate(item.id)}
                          >
                            <FileStack size={15} />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t('aicontent.delete')}
                          aria-label={t('aicontent.delete')}
                          onClick={() => void handleDeleteItem(item)}
                        >
                          <Trash2 size={15} className="text-[var(--danger)]" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ── Colonne latérale : panneau Brand Voice ── */}
        <aside className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className={headingCls + ' mb-0'}>{t('aicontent.brand_voice')}</h2>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Plus size={14} />}
              onClick={openNewVoice}
            >
              {t('aicontent.brand_voice_new')}
            </Button>
          </div>

          {voicesError && !loadingVoices ? (
            <Card
              role="alert"
              aria-live="polite"
              className="p-3 mb-3 border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-between gap-2"
            >
              <span className="text-xs">{voicesError}</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void loadVoices()}
              >
                {t('action.retry')}
              </Button>
            </Card>
          ) : null}
          {loadingVoices ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="skeleton h-16 rounded-[var(--radius-lg)]" />
              ))}
            </div>
          ) : voices.length === 0 ? (
            <EmptyState
              variant="first-time"
              icon={<Sparkles size={24} />}
              title={t('aicontent.brand_voice_empty')}
            />
          ) : (
            <div className="space-y-3">
              {voices.map((v) => (
                <Card key={v.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      className="flex-1 text-left min-w-0"
                      onClick={() => openEditVoice(v)}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {v.name}
                        </span>
                        {v.is_default && (
                          <Badge intent="info">{t('aicontent.brand_voice_default')}</Badge>
                        )}
                      </div>
                      {v.description && (
                        <p className="text-xs text-[var(--text-muted)] line-clamp-2">
                          {v.description}
                        </p>
                      )}
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title={t('aicontent.delete')}
                      aria-label={t('aicontent.delete')}
                      onClick={() => void handleDeleteVoice(v)}
                    >
                      <Trash2 size={14} className="text-[var(--danger)]" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </aside>
      </div>
        </TabsContent>

        {/* ── Onglet Assistant IA conversationnel (chat) ── */}
        <TabsContent value="assistant">
          <AiAssistantChat />
        </TabsContent>
      </Tabs>

      {/* ── Modal éditeur de preset Brand Voice ── */}
      {voiceModal && (
        <Modal
          open
          onOpenChange={(o) => { if (!o) setVoiceModal(null); }}
          title={voiceModal.id ? t('aicontent.brand_voice') : t('aicontent.brand_voice_new')}
        >
          <div className="space-y-4">
            <Input
              label={t('aicontent.brand_voice_name')}
              value={voiceModal.name}
              onChange={(e) => setVoiceModal({ ...voiceModal, name: e.target.value })}
              autoFocus
            />
            <Textarea
              label={t('aicontent.brand_voice_description')}
              value={voiceModal.description}
              onChange={(e) => setVoiceModal({ ...voiceModal, description: e.target.value })}
              rows={4}
            />
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm text-[var(--text-primary)]">
                {t('aicontent.brand_voice_default')}
              </span>
              <Switch
                checked={voiceModal.is_default}
                onCheckedChange={(checked: boolean) =>
                  setVoiceModal({ ...voiceModal, is_default: checked })}
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setVoiceModal(null)}>
                {t('aicontent.delete')}
              </Button>
              <Button
                variant="primary"
                leftIcon={<Save size={14} />}
                isLoading={savingVoice}
                disabled={savingVoice || !voiceModal.name.trim()}
                onClick={() => void handleSaveVoice()}
              >
                {t('aicontent.save')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </AppLayout>
  );
}
