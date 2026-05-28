// ── NewTicketModal — création d'un ticket de support (LOT G1 HELPDESK) ──────
// Enfant additif de TicketsPage : modale (Modal — primitive Radix Dialog) avec
// formulaire de création — subject, body/description, priority, et liens
// optionnels lead_id / client_id. Appelle createTicket(Partial<Ticket>) puis
// notifie le parent (onCreated) pour rafraîchir la liste. 100 % additif :
// aucune modification des helpers api / catalogues i18n.
//
// i18n : clés NEW sous t('ticketsx.*') (catalogues à compléter hors-code) ;
// réutilise les clés figées 'ticket.*' / 'common.*' existantes.

import { useEffect, useState, type FormEvent } from 'react';
import { Button, Input, Modal, Select, Textarea } from '@/components/ui';
import { createTicket, type Ticket } from '@/lib/api';
import { t } from '@/lib/i18n';

// Priorités v1 — enum applicatif (Ticket.priority est un string libre côté API).
const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'urgent'] as const;
type Priority = (typeof PRIORITY_OPTIONS)[number];

export interface NewTicketModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Appelé après création réussie (id du ticket créé) — le parent recharge. */
  onCreated: (id: string) => void;
}

export function NewTicketModal({ open, onOpenChange, onCreated }: NewTicketModalProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [leadId, setLeadId] = useState('');
  const [clientId, setClientId] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Validation inline — touched déclenche l'affichage des messages.
  const [touched, setTouched] = useState(false);

  // Reset complet à chaque ouverture (formulaire vierge).
  useEffect(() => {
    if (open) {
      setSubject('');
      setBody('');
      setPriority('normal');
      setLeadId('');
      setClientId('');
      setSubmitting(false);
      setSubmitError(null);
      setTouched(false);
    }
  }, [open]);

  const subjectError = !subject.trim() ? t('ticketsx.create.subject_required') : '';
  const isValid = !subjectError;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // Garde anti-double-submit : ignore les events tant que la requête vit.
    if (submitting) return;
    setTouched(true);
    if (!isValid) return;

    setSubmitting(true);
    setSubmitError(null);

    const payload: Partial<Ticket> = {
      subject: subject.trim(),
      body: body.trim() || null,
      priority,
      status: 'ouvert',
    };
    const lead = leadId.trim();
    const client = clientId.trim();
    if (lead) payload.lead_id = lead;
    if (client) payload.client_id = client;

    try {
      const res = await createTicket(payload);
      if (res.error || !res.data || !res.data.id) {
        setSubmitError(res.error || t('common.error.load_failed'));
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      // Isole une éventuelle exception du parent : la création est déjà
      // un succès côté API, on ne doit pas l'inverser en erreur de soumission.
      try {
        onCreated(res.data.id);
      } catch {
        /* parent callback failure swallowed — ticket already created */
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      setSubmitError(t('common.error.load_failed'));
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      // Bloque la fermeture pendant la soumission pour éviter d'orphaner
      // une requête déjà en vol côté API.
      onOpenChange={(next) => {
        if (!next && submitting) return;
        onOpenChange(next);
      }}
      size="md"
      title={t('ticketsx.create.title')}
      description={t('ticketsx.create.subtitle')}
      closeLabel={t('common.close')}
    >
      <form
        onSubmit={submit}
        noValidate
        aria-busy={submitting}
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        {/* Erreur de soumission — role="alert" (a11y) */}
        {submitError && (
          <div
            role="alert"
            style={{
              borderRadius: 'var(--radius-md)',
              border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
              background: 'var(--danger-soft)',
              padding: '10px 14px',
              fontSize: 13,
              color: 'var(--danger)',
            }}
          >
            {submitError}
          </div>
        )}

        <Input
          label={t('ticketsx.create.subject_label')}
          placeholder={t('ticketsx.create.subject_placeholder')}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onBlur={() => setTouched(true)}
          error={touched ? subjectError : ''}
          required
          autoFocus
        />

        <Textarea
          label={t('ticketsx.create.description_label')}
          placeholder={t('ticketsx.create.description_placeholder')}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
        />

        <Select
          label={t('ticketsx.create.priority_label')}
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority)}
        >
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {t(`ticketsx.priority.${p}`)}
            </option>
          ))}
        </Select>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <Input
            containerClassName="flex-1 min-w-[180px]"
            label={t('ticketsx.create.lead_label')}
            helper={t('ticketsx.create.link_helper')}
            placeholder={t('ticketsx.create.lead_placeholder')}
            value={leadId}
            onChange={(e) => setLeadId(e.target.value)}
          />
          <Input
            containerClassName="flex-1 min-w-[180px]"
            label={t('ticketsx.create.client_label')}
            placeholder={t('ticketsx.create.client_placeholder')}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            paddingTop: 4,
          }}
        >
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t('ticketsx.create.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            isLoading={submitting}
            disabled={submitting || (touched && !isValid)}
            aria-disabled={submitting || (touched && !isValid) || undefined}
          >
            {t('ticketsx.create.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
