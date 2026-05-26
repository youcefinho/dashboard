// ── Sprint 50 M3.1 — Beta signup page publique (/beta) ──────────────────────
// Liste d'attente beta privée. Stripe SUBTLE strict (pas glow/orb/gradient).
// ⚠️ Loi 25 / CASL : consentement explicite obligatoire + finalité claire.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Send, Loader2, CheckCircle2, Users } from 'lucide-react';
import { PublicLayout } from '../landing/PublicLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { MarketingMeta } from './_meta';

// Renforcement : regex email partagée avec Login/Signup/Contact (Sprint 26-2B).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USE_CASE_MAX = 1000;

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
  // Renforcement : touched par champ pour inline errors au blur.
  const [touched, setTouched] = useState<{ email: boolean; company: boolean }>({
    email: false,
    company: false,
  });
  // Renforcement : ref sur le bloc succès pour focus management (annonce SR).
  const successRef = useRef<HTMLDivElement | null>(null);
  // Refs sur les boutons segmented pour navigation clavier (radio group).
  const segRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const emailValid = EMAIL_RE.test(email);
  const emailError = touched.email && email.length > 0 && !emailValid
    ? "Format de courriel invalide. Exemple : nom@entreprise.com"
    : touched.email && email.length === 0
      ? 'Le courriel est requis.'
      : '';
  const companyError = touched.company && company.trim().length === 0
    ? "Le nom de l'entreprise est requis."
    : '';
  const formInvalid = !emailValid || company.trim().length === 0;

  useEffect(() => {
    let alive = true;
    fetch('/api/beta/count')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && (j as { data?: { count?: number } })?.data?.count) setCount((j as { data: { count: number } }).data.count); })
      .catch(() => { /* social proof best-effort */ });
    return () => { alive = false; };
  }, []);

  // Renforcement a11y : focus management après succès — déplace le focus
  // sur le bloc de confirmation pour que les lecteurs d'écran l'annoncent.
  useEffect(() => {
    if (done && successRef.current) {
      try { successRef.current.focus(); } catch { /* noop */ }
    }
  }, [done]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    // Renforcement : touch tous les champs requis pour montrer toutes les
    // erreurs inline avant d'évaluer la validité globale.
    setTouched({ email: true, company: true });
    if (formInvalid) {
      toast.error('Vérifie les champs en rouge avant de continuer.', { title: 'Champs requis' });
      return;
    }
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

  // Renforcement a11y : navigation clavier ←/→/Home/End dans le radiogroup
  // taille d'équipe (ARIA Radio Group pattern).
  function handleSegKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, idx: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    let nextIdx = idx;
    if (e.key === 'ArrowLeft') nextIdx = idx === 0 ? TEAM_SIZES.length - 1 : idx - 1;
    else if (e.key === 'ArrowRight') nextIdx = idx === TEAM_SIZES.length - 1 ? 0 : idx + 1;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = TEAM_SIZES.length - 1;
    const nextVal = TEAM_SIZES[nextIdx]!;
    setTeamSize(nextVal);
    try { segRefs.current[nextIdx]?.focus(); } catch { /* noop */ }
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
          <div
            className="mk-beta__success"
            role="status"
            aria-live="polite"
            tabIndex={-1}
            ref={successRef}
          >
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
          <form
            className="mk-beta__form"
            onSubmit={handleSubmit}
            noValidate
            aria-busy={submitting || undefined}
          >
            <div className="mk-beta__row">
              <Input
                label="Courriel professionnel"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched((s) => ({ ...s, email: true }))}
                autoComplete="email"
                placeholder="toi@entreprise.com"
                error={emailError || undefined}
              />
              <Input
                label="Nom de l'entreprise"
                required
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                onBlur={() => setTouched((s) => ({ ...s, company: true }))}
                autoComplete="organization"
                placeholder="Ton entreprise inc."
                error={companyError || undefined}
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
                <span className="mk-beta__label" id="mk-beta-team-label">Taille de l'équipe</span>
                <div
                  className="mk-beta__segmented"
                  role="radiogroup"
                  aria-labelledby="mk-beta-team-label"
                >
                  {TEAM_SIZES.map((s, i) => {
                    const checked = teamSize === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        // Pattern ARIA Radio Group : un seul radio focusable
                        // à la fois (tabIndex 0), les autres -1.
                        tabIndex={checked ? 0 : -1}
                        ref={(el) => { segRefs.current[i] = el; }}
                        className={`mk-beta__seg ${checked ? 'is-active' : ''}`}
                        onClick={() => setTeamSize(s)}
                        onKeyDown={(e) => handleSegKeyDown(e, i)}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <Textarea
              label="Comment comptes-tu utiliser Intralys ?"
              value={useCase}
              onChange={(e) => setUseCase(e.target.value)}
              rows={4}
              maxLength={USE_CASE_MAX}
              placeholder="Ex. centraliser mes leads Facebook + relances automatiques en français…"
              aria-describedby="mk-beta-usecase-counter"
            />
            {/* Renforcement UX : compteur caractères pour textarea limitée */}
            <p
              id="mk-beta-usecase-counter"
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                marginTop: -8,
                textAlign: 'right',
              }}
              aria-live="polite"
            >
              {useCase.length} / {USE_CASE_MAX}
            </p>

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
              disabled={submitting}
              aria-disabled={submitting || undefined}
              aria-busy={submitting || undefined}
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
