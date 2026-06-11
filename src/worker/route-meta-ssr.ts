// ── Sprint 47 M2.4 — ROUTE_META_SSR ──────────────────────────────────────────
// Sert un snapshot HTML léger avec meta tags par route marketing aux crawlers
// (Googlebot, Bingbot, Facebook externalhit, Twitterbot, LinkedInBot, Slackbot).
//
// Le SPA TanStack Router charge `MarketingMeta` côté client pour les vrais
// navigateurs (UX normale, SEO via og:* lus par crawlers une fois le HTML
// snapshot servi). Cette fonction ne sert le snapshot QUE si le User-Agent
// matche un crawler connu — sinon on laisse la requête traverser vers
// l'asset static `index.html` du SPA.
//
// Compatible Cloudflare Workers (Web Standards API).

export interface RouteMeta {
  title: string;
  description: string;
  /** Path complet sans domain, ex: "/marketing/pricing". Utilisé pour og:url + canonical. */
  path: string;
  /** OG image absolue (recommandé 1200×630). */
  image?: string;
}

const SITE_URL = 'https://crm.intralys.com';
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.svg`;

/**
 * Map des routes marketing → meta. Doit rester synchronisé avec les composants
 * `<MarketingMeta />` côté client (mêmes valeurs).
 */
export const ROUTE_META_SSR: Record<string, RouteMeta> = {
  '/': {
    title: 'Intralys CRM — CRM tout-en-un pour PMEs francophones',
    description:
      'CRM moderne pour PMEs québécoises : leads, pipeline, workflows, AI FR. Conforme Loi 25 + CASL. Hébergé au Canada. 14 jours gratuits.',
    path: '/',
  },
  '/pricing': {
    title: 'Tarification — Intralys CRM',
    description:
      "Tarification simple : Starter 29$ / Pro 49$ / Agency 99$ par mois. Sans surprise, sans engagement. 14 jours d'essai gratuit.",
    path: '/pricing',
  },
  '/marketing/pricing': {
    title: 'Tarification — Intralys CRM',
    description:
      "Tarification simple : Starter 29$ / Pro 49$ / Agency 99$ par mois. Sans surprise, sans engagement. 14 jours d'essai gratuit.",
    path: '/marketing/pricing',
  },
  '/about': {
    title: 'À propos — Intralys CRM',
    description:
      'Intralys est une équipe québécoise qui bâtit un CRM moderne pour les PMEs francophones. Découvre notre mission, notre équipe et nos partenaires.',
    path: '/about',
  },
  '/marketing/about': {
    title: 'À propos — Intralys CRM',
    description:
      'Intralys est une équipe québécoise qui bâtit un CRM moderne pour les PMEs francophones. Découvre notre mission, notre équipe et nos partenaires.',
    path: '/marketing/about',
  },
  '/contact': {
    title: 'Contact — Intralys CRM',
    description:
      "Contactez l'équipe Intralys : ventes, support, partenariats. Réponse garantie sous 24h. Siège social à Québec.",
    path: '/contact',
  },
  '/marketing/contact': {
    title: 'Contact — Intralys CRM',
    description:
      "Contactez l'équipe Intralys : ventes, support, partenariats. Réponse garantie sous 24h. Siège social à Québec.",
    path: '/marketing/contact',
  },
  '/legal/terms': {
    title: "Conditions d'utilisation — Intralys CRM",
    description:
      "Conditions d'utilisation de la plateforme Intralys CRM. Règles d'usage, tarification, confidentialité, résiliation. Conforme au droit québécois.",
    path: '/legal/terms',
  },
  '/legal/privacy': {
    title: 'Politique de confidentialité — Intralys CRM',
    description:
      'Politique de confidentialité d\'Intralys CRM. Conforme Loi 25 Québec et PIPEDA. Vos droits d\'accès, rectification, portabilité, suppression. DPO contact.',
    path: '/legal/privacy',
  },
  '/legal/cookies': {
    title: 'Politique des cookies — Intralys CRM',
    description:
      'Politique des cookies d\'Intralys CRM. Types de cookies (essentiels, préférences, analytics), durée, gestion, opt-out. Aucun cookie tiers ni publicitaire.',
    path: '/legal/cookies',
  },
  '/legal/loi-25': {
    title: 'Conformité Loi 25 — Intralys CRM',
    description:
      "Comment Intralys CRM respecte la Loi 25 du Québec : RPRP, EFVP, notification d'incidents, consentement granulaire, droits d'accès et portabilité.",
    path: '/legal/loi-25',
  },
  '/legal/casl': {
    title: 'Conformité CASL — Intralys CRM',
    description:
      'Comment Intralys CRM respecte la CASL (Canadian Anti-Spam Legislation) : consentement exprès/tacite, identification, mécanisme désabonnement automatique.',
    path: '/legal/casl',
  },
};

// Crawlers connus (case-insensitive). Match sur User-Agent.
const CRAWLER_PATTERNS = [
  /googlebot/i,
  /bingbot/i,
  /yandexbot/i,
  /duckduckbot/i,
  /baiduspider/i,
  /facebookexternalhit/i,
  /facebot/i,
  /twitterbot/i,
  /linkedinbot/i,
  /slackbot/i,
  /telegrambot/i,
  /whatsapp/i,
  /discordbot/i,
  /applebot/i,
  /pinterest/i,
];

/**
 * Si la requête correspond à un crawler ET à une route marketing connue,
 * retourne un snapshot HTML léger avec meta tags. Sinon, retourne null pour
 * laisser le fetch continuer vers l'asset SPA normal.
 */
export function maybeServeSsrMeta(request: Request): Response | null {
  if (request.method !== 'GET') return null;

  const ua = request.headers.get('user-agent') || '';
  const isCrawler = CRAWLER_PATTERNS.some((re) => re.test(ua));
  if (!isCrawler) return null;

  const url = new URL(request.url);
  const meta = ROUTE_META_SSR[url.pathname];
  if (!meta) return null;

  const fullUrl = SITE_URL + meta.path;
  const image = meta.image ?? DEFAULT_OG_IMAGE;

  const html = renderSnapshotHtml({ ...meta, image }, fullUrl);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'X-Robots-Tag': 'index, follow',
    },
  });
}

function renderSnapshotHtml(meta: Required<RouteMeta>, fullUrl: string): string {
  const escapedTitle = escapeHtml(meta.title);
  const escapedDesc = escapeHtml(meta.description);
  const escapedUrl = escapeHtml(fullUrl);
  const escapedImage = escapeHtml(meta.image);

  return `<!DOCTYPE html>
<html lang="fr-CA">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapedTitle}</title>
  <meta name="description" content="${escapedDesc}" />
  <link rel="canonical" href="${escapedUrl}" />
  <meta name="theme-color" content="#635BFF" />

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Intralys CRM" />
  <meta property="og:title" content="${escapedTitle}" />
  <meta property="og:description" content="${escapedDesc}" />
  <meta property="og:url" content="${escapedUrl}" />
  <meta property="og:image" content="${escapedImage}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:locale" content="fr_CA" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapedTitle}" />
  <meta name="twitter:description" content="${escapedDesc}" />
  <meta name="twitter:image" content="${escapedImage}" />

  <!-- Schema.org JSON-LD : SoftwareApplication -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "Intralys CRM",
    "url": "${escapedUrl}",
    "@id": "${SITE_URL}/#org",
    "applicationCategory": "BusinessApplication",
    "operatingSystem": "Web, iOS, Android",
    "description": "${escapedDesc}",
    "offers": {
      "@type": "Offer",
      "priceCurrency": "CAD",
      "price": "29.00"
    },
    "publisher": {
      "@type": "Organization",
      "name": "Intralys",
      "url": "${SITE_URL}"
    }
  }
  </script>
</head>
<body>
  <h1>${escapedTitle}</h1>
  <p>${escapedDesc}</p>
  <p><a href="${escapedUrl}">${escapedUrl}</a></p>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── LOT FUNNEL — snapshot crawler méta/OG-only pour `/p/:slug` ──────────────
//
// MÊME contrat que maybeServeSsrMeta : ne sert un snapshot QUE si UA = crawler
// connu (CRAWLER_PATTERNS) ET le slug résout une publication active. Sinon
// renvoie null ⇒ la requête traverse vers le SPA hydraté (route /p/$slug).
// PAS de SSR React : on ne rend QUE les meta/OG (titre/description/image SEO)
// depuis funnel_publications + funnel_pages.seo_* (verdict figé §6.E).
//
// best-effort : toute panne D1 / table absente (seq 83 non jouée) ⇒ catch ⇒
// null (le SPA prend le relais). NE THROW JAMAIS. async (lookup D1).
//
// `env` est typé `unknown` ici pour ne PAS coupler ce module au type Env
// (route-meta-ssr.ts est volontairement sans dépendance worker) ; l'appelant
// (worker.ts) passe son `env`. Accès D1 défensif via cast local.
export async function maybeServeFunnelSsr(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  if (request.method !== 'GET') return null;

  const ua = request.headers.get('user-agent') || '';
  const isCrawler = CRAWLER_PATTERNS.some((re) => re.test(ua));
  if (!isCrawler) return null;

  const url = new URL(request.url);
  const m = url.pathname.match(/^\/p\/([^/]+)$/);
  if (!m) return null;
  const slug = m[1]!;

  try {
    const db = (env as { DB?: { prepare: (q: string) => unknown } }).DB;
    if (!db) return null;

    const pub = (await (
      db.prepare(
        'SELECT funnel_id FROM funnel_publications WHERE slug = ? AND is_active = 1',
      ) as {
        bind: (...a: unknown[]) => { first: () => Promise<unknown> };
      }
    )
      .bind(slug)
      .first()) as { funnel_id: string } | null;
    if (!pub) return null;

    const fn = (await (
      db.prepare('SELECT name, description FROM funnels WHERE id = ?') as {
        bind: (...a: unknown[]) => { first: () => Promise<unknown> };
      }
    )
      .bind(pub.funnel_id)
      .first()) as { name: string | null; description: string | null } | null;

    const page = (await (
      db.prepare(
        'SELECT seo_title, seo_description, seo_image FROM funnel_pages WHERE funnel_id = ? ORDER BY created_at ASC LIMIT 1',
      ) as {
        bind: (...a: unknown[]) => { first: () => Promise<unknown> };
      }
    )
      .bind(pub.funnel_id)
      .first()) as {
      seo_title: string | null;
      seo_description: string | null;
      seo_image: string | null;
    } | null;

    const title = page?.seo_title || fn?.name || 'Intralys';
    const description =
      page?.seo_description || fn?.description || 'Page propulsée par Intralys.';
    const image = page?.seo_image || DEFAULT_OG_IMAGE;
    const fullUrl = SITE_URL + url.pathname;

    const html = renderSnapshotHtml(
      { title, description, path: url.pathname, image },
      fullUrl,
    );
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=600, s-maxage=3600',
        'X-Robots-Tag': 'index, follow',
      },
    });
  } catch {
    // Table seq 83 absente / panne D1 : laisse traverser au SPA.
    return null;
  }
}
