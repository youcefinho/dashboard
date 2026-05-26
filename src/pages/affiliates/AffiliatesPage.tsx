// ── AffiliatesPage — Sprint 49 (Agent B2) ────────────────────────────────────
//
// Page principale du module affiliation order-based (LOT AFFILIATES S49,
// seq144). Compose AppLayout + PageHero + 3 onglets :
//   1. Affiliés       — <AffiliatesManager /> (B1) : liste/CRUD/metrics
//   2. Référencements — <ReferralsTable />    (B3) : confirm / reverse
//   3. Versements     — <PayoutsManager />   (B2) : createBatch / markPaid
//
// Route : `/affiliates` (déclarée dans src/App.tsx, lazy via LazyGuard). Le
// redirect public /r/:code est 100% worker (302) — aucune route React.
//
// i18n  : namespace `affiliates.*` (FIGÉ Phase A, parité 4 catalogues côté
// Manager-A). Aria-labels traduits.
// Style : Stripe-clean (PageHero sobre + Tabs underline). Imports RELATIFS
// (consigne agent B2 sprint 49).

import { useMemo, useState } from 'react';
import { Users, Share2, DollarSign } from 'lucide-react';
import { AppLayout } from '../../components/layout/AppLayout';
import { PageHero } from '../../components/ui/PageHero';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '../../components/ui/Tabs';
import { t } from '../../lib/i18n';
import { AffiliatesManager } from '../../components/affiliates/AffiliatesManager';
import { ReferralsTable } from '../../components/affiliates/ReferralsTable';
import { PayoutsManager } from '../../components/affiliates/PayoutsManager';

type AffiliatesTab = 'affiliates' | 'referrals' | 'payouts';

export function AffiliatesPage() {
  const [tab, setTab] = useState<AffiliatesTab>('affiliates');

  const title = t('affiliates.title');

  // Description du header selon l'onglet courant (PageHero `description`).
  // On résout via useMemo pour éviter le recalcul à chaque render mineur.
  const description = useMemo(() => {
    switch (tab) {
      case 'affiliates':
        return t('affiliates.empty');
      case 'referrals':
        return t('affiliates.referrals.empty');
      case 'payouts':
        return t('affiliates.payouts.empty');
      default:
        return '';
    }
  }, [tab]);

  return (
    <AppLayout title={title}>
      <div className="p-6">
        <PageHero
          meta={t('affiliates.referrals.title')}
          title={title}
          description={description}
        />

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as AffiliatesTab)}
          aria-label={title}
        >
          <TabsList aria-label={`Sections de ${title}`}>
            <TabsTrigger
              value="affiliates"
              aria-label={t('affiliates.title')}
            >
              <span className="inline-flex items-center gap-2">
                <Users className="w-4 h-4" aria-hidden="true" />
                {t('affiliates.title')}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="referrals"
              aria-label={t('affiliates.referrals.title')}
            >
              <span className="inline-flex items-center gap-2">
                <Share2 className="w-4 h-4" aria-hidden="true" />
                {t('affiliates.referrals.title')}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="payouts"
              aria-label={t('affiliates.payouts.title')}
            >
              <span className="inline-flex items-center gap-2">
                <DollarSign className="w-4 h-4" aria-hidden="true" />
                {t('affiliates.payouts.title')}
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="affiliates">
            <AffiliatesManager />
          </TabsContent>

          <TabsContent value="referrals">
            <ReferralsTable />
          </TabsContent>

          <TabsContent value="payouts">
            <PayoutsManager />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
