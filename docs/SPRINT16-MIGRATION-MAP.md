# Sprint 16 — Design System Migration Map

> Inventaire exhaustif des usages Legacy Modal (`isOpen`/`onClose`) et Legacy Input (`label`/`icon`).
> Généré le 2026-05-13.

## 1. Mapping API : Legacy → Nouveau

### Modal

| Legacy (`_compat.tsx`) | Nouveau (`Modal.tsx` — Radix) |
|---|---|
| `isOpen={bool}` | `open={bool}` |
| `onClose={() => ...}` | `onOpenChange={(open) => { if (!open) ... }}` |
| `title="..."` | `title="..."` (identique) |
| `children` | `children` (identique) |
| — | `description="..."` (optionnel, nouveau) |
| — | `size="sm" \| "md" \| "lg"` (optionnel, défaut `md`) |
| — | `className="..."` (optionnel) |

**Transformation mécanique :**
```diff
-<Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Titre">
+<Modal open={showModal} onOpenChange={setShowModal} title="Titre">
```

> [!NOTE]
> Quand `onClose` est `() => setState(false)`, on peut simplifier en `onOpenChange={setState}`.
> Quand `onClose` fait plus (ex: `resetForm()`), utiliser `onOpenChange={(v) => { if (!v) { setState(false); resetForm(); } }}`.

### Input

| Legacy (`_compat.tsx`) | Nouveau (`Input.tsx`) |
|---|---|
| `label="..."` | Wrapping `<label>` + `<Input />` manuellement |
| `icon={<Icon />}` | `leftIcon={<Icon />}` |
| `error="message"` | `error={true}` + `<p>` séparé |
| `id`, `className`, `...props` | Identiques (forwarded) |

**Transformation :**
```diff
-<Input label="Email" icon={<Mail />} error={errors.email} placeholder="..." value={v} onChange={fn} />
+<div className="flex flex-col gap-1.5">
+  <label className="text-sm font-medium text-[var(--text-secondary)]">Email</label>
+  <Input leftIcon={<Mail />} error={!!errors.email} placeholder="..." value={v} onChange={fn} />
+  {errors.email && <p className="text-xs text-[var(--danger)]">{errors.email}</p>}
+</div>
```

---

## 2. Inventaire Modal Legacy (26 occurrences dans 15 fichiers)

### Pages (`src/pages/`)

| # | Fichier | Modal | Fonction métier | Complexité |
|---|---|---|---|---|
| 1 | `Agencies.tsx:190` | `showAdd` | Créer un sous-compte | Simple |
| 2 | `Calendar.tsx:430` | `showAddModal` | Nouveau rendez-vous | Simple |
| 3 | `Calendar.tsx:493` | `showDetailModal` | Détails rendez-vous | Simple |
| 4 | `Clients.tsx:188` | `showModal` (composant interne) | Ajouter client (wrapper) | Moyen |
| 5 | `Clients.tsx:229` | `isOpen` (sous-composant) | Formulaire ajout client | Simple |
| 6 | `FormBuilder.tsx:243` | `showStats` | Statistiques formulaire | Simple |
| 7 | `FormBuilder.tsx:253` | `showEmbed` | Code d'intégration | Simple |
| 8 | `FormBuilder.tsx:266` | `showSettings` | Paramètres formulaire | Simple |
| 9 | `Invoices.tsx:190` | `showAdd` | Nouvelle facture | Simple |
| 10 | `Leads.tsx:596` | `createOpen` | Nouveau lead | Moyen (resetForm dans onClose) |
| 11 | `Leads.tsx:675` | `selectedLead` | Notes d'un lead | Simple |
| 12 | `Pipeline.tsx:410` | `lostModal.show` | Marquer comme perdu | Moyen (objet state) |
| 13 | `Properties.tsx:178` | `isSyncModalOpen` | Sync Centris | Simple |
| 14 | `Tasks.tsx:289` | `showAddModal` | Nouvelle tâche | Simple |
| 15 | `Tasks.tsx:342` | `showDetailModal` | Détails tâche | Simple |
| 16 | `Templates.tsx:251` | `showEditor` | Éditeur template | Moyen (resetForm) |
| 17 | `Templates.tsx:341` | `previewId` | Aperçu template | Simple |
| 18 | `Trash.tsx:159` | `showConfirm` | Vider corbeille | Simple |
| 19 | `TriggerLinks.tsx:121` | `showCreate` | Nouveau trigger link | Simple |
| 20 | `WorkflowBuilder.tsx:306` | `showAddStep` | Ajouter un nœud | Simple |

### Settings (`src/components/settings/`)

| # | Fichier | Modal | Fonction métier | Complexité |
|---|---|---|---|---|
| 21 | `ApiWebhooksSettings.tsx:125` | `showKeyModal` | Créer clé API | Simple |
| 22 | `ApiWebhooksSettings.tsx:140` | `showWhModal` | Ajouter webhook | Simple |
| 23 | `ApiWebhooksSettings.tsx:157` | `showLogsModal` | Logs webhook | Simple |
| 24 | `SecuritySettings.tsx:124` | `showBackupCodes` | Codes secours 2FA | Simple |
| 25 | `SnippetsSettings.tsx:127` | `modalOpen` | Créer/modifier snippet | Simple |
| 26 | `TeamSettings.tsx:72` | `showInviteModal` | Inviter collaborateur | Simple |

### Layout (NON-MODAL — à ignorer)

| Fichier | Usage | Note |
|---|---|---|
| `AppLayout.tsx:146` | `Sidebar isOpen=` | Composant Sidebar, pas un Modal |
| `AppLayout.tsx:291` | `CommandPalette isOpen=` | Composant CommandPalette, pas un Modal |

---

## 3. Inventaire Input Legacy (2 fichiers)

| # | Fichier | Props legacy | Occurrences |
|---|---|---|---|
| 1 | `Clients.tsx` | `label="..."` | ~4 inputs |
| 2 | `Agencies.tsx` | `label="..."` | ~3 inputs |

---

## 4. Fichiers à supprimer (Phase E)

| Fichier | Statut | Raison |
|---|---|---|
| `_legacy.tsx` (7.9 KB) | Dead code | Plus importé nulle part |
| `_compat.tsx` (2.8 KB) | Shim actif | À supprimer après migration des 26 modals + 2 inputs |

## 5. Plan de batching (Phases B-D)

### Batch B.1 — Pages simples (14 modals)
Agencies, Calendar(2), FormBuilder(3), Invoices, Properties, Trash, TriggerLinks, WorkflowBuilder, Tasks(2), Templates(preview)

### Batch B.2 — Pages complexes (6 modals)
Clients(2), Leads(2), Pipeline, Templates(editor)

### Batch B.3 — Settings (5 modals)
ApiWebhooks(3), Security, Snippets, Team

### Batch C — Input Legacy (2 fichiers)
Clients, Agencies

### Batch D — Nettoyage
Supprimer `_compat.tsx`, `_legacy.tsx`, mettre à jour barrel `index.ts`
