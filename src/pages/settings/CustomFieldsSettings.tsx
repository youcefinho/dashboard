import { useState, useEffect } from 'react';
import { Card, Button, Badge } from '@/components/ui';
import { GripVertical, Plus, Trash2, Save } from 'lucide-react';


interface CustomFieldDef {
  id: string;
  name: string;
  slug: string;
  field_type: string;
  options: string;
  is_required: number;
}

export function CustomFieldsSettings() {
  const [fields, setFields] = useState<CustomFieldDef[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // In a real app, you would fetch these from the API
    // GET /api/settings/custom-fields
    setFields([
      { id: '1', name: 'Budget Max', slug: 'budget_max', field_type: 'number', options: '[]', is_required: 0 },
      { id: '2', name: 'Type de propriété', slug: 'property_type', field_type: 'select', options: '["Maison", "Condo", "Chalet"]', is_required: 0 }
    ]);
    setIsLoading(false);
  }, []);

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
                  <button className="text-[var(--danger)] hover:bg-[var(--danger)]/10 p-1.5 rounded transition-colors">
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

      <Button className="w-full justify-center border-dashed border-2 bg-transparent text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]">
        <Plus size={16} className="mr-2" /> Ajouter un champ
      </Button>

      <div className="flex justify-end pt-4 border-t border-[var(--border-subtle)]">
        <Button className="gap-2">
          <Save size={16} /> Enregistrer l'ordre
        </Button>
      </div>
    </div>
  );
}
