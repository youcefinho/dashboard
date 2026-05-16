// ── Sprint 47 M2.2 — Politique de confidentialité Loi 25 ────────────────────
// FR québécois pro. Conforme Loi 25 (Québec) + PIPEDA (fédéral).
// Mentions explicites : DPO, Commission accès information QC, droits accès/rectif/suppression.

import { LegalLayout, type LegalSection } from './_LegalLayout';

const SECTIONS: LegalSection[] = [
  {
    id: 'introduction',
    title: 'Introduction',
    body: (
      <>
        <p>
          Intralys est une plateforme de gestion de relation client (CRM) destinée aux PMEs québécoises et canadiennes. Nous traitons des renseignements personnels conformément à la <strong>Loi 25</strong> du Québec (anciennement Projet de loi 64), en vigueur depuis septembre 2023, ainsi qu'à la <strong>LPRPDE (PIPEDA)</strong> fédérale.
        </p>
        <p>
          La présente Politique explique quels renseignements nous collectons, pourquoi, comment ils sont protégés, et quels sont vos droits.
        </p>
      </>
    ),
  },
  {
    id: 'responsable',
    title: "Responsable de la protection des renseignements personnels",
    body: (
      <>
        <p>
          Conformément à l'article 3.1 de la Loi sur la protection des renseignements personnels dans le secteur privé, Intralys a désigné un Responsable de la protection des renseignements personnels (RPRP), aussi appelé DPO (Data Protection Officer) :
        </p>
        <ul>
          <li><strong>Nom</strong> : Rochdi Dahmani</li>
          <li><strong>Fonction</strong> : Fondateur & RPRP</li>
          <li><strong>Courriel</strong> : <a href="mailto:dpo@intralys.com">dpo@intralys.com</a></li>
          <li><strong>Adresse postale</strong> : Intralys, Montréal, Québec, Canada</li>
        </ul>
        <p>Vous pouvez contacter le RPRP pour toute question relative au traitement de vos renseignements personnels, ou pour exercer vos droits (voir section 8).</p>
      </>
    ),
  },
  {
    id: 'collecte',
    title: 'Renseignements collectés',
    body: (
      <>
        <p>Nous collectons uniquement les renseignements nécessaires à la fourniture du service :</p>
        <h3>3.1 Renseignements fournis par l'Utilisateur</h3>
        <ul>
          <li>Nom, prénom, courriel, téléphone, nom de l'entreprise (à l'inscription);</li>
          <li>Adresse de facturation (pour la facturation);</li>
          <li>Renseignements de paiement (traités par Stripe, jamais stockés chez Intralys);</li>
          <li>Contenu généré : leads, notes, messages, documents téléversés.</li>
        </ul>
        <h3>3.2 Renseignements collectés automatiquement</h3>
        <ul>
          <li>Adresse IP, type de navigateur, système d'exploitation (à des fins de sécurité);</li>
          <li>Logs d'accès et d'activité (conservés 90 jours);</li>
          <li>Cookies essentiels (voir Politique cookies).</li>
        </ul>
        <h3>3.3 Renseignements relatifs aux prospects de l'Utilisateur</h3>
        <p>
          L'Utilisateur peut importer ou générer des renseignements concernant ses propres prospects (leads). Dans ce cas, Intralys agit comme <strong>sous-traitant</strong>; l'Utilisateur reste le responsable du traitement et garantit avoir le consentement requis des personnes concernées.
        </p>
      </>
    ),
  },
  {
    id: 'finalites',
    title: 'Finalités de la collecte',
    body: (
      <>
        <p>Vos renseignements sont collectés et utilisés uniquement pour :</p>
        <ul>
          <li>Créer et gérer votre Compte;</li>
          <li>Fournir, maintenir et améliorer la Plateforme;</li>
          <li>Vous contacter pour des notifications transactionnelles (factures, alertes sécurité);</li>
          <li>Garantir la sécurité et prévenir la fraude;</li>
          <li>Respecter nos obligations légales (fiscales, comptables);</li>
          <li>Vous envoyer des communications marketing, <em>uniquement avec votre consentement explicite</em> (opt-in CASL).</li>
        </ul>
        <p>Nous ne réalisons aucune décision automatisée produisant des effets juridiques sans intervention humaine.</p>
      </>
    ),
  },
  {
    id: 'partage',
    title: 'Partage et communication à des tiers',
    body: (
      <>
        <p>Intralys ne vend ni ne loue jamais vos renseignements personnels. Nous les communiquons uniquement à :</p>
        <h3>5.1 Sous-traitants techniques</h3>
        <ul>
          <li><strong>Cloudflare</strong> (hébergement, CDN, base de données D1) — région CA-Central (Canada);</li>
          <li><strong>Stripe</strong> (traitement des paiements) — PCI-DSS niveau 1;</li>
          <li><strong>Twilio / MessageBird</strong> (envoi SMS, WhatsApp) — selon les fonctionnalités activées;</li>
          <li><strong>Postmark / Resend</strong> (envoi email transactionnel).</li>
        </ul>
        <p>Tous nos sous-traitants sont liés par contrat à des obligations équivalentes à celles que nous appliquons.</p>
        <h3>5.2 Autorités légales</h3>
        <p>Nous pouvons divulguer des renseignements si la loi nous y oblige (mandat, ordonnance judiciaire), ou pour protéger nos droits, votre sécurité ou celle d'autrui.</p>
      </>
    ),
  },
  {
    id: 'hebergement',
    title: 'Hébergement et transferts hors Québec',
    body: (
      <>
        <p>
          Tous les renseignements personnels sont stockés sur des serveurs situés au <strong>Canada</strong> (région Cloudflare CA-Central, principalement Toronto et Montréal). Aucune réplication primaire n'a lieu hors du Canada.
        </p>
        <p>
          Conformément à l'article 17 de la Loi 25, avant toute communication de renseignements personnels à l'extérieur du Québec, nous procédons à une évaluation des facteurs relatifs à la vie privée (EFVP). Les rapports d'évaluation sont disponibles sur demande.
        </p>
      </>
    ),
  },
  {
    id: 'securite',
    title: 'Mesures de sécurité',
    body: (
      <>
        <p>Intralys met en œuvre des mesures techniques et organisationnelles raisonnables pour protéger vos renseignements :</p>
        <ul>
          <li>Chiffrement TLS 1.3 pour tous les transferts;</li>
          <li>Chiffrement AES-256 au repos (Cloudflare D1);</li>
          <li>Authentification à deux facteurs (2FA) disponible;</li>
          <li>Contrôle d'accès basé sur les rôles (RBAC);</li>
          <li>Audits de sécurité périodiques;</li>
          <li>Plan de réponse aux incidents avec notification dans les 72 heures conformément à l'article 3.5 de la Loi 25.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'droits',
    title: 'Vos droits',
    body: (
      <>
        <p>Conformément à la Loi 25, vous disposez des droits suivants sur vos renseignements personnels :</p>
        <ul>
          <li><strong>Droit d'accès</strong> : obtenir copie de vos renseignements;</li>
          <li><strong>Droit de rectification</strong> : corriger des renseignements inexacts;</li>
          <li><strong>Droit à la cessation de la diffusion</strong> : demander la suppression d'un lien indexant vos renseignements;</li>
          <li><strong>Droit à la portabilité</strong> : recevoir vos données dans un format structuré (CSV/JSON);</li>
          <li><strong>Droit de retrait du consentement</strong> : à tout moment, pour les traitements basés sur le consentement;</li>
          <li><strong>Droit de désindexation</strong> : auprès des moteurs de recherche pour certaines catégories.</li>
        </ul>
        <p>
          Pour exercer ces droits, contactez le RPRP à <a href="mailto:dpo@intralys.com">dpo@intralys.com</a>. Nous répondrons dans un délai maximal de <strong>30 jours</strong>.
        </p>
      </>
    ),
  },
  {
    id: 'conservation',
    title: 'Durée de conservation',
    body: (
      <>
        <p>Vos renseignements sont conservés pendant la durée nécessaire aux finalités pour lesquelles ils ont été collectés :</p>
        <ul>
          <li><strong>Compte actif</strong> : pendant toute la durée de l'abonnement;</li>
          <li><strong>Après résiliation</strong> : 30 jours pour récupération, puis suppression;</li>
          <li><strong>Données fiscales / facturation</strong> : 6 ans (obligation légale canadienne);</li>
          <li><strong>Logs de sécurité</strong> : 90 jours.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'plainte',
    title: 'Plainte auprès de la Commission',
    body: (
      <>
        <p>
          Si vous estimez que vos droits ne sont pas respectés, après avoir contacté notre RPRP, vous pouvez déposer une plainte auprès de la <strong>Commission d'accès à l'information du Québec (CAI)</strong> :
        </p>
        <ul>
          <li><strong>Site web</strong> : <a href="https://www.cai.gouv.qc.ca" target="_blank" rel="noopener noreferrer">www.cai.gouv.qc.ca</a></li>
          <li><strong>Téléphone</strong> : 1 888 528-7741 (sans frais au Québec)</li>
          <li><strong>Adresse</strong> : 525, boul. René-Lévesque Est, bureau 2.36, Québec (Québec) G1R 5S9</li>
        </ul>
        <p>
          Pour les plaintes de juridiction fédérale, vous pouvez également contacter le <strong>Commissariat à la protection de la vie privée du Canada</strong> à <a href="https://www.priv.gc.ca" target="_blank" rel="noopener noreferrer">www.priv.gc.ca</a>.
        </p>
      </>
    ),
  },
  {
    id: 'modifications',
    title: 'Modifications de la politique',
    body: (
      <>
        <p>
          Cette Politique peut être mise à jour pour refléter des changements légaux, techniques ou organisationnels. Toute modification substantielle sera notifiée aux Utilisateurs au moins 30 jours avant son entrée en vigueur, par courriel et bannière in-app.
        </p>
        <p>La date de dernière mise à jour figure en haut de cette page.</p>
      </>
    ),
  },
];

export function PrivacyPolicyPage() {
  return (
    <LegalLayout
      pageTitle="Politique de confidentialité"
      subtitle="Comment Intralys protège vos renseignements personnels (Loi 25, PIPEDA)."
      lastUpdated="15 mai 2026"
      sections={SECTIONS}
      metaTitle="Politique de confidentialité — Intralys CRM"
      metaDescription="Politique de confidentialité d'Intralys CRM. Conforme Loi 25 Québec et PIPEDA. Vos droits d'accès, rectification, portabilité, suppression. DPO contact."
      metaPath="/marketing/legal/privacy"
    />
  );
}

export default PrivacyPolicyPage;
