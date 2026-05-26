// ── ChatBotPage — Sprint 42 (Agent B1) ─────────────────────────────────────
// Page standalone routée `/settings/chat-bot` — wrap <ChatBotSettings />
// dans AppLayout + PageHero. Calque VoiceAgentPage (Sprint 41 B1).
//
// Style : Stripe-clean. Imports RELATIFS (cf. consigne Sprint 42).
// aria-labels via t(). Aucun console.log (CLAUDE.md).

import { AppLayout } from '../../components/layout/AppLayout';
import { PageHero } from '../../components/ui/PageHero';
import { ChatBotSettings } from '../../components/settings/ChatBotSettings';
import { t } from '../../lib/i18n';

export function ChatBotPage() {
  const title = t('chat_bot.title');
  return (
    <AppLayout title={title}>
      <PageHero
        meta="Workspace · AI"
        title={title}
        highlight={title}
        description={t('chat_bot.config.title')}
      />
      <ChatBotSettings />
    </AppLayout>
  );
}

export default ChatBotPage;
