// ── Page Propriétés (Centris Sync) — Intralys CRM (Sprint 9) ──
import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button, Input, Card, Badge } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Home, RefreshCw, Plus, Search, MapPin, Bed, Bath, Expand, Trash2 } from 'lucide-react';

interface Property {
  id: string;
  mls_number: string;
  title: string;
  description: string;
  price: number;
  address: string;
  city: string;
  property_type: string;
  status: string;
  bedrooms: number;
  bathrooms: number;
  area_sqft: number;
  image_url: string;
  sync_source: string;
}

export function PropertiesPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [mlsInput, setMlsInput] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    loadProperties();
  }, []);

  const loadProperties = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch<Property[]>('/properties');
      setProperties(res.data || []);
    } catch {
      // silencieux
    }
    setIsLoading(false);
  };

  const handleSync = async () => {
    if (!mlsInput) return;
    setIsSyncing(true);
    try {
      const res = await apiFetch<any>('/properties/centris-sync', {
        method: 'POST',
        body: JSON.stringify({ mls_number: mlsInput })
      });
      if (res.data?.property) {
        setProperties(prev => [res.data.property, ...prev.filter(p => p.mls_number !== mlsInput)]);
        setIsSyncModalOpen(false);
        setMlsInput('');
      }
    } catch (err: any) {
      alert(err.message || 'Erreur lors de la synchronisation');
    }
    setIsSyncing(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Retirer cette propriété ?')) return;
    try {
      await apiFetch(`/properties/${id}`, { method: 'DELETE' });
      setProperties(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const filtered = properties.filter(p => 
    p.title.toLowerCase().includes(search.toLowerCase()) || 
    p.mls_number.includes(search) ||
    p.city.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppLayout title="Inventaire & Propriétés">
      <div className="flex flex-col md:flex-row gap-4 justify-between items-center mb-6">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16} />
          <Input 
            placeholder="Rechercher par MLS, titre, ville..." 
            value={search} 
            onChange={(e: any) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-3 w-full md:w-auto">
          <Button variant="secondary" onClick={() => setIsSyncModalOpen(true)} className="flex-1 md:flex-none gap-2">
            <RefreshCw size={16} /> Sync Centris
          </Button>
          <Button className="flex-1 md:flex-none gap-2">
            <Plus size={16} /> Ajouter manuellement
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] h-80 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-[var(--bg-surface)] rounded-xl border border-dashed border-[var(--border-strong)]">
          <Home size={48} className="mx-auto text-[var(--text-muted)] mb-4 opacity-50" />
          <h3 className="text-lg font-bold mb-2">Aucune propriété trouvée</h3>
          <p className="text-[var(--text-secondary)] mb-6 max-w-md mx-auto">
            Synchronisez votre inventaire depuis Centris avec vos numéros MLS, ou ajoutez vos mandats exclusifs manuellement.
          </p>
          <Button onClick={() => setIsSyncModalOpen(true)} className="gap-2 mx-auto">
            <RefreshCw size={16} /> Importer depuis Centris
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filtered.map(property => (
            <Card key={property.id} className="overflow-hidden flex flex-col hover:border-[var(--brand-primary)]/50 transition-colors group">
              <div className="relative aspect-video bg-[var(--bg-subtle)]">
                {property.image_url ? (
                  <img src={property.image_url} alt={property.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)]">
                    <Home size={32} />
                  </div>
                )}
                <div className="absolute top-3 left-3">
                  <Badge color={property.status === 'active' ? 'var(--success)' : 'var(--text-muted)'}>
                    {property.status === 'active' ? 'À vendre' : property.status}
                  </Badge>
                </div>
                <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-md text-white text-xs font-bold px-2 py-1 rounded">
                  MLS: {property.mls_number || 'N/A'}
                </div>
              </div>
              <div className="p-4 flex flex-col flex-1">
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-bold text-lg line-clamp-1" title={property.title}>{property.title}</h3>
                </div>
                <p className="text-[var(--brand-primary)] font-bold text-lg mb-2">
                  {property.price.toLocaleString('fr-CA')} $
                </p>
                <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] mb-4">
                  <MapPin size={12} /> {property.city}
                </div>
                
                <div className="grid grid-cols-3 gap-2 border-t border-[var(--border-subtle)] pt-4 mt-auto">
                  <div className="flex items-center gap-1.5 text-xs font-medium" title="Chambres">
                    <Bed size={14} className="text-[var(--text-muted)]" /> {property.bedrooms}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-medium" title="Salles de bain">
                    <Bath size={14} className="text-[var(--text-muted)]" /> {property.bathrooms}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-medium" title="Superficie">
                    <Expand size={14} className="text-[var(--text-muted)]" /> {property.area_sqft} pc
                  </div>
                </div>

                {/* Actions overlay */}
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(property.id); }} className="p-1.5 bg-black/60 backdrop-blur-md text-red-400 hover:text-red-300 rounded">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={isSyncModalOpen} onOpenChange={() => setIsSyncModalOpen(false)} title="Synchroniser avec Centris">
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Entrez le numéro MLS d'une propriété active pour importer ses photos, son prix et sa description automatiquement.
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--text-secondary)]">Numéro MLS (ex: 12345678)</label>
            <Input 
              value={mlsInput} 
              onChange={(e: any) => setMlsInput(e.target.value)} 
              placeholder="12345678"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <Button variant="secondary" onClick={() => setIsSyncModalOpen(false)}>Annuler</Button>
            <Button onClick={handleSync} disabled={!mlsInput || isSyncing}>
              {isSyncing ? 'Synchronisation...' : 'Importer'}
            </Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}