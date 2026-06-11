// ── Couleurs avatars gradient partagées ──────────────────────
// Utilisé par DashboardActivity, DashboardClients, DashboardContacts
// Centralisé ici pour éviter la duplication (était copié 3×)

export const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #635BFF 0%, #8B5CF6 100%)',
  'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
  'linear-gradient(135deg, #757BBD 0%, #D6BCFA 100%)',
  'linear-gradient(135deg, #10B981 0%, #6EE7B7 100%)',
  'linear-gradient(135deg, #EF4444 0%, #FCA5A5 100%)',
  'linear-gradient(135deg, #F97316 0%, #FDE68A 100%)',
] as const;
