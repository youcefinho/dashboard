// ── CourseModuleTree — surface la structure (modules → leçons) d'un cours ───
//
// Composant enfant ADDITIF (LOT « course structure », Sprint 6). Consomme
// l'endpoint dédié getCourseModules(courseId) — FIGÉ Phase A — pour révéler la
// structure pédagogique invisible jusqu'ici dans CoursesAdmin (la liste des
// cours n'exposait que le titre / statut de publication).
//
// Pattern PRO calqué sur le listing modération inline de CoursesAdmin :
//   - fetch paresseux (au premier expand) — pas de coût réseau si replié,
//   - discrimination erreur §6.A : on consomme `data` si présent, JAMAIS de
//     `code` ; champ `error` sinon,
//   - a11y : aria-busy (loading), role="alert" (erreur), aria-expanded sur le
//     toggle, sr-only pour l'état de chargement.
//
// i18n : clés NEW t('coursesx.*') (structure / chargement / vide / erreur /
// retry) + réutilisation des clés FIGÉES t('course.*') / t('common.*').
// 100 % ADDITIF — aucune mutation, lecture seule.

import { useCallback, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button, Skeleton, Tag } from '@/components/ui';
import { getCourseModules, type CourseModule, type Lesson } from '@/lib/api';
import { t } from '@/lib/i18n';

interface CourseModuleTreeProps {
  courseId: string;
}

// L'endpoint /courses/:id/modules peut renvoyer chaque module avec ses leçons
// imbriquées (champ applicatif optionnel) — on lit le type FIGÉ CourseModule et
// on tolère une éventuelle propriété `lessons` sans forcer le type back.
type ModuleWithLessons = CourseModule & { lessons?: Lesson[] };

export function CourseModuleTree({ courseId }: CourseModuleTreeProps) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modules, setModules] = useState<ModuleWithLessons[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getCourseModules(courseId);
      // Discrimination §6.A : `data` présent → succès ; sinon champ `error`.
      if (res.data) {
        // Défensif : si `data` n'est pas un tableau, on neutralise.
        setModules(Array.isArray(res.data) ? (res.data as ModuleWithLessons[]) : []);
      } else {
        setError(res.error || t('coursesx.structure_error'));
      }
    } catch (e: unknown) {
      // Exception réseau → affiche message inline + retry, jamais silencieux.
      setError(e instanceof Error ? e.message : t('coursesx.structure_error'));
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [courseId]);

  const toggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    // Fetch paresseux : on ne charge qu'au premier dépliage.
    if (next && !loaded && !loading) void load();
  }, [open, loaded, loading, load]);

  // Coercion défensive : sort_order peut arriver en string/null selon backend.
  const orderNum = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const sortedModules = modules
    .slice()
    .sort((a, b) => orderNum(a.sort_order) - orderNum(b.sort_order));

  return (
    <div className="course-module-tree">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs font-medium"
        style={{ color: 'var(--text-muted)' }}
      >
        <ChevronRight
          size={13}
          aria-hidden="true"
          style={{ transform: open ? 'rotate(90deg)' : 'none' }}
        />
        {t('coursesx.structure')}
      </button>

      {open && (
        <div className="mt-2 pl-4">
          {loading ? (
            <div aria-busy="true" aria-live="polite">
              <span className="sr-only">{t('common.loading')}</span>
              <Skeleton className="h-12" />
            </div>
          ) : error ? (
            <div
              className="flex flex-col items-start gap-2 py-1"
              role="alert"
            >
              <p className="text-xs font-medium">
                {t('coursesx.structure_error')}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {error}
              </p>
              <Button variant="secondary" size="sm" onClick={() => void load()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : sortedModules.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('coursesx.structure_empty')}
            </p>
          ) : (
            <ul className="space-y-2">
              {sortedModules.map((m) => {
                // Défensif : lessons peut être null/undefined OU non-tableau.
                const lessonsRaw = Array.isArray(m.lessons) ? m.lessons : [];
                const lessons = lessonsRaw
                  .slice()
                  .sort((a, b) => orderNum(a.sort_order) - orderNum(b.sort_order));
                return (
                  <li key={m.id}>
                    <p className="text-xs font-semibold flex items-center gap-2">
                      {m.title}
                      <Tag variant="neutral" size="xs">
                        {t('coursesx.lessons_count').replace(
                          '{count}',
                          String(lessons.length),
                        )}
                      </Tag>
                    </p>
                    {lessons.length > 0 && (
                      <ul className="mt-1 pl-3 space-y-1">
                        {lessons.map((l) => (
                          <li
                            key={l.id}
                            className="flex items-center gap-2 text-xs py-0.5"
                          >
                            <span>{l.title}</span>
                            <Tag variant="neutral" size="xs">
                              {l.content_type === 'video'
                                ? t('course.video')
                                : t('course.text_lesson')}
                            </Tag>
                            {l.drip_days > 0 && (
                              <Tag variant="info" size="xs">
                                +{l.drip_days}d
                              </Tag>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
