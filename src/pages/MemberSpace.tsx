// ── MemberSpace — espace membre PUBLIC (LOT MEMBERSHIPS, Sprint 6) ─────────
//
// Corps réel Phase C Manager-C. L'export nommé `MemberSpacePage` est FIGÉ
// (App.tsx GELÉ le lazy-importe — route publique `/m/$slug`, hors
// LazyGuard/auth, calque EXACT publicFunnelRoute /p/$slug).
//
// Calque le pattern src/pages/PublicBooking.tsx / PublicFunnel.tsx : pas
// d'auth CRM, AUTH MEMBRE SÉPARÉE (token membre stocké à part —
// localStorage 'intralys_member_token', JAMAIS le token admin de apiFetch),
// helpers api FIGÉS Phase A (memberRegister / memberLogin / memberLogout /
// getMemberCourses / getMemberLesson / memberLessonVideoUrl /
// setMemberProgress), spinner loading, écran connexion/inscription,
// discrimination erreur = absence `data` / champ `error` (§6.A — JAMAIS de
// `code`). i18n 100% t('member.*') / t('course.*') (clés FIGÉES Phase A —
// AUCUNE création Phase C). La vidéo leçon passe par le proxy worker GATED
// (memberLessonVideoUrl) — JAMAIS d'URL R2 publique. Le front n'invente
// JAMAIS de données (cours/leçons/drip) — tout vient du backend.

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from '@tanstack/react-router';
import { CheckCircle2 } from 'lucide-react';
import { useConfirm } from '@/components/ui';
import {
  memberRegister,
  memberLogin,
  memberLogout,
  getMemberCourses,
  getMemberLesson,
  memberLessonVideoUrl,
  setMemberProgress,
  // ── LOT MEMBERSHIP ENROLL (Sprint 6) — inscription + arbre modules/leçons.
  //    Helpers membre FIGÉS Phase A (fetch brut + token EXPLICITE). ──────────
  enrollInCourse,
  getMemberCourseDetail,
  // ── LOT G10 Communauté (helpers membre — token EXPLICITE, §6.D) ──────────
  getCommunityThreads,
  createCommunityThread,
  getThreadPosts,
  createPost,
  deleteOwnPost,
  getLessonComments,
  createLessonComment,
  deleteOwnComment,
  type MemberAuthResult,
  type MemberCourse,
  type MemberCourseDetail,
  type MemberLesson,
  type Lesson,
  type MembershipCommunityThread,
  type MembershipCommunityPost,
  type LessonComment,
} from '@/lib/api';
import type { ApiResponse } from '@/lib/types';
import { t, getLocale } from '@/lib/i18n';
import { formatDate } from '@/lib/i18n/datetime';

// Formatage date relatif/court localisé (commentaires & posts communauté).
function fmtCommentDate(value?: string | null): string {
  if (!value) return '';
  return formatDate(value, getLocale(), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Clé localStorage DISTINCTE du token admin/CRM ('intralys_token') — l'auth
// membre est strictement séparée (§6.A / §6.C). On ne lit/écrit JAMAIS la
// session admin ici.
const MEMBER_TOKEN_KEY = 'intralys_member_token';

function readMemberToken(): string {
  try {
    return typeof window !== 'undefined'
      ? window.localStorage.getItem(MEMBER_TOKEN_KEY) || ''
      : '';
  } catch {
    return '';
  }
}

const spinner = (
  <div
    className="flex justify-center py-6"
    role="status"
    aria-live="polite"
    aria-busy="true"
    aria-label={t('member.loading')}
  >
    <div
      className="member-spinner"
      aria-hidden="true"
      style={{
        width: 28,
        height: 28,
        border: '3px solid color-mix(in srgb, var(--primary) 20%, transparent)',
        borderTopColor: 'var(--primary)',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }}
    />
  </div>
);

export function MemberSpacePage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  // S6 M1.1 — useConfirm (ConfirmProvider est rendu au niveau App.tsx, dispo
  // même sur routes publiques). Utilisé pour les actions destructives
  // (supprimer son propre post communauté / commentaire de leçon).
  const confirm = useConfirm();

  // Token membre SÉPARÉ (clé localStorage distincte du token admin).
  const [memberToken, setMemberToken] = useState<string>(() =>
    readMemberToken(),
  );
  const [member, setMember] = useState<MemberAuthResult['member'] | null>(null);

  // Écran auth membre.
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  // Liste des cours + sélection.
  const [courses, setCourses] = useState<MemberCourse[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [coursesError, setCoursesError] = useState('');

  // Leçon ouverte (texte ou vidéo gated).
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [lessonError, setLessonError] = useState('');
  const [progressBusy, setProgressBusy] = useState(false);

  // ── LOT G10 Communauté — vue principale (cours | communauté) ─────────────
  const [view, setView] = useState<'courses' | 'community'>('courses');

  // Section Communauté : liste threads + thread ouvert + posts.
  const [threads, setThreads] = useState<MembershipCommunityThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState('');
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [threadBusy, setThreadBusy] = useState(false);

  const [openThread, setOpenThread] = useState<MembershipCommunityThread | null>(null);
  const [posts, setPosts] = useState<MembershipCommunityPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState('');
  const [newPost, setNewPost] = useState('');
  const [postBusy, setPostBusy] = useState(false);

  const persistToken = useCallback((token: string) => {
    try {
      if (token) window.localStorage.setItem(MEMBER_TOKEN_KEY, token);
      else window.localStorage.removeItem(MEMBER_TOKEN_KEY);
    } catch {
      /* best-effort — localStorage indisponible (mode privé) */
    }
    setMemberToken(token);
  }, []);

  // ── Auth membre (login / register) — token membre stocké à part ──────────
  const handleAuth = useCallback(async () => {
    if (authBusy) return;
    if (!email.trim() || !password.trim()) {
      setAuthError(t('member.required_fields'));
      return;
    }
    setAuthBusy(true);
    setAuthError('');
    const res =
      mode === 'register'
        ? await memberRegister(slug, {
            email: email.trim(),
            password,
            name: name.trim() || undefined,
          })
        : await memberLogin(slug, { email: email.trim(), password });
    setAuthBusy(false);
    // Discrimination erreur §6.A : absence `data` / champ `error` — JAMAIS de
    // `result.code`.
    if (res.error || !res.data) {
      setAuthError(res.error || t('member.error'));
      return;
    }
    persistToken(res.data.token);
    setMember(res.data.member);
    setPassword('');
  }, [authBusy, email, password, name, mode, slug, persistToken]);

  // ── Chargement des cours du membre ───────────────────────────────────────
  const loadCourses = useCallback(() => {
    if (!slug || !memberToken) return;
    let alive = true;
    setCoursesLoading(true);
    setCoursesError('');
    getMemberCourses(slug, memberToken)
      .then((res) => {
        if (!alive) return;
        if (res.error || !res.data) {
          // Token membre invalide/expiré → on le purge et on revient au login.
          if (res.error) {
            persistToken('');
            setMember(null);
          }
          setCoursesError(res.error || t('member.error'));
          setCourses([]);
          return;
        }
        setCourses(res.data);
      })
      .finally(() => {
        if (alive) setCoursesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [slug, memberToken, persistToken]);

  useEffect(() => {
    const cleanup = loadCourses();
    return cleanup;
  }, [loadCourses]);

  // ── Ouverture d'une leçon ────────────────────────────────────────────────
  const openLesson = useCallback(
    async (lessonId: string) => {
      if (!memberToken) return;
      setLessonLoading(true);
      setLessonError('');
      setLesson(null);
      const res = await getMemberLesson(lessonId, memberToken);
      setLessonLoading(false);
      if (res.error || !res.data) {
        // Le backend renvoie une erreur si la leçon est verrouillée (drip non
        // débloqué) ou hors périmètre — on affiche le message tel quel, on
        // n'invente RIEN.
        setLessonError(res.error || t('member.locked_drip'));
        return;
      }
      setLesson(res.data);
      // Marque la leçon comme démarrée (best-effort — n'altère pas l'UI).
      void setMemberProgress(memberToken, {
        lesson_id: lessonId,
        status: 'started',
      });
    },
    [memberToken],
  );

  // ── Marquer comme terminé ────────────────────────────────────────────────
  const markComplete = useCallback(async () => {
    if (!lesson || !memberToken || progressBusy) return;
    setProgressBusy(true);
    const res = await setMemberProgress(memberToken, {
      lesson_id: lesson.id,
      status: 'completed',
    });
    setProgressBusy(false);
    if (res.error || !res.data) {
      setLessonError(res.error || t('member.error'));
      return;
    }
    // % cours mis à jour côté backend → on rafraîchit la liste (source de
    // vérité). On ferme la leçon pour revenir à la liste.
    setLesson(null);
    loadCourses();
  }, [lesson, memberToken, progressBusy, loadCourses]);

  // ── Logout membre — purge UNIQUEMENT le token membre ─────────────────────
  const handleLogout = useCallback(async () => {
    if (memberToken) {
      // Best-effort côté serveur (calque memberLogout figé).
      void memberLogout(slug, memberToken);
    }
    persistToken('');
    setMember(null);
    setCourses([]);
    setLesson(null);
  }, [memberToken, slug, persistToken]);

  // ── LOT G10 Communauté — chargement threads ──────────────────────────────
  const loadThreads = useCallback(() => {
    if (!slug || !memberToken) return;
    let alive = true;
    setThreadsLoading(true);
    setThreadsError('');
    getCommunityThreads(slug, memberToken)
      .then((res: ApiResponse<MembershipCommunityThread[]>) => {
        if (!alive) return;
        // Discrimination §6.A : absence `data` / champ `error` — JAMAIS code.
        if (res.error || !res.data) {
          setThreadsError(res.error || t('community.error'));
          setThreads([]);
          return;
        }
        // Épinglées en tête (cosmétique — l'ordre serveur reste la base).
        setThreads(
          res.data
            .slice()
            .sort((a: MembershipCommunityThread, b: MembershipCommunityThread) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0)),
        );
      })
      .finally(() => {
        if (alive) setThreadsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [slug, memberToken]);

  // Charge les threads dès qu'on bascule sur la vue Communauté.
  useEffect(() => {
    if (view !== 'community' || openThread) return;
    const cleanup = loadThreads();
    return cleanup;
  }, [view, openThread, loadThreads]);

  // ── Créer un thread ──────────────────────────────────────────────────────
  const handleCreateThread = useCallback(async () => {
    const title = newThreadTitle.trim();
    if (!title || threadBusy) return;
    setThreadBusy(true);
    const res = await createCommunityThread(slug, memberToken, { title });
    setThreadBusy(false);
    if (res.error || !res.data) {
      setThreadsError(res.error || t('community.error'));
      return;
    }
    setNewThreadTitle('');
    loadThreads();
  }, [newThreadTitle, threadBusy, slug, memberToken, loadThreads]);

  // ── Ouvrir un thread → ses posts ─────────────────────────────────────────
  const loadPosts = useCallback(
    (threadId: string) => {
      if (!slug || !memberToken) return;
      let alive = true;
      setPostsLoading(true);
      setPostsError('');
      getThreadPosts(slug, threadId, memberToken)
        .then((res) => {
          if (!alive) return;
          if (res.error || !res.data) {
            setPostsError(res.error || t('community.error'));
            setPosts([]);
            return;
          }
          setPosts(res.data);
        })
        .finally(() => {
          if (alive) setPostsLoading(false);
        });
      return () => {
        alive = false;
      };
    },
    [slug, memberToken],
  );

  const handleOpenThread = useCallback(
    (thread: MembershipCommunityThread) => {
      setOpenThread(thread);
      setNewPost('');
      setPostsError('');
      loadPosts(thread.id);
    },
    [loadPosts],
  );

  // ── Poster dans un thread (désactivé si verrouillé) ──────────────────────
  const handleCreatePost = useCallback(async () => {
    if (!openThread || openThread.is_locked) return;
    const body = newPost.trim();
    if (!body || postBusy) return;
    setPostBusy(true);
    const res = await createPost(slug, openThread.id, memberToken, { body });
    setPostBusy(false);
    if (res.error || !res.data) {
      setPostsError(res.error || t('community.error'));
      return;
    }
    setNewPost('');
    loadPosts(openThread.id);
  }, [openThread, newPost, postBusy, slug, memberToken, loadPosts]);

  // ── Supprimer SON propre post (member_id == membre courant) ──────────────
  const handleDeletePost = useCallback(
    async (post: MembershipCommunityPost) => {
      if (!openThread) return;
      // S6 M1.1 — confirmation explicite avant DELETE (a11y + safety).
      const ok = await confirm({
        title: t('member.confirm.delete_title'),
        description: t('member.delete_post_confirm'),
        confirmLabel: t('action.delete'),
        cancelLabel: t('action.cancel'),
        danger: true,
      });
      if (!ok) return;
      const res = await deleteOwnPost(post.id, memberToken);
      if (res.error || !res.data) {
        setPostsError(res.error || t('community.error'));
        return;
      }
      loadPosts(openThread.id);
    },
    [openThread, memberToken, loadPosts, confirm],
  );

  const labelClasses =
    'mb-1 block text-sm font-medium text-[var(--text-secondary)]';
  const inputClasses =
    'w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]';

  // ── Écran auth (pas de token membre) ─────────────────────────────────────
  if (!memberToken) {
    return (
      <div className="min-h-screen bg-[var(--bg-surface)] p-4 flex justify-center items-start">
        <div className="w-full max-w-sm p-6" data-member-slug={slug}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
            {t('member.title')}
          </h1>
          <p
            className="text-sm"
            style={{ color: 'var(--text-muted)', marginBottom: 20 }}
          >
            {mode === 'register'
              ? t('member.register')
              : t('member.login')}
          </p>

          <div className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className={labelClasses} htmlFor="mb-name">
                  {t('member.name')}
                </label>
                <input
                  id="mb-name"
                  type="text"
                  className={inputClasses}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}
            <div>
              <label className={labelClasses} htmlFor="mb-email">
                {t('member.email')}
              </label>
              <input
                id="mb-email"
                type="email"
                className={inputClasses}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelClasses} htmlFor="mb-password">
                {t('member.password')}
              </label>
              <input
                id="mb-password"
                type="password"
                className={inputClasses}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAuth();
                }}
                required
              />
            </div>

            {authError && (
              <p
                role="alert"
                aria-live="assertive"
                className="text-sm"
                style={{ color: 'var(--danger)' }}
              >{authError}</p>
            )}

            <button
              type="button"
              onClick={handleAuth}
              disabled={authBusy}
              className="w-full rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {mode === 'register'
                ? t('member.register_cta')
                : t('member.login_cta')}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode(mode === 'register' ? 'login' : 'register');
                setAuthError('');
              }}
              className="w-full text-center text-sm text-[var(--primary)]"
            >
              {mode === 'register'
                ? t('member.have_account')
                : t('member.no_account')}
            </button>

            <p
              className="text-center pt-2"
              style={{ fontSize: 10, color: 'var(--text-muted)' }}
            >
              Propulsé par <strong>Intralys</strong>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Vue leçon ouverte (texte ou vidéo gated) ─────────────────────────────
  if (lesson) {
    return (
      <div className="min-h-screen bg-[var(--bg-surface)] p-4 flex justify-center items-start">
        <div className="w-full max-w-2xl p-6">
          <button
            type="button"
            onClick={() => setLesson(null)}
            className="mb-4 text-sm text-[var(--primary)]"
          >
            ← {t('member.my_courses')}
          </button>

          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>
            {lesson.title}
          </h1>

          {lesson.content_type === 'video' && lesson.has_video ? (
            <div className="mb-6">
              <p
                className="text-xs"
                style={{ color: 'var(--text-muted)', marginBottom: 8 }}
              >
                {t('course.video')}
              </p>
              {/* Vidéo via le proxy worker GATED (token membre en query —
                  les balises <video> n'envoient pas de header Authorization).
                  JAMAIS d'URL R2 publique. */}
              <video
                controls
                src={memberLessonVideoUrl(lesson.id, memberToken)}
                style={{
                  width: '100%',
                  borderRadius: 8,
                  background: '#000',
                }}
              />
            </div>
          ) : (
            <div className="mb-6">
              <p
                className="text-xs"
                style={{ color: 'var(--text-muted)', marginBottom: 8 }}
              >
                {t('course.text_lesson')}
              </p>
              {/* body_html provient du backend (gestion PRO). */}
              <div
                className="prose text-sm"
                style={{ color: 'var(--text-secondary)' }}
                dangerouslySetInnerHTML={{
                  __html: lesson.body_html || '',
                }}
              />
            </div>
          )}

          {lessonError && (
            <p
              role="alert"
              aria-live="assertive"
              className="text-sm mb-3"
              style={{ color: 'var(--danger)' }}
            >{lessonError}</p>
          )}

          <button
            type="button"
            onClick={markComplete}
            disabled={progressBusy}
            className="w-full rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {t('course.mark_complete')}
          </button>

          {/* ── LOT G10 — Commentaires sous la leçon ─────────────────────── */}
          <LessonComments
            lessonId={lesson.id}
            memberToken={memberToken}
            currentMemberId={member?.id ?? null}
          />
        </div>
      </div>
    );
  }

  // ── Liste des cours (token membre valide) ────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--bg-surface)] p-4 flex justify-center items-start">
      <div className="w-full max-w-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>
              {t('member.welcome')}
            </h1>
            {member?.name && (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {member.name}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm text-[var(--primary)]"
          >
            {t('member.logout')}
          </button>
        </div>

        {/* ── LOT G10 — Onglets Cours / Communauté ──────────────────────── */}
        <div className="community-tabs mb-4 flex gap-1">
          <button
            type="button"
            onClick={() => setView('courses')}
            className={`community-tab text-sm ${view === 'courses' ? 'community-tab--active' : ''}`}
            aria-pressed={view === 'courses'}
          >
            {t('member.my_courses')}
          </button>
          <button
            type="button"
            onClick={() => {
              setView('community');
              setOpenThread(null);
            }}
            className={`community-tab text-sm ${view === 'community' ? 'community-tab--active' : ''}`}
            aria-pressed={view === 'community'}
          >
            {t('community.title')}
          </button>
        </div>

        {view === 'courses' ? (
          <>
            {lessonLoading || coursesLoading ? (
              spinner
            ) : coursesError ? (
              <p
                role="alert"
                aria-live="assertive"
                className="text-sm"
                style={{ color: 'var(--danger)' }}
              >{coursesError}</p>
            ) : courses.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {t('course.empty')}
              </p>
            ) : (
              <div className="space-y-3">
                {courses.map((c) => (
                  <CourseCard
                    key={c.id}
                    course={c}
                    slug={slug}
                    memberToken={memberToken}
                    onOpenLesson={openLesson}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          // ── Section Communauté (threads / posts) ────────────────────────
          <CommunitySection
            openThread={openThread}
            threads={threads}
            threadsLoading={threadsLoading}
            threadsError={threadsError}
            newThreadTitle={newThreadTitle}
            threadBusy={threadBusy}
            posts={posts}
            postsLoading={postsLoading}
            postsError={postsError}
            newPost={newPost}
            postBusy={postBusy}
            currentMemberId={member?.id ?? null}
            spinner={spinner}
            inputClasses={inputClasses}
            onNewThreadTitle={setNewThreadTitle}
            onCreateThread={handleCreateThread}
            onOpenThread={handleOpenThread}
            onBackToThreads={() => setOpenThread(null)}
            onNewPost={setNewPost}
            onCreatePost={handleCreatePost}
            onDeletePost={handleDeletePost}
          />
        )}

        <p
          className="text-center pt-6"
          style={{ fontSize: 10, color: 'var(--text-muted)' }}
        >
          Propulsé par <strong>Intralys</strong>
        </p>
      </div>
    </div>
  );
}

// ── Carte cours (LOT MEMBERSHIP ENROLL, §6.H) ───────────────────────────────
// • Cours non inscrit (enrolled === false) → bouton « S'inscrire »
//   (course.enroll → enrollInCourse). Au succès, on charge le détail.
// • Cours inscrit → arbre modules→leçons via getMemberCourseDetail :
//   modules triés sort_order, leçons regroupées par module_id (orphelines à
//   part), état drip (unlocked:false → cadenas + délai, PAS de getMemberLesson)
//   et progression (status:'completed' → ✓). Clic sur leçon DÉBLOQUÉE →
//   onOpenLesson(lesson.id) — lessonId RÉEL (correction du bug course.id).
// L'état drip/progress vient EXCLUSIVEMENT du backend — on n'invente RIEN.
function CourseCard({
  course,
  slug,
  memberToken,
  onOpenLesson,
}: {
  course: MemberCourse;
  slug: string;
  memberToken: string;
  onOpenLesson: (lessonId: string) => void;
}) {
  const [detail, setDetail] = useState<MemberCourseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [enrollBusy, setEnrollBusy] = useState(false);
  // État d'inscription local : démarre du résumé liste (course.enrolled), puis
  // basculé par l'inscription / le détail (source de vérité = backend).
  const [enrolled, setEnrolled] = useState<boolean>(course.enrolled !== false);

  // Charge le détail (modules + leçons + drip + progress). 403 = non inscrit
  // côté backend (§6.B-bis) → on n'affiche PAS d'erreur, juste « S'inscrire ».
  const loadDetail = useCallback(() => {
    if (!slug || !memberToken) return;
    let alive = true;
    setLoading(true);
    setError('');
    getMemberCourseDetail(slug, memberToken, course.id)
      .then((res) => {
        if (!alive) return;
        if (res.error || !res.data) {
          // Non inscrit (403) ou erreur : on retombe sur l'état « S'inscrire ».
          setDetail(null);
          setEnrolled(false);
          return;
        }
        setDetail(res.data);
        setEnrolled(res.data.enrolled !== false);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [slug, memberToken, course.id]);

  // Charge le détail uniquement si le membre est (a priori) inscrit. Se
  // rafraîchit aussi quand le % cours change (retour de leçon « terminée » →
  // loadCourses met à jour course.progress_pct) pour ré-afficher l'état drip /
  // ✓ à jour (source = backend, JAMAIS inventé).
  useEffect(() => {
    if (!enrolled) return;
    const cleanup = loadDetail();
    return cleanup;
  }, [enrolled, loadDetail, course.progress_pct]);

  // ── S'inscrire (GRATUIT — E4 inactif). Au succès → charge le détail. ──────
  const handleEnroll = useCallback(async () => {
    if (enrollBusy) return;
    setEnrollBusy(true);
    setError('');
    const res = await enrollInCourse(slug, memberToken, course.id);
    setEnrollBusy(false);
    // Discrimination §6.A : absence `data` / champ `error` — JAMAIS de `code`.
    if (res.error || !res.data) {
      setError(res.error || t('member.error'));
      return;
    }
    // Inscription réussie → on passe au détail (modules/leçons).
    setEnrolled(true);
    loadDetail();
  }, [enrollBusy, slug, memberToken, course.id, loadDetail]);

  // Progression : préfère le détail backend, sinon le résumé liste.
  const rawPct =
    detail?.progress_pct ??
    (typeof course.progress_pct === 'number' ? course.progress_pct : 0);
  const pct = Math.max(0, Math.min(100, Math.round(rawPct)));

  // Leçons sans module (orphelines) — section « hors module » (§6.B).
  const orphanLessons = detail
    ? detail.lessons.filter((l) => !l.module_id)
    : [];

  return (
    <div className="rounded-lg border border-[var(--border)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{course.title}</h3>
          {course.description && (
            <p
              className="text-xs mt-1"
              style={{ color: 'var(--text-muted)' }}
            >
              {course.description}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {enrolled ? (
            <span
              className="text-xs"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('course.enrolled')}
            </span>
          ) : null}
          {/* LOT G10 — badge cosmétique « cours complété » (progress 100%,
              dérivé du backend, ZÉRO table). */}
          {enrolled && pct === 100 && (
            <span className="community-badge-completed text-[11px] font-medium">
              <CheckCircle2 size={12} strokeWidth={2} />
              {t('community.badge_completed')}
            </span>
          )}
        </div>
      </div>

      {/* % de complétion (source = backend) — uniquement si inscrit. */}
      {enrolled && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span style={{ color: 'var(--text-muted)' }}>{t('course.progress')}</span>
            <span style={{ color: 'var(--text-muted)' }}>{pct}%</span>
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 999,
              background: 'var(--border)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${pct}%`,
                background: 'var(--primary)',
                transition: 'width 0.3s',
              }}
            />
          </div>
        </div>
      )}

      {error && (
        <p
          role="alert"
          aria-live="assertive"
          className="text-sm mt-3"
          style={{ color: 'var(--danger)' }}
        >{error}</p>
      )}

      {/* ── Non inscrit → bouton « S'inscrire » (course.enroll). ─────────── */}
      {!enrolled && (
        <>
          <p
            className="text-xs mt-3"
            style={{ color: 'var(--text-muted)' }}
          >
            {t('member.no_enrollment')}
          </p>
          <button
            type="button"
            onClick={() => void handleEnroll()}
            disabled={enrollBusy}
            className="mt-2 w-full rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {t('course.enroll')}
          </button>
        </>
      )}

      {/* ── Inscrit → arbre modules→leçons. ─────────────────────────────── */}
      {enrolled && loading && !detail && (
        <div className="mt-3 flex justify-center py-3">
          <div
            style={{
              width: 22,
              height: 22,
              border: '3px solid color-mix(in srgb, var(--primary) 20%, transparent)',
              borderTopColor: 'var(--primary)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
        </div>
      )}

      {enrolled && detail && (
        <div className="mt-4 space-y-4">
          {/* Modules triés sort_order + leçons regroupées par module_id. */}
          {detail.modules
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((m) => {
              const moduleLessons = detail.lessons
                .filter((l) => l.module_id === m.id)
                .sort((a, b) => a.sort_order - b.sort_order);
              return (
                <div key={m.id}>
                  <h4
                    className="text-xs font-semibold uppercase tracking-wide mb-2"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {m.title}
                  </h4>
                  <LessonList lessons={moduleLessons} onOpenLesson={onOpenLesson} />
                </div>
              );
            })}

          {/* Leçons orphelines (sans module) — section « hors module ». */}
          {orphanLessons.length > 0 && (
            <div>
              <h4
                className="text-xs font-semibold uppercase tracking-wide mb-2"
                style={{ color: 'var(--text-muted)' }}
              >
                {t('member.lessons')}
              </h4>
              <LessonList lessons={orphanLessons} onOpenLesson={onOpenLesson} />
            </div>
          )}

          {detail.modules.length === 0 && orphanLessons.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('course.empty')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Liste de leçons d'un module (ou orphelines). Une leçon DÉBLOQUÉE
//    (unlocked) est cliquable → onOpenLesson(lesson.id) (lessonId RÉEL). Une
//    leçon VERROUILLÉE (unlocked:false, drip non écoulé) affiche un cadenas +
//    le délai et N'APPELLE PAS getMemberLesson. status:'completed' → ✓.
function LessonList({
  lessons,
  onOpenLesson,
}: {
  lessons: MemberLesson[];
  onOpenLesson: (lessonId: string) => void;
}) {
  if (lessons.length === 0) {
    return (
      <p className="text-xs pl-3" style={{ color: 'var(--text-muted)' }}>
        {t('course.empty')}
      </p>
    );
  }
  return (
    <ul className="space-y-1 pl-1">
      {lessons.map((l) => {
        const completed = l.status === 'completed';
        if (!l.unlocked) {
          // Verrouillée (drip) — non cliquable. Affiche le délai en jours.
          return (
            <li
              key={l.id}
              className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              style={{ color: 'var(--text-muted)', opacity: 0.7 }}
              aria-disabled="true"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span aria-hidden="true">🔒</span>
                <span className="truncate">{l.title}</span>
              </span>
              <span className="text-xs shrink-0">
                {t('member.locked_drip')}
                {l.drip_days > 0 ? ` (+${l.drip_days}d)` : ''}
              </span>
            </li>
          );
        }
        return (
          <li key={l.id}>
            <button
              type="button"
              onClick={() => onOpenLesson(l.id)}
              className="flex w-full items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-left hover:border-[var(--primary)]"
            >
              <span className="flex items-center gap-2 min-w-0">
                {completed ? (
                  <CheckCircle2
                    size={14}
                    strokeWidth={2}
                    style={{ color: 'var(--primary)' }}
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      border: '1.5px solid var(--border)',
                      display: 'inline-block',
                    }}
                  />
                )}
                <span className="truncate">{l.title}</span>
              </span>
              <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                {l.content_type === 'video'
                  ? t('course.video')
                  : t('course.text_lesson')}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ── LOT G10 — Commentaires sous une leçon ──────────────────────────────────
// Liste via getLessonComments (token membre EXPLICITE) + ajout
// (createLessonComment) + suppression de SON propre commentaire
// (deleteOwnComment, comparé à currentMemberId). Body = texte brut (PAS
// d'innerHTML — sécurisé par défaut React).
function LessonComments({
  lessonId,
  memberToken,
  currentMemberId,
}: {
  lessonId: string;
  memberToken: string;
  currentMemberId: string | null;
}) {
  // S6 M1.1 — confirm dialog pour DELETE (a11y + safety).
  const confirm = useConfirm();
  const [comments, setComments] = useState<LessonComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!memberToken) return;
    let alive = true;
    setLoading(true);
    setError('');
    getLessonComments(lessonId, memberToken)
      .then((res) => {
        if (!alive) return;
        if (res.error || !res.data) {
          setError(res.error || t('community.error'));
          setComments([]);
          return;
        }
        setComments(res.data);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [lessonId, memberToken]);

  useEffect(() => {
    const cleanup = load();
    return cleanup;
  }, [load]);

  const handleAdd = useCallback(async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    const res = await createLessonComment(lessonId, memberToken, { body: text });
    setBusy(false);
    if (res.error || !res.data) {
      setError(res.error || t('community.error'));
      return;
    }
    setBody('');
    load();
  }, [body, busy, lessonId, memberToken, load]);

  const handleDelete = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: t('member.confirm.delete_title'),
        description: t('member.delete_comment_confirm'),
        confirmLabel: t('action.delete'),
        cancelLabel: t('action.cancel'),
        danger: true,
      });
      if (!ok) return;
      const res = await deleteOwnComment(id, memberToken);
      if (res.error || !res.data) {
        setError(res.error || t('community.error'));
        return;
      }
      load();
    },
    [memberToken, load, confirm],
  );

  return (
    <section className="community-comments mt-8 border-t border-[var(--border)] pt-6">
      <h2 className="text-sm font-semibold mb-3">{t('community.comments')}</h2>

      {loading ? (
        <div className="community-skel" aria-hidden="true" aria-busy="true" role="status">
          <span className="community-skel-bar" style={{ width: '90%' }} />
          <span className="community-skel-bar" style={{ width: '70%' }} />
        </div>
      ) : error ? (
        <p
          role="alert"
          aria-live="assertive"
          className="text-sm"
          style={{ color: 'var(--danger)' }}
        >{error}</p>
      ) : comments.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('community.empty_comments')}
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="community-msg rounded-lg border border-[var(--border)] p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm whitespace-pre-wrap break-words">{c.body}</p>
                {currentMemberId && c.member_id === currentMemberId && (
                  <button
                    type="button"
                    onClick={() => void handleDelete(c.id)}
                    className="text-xs shrink-0" style={{ color: 'var(--danger)' }}
                  >
                    {t('community.delete')}
                  </button>
                )}
              </div>
              {c.created_at && (
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-faint, var(--text-muted))' }}>
                  {fmtCommentDate(c.created_at)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <textarea
          className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
          rows={2}
          placeholder={t('community.comment_placeholder')}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={busy || !body.trim()}
          className="self-end rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {t('community.add_comment')}
        </button>
      </div>
    </section>
  );
}

// ── LOT G10 — Section Communauté (threads + posts PLATS) ───────────────────
// Liste threads / créer thread / ouvrir thread → posts / poster /
// supprimer SON propre post. Thread is_locked → input désactivé + badge.
// Body = texte brut (pas d'innerHTML).
function CommunitySection({
  openThread,
  threads,
  threadsLoading,
  threadsError,
  newThreadTitle,
  threadBusy,
  posts,
  postsLoading,
  postsError,
  newPost,
  postBusy,
  currentMemberId,
  spinner,
  inputClasses,
  onNewThreadTitle,
  onCreateThread,
  onOpenThread,
  onBackToThreads,
  onNewPost,
  onCreatePost,
  onDeletePost,
}: {
  openThread: MembershipCommunityThread | null;
  threads: MembershipCommunityThread[];
  threadsLoading: boolean;
  threadsError: string;
  newThreadTitle: string;
  threadBusy: boolean;
  posts: MembershipCommunityPost[];
  postsLoading: boolean;
  postsError: string;
  newPost: string;
  postBusy: boolean;
  currentMemberId: string | null;
  spinner: ReactNode;
  inputClasses: string;
  onNewThreadTitle: (v: string) => void;
  onCreateThread: () => void;
  onOpenThread: (thread: MembershipCommunityThread) => void;
  onBackToThreads: () => void;
  onNewPost: (v: string) => void;
  onCreatePost: () => void;
  onDeletePost: (post: MembershipCommunityPost) => void;
}) {
  // ── Vue thread ouvert (posts) ──────────────────────────────────────────
  if (openThread) {
    const locked = !!openThread.is_locked;
    return (
      <div>
        <button
          type="button"
          onClick={onBackToThreads}
          className="mb-4 text-sm text-[var(--primary)]"
        >
          ← {t('community.threads')}
        </button>

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <h2 className="text-base font-semibold">{openThread.title}</h2>
          {openThread.is_pinned ? (
            <span className="community-tag-pinned text-[11px] font-medium">
              📌 {t('community.pinned')}
            </span>
          ) : null}
          {locked ? (
            <span className="community-tag-locked text-[11px] font-medium">
              🔒 {t('community.locked')}
            </span>
          ) : null}
        </div>

        {postsLoading ? (
          spinner
        ) : postsError ? (
          <p
            role="alert"
            aria-live="assertive"
            className="text-sm"
            style={{ color: 'var(--danger)' }}
          >{postsError}</p>
        ) : posts.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {t('community.empty_posts')}
          </p>
        ) : (
          <ul className="space-y-3">
            {posts.map((p) => (
              <li key={p.id} className="community-msg rounded-lg border border-[var(--border)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm whitespace-pre-wrap break-words">{p.body}</p>
                  {currentMemberId && p.member_id === currentMemberId && (
                    <button
                      type="button"
                      onClick={() => onDeletePost(p)}
                      className="text-xs shrink-0" style={{ color: 'var(--danger)' }}
                    >
                      {t('community.delete')}
                    </button>
                  )}
                </div>
                {p.created_at && (
                  <p className="text-[11px] mt-1" style={{ color: 'var(--text-faint, var(--text-muted))' }}>
                    {fmtCommentDate(p.created_at)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Zone de réponse — désactivée si thread verrouillé. */}
        {locked ? (
          <p className="mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
            🔒 {t('community.locked')}
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            <textarea
              className={inputClasses}
              rows={2}
              placeholder={t('community.reply_placeholder')}
              value={newPost}
              onChange={(e) => onNewPost(e.target.value)}
            />
            <button
              type="button"
              onClick={onCreatePost}
              disabled={postBusy || !newPost.trim()}
              className="self-end rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {t('community.post')}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Vue liste threads ────────────────────────────────────────────────────
  return (
    <div>
      {/* Créer un thread */}
      <div className="mb-5 flex gap-2">
        <input
          type="text"
          className={inputClasses}
          placeholder={t('community.thread_title')}
          value={newThreadTitle}
          onChange={(e) => onNewThreadTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCreateThread();
          }}
        />
        <button
          type="button"
          onClick={onCreateThread}
          disabled={threadBusy || !newThreadTitle.trim()}
          className="shrink-0 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {t('community.new_thread')}
        </button>
      </div>

      {threadsLoading ? (
        spinner
      ) : threadsError ? (
        <p
          role="alert"
          aria-live="assertive"
          className="text-sm"
          style={{ color: 'var(--danger)' }}
        >{threadsError}</p>
      ) : threads.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('community.empty_threads')}
        </p>
      ) : (
        <ul className="space-y-2">
          {threads.map((th) => (
            <li key={th.id}>
              <button
                type="button"
                onClick={() => onOpenThread(th)}
                className="community-thread-row w-full rounded-lg border border-[var(--border)] p-3 text-left hover:border-[var(--primary)]"
              >
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{th.title}</span>
                  {th.is_pinned ? (
                    <span className="community-tag-pinned text-[11px] font-medium">
                      📌 {t('community.pinned')}
                    </span>
                  ) : null}
                  {th.is_locked ? (
                    <span className="community-tag-locked text-[11px] font-medium">
                      🔒 {t('community.locked')}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
