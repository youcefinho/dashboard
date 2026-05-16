# Communication (Email / SMS / WhatsApp)

Intralys centralise tes 3 canaux de communication. Voici comment les configurer.

## Email

### Connecter ton email pro

**Settings → Intégrations → Email**. Trois options :

1. **Google Workspace (Gmail)** — OAuth en 1 clic, c’est le plus simple
2. **Microsoft 365 (Outlook)** — OAuth aussi
3. **SMTP custom** — pour n’importe quel hébergeur (OVH, Cogeco, etc.)

Une fois connecté, **tous tes échanges** avec tes leads sont auto-loggés dans leur timeline. Pas besoin de copier-coller.

### Templates

**Templates → Email**. Tu peux créer des templates réutilisables avec :

- **Variables** : `{{lead.prenom}}`, `{{lead.entreprise}}`, `{{user.nom}}`, etc.
- **Conditionnels** : `{{#if lead.secteur === 'courtage'}} ... {{/if}}`
- **Builder visuel** : drag-and-drop blocks (bouton CTA, image, paragraphe, divider)
- **Versionning** : 5 dernières versions sauvegardées, rollback en 1 clic

### Envoi en masse (séquence)

Tu veux envoyer 200 courriels personnalisés ? Utilise les **séquences** :

1. Filtre tes leads cible
2. Bulk Actions → "Envoyer séquence"
3. Choisis le template
4. Programme l’envoi (immédiat ou différé, par batch de 50/h pour éviter le spam)

> ⚠️ Loi 25 / CASL : Intralys vérifie automatiquement que chaque destinataire a donné son **consentement explicite**. Si pas de consentement, l’envoi est bloqué.

## SMS

### Connecter Twilio

**Settings → Intégrations → SMS (Twilio)**. Tu dois avoir un compte Twilio avec :

- Un numéro **canadien** (pour bénéficier des tarifs locaux)
- A2P 10DLC enregistré (campagne marketing déclarée auprès des opérateurs US si tu envoies aux US)

Pour le Canada uniquement, l’enregistrement n’est pas obligatoire mais recommandé pour éviter les filtres anti-spam.

### Numéros locaux

Si tu veux un numéro avec indicatif local (450, 514, 819…), achète-le depuis le dashboard Twilio puis colle-le dans Intralys.

### Templates SMS

Mêmes variables et conditionnels que pour les emails. Limite : **160 caractères par segment**. Au-delà, le SMS est facturé en plusieurs segments.

## WhatsApp Business

### Configuration

**Settings → Intégrations → WhatsApp Business API**. Tu as besoin de :

- Un compte **WhatsApp Business** (pas WhatsApp normal)
- Un **Business Manager** Facebook
- Un numéro dédié (ne peut pas être utilisé en parallèle sur ton téléphone)

Le setup prend ~15 minutes. Doc détaillée → [WhatsApp Business API guide](/help/api-introduction).

### Templates approuvés

WhatsApp impose que les **messages initiés** par toi (en dehors de la fenêtre 24h post-réponse client) soient des **templates pré-approuvés**. Intralys gère la soumission pour approbation.

Quand un client te répond, tu as **24h** pour échanger librement. Après, retour aux templates.

## Inbox unifié

Tous les canaux atterrissent dans **Inbox** (icône messages dans la sidebar). Tu peux :

- Filtrer par canal (Email / SMS / WhatsApp)
- Filtrer par "Non lu" / "Assigné à moi" / "Mentions"
- Répondre **dans le canal d’origine** (un SMS reçu se répond en SMS)
- Switcher de canal si besoin (escalade SMS → courriel pour envoyer un PDF)

## Workflows messaging

Tu peux déclencher des envois automatiques via workflows. Exemples :

- **Bienvenue J+0** : courriel + SMS dans la même heure
- **Relance J+3** : SMS si pas de réponse au courriel
- **Reminder RDV J-1** : SMS automatique 17h la veille

[Guide complet workflows →](/help/api-introduction)
