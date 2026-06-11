# TypeScript Strict Audit — Sprint 43 M2.2

**Date** : 2026-05-15
**Manager** : M2 Sprint 43
**Scope** : Audit STATIQUE (pas de tsc en environnement VMware)

## État `tsconfig.json` (avant + après M2)

| Flag | Avant | Après | Note |
|---|---|---|---|
| `strict` | true | **true** (inchangé) | Déjà actif |
| `noUnusedLocals` | true | **true** (inchangé) | Déjà actif |
| `noUnusedParameters` | true | **true** (inchangé) | Déjà actif |
| `noFallthroughCasesInSwitch` | true | **true** (inchangé) | Déjà actif |
| `noUncheckedIndexedAccess` | true | **true** (inchangé) | Déjà actif (bonne hygiène) |
| `exactOptionalPropertyTypes` | absent | **absent** (décision M2) | Voir justification ci-dessous |

### Décision : ne PAS activer `exactOptionalPropertyTypes`

**Raison** : flag très intrusif qui casserait massivement le code existant (toute prop optional `foo?: string` ne pourrait plus recevoir `foo: undefined` explicitement — uniquement omettre la clé). Sprint 43 est sprint de polish, pas de refactor type-system massif. À planifier dans un sprint dédié dans le futur.

**Estimation refactor coût** : 25 fichiers frontend touchent au pattern `?:`, ~30+ propagations dans interfaces de panels/forms. Nécessite une vague Manager dédiée (8-10 atomic implementations).

---

## Patterns suspects à corriger (audit `any` / `@ts-ignore`)

**Total occurrences** : 205 (tsc actif sur src/, **worker tests + _v2-backlog exclus** par config).

### Frontend (non-worker) — 25 fichiers (priorité haute)

| Fichier | Count | Pattern dominant | Risque |
|---|---|---|---|
| `src/pages/WorkflowBuilder.tsx` | 9 | `e: any` (handlers ReactFlow) | Moyen — typage ReactFlow possible |
| `src/components/settings/ApiWebhooksSettings.tsx` | 5 | `(data: any) =>` après `.json()` | Bas — typer les responses API |
| `src/components/settings/ProfileSettings.tsx` | 4 | `user: any` + `e: any` onChange | Moyen — User type existe (lib/types) |
| `src/pages/PublicForm.tsx` | 4 | handlers form | Bas |
| `src/pages/Properties.tsx` | 3 | json responses | Bas |
| `src/components/Inbox/NewConversationPane.tsx` | 2 | `snippets?: any[]`, `templates?: any[]` | Moyen — types Snippet/Template existent |
| `src/components/pipelines/ForecastView.tsx` | 2 | `res.json() as any` + recharts formatter | Bas |
| `src/components/settings/PipelineSettings.tsx` | 2 | `e.target.value as any` (StageType cast) | Bas — caster en `StageType` au lieu de `any` |
| `src/components/settings/NotificationsSettings.tsx` | 2 | `icon: any` | Bas — `LucideIcon` type |
| `src/pages/Reports.tsx` | 2 | recharts formatters | Bas |
| `src/pages/Leads.tsx` | 2 | event handlers | Bas |
| `src/pages/Calendar.tsx` | 2 | event handlers | Bas |
| `src/pages/settings/ComplianceSettings.tsx` | 2 | handlers | Bas |
| `src/lib/sensorial.ts` | 3 | Web Audio API (AudioContext webkit fallback) | **OK — légitime** |
| `src/lib/api.ts` | 2 | generic fetch wrapper | Bas — generics possibles |
| `src/components/ui/Tag.tsx` | 1 | `'--tag-dot-color' as any` (CSS var) | **OK — légitime** |
| `src/components/ui/Button.tsx` | 1 | `(mod: any)` dynamic import confetti | Bas |
| `src/components/Inbox/InboxPanel.tsx` | 1 | `messages: any[]` | Moyen — type Message existe |
| `src/components/settings/TeamSettings.tsx` | 1 | `(data: any)` json | Bas |
| `src/components/settings/RolesPermissionsSettings.tsx` | 1 | `(data: any)` json | Bas |
| `src/pages/Settings.tsx` | 1 | event | Bas |
| `src/pages/SignDocument.tsx` | 1 | event | Bas |
| `src/pages/ResetPassword.tsx` | 1 | event | Bas |
| `src/pages/ForgotPassword.tsx` | 1 | event | Bas |
| `src/worker.ts` | 10 | `as any` sur AuthContext API path | **Préservation API publique — NE PAS TOUCHER** |

### Worker (handlers + tests — exclus par tsconfig)

Les fichiers `src/worker/**` (notamment `__tests__/`) totalisent **180 occurrences** mais **ne sont pas compilés par le frontend tsc**. Pas de fix nécessaire dans ce scope.

---

## Plan de fix recommandé (sprint futur dédié)

**Priorité 1 — Fix sans risque** (~14 fichiers, ~25 occurrences):
- Remplacer `(data: any) =>` par typage explicite des responses API
- Caster `e.target.value as any` en types union concrets (`StageType`, `Channel`, etc.)
- Typer `icon: any` en `LucideIcon` (import depuis `lucide-react`)

**Priorité 2 — Refactor moyen** (~5 fichiers, ~20 occurrences):
- `WorkflowBuilder.tsx` : utiliser types `@xyflow/react` (`NodeChange`, `EdgeChange`, etc.)
- `ProfileSettings.tsx` : typer en `User` (lib/types existe)
- `Inbox*` : utiliser `Message` / `Conversation` types existants

**Préservations strictes** (NE PAS TOUCHER) :
- `src/worker.ts` lignes 183-247 : `as any` sur auth context API publique
- `src/lib/sensorial.ts` : Web Audio API webkit fallback (cast légitime)
- `src/components/ui/Tag.tsx` : CSS custom property cast (légitime)

---

## Conclusion M2.2

- TS strict + noUncheckedIndexedAccess **déjà actifs** (config saine)
- `exactOptionalPropertyTypes` reporté (refactor lourd à planifier)
- 25 fichiers frontend avec `any` documentés pour cleanup futur
- Aucune modification de code dans M2.2 — uniquement audit + documentation
