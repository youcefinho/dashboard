import { useState, useEffect } from 'react';
import {
  Card,
  Button,
  Input,
  Tag,
  useToast,
  useConfirm,
  Skeleton,
  Icon,
  Switch,
} from '@/components/ui';
import {
  getVirtualPhoneNumbers,
  searchVirtualPhoneNumbers,
  purchaseVirtualPhoneNumber,
  releaseVirtualPhoneNumber,
  getPhoneRoutingRules,
  savePhoneRoutingRules,
  getTeamUsers,
  getIvrMenus,
  type VirtualPhoneNumber,
  type PhoneRoutingRule,
} from '@/lib/api';
import {
  Phone,
  Plus,
  Trash2,
  Search,
  Save,
  ArrowUp,
  ArrowDown,
  Settings2,
} from 'lucide-react';
import { t } from '@/lib/i18n';

export function PhoneNumbersSettings() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  // États principaux
  const [numbers, setNumbers] = useState<VirtualPhoneNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNumber, setSelectedNumber] = useState<VirtualPhoneNumber | null>(null);

  // États recherche & achat
  const [searchAreaCode, setSearchAreaCode] = useState('450');
  const [searching, setSearching] = useState(false);
  const [availableNumbers, setAvailableNumbers] = useState<any[]>([]);
  const [buyingNumber, setBuyingNumber] = useState<string | null>(null);

  // États routage
  const [rules, setRules] = useState<Partial<PhoneRoutingRule>[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [savingRules, setSavingRules] = useState(false);

  // Listes de cibles de redirection
  const [users, setUsers] = useState<any[]>([]);
  const [ivrMenus, setIvrMenus] = useState<any[]>([]);

  // Charger les données au montage
  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const numsRes = await getVirtualPhoneNumbers();
      if (numsRes.data) {
        setNumbers(numsRes.data);
      } else if (numsRes.error) {
        toastError(numsRes.error);
      }

      // Charger les cibles possibles pour le routage
      const [usersRes, ivrRes] = await Promise.all([
        getTeamUsers(),
        getIvrMenus(),
      ]);

      if (usersRes.data) setUsers(usersRes.data);
      if (ivrRes.data) setIvrMenus(ivrRes.data);

    } catch (err: any) {
      toastError(`Erreur lors du chargement : ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Charger les règles d'un numéro sélectionné
  const handleSelectNumber = async (num: VirtualPhoneNumber) => {
    setSelectedNumber(num);
    setLoadingRules(true);
    try {
      const res = await getPhoneRoutingRules(num.id);
      if (res.data) {
        const mapped = res.data.map(r => ({
          ...r,
          record_call: r.record_call ?? 0,
          play_consent_msg: r.play_consent_msg ?? 1,
        }));
        setRules(mapped);
      } else if (res.error) {
        toastError(res.error);
      }
    } catch (err: any) {
      toastError(`Erreur de chargement des règles : ${err.message}`);
    } finally {
      setLoadingRules(false);
    }
  };

  // Rechercher des numéros
  const handleSearch = async () => {
    if (!searchAreaCode.trim()) return;
    setSearching(true);
    setAvailableNumbers([]);
    try {
      const res = await searchVirtualPhoneNumbers(searchAreaCode.trim());
      if (res.data) {
        setAvailableNumbers(res.data);
        if (res.data.length === 0) {
          toastError(t('telephony.phoneNumbers.noResult'));
        }
      } else if (res.error) {
        toastError(res.error);
      }
    } catch (err: any) {
      toastError(`Erreur recherche : ${err.message}`);
    } finally {
      setSearching(false);
    }
  };

  // Provisionner un numéro
  const handlePurchase = async (num: any) => {
    setBuyingNumber(num.phone_number);
    try {
      const res = await purchaseVirtualPhoneNumber({
        phone_number: num.phone_number,
        friendly_name: num.friendly_name,
      });

      if (res.data) {
        success(t('telephony.phoneNumbers.purchaseSuccess'));
        setAvailableNumbers(prev => prev.filter(n => n.phone_number !== num.phone_number));
        loadInitialData();
      } else if (res.error) {
        toastError(res.error);
      }
    } catch (err: any) {
      toastError(`Erreur d'achat : ${err.message}`);
    } finally {
      setBuyingNumber(null);
    }
  };

  // Libérer un numéro
  const handleRelease = async (num: VirtualPhoneNumber) => {
    const ok = await confirm({
      title: t('telephony.phoneNumbers.releaseConfirmTitle'),
      description: `${t('telephony.phoneNumbers.releaseConfirmDesc')} (${num.friendly_name})`,
      danger: true,
    });
    if (!ok) return;

    try {
      const res = await releaseVirtualPhoneNumber(num.id);
      if (res.data?.success) {
        success(t('telephony.phoneNumbers.releaseSuccess'));
        if (selectedNumber?.id === num.id) {
          setSelectedNumber(null);
          setRules([]);
        }
        loadInitialData();
      } else if (res.error) {
        toastError(res.error);
      }
    } catch (err: any) {
      toastError(`Erreur de libération : ${err.message}`);
    }
  };

  // Ajouter une règle de routage
  const handleAddRule = () => {
    const newPriority = rules.length + 1;
    const newRule: Partial<PhoneRoutingRule> = {
      priority: newPriority,
      condition_type: 'all',
      condition_value: '',
      target_type: 'forward',
      target_id: '',
      record_call: 0,
      play_consent_msg: 1,
    };
    setRules([...rules, newRule]);
  };

  // Supprimer une règle de routage
  const handleRemoveRule = (index: number) => {
    const updated = rules.filter((_, i) => i !== index).map((r, i) => ({
      ...r,
      priority: i + 1,
    }));
    setRules(updated);
  };

  // Modifier une règle
  const handleUpdateRule = (index: number, key: keyof PhoneRoutingRule, val: any) => {
    const updated = [...rules];
    updated[index] = { ...updated[index], [key]: val };
    
    // Si on change de type de cible, réinitialiser la cible id
    if (key === 'target_type') {
      updated[index]!.target_id = '';
    }

    setRules(updated);
  };

  // Déplacer une règle pour réordonner (priorité)
  const handleMoveRule = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === rules.length - 1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const updated = [...rules];

    // Swap des éléments
    const temp = updated[index]!;
    updated[index] = updated[targetIndex]!;
    updated[targetIndex] = temp;

    // Réaffecter les priorités séquentiellement
    const finalRules = updated.map((r, i) => ({
      ...r,
      priority: i + 1,
    }));

    setRules(finalRules);
  };

  // Enregistrer les règles de routage
  const handleSaveRules = async () => {
    if (!selectedNumber) return;
    setSavingRules(true);
    try {
      const res = await savePhoneRoutingRules(selectedNumber.id, rules);
      if (res.data?.success) {
        success(t('telephony.phoneNumbers.rulesSaved'));
      } else if (res.error) {
        toastError(res.error);
      }
    } catch (err: any) {
      toastError(`Erreur d'enregistrement : ${err.message}`);
    } finally {
      setSavingRules(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Card className="p-6">
          <Skeleton className="h-6 w-1/3 mb-4" />
          <Skeleton className="h-20 w-full mb-4" />
          <Skeleton className="h-40 w-full" />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* SECTION RECHERCHE / ACHAT */}
      <Card className="p-6">
        <header className="mb-4">
          <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Icon as={Phone} size={18} className="text-[var(--primary)]" />
            {t('telephony.phoneNumbers.title')}
          </h3>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            {t('telephony.phoneNumbers.desc')}
          </p>
        </header>

        {/* Moteur de recherche */}
        <div className="flex gap-3 max-w-md items-end">
          <div className="flex-1">
            <Input
              label={t('telephony.phoneNumbers.searchPlaceholder')}
              placeholder="ex: 450"
              value={searchAreaCode}
              onChange={(e) => setSearchAreaCode(e.target.value)}
              maxLength={3}
            />
          </div>
          <Button onClick={handleSearch} disabled={searching} leftIcon={<Icon as={Search} size="sm" />}>
            {searching ? t('telephony.phoneNumbers.searching') : t('telephony.phoneNumbers.searchBtn')}
          </Button>
        </div>

        {/* Liste des numéros disponibles trouvés */}
        {availableNumbers.length > 0 && (
          <div className="mt-6 space-y-3">
            <h4 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
              {t('telephony.phoneNumbers.availableTitle')}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {availableNumbers.map((num) => (
                <div key={num.phone_number} className="flex items-center justify-between p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                  <div>
                    <p className="text-sm font-semibold">{num.friendly_name}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{num.rate_center}, {num.region}</p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => void handlePurchase(num)}
                    disabled={buyingNumber === num.phone_number}
                  >
                    {buyingNumber === num.phone_number ? t('telephony.phoneNumbers.buying') : t('telephony.phoneNumbers.buyBtn')}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* LISTE DES NUMÉROS CONFIGURÉS & ÉDITEUR DE ROUTAGE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Colonne gauche : Liste des numéros provisionnés */}
        <div className="lg:col-span-5 space-y-4">
          <Card className="p-5">
            <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider mb-4">
              Numéros configurés
            </h3>
            {numbers.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] text-center py-6">
                Aucun numéro de téléphone configuré.
              </p>
            ) : (
              <div className="space-y-2">
                {numbers.map((num) => {
                  const isSelected = selectedNumber?.id === num.id;
                  return (
                    <div
                      key={num.id}
                      onClick={() => void handleSelectNumber(num)}
                      className={`p-3 rounded-lg border transition-all cursor-pointer flex justify-between items-center ${
                        isSelected
                          ? 'border-[var(--primary)] bg-[var(--primary)]/5'
                          : 'border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)]'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold truncate text-[var(--text-primary)]">
                          {num.friendly_name}
                        </p>
                        <p className="text-[11px] text-[var(--text-muted)]">
                          {num.phone_number}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Tag variant="success" size="sm">Actif</Tag>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleRelease(num);
                          }}
                          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
                          title="Libérer le numéro"
                          aria-label="Libérer le numéro"
                        >
                          <Icon as={Trash2} size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Colonne droite : Règles de routage dynamique */}
        <div className="lg:col-span-7">
          {selectedNumber ? (
            <Card className="p-6 space-y-5">
              <header className="flex justify-between items-start gap-4">
                <div>
                  <h3 className="text-md font-bold text-[var(--text-primary)]">
                    {t('telephony.phoneNumbers.routingRules')} — {selectedNumber.friendly_name}
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] mt-1">
                    Définissez comment acheminer les appels vers ce numéro de téléphone.
                  </p>
                </div>
                <Button size="sm" onClick={handleAddRule} leftIcon={<Icon as={Plus} size="sm" />}>
                  {t('telephony.phoneNumbers.addRule')}
                </Button>
              </header>

              {loadingRules ? (
                <div className="space-y-3 py-6">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : rules.length === 0 ? (
                <div className="p-8 text-center text-[var(--text-muted)] border border-dashed border-[var(--border-subtle)] rounded-lg">
                  Aucune règle de routage définie. Ajoutez-en une pour router les appels.
                </div>
              ) : (
                <div className="space-y-4">
                  {rules.map((rule, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]/50 relative space-y-3"
                    >
                      {/* En-tête règle avec priorité, déplacement et suppression */}
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[var(--text-secondary)]">
                            # {rule.priority}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleMoveRule(idx, 'up')}
                            disabled={idx === 0}
                            className="p-1 rounded text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] disabled:opacity-30"
                            title="Monter"
                          >
                            <Icon as={ArrowUp} size={13} />
                          </button>
                          <button
                            onClick={() => handleMoveRule(idx, 'down')}
                            disabled={idx === rules.length - 1}
                            className="p-1 rounded text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] disabled:opacity-30"
                            title="Descendre"
                          >
                            <Icon as={ArrowDown} size={13} />
                          </button>
                          <button
                            onClick={() => handleRemoveRule(idx)}
                            className="ml-2 p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10"
                            title="Supprimer la règle"
                          >
                            <Icon as={Trash2} size={13} />
                          </button>
                        </div>
                      </div>

                      {/* Choix de la condition */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                            {t('telephony.phoneNumbers.ruleCondition')}
                          </label>
                          <select
                            value={rule.condition_type}
                            onChange={(e) => handleUpdateRule(idx, 'condition_type', e.target.value as any)}
                            className="w-full px-3 py-1.5 text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:border-[var(--primary)] focus:outline-none"
                          >
                            <option value="all">{t('telephony.phoneNumbers.ruleConditionAll')}</option>
                            <option value="area_code">{t('telephony.phoneNumbers.ruleConditionAreaCode')}</option>
                          </select>
                        </div>

                        {rule.condition_type === 'area_code' && (
                          <div>
                            <label className="block text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                              {t('telephony.phoneNumbers.ruleConditionValue')}
                            </label>
                            <Input
                              placeholder="ex: 450"
                              value={rule.condition_value || ''}
                              onChange={(e) => handleUpdateRule(idx, 'condition_value', e.target.value)}
                              maxLength={3}
                            />
                          </div>
                        )}
                      </div>

                      {/* Choix de la cible */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                            {t('telephony.phoneNumbers.ruleTarget')}
                          </label>
                          <select
                            value={rule.target_type}
                            onChange={(e) => handleUpdateRule(idx, 'target_type', e.target.value as any)}
                            className="w-full px-3 py-1.5 text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:border-[var(--primary)] focus:outline-none"
                          >
                            <option value="forward">{t('telephony.phoneNumbers.ruleTargetForward')}</option>
                            <option value="user">{t('telephony.phoneNumbers.ruleTargetUser')}</option>
                            <option value="ivr">{t('telephony.phoneNumbers.ruleTargetIvr')}</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                            {t('telephony.phoneNumbers.ruleTargetValue')}
                          </label>
                          {rule.target_type === 'user' ? (
                            <select
                              value={rule.target_id}
                              onChange={(e) => handleUpdateRule(idx, 'target_id', e.target.value)}
                              className="w-full px-3 py-1.5 text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:border-[var(--primary)] focus:outline-none"
                            >
                              <option value="">Sélectionner un agent</option>
                              {users.map((u) => (
                                <option key={u.id} value={u.id}>{u.name || u.email}</option>
                              ))}
                            </select>
                          ) : rule.target_type === 'ivr' ? (
                            <select
                              value={rule.target_id}
                              onChange={(e) => handleUpdateRule(idx, 'target_id', e.target.value)}
                              className="w-full px-3 py-1.5 text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:border-[var(--primary)] focus:outline-none"
                            >
                              <option value="">Sélectionner un menu IVR</option>
                              {ivrMenus.map((m) => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                            </select>
                          ) : (
                            <Input
                              placeholder="ex: +15145550100"
                              value={rule.target_id || ''}
                              onChange={(e) => handleUpdateRule(idx, 'target_id', e.target.value)}
                            />
                          )}
                        </div>
                      </div>

                      {/* Options d'enregistrement et de consentement Loi 25 / LCAP */}
                      <div className="flex flex-col sm:flex-row gap-4 pt-3 border-t border-[var(--border-subtle)]/40">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={rule.record_call === 1}
                            onCheckedChange={(checked) => handleUpdateRule(idx, 'record_call', checked ? 1 : 0)}
                            label="Enregistrer l'appel"
                            size="sm"
                          />
                        </div>
                        {rule.record_call === 1 && (
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={rule.play_consent_msg === 1}
                              onCheckedChange={(checked) => handleUpdateRule(idx, 'play_consent_msg', checked ? 1 : 0)}
                              label="Message de consentement Loi 25"
                              size="sm"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  <div className="flex gap-2 justify-end pt-3">
                    <Button
                      disabled={savingRules}
                      onClick={() => void handleSaveRules()}
                      leftIcon={<Icon as={Save} size="sm" />}
                    >
                      {savingRules ? 'Enregistrement...' : t('telephony.phoneNumbers.saveRules')}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ) : (
            <Card className="p-12 text-center text-[var(--text-muted)] border border-dashed border-[var(--border-subtle)] flex flex-col items-center justify-center space-y-3">
              <Icon as={Settings2} size={36} className="text-[var(--text-muted)]" />
              <p className="text-sm">
                Sélectionnez un numéro de téléphone configuré à gauche pour éditer ses règles de routage dynamique.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
