// ── Sprint 47 M2.2 — Politique cookies ──────────────────────────────────────

import { LegalLayout, type LegalSection } from './_LegalLayout';

const SECTIONS: LegalSection[] = [
  {
    id: 'introduction',
    title: 'Que sont les cookies ?',
    body: (
      <>
        <p>
          Les cookies sont de petits fichiers texte stockés sur votre appareil lorsque vous naviguez sur un site web. Ils permettent au site de mémoriser vos actions et préférences (langue, session, etc.) pendant une période donnée.
        </p>
        <p>
          Intralys utilise des cookies et technologies similaires (localStorage, sessionStorage) pour assurer le bon fonctionnement de la Plateforme et améliorer votre expérience.
        </p>
      </>
    ),
  },
  {
    id: 'types',
    title: 'Types de cookies utilisés',
    body: (
      <>
        <h3>2.1 Cookies essentiels (toujours actifs)</h3>
        <p>
          Indispensables au fonctionnement de la Plateforme. Sans eux, le service ne peut pas être fourni. Ils ne nécessitent pas votre consentement.
        </p>
        <h3>2.2 Cookies de préférences</h3>
        <p>Mémorisent vos choix (thème, langue, densité d'affichage). Désactivables, mais affectent l'expérience.</p>
        <h3>2.3 Cookies de mesure d'audience (analytics)</h3>
        <p>
          Nous utilisons un outil d'analytics first-party respectueux de la vie privée (Cloudflare Web Analytics), qui n'utilise <strong>aucun cookie identifiant</strong>. Aucun envoi de données à Google Analytics ou autres tiers américains.
        </p>
        <h3>2.4 Cookies marketing</h3>
        <p>Intralys n'utilise <strong>aucun cookie publicitaire ni de retargeting</strong>.</p>
      </>
    ),
  },
  {
    id: 'liste',
    title: 'Liste des cookies utilisés',
    body: (
      <>
        <p>Tableau récapitulatif des cookies déposés par notre Plateforme :</p>
        <ul>
          <li><code>intralys_session</code> — Essentiel — Maintient votre session connectée. Durée : 30 jours.</li>
          <li><code>intralys_csrf</code> — Essentiel — Protection contre les attaques CSRF. Durée : session.</li>
          <li><code>intralys_theme</code> — Préférence — Thème clair/sombre choisi. Durée : 1 an.</li>
          <li><code>intralys_density</code> — Préférence — Densité d'affichage (compact/confortable). Durée : 1 an.</li>
          <li><code>intralys_lang</code> — Préférence — Langue (FR / EN). Durée : 1 an.</li>
          <li><code>intralys_consent</code> — Essentiel — Mémorise votre choix sur la bannière cookies. Durée : 6 mois.</li>
        </ul>
        <p>Nous n'utilisons aucun cookie tiers (Google, Facebook, etc.).</p>
      </>
    ),
  },
  {
    id: 'duree',
    title: 'Durée de conservation',
    body: (
      <>
        <p>La durée de vie des cookies varie selon leur finalité, de la durée de la session jusqu'à 1 an maximum.</p>
        <p>Au-delà de cette durée, les cookies expirent automatiquement et sont supprimés par votre navigateur.</p>
      </>
    ),
  },
  {
    id: 'gestion',
    title: 'Comment gérer les cookies',
    body: (
      <>
        <p>Vous pouvez à tout moment modifier vos préférences de cookies via :</p>
        <ul>
          <li>La bannière cookies affichée lors de votre première visite;</li>
          <li>Le lien <em>« Préférences cookies »</em> en bas de chaque page;</li>
          <li>Les paramètres de votre navigateur (effacement, blocage).</li>
        </ul>
        <p>Notez que la désactivation des cookies essentiels rendra la Plateforme inutilisable (impossibilité de se connecter, perte des préférences).</p>
        <p>Liens utiles selon votre navigateur :</p>
        <ul>
          <li>Chrome : Paramètres → Confidentialité et sécurité → Cookies</li>
          <li>Firefox : Paramètres → Vie privée et sécurité</li>
          <li>Safari : Préférences → Confidentialité</li>
          <li>Edge : Paramètres → Cookies et autorisations de site</li>
        </ul>
      </>
    ),
  },
  {
    id: 'opt-out',
    title: 'Opt-out et droit de retrait',
    body: (
      <>
        <p>
          Conformément à la Loi 25 et à la Directive ePrivacy européenne, vous avez le droit de refuser tout cookie non essentiel. Votre choix est respecté dès la première visite et mémorisé pendant 6 mois.
        </p>
        <p>Vous pouvez retirer votre consentement à tout moment en cliquant sur <em>« Préférences cookies »</em> en bas de page.</p>
      </>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <>
        <p>Pour toute question relative aux cookies, contactez notre RPRP :</p>
        <ul>
          <li>Courriel : <a href="mailto:dpo@intralys.com">dpo@intralys.com</a></li>
        </ul>
      </>
    ),
  },
];

export function CookiePolicyPage() {
  return (
    <LegalLayout
      pageTitle="Politique des cookies"
      subtitle="Les cookies et technologies similaires utilisés par Intralys."
      lastUpdated="15 mai 2026"
      sections={SECTIONS}
      metaTitle="Politique des cookies — Intralys CRM"
      metaDescription="Politique des cookies d'Intralys CRM. Types de cookies (essentiels, préférences, analytics), durée, gestion, opt-out. Aucun cookie tiers ni publicitaire."
      metaPath="/marketing/legal/cookies"
    />
  );
}

export default CookiePolicyPage;
