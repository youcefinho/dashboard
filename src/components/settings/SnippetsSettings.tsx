// ── SnippetsSettings — Sprint 23 W33 : Textarea premium + DropdownMenu kebab + list-item-enter
import { useState, useEffect } from 'react';
import {
  Card,
  Button,
  Input,
  Tag,
  Textarea,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Skeleton,
  EmptyState,
  useConfirm,
  useToast,
  Icon,
} from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { getSnippets, createSnippet, updateSnippet, deleteSnippet } from '@/lib/api';
import type { Snippet } from '@/lib/types';
import { Plus, Search, Pencil, Trash2, MessageSquare, Terminal, MoreVertical, XCircle } from 'lucide-react';
import { t } from '@/lib/i18n';

export function SnippetsSettings() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);

  const [form, setForm] = useState({ name: '', shortcut: '', body: '' });

  const loadSnippets = async () => {
    setIsLoading(true);
    const res = await getSnippets();
    if (res.data) setSnippets(res.data);
    setIsLoading(false);
  };

  useEffect(() => {
    void loadSnippets();
  }, []);

  const handleOpenNew = () => {
    setEditingSnippet(null);
    setForm({ name: '', shortcut: '', body: '' });
    setModalOpen(true);
  };

  const handleOpenEdit = (s: Snippet) => {
    setEditingSnippet(s);
    setForm({ name: s.name, shortcut: s.shortcut, body: s.body });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.shortcut.trim() || !form.body.trim()) {
      toastError('Veuillez remplir tous les champs');
      return;
    }

    const shortcutStr = form.shortcut.startsWith('/') ? form.shortcut : `/${form.shortcut}`;

    if (editingSnippet) {
      const res = await updateSnippet(editingSnippet.id, { ...form, shortcut: shortcutStr });
      if (res.error) toastError(res.error);
      else {
        success('Réponse rapide modifiée avec succès');
        setModalOpen(false);
        void loadSnippets();
      }
    } else {
      const res = await createSnippet({ ...form, shortcut: shortcutStr });
      if (res.error) toastError(res.error);
      else {
        success('Réponse rapide créée avec succès');
        setModalOpen(false);
        void loadSnippets();
      }
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'Supprimer cette réponse rapide ?',
      description: 'Cette action est irréversible.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    const res = await deleteSnippet(id);
    if (res.error) toastError(res.error);
    else {
      success('Réponse rapide supprimée');
      void loadSnippets();
    }
  };

  const filtered = snippets.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.shortcut.toLowerCase().includes(search.toLowerCase()) ||
      s.body.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <header className="settings-page-header">
        <div>
          <h2 className="t-h2">{t('set.snippets.title')}</h2>
          <p className="t-caption text-[var(--gray-500)]">
            Tape "/" dans le chat pour insérer un snippet pré-enregistré.
          </p>
        </div>
        <Button onClick={handleOpenNew} size="sm" leftIcon={<Icon as={Plus} size="md" />}>
          {t('set.snippets.new')}
        </Button>
      </header>

      <Card className="settings-card p-5">
        <div className="flex gap-4 mb-4">
          <div className="flex-1 max-w-sm">
            <Input
              leftIcon={<Icon as={Search} size="md" />}
              placeholder="Rechercher un snippet..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          /* Skeleton matche rows snippet : icon + name/shortcut + body preview + kebab */
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-4 rounded-xl"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', animationDelay: `${i * 40}ms` }}
              >
                <Skeleton className="h-9 w-9 rounded-lg shrink-0" style={{ animationDelay: `${i * 40}ms` }} />
                <div className="flex-1 space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-3.5 w-32" style={{ animationDelay: `${i * 40 + 20}ms` }} />
                    <Skeleton className="h-4 w-16 rounded-md" style={{ animationDelay: `${i * 40 + 40}ms` }} />
                  </div>
                  <Skeleton className="h-2.5 w-full" style={{ animationDelay: `${i * 40 + 60}ms` }} />
                  <Skeleton className="h-2.5 w-3/4" style={{ animationDelay: `${i * 40 + 80}ms` }} />
                </div>
                <Skeleton className="h-7 w-7 rounded-lg shrink-0" style={{ animationDelay: `${i * 40 + 100}ms` }} />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          // Sprint 42 M3.3 — EmptyState cohérent (first-time vs filtered-empty)
          search.trim() && snippets.length > 0 ? (
            <EmptyState
              variant="compact"
              icon={<Icon as={XCircle} size={28} />}
              title="Aucun résultat"
              description={`Aucun snippet ne correspond à "${search}". Essaye un autre terme ou efface la recherche.`}
              action={
                <Button variant="secondary" size="sm" onClick={() => setSearch('')}>
                  Effacer la recherche
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Icon as={MessageSquare} size={40} />}
              title="Aucune réponse rapide"
              description="Crée ton premier snippet pour répondre plus vite dans Inbox. Tape « / » dans le chat pour y accéder."
              action={
                <Button onClick={handleOpenNew} leftIcon={<Icon as={Plus} size="sm" />}>
                  Créer mon premier snippet
                </Button>
              }
              tips={[
                'Donne un nom clair (ex : "Bonjour devis").',
                'Choisis un raccourci court : /bonjour, /merci, /rdv.',
                'Tu peux utiliser des variables comme {{nom}} dans le contenu.',
              ]}
            />
          )
        ) : (
          <div className="space-y-3">
            {filtered.map((s, idx) => (
              <div
                key={s.id}
                className="row-premium list-item-enter p-4 rounded-xl flex items-start justify-between gap-4"
                style={{ animationDelay: `${idx * 50}ms`, animationFillMode: 'both' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-semibold text-[var(--text-primary)] truncate">{s.name}</h3>
                    <Tag variant="neutral" size="sm" leftIcon={<Terminal size={10} />} className="font-mono">
                      {s.shortcut}
                    </Tag>
                  </div>
                  <p className="text-sm text-[var(--text-secondary)] line-clamp-2 whitespace-pre-wrap">{s.body}</p>
                </div>
                <DropdownMenu
                  trigger={
                    <button
                      type="button"
                      className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer shrink-0"
                      aria-label="Actions"
                    >
                      <Icon as={MoreVertical} size="md" />
                    </button>
                  }
                >
                  <DropdownMenuItem leftIcon={<Icon as={Pencil} size="sm" />} onSelect={() => handleOpenEdit(s)}>
                    Modifier
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="danger" leftIcon={<Icon as={Trash2} size="sm" />} onSelect={() => handleDelete(s.id)}>
                    Supprimer
                  </DropdownMenuItem>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onOpenChange={() => setModalOpen(false)}
        title={editingSnippet ? 'Modifier le snippet' : 'Nouveau snippet'}
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">Nom du snippet</label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex: Formule de politesse"
              autoFocus
            />
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">Raccourci</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] font-mono z-10">/</span>
              <Input
                value={form.shortcut.replace(/^\//, '')}
                onChange={(e) =>
                  setForm({ ...form, shortcut: e.target.value.replace(/\s/g, '').toLowerCase() })
                }
                placeholder="bonjour"
                className="pl-7 font-mono"
              />
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Sera utilisable en tapant /{form.shortcut.replace(/^\//, '') || 'raccourci'}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">Contenu du message</label>
            <Textarea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              rows={5}
              placeholder="Bonjour [Nom], merci pour votre message..."
              className="font-mono"
              maxLength={2000}
              showCounter
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSave}>{editingSnippet ? 'Enregistrer' : 'Créer'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
