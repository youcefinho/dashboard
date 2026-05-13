import { useState, useEffect } from 'react';
import { Card, Button, Input, Badge } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { getSnippets, createSnippet, updateSnippet, deleteSnippet } from '@/lib/api';
import type { Snippet } from '@/lib/types';
import { Plus, Search, Edit2, Trash2, MessageSquare, Terminal } from 'lucide-react';
import { useToast } from '@/components/ui';

export function SnippetsSettings() {
  const { success, error: toastError } = useToast();
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

  useEffect(() => { void loadSnippets(); }, []);

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
    
    // Le shortcut doit commencer par /
    const shortcutStr = form.shortcut.startsWith('/') ? form.shortcut : `/${form.shortcut}`;

    if (editingSnippet) {
      const res = await updateSnippet(editingSnippet.id, { ...form, shortcut: shortcutStr });
      if (res.error) toastError(res.error);
      else { success('Réponse rapide modifiée avec succès'); setModalOpen(false); void loadSnippets(); }
    } else {
      const res = await createSnippet({ ...form, shortcut: shortcutStr });
      if (res.error) toastError(res.error);
      else { success('Réponse rapide créée avec succès'); setModalOpen(false); void loadSnippets(); }
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette réponse rapide ?')) return;
    const res = await deleteSnippet(id);
    if (res.error) toastError(res.error);
    else { success('Réponse rapide supprimée', { action: { label: 'Annuler', onClick: () => { /* Undo non implémenté pour snippets encore */ } } }); void loadSnippets(); }
  };

  const filtered = snippets.filter(s => 
    s.name.toLowerCase().includes(search.toLowerCase()) || 
    s.shortcut.toLowerCase().includes(search.toLowerCase()) ||
    s.body.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-primary)]">Réponses rapides (Snippets)</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Gérez vos réponses pré-enregistrées pour la messagerie. Tapez "/" dans le chat pour y accéder.</p>
        </div>
        <Button onClick={handleOpenNew} leftIcon={<Plus size={16} />}>Nouveau Snippet</Button>
      </div>

      <Card className="p-4">
        <div className="flex gap-4 mb-4">
          <div className="flex-1 max-w-sm">
            <Input 
              leftIcon={<Search size={16} />}
              placeholder="Rechercher un snippet..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4 animate-pulse">
            {[1,2,3].map(i => <div key={i} className="h-20 bg-[var(--bg-subtle)] rounded-lg"></div>)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-[var(--border-subtle)] rounded-xl">
            <MessageSquare size={40} className="mx-auto text-[var(--text-muted)] mb-3" />
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Aucune réponse rapide</h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">Vous n'avez pas encore configuré de réponses rapides.</p>
            <Button variant="secondary" onClick={handleOpenNew}>Créer mon premier snippet</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(s => (
              <div key={s.id} className="p-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl hover:border-[var(--brand-primary)] transition-colors flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-[var(--text-primary)] truncate">{s.name}</h3>
                    <Badge color="var(--bg-subtle)" className="text-[var(--text-secondary)] font-mono text-xs"><Terminal size={10} className="inline mr-1" />{s.shortcut}</Badge>
                  </div>
                  <p className="text-sm text-[var(--text-secondary)] line-clamp-2 whitespace-pre-wrap">{s.body}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => handleOpenEdit(s)} className="text-[var(--text-muted)] hover:text-[var(--brand-primary)]"><Edit2 size={14} /></Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(s.id)} className="text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)]"><Trash2 size={14} /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={modalOpen} onOpenChange={() => setModalOpen(false)} title={editingSnippet ? "Modifier le snippet" : "Nouveau snippet"}>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">Nom du snippet</label>
            <Input 
              value={form.name} 
              onChange={e => setForm({...form, name: e.target.value})} 
              placeholder="Ex: Formule de politesse" 
              autoFocus
            />
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">Raccourci</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] font-mono">/</span>
              <Input 
                value={form.shortcut.replace(/^\//, '')} 
                onChange={e => setForm({...form, shortcut: e.target.value.replace(/\s/g, '').toLowerCase()})} 
                placeholder="bonjour"
                className="pl-7 font-mono"
              />
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-1">Sera utilisable en tapant /{form.shortcut.replace(/^\//, '') || 'raccourci'}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5">Contenu du message</label>
            <textarea 
              value={form.body} 
              onChange={e => setForm({...form, body: e.target.value})} 
              rows={5}
              placeholder="Bonjour [Nom], merci pour votre message..."
              className="w-full px-3 py-2 text-sm bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-lg placeholder:text-[var(--text-muted)] focus:border-[var(--brand-primary)] focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button onClick={handleSave}>{editingSnippet ? 'Enregistrer' : 'Créer'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}