// ── Smart Lists — listes dynamiques (segments par règles) ───────────────────
//
// Composant enfant ADDITIF de la page Segments (LOT G6). Surface la capacité
// « smart lists » (segments dynamiques basés sur des règles) restée invisible :
// création d'une liste à partir de règles (statut / source / score / tags) puis
// exécution (aperçu des leads correspondants). Helpers api.ts FIGÉS consommés
// tels quels : getSmartLists / createSmartList / executeSmartList /
// deleteSmartList. i18n 100 % `t('smartlists.*')` (AUCUNE création de clé ici —
// les valeurs sont fournies dans le rapport). Discrimination erreur via la
// présence de `res.data` / texte `res.error`, JAMAIS `res.code` (ApiResponse
// gelé) — strictement comme le reste de la page.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Tag,
  Icon,
  Input,
  Select,
  Skeleton,
  EmptyState,
  Switch,
  FilterChip,
  SlidePanel,
  useToast,
  useConfirm,
} from '@/components/ui';
import { Sparkles, Plus, Play, Trash2, Users, ListFilter } from 'lucide-react';
import {
  getSmartLists,
  createSmartList,
  executeSmartList,
  deleteSmartList,
} from '@/lib/api';
import type { SmartList } from '@/lib/types';
import { LEAD_STATUSES, LEAD_SOURCES, STATUS_LABELS, SOURCE_LABELS } from '@/lib/types';
import { t } from '@/lib/i18n';

// État local du builder de règles. Reflète un sous-ensemble des filtres lead
// bien connus (status / source / score / tags). Les flags d'activation
// distinguent « non filtré » de « filtré vide ».
type RuleBuilder = {
  statuses: string[];
  sources: string[];
  scoreOn: boolean;
  scoreOp: 'gte' | 'lte' | 'eq';
  scoreValue: number;
  tagsRaw: string;
};

const EMPTY_RULES: RuleBuilder = {
  statuses: [],
  sources: [],
  scoreOn: false,
  scoreOp: 'gte',
  scoreValue: 50,
  tagsRaw: '',
};

// Builder UI → filters (Record<string, unknown>). N'inclut que les blocs actifs.
function rulesToFilters(r: RuleBuilder): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  if (r.statuses.length) f.status = r.statuses;
  if (r.sources.length) f.source = r.sources;
  if (r.scoreOn) f.score = { op: r.scoreOp, value: r.scoreValue };
  const tags = r.tagsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (tags.length) f.tags_in = tags;
  return f;
}

function toggleIn(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

// Ligne d'aperçu (leads correspondants). Le backend renvoie un tableau libre.
type ExecRow = Record<string, unknown>;

export function SmartListsPanel() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [lists, setLists] = useState<SmartList[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Éditeur de création (règles)
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [rules, setRules] = useState<RuleBuilder>(EMPTY_RULES);
  const [busy, setBusy] = useState(false);

  // Exécution / aperçu
  const [execOpen, setExecOpen] = useState(false);
  const [execList, setExecList] = useState<SmartList | null>(null);
  const [execRows, setExecRows] = useState<ExecRow[]>([]);
  const [execTotal, setExecTotal] = useState<number | null>(null);
  const [execLoading, setExecLoading] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);

  const filters = useMemo(() => rulesToFilters(rules), [rules]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await getSmartLists();
      // Parsing défensif : réponse non-tableau → liste vide (jamais de crash).
      if (res.data) setLists(Array.isArray(res.data) ? res.data : []);
      else if (res.error) setLoadError(res.error);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('smartlists.error_load'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetEditor = () => {
    setName('');
    setRules(EMPTY_RULES);
  };

  const openCreate = () => {
    resetEditor();
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const res = await createSmartList({ name: name.trim(), filters });
    setBusy(false);
    if (res.data) {
      setCreateOpen(false);
      resetEditor();
      success(t('smartlists.created'));
      void load();
    } else {
      toastError(res.error || t('smartlists.error_create'));
    }
  };

  const openExecute = async (list: SmartList) => {
    setExecList(list);
    setExecRows([]);
    setExecTotal(null);
    setExecError(null);
    setExecOpen(true);
    setExecLoading(true);
    const res = await executeSmartList(list.id, { limit: 25 });
    setExecLoading(false);
    if (res.data) {
      // Parsing défensif : rows = tableau garanti, total = number ou null.
      setExecRows(Array.isArray(res.data.data) ? res.data.data : []);
      setExecTotal(typeof res.data.total === 'number' ? res.data.total : null);
    } else {
      setExecError(res.error || t('smartlists.error_execute'));
    }
  };

  const handleDelete = async (list: SmartList) => {
    const ok = await confirm({
      title: t('smartlists.delete'),
      description: t('smartlists.confirm_delete', { name: list.name }),
      danger: true,
    });
    if (!ok) return;
    setDeletingId(list.id);
    const res = await deleteSmartList(list.id);
    setDeletingId(null);
    if (res.data) {
      setLists((prev) => prev.filter((l) => l.id !== list.id));
      success(t('smartlists.deleted'));
    } else {
      toastError(res.error || t('smartlists.error_delete'));
    }
  };

  return (
    <section className="mt-10 smart-lists" aria-labelledby="smartlists-heading">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 id="smartlists-heading" className="t-h2 flex items-center gap-2">
            <Icon as={Sparkles} size="sm" /> {t('smartlists.title')}
          </h2>
          <p className="text-muted">{t('smartlists.subtitle')}</p>
        </div>
        <Button
          variant="secondary"
          leftIcon={<Icon as={Plus} size="sm" />}
          onClick={openCreate}
        >
          {t('smartlists.new')}
        </Button>
      </div>

      {loadError && !isLoading && (
        <div
          role="alert"
          aria-live="polite"
          className="mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-[var(--danger-soft)] border border-[var(--danger)]/30 text-[var(--danger)]"
        >
          <span className="text-sm">{loadError}</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void load()}
            aria-label={t('smartlists.retry')}
          >
            {t('smartlists.retry')}
          </Button>
        </div>
      )}

      {isLoading ? (
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-busy="true"
          aria-live="polite"
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-5 w-2/3 mb-3" />
              <Skeleton className="h-3 w-1/3 mb-4" />
              <Skeleton className="h-8 w-full rounded-md" />
            </Card>
          ))}
        </div>
      ) : lists.length === 0 && !loadError ? (
        <EmptyState
          icon={<Icon as={Sparkles} size={40} />}
          title={t('smartlists.empty_title')}
          description={t('smartlists.empty_desc')}
          action={
            <Button
              variant="secondary"
              leftIcon={<Icon as={Plus} size="sm" />}
              onClick={openCreate}
            >
              {t('smartlists.new')}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((list) => (
            <Card key={list.id} className="p-5 flex flex-col gap-3 smart-list-card">
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold leading-tight">{list.name}</span>
                {typeof list.count === 'number' ? (
                  <Tag variant="neutral" size="sm">
                    <Icon as={Users} size="sm" /> {list.count}
                  </Tag>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-auto pt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Icon as={Play} size="sm" />}
                  onClick={() => void openExecute(list)}
                >
                  {t('smartlists.execute')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  isLoading={deletingId === list.id}
                  leftIcon={<Icon as={Trash2} size="sm" />}
                  onClick={() => void handleDelete(list)}
                  aria-label={t('smartlists.delete')}
                />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ── Création d'une smart list : règles ── */}
      <SlidePanel
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) resetEditor();
        }}
        title={t('smartlists.new')}
        size="lg"
        closeLabel={t('smartlists.cancel')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              {t('smartlists.cancel')}
            </Button>
            <Button
              variant="primary"
              isLoading={busy}
              disabled={!name.trim()}
              onClick={() => void handleCreate()}
            >
              {t('smartlists.save')}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-5 smart-list-builder">
          <div>
            <label className="prop-label">{t('smartlists.name')}</label>
            <Input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          </div>

          <p className="text-sm text-muted flex items-center gap-2">
            <Icon as={ListFilter} size="sm" /> {t('smartlists.rules_hint')}
          </p>

          {/* Statut */}
          <div>
            <label className="prop-label">{t('smartlists.rule_status')}</label>
            <div className="flex flex-wrap gap-2">
              {LEAD_STATUSES.map((s) => (
                <FilterChip
                  key={s}
                  label={STATUS_LABELS[s]}
                  variant={rules.statuses.includes(s) ? 'active' : 'available'}
                  onClick={() =>
                    setRules((r) => ({ ...r, statuses: toggleIn(r.statuses, s) }))
                  }
                />
              ))}
            </div>
          </div>

          {/* Source */}
          <div>
            <label className="prop-label">{t('smartlists.rule_source')}</label>
            <div className="flex flex-wrap gap-2">
              {LEAD_SOURCES.map((s) => (
                <FilterChip
                  key={s}
                  label={SOURCE_LABELS[s] ?? s}
                  variant={rules.sources.includes(s) ? 'active' : 'available'}
                  onClick={() =>
                    setRules((r) => ({ ...r, sources: toggleIn(r.sources, s) }))
                  }
                />
              ))}
            </div>
          </div>

          {/* Score */}
          <div className="flex flex-col gap-2">
            <Switch
              checked={rules.scoreOn}
              onCheckedChange={(v) => setRules((r) => ({ ...r, scoreOn: v }))}
              size="sm"
              label={t('smartlists.rule_score')}
            />
            {rules.scoreOn ? (
              <div className="flex items-center gap-2">
                <Select
                  value={rules.scoreOp}
                  onChange={(e) =>
                    setRules((r) => ({
                      ...r,
                      scoreOp: e.target.value as RuleBuilder['scoreOp'],
                    }))
                  }
                  className="w-40"
                >
                  <option value="gte">≥</option>
                  <option value="lte">≤</option>
                  <option value="eq">=</option>
                </Select>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={rules.scoreValue}
                  onChange={(e) =>
                    setRules((r) => ({
                      ...r,
                      scoreValue: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                  className="w-28"
                />
              </div>
            ) : null}
          </div>

          {/* Tags (CSV) */}
          <div>
            <label className="prop-label">{t('smartlists.rule_tags')}</label>
            <Input
              value={rules.tagsRaw}
              placeholder={t('smartlists.rule_tags_placeholder')}
              onChange={(e) => setRules((r) => ({ ...r, tagsRaw: e.target.value }))}
            />
          </div>
        </div>
      </SlidePanel>

      {/* ── Exécution : aperçu des leads correspondants ── */}
      <SlidePanel
        open={execOpen}
        onOpenChange={setExecOpen}
        title={execList ? execList.name : t('smartlists.execute')}
        size="lg"
        closeLabel={t('smartlists.close')}
        footer={
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm text-muted">
              {execLoading ? (
                <Skeleton className="h-4 w-24" />
              ) : execTotal !== null ? (
                <>
                  <strong>{execTotal}</strong> {t('smartlists.matches')}
                </>
              ) : null}
            </div>
            <Button variant="ghost" onClick={() => setExecOpen(false)}>
              {t('smartlists.close')}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 smart-list-exec">
          {execError ? (
            <div
              role="alert"
              aria-live="polite"
              className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-[var(--danger-soft)] border border-[var(--danger)]/30 text-[var(--danger)]"
            >
              <span className="text-sm">{execError}</span>
              {execList ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void openExecute(execList)}
                  aria-label={t('smartlists.retry')}
                >
                  {t('smartlists.retry')}
                </Button>
              ) : null}
            </div>
          ) : execLoading ? (
            <div aria-busy="true" aria-live="polite" className="flex flex-col gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full rounded-md" />
              ))}
            </div>
          ) : execRows.length === 0 ? (
            <p className="text-sm text-muted">{t('smartlists.exec_empty')}</p>
          ) : (
            <div className="flex flex-col gap-1">
              {execRows.map((row, i) => (
                <div key={i} className="text-sm text-muted truncate">
                  {String(row.name ?? row.email ?? row.id ?? '—')}
                  {row.email && row.name ? (
                    <span className="ml-2 text-xs">{String(row.email)}</span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </SlidePanel>
    </section>
  );
}
