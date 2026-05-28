import { useState, useEffect, useCallback } from 'react';
import {
  Phone,
  PhoneOff,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  X,
  Loader2,
  User,
  Mail,
  PhoneCall,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';
import { cn } from '../../lib/cn';
import {
  getDialerCampaigns,
  getDialerCurrentLead,
  updateDialerCampaign,
  initiateOutboundCall,
  DialerCampaign,
} from '../../lib/api';

export interface FloatingDialerPanelProps {
  onClose?: () => void;
  className?: string;
}

export function FloatingDialerPanel({ onClose, className }: FloatingDialerPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [campaigns, setCampaigns] = useState<DialerCampaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<DialerCampaign | null>(null);
  const [currentLeadInfo, setCurrentLeadInfo] = useState<any>(null);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingLead, setLoadingLead] = useState(false);
  const [calling, setCalling] = useState(false);
  const [campaignCompleted, setCampaignCompleted] = useState(false);

  const toast = useToast();

  // Charger les campagnes disponibles au montage
  const fetchCampaigns = useCallback(async () => {
    setLoadingCampaigns(true);
    try {
      const res = await getDialerCampaigns();
      if (res.data) {
        // Filtrer les campagnes actives, en pause ou brouillon
        const filtered = res.data.filter(c => c.status !== 'completed');
        setCampaigns(filtered);
      } else if (res.error) {
        toast.error('Impossible de charger les campagnes.');
      }
    } catch {
      toast.error('Erreur réseau lors du chargement des campagnes.');
    } finally {
      setLoadingCampaigns(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  // Charger le lead courant pour la campagne sélectionnée
  const fetchLead = useCallback(
    async (campaignId: string, direction: 'current' | 'next' | 'prev' = 'current') => {
      setLoadingLead(true);
      try {
        const res = await getDialerCurrentLead(campaignId, direction);
        if (res.data) {
          if (res.data.campaign_completed) {
            setCampaignCompleted(true);
            setCurrentLeadInfo(null);
            if (selectedCampaign) {
              setSelectedCampaign({ ...selectedCampaign, status: 'completed', current_index: res.data.current_index });
            }
          } else {
            setCampaignCompleted(false);
            setCurrentLeadInfo(res.data);
            if (selectedCampaign) {
              setSelectedCampaign({
                ...selectedCampaign,
                status: 'active',
                current_index: res.data.current_index,
              });
            }
          }
        } else if (res.error) {
          toast.error(res.error);
        }
      } catch {
        toast.error('Erreur réseau lors du chargement du prospect.');
      } finally {
        setLoadingLead(false);
      }
    },
    [selectedCampaign, toast]
  );

  const handleSelectCampaign = (campaign: DialerCampaign) => {
    setSelectedCampaign(campaign);
    setCampaignCompleted(false);
    fetchLead(campaign.id, 'current');
  };

  const handleNext = useCallback(() => {
    if (!selectedCampaign || calling) return;
    fetchLead(selectedCampaign.id, 'next');
  }, [selectedCampaign, calling, fetchLead]);

  const handlePrev = useCallback(() => {
    if (!selectedCampaign || calling) return;
    fetchLead(selectedCampaign.id, 'prev');
  }, [selectedCampaign, calling, fetchLead]);

  const handleSkip = useCallback(() => {
    handleNext();
  }, [handleNext]);

  const handleTogglePause = useCallback(async () => {
    if (!selectedCampaign) return;
    const isCurrentlyActive = selectedCampaign.status === 'active';
    const newStatus = isCurrentlyActive ? 'paused' : 'active';

    try {
      const res = await updateDialerCampaign(selectedCampaign.id, { status: newStatus });
      if (res.data) {
        setSelectedCampaign(res.data);
        toast.success(newStatus === 'paused' ? 'Campagne mise en pause.' : 'Campagne reprise.');
      } else if (res.error) {
        toast.error(res.error);
      }
    } catch {
      toast.error('Erreur réseau lors du changement d\'état.');
    }
  }, [selectedCampaign, toast]);

  // Lancer l'appel via Twilio (click-to-call)
  const handleCall = async () => {
    if (!currentLeadInfo?.lead || calling) return;
    const phone = currentLeadInfo.lead.phone;
    if (!phone) {
      toast.error('Ce prospect n\'a aucun numéro de téléphone renseigné.');
      return;
    }

    setCalling(true);
    try {
      const res = await initiateOutboundCall({
        to: phone,
        lead_id: currentLeadInfo.lead.id,
        record: false, // modifiable si besoin
      });

      if (res.error) {
        toast.error('L\'appel n\'a pas pu être initié.');
        setCalling(false);
      } else if (res.data) {
        toast.success(res.data.mock ? 'Appel simulé initié.' : 'Appel en cours...');
      }
    } catch {
      toast.error('Erreur réseau lors du lancement de l\'appel.');
      setCalling(false);
    }
  };

  // Simuler le raccrochage de l'appel
  const handleHangup = () => {
    setCalling(false);
    toast.info('Appel terminé.');
  };

  // Enregistrer les raccourcis clavier
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && selectedCampaign) {
        if (e.key === 'n' || e.key === 'N') {
          e.preventDefault();
          handleNext();
        } else if (e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          handleTogglePause();
        } else if (e.key === 's' || e.key === 'S') {
          e.preventDefault();
          handleSkip();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCampaign, handleNext, handleTogglePause, handleSkip]);

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        'fixed bottom-6 right-6 z-50 flex flex-col rounded-2xl border border-[var(--border)] shadow-2xl',
        'bg-[var(--bg-surface)] backdrop-blur-md transition-all duration-300 w-96 max-h-[600px]',
        className
      )}
      data-testid="floating-dialer-panel"
    >
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] bg-gradient-to-r from-cyan-900 to-cyan-800 text-white rounded-t-2xl">
        <div className="flex items-center gap-2">
          <Icon as={PhoneCall} size="sm" className="text-cyan-300 animate-pulse" />
          <span className="font-semibold tracking-wide text-sm">INTRALYS DIALER</span>
        </div>
        <button
          onClick={onClose || (() => setIsOpen(false))}
          className="text-cyan-200 hover:text-white transition-colors duration-150"
          aria-label="Fermer le dialer"
        >
          <Icon as={X} size="sm" />
        </button>
      </header>

      {/* Corps */}
      <div className="flex flex-col flex-1 overflow-y-auto p-5 gap-4 min-h-[300px]">
        {!selectedCampaign ? (
          /* Écran de sélection de campagne */
          <div className="flex flex-col gap-4 py-6">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Sélectionner une campagne d'appels
            </h3>
            {loadingCampaigns ? (
              <div className="flex justify-center py-8">
                <Icon as={Loader2} className="animate-spin text-[var(--primary)]" size="lg" />
              </div>
            ) : campaigns.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)] text-center py-6">
                Aucune campagne d'appels active trouvée.
              </p>
            ) : (
              <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
                {campaigns.map(c => (
                  <button
                    key={c.id}
                    onClick={() => handleSelectCampaign(c)}
                    className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] hover:bg-[var(--bg-hover)] text-left transition-colors duration-150"
                  >
                    <div>
                      <div className="text-xs font-semibold text-[var(--text-primary)]">{c.name}</div>
                      <div className="text-[10px] text-[var(--text-secondary)]">
                        Index : {c.current_index}
                      </div>
                    </div>
                    <span
                      className={cn(
                        'text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full',
                        c.status === 'active'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      )}
                    >
                      {c.status}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : campaignCompleted ? (
          /* Campagne complétée */
          <div className="flex flex-col items-center justify-center text-center py-10 gap-3">
            <div className="text-4xl">🎉</div>
            <h4 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider">
              Campagne complétée
            </h4>
            <p className="text-xs text-[var(--text-secondary)] px-4">
              Félicitations, vous avez contacté tous les prospects de la campagne{' '}
              <span className="font-semibold">"{selectedCampaign.name}"</span> !
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSelectedCampaign(null)}
              className="mt-2"
            >
              Retour aux campagnes
            </Button>
          </div>
        ) : loadingLead ? (
          /* Chargement du prospect courant */
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <Icon as={Loader2} className="animate-spin text-[var(--primary)]" size="lg" />
            <span className="text-xs text-[var(--text-secondary)]">Chargement du prospect...</span>
          </div>
        ) : currentLeadInfo ? (
          /* Campagne en cours : Affichage du lead + script */
          <div className="flex flex-col gap-4">
            {/* Infos Lead */}
            <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-cyan-100 flex items-center justify-center text-cyan-800">
                  <Icon as={User} size="xs" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[var(--text-primary)]">
                    {currentLeadInfo.lead.name}
                  </div>
                  <div className="text-[10px] text-[var(--text-secondary)] flex items-center gap-1">
                    <Icon as={Mail} size="xs" /> {currentLeadInfo.lead.email}
                  </div>
                </div>
              </div>
              {currentLeadInfo.lead.phone && (
                <div className="text-xs font-mono text-[var(--text-secondary)] mt-1">
                  📞 {currentLeadInfo.lead.phone}
                </div>
              )}
              <div className="flex justify-between items-center text-[10px] text-[var(--text-secondary)] border-t border-[var(--border)] pt-2 mt-1">
                <span>Prospect {currentLeadInfo.current_index + 1} / {currentLeadInfo.total_leads}</span>
                <span className="capitalize px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] font-semibold">
                  {selectedCampaign.status}
                </span>
              </div>
            </div>

            {/* Script de vente */}
            {currentLeadInfo.script && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                  Script de vente
                </span>
                <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] text-xs text-[var(--text-primary)] max-h-40 overflow-y-auto leading-relaxed prose prose-cyan">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {currentLeadInfo.script}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Erreur ou état vide */
          <p className="text-xs text-[var(--text-secondary)] text-center py-10">
            Aucun prospect disponible.
          </p>
        )}
      </div>

      {/* Footer / Contrôles */}
      {selectedCampaign && !campaignCompleted && currentLeadInfo && (
        <footer className="p-4 border-t border-[var(--border)] bg-[var(--bg-subtle)] rounded-b-2xl flex flex-col gap-3">
          {/* Actions d'appels */}
          <div className="flex items-center gap-2">
            {!calling ? (
              <Button
                variant="primary"
                onClick={handleCall}
                disabled={!currentLeadInfo.lead.phone}
                fullWidth
                leftIcon={<Icon as={Phone} size="sm" />}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-md shadow-emerald-900/10"
              >
                Appeler
              </Button>
            ) : (
              <Button
                variant="danger"
                onClick={handleHangup}
                fullWidth
                leftIcon={<Icon as={PhoneOff} size="sm" />}
                className="font-semibold shadow-md shadow-red-950/10 animate-pulse"
              >
                Raccrocher
              </Button>
            )}
          </div>

          {/* Navigation de la file */}
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handlePrev}
              disabled={currentLeadInfo.current_index === 0 || calling}
              leftIcon={<Icon as={SkipBack} size="xs" />}
            >
              Précédent
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={handleTogglePause}
              leftIcon={<Icon as={selectedCampaign.status === 'active' ? Pause : Play} size="xs" />}
            >
              {selectedCampaign.status === 'active' ? 'Pause' : 'Reprendre'}
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={handleNext}
              disabled={calling}
              rightIcon={<Icon as={SkipForward} size="xs" />}
            >
              Sauter
            </Button>
          </div>

          {/* Aide Raccourcis */}
          <div className="flex justify-between text-[9px] text-[var(--text-secondary)] border-t border-[var(--border)] pt-2 mt-1">
            <span>Alt+N : Suivant</span>
            <span>Alt+P : Pause/Reprendre</span>
            <span>Alt+S : Sauter</span>
          </div>
        </footer>
      )}
    </div>
  );
}

export default FloatingDialerPanel;
