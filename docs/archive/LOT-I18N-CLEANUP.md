# LOT I18N-CLEANUP — Finition des libellés FR en dur (Sprints A & F)

Front pur, zéro logique métier. Remplacement littéral → `t('…')` uniquement.
Aucun handler/state/appel API touché. `documents.ts` non touché (hors scope).

## Clés ajoutées (parité STRICTE ×4 : fr-CA / fr-FR / en / es)

11 clés ajoutées dans chacun des 4 catalogues (`src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`) :

| Clé | fr-CA | fr-FR | en | es |
|---|---|---|---|---|
| `reports.scheduled.recipients_placeholder` | a@exemple.com, b@exemple.com | a@exemple.com, b@exemple.com | a@example.com, b@example.com | a@ejemplo.com, b@ejemplo.com |
| `reports.scheduled.recipients_helper` | Sépare les courriels par une virgule. | Séparez les courriels par une virgule. | Separate emails with a comma. | Separa los correos con una coma. |
| `reports.scheduled.day_1`…`day_7` | Lundi…Dimanche | Lundi…Dimanche | Monday…Sunday | Lunes…Domingo |
| `telephony.ivr.invalid_json` | JSON invalide | JSON invalide | Invalid JSON | JSON no válido |
| `telephony.transcription` | Transcription | Transcription | Transcript | Transcripción |

Vocabulaire : fr-CA tutoiement (« Sépare »), fr-FR vouvoiement (« Séparez »).

## Clés existantes RÉUTILISÉES (aucune nouvelle créée)

- `action.save` (bouton enregistrer IVR — remplace littéral « OK »)
- `action.cancel` (bouton annuler IVR — remplace littéral « × »)
- `action.delete` (title bouton supprimer menu IVR — remplace littéral « Supprimer »)

## Composants câblés

### Sprint A — `src/components/reports/ScheduledReportsPanel.tsx`
- 7 `<option>` jours-semaine (Lundi…Dimanche) → `t('reports.scheduled.day_1..7')`
- placeholder champ destinataires → `t('reports.scheduled.recipients_placeholder')`
- helper champ destinataires → `t('reports.scheduled.recipients_helper')`

### Sprint F — `src/pages/Settings.tsx` (TelephonySettings inline)
- `setConfigError('JSON invalide')` → `t('telephony.ivr.invalid_json')`
- bouton « OK » → `t('action.save')` (réutilisée)
- bouton « × » → `t('action.cancel')` (réutilisée)
- title « Supprimer » → `t('action.delete')` (réutilisée)

### Sprint F — `src/pages/LeadDetail.tsx` (carte Appels — page R cœur)
- `<summary>Transcription</summary>` → `t('telephony.transcription')`
- Modif ULTRA-CIBLÉE, un seul littéral dans la carte Appels Sprint F. Layout/hooks/autres champs INTACTS.

## SKIP / non touché (acceptable en l'état)
- `src/pages/LeadDetail.tsx` lignes ~334 et ~486 (« Supprimer le lead », « Supprimer la note héritée ? ») : littéraux pré-existants HORS carte Appels Sprint F → hors périmètre, non touchés.
- `documents.ts` : dette Sprint B v2, hors scope, intouché.

## Garanties
- Parité i18n ×4 STRICTE : 11 clés identiques dans les 4 catalogues (vérifié : 11/11/11/11).
- Zéro logique métier modifiée (remplacement de chaînes uniquement).
- `documents.ts` non touché.
- Build délégué Antigravity (VM sans bun/node).
