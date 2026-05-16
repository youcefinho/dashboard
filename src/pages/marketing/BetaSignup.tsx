// ── Sprint 50 M3.1 — Beta signup page publique (/beta) ──────────────────────
// Liste d'attente beta privée. Stripe SUBTLE strict (pas glow/orb/gradient).
// ⚠️ Loi 25 / CASL : consentement explicite obligatoire + finalité claire.

import { useEffect, useState, type FormEvent } from 'react';
import { Send, Loader2, CheckCircle2, Users } from 'lucide-react';
import { PublicLayout } from '../landing/PublicLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { MarketingMeta } from './_meta';

const INDUSTRIES = [
  'Immobilier',
  'Services professionnels',
  'Construction / Rénovation',
  'Santé / Bien-être',
  'Commerce de détail',
  'Restauration / Hôtellerie',
  'Technologie',
  'Organisme / OBNL',
  'Autre',
];

const TEAM_SIZES = ['Solo', '2-5', '6-20', '20+'];

export function BetaSignupPage() {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [industry, setIndustry] = useState(INDUSTRIES[0]!);
  const [teamSize, setTeamSize] = useState('Solo');
  const [useCase, setUseCase] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/beta/count')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && (j as { data?: { count?: number } })?.data?.count) setCount((j as { data: { count: number } }).data.count); })
      .catch(() => { /* social proof best-effort */ });
    return () => { alive = false; };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!consent) {
      toast.error('Coche la case de consentement pour rejoindre la liste.', { title: 'Consentement requis' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/beta/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, company, industry, teamSize, useCase, consent }),
      });
      if (res.ok) {
        setDone(true);
        toast.success('Merci ! On te contacte sous 48h.', { title: 'Inscription reçue' });
        setCount((c) => (c === null ? c : c + 1));
      } else {
        const j = await res.json().catch(() => ({})) as { error?: string };
        toast.error(j?.error || "L'inscription n'a pas pu être enregistrée.", { title: 'Erreur' });
      }
    } catch {
      toast.error('Vérifie ta connexion et réessaye.', { title: 'Erreur réseau' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PublicLayout>
      <MarketingMeta
        title="Beta privée — Intralys CRM"
        description="Rejoins la beta privée d'Intralys, le CRM tout-en-un pour les PMEs francophones du Québec. Places limitées."
        path="/beta"
      />

      <div className="mk-beta">
        <header className="mk-beta__header">
          <span className="mk-beta__eyebrow">Beta privée · sur invitation</span>
          <h1 className="mk-beta__title">Rejoins la beta privée Intralys</h1>
          <p className="mk-beta__sub">
            Le CRM tout-en-un pensé pour les PMEs francophones du Québec. On
            ouvre les portes graduellement — laisse-nous tes infos, on te
            contacte sous 48h.
          </p>
          {count !== null && (
            <div className="mk-beta__social" aria-live="polite">
              <Icon as={Users} size={15} className="mk-beta__social-icon" aria-hidden />
              Déjà <strong>{count}</strong> PMEs québécoises sur la liste d'attente
            </div>
          )}
        </header>

        {done ? (
          <div className="mk-beta__success" role="status">
            <span className="mk-beta__success-icon">
              <Icon as={CheckCircle2} size={28} aria-hidden />
            </span>
            <h2 className="mk-beta__success-title">C'est noté, merci !</h2>
            <p className="mk-beta__success-text">
              On revient vers toi sous 48h avec les prochaines étapes. Surveille
              ta boîte courriel (et tes pourriels, au cas où).
            </p>
          </div>
        ) : (
          <form className="mk-beta__form" onSubmit={handleSubmit} noValidate>
            <div className="mk-beta__row">
              <Input
                label="Courriel professionnel"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="toi@entreprise.com"
              />
              <Input
                label="Nom de l'entreprise"
                required
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                autoComplete="organization"
                placeholder="Ton entreprise inc."
              />
            </div>

            <div className="mk-beta__row">
              <Select
                label="Industrie"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
              >
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </Select>

              <div className="mk-beta__field">
                <span className="mk-beta__label">Taille de l'équipe</span>
                <div className="mk-beta__segmented" role="radiogroup" aria-label="Taille de l'équipe">
                  {TEAM_SIZES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={teamSize === s}
                      className={`mk-beta__seg ${teamSize === s ? 'is-active' : ''}`}
                      onClick={() => setTeamSize(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Textarea
              label="Comment comptes-tu utiliser Intralys ?"
              value={useCase}
              onChange={(e) => setUseCase(e.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="Ex. centraliser mes leads Facebook + relances automatiques en français…"
            />

            {/* ⚠️ Loi 25 / CASL — consentement explicite + finalité claire */}
            <label className="mk-beta__consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mk-beta__consent-box"
                aria-describedby="beta-consent-text"
              />
              <span id="beta-consent-text" className="mk-beta__consent-text">
                J'accepte qu'Intralys collecte mon courriel et les informations
                ci-dessus <strong>uniquement</strong> pour gérer mon inscription
                à la beta et me contacter à ce sujet. Aucun envoi commercial sans
                mon consentement (CASL). Je peux retirer mon consentement et
                demander la suppression de mes données en tout temps
                (Loi 25, Québec).
              </span>
            </label>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              isLoading={submitting}
              leftIcon={
                submitting ? (
                  <Icon as={Loader2} size={16} className="animate-spin" />
                ) : (
                  <Icon as={Send} size={16} />
                )
              }
            >
              {submitting ? 'Envoi en cours…' : 'Rejoindre la liste d\'attente'}
            </Button>
          </form>
        )}
      </div>
    </PublicLayout>
  );
}

export default BetaSignupPage;
