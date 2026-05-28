import React, { useState, useEffect } from 'react';
import { t } from '@/lib/i18n';
import {
  listDropshipPartners,
  createDropshipPartner,
  updateDropshipPartner,
  deleteDropshipPartner,
  listDropshipSuppliers,
  updateDropshipSupplier,
  DropshipPartner,
  DropshipSupplier,
} from '../../lib/api';
import { Plus, Edit2, Trash2, Check, X, Link, Link2Off, Building2, Mail } from 'lucide-react';
import { toast } from 'sonner';

export function DropshipPartnersTab() {
  const [partners, setPartners] = useState<DropshipPartner[]>([]);
  const [suppliers, setSuppliers] = useState<DropshipSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPartner, setEditingPartner] = useState<DropshipPartner | null>(null);
  
  // Formulaire Partenaire
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('active');

  // État de liaison d'un fournisseur
  const [linkingPartnerId, setLinkingPartnerId] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [partnersRes, suppliersRes] = await Promise.all([
        listDropshipPartners(),
        listDropshipSuppliers(),
      ]);

      if (partnersRes.data) setPartners(partnersRes.data);
      if (suppliersRes.data) setSuppliers(suppliersRes.data);
    } catch (err) {
      toast.error('Erreur lors du chargement des données');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSavePartner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim() || !email.trim()) {
      toast.error('Veuillez remplir tous les champs obligatoires');
      return;
    }

    try {
      if (editingPartner) {
        const res = await updateDropshipPartner(editingPartner.id, {
          company_name: companyName,
          email,
          status,
        });
        if (res.data) {
          toast.success('Partenaire mis à jour avec succès');
          setPartners(partners.map(p => p.id === editingPartner.id ? res.data! : p));
        }
      } else {
        const res = await createDropshipPartner({
          company_name: companyName,
          email,
          status,
        });
        if (res.data) {
          toast.success('Partenaire créé avec succès');
          setPartners([...partners, res.data]);
        }
      }
      closeModal();
    } catch {
      toast.error('Une erreur est survenue lors de l’enregistrement');
    }
  };

  const handleDeletePartner = async (id: string) => {
    if (!window.confirm('Es-tu sûr de vouloir supprimer ce partenaire ? Cela déliara tous les utilisateurs et fournisseurs associés.')) {
      return;
    }

    try {
      const res = await deleteDropshipPartner(id);
      if (res.data?.deleted) {
        toast.success('Partenaire supprimé avec succès');
        setPartners(partners.filter(p => p.id !== id));
        // Mettre à jour localement les fournisseurs liés
        setSuppliers(suppliers.map(s => s.dropship_partner_id === id ? { ...s, dropship_partner_id: null } : s));
      }
    } catch {
      toast.error('Erreur lors de la suppression du partenaire');
    }
  };

  const handleLinkSupplier = async () => {
    if (!linkingPartnerId || !selectedSupplierId) return;

    try {
      const supplier = suppliers.find(s => s.id === selectedSupplierId);
      if (!supplier) return;

      const res = await updateDropshipSupplier(selectedSupplierId, {
        dropship_partner_id: linkingPartnerId,
      });

      if (res.data) {
        toast.success('Fournisseur lié avec succès');
        setSuppliers(suppliers.map(s => s.id === selectedSupplierId ? { ...s, dropship_partner_id: linkingPartnerId } : s));
        setLinkingPartnerId(null);
        setSelectedSupplierId('');
      }
    } catch {
      toast.error('Erreur lors de la liaison du fournisseur');
    }
  };

  const handleUnlinkSupplier = async (supplierId: string) => {
    try {
      const res = await updateDropshipSupplier(supplierId, {
        dropship_partner_id: null,
      });

      if (res.data) {
        toast.success('Fournisseur délié avec succès');
        setSuppliers(suppliers.map(s => s.id === supplierId ? { ...s, dropship_partner_id: null } : s));
      }
    } catch {
      toast.error('Erreur lors du déliement du fournisseur');
    }
  };

  const openCreateModal = () => {
    setEditingPartner(null);
    setCompanyName('');
    setEmail('');
    setStatus('active');
    setShowCreateModal(true);
  };

  const openEditModal = (partner: DropshipPartner) => {
    setEditingPartner(partner);
    setCompanyName(partner.company_name);
    setEmail(partner.email);
    setStatus(partner.status);
    setShowCreateModal(true);
  };

  const closeModal = () => {
    setShowCreateModal(false);
    setEditingPartner(null);
    setCompanyName('');
    setEmail('');
    setStatus('active');
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-bold tracking-widest uppercase text-slate-800 dark:text-slate-100">
            {t('warehouse.partners.title')}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t('warehouse.partners.description')}
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-all text-sm uppercase tracking-wider shadow-sm cursor-pointer"
        >
          <Plus size={16} />
          {t('warehouse.partners.create')}
        </button>
      </div>

      {partners.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-center">
          <Building2 size={48} className="text-slate-400 mb-4 animate-pulse" />
          <p className="text-slate-500 dark:text-slate-400 font-medium">
            {t('warehouse.partners.empty')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {partners.map((partner) => {
            const linkedSuppliers = suppliers.filter(s => s.dropship_partner_id === partner.id);
            const availableSuppliers = suppliers.filter(s => !s.dropship_partner_id);

            return (
              <div
                key={partner.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div className="space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-md font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
                        {partner.company_name}
                      </h4>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 mt-2 rounded-full text-xs font-semibold uppercase tracking-wider ${
                        partner.status === 'active' 
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' 
                          : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                      }`}>
                        {partner.status === 'active' ? 'Actif' : 'Inactif'}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEditModal(partner)}
                        className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-all cursor-pointer"
                        title="Modifier"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => handleDeletePartner(partner.id)}
                        className="p-2 text-slate-500 hover:text-rose-600 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-all cursor-pointer"
                        title="Supprimer"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <Mail size={16} className="shrink-0" />
                    <span>{partner.email}</span>
                  </div>

                  <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
                        Fournisseurs associés ({linkedSuppliers.length})
                      </span>
                      {linkingPartnerId !== partner.id && availableSuppliers.length > 0 && (
                        <button
                          onClick={() => {
                            setLinkingPartnerId(partner.id);
                            setSelectedSupplierId(availableSuppliers[0]?.id || '');
                          }}
                          className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-indigo-600 hover:text-indigo-700 cursor-pointer"
                        >
                          <Link size={12} />
                          Associer
                        </button>
                      )}
                    </div>

                    {linkingPartnerId === partner.id && (
                      <div className="flex gap-2 mb-3 bg-slate-50 dark:bg-slate-950 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800">
                        <select
                          value={selectedSupplierId}
                          onChange={(e) => setSelectedSupplierId(e.target.value)}
                          className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1 text-xs dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                          {availableSuppliers.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={handleLinkSupplier}
                          className="p-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg cursor-pointer"
                          title="Confirmer"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          onClick={() => setLinkingPartnerId(null)}
                          className="p-1 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg cursor-pointer"
                          title="Annuler"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}

                    {linkedSuppliers.length === 0 ? (
                      <p className="text-xs italic text-slate-400 py-1">
                        Aucun fournisseur lié.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {linkedSuppliers.map((sup) => (
                          <div
                            key={sup.id}
                            className="flex justify-between items-center bg-slate-50 dark:bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-100 dark:border-slate-800"
                          >
                            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                              {sup.name}
                            </span>
                            <button
                              onClick={() => handleUnlinkSupplier(sup.id)}
                              className="text-slate-400 hover:text-rose-600 p-0.5 rounded transition-all cursor-pointer"
                              title="Délier le fournisseur"
                            >
                              <Link2Off size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODALE DE CRÉATION / MODIFICATION */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-950/20">
              <h3 className="font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
                {editingPartner ? 'Modifier le partenaire' : 'Créer un partenaire'}
              </h3>
              <button
                onClick={closeModal}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg p-1.5 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSavePartner} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                  {t('warehouse.partners.company_name')} <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Ex: Grossiste Nord-Est Inc."
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                  {t('warehouse.partners.email')} <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Ex: commandes@grossistenordest.com"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                  {t('warehouse.partners.status')}
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                >
                  <option value="active">Actif</option>
                  <option value="inactive">Inactif</option>
                </select>
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-medium text-sm transition-all cursor-pointer"
                >
                  {t('mfa.cancel')}
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium text-sm transition-all cursor-pointer"
                >
                  Confirmer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
