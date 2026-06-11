import { useState, type FormEvent } from 'react';
import { PublicLayout } from './PublicLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Tag } from '@/components/ui/Tag';
import {
  Calendar,
  Mail,
  Clock,
  Users,
  User,
  Building2,
  CheckCircle2,
  Sparkles,
  MessageSquare,
} from 'lucide-react';

export function DemoPage() {
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Front-only — la soumission réelle viendra plus tard (Calendly / API)
    setSubmitted(true);
  }

  return (
    <PublicLayout>
      <div className="relative pt-20 pb-24 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto overflow-hidden">
        {/* Orbs hero — wave 41 : 2 orbs animés (left + right) */}
        <div
          className="hero-stat-orb absolute w-[700px] h-[700px] rounded-full -top-80 left-1/2 -translate-x-1/2 pointer-events-none -z-10"
          style={{
            background:
              'radial-gradient(circle, rgba(99,91,255,0.18) 0%, rgba(139,92,246,0.10) 50%, transparent 75%)',
            filter: 'blur(80px)',
          }}
        />
        <div
          className="hero-stat-orb absolute w-[420px] h-[420px] rounded-full top-40 -right-32 pointer-events-none -z-10"
          style={{
            background:
              'radial-gradient(circle, rgba(139,92,246,0.18) 0%, rgba(99,91,255,0.10) 50%, transparent 75%)',
            filter: 'blur(60px)',
            animationDelay: '4s',
          }}
        />

        <div className="text-center mb-12">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 mb-6 rounded-full text-xs font-semibold"
            style={{
              background: 'rgba(255,255,255,0.7)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(99,91,255,0.2)',
              boxShadow: '0 4px 16px -4px rgba(99,91,255,0.15)',
            }}
          >
            <Calendar size={12} className="text-[var(--primary)]" />
            <span className="text-[var(--text-secondary)]">Démo 30 minutes · 100% gratuite</span>
          </div>
          <h1
            className="text-4xl md:text-6xl font-extrabold tracking-tight mb-4 leading-[1.05]"
            style={{ letterSpacing: '-0.03em' }}
          >
            Réservez votre <span className="text-gradient-brand">démo</span>
          </h1>
          <p className="text-lg text-[var(--text-secondary)] max-w-2xl mx-auto leading-relaxed">
            Découvrez comment Intralys peut transformer la gestion de votre PME avec un expert produit québécois.
          </p>
        </div>

        {/* 3 reassurance points */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8 max-w-3xl mx-auto">
          {[
            { icon: Clock, label: '30 min', sub: 'Démo personnalisée' },
            { icon: Users, label: 'Expert FR', sub: 'Conseiller québécois' },
            { icon: Mail, label: 'Sans engagement', sub: 'Aucune carte requise' },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-3 p-4 rounded-xl"
              style={{
                background: 'linear-gradient(135deg, #FFFFFF 0%, #F0EFFE 100%)',
                border: '1px solid rgba(99,91,255,0.2)',
                boxShadow: '0 1px 2px rgba(99,91,255,0.06), 0 4px 12px -4px rgba(99,91,255,0.12)',
              }}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{
                  background: 'linear-gradient(135deg, #635BFF 0%, #5851E5 100%)',
                  boxShadow: '0 2px 8px rgba(99,91,255,0.4)',
                }}
              >
                <item.icon size={16} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-[var(--text-primary)]">{item.label}</p>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{item.sub}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Form ou Success state */}
        {!submitted ? (
          <div className="card-premium p-8 max-w-2xl mx-auto">
            <div
              aria-hidden
              className="absolute -top-12 -right-12 w-44 h-44 rounded-full pointer-events-none opacity-60"
              style={{
                background:
                  'radial-gradient(circle, rgba(139,92,246,0.20) 0%, rgba(99,91,255,0.12) 50%, transparent 75%)',
                filter: 'blur(40px)',
              }}
            />

            <div className="relative">
              <div className="mb-6">
                <Tag variant="brand" size="sm" leftIcon={<Sparkles size={10} />}>
                  Formulaire premium
                </Tag>
                <h2 className="mt-3 text-2xl font-bold text-[var(--text-primary)] tracking-tight">
                  Dites-nous-en plus
                </h2>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  On vous recontacte sous 4h pour fixer l'horaire idéal.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5 block">
                      Nom complet
                    </span>
                    <Input
                      name="name"
                      placeholder="Marie Tremblay"
                      required
                      leftIcon={<User size={14} />}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5 block">
                      Courriel
                    </span>
                    <Input
                      type="email"
                      name="email"
                      placeholder="marie@entreprise.ca"
                      required
                      leftIcon={<Mail size={14} />}
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5 block">
                    Entreprise
                  </span>
                  <Input
                    name="company"
                    placeholder="Nom de votre PME"
                    leftIcon={<Building2 size={14} />}
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5 block">
                    Horaire préféré
                  </span>
                  <Select name="slot" defaultValue="" leftIcon={<Clock size={14} />}>
                    <option value="" disabled>
                      Choisissez un créneau
                    </option>
                    <option value="am">Matin (9h - 12h)</option>
                    <option value="pm">Après-midi (13h - 17h)</option>
                    <option value="eve">Soirée (17h - 19h)</option>
                  </Select>
                </label>

                <label className="block">
                  <span className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5 block">
                    Quel est votre principal défi ?{' '}
                    <span className="text-[var(--text-muted)] font-normal">(facultatif)</span>
                  </span>
                  <Textarea
                    name="message"
                    placeholder="Ex : automatiser les suivis de leads, intégrer notre Gmail, etc."
                    maxLength={400}
                    showCounter
                  />
                </label>

                <Button type="submit" variant="premium" size="lg" className="w-full h-14 text-base">
                  <MessageSquare size={16} className="mr-2" />
                  Réserver ma démo
                </Button>
                <p className="text-xs text-[var(--text-muted)] text-center mt-2">
                  Réponse sous 4h (jours ouvrables) · Aucune carte requise
                </p>
              </form>
            </div>
          </div>
        ) : (
          <div className="card-premium p-10 max-w-2xl mx-auto text-center">
            {/* Orbs animés */}
            <div
              aria-hidden
              className="absolute -top-16 -left-16 w-56 h-56 rounded-full pointer-events-none opacity-70"
              style={{
                background:
                  'radial-gradient(circle, rgba(99,91,255,0.30) 0%, rgba(139,92,246,0.12) 50%, transparent 75%)',
                filter: 'blur(50px)',
              }}
            />
            <div
              aria-hidden
              className="absolute -bottom-12 -right-12 w-44 h-44 rounded-full pointer-events-none opacity-60"
              style={{
                background:
                  'radial-gradient(circle, rgba(139,92,246,0.28) 0%, rgba(99,91,255,0.15) 50%, transparent 75%)',
                filter: 'blur(40px)',
              }}
            />

            <div className="relative">
              <div
                className="w-20 h-20 rounded-2xl mx-auto mb-6 flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, #635BFF 0%, #8B5CF6 100%)',
                  boxShadow:
                    '0 12px 32px -8px rgba(99,91,255,0.55), 0 0 40px -4px rgba(139,92,246,0.30)',
                }}
              >
                <CheckCircle2 size={36} className="text-white" strokeWidth={2.5} />
              </div>

              <div className="inline-block mb-3">
                <Tag variant="success" solid size="sm">
                  Demande reçue
                </Tag>
              </div>

              <h2
                className="text-3xl font-bold tracking-tight mb-3"
                style={{ letterSpacing: '-0.02em' }}
              >
                Merci, on vous <span className="text-gradient-brand">recontacte</span> sous 4h
              </h2>
              <p className="text-[var(--text-secondary)] mb-8 max-w-md mx-auto leading-relaxed">
                Notre expert produit prépare votre démo. En attendant, voici comment maximiser cette
                rencontre.
              </p>

              <ul className="text-left space-y-3 max-w-md mx-auto mb-8">
                {[
                  'Identifiez 1-2 frictions clés que vous voulez résoudre',
                  'Listez vos outils actuels (CRM, calendrier, comm.)',
                  "Préparez 2-3 questions sur l'automatisation",
                ].map((tip, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-[var(--text-secondary)]">
                    <span
                      className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                      style={{
                        background: 'linear-gradient(135deg, #635BFF 0%, #8B5CF6 100%)',
                        boxShadow: '0 2px 6px -1px rgba(99,91,255,0.45)',
                      }}
                    >
                      {i + 1}
                    </span>
                    <span className="leading-relaxed pt-0.5">{tip}</span>
                  </li>
                ))}
              </ul>

              <Button
                variant="secondary"
                size="lg"
                onClick={() => setSubmitted(false)}
                className="w-full sm:w-auto"
              >
                Soumettre une autre demande
              </Button>
            </div>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
