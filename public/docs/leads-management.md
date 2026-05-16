# Leads & Pipeline

Tout ce que tu peux faire avec un lead dans Intralys.

## Créer un lead

### Manuellement

Clique sur le **bouton + flottant (FAB)** en bas à droite de n’importe quelle page, puis "Nouveau lead". Tu peux aussi presser **Q** au clavier pour ouvrir le Quick-Add.

Champs minimum requis :

- **Nom** (prénom + nom de famille séparés ou unifiés)
- **Courriel** OU **Téléphone** (au moins un des deux)

Tous les autres champs sont optionnels. Tu peux les enrichir au fur et à mesure.

### Automatiquement

Trois sources possibles :

1. **Formulaire web public** : crée un formulaire dans **FormBuilder**, embed-le sur ton site, les soumissions deviennent des leads
2. **Facebook Lead Ads** : connecte ta page FB depuis **Integrations**, les leads arrivent en temps réel
3. **API** : POST `https://api.intralys.app/v1/leads` avec ton token — voir [API & Intégrations](/help/api-introduction)

### Par import CSV

**Leads → Importer**. Le mapping est intelligent : on devine les colonnes courantes (email, téléphone, nom). Tu peux re-mapper si besoin.

## Organiser tes leads

### Pipeline Kanban

La vue par défaut : **Pipeline**. Drag-and-drop tes leads entre les colonnes (étapes). Chaque colonne montre :

- Le nombre de leads
- La valeur totale (somme des deals)
- Les leads en stagnation (>SLA) avec badge orange

### Vue Tableau (liste)

**Leads → Vue Liste**. Tu peux :

- Trier par n’importe quelle colonne
- Filtrer par étape, source, owner, score, tags…
- Faire des actions en lot (assigner, taguer, supprimer)
- Exporter le résultat en CSV

### Vue Carte (géographique)

Si tes leads ont une adresse, **Properties** affiche une carte Mapbox avec markers cliquables (utile pour le courtage immo).

## Enrichir un lead

Clique sur un lead pour ouvrir le **LeadPanel** (slide-over). Tu peux :

- Modifier les infos de base
- Ajouter des **notes** (rich text)
- Voir le **timeline** (toutes les activités : emails envoyés/reçus, SMS, appels, RDV, changements de statut)
- Lancer un **appel** (si tu as Twilio connecté)
- Envoyer un **courriel** ou **SMS** directement depuis le panel
- Voir le **score IA** + ses 6 signaux explicatifs

## Tags & Smart lists

- **Tags** : labels libres, multi-tag par lead
- **Smart lists** : filtres sauvegardés qui se mettent à jour automatiquement (ex: "Leads chauds en attente de relance")

Crée une smart list depuis n’importe quel filtre actif : bouton "Sauvegarder comme smart list".

## Bulk actions

Coche plusieurs leads (ou Shift+click pour sélectionner une plage). La **BulkActionBar** apparaît en bas. Actions disponibles :

- Assigner à un membre
- Taguer / dé-taguer
- Changer le statut/étape
- Supprimer (soft delete, récupérable 30 jours)
- Exporter en CSV

## Droits & assignation

Chaque lead a un **owner** (commercial assigné). Par défaut, seul l’owner et les admins voient le lead. Tu peux :

- Réassigner (drag dans la vue Kanban ou bouton "Assigner")
- Partager temporairement avec un collègue (lecture seule)
- Auto-assigner via workflow (round-robin, par secteur, par source)

> Astuce power-user : **G L** ouvre la page Leads depuis n’importe où.
