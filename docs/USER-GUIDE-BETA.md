# Guide utilisateur — Bêta Intralys

> Guide concis pour les bêta-testeurs. Français québécois, fonctionnel (pas
> marketing). Décrit le parcours réel de l'app au moment de la bêta privée.
> Procédures internes d'invitation/exploitation : `docs/RUNBOOK-OPS.md`.

---

## 1. Rejoindre la bêta

1. **Inscription** : tu remplis le formulaire d'inscription bêta (courriel,
   entreprise, industrie, taille d'équipe, ton cas d'usage). Le consentement
   est **obligatoire** (Loi 25 / CASL) — tu acceptes explicitement qu'on
   t'écrive au sujet de la bêta.
2. **Invitation** : la bêta est **privée**. Une fois ta place validée par
   l'équipe Intralys, tu reçois un **lien de connexion magique** (envoyé
   manuellement par l'équipe pendant la bêta privée).
3. **Connexion** : tu cliques sur le lien. Pas de mot de passe à créer — le
   lien te connecte directement. ⚠️ Le lien **expire après 15 minutes** et ne
   sert **qu'une seule fois**. S'il a expiré, demande-en un nouveau à
   l'équipe.

Après connexion, tu arrives sur ton tableau de bord et l'assistant de
configuration se lance automatiquement.

---

## 2. Configuration initiale (assistant de bienvenue)

L'**assistant de bienvenue** (`WelcomeWizard`) te guide en quelques étapes :

- **Ton entreprise** : nom, industrie, taille d'équipe.
- **Personnalisation** : couleur principale, logo.
- **Pack industrie** (optionnel) : selon ton industrie, Intralys propose un
  ensemble préconfiguré (pipeline, champs personnalisés, automatisations,
  modèles de courriels conformes Loi 25). Installation en un clic.
- **Premier prospect (lead)** : tu crées un lead test pour voir le cycle.
- **Connexion courriels** (optionnel) : pour envoyer campagnes et
  notifications depuis ton domaine.
- **Inviter ton équipe** (optionnel, possible plus tard via les paramètres).

Tu peux **ignorer une étape** et la reprendre plus tard depuis les paramètres.
Ta progression est **sauvegardée côté serveur** : si tu changes d'appareil,
tu reprends où tu en étais.

---

## 3. Le CRM au quotidien

### Leads (prospects)

Le cœur d'Intralys. Chaque lead a un statut, une source, un score, des
activités. Tu peux :

- Créer / éditer / qualifier un lead.
- Suivre l'historique d'activité (courriels, SMS, appels, notes).
- Voir des suggestions IA (prochaine action, prévision de conversion).

### Pipeline

Vue par étapes (glisser-déposer). Tu déplaces un lead d'une étape à l'autre
pour suivre l'avancement de tes opportunités.

### Tâches

Tes à-faire, avec échéance, priorité, sous-tâches et commentaires. Une tâche
peut être liée à un lead.

### Boîte de réception (Inbox)

Conversations unifiées (courriel, SMS, chat, Meta) au même endroit. Filtres
par canal et par statut.

### Recherche globale

Une **barre de recherche unique** (palette de commandes) cherche en même
temps dans tes leads, clients, tâches et conversations. Tape au moins
2 caractères. Tu ne vois **que les données de ton compte** (isolation stricte).

---

## 4. E-commerce (si activé pour ton compte)

Si le module e-commerce est activé pour ta sous-organisation, tu accèdes à un
espace **boutique** : tableau de bord boutique, commandes, clients boutique,
produits, plus des analyses (revenu, cohortes, valeur vie client).

> ⚠️ Pendant la bêta, **les paiements en direct ne sont pas activés**
> (`payments_live_enabled = 0`). Le module e-commerce est exploitable pour la
> gestion et l'analyse, mais l'encaissement réel reste désactivé tant que les
> revues de conformité (PCI / légale) ne sont pas finalisées. C'est normal et
> attendu en bêta.

Si tu ne vois pas d'espace boutique, c'est que le module n'est pas activé
pour ton compte — concentre-toi sur le CRM.

---

## 5. Bon à savoir pendant la bêta

- **Langue** : l'interface est en **français** (marché cible Québec). Certains
  écrans ne basculent pas encore en EN/ES — c'est connu et en cours.
- **Données mock** : selon la configuration, certaines fonctions IA peuvent
  tourner en mode démonstration tant que la clé IA n'est pas branchée.
- **Hors-ligne** : l'app (PWA) gère une partie du travail hors connexion et
  se resynchronise au retour du réseau.
- **Donner ton avis** : un **widget de feedback** est intégré (bouton flottant).
  Choisis le type (bug / idée / question), écris ton message, joins une
  capture si utile. Tes retours arrivent directement à l'équipe — c'est le
  but de la bêta, n'hésite pas.

---

## 6. Besoin d'aide

- **Centre d'aide** intégré : articles et tutoriels (recherche en haut).
- **Roadmap publique** : tu peux voir ce qui s'en vient et **voter** pour les
  fonctionnalités qui t'intéressent.
- **Support bêta** : en cas de blocage, utilise le widget de feedback ou
  contacte ton interlocuteur Intralys (suivi personnalisé prévu dans les
  48 h de ta première connexion).

Merci de participer à la bêta — ton usage réel et tes retours façonnent
directement le produit.
