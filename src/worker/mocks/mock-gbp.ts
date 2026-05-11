// ── Mock Google Business Profile — fixtures avis fictifs ──

export interface MockReview {
  reviewId: string;
  reviewer: { displayName: string; profilePhotoUrl: string };
  starRating: string;
  comment: string;
  createTime: string;
  updateTime: string;
}

export function getMockGbpReviews(): { reviews: MockReview[]; averageRating: number; totalReviewCount: number } {
  return {
    averageRating: 4.7,
    totalReviewCount: 5,
    reviews: [
      {
        reviewId: 'gbp-mock-1',
        reviewer: { displayName: 'Sophie T.', profilePhotoUrl: '' },
        starRating: 'FIVE',
        comment: 'Service exceptionnel ! Mathis nous a guidés tout au long du processus d\'achat. Très professionnel et à l\'écoute.',
        createTime: new Date(Date.now() - 7 * 86400000).toISOString(),
        updateTime: new Date(Date.now() - 7 * 86400000).toISOString(),
      },
      {
        reviewId: 'gbp-mock-2',
        reviewer: { displayName: 'Marc B.', profilePhotoUrl: '' },
        starRating: 'FIVE',
        comment: 'Excellente estimation de notre propriété. Vendue en 2 semaines au-dessus du prix demandé !',
        createTime: new Date(Date.now() - 14 * 86400000).toISOString(),
        updateTime: new Date(Date.now() - 14 * 86400000).toISOString(),
      },
      {
        reviewId: 'gbp-mock-3',
        reviewer: { displayName: 'Julie P.', profilePhotoUrl: '' },
        starRating: 'FOUR',
        comment: 'Bon accompagnement pour un premier achat. Quelques délais de communication mais résultat final satisfaisant.',
        createTime: new Date(Date.now() - 30 * 86400000).toISOString(),
        updateTime: new Date(Date.now() - 30 * 86400000).toISOString(),
      },
      {
        reviewId: 'gbp-mock-4',
        reviewer: { displayName: 'Pierre L.', profilePhotoUrl: '' },
        starRating: 'FIVE',
        comment: 'Troisième transaction avec Mathis. Toujours aussi fiable et efficace. Je recommande à 100% !',
        createTime: new Date(Date.now() - 60 * 86400000).toISOString(),
        updateTime: new Date(Date.now() - 60 * 86400000).toISOString(),
      },
      {
        reviewId: 'gbp-mock-5',
        reviewer: { displayName: 'Isabelle R.', profilePhotoUrl: '' },
        starRating: 'FOUR_FIVE',
        comment: 'Très bonne connaissance du marché de Gatineau. A trouvé notre terrain idéal en 3 semaines.',
        createTime: new Date(Date.now() - 90 * 86400000).toISOString(),
        updateTime: new Date(Date.now() - 90 * 86400000).toISOString(),
      },
    ],
  };
}
