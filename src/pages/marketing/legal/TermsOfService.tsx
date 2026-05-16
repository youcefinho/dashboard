// ── Sprint 47 M2.2 — Conditions d'utilisation ────────────────────────────────
// FR québécois professionnel. 12 sections. Coexiste avec /legal/terms legacy.

import { LegalLayout, type LegalSection } from './_LegalLayout';

const SECTIONS: LegalSection[] = [
  {
    id: 'preambule',
    title: 'Préambule et acceptation',
    body: (
      <>
        <p>
          Les présentes Conditions d'utilisation (ci-après les <strong>« Conditions »</strong>) régissent l'accès et l'utilisation de la plateforme Intralys CRM (ci-après la <strong>« Plateforme »</strong>), exploitée par Intralys, une entreprise enregistrée au Québec, Canada.
        </p>
        <p>
          En créant un compte ou en accédant à la Plateforme, vous (ci-après l'<strong>« Utilisateur »</strong>) reconnaissez avoir lu, compris et accepté sans réserve les présentes Conditions. Si vous représentez une organisation, vous garantissez avoir l'autorité pour engager celle-ci.
        </p>
        <p>
          Si vous n'acceptez pas ces Conditions, vous devez cesser immédiatement toute utilisation de la Plateforme.
        </p>
      </>
    ),
  },
  {
    id: 'definitions',
    title: 'Définitions',
    body: (
      <>
        <ul>
          <li><strong>Compte</strong> : espace personnel créé par l'Utilisateur pour accéder à la Plateforme.</li>
          <li><strong>Contenu Utilisateur</strong> : toute donnée, fichier, message ou information téléversée ou générée par l'Utilisateur.</li>
          <li><strong>Services</strong> : ensemble des fonctionnalités CRM offertes (gestion des leads, automatisation, rapports, etc.).</li>
          <li><strong>Abonnement</strong> : formule de souscription mensuelle ou annuelle choisie par l'Utilisateur.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'eligibilite',
    title: 'Éligibilité et création de compte',
    body: (
      <>
        <p>L'Utilisateur doit être âgé d'au moins 18 ans et avoir la capacité juridique de contracter pour utiliser la Plateforme.</p>
        <p>L'Utilisateur s'engage à fournir des informations exactes et à jour lors de la création du Compte. Toute information fausse, incomplète ou trompeuse peut entraîner la suspension ou la résiliation immédiate du Compte.</p>
        <p>L'Utilisateur est seul responsable de la confidentialité de ses identifiants de connexion et de toute activité effectuée depuis son Compte.</p>
      </>
    ),
  },
  {
    id: 'utilisation',
    title: 'Utilisation acceptable',
    body: (
      <>
        <p>L'Utilisateur s'engage à utiliser la Plateforme conformément aux lois en vigueur au Québec et au Canada, notamment :</p>
        <ul>
          <li>La Loi sur la protection des renseignements personnels dans le secteur privé (Loi 25);</li>
          <li>La Loi canadienne anti-pourriel (LCAP / CASL);</li>
          <li>Le Code civil du Québec;</li>
          <li>Toute autre loi applicable.</li>
        </ul>
        <p>Sont strictement interdits :</p>
        <ul>
          <li>L'envoi de messages non sollicités (spam) sans consentement préalable;</li>
          <li>L'utilisation de la Plateforme à des fins illégales, frauduleuses ou trompeuses;</li>
          <li>La tentative d'accès non autorisé à d'autres comptes ou à l'infrastructure;</li>
          <li>La rétro-ingénierie, le scraping automatisé ou la copie du code source;</li>
          <li>L'utilisation pour distribuer des virus ou contenus malveillants.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'tarification',
    title: 'Tarification, facturation et taxes',
    body: (
      <>
        <p>Les tarifs des abonnements sont publiés sur la page Tarification et peuvent être modifiés avec un préavis de 30 jours par courriel.</p>
        <p>
          La facturation s'effectue à terme échu, en dollars canadiens (CAD), sur le moyen de paiement enregistré. Les taxes applicables (TPS 5%, TVQ 9,975% pour les clients québécois) sont ajoutées à la facture conformément à la législation fiscale canadienne.
        </p>
        <p>
          Tout défaut de paiement supérieur à 14 jours peut entraîner la suspension de l'accès au Compte jusqu'à régularisation.
        </p>
      </>
    ),
  },
  {
    id: 'essai',
    title: "Période d'essai gratuite",
    body: (
      <>
        <p>
          Intralys offre une période d'essai de 14 jours sans engagement et sans saisie de carte de crédit. À l'issue de cette période, le Compte passe automatiquement en mode lecture seule si aucun plan n'a été souscrit.
        </p>
        <p>
          Les données de l'Utilisateur sont conservées intactes pendant 30 jours après la fin de l'essai. Au-delà, elles peuvent être supprimées définitivement.
        </p>
      </>
    ),
  },
  {
    id: 'donnees',
    title: 'Données et propriété intellectuelle',
    body: (
      <>
        <p>
          L'Utilisateur conserve l'entière propriété du Contenu Utilisateur. En téléversant du contenu sur la Plateforme, il accorde à Intralys une licence limitée, non exclusive et révocable, strictement nécessaire à l'exploitation du Service.
        </p>
        <p>
          Intralys conserve tous les droits relatifs à la Plateforme elle-même : code source, design, marques, logos, documentation. Toute reproduction non autorisée est interdite.
        </p>
        <p>L'Utilisateur peut exporter ses données à tout moment au format CSV ou JSON.</p>
      </>
    ),
  },
  {
    id: 'confidentialite',
    title: 'Confidentialité et Loi 25',
    body: (
      <>
        <p>
          Intralys traite les renseignements personnels conformément à la Loi 25 du Québec et à sa Politique de confidentialité, accessible sur la Plateforme.
        </p>
        <p>
          Intralys agit en qualité de sous-traitant lorsqu'elle traite les renseignements personnels des prospects et clients de l'Utilisateur. L'Utilisateur agit en qualité de responsable du traitement de ces données.
        </p>
      </>
    ),
  },
  {
    id: 'disponibilite',
    title: 'Disponibilité du service',
    body: (
      <>
        <p>
          Intralys s'engage à maintenir une disponibilité du service de 99,5% en moyenne mensuelle (99,9% pour les abonnés Agency, avec SLA dédié).
        </p>
        <p>
          Des interruptions planifiées peuvent survenir pour maintenance, annoncées au minimum 48 heures à l'avance par courriel ou via la bannière d'application.
        </p>
        <p>
          Intralys ne saurait être tenue responsable des interruptions causées par des cas de force majeure ou par des défaillances de fournisseurs tiers (Cloudflare, opérateurs SMS, etc.).
        </p>
      </>
    ),
  },
  {
    id: 'responsabilite',
    title: 'Limitation de responsabilité',
    body: (
      <>
        <p>
          Dans toute la mesure permise par la loi, la responsabilité totale d'Intralys envers l'Utilisateur, tous dommages confondus, est limitée au montant des sommes effectivement payées par l'Utilisateur au cours des 12 mois précédant le fait générateur.
        </p>
        <p>
          Intralys ne saurait être tenue responsable des dommages indirects, perte de profits, perte de clientèle, ou interruption d'activité.
        </p>
      </>
    ),
  },
  {
    id: 'resiliation',
    title: "Résiliation et fermeture de compte",
    body: (
      <>
        <p>
          L'Utilisateur peut résilier son abonnement à tout moment depuis ses paramètres de facturation. La résiliation prend effet à la fin de la période payée. Aucun remboursement prorata n'est effectué, sauf disposition légale contraire.
        </p>
        <p>
          Intralys peut résilier ou suspendre un Compte sans préavis en cas de violation grave des présentes Conditions, d'activité illégale ou de non-paiement persistant.
        </p>
        <p>
          Après résiliation, les données sont conservées 30 jours à des fins de récupération, puis supprimées définitivement.
        </p>
      </>
    ),
  },
  {
    id: 'droit-applicable',
    title: 'Droit applicable et juridiction',
    body: (
      <>
        <p>
          Les présentes Conditions sont régies par les lois en vigueur dans la province de Québec et les lois fédérales du Canada applicables.
        </p>
        <p>
          Tout litige relatif à l'interprétation ou à l'exécution des présentes Conditions sera soumis à la compétence exclusive des tribunaux du district judiciaire de Montréal, Québec.
        </p>
        <p>
          Pour toute question relative aux présentes Conditions, contactez-nous à <a href="mailto:legal@intralys.com">legal@intralys.com</a>.
        </p>
      </>
    ),
  },
];

export function TermsOfServicePage() {
  return (
    <LegalLayout
      pageTitle="Conditions d'utilisation"
      subtitle="Les règles qui encadrent l'utilisation d'Intralys CRM."
      lastUpdated="15 mai 2026"
      sections={SECTIONS}
      metaTitle="Conditions d'utilisation — Intralys CRM"
      metaDescription="Conditions d'utilisation de la plateforme Intralys CRM. Règles d'usage, tarification, confidentialité, résiliation. Conforme au droit québécois."
      metaPath="/marketing/legal/terms"
    />
  );
}

export default TermsOfServicePage;
