// ── Sprint 47 M2.2 — Page dédiée conformité CASL ────────────────────────────
// Canadian Anti-Spam Legislation — en vigueur depuis juillet 2014.

import { LegalLayout, type LegalSection } from './_LegalLayout';

const SECTIONS: LegalSection[] = [
  {
    id: 'quoi',
    title: "Qu'est-ce que la CASL ?",
    body: (
      <>
        <p>
          La <strong>CASL</strong> (Canadian Anti-Spam Legislation), au Québec et au Canada francophone aussi appelée <strong>LCAP</strong> (Loi canadienne anti-pourriel), est une loi fédérale entrée en vigueur le 1<sup>er</sup> juillet 2014.
        </p>
        <p>
          Elle encadre l'envoi de <strong>messages électroniques commerciaux</strong> (MEC) au Canada — courriels, SMS, messages instantanés. Sa mission : réduire le pourriel et protéger les consommateurs canadiens.
        </p>
      </>
    ),
  },
  {
    id: 'champ',
    title: "Champ d'application",
    body: (
      <>
        <p>La CASL s'applique à tout MEC envoyé à un destinataire canadien, qu'il soit envoyé depuis le Canada ou depuis l'étranger. Trois éléments sont requis :</p>
        <ol>
          <li><strong>Consentement</strong> du destinataire (exprès ou tacite);</li>
          <li><strong>Identification</strong> claire de l'expéditeur;</li>
          <li><strong>Mécanisme de désabonnement</strong> simple et fonctionnel.</li>
        </ol>
        <p>L'usage d'Intralys pour envoyer des communications marketing à des contacts canadiens engage l'Utilisateur à respecter ces règles.</p>
      </>
    ),
  },
  {
    id: 'consentement',
    title: 'Types de consentement',
    body: (
      <>
        <h3>3.1 Consentement exprès</h3>
        <p>
          La personne a explicitement accepté de recevoir des MEC (case à cocher non pré-cochée, signature, déclaration verbale enregistrée). Le consentement exprès est <strong>illimité dans le temps</strong>, jusqu'à ce qu'il soit retiré.
        </p>
        <h3>3.2 Consentement tacite</h3>
        <p>Présumé dans certaines situations (durée limitée) :</p>
        <ul>
          <li><strong>Relation d'affaires existante</strong> : 2 ans après dernière transaction;</li>
          <li><strong>Relation privée</strong> : 6 mois après dernière demande/renseignement;</li>
          <li><strong>Adresse publiée publiquement</strong> sans mention « pas de pourriel », pour un MEC pertinent à la fonction publiée.</li>
        </ul>
        <h3>3.3 MEC exemptés</h3>
        <p>Certains MEC sont exemptés (relation d'avocat-client, communications électorales, premier message à un contact recommandé par tiers, etc.).</p>
      </>
    ),
  },
  {
    id: 'identification',
    title: "Identification de l'expéditeur",
    body: (
      <>
        <p>Chaque MEC doit contenir :</p>
        <ul>
          <li>Le nom de l'entreprise (et nom commercial si différent);</li>
          <li>L'adresse postale physique valide;</li>
          <li>Une adresse courriel <em>ou</em> un numéro de téléphone <em>ou</em> une URL de contact.</li>
        </ul>
        <p>Intralys génère automatiquement le footer conforme dans chaque email envoyé via la plateforme, à partir des informations renseignées dans <em>Paramètres → Profil entreprise</em>.</p>
      </>
    ),
  },
  {
    id: 'desabonnement',
    title: 'Mécanisme de désabonnement',
    body: (
      <>
        <p>Tout MEC doit inclure un mécanisme simple, sans frais, fonctionnant pendant au moins 60 jours. Intralys ajoute automatiquement :</p>
        <ul>
          <li>Un lien <em>« Se désabonner »</em> dans chaque email marketing;</li>
          <li>La possibilité de répondre <em>STOP</em> à un SMS pour se désabonner;</li>
          <li>Le traitement des désabonnements dans un délai maximum de <strong>10 jours ouvrables</strong>.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'fonctionnalites',
    title: "Fonctionnalités CASL d'Intralys",
    body: (
      <>
        <p>Intralys intègre nativement les outils suivants pour vous aider à rester conforme :</p>
        <ul>
          <li><strong>Champ Consentement</strong> sur chaque contact (exprès / tacite / aucun) avec date et source;</li>
          <li><strong>Compteur de fenêtre tacite</strong> : alerte 30 jours avant expiration du consentement tacite;</li>
          <li><strong>Footer auto-généré</strong> : nom entreprise + adresse + courriel + lien désabonnement dans chaque email;</li>
          <li><strong>Blocage automatique</strong> : impossibilité d'envoyer un MEC à un contact sans consentement;</li>
          <li><strong>Audit log</strong> : trace de chaque consentement collecté (preuve en cas de plainte);</li>
          <li><strong>Bouton STOP SMS</strong> : géré automatiquement par notre intégration Twilio/MessageBird.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'sanctions',
    title: 'Sanctions en cas de non-conformité',
    body: (
      <>
        <p>Les sanctions prévues par la CASL sont très élevées :</p>
        <ul>
          <li>Jusqu'à <strong>1 000 000 $ CAD</strong> pour une personne physique;</li>
          <li>Jusqu'à <strong>10 000 000 $ CAD</strong> pour une entreprise.</li>
        </ul>
        <p>De plus, depuis juillet 2017, les personnes affectées peuvent intenter un recours civil privé contre les contrevenants.</p>
      </>
    ),
  },
  {
    id: 'responsabilite',
    title: "Responsabilité de l'Utilisateur",
    body: (
      <>
        <p>
          Intralys fournit les outils techniques pour respecter la CASL, mais c'est l'<strong>Utilisateur</strong> qui demeure responsable de la légalité des messages qu'il envoie. En tant qu'expéditeur, vous devez :
        </p>
        <ul>
          <li>Obtenir un consentement valide avant d'envoyer;</li>
          <li>Documenter la source et la date du consentement;</li>
          <li>Respecter les demandes de désabonnement;</li>
          <li>Vérifier que vos campagnes respectent le cadre légal de la juridiction de destination.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'ressources',
    title: 'Ressources officielles',
    body: (
      <>
        <ul>
          <li><a href="https://crtc.gc.ca/fra/internet/anti.htm" target="_blank" rel="noopener noreferrer">Conseil de la radiodiffusion et des télécommunications canadiennes (CRTC) — Loi anti-pourriel</a></li>
          <li><a href="https://combattrelepourriel.gc.ca" target="_blank" rel="noopener noreferrer">Site officiel Combattre le pourriel</a></li>
          <li><a href="https://laws-lois.justice.gc.ca/fra/lois/E-1.6/" target="_blank" rel="noopener noreferrer">Texte de loi officiel</a></li>
        </ul>
      </>
    ),
  },
];

export function CaslCompliancePage() {
  return (
    <LegalLayout
      pageTitle="Conformité CASL"
      subtitle="Loi canadienne anti-pourriel : nos outils pour rester conforme."
      lastUpdated="15 mai 2026"
      sections={SECTIONS}
      metaTitle="Conformité CASL — Intralys CRM"
      metaDescription="Comment Intralys CRM respecte la CASL (Canadian Anti-Spam Legislation) : consentement exprès/tacite, identification, mécanisme désabonnement automatique."
      metaPath="/marketing/legal/casl"
    />
  );
}

export default CaslCompliancePage;
