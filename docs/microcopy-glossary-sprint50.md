# Glossaire microcopy UX — Sprint 50 M1.4

Date : 2026-05-16
Registre : **français québécois informel** (tutoiement, ton chaleureux PME).
Portée : labels boutons, toasts, tooltips, messages d'erreur, empty states.

## Verbes d'action — termes standards retenus

| Action | ✅ Standard QC | ❌ À ne plus utiliser | Note |
|---|---|---|---|
| Persister des données | **Enregistrer** | Sauvegarder | Uniformisé Sprint 50 (boutons + toasts) |
| Annuler une action | **Annuler** | Cancel | Déjà cohérent (25 usages) |
| Vider un champ / filtres | **Effacer** | Vider, Réinitialiser | "Effacer la recherche / les filtres" |
| Retirer d'une liste (non destructif) | **Retirer** | Enlever | Ex : retirer un filtre, une invitation, une étoile |
| Détruire une entité (destructif) | **Supprimer** | Effacer | Réservé aux suppressions réelles (DB) |
| Fermer une vue/modal | **Fermer** | Quitter | — |
| Confirmer | **Confirmer** | OK, Valider | — |

### Distinction sémantique importante (NON un bug — voulu)

- **Effacer** = vider un champ/des filtres (réversible, non destructif).
- **Retirer** = sortir un élément d'une liste sans le détruire (invitation
  en attente, filtre actif, marquage étoilé).
- **Supprimer** = destruction définitive d'une entité (lead, modèle, etc.).

Ces trois termes coexistent **volontairement** : ils portent des sens
différents. Aucune uniformisation forcée entre eux.

## Terminologie fonctionnalités (noms — pas des verbes)

| Concept | Terme retenu | Cohérence vérifiée |
|---|---|---|
| Vue de filtres persistée | **Vue sauvegardée** / **Vues sauvegardées** | Sidebar + CommandPalette + FeatureUsageTable alignés |
| Tableau de bord (Reports) | **Tableau de bord** (toast) / "Dashboard" toléré en UI dense | — |
| Modèle de doc/email | **Modèle** | Uniformisé (plus "Template" dans les toasts) |

> Note : « Vue **sauvegardée** » garde ce participe car c'est un **nom de
> fonctionnalité figé** (label de feature), distinct du verbe d'action
> « Enregistrer ». Cohérent dans les 3 call sites.

## Messages d'erreur — ton friendly QC

Principe : **pas de jargon technique brut**, toujours une porte de sortie
("Réessaie", "Vérifie ton réseau").

| ❌ Avant | ✅ Après |
|---|---|
| `Échec de la sauvegarde` | `L'enregistrement a échoué. Réessaie.` |
| `Erreur lors de la sauvegarde` | `L'enregistrement a échoué. Réessaie.` |
| `Erreur réseau lors de la sauvegarde` | `Problème de connexion. Vérifie ton réseau et réessaie.` |
| `Échec de la sauvegarde du rapport` | `L'enregistrement du rapport a échoué. Réessaie.` |

⚠️ Les erreurs renvoyées par l'API (`err.message`) restent affichées telles
quelles avec fallback friendly (`err.message || 'message convivial'`) — non
modifiées Sprint 50 (le backend FR contrôle ces strings).

## Toasts — wording

- **Succès** : participe passé court — « Modèle enregistré », « Notes
  enregistrées », « Lead restauré », « Export CSV téléchargé ».
- **Erreur** : phrase + action de récupération (voir tableau ci-dessus).
- **Tutoiement** systématique (« Réessaie », « Vérifie »).

## Changements appliqués Sprint 50 M1.4

Fichiers modifiés (littéraux JSX/strings inline — **aucun via `t()`**, i18n
Sprint 48 préservé) :

- `Leads.tsx` — 3 boutons + 2 toasts → « Enregistrer »
- `Reports.tsx` — 2 boutons + 1 tag + 3 erreurs → « Enregistrer » / friendly
- `TaskPanel.tsx` — bouton → « Enregistrer »
- `DocumentTemplates.tsx` — bouton → « Enregistrer le modèle »
- `BrandingSettings.tsx` — bouton → « Enregistrer les modifications »
- `ComplianceSettings.tsx` — bouton → « Enregistrer »
- `VisitMode.tsx` — bouton → « Enregistrer »
- `WorkflowBuilder.tsx` — bouton (corrige incohérence interne « Enregistrement… »
  / « Sauvegarder ») → « Enregistrer »
- `EmailBuilder.tsx` — toast succès + erreur → « Modèle enregistré » / friendly
- `AutosaveIndicator.tsx` — commentaire aligné

Total : ~10 fichiers, ~20 strings uniformisées. API publique 100% préservée.

## NON modifié (intentionnel)

- Comments code (`// Sauvegarder…`) hors AutosaveIndicator — non visibles user.
- `worker/` — strings backend hors scope M1.
- Loi25Compliance « Sauvegardes chiffrées » — terme légal/infra (backups), correct.
- FirstLeadTour « Sauvegarde et regarde la magie » — narration onboarding
  ludique, registre intentionnel (pas un label bouton).
- Agencies « Sauvegardez la configuration… » — phrase descriptive, pas un CTA.
- « Vue(s) sauvegardée(s) » — nom de fonctionnalité figé, cohérent x3.
