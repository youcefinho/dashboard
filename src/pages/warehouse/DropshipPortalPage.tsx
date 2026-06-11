import React, { useState, useEffect } from 'react';
import { t } from '@/lib/i18n';
import { listPortalDropshipOrders, shipPortalDropshipOrder, DropshipOrder } from '../../lib/api';
import { Truck, CheckCircle2, Clock, MapPin, Phone, Mail, FileText, Search, Package, AlertCircle, X } from 'lucide-react';
import { toast } from 'sonner';

export default function DropshipPortalPage() {
  const [orders, setOrders] = useState<DropshipOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'pending' | 'shipped'>('pending');

  // Modale d'expédition
  const [shippingOrder, setShippingOrder] = useState<DropshipOrder | null>(null);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const res = await listPortalDropshipOrders();
      if (res.data) {
        setOrders(res.data);
      }
    } catch {
      toast.error('Erreur lors du chargement des commandes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const handleShipOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shippingOrder || !trackingNumber.trim()) return;

    setSubmitting(true);
    try {
      const res = await shipPortalDropshipOrder(shippingOrder.id, trackingNumber);
      if (res.data?.success) {
        toast.success('Commande marquée comme expédiée !');
        // Mettre à jour localement
        setOrders(orders.map(o => o.id === shippingOrder.id ? { ...o, status: 'shipped', tracking_number: trackingNumber } : o));
        setShippingOrder(null);
        setTrackingNumber('');
      }
    } catch {
      toast.error('Erreur lors de la validation de l’expédition');
    } finally {
      setSubmitting(false);
    }
  };

  // Filtrage des commandes
  const filteredOrders = orders.filter(order => {
    const isPending = order.status !== 'shipped' && order.status !== 'delivered';
    const matchesTab = activeTab === 'pending' ? isPending : !isPending;

    const query = searchTerm.toLowerCase();
    const matchesSearch = 
      (order.id?.toLowerCase().includes(query)) ||
      (order.supplier_order_ref?.toLowerCase().includes(query)) ||
      (order.tracking_number?.toLowerCase().includes(query)) ||
      (order.shipping_address?.toLowerCase().includes(query)) ||
      (order.contact_email?.toLowerCase().includes(query));

    return matchesTab && matchesSearch;
  });

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24 min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-indigo-900 to-slate-900 text-white p-8 rounded-3xl shadow-xl">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold uppercase tracking-wider">
              {t('warehouse.portal.title') || 'Portail Fournisseur'}
            </h1>
            <p className="text-sm text-indigo-200 mt-1.5 max-w-xl">
              Bienvenue sur votre portail d’expédition. Suivez vos commandes en attente et validez les livraisons avec vos numéros de suivi.
            </p>
          </div>
          <div className="flex items-center gap-4 bg-[var(--bg-surface)]/10 px-4 py-3 rounded-2xl backdrop-blur-md border border-white/10">
            <Package size={24} className="text-indigo-300 animate-bounce" />
            <div>
              <div className="text-xs uppercase tracking-widest text-indigo-200 font-bold">Commandes à expédier</div>
              <div className="text-xl font-black">{orders.filter(o => o.status !== 'shipped' && o.status !== 'delivered').length}</div>
            </div>
          </div>
        </div>

        {/* Barre d'outils et de navigation */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-[var(--bg-surface)] dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          {/* Onglets */}
          <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-xl w-full sm:w-auto">
            <button
              onClick={() => setActiveTab('pending')}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === 'pending'
                  ? 'bg-[var(--bg-surface)] dark:bg-slate-900 text-indigo-600 dark:text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
              }`}
            >
              <Clock size={16} />
              {t('warehouse.portal.orders_to_ship') || 'À expédier'}
            </button>
            <button
              onClick={() => setActiveTab('shipped')}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === 'shipped'
                  ? 'bg-[var(--bg-surface)] dark:bg-slate-900 text-indigo-600 dark:text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
              }`}
            >
              <CheckCircle2 size={16} />
              {t('warehouse.portal.orders_shipped') || 'Expédiées'}
            </button>
          </div>

          {/* Recherche */}
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3.5 top-3 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Rechercher une commande, adresse, courriel..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Liste des commandes */}
        {filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 bg-[var(--bg-surface)] dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl text-center shadow-xs">
            <Truck size={48} className="text-slate-300 dark:text-slate-700 mb-4" />
            <p className="text-slate-500 dark:text-slate-400 font-medium">
              {t('warehouse.portal.no_orders') || 'Aucune commande trouvée.'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredOrders.map((order) => (
              <div
                key={order.id}
                className="bg-[var(--bg-surface)] dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xs hover:shadow-md transition-all space-y-6"
              >
                
                {/* Header commande */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Réf. Interne</span>
                    <h3 className="text-sm font-black uppercase text-indigo-600 dark:text-indigo-400">
                      {order.id}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Reçue le {new Date(order.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {order.status === 'shipped' || order.status === 'delivered' ? (
                      <div className="flex flex-col items-end">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 rounded-full text-xs font-bold uppercase tracking-wider">
                          <CheckCircle2 size={12} />
                          Expédiée
                        </span>
                        {order.tracking_number && (
                          <span className="text-xs text-slate-500 mt-1 font-mono">
                            Suivi: {order.tracking_number}
                          </span>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setShippingOrder(order);
                          setTrackingNumber('');
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all text-xs uppercase tracking-widest shadow-sm cursor-pointer"
                      >
                        <Truck size={14} />
                        {t('warehouse.portal.ship_action') || 'Expédier'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Contenu : Items + Détails de livraison */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  
                  {/* Articles de la commande */}
                  <div className="lg:col-span-2 space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                      <Package size={14} />
                      Articles à expédier
                    </h4>
                    <div className="space-y-3">
                      {order.items?.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-100 dark:border-slate-800"
                        >
                          <div>
                            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                              {item.name}
                            </p>
                            {item.supplier_sku && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                SKU Fournisseur: <span className="font-mono">{item.supplier_sku}</span>
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Quantité</span>
                            <span className="text-md font-black text-slate-800 dark:text-slate-100">
                              × {item.quantity}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Détails de livraison */}
                  <div className="space-y-4 bg-slate-50/50 dark:bg-slate-900/40 p-6 rounded-2xl border border-slate-100 dark:border-slate-800">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                      <MapPin size={14} />
                      Détails de livraison
                    </h4>
                    
                    <div className="space-y-3.5 text-sm">
                      <div className="flex items-start gap-2.5">
                        <MapPin size={16} className="text-slate-400 shrink-0 mt-0.5" />
                        <span className="text-slate-700 dark:text-slate-300 leading-snug">
                          {order.shipping_address || 'Aucune adresse fournie'}
                        </span>
                      </div>

                      {order.contact_email && (
                        <div className="flex items-center gap-2.5">
                          <Mail size={16} className="text-slate-400 shrink-0" />
                          <span className="text-slate-700 dark:text-slate-300 font-medium">
                            {order.contact_email}
                          </span>
                        </div>
                      )}

                      {order.contact_phone && (
                        <div className="flex items-center gap-2.5">
                          <Phone size={16} className="text-slate-400 shrink-0" />
                          <span className="text-slate-700 dark:text-slate-300 font-medium">
                            {order.contact_phone}
                          </span>
                        </div>
                      )}

                      {order.order_notes && (
                        <div className="mt-4 pt-3 border-t border-slate-200/50 dark:border-slate-800">
                          <div className="flex items-start gap-2.5 text-xs text-slate-500">
                            <FileText size={14} className="shrink-0 mt-0.5" />
                            <span>
                              <strong className="block uppercase tracking-wider text-slate-400 mb-0.5">Notes de livraison:</strong>
                              {order.order_notes}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              </div>
            ))}
          </div>
        )}

        {/* MODALE D'EXPÉDITION */}
        {shippingOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
            <div className="bg-[var(--bg-surface)] dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-xl animate-in fade-in zoom-in-95 duration-150">
              <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-950/20">
                <h3 className="font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Truck size={18} className="text-indigo-600" />
                  Confirmer l’expédition
                </h3>
                <button
                  onClick={() => setShippingOrder(null)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg p-1.5 cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleShipOrder} className="p-6 space-y-5">
                <div className="bg-indigo-50/30 dark:bg-indigo-950/10 p-4 rounded-xl border border-indigo-100/50 dark:border-indigo-900/20 flex gap-3 text-xs text-indigo-800 dark:text-indigo-300">
                  <AlertCircle size={18} className="shrink-0 mt-0.5" />
                  <div>
                    En validant l’expédition, vous informez le marchand que la commande est en cours de transit. Un numéro de suivi valide est obligatoire pour rassurer l’acheteur final.
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                    {t('warehouse.portal.tracking_number') || 'Numéro de suivi'} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={trackingNumber}
                    onChange={(e) => setTrackingNumber(e.target.value)}
                    placeholder="Ex: USPS-1Z999AA10123456784"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>

                <div className="flex gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShippingOrder(null)}
                    className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-medium text-sm transition-all cursor-pointer"
                  >
                    {t('mfa.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl font-medium text-sm transition-all flex justify-center items-center cursor-pointer"
                  >
                    {submitting ? 'Validation...' : (t('warehouse.portal.confirm_ship') || 'Confirmer')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
