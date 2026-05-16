# Personnaliser ton pipeline

Le pipeline, c’est le cœur de ton CRM. Bien configuré, il te dit **où concentrer ton énergie cette semaine**.

## Accéder aux réglages

**Pipeline → ⚙ Réglages** (en haut à droite). Tu arrives dans le **PipelineSettings Wizard** (4 étapes).

## Étape 1 : Définir les étapes

Tu peux :

- **Ajouter** une étape (bouton + en bas)
- **Renommer** (double-clic sur le nom)
- **Réordonner** (drag-and-drop la poignée)
- **Supprimer** (icône poubelle, demande confirmation si l’étape a des leads)
- **Couleur** : choisis une couleur thématique par étape (visuelle dans Kanban)

> Recommandation : 5 à 7 étapes max. Au-delà, l’équipe se perd.

## Étape 2 : SLA (délais)

Pour chaque étape, configure un **délai max avant alerte**. Exemple :

- Nouveau → 1 jour
- Qualifié → 3 jours
- Proposition → 7 jours
- Négociation → 14 jours

Si un lead dépasse, il apparaît avec un badge orange dans la vue Kanban + une notif est envoyée à l’owner.

## Étape 3 : Auto-progression

Tu peux définir des **règles** qui font avancer un lead automatiquement :

- Si "courriel ouvert + lien cliqué" → passer à Qualifié
- Si "RDV booké" → passer à Proposition
- Si "facture payée" → passer à Gagné

Sinon, les changements d’étape restent **manuels** (drag-and-drop ou bouton).

## Étape 4 : Probabilités & Forecast

Pour chaque étape, assigne une **probabilité de fermeture** (%). Exemples défaut :

- Nouveau : 10%
- Qualifié : 25%
- Proposition : 50%
- Négociation : 75%
- Gagné : 100%

Ces % sont utilisés pour calculer ton **forecast pondéré** dans le dashboard (somme des deals × probabilité).

## Plusieurs pipelines ?

Tu peux créer **plusieurs pipelines** si tes processus diffèrent (ex: "Vente immobilière" vs "Vente locative"). Va dans **Settings → Pipelines → Nouveau pipeline**.

Chaque lead appartient à **un seul pipeline** à la fois, mais tu peux le déplacer entre pipelines (utile quand un prospect change de catégorie).

## Bonnes pratiques

1. **Garde-le simple**. 5 étapes claires battent 12 étapes vagues.
2. **Mets des SLA partout**. Sans deadline, rien n’avance.
3. **Audit trimestriel**. Ton pipeline doit refléter ton processus actuel, pas celui d’il y a 2 ans.
4. **Probabilités honnêtes**. Si tu mets 90% à "Proposition envoyée", ton forecast va te mentir.

## Lien avec les workflows

Chaque changement d’étape peut déclencher un workflow. Exemple : "Quand un lead passe à Proposition → envoyer courriel template + créer tâche follow-up J+3".

[Configurer les workflows →](/help/messaging-setup)
