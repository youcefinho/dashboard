import { useState, useEffect } from 'react';
import { Card, Button, Badge, useConfirm } from '@/components/ui';
import { GripVertical, Plus, Trash2, Save } from 'lucide-react';

import { getCustomFields, createCustomField, deleteCustomField } from '@/lib/api';
import type { CustomFieldDef } from '@/lib/types';
import { toast } from 'sonner';

export function CustomFieldsSettings() {
  const confirm = useConfirm();
  const [fields, setFields] = useState<CustomFieldDef[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchFields();
  }, []);

  const fetchFields = async () => {
    setIsLoading(true);
    const res = await getCustomFields();
    if (res.data) setFields(res.data as unknown as CustomFieldDef[]);
    setIsLoading(false);
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'Supprimer ce champ personnalisé ?',
      description: 'Les valeurs déjà saisies sur les leads pour ce champ seront perdues.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    const res = await deleteCustomField(id);
    if (res.error) toast.error(res.error);
    else {
      toast.success('Champ supprimé');
      fetchFields();
    }
  };

  const handleAddMock = async () => {
    const res = await createCustomField({
      client_id: 'default', // In a real app, from auth context
      name: `Nouveau champ ${fields.length + 1}`,
      field_type: 'text',
      options: [],
      is_required: false,
      sort_order: fields.length
    });
    if (res.error) toast.error(res.error);
    else {
      toast.success('Champ ajouté');
      fetchFields();
    }
  };

  if (isLoading) return <div className="p-8 text-center text-[var(--text-muted)]">Chargement...</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-lg font-bold mb-1">Champs personnalisés</h2>
        <p className="text-sm text-[var(--text-muted)]">Configurez les champs spécifiques à votre processus de vente pour enrichir vos fiches leads.</p>
      </div>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)]">
              <th className="py-3 px-4 font-medium w-10"></th>
              <th className="py-3 px-4 font-medium">Nom du champ</th>
              <th className="py-3 px-4 font-medium">Clé (slug)</th>
              <th className="py-3 px-4 font-medium">Type</th>
              <th className="py-3 px-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {fields.map(field => (
              <tr key={field.id} className="hover:bg-[var(--bg-subtle)]">
                <td className="py-3 px-4 text-[var(--text-muted)] cursor-move">
                  <GripVertical size={16} />
                </td>
                <td className="py-3 px-4 font-medium">{field.name}</td>
                <td className="py-3 px-4 font-mono text-xs text-[var(--text-muted)]">{field.slug}</td>
                <td className="py-3 px-4">
                  <Badge>{field.field_type}</Badge>
                </td>
                <td className="py-3 px-4 text-right">
                  <button onClick={() => handleDelete(field.id)} className="text-[var(--danger)] hover:bg-[var(--danger)]/10 p-1.5 rounded transition-colors">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {fields.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-[var(--text-muted)]">
                  Aucun champ personnalisé configuré.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Button onClick={handleAddMock} className="w-full justify-center border-dashed border-2 bg-transparent text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]">
        <Plus size={16} className="mr-2" /> Ajouter un champ rapide
      </Button>

      <div className="flex justify-end pt-4 border-t border-[var(--border-subtle)]">
        <Button className="gap-2">
          <Save size={16} /> Enregistrer l'ordre
        </Button>
      </div>
    </div>
  );
}
