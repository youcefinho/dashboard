# Déclaration d'accessibilité — Intralys CRM

> Engagement public Intralys pour l'accessibilité numérique.
> Dernière revue : Sprint 29 (2026-05-23).

## Engagement

Intralys s'engage à rendre son CRM accessible à tous les utilisateurs, y compris les personnes en situation de handicap, conformément aux normes :

- **WCAG 2.2** (Web Content Accessibility Guidelines) — niveau AA cible, AAA partiel atteint
- **RGAA 4.1** (Référentiel Général d'Amélioration de l'Accessibilité, France)
- **AODA** (Accessibility for Ontarians with Disabilities Act, Canada)
- **Loi 25 / PL64** (Québec — droit à l'accessibilité numérique pour les organismes publics et entreprises)

## Niveau de conformité

**WCAG 2.2 AA** : niveau cible — atteint sur l'ensemble du CRM.

**WCAG 2.2 AAA partiel** : atteint sur les axes suivants
- Contraste du texte de contenu (body text) : 7.37:1+ (cible AAA 7:1 normal text)
- Focus visible cohérent avec ring d'outline AAA-compliant
- Respect strict de `prefers-reduced-motion` (animations désactivées si l'utilisateur le demande)
- Support du mode contraste forcé Windows (Forced Colors Mode HCM)
- Skip link "Aller au contenu principal" disponible au focus initial

**Limitations connues (non-AAA)**
- Certains tableaux de données complexes (Reports DashboardBuilder) n'ont pas encore de description textuelle complète pour les lecteurs d'écran
- Les cartes interactives (Mapbox) n'ont pas d'équivalents textuels pour les marqueurs géolocalisés
- Touch targets de 44×44 px sont atteints sur les surfaces tactiles (mobile/tablet) mais le desktop conserve la densité Stripe-clean (32-40 px)

## Fonctionnalités d'accessibilité supportées

- **Navigation au clavier complète** (Tab, Shift+Tab, Entrée, Espace, Échap, flèches)
- **Lecteurs d'écran** : NVDA (Windows), JAWS (Windows), VoiceOver (macOS/iOS), TalkBack (Android)
- **Focus visible AAA** : outline 2px + ring 3px sur tous les éléments interactifs
- **`prefers-reduced-motion`** : toutes les animations non-essentielles désactivées
- **Forced Colors Mode (Windows HCM)** : couleurs système respectées
- **Skip link** : "Aller au contenu principal" en début de chaque page
- **ARIA landmarks** : `<nav>`, `<main>`, `<aside>`, `<header>`, `<footer>` partout
- **Contraste AAA** sur le texte de contenu (7:1 minimum)
- **Texte redimensionnable** jusqu'à 200% sans perte de fonctionnalité

## Signaler un problème d'accessibilité

Si vous rencontrez un obstacle d'accessibilité sur Intralys, contactez-nous :

**Email** : accessibilite@intralys.com  
**Délai de réponse** : 5 jours ouvrables  
**Délai de résolution cible** : 30 jours

Merci d'inclure :
- L'URL de la page concernée
- Une description du problème
- Votre technologie d'assistance utilisée (NVDA, JAWS, VoiceOver, etc.)
- Votre navigateur et système d'exploitation

## Audit et amélioration continue

- **Audit interne** : à chaque sprint de release (sprints majeurs)
- **Audit externe** : prévu à chaque release candidate majeure (cible 1×/an minimum)
- **Tests utilisateurs** : sessions périodiques avec utilisateurs en situation de handicap

## Évolution de cette déclaration

Cette déclaration est mise à jour à chaque sprint impactant l'accessibilité. La dernière mise à jour majeure est documentée dans `docs/LOT-A11Y-DESIGN-CONVERGENCE.md` (Sprint 29).

---

*Conformité : Loi 25 (QC, art. 27 — accessibilité), AODA (CA), WCAG 2.2 AA + AAA partiel, RGAA 4.1.*
