// ── VoiceAgentPage — Sprint 41 (Agent B1) ──────────────────────────────────
// Page standalone routée `/settings/voice-agent` — wrap <VoiceAgentSettings />
// dans AppLayout + PageHero. Calque CurrencyMultiSettingsPage (Sprint 39 B4).
//
// Style : Stripe-clean. Imports RELATIFS (cf. consigne Sprint 41).
// aria-labels via t(). Aucun console.log (CLAUDE.md).

import { AppLayout } from '../../components/layout/AppLayout';
import { PageHero } from '../../components/ui/PageHero';
import { VoiceAgentSettings } from '../../components/settings/VoiceAgentSettings';
import { t } from '../../lib/i18n';

export function VoiceAgentPage() {
  const title = t('voice_agent.title');
  return (
    <AppLayout title={title}>
      <PageHero
        meta="Workspace · AI"
        title={title}
        highlight={title}
        description={t('voice_agent.calls.title')}
      />
      <VoiceAgentSettings />
    </AppLayout>
  );
}

export default VoiceAgentPage;
