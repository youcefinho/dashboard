// ── Sprint 47 M2.1 — Pricing page Stripe SUBTLE ──────────────────────────────
// 3 plans Starter/Pro/Agency (29/49/99) + toggle monthly/annual + comparison
// table + FAQ accordion. Stripe paradigm strict : pas d'orbs, pas de gradients
// massifs, surfaces white + border-subtle + shadow-xs. FR québécois pro.
//
// Coexiste avec `landing/Pricing.tsx` (legacy, prix 47/97/197). Cette nouvelle
// version vit sous `/marketing/pricing` — wirée via App.tsx Sprint 47.

import { useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Check, X, Sparkles, ChevronDown } from 'lucide-react';
import { PublicLayout } from '../landing/PublicLayout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Tag } from '@/components/ui/Tag';
import { MarketingMeta } from './_meta';

type PlanId = 'starter' | 'pro' | 'agency';
type Billing = 'monthly' | 'annual';

interface PlanInfo {
  id: PlanId;
  name: string;
  tagline: string;
  priceMonthly: number;
  features: string[];
  popular?: boolean;
}

const PLANS: PlanInfo[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'Pour les indépendants',
    priceMonthly: 29,
    features: [
      "Jusqu'à 500 leads",
      '1 utilisateur',
      '1 pipeline',
      'Email + SMS',
      'Rapports basiques',
      'Application mobile',
      'Conformité Loi 25',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Pour PMEs grandissantes',
    priceMonthly: 49,
    popular: true,
    features: [
      "Jusqu'à 5 000 leads",
      "5 utilisateurs",
      '5 pipelines',
      'Email + SMS + WhatsApp + Facebook',
      'Rapports custom',
      'API complète',
      'Workflows illimités',
      'Onboarding inclus',
    ],
  },
  {
    id: 'agency',
    name: 'Agency',
    tagline: 'Pour agences multi-clients',
    priceMonthly: 99,
    features: [
      'Leads illimités',
      'Utilisateurs illimités',
      'Pipelines illimités',
      'White-label complet',
      'Multi-comptes (sub-accounts)',
      'Support prioritaire',
      'Onboarding dédié',
    ],
  },
];

// 30 features × 3 plans — feature matrix.
type FeatureCell = boolean | string;
interface FeatureRow {
  feature: string;
  starter: FeatureCell;
  pro: FeatureCell;
  agency: FeatureCell;
}
interface FeatureGroup {
  title: string;
  rows: FeatureRow[];
}

const FEATURE_MATRIX: FeatureGroup[] = [
  {
    title: 'Volumes & utilisateurs',
    rows: [
      { feature: 'Leads inclus', starter: '500', pro: '5 000', agency: 'Illimité' },
      { feature: 'Utilisateurs', starter: '1', pro: '5', agency: 'Illimité' },
      { feature: 'Pipelines', starter: '1', pro: '5', agency: 'Illimité' },
      { feature: 'Stockage documents', starter: '5 Go', pro: '50 Go', agency: '500 Go' },
    ],
  },
  {
    title: 'Canaux de communication',
    rows: [
      { feature: 'Email transactionnel', starter: true, pro: true, agency: true },
      { feature: 'SMS (Canada)', starter: true, pro: true, agency: true },
      { feature: 'WhatsApp Business', starter: false, pro: true, agency: true },
      { feature: 'Facebook Messenger', starter: false, pro: true, agency: true },
      { feature: 'Instagram DM', starter: false, pro: true, agency: true },
      { feature: 'Appels VoIP intégrés', starter: false, pro: false, agency: true },
    ],
  },
  {
    title: 'Automatisation',
    rows: [
      { feature: 'Workflows automatisés', starter: '3 actifs', pro: 'Illimité', agency: 'Illimité' },
      { feature: 'Modèles email/SMS', starter: '10', pro: '50', agency: 'Illimité' },
      { feature: 'AI assistant FR', starter: 'Basique', pro: 'Complet', agency: 'Complet + entraîné' },
      { feature: 'Lead scoring AI', starter: false, pro: true, agency: true },
      { feature: 'Smart drafts (réponses AI)', starter: false, pro: true, agency: true },
    ],
  },
  {
    title: 'Analyse & rapports',
    rows: [
      { feature: 'Rapports prédéfinis', starter: true, pro: true, agency: true },
      { feature: 'Rapports personnalisés', starter: false, pro: true, agency: true },
      { feature: 'Dashboards partagés (public)', starter: false, pro: true, agency: true },
      { feature: 'Export PDF/CSV', starter: 'PDF', pro: 'PDF + CSV', agency: 'PDF + CSV + API' },
    ],
  },
  {
    title: 'Intégrations',
    rows: [
      { feature: 'Calendrier (Google/Outlook)', starter: true, pro: true, agency: true },
      { feature: 'Stripe / Square (paiements)', starter: false, pro: true, agency: true },
      { feature: 'Zapier', starter: false, pro: true, agency: true },
      { feature: 'API REST publique', starter: false, pro: true, agency: true },
      { feature: 'Webhooks sortants', starter: false, pro: '20', agency: 'Illimité' },
    ],
  },
  {
    title: 'Sécurité & conformité',
    rows: [
      { feature: 'Loi 25 (Québec)', starter: true, pro: true, agency: true },
      { feature: 'CASL anti-spam', starter: true, pro: true, agency: true },
      { feature: 'Hébergement Canada', starter: true, pro: true, agency: true },
      { feature: 'SSO (Google / Microsoft)', starter: false, pro: false, agency: true },
      { feature: 'Audit logs', starter: false, pro: true, agency: true },
      { feature: 'SLA disponibilité 99,9%', starter: false, pro: false, agency: true },
    ],
  },
];

// 8 FAQ — FR québécois pro.
const FAQ: { q: string; a: string }[] = [
  {
    q: 'Puis-je changer de plan en cours de route ?',
    a: "Oui, tu peux upgrader ou downgrader ton plan à tout moment depuis tes paramètres de facturation. Le prorata est calculé automatiquement : si tu passes à un plan supérieur, on facture la différence au prorata du mois en cours ; si tu redescends, le crédit est appliqué sur ton prochain renouvellement.",
  },
  {
    q: "Que se passe-t-il à la fin de l'essai 14 jours ?",
    a: "Aucun prélèvement automatique. À la fin de l'essai de 14 jours, ton compte passe en lecture seule jusqu'à ce que tu choisisses un plan. Tes données restent intactes pendant 30 jours avant suppression définitive — tu ne perds rien.",
  },
  {
    q: 'Y a-t-il des frais cachés ?',
    a: "Non. Le prix affiché inclut toutes les fonctionnalités du plan, sans surprise. Les seuls coûts additionnels potentiels sont les envois SMS/WhatsApp au-delà des quotas inclus (refacturés au coût réel des opérateurs canadiens, sans markup) et les services d'onboarding sur mesure (optionnels).",
  },
  {
    q: 'Comment annuler mon abonnement ?',
    a: "En un clic depuis tes paramètres de facturation. Aucune justification demandée, aucun délai imposé. Tu gardes accès à ton plan jusqu'à la fin de la période payée, puis ton compte passe en lecture seule. Tu peux exporter toutes tes données en CSV ou JSON avant la fermeture.",
  },
  {
    q: 'Acceptez-vous les cartes de crédit canadiennes uniquement ?',
    a: "On accepte Visa, Mastercard, American Express et Discover de partout dans le monde. Pour les clients québécois et canadiens, on accepte aussi Interac e-Transfer pour les paiements annuels. Stripe traite tous les paiements de manière sécurisée (PCI-DSS niveau 1).",
  },
  {
    q: 'Les taxes (TPS/TVQ) sont-elles incluses ?',
    a: "Non, les prix affichés sont avant taxes. Pour les clients québécois, on ajoute la TPS (5%) et la TVQ (9,975%) à la facture. Pour les autres provinces canadiennes, on applique la TPS/TVH selon la juridiction. Les clients hors-Canada ne paient aucune taxe canadienne.",
  },
  {
    q: 'Comment migrer depuis un autre CRM ?',
    a: "On supporte l'import CSV natif (contacts, leads, deals, tâches, notes) avec mapping des champs assisté. Pour les migrations GoHighLevel, HubSpot, Pipedrive ou Zoho, on offre une assistance gratuite incluse dans le plan Pro et Agency. Notre équipe migre tes données en moins de 48h.",
  },
  {
    q: 'Mes données sont-elles hébergées au Canada ?',
    a: "Oui, 100% au Canada. On utilise Cloudflare D1 avec réplication primaire dans la région CA-Central (Toronto/Montréal). Aucune donnée transite par des serveurs américains. Conforme Loi 25 (Québec) et PIPEDA (fédéral). Nos sous-traitants traitant des renseignements personnels sont listés dans notre politique de confidentialité.",
  },
];

export function MarketingPricingPage() {
  const [billing, setBilling] = useState<Billing>('monthly');

  return (
    <PublicLayout>
      <MarketingMeta
        title="Tarification — Intralys CRM"
        description="Tarification simple et transparente : Starter 29$ / Pro 49$ / Agency 99$ par mois. Sans surprise, sans engagement. 14 jours d'essai gratuit."
        path="/marketing/pricing"
      />

      <div className="mk-pricing">
        {/* Hero */}
        <section className="mk-pricing__hero" aria-labelledby="mk-pricing-title">
          <h1 id="mk-pricing-title" className="mk-pricing__title">Tarification simple et transparente</h1>
          <p className="mk-pricing__sub">Sans surprise, sans engagement. 14 jours d'essai gratuit sur tous les plans.</p>

          {/* Toggle monthly / annual — renforcement a11y : navigation clavier
              ←/→ entre les onglets + annonce live region du cycle actif.
              Garde la sémantique tablist existante (cf. ARIA Tabs pattern). */}
          <div
            className="mk-billing-toggle"
            role="tablist"
            aria-label="Cycle de facturation"
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
                e.preventDefault();
                const next: Billing = e.key === 'Home' ? 'monthly'
                  : e.key === 'End' ? 'annual'
                    : billing === 'monthly' ? 'annual' : 'monthly';
                setBilling(next);
              }
            }}
          >
            <button
              type="button"
              role="tab"
              id="mk-billing-tab-monthly"
              aria-selected={billing === 'monthly'}
              aria-controls="mk-plans-panel"
              tabIndex={billing === 'monthly' ? 0 : -1}
              className={`mk-billing-toggle__btn${billing === 'monthly' ? ' mk-billing-toggle__btn--active' : ''}`}
              onClick={() => setBilling('monthly')}
            >
              Mensuel
            </button>
            <button
              type="button"
              role="tab"
              id="mk-billing-tab-annual"
              aria-selected={billing === 'annual'}
              aria-controls="mk-plans-panel"
              tabIndex={billing === 'annual' ? 0 : -1}
              className={`mk-billing-toggle__btn${billing === 'annual' ? ' mk-billing-toggle__btn--active' : ''}`}
              onClick={() => setBilling('annual')}
            >
              Annuel
              <span className="mk-billing-toggle__save" aria-hidden>−20%</span>
              <span className="sr-only">(économise 20%)</span>
            </button>
          </div>
          {/* Live region polite pour annoncer le changement de cycle aux
              technologies d'assistance. */}
          <p className="sr-only" aria-live="polite">
            {billing === 'monthly' ? 'Tarifs mensuels affichés' : 'Tarifs annuels affichés, économie de 20%'}
          </p>
        </section>

        {/* 3 cards plans — tabpanel pour le tablist Cycle facturation */}
        <section
          id="mk-plans-panel"
          className="mk-plans"
          aria-label="Plans tarifaires"
          role="tabpanel"
          aria-labelledby={billing === 'monthly' ? 'mk-billing-tab-monthly' : 'mk-billing-tab-annual'}
        >
          {PLANS.map((p) => (
            <PlanCard key={p.id} plan={p} billing={billing} />
          ))}
        </section>

        {/* Comparison table */}
        <section className="mk-compare" aria-label="Comparaison détaillée des plans">
          <h2 className="mk-section-title">Comparaison détaillée</h2>
          <p className="mk-section-sub">30 fonctionnalités à travers les 3 plans.</p>

          <div className="mk-compare__wrap">
            <table className="mk-compare__table">
              <caption className="sr-only">
                Comparaison détaillée des trois plans Starter, Pro et Agency sur 30 fonctionnalités regroupées en 6 catégories (volumes, communication, automatisation, analyse, intégrations, sécurité).
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="mk-compare__feature-col">Fonctionnalité</th>
                  <th scope="col">Starter</th>
                  <th scope="col" className="mk-compare__col-popular">
                    Pro
                    <Tag variant="warning" size="sm" className="ml-2">Populaire</Tag>
                  </th>
                  <th scope="col">Agency</th>
                </tr>
              </thead>
              <tbody>
                {FEATURE_MATRIX.map((group) => (
                  <FeatureGroupRows key={group.title} group={group} />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* FAQ accordion */}
        <section className="mk-faq" aria-label="Questions fréquentes">
          <h2 className="mk-section-title">Questions fréquentes</h2>
          <p className="mk-section-sub">Tout ce qu'il faut savoir avant de commencer.</p>

          <div className="mk-faq__list">
            {FAQ.map((item, i) => (
              <FaqItem key={i} q={item.q} a={item.a} />
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="mk-bottom-cta">
          <h2 className="mk-bottom-cta__title">Prêt à essayer Intralys ?</h2>
          <p className="mk-bottom-cta__sub">14 jours gratuits. Aucune carte de crédit requise.</p>
          <Link to="/demo">
            <Button variant="primary" size="lg">Commencer mon essai gratuit</Button>
          </Link>
        </section>
      </div>
    </PublicLayout>
  );
}

// ── PlanCard ────────────────────────────────────────────────
function PlanCard({ plan, billing }: { plan: PlanInfo; billing: Billing }) {
  const monthly = plan.priceMonthly;
  const displayPrice = billing === 'annual' ? Math.round(monthly * 0.8) : monthly;
  const annualTotal = billing === 'annual' ? Math.round(monthly * 0.8 * 12) : null;

  return (
    <article className={`mk-plan${plan.popular ? ' mk-plan--popular' : ''}`} aria-label={`Plan ${plan.name}`}>
      {plan.popular && (
        <div className="mk-plan__badge">
          <Icon as={Sparkles} size={11} />
          Populaire
        </div>
      )}
      <header className="mk-plan__header">
        <h3 className="mk-plan__name">{plan.name}</h3>
        <p className="mk-plan__tagline">{plan.tagline}</p>
      </header>

      <div
        className="mk-plan__price"
        aria-label={`${displayPrice} dollars canadiens par mois${
          annualTotal !== null ? `, soit ${annualTotal} dollars facturés annuellement` : ''
        }`}
      >
        <span className="mk-plan__price-amount" aria-hidden>
          <span className="mk-plan__currency">$</span>
          <span className="mk-plan__num">{displayPrice}</span>
        </span>
        <span className="mk-plan__period" aria-hidden>/mois</span>
      </div>
      {annualTotal !== null && (
        <p className="mk-plan__price-note" aria-hidden>{annualTotal}$ facturé annuellement</p>
      )}

      <Link to="/demo" className="mk-plan__cta-link">
        <Button variant={plan.popular ? 'primary' : 'secondary'} fullWidth>
          Commencer essai gratuit
        </Button>
      </Link>

      <ul className="mk-plan__features">
        {plan.features.map((f, i) => (
          <li key={i} className="mk-plan__feature">
            <Icon as={Check} size={14} className="mk-plan__check" aria-hidden />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

// ── Feature comparison rows ─────────────────────────────────
function FeatureGroupRows({ group }: { group: FeatureGroup }) {
  return (
    <>
      <tr className="mk-compare__group-row">
        <th colSpan={4} scope="colgroup" className="mk-compare__group-title">
          {group.title}
        </th>
      </tr>
      {group.rows.map((row, i) => (
        <tr key={i}>
          <th scope="row" className="mk-compare__feature-cell">{row.feature}</th>
          <FeatureValueCell value={row.starter} />
          <FeatureValueCell value={row.pro} popular />
          <FeatureValueCell value={row.agency} />
        </tr>
      ))}
    </>
  );
}

function FeatureValueCell({ value, popular }: { value: FeatureCell; popular?: boolean }) {
  if (typeof value === 'boolean') {
    return (
      <td className={popular ? 'mk-compare__col-popular' : ''}>
        {value ? (
          <Icon as={Check} size={16} className="mk-compare__yes" aria-label="Inclus" />
        ) : (
          <Icon as={X} size={16} className="mk-compare__no" aria-label="Non inclus" />
        )}
      </td>
    );
  }
  return (
    <td className={popular ? 'mk-compare__col-popular' : ''}>
      <span className="mk-compare__value">{value}</span>
    </td>
  );
}

// ── FAQ item (accordion) ────────────────────────────────────
// Renforcement a11y : aria-expanded explicite sur summary (les lecteurs
// d'écran l'annoncent même si <details> le fait nativement — ceinture +
// bretelles). Ajout aria-controls pour relier summary ↔ contenu.
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  // ID stable par instance pour aria-controls.
  const idRef = useRef<string>('');
  if (!idRef.current) {
    idRef.current = `mk-faq-${Math.random().toString(36).slice(2, 9)}`;
  }
  const contentId = `${idRef.current}-content`;

  return (
    <details
      className={`mk-faq__item${open ? ' mk-faq__item--open' : ''}`}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="mk-faq__q" aria-expanded={open} aria-controls={contentId}>
        <span>{q}</span>
        <Icon as={ChevronDown} size={16} className="mk-faq__chevron" aria-hidden />
      </summary>
      <p id={contentId} className="mk-faq__a">{a}</p>
    </details>
  );
}

// Default export pour compat lazy imports.
export default MarketingPricingPage;
