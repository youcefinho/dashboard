// ── Sprint 47 M2.2 — Page dédiée conformité Loi 25 (Québec) ─────────────────
// Loi 25 = anc. Projet de loi 64, encadre les renseignements personnels au QC.
// Entrée en vigueur progressive sept 2022 / sept 2023 / sept 2024.

import { LegalLayout, type LegalSection } from './_LegalLayout';

const SECTIONS: LegalSection[] = [
  {
    id: 'quoi',
    title: "Qu'est-ce que la Loi 25 ?",
    body: (
      <>
        <p>
          La <strong>Loi 25</strong> (anciennement Projet de loi 64) est la <em>Loi modernisant des dispositions législatives en matière de protection des renseignements personnels</em>, adoptée par l'Assemblée nationale du Québec en septembre 2021.
        </p>
        <p>
          Elle modernise la <em>Loi sur la protection des renseignements personnels dans le secteur privé</em> en y intégrant des principes inspirés du RGPD européen, adaptés au contexte québécois.
        </p>
        <p>Son entrée en vigueur s'est faite en trois phases :</p>
        <ul>
          <li><strong>22 septembre 2022</strong> : désignation du Responsable de la protection des renseignements personnels, déclaration des incidents.</li>
          <li><strong>22 septembre 2023</strong> : consentement, transparence, droits des personnes concernées, EFVP.</li>
          <li><strong>22 septembre 2024</strong> : droit à la portabilité des données.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'champ',
    title: "Champ d'application",
    body: (
      <>
        <p>La Loi 25 s'applique à toute entreprise (publique ou privée) qui exploite des renseignements personnels au Québec, qu'elle soit basée au Québec ou ailleurs, dès lors qu'elle traite des données concernant des personnes au Québec.</p>
        <p>Intralys, en tant qu'entreprise québécoise traitant des renseignements de clients québécois, est entièrement soumise à la Loi 25.</p>
      </>
    ),
  },
  {
    id: 'engagements',
    title: "Engagements d'Intralys envers la Loi 25",
    body: (
      <>
        <h3>3.1 Désignation d'un RPRP</h3>
        <p>Intralys a désigné un Responsable de la protection des renseignements personnels (Rochdi Dahmani). Il est joignable à <a href="mailto:dpo@intralys.com">dpo@intralys.com</a> et publié sur ce site (article 3.1).</p>
        <h3>3.2 Politiques publiques</h3>
        <p>Notre Politique de confidentialité décrit en langage clair nos pratiques de gouvernance, accessibles en permanence (article 3.2).</p>
        <h3>3.3 Évaluations des facteurs relatifs à la vie privée (EFVP)</h3>
        <p>Avant l'acquisition, le développement ou la refonte de tout système d'information impliquant des renseignements personnels, nous réalisons une EFVP documentée (article 3.3).</p>
        <h3>3.4 Notification des incidents</h3>
        <p>En cas d'incident de confidentialité présentant un risque sérieux de préjudice, nous notifions la Commission d'accès à l'information et les personnes concernées dans les meilleurs délais (article 3.5).</p>
        <h3>3.5 Consentement granulaire</h3>
        <p>Le consentement est demandé séparément pour chaque finalité (transactionnel, marketing, partage), et peut être retiré à tout moment.</p>
        <h3>3.6 Communication hors Québec</h3>
        <p>Avant tout transfert de renseignements hors du Québec, nous évaluons que le destinataire offre une protection adéquate (article 17).</p>
        <h3>3.7 Décisions automatisées</h3>
        <p>Nous informons les personnes concernées lorsqu'une décision est fondée exclusivement sur un traitement automatisé, et leur offrons la possibilité de présenter des observations à un humain (article 12.1).</p>
      </>
    ),
  },
  {
    id: 'droits',
    title: 'Vos droits sous la Loi 25',
    body: (
      <>
        <ul>
          <li><strong>Accès</strong> (art. 27) : obtenir copie de vos renseignements et les fins auxquelles ils servent.</li>
          <li><strong>Rectification</strong> (art. 28) : faire corriger des renseignements inexacts, incomplets ou équivoques.</li>
          <li><strong>Désindexation et cessation de diffusion</strong> (art. 28.1) : limiter la diffusion publique.</li>
          <li><strong>Portabilité</strong> (art. 27, en vigueur sept 2024) : recevoir vos données dans un format technologique structuré et couramment utilisé.</li>
          <li><strong>Retrait du consentement</strong> : à tout moment, gratuitement.</li>
          <li><strong>Plainte</strong> auprès de la Commission d'accès à l'information.</li>
        </ul>
        <p>Pour exercer ces droits, écrivez à <a href="mailto:dpo@intralys.com">dpo@intralys.com</a>. Réponse garantie dans les 30 jours.</p>
      </>
    ),
  },
  {
    id: 'mesures',
    title: "Mesures techniques et organisationnelles",
    body: (
      <>
        <ul>
          <li>Hébergement 100% Canada (Cloudflare CA-Central);</li>
          <li>Chiffrement AES-256 au repos, TLS 1.3 en transit;</li>
          <li>Contrôle d'accès basé sur les rôles (RBAC) et journalisation;</li>
          <li>Authentification à deux facteurs (2FA) disponible;</li>
          <li>Sauvegardes chiffrées quotidiennes;</li>
          <li>Plan de continuité et de réponse aux incidents documenté;</li>
          <li>Formation périodique du personnel à la protection des renseignements personnels.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'sanctions',
    title: 'Sanctions et risques',
    body: (
      <>
        <p>La Loi 25 prévoit des sanctions administratives pécuniaires pouvant atteindre :</p>
        <ul>
          <li><strong>10 000 000 $ CAD</strong> ou 2% du chiffre d'affaires mondial pour une entreprise;</li>
          <li><strong>25 000 000 $ CAD</strong> ou 4% du chiffre d'affaires mondial en cas d'infraction grave.</li>
        </ul>
        <p>Intralys prend très au sérieux ses obligations et investit continuellement dans sa conformité.</p>
      </>
    ),
  },
  {
    id: 'ressources',
    title: 'Ressources externes',
    body: (
      <>
        <ul>
          <li><a href="https://www.cai.gouv.qc.ca" target="_blank" rel="noopener noreferrer">Commission d'accès à l'information du Québec (CAI)</a></li>
          <li><a href="https://www.legisquebec.gouv.qc.ca/fr/document/lc/P-39.1" target="_blank" rel="noopener noreferrer">Texte officiel de la Loi sur la protection des renseignements personnels dans le secteur privé</a></li>
          <li><a href="https://www.priv.gc.ca" target="_blank" rel="noopener noreferrer">Commissariat à la protection de la vie privée du Canada (LPRPDE/PIPEDA)</a></li>
        </ul>
      </>
    ),
  },
];

export function Loi25CompliancePage() {
  return (
    <LegalLayout
      pageTitle="Conformité Loi 25"
      subtitle="Nos engagements de protection des renseignements personnels au Québec."
      lastUpdated="15 mai 2026"
      sections={SECTIONS}
      metaTitle="Conformité Loi 25 — Intralys CRM"
      metaDescription="Comment Intralys CRM respecte la Loi 25 du Québec : RPRP, EFVP, notification d'incidents, consentement granulaire, droits d'accès et portabilité."
      metaPath="/marketing/legal/loi-25"
    />
  );
}

export default Loi25CompliancePage;
