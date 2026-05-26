// ── PublicTicketForm — formulaire public d'ouverture de ticket (LOT G1) ────
//
// Phase B Manager-C (front exclusif). Page PUBLIQUE (hors LazyGuard/auth) :
// visiteur anonyme soumet une demande de support via publicSubmitTicket (calque
// PublicForm — page standalone, pas de chrome app). Écran de confirmation après
// succès. i18n t('ticket.public.*') — clés figées Phase A. slug tenant dans l'URL.

import { useState, type FormEvent } from 'react';
import { useParams } from '@tanstack/react-router';
import { Button, Card, Input, Textarea } from '@/components/ui';
import { CheckCircle2, Mail, Phone } from 'lucide-react';
import { publicSubmitTicket } from '@/lib/api';
import { t } from '@/lib/i18n';

export function PublicTicketFormPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError('');
    if (!email.trim() || !subject.trim() || !body.trim()) {
      setError(t('ticket.public.error'));
      return;
    }
    setSubmitting(true);
    const res = await publicSubmitTicket({
      slug,
      requester_name: name.trim() || undefined,
      requester_email: email.trim(),
      requester_phone: phone.trim() || undefined,
      subject: subject.trim(),
      body: body.trim(),
    });
    setSubmitting(false);
    if (res.error) {
      setError(t('ticket.public.error'));
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-transparent font-inter">
        <Card className="w-full max-w-md text-center p-8 border-none shadow-none bg-transparent">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{
              background: 'var(--success-soft)',
              color: 'var(--success)',
            }}
          >
            <CheckCircle2 size={30} strokeWidth={1.75} />
          </div>
          <h2 className="text-xl font-bold mb-2 text-[var(--text-primary)]">
            {t('ticket.public.success')}
          </h2>
          <p className="text-[10px] text-[var(--text-muted)] pt-4">
            Propulsé par <strong>Intralys</strong>
          </p>
        </Card>
      </div>
    );
  }

  const labelClasses = 'mb-1 block text-sm font-medium text-[var(--text-secondary)]';

  return (
    <div className="min-h-screen bg-transparent p-4 flex justify-center items-start font-inter">
      <Card className="w-full max-w-lg border-none shadow-none bg-transparent">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-2">
            {t('ticket.public.title')}
          </h1>
          <p className="text-[var(--text-muted)] mb-6 text-sm">
            Décrivez votre demande, nous vous répondrons sous peu.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className={labelClasses} htmlFor="ptf-name">
                {t('ticket.col.requester')}
              </label>
              <Input
                id="ptf-name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nom complet"
              />
            </div>
            <div>
              <label className={labelClasses} htmlFor="ptf-email">
                Courriel <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <Input
                id="ptf-email"
                type="email"
                name="email"
                required
                leftIcon={<Mail size={16} />}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
              />
            </div>
            <div>
              <label className={labelClasses} htmlFor="ptf-phone">
                Téléphone
              </label>
              <Input
                id="ptf-phone"
                type="tel"
                name="phone"
                leftIcon={<Phone size={16} />}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(514) 000-0000"
              />
            </div>
            <div>
              <label className={labelClasses} htmlFor="ptf-subject">
                {t('ticket.col.subject')} <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <Input
                id="ptf-subject"
                name="subject"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Résumé de votre demande"
              />
            </div>
            <div>
              <label className={labelClasses} htmlFor="ptf-body">
                Message <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <Textarea
                id="ptf-body"
                name="body"
                required
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Détaillez votre demande…"
                rows={5}
              />
            </div>

            {error && (
              <p className="text-sm" style={{ color: 'var(--danger)' }} role="alert">
                {error}
              </p>
            )}

            <div className="pt-2">
              <Button
                type="submit"
                variant="primary"
                className="w-full text-base py-3"
                isLoading={submitting}
              >
                {t('ticket.public.submit')}
              </Button>
            </div>

            <p className="text-center text-[10px] text-[var(--text-muted)] pt-2">
              Propulsé par <strong>Intralys</strong>
            </p>
          </form>
        </div>
      </Card>
    </div>
  );
}
