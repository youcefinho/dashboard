import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { Button, Card, useToast, Input, Select, Textarea, Switch, Icon } from '@/components/ui';
import { Mail, Phone, Hash } from 'lucide-react';
import React from 'react';
import { t } from '@/lib/i18n';
import { trackFormView, logFormFieldEvent } from '@/lib/api';
import type { FormField, FormFieldCondition } from '@/lib/types';

// ── LOT FORMS XL (Sprint 5) — rendu public complet ────────────────────────────
// Aligné sur la STRUCTURE JSON EXACTE de forms.fields (§6.B-bis) : options =
// string[] (PAS [{label,value}]). Rétro-compat byte : un formulaire sans
// conditional/step rend comme avant (tout visible, 1 étape).
// Le type canonique vit dans src/lib/types.ts (FormField) — consommé tel quel.
type Field = FormField;

type FormConfig = {
  id: string;
  name: string;
  description: string;
  fields: string;
  submit_action: string;
  success_message: string;
  form_type: string;
  settings_json: string;
};

// ── Session id stable côté client (pour le drop-off par champ) ────────────────
function getSessionId(): string {
  const KEY = 'intralys_form_session';
  try {
    let v = sessionStorage.getItem(KEY);
    if (!v) {
      v = crypto.randomUUID();
      sessionStorage.setItem(KEY, v);
    }
    return v;
  } catch {
    return 'anon';
  }
}

// ── Évaluation conditionnelle LIVE (miroir client de §6.D) ────────────────────
function isVisible(cond: FormFieldCondition | undefined, data: Record<string, unknown>): boolean {
  if (!cond) return true; // legacy : champ sans condition = toujours visible
  const raw = data[cond.field_name];
  const cur = raw == null ? '' : String(raw);
  const target = cond.value == null ? '' : String(cond.value);
  switch (cond.operator) {
    case 'equals': return cur === target;
    case 'not_equals': return cur !== target;
    case 'contains': return cur.includes(target);
    case 'is_empty': return cur === '';
    case 'is_not_empty': return cur !== '';
    default: return true;
  }
}

export function PublicFormPage() {
  const { error: toastError } = useToast();
  const { slug } = useParams({ strict: false }) as { slug: string };
  const [config, setConfig] = useState<FormConfig | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Consentement Loi 25 (lu depuis settings_json : require_consent / consent_text)
  const [requireConsent, setRequireConsent] = useState(false);
  const [consentText, setConsentText] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);

  // Honeypot anti-spam (§6.D) : champ caché `_hp`, jamais rempli par un humain.
  const [hp, setHp] = useState('');

  // Multi-étapes
  const [currentStep, setCurrentStep] = useState(0);

  const [formData, setFormData] = useState<Record<string, any>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    success: boolean;
    message: string;
    quiz_score?: number;
    quiz_result?: { range: string; message: string };
  } | null>(null);

  const sessionId = useRef<string>(getSessionId());

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/form/${slug}`)
      .then(res => res.json())
      .then((data: any) => {
        if (data.error) throw new Error(data.error);
        setConfig(data.data);
        try { setFields(JSON.parse(data.data.fields || '[]')); } catch { setFields([]); }
        // Bloc consentement Loi 25 (FormBuilder le stocke dans settings_json).
        try {
          const s = JSON.parse(data.data.settings_json || '{}') as {
            require_consent?: boolean; consent_text?: string;
          };
          if (s.require_consent) {
            setRequireConsent(true);
            setConsentText(s.consent_text || '');
          }
        } catch { /* ignore */ }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [slug]);

  // RÉPARATION view-tracking (§6.E) : appeler trackFormView au montage (best-effort).
  useEffect(() => {
    if (!slug) return;
    void trackFormView(slug);
  }, [slug]);

  // ResizeObserver pour informer l'iframe parent (f.js)
  useEffect(() => {
    const resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        window.parent.postMessage(JSON.stringify({
          type: 'intralys-form-resize',
          slug: slug,
          height: entry.target.scrollHeight
        }), '*');
      }
    });
    resizeObserver.observe(document.body);
    return () => resizeObserver.disconnect();
  }, [slug]);

  // Champs visibles (logique conditionnelle live) — recalculés à chaque réponse.
  const visibleFields = useMemo(
    () => fields.filter(f => isVisible(f.conditional, formData)),
    [fields, formData]
  );

  // Étapes : dérivées de l'attribut `step` (absent/0 ⇒ étape 1). On regroupe les
  // numéros d'étape RÉELLEMENT présents parmi les champs VISIBLES.
  const steps = useMemo(() => {
    const set = new Set<number>();
    for (const f of visibleFields) set.add(f.step && f.step > 0 ? f.step : 1);
    return Array.from(set).sort((a, b) => a - b);
  }, [visibleFields]);

  const isMultiStep = steps.length > 1;
  const safeStepIdx = Math.min(currentStep, steps.length - 1);
  const activeStep = steps[safeStepIdx] ?? 1;

  const fieldsForRender = useMemo(() => {
    if (!isMultiStep) return visibleFields;
    return visibleFields.filter(f => (f.step && f.step > 0 ? f.step : 1) === activeStep);
  }, [visibleFields, isMultiStep, activeStep]);

  const isLastStep = !isMultiStep || safeStepIdx >= steps.length - 1;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    if (requireConsent && !consentChecked) return; // garde-fou (le bouton est déjà désactivé)
    setIsSubmitting(true);

    try {
      // Payload EXACT (§6.B-bis) : { form_id, data: { <field.name>: valeur } }.
      // + honeypot `_hp` (§6.D) + consentement Loi 25 sous la clé `consent`
      //   (lue par applyLeadMapping → logIngestConsent).
      const payload: Record<string, unknown> = { ...formData, _hp: hp };
      if (requireConsent) payload.consent = consentChecked;

      const res = await fetch('/api/form/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form_id: config.id, data: payload })
      });
      const data = (await res.json()) as any;

      if (!res.ok) throw new Error(data.error || 'Erreur lors de la soumission');

      setSubmitResult({
        success: true,
        message: data.data.success_message || config.success_message || 'Merci pour votre demande !',
        quiz_score: data.data.quiz_score,
        quiz_result: data.data.quiz_result,
      });

      if (data.data.redirect_url) {
        setTimeout(() => { window.top!.location.href = data.data.redirect_url; }, 2000);
      }

    } catch (err: any) {
      toastError(err.message || 'Erreur lors de l\'envoi du formulaire');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFieldChange = (name: string, value: any) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Tracking drop-off par champ (§6.E) — best-effort, ne bloque jamais.
  const handleFieldEvent = (name: string, event: string) => {
    if (!slug) return;
    void logFormFieldEvent(slug, { field_name: name, event, session_id: sessionId.current });
  };

  const goNext = () => {
    setCurrentStep(s => Math.min(s + 1, steps.length - 1));
  };
  const goPrev = () => {
    setCurrentStep(s => Math.max(s - 1, 0));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent">
        <div style={{ width: 36, height: 36, border: '3px solid rgba(0,157,219,0.2)', borderTopColor: 'var(--primary, #009DDB)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    );
  }
  if (error) return <div className="p-6 text-center text-red-500">{error}</div>;
  if (!config) return <div className="p-6 text-center">{t('public_form.not_found')}</div>;

  if (submitResult?.success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-transparent font-inter">
        <Card className="w-full max-w-md text-center p-8 border-none shadow-none bg-transparent">
          <div className="w-16 h-16 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">✓</div>
          <h2 className="text-xl font-bold mb-2 text-[var(--text-primary)]">{t('public_form.success')}</h2>
          <p className="text-[var(--text-muted)] whitespace-pre-wrap">{submitResult.message}</p>

          {submitResult.quiz_result && (
            <div className="mt-6 p-4 rounded-xl bg-blue-50 text-left">
              <p className="text-sm font-semibold text-blue-600 mb-1">{t('public_form.quiz_result')}</p>
              <p className="text-[var(--text-primary)]">{submitResult.quiz_result.message}</p>
            </div>
          )}
        </Card>
      </div>
    );
  }

  const labelClasses = "mb-1 block text-sm font-medium text-[var(--text-secondary)]";

  const renderField = (f: Field) => {
    const ariaRequired = f.required || undefined;
    switch (f.type) {
      case 'text':
      case 'email':
      case 'phone':
      case 'number':
      case 'date': {
        const inputType = f.type === 'phone' ? 'tel' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type;
        const leftIcon = f.type === 'email' ? <Icon as={Mail} size="sm" /> : f.type === 'phone' ? <Icon as={Phone} size="sm" /> : f.type === 'number' ? <Icon as={Hash} size="sm" /> : undefined;
        return (
          <div key={f.id}>
            <label className={labelClasses} htmlFor={f.id}>
              {f.label} {f.required && <span className="text-red-500">*</span>}
            </label>
            <Input
              id={f.id}
              type={inputType}
              name={f.name}
              leftIcon={leftIcon}
              placeholder={f.placeholder}
              required={f.required}
              aria-required={ariaRequired}
              value={formData[f.name] || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleFieldChange(f.name, e.target.value)}
              onBlur={() => handleFieldEvent(f.name, formData[f.name] ? 'complete' : 'blur')}
            />
          </div>
        );
      }
      case 'textarea':
        return (
          <div key={f.id}>
            <label className={labelClasses} htmlFor={f.id}>
              {f.label} {f.required && <span className="text-red-500">*</span>}
            </label>
            <Textarea
              id={f.id}
              name={f.name}
              placeholder={f.placeholder}
              required={f.required}
              aria-required={ariaRequired}
              value={formData[f.name] || ''}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleFieldChange(f.name, e.target.value)}
              onBlur={() => handleFieldEvent(f.name, formData[f.name] ? 'complete' : 'blur')}
              rows={4}
            />
          </div>
        );
      case 'select':
        return (
          <div key={f.id}>
            <label className={labelClasses} htmlFor={f.id}>
              {f.label} {f.required && <span className="text-red-500">*</span>}
            </label>
            <Select
              id={f.id}
              name={f.name}
              required={f.required}
              aria-required={ariaRequired}
              value={formData[f.name] || ''}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { handleFieldChange(f.name, e.target.value); handleFieldEvent(f.name, 'complete'); }}
            >
              <option value="">{t('public_form.select_ph')}</option>
              {(f.options ?? []).map((opt, i) => (
                <option key={i} value={opt}>{opt}</option>
              ))}
            </Select>
          </div>
        );
      case 'multiselect': {
        const selected: string[] = Array.isArray(formData[f.name]) ? formData[f.name] : [];
        const toggle = (opt: string) => {
          const next = selected.includes(opt) ? selected.filter(o => o !== opt) : [...selected, opt];
          handleFieldChange(f.name, next);
          handleFieldEvent(f.name, next.length ? 'complete' : 'blur');
        };
        return (
          <div key={f.id} className="space-y-2">
            <label className={labelClasses}>
              {f.label} {f.required && <span className="text-red-500">*</span>}
            </label>
            <input type="hidden" name={f.name} value={selected.join(',')} aria-required={ariaRequired} />
            <div className="flex flex-wrap gap-2" role="group" aria-label={f.label}>
              {(f.options ?? []).map((opt, i) => {
                const isSel = selected.includes(opt);
                return (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={isSel}
                    onClick={() => toggle(opt)}
                    className={`chip-btn chip-btn--sm ${isSel ? 'is-active' : ''}`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>
        );
      }
      case 'radio':
        return (
          <div key={f.id} className="space-y-2">
            <label className={labelClasses}>
              {f.label} {f.required && <span className="text-red-500">*</span>}
            </label>
            <input
              type="hidden"
              name={f.name}
              value={formData[f.name] || ''}
              aria-required={ariaRequired}
            />
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={f.label} aria-required={ariaRequired}>
              {(f.options ?? []).map((opt, i) => {
                const isSelected = formData[f.name] === opt;
                return (
                  <button
                    key={i}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => { handleFieldChange(f.name, opt); handleFieldEvent(f.name, 'complete'); }}
                    className={`chip-btn chip-btn--sm ${isSelected ? 'is-active' : ''}`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>
        );
      case 'checkbox':
        return (
          <div key={f.id} className="pt-2 flex items-center gap-2">
            <input
              type="hidden"
              name={f.name}
              value={formData[f.name] ? 'true' : 'false'}
              aria-required={ariaRequired}
            />
            <Switch
              id={f.id}
              variant="brand"
              size="sm"
              checked={!!formData[f.name]}
              onCheckedChange={(v) => { handleFieldChange(f.name, v); handleFieldEvent(f.name, 'complete'); }}
              label={`${f.label}${f.required ? ' *' : ''}`}
            />
          </div>
        );
      case 'file':
        return (
          <div key={f.id}>
            <label className={labelClasses} htmlFor={f.id}>
              {f.label} {f.required && <span className="text-red-500">*</span>}
            </label>
            <input
              id={f.id}
              type="file"
              name={f.name}
              required={f.required}
              aria-required={ariaRequired}
              className="block w-full text-sm text-[var(--text-secondary)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--bg-canvas)] file:px-3 file:py-2 file:text-sm file:text-[var(--text-primary)]"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { handleFieldChange(f.name, e.target.files?.[0]?.name || ''); handleFieldEvent(f.name, 'complete'); }}
            />
          </div>
        );
      case 'hidden':
        return (
          <input
            key={f.id}
            type="hidden"
            name={f.name}
            value={formData[f.name] ?? f.placeholder ?? ''}
          />
        );
      default:
        return <div key={f.id} className="text-sm text-red-500">{t('public_form.unsupported')} : {f.type}</div>;
    }
  };

  const progressPct = isMultiStep ? Math.round(((safeStepIdx + 1) / steps.length) * 100) : 0;
  const submitDisabled = isSubmitting || (requireConsent && !consentChecked);

  return (
    <div className="min-h-screen bg-transparent p-4 flex justify-center items-start font-inter">
      <Card className="w-full max-w-lg border-none shadow-none bg-transparent">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-2">{config.name}</h1>
          {config.description && <p className="text-[var(--text-muted)] mb-6 text-sm">{config.description}</p>}

          {/* Multi-étapes : barre de progression (clés fb.step.*) */}
          {isMultiStep && (
            <div className="mb-5">
              <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                <span>{t('fb.step.progress').replace('{current}', String(safeStepIdx + 1)).replace('{total}', String(steps.length))}</span>
                <span>{progressPct}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-[var(--bg-canvas)] overflow-hidden">
                <div className="h-full rounded-full bg-[var(--primary,#009DDB)] transition-all" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {fieldsForRender.map(renderField)}

            {/* Honeypot anti-spam (§6.D) — name='_hp', hors écran, jamais visible.
                Un bot qui le remplit ⇒ rejet silencieux côté serveur. */}
            <input
              type="text"
              name="_hp"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={hp}
              onChange={(e) => setHp(e.target.value)}
              style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
            />

            {/* Case consentement Loi 25 — affichée sur la dernière étape, bloquante. */}
            {requireConsent && isLastStep && (
              <div className="pt-2 flex items-start gap-2">
                <Switch
                  id="_consent"
                  variant="brand"
                  size="sm"
                  checked={consentChecked}
                  onCheckedChange={setConsentChecked}
                  label={`${consentText || "J'accepte d'être recontacté(e), conformément à la Loi 25."} *`}
                />
              </div>
            )}

            <div className="pt-4 flex items-center gap-2">
              {isMultiStep && safeStepIdx > 0 && (
                <Button type="button" variant="ghost" className="flex-1 py-3" onClick={goPrev}>
                  {t('fb.step.prev')}
                </Button>
              )}
              {!isLastStep ? (
                <Button type="button" variant="primary" className="flex-1 text-base py-3" onClick={goNext}>
                  {t('fb.step.next')}
                </Button>
              ) : (
                <Button type="submit" variant="primary" className="flex-1 text-base py-3" isLoading={isSubmitting} disabled={submitDisabled}>
                  {config.form_type === 'quiz' ? t('public_form.submit_quiz') : t('public_form.submit')}
                </Button>
              )}
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
