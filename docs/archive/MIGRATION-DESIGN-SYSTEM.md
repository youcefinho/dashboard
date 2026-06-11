# Design System Migration — Sprint 16

> Livré le 2026-05-13. 1 commit sur `master` (`fa3c406`).

## Objectif

Éliminer tous les composants legacy (`_compat.tsx` et `_legacy.tsx`) du design system UI.
Migrer **tous** les fichiers vers les composants Radix/modernes.

## Avant → Après

| Élément | Avant | Après |
|---|---|---|
| **Modal** | `LegacyModal` via `_compat.tsx` (API `isOpen`/`onClose`) | `Modal` Radix Dialog (API `open`/`onOpenChange`) |
| **Input** | `LegacyInput` via `_compat.tsx` (props `label`/`icon`) | `Input` forward-ref (props `leftIcon`/`rightIcon`, wrapping `<label>`) |
| **Barrel** | Exporte `LegacyModal as Modal` | Exporte `Modal` directement depuis `./Modal` |
| **`_compat.tsx`** | 2.8 KB, shim actif | ❌ Supprimé |
| **`_legacy.tsx`** | 7.9 KB, dead code | ❌ Supprimé |

## Fichiers migrés (22 fichiers)

### Pages (18 fichiers)
- Agencies, Calendar, ClientLeads, Clients, FormBuilder, Invoices, Leads, Login, Pipeline, Properties, Tasks, Templates, Trash, TriggerLinks, WorkflowBuilder
- settings/ComplianceSettings

### Settings components (4 fichiers)
- ApiWebhooksSettings, SecuritySettings, SnippetsSettings, TeamSettings

### UI (2 fichiers supprimés, 1 modifié)
- `_compat.tsx` — supprimé
- `_legacy.tsx` — supprimé
- `index.ts` — barrel nettoyé

## Mapping API

### Modal
```
isOpen={bool}     → open={bool}
onClose={() => x} → onOpenChange={setState} ou onOpenChange={(v) => { if (!v) x() }}
```

### Input
```
label="..."  → <div><label>...</label><Input /></div>
icon={<X />} → leftIcon={<X />}
error="msg"  → error={!!msg} + <p>{msg}</p>
```

## Métriques

| Métrique | Valeur |
|---|---|
| Tests | 193 (inchangé) |
| Build | ✅ Vert |
| Code supprimé | -411 lignes |
| Code ajouté | +310 lignes (labels wrapping) |
| Net | **-101 lignes** |
| CSS bundle | 94.88 KB (vs 96.75 KB avant, -1.87 KB) |
