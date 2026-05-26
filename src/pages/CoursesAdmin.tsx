// ── CoursesAdmin — gestion PRO des cours (LOT MEMBERSHIPS, Sprint 6) ───────
//
// Corps réel Phase C Manager-C. L'export nommé `CoursesAdminPage` est FIGÉ
// (App.tsx GELÉ le lazy-importe — route PROTÉGÉE `/courses-admin`, sous
// LazyGuard, calque EXACT settingsRoute / bookingSettingsRoute).
//
// Calque le pattern des pages PRO existantes (Funnels.tsx) : auth CRM
// (apiFetch — capability 'workflows.manage' enforced côté worker), helpers
// api FIGÉS Phase A (getCourses / createCourse / getCourse / updateCourse /
// deleteCourse / getCourseModules / createCourseModule / createLesson /
// updateLesson / deleteLesson / getMembershipSites / createMembershipSite /
// getMembershipPlans / createMembershipPlan), discrimination erreur =
// absence `data` / champ `error` (§6.A — JAMAIS de `code`). i18n 100%
// t('course.*') / t('member.*') (clés FIGÉES Phase A — AUCUNE création
// Phase C). price_cents des plans = POSÉ INACTIF (aucune UI/logique de
// paiement — E4/E6 jamais activés, §6.B).

import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  Button,
  Card,
  Tag,
  Modal,
  Input,
  Select,
  Skeleton,
  EmptyState,
  Tooltip,
  useToast,
  useConfirm,
} from '@/components/ui';
import {
  Plus,
  Trash2,
  Pencil,
  ChevronRight,
  Pin,
  PinOff,
  Lock,
  Unlock,
  MessageSquare,
} from 'lucide-react';
import {
  getCourses,
  createCourse,
  getCourse,
  updateCourse,
  deleteCourse,
  createCourseModule,
  createLesson,
  updateLesson,
  deleteLesson,
  getMembershipSites,
  createMembershipSite,
  getMembershipPlans,
  createMembershipPlan,
  // ── LOT MEMBERSHIP ENROLL (Sprint 6) — gestion PRO membres / inscriptions.
  //    apiFetch (token admin, capability 'workflows.manage' côté worker). ───
  getMembers,
  enrollMember,
  getCourseEnrollments,
  // ── LOT G10 Communauté — modération PRO (apiFetch token admin) ──────────
  getModerationThreads,
  getModerationPosts,
  getModerationComments,
  moderateDeletePost,
  moderateDeleteComment,
  moderateThread,
  type Course,
  type CourseModule,
  type Lesson,
  type MembershipSite,
  type MembershipPlan,
  type MemberLite,
  type CourseEnrollment,
  type MembershipCommunityThread,
  type MembershipCommunityPost,
  type LessonComment,
} from '@/lib/api';
import { t } from '@/lib/i18n';

type CourseDetail = Course & {
  modules: CourseModule[];
  lessons: Lesson[];
};

export function CoursesAdminPage() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [courses, setCourses] = useState<Course[]>([]);
  const [sites, setSites] = useState<MembershipSite[]>([]);
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Modales de création.
  const [courseOpen, setCourseOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [moduleOpen, setModuleOpen] = useState(false);
  const [lessonOpen, setLessonOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Champs formulaire cours.
  const [cTitle, setCTitle] = useState('');
  const [cDesc, setCDesc] = useState('');
  const [cSiteId, setCSiteId] = useState('');
  const [cPlanId, setCPlanId] = useState('');

  // Champs site / plan.
  const [sSlug, setSSlug] = useState('');
  const [sName, setSName] = useState('');
  const [pName, setPName] = useState('');

  // Champs module / leçon.
  const [mTitle, setMTitle] = useState('');
  const [lModuleId, setLModuleId] = useState('');
  const [lTitle, setLTitle] = useState('');
  const [lType, setLType] = useState<'text' | 'video'>('text');
  const [lBody, setLBody] = useState('');
  const [lR2Key, setLR2Key] = useState('');
  const [lDrip, setLDrip] = useState('0');

  // ── LOT MEMBERSHIP ENROLL — gestion PRO membres / inscriptions ──────────
  // Liste des membres du tenant (getMembers) + inscrits du cours sélectionné
  // (getCourseEnrollments) + action « Inscrire à ce cours » (enrollMember).
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [enrollments, setEnrollments] = useState<CourseEnrollment[]>([]);
  const [enrollmentsLoading, setEnrollmentsLoading] = useState(false);
  const [enrollMemberId, setEnrollMemberId] = useState('');
  const [enrollBusy, setEnrollBusy] = useState(false);

  // ── LOT G10 — Modération communauté (threads PRO bornés tenant côté worker)
  const [modThreads, setModThreads] = useState<MembershipCommunityThread[]>([]);
  const [modLoading, setModLoading] = useState(false);

  // Listing inline modération : thread sélectionné → ses posts + commentaires.
  const [modThreadId, setModThreadId] = useState<string | null>(null);
  const [modPosts, setModPosts] = useState<MembershipCommunityPost[]>([]);
  const [modPostsLoading, setModPostsLoading] = useState(false);
  const [modComments, setModComments] = useState<LessonComment[]>([]);
  const [modCommentsLoading, setModCommentsLoading] = useState(false);

  const loadModeration = useCallback(async () => {
    setModLoading(true);
    const res = await getModerationThreads();
    setModLoading(false);
    // Discrimination §6.A : on consomme `data` si présent, jamais de `code`.
    if (res.data) setModThreads(res.data);
  }, []);

  // ── LOT G10 — Listing posts d'un thread (modération inline) ──────────────
  const loadModPosts = useCallback(async (threadId: string) => {
    setModPostsLoading(true);
    const res = await getModerationPosts(threadId);
    setModPostsLoading(false);
    setModPosts(res.data ?? []);
  }, []);

  // ── LOT G10 — Listing commentaires de leçon (modération inline) ──────────
  const loadModComments = useCallback(async () => {
    setModCommentsLoading(true);
    const res = await getModerationComments();
    setModCommentsLoading(false);
    setModComments(res.data ?? []);
  }, []);

  // Sélection d'un thread → charge ses posts (et la liste de commentaires).
  const selectModThread = useCallback(
    (threadId: string) => {
      setModThreadId((cur) => (cur === threadId ? null : threadId));
      if (modThreadId !== threadId) {
        void loadModPosts(threadId);
        void loadModComments();
      }
    },
    [modThreadId, loadModPosts, loadModComments],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [cRes, sRes, pRes] = await Promise.all([
      getCourses(),
      getMembershipSites(),
      getMembershipPlans(),
    ]);
    // Discrimination §6.A : on consomme `data` si présent, jamais de `code`.
    if (cRes.data) setCourses(cRes.data);
    else setLoadError(cRes.error || t('common.loading_error'));
    if (sRes.data) setSites(sRes.data);
    if (pRes.data) setPlans(pRes.data);
    setLoading(false);
  }, []);

  // ── LOT MEMBERSHIP ENROLL — liste des membres du tenant (PRO). ──────────
  const loadMembers = useCallback(async () => {
    setMembersLoading(true);
    const res = await getMembers();
    setMembersLoading(false);
    // Discrimination §6.A : on consomme `data` si présent, jamais de `code`.
    if (res.data) setMembers(res.data);
  }, []);

  // ── LOT MEMBERSHIP ENROLL — inscrits d'un cours (PRO). ──────────────────
  const loadEnrollments = useCallback(async (courseId: string) => {
    setEnrollmentsLoading(true);
    const res = await getCourseEnrollments(courseId);
    setEnrollmentsLoading(false);
    setEnrollments(res.data ?? []);
  }, []);

  useEffect(() => {
    void load();
    void loadModeration();
    void loadMembers();
  }, [load, loadModeration, loadMembers]);

  // ── LOT G10 — Modération : pin/lock toggle thread ────────────────────────
  const handleModerateThread = useCallback(
    async (th: MembershipCommunityThread, updates: { is_pinned?: number; is_locked?: number }) => {
      const res = await moderateThread(th.id, updates);
      if (res.error || !res.data) {
        toastError(res.error || t('community.error'));
        return;
      }
      success(t('community.moderate'));
      void loadModeration();
    },
    [toastError, success, loadModeration],
  );

  // ── LOT G10 — Modération : supprimer un post (n'importe lequel, borné worker)
  const handleModerateDeletePost = useCallback(
    async (postId: string) => {
      const ok = await confirm({
        title: t('community.moderate_delete'),
        danger: true,
      } as Parameters<typeof confirm>[0]);
      if (!ok) return;
      const res = await moderateDeletePost(postId);
      if (res.error || !res.data) {
        toastError(res.error || t('community.error'));
        return;
      }
      success(t('community.deleted'));
      if (modThreadId) void loadModPosts(modThreadId);
    },
    [confirm, toastError, success, modThreadId, loadModPosts],
  );

  // ── LOT G10 — Modération : supprimer un commentaire de leçon ─────────────
  const handleModerateDeleteComment = useCallback(
    async (commentId: string) => {
      const ok = await confirm({
        title: t('community.moderate_delete'),
        danger: true,
      } as Parameters<typeof confirm>[0]);
      if (!ok) return;
      const res = await moderateDeleteComment(commentId);
      if (res.error || !res.data) {
        toastError(res.error || t('community.error'));
        return;
      }
      success(t('community.deleted'));
      void loadModComments();
    },
    [confirm, toastError, success, loadModComments],
  );

  const openDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      const res = await getCourse(id);
      setDetailLoading(false);
      if (res.error || !res.data) {
        toastError(res.error || t('member.error'));
        return;
      }
      setDetail(res.data);
      // LOT MEMBERSHIP ENROLL — charge aussi les inscrits du cours sélectionné.
      setEnrollMemberId('');
      void loadEnrollments(id);
    },
    [toastError, loadEnrollments],
  );

  // ── LOT MEMBERSHIP ENROLL — « Inscrire à ce cours » (PRO, GRATUIT). ─────
  // enrollMember(courseId, memberId) — idempotent côté worker. Au succès, on
  // rafraîchit la liste des inscrits du cours.
  const handleEnrollMember = useCallback(async () => {
    if (!detail || !enrollMemberId || enrollBusy) return;
    setEnrollBusy(true);
    const res = await enrollMember(detail.id, enrollMemberId);
    setEnrollBusy(false);
    if (res.error || !res.data) {
      toastError(res.error || t('member.error'));
      return;
    }
    success(t('course.enroll_success'));
    setEnrollMemberId('');
    void loadEnrollments(detail.id);
  }, [detail, enrollMemberId, enrollBusy, toastError, success, loadEnrollments]);

  // ── Création cours ───────────────────────────────────────────────────────
  const handleCreateCourse = async () => {
    const title = cTitle.trim();
    if (!title) return;
    setBusy(true);
    const res = await createCourse({
      title,
      description: cDesc.trim() || null,
      site_id: cSiteId || null,
      plan_id: cPlanId || null,
      is_published: 0,
    });
    setBusy(false);
    if (res.error || !res.data?.id) {
      toastError(res.error || t('member.error'));
      return;
    }
    setCourseOpen(false);
    setCTitle('');
    setCDesc('');
    setCSiteId('');
    setCPlanId('');
    success(t('course.new_course'));
    void load();
  };

  // ── Publier / dépublier ──────────────────────────────────────────────────
  const togglePublish = async (c: Course) => {
    const res = await updateCourse(c.id, {
      is_published: c.is_published ? 0 : 1,
    });
    if (res.error || !res.data) {
      toastError(res.error || t('member.error'));
      return;
    }
    success(c.is_published ? t('course.draft') : t('course.published'));
    void load();
    if (detail?.id === c.id) void openDetail(c.id);
  };

  // ── Supprimer cours ──────────────────────────────────────────────────────
  const handleDeleteCourse = async (c: Course) => {
    const ok = await confirm({
      title: t('course.title'),
      description: c.title,
      danger: true,
    } as Parameters<typeof confirm>[0]);
    if (!ok) return;
    const res = await deleteCourse(c.id);
    if (res.error || !res.data) {
      toastError(res.error || t('member.error'));
      return;
    }
    if (detail?.id === c.id) setDetail(null);
    success(t('course.title'));
    void load();
  };

  // ── Création module ──────────────────────────────────────────────────────
  const handleCreateModule = async () => {
    if (!detail) return;
    const title = mTitle.trim();
    if (!title) return;
    setBusy(true);
    const res = await createCourseModule(detail.id, {
      title,
      sort_order: detail.modules.length,
    });
    setBusy(false);
    if (res.error || !res.data?.id) {
      toastError(res.error || t('member.error'));
      return;
    }
    setModuleOpen(false);
    setMTitle('');
    success(t('course.modules'));
    void openDetail(detail.id);
  };

  // ── Création leçon ───────────────────────────────────────────────────────
  const handleCreateLesson = async () => {
    if (!detail) return;
    const title = lTitle.trim();
    if (!title || !lModuleId) return;
    setBusy(true);
    const res = await createLesson({
      module_id: lModuleId,
      course_id: detail.id,
      title,
      content_type: lType,
      body_html: lType === 'text' ? lBody : null,
      // r2_key est un champ serveur-only (pas dans le type Lesson front §6.E)
      // — le worker le consomme mais ne le retourne jamais au client.
      ...(lType === 'video' && lR2Key.trim() ? { r2_key: lR2Key.trim() } : {}),
      drip_days: Math.max(0, parseInt(lDrip, 10) || 0),
      sort_order: detail.lessons.filter((x) => x.module_id === lModuleId)
        .length,
    } as Parameters<typeof createLesson>[0]);
    setBusy(false);
    if (res.error || !res.data?.id) {
      toastError(res.error || t('member.error'));
      return;
    }
    setLessonOpen(false);
    setLTitle('');
    setLBody('');
    setLR2Key('');
    setLDrip('0');
    success(t('course.lessons'));
    void openDetail(detail.id);
  };

  // ── Publier/dépublier une leçon via drip rapide (édition minimale) ───────
  const handleDeleteLesson = async (lesson: Lesson) => {
    const ok = await confirm({
      title: t('course.lessons'),
      description: lesson.title,
      danger: true,
    } as Parameters<typeof confirm>[0]);
    if (!ok || !detail) return;
    const res = await deleteLesson(lesson.id);
    if (res.error || !res.data) {
      toastError(res.error || t('member.error'));
      return;
    }
    success(t('course.lessons'));
    void openDetail(detail.id);
  };

  const handleRenameLesson = async (lesson: Lesson) => {
    const next = window.prompt(t('course.lessons'), lesson.title);
    if (next == null || !next.trim() || !detail) return;
    const res = await updateLesson(lesson.id, { title: next.trim() });
    if (res.error || !res.data) {
      toastError(res.error || t('member.error'));
      return;
    }
    success(t('course.lessons'));
    void openDetail(detail.id);
  };

  // ── Création site membre ─────────────────────────────────────────────────
  const handleCreateSite = async () => {
    const slug = sSlug.trim();
    if (!slug) return;
    setBusy(true);
    const res = await createMembershipSite({
      slug,
      name: sName.trim() || null,
      is_active: 1,
    });
    setBusy(false);
    if (res.error || !res.data?.id) {
      toastError(res.error || t('member.error'));
      return;
    }
    setSiteOpen(false);
    setSSlug('');
    setSName('');
    success(t('member.title'));
    void load();
  };

  // ── Création plan (price_cents POSÉ INACTIF — pas d'UI paiement, §6.B) ────
  const handleCreatePlan = async () => {
    const nm = pName.trim();
    if (!nm) return;
    setBusy(true);
    // On ne pose JAMAIS price_cents (E4/E6 inactif) — le backend pose le
    // défaut 0. Aucun champ prix exposé.
    const res = await createMembershipPlan({ name: nm });
    setBusy(false);
    if (res.error || !res.data?.id) {
      toastError(res.error || t('member.error'));
      return;
    }
    setPlanOpen(false);
    setPName('');
    success(t('member.title'));
    void load();
  };

  return (
    <AppLayout title={t('course.admin_title')}>
      <div className="space-y-6">
        {/* ── Sites membres + plans ────────────────────────────────────── */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">{t('member.title')}</h2>
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<Plus size={14} />}
                onClick={() => setSiteOpen(true)}
              >
                {t('member.title')}
              </Button>
            </div>
            {loading ? (
              <Skeleton className="h-16" />
            ) : sites.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {t('course.empty')}
              </p>
            ) : (
              <ul className="space-y-2">
                {sites.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span>{s.name || s.slug}</span>
                    <Tag variant="neutral" size="xs">
                      /m/{s.slug}
                    </Tag>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">
                {t('course.title')} · {t('member.title')}
              </h2>
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<Plus size={14} />}
                onClick={() => setPlanOpen(true)}
              >
                {t('member.title')}
              </Button>
            </div>
            {loading ? (
              <Skeleton className="h-16" />
            ) : plans.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {t('course.empty')}
              </p>
            ) : (
              <ul className="space-y-2">
                {plans.map((p) => (
                  <li key={p.id} className="text-sm">
                    {/* price_cents NON affiché — POSÉ INACTIF (§6.B). */}
                    {p.name}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* ── LOT MEMBERSHIP ENROLL — Membres du tenant (gestion PRO) ──── */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">{t('members.title')}</h2>
          </div>
          {membersLoading ? (
            <Skeleton className="h-16" />
          ) : members.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('course.empty')}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="truncate">{m.name || m.email}</span>
                    {m.name && (
                      <span
                        className="text-xs truncate"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {m.email}
                      </span>
                    )}
                  </span>
                  {m.status && (
                    <Tag
                      variant={m.status === 'active' ? 'success' : 'neutral'}
                      size="xs"
                    >
                      {m.status}
                    </Tag>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── Liste des cours ──────────────────────────────────────────── */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">{t('member.my_courses')}</h2>
            <Button
              size="sm"
              leftIcon={<Plus size={14} />}
              onClick={() => setCourseOpen(true)}
            >
              {t('course.new_course')}
            </Button>
          </div>

          {loading ? (
            <div aria-busy="true" aria-live="polite">
              <span className="sr-only">{t('common.loading')}</span>
              <Skeleton className="h-32" />
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-start gap-3 py-2" role="alert">
              <p className="text-sm font-medium">
                {t('common.loading_error')}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {loadError}
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void load()}
              >
                {t('common.retry')}
              </Button>
            </div>
          ) : courses.length === 0 ? (
            <EmptyState
              variant="compact"
              title={t('course.empty')}
              action={
                <Button
                  size="sm"
                  leftIcon={<Plus size={14} />}
                  onClick={() => setCourseOpen(true)}
                >
                  {t('course.new_course')}
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {courses.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between py-3"
                >
                  <button
                    type="button"
                    onClick={() => void openDetail(c.id)}
                    className="flex items-center gap-2 text-sm font-medium text-left"
                  >
                    <ChevronRight size={14} />
                    {c.title}
                  </button>
                  <div className="flex items-center gap-2">
                    <Tag
                      variant={c.is_published ? 'success' : 'warning'}
                      size="xs"
                    >
                      {c.is_published
                        ? t('course.published')
                        : t('course.draft')}
                    </Tag>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void togglePublish(c)}
                    >
                      {c.is_published
                        ? t('course.draft')
                        : t('course.published')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      leftIcon={<Trash2 size={14} />}
                      onClick={() => void handleDeleteCourse(c)}
                      aria-label={t('action.delete')}
                    >
                      {''}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── Détail cours : modules + leçons ──────────────────────────── */}
        {detailLoading && <Skeleton className="h-40" />}
        {detail && !detailLoading && (
          <Card>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold">{detail.title}</h2>
                {detail.description && (
                  <p
                    className="text-xs mt-1"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {detail.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<Plus size={14} />}
                  onClick={() => setModuleOpen(true)}
                >
                  {t('course.modules')}
                </Button>
                <Button
                  size="sm"
                  leftIcon={<Plus size={14} />}
                  onClick={() => {
                    setLModuleId(detail.modules[0]?.id || '');
                    setLessonOpen(true);
                  }}
                >
                  {t('course.lessons')}
                </Button>
              </div>
            </div>

            {detail.modules.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {t('course.empty')}
              </p>
            ) : (
              <div className="space-y-4">
                {detail.modules
                  .slice()
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((m) => (
                    <div key={m.id}>
                      <h3 className="text-sm font-semibold mb-2">
                        {m.title}
                      </h3>
                      <ul className="space-y-1 pl-3">
                        {detail.lessons
                          .filter((l) => l.module_id === m.id)
                          .sort((a, b) => a.sort_order - b.sort_order)
                          .map((l) => (
                            <li
                              key={l.id}
                              className="flex items-center justify-between text-sm py-1"
                            >
                              <span className="flex items-center gap-2">
                                {l.title}
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
                              </span>
                              <span className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  leftIcon={<Pencil size={13} />}
                                  onClick={() =>
                                    void handleRenameLesson(l)
                                  }
                                >
                                  {''}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  leftIcon={<Trash2 size={13} />}
                                  onClick={() =>
                                    void handleDeleteLesson(l)
                                  }
                                >
                                  {''}
                                </Button>
                              </span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
              </div>
            )}

            {/* ── LOT MEMBERSHIP ENROLL — inscrits + « Inscrire à ce cours »
                (PRO, GRATUIT). enrollMember idempotent côté worker. ─────── */}
            <div className="mt-6 border-t border-[var(--border)] pt-4">
              <h3 className="text-sm font-semibold mb-3">
                {t('members.title')}
              </h3>

              {/* Action : inscrire un membre du tenant à ce cours. */}
              <div className="flex items-end gap-2 mb-4">
                <div className="flex-1">
                  <Select
                    label={t('members.enroll_action')}
                    value={enrollMemberId}
                    onChange={(e) => setEnrollMemberId(e.target.value)}
                  >
                    <option value="">—</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name ? `${m.name} (${m.email})` : m.email}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button
                  size="sm"
                  isLoading={enrollBusy}
                  disabled={!enrollMemberId}
                  leftIcon={<Plus size={14} />}
                  onClick={() => void handleEnrollMember()}
                >
                  {t('members.enroll_action')}
                </Button>
              </div>

              {/* Liste des inscrits du cours. */}
              {enrollmentsLoading ? (
                <Skeleton className="h-16" />
              ) : enrollments.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {t('course.empty')}
                </p>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {enrollments.map((e) => (
                    <li
                      key={e.id}
                      className="flex items-center justify-between py-2 text-sm"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="truncate">
                          {e.name || e.email || e.member_id}
                        </span>
                        {e.name && e.email && (
                          <span
                            className="text-xs truncate"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {e.email}
                          </span>
                        )}
                      </span>
                      <Tag
                        variant={e.status === 'active' ? 'success' : 'neutral'}
                        size="xs"
                      >
                        {e.status}
                      </Tag>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        )}

        {/* ── LOT G10 — Modération communauté (listing inline) ──────────── */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">
              {t('community.title')} · {t('community.moderate')}
            </h2>
          </div>

          {modLoading ? (
            <Skeleton className="h-24" />
          ) : modThreads.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('community.moderate_empty')}
            </p>
          ) : (
            <ul className="mod-thread-list divide-y divide-[var(--border)]">
              {modThreads.map((th) => {
                const isOpen = modThreadId === th.id;
                return (
                  <li key={th.id} className="mod-thread">
                    <div className="mod-thread-head">
                      <button
                        type="button"
                        className="mod-thread-title"
                        onClick={() => selectModThread(th.id)}
                        aria-expanded={isOpen}
                      >
                        <ChevronRight
                          size={14}
                          className="mod-thread-chevron"
                          style={{
                            transform: isOpen ? 'rotate(90deg)' : 'none',
                          }}
                        />
                        <span className="truncate">{th.title}</span>
                        {th.is_pinned ? (
                          <Tag variant="info" size="xs">
                            {t('community.pinned')}
                          </Tag>
                        ) : null}
                        {th.is_locked ? (
                          <Tag variant="warning" size="xs">
                            {t('community.locked')}
                          </Tag>
                        ) : null}
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <Tooltip content={t('community.pinned')}>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={t('community.pinned')}
                            leftIcon={
                              th.is_pinned ? (
                                <PinOff size={14} />
                              ) : (
                                <Pin size={14} />
                              )
                            }
                            onClick={() =>
                              void handleModerateThread(th, {
                                is_pinned: th.is_pinned ? 0 : 1,
                              })
                            }
                          >
                            {''}
                          </Button>
                        </Tooltip>
                        <Tooltip content={t('community.locked')}>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={t('community.locked')}
                            leftIcon={
                              th.is_locked ? (
                                <Unlock size={14} />
                              ) : (
                                <Lock size={14} />
                              )
                            }
                            onClick={() =>
                              void handleModerateThread(th, {
                                is_locked: th.is_locked ? 0 : 1,
                              })
                            }
                          >
                            {''}
                          </Button>
                        </Tooltip>
                      </div>
                    </div>

                    {/* Listing inline : posts du thread + commentaires de leçon. */}
                    {isOpen && (
                      <div className="mod-thread-body">
                        {/* Posts */}
                        <div className="mod-section">
                          <p className="mod-section-label">
                            {t('community.posts')}
                          </p>
                          {modPostsLoading ? (
                            <Skeleton className="h-12" />
                          ) : modPosts.length === 0 ? (
                            <p className="mod-empty">
                              {t('community.moderate_empty')}
                            </p>
                          ) : (
                            <ul className="mod-item-list">
                              {modPosts.map((p) => (
                                <li key={p.id} className="mod-item">
                                  <p className="mod-item-body">{p.body}</p>
                                  <Tooltip
                                    content={t('community.moderate_delete')}
                                  >
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      aria-label={t('community.moderate_delete')}
                                      leftIcon={<Trash2 size={13} />}
                                      onClick={() =>
                                        void handleModerateDeletePost(p.id)
                                      }
                                    >
                                      {''}
                                    </Button>
                                  </Tooltip>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        {/* Commentaires de leçon */}
                        <div className="mod-section">
                          <p className="mod-section-label">
                            <MessageSquare size={12} />{' '}
                            {t('community.comments')}
                          </p>
                          {modCommentsLoading ? (
                            <Skeleton className="h-12" />
                          ) : modComments.length === 0 ? (
                            <p className="mod-empty">
                              {t('community.moderate_empty')}
                            </p>
                          ) : (
                            <ul className="mod-item-list">
                              {modComments.map((c) => (
                                <li key={c.id} className="mod-item">
                                  <p className="mod-item-body">{c.body}</p>
                                  <Tooltip
                                    content={t('community.moderate_delete')}
                                  >
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      aria-label={t('community.moderate_delete')}
                                      leftIcon={<Trash2 size={13} />}
                                      onClick={() =>
                                        void handleModerateDeleteComment(c.id)
                                      }
                                    >
                                      {''}
                                    </Button>
                                  </Tooltip>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* ── Modale nouveau cours ─────────────────────────────────────────── */}
      <Modal
        open={courseOpen}
        onOpenChange={setCourseOpen}
        title={t('course.new_course')}
      >
        <div className="space-y-4">
          <Input
            label={t('course.title')}
            value={cTitle}
            onChange={(e) => setCTitle(e.target.value)}
          />
          <Input
            label={t('course.description')}
            value={cDesc}
            onChange={(e) => setCDesc(e.target.value)}
          />
          <Select
            label={t('member.title')}
            value={cSiteId}
            onChange={(e) => setCSiteId(e.target.value)}
          >
            <option value="">—</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.slug}
              </option>
            ))}
          </Select>
          <Select
            label={t('course.title')}
            value={cPlanId}
            onChange={(e) => setCPlanId(e.target.value)}
          >
            <option value="">—</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Button
            fullWidth
            isLoading={busy}
            onClick={() => void handleCreateCourse()}
          >
            {t('course.new_course')}
          </Button>
        </div>
      </Modal>

      {/* ── Modale nouveau site membre ───────────────────────────────────── */}
      <Modal
        open={siteOpen}
        onOpenChange={setSiteOpen}
        title={t('member.title')}
      >
        <div className="space-y-4">
          <Input
            label="slug"
            value={sSlug}
            onChange={(e) => setSSlug(e.target.value)}
          />
          <Input
            label={t('member.name')}
            value={sName}
            onChange={(e) => setSName(e.target.value)}
          />
          <Button
            fullWidth
            isLoading={busy}
            onClick={() => void handleCreateSite()}
          >
            {t('member.title')}
          </Button>
        </div>
      </Modal>

      {/* ── Modale nouveau plan (sans paiement — §6.B) ───────────────────── */}
      <Modal
        open={planOpen}
        onOpenChange={setPlanOpen}
        title={t('member.title')}
      >
        <div className="space-y-4">
          <Input
            label={t('member.name')}
            value={pName}
            onChange={(e) => setPName(e.target.value)}
          />
          <Button
            fullWidth
            isLoading={busy}
            onClick={() => void handleCreatePlan()}
          >
            {t('member.title')}
          </Button>
        </div>
      </Modal>

      {/* ── Modale nouveau module ────────────────────────────────────────── */}
      <Modal
        open={moduleOpen}
        onOpenChange={setModuleOpen}
        title={t('course.modules')}
      >
        <div className="space-y-4">
          <Input
            label={t('course.title')}
            value={mTitle}
            onChange={(e) => setMTitle(e.target.value)}
          />
          <Button
            fullWidth
            isLoading={busy}
            onClick={() => void handleCreateModule()}
          >
            {t('course.modules')}
          </Button>
        </div>
      </Modal>

      {/* ── Modale nouvelle leçon ────────────────────────────────────────── */}
      <Modal
        open={lessonOpen}
        onOpenChange={setLessonOpen}
        title={t('course.lessons')}
      >
        <div className="space-y-4">
          <Select
            label={t('course.modules')}
            value={lModuleId}
            onChange={(e) => setLModuleId(e.target.value)}
          >
            <option value="">—</option>
            {detail?.modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </Select>
          <Input
            label={t('course.title')}
            value={lTitle}
            onChange={(e) => setLTitle(e.target.value)}
          />
          <Select
            label={t('course.video')}
            value={lType}
            onChange={(e) =>
              setLType(e.target.value === 'video' ? 'video' : 'text')
            }
          >
            <option value="text">{t('course.text_lesson')}</option>
            <option value="video">{t('course.video')}</option>
          </Select>
          {lType === 'text' ? (
            <Input
              label={t('course.text_lesson')}
              value={lBody}
              onChange={(e) => setLBody(e.target.value)}
            />
          ) : (
            <Input
              label="r2_key"
              value={lR2Key}
              onChange={(e) => setLR2Key(e.target.value)}
            />
          )}
          <Input
            type="number"
            label={t('member.locked_drip')}
            value={lDrip}
            onChange={(e) => setLDrip(e.target.value)}
          />
          <Button
            fullWidth
            isLoading={busy}
            onClick={() => void handleCreateLesson()}
          >
            {t('course.lessons')}
          </Button>
        </div>
      </Modal>
    </AppLayout>
  );
}
