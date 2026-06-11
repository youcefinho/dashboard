// ── site-ssr.ts — LOT SITE BUILDER (Sprint 10) ──────────────────────────────
//
// Snapshot crawler méta/OG-only pour `/site/:slug` et `/site/:slug/:page`. NEUF
// (route-meta-ssr.ts est GELÉ — on ne l'édite PAS ; on CALQUE son pattern
// maybeServeFunnelSsr dans ce fichier neuf).
//
// MÊME contrat que maybeServeFunnelSsr : ne sert un snapshot QUE si UA = crawler
// connu ET le slug résout une publication active. Sinon renvoie null ⇒ la
// requête traverse vers le SPA hydraté (route /site/$slug[/$page]). PAS de SSR
// React : on ne rend QUE les meta/OG (titre/description/image SEO) depuis
// site_publications + site_pages.seo_* (page d'accueil is_home=1, ou la page
// ciblée par :page). Verdict figé §6.E.
//
// best-effort : toute panne D1 / table absente (seq 111 non jouée) ⇒ catch ⇒
// null (le SPA prend le relais). NE THROW JAMAIS. async (lookup D1).
//
// ⚠ STUB PHASE A — SIGNATURE FIGÉE (Manager-A SOLO). Le squelette (garde
//   crawler + match path + résolution slug) est posé ; le CORPS RÉEL (lecture
//   site_pages.seo_* + rendu du snapshot) est écrit Phase B (Manager-B), calque
//   EXACT maybeServeFunnelSsr (route-meta-ssr.ts). Le stub renvoie null tant que
//   le corps n'est pas écrit ⇒ jamais bloquant (le SPA hydraté sert la page).

const SITE_URL = 'https://crm.intralys.com';
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.svg`;

// Échappement HTML — CALQUE EXACT route-meta-ssr.ts:escapeHtml (privé, non
// exporté ⇒ réimplémenté localement, on n'édite PAS le gelé).
function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Snapshot méta/OG minimal — CALQUE route-meta-ssr.ts:renderSnapshotHtml
// (réimplémenté localement : la fonction est privée au module gelé).
function renderSnapshotHtml(
  meta: { title: string; description: string; image: string },
  fullUrl: string,
): string {
  const t = escapeHtml(meta.title);
  const d = escapeHtml(meta.description);
  const u = escapeHtml(fullUrl);
  const img = escapeHtml(meta.image);
  return `<!DOCTYPE html>
<html lang="fr-CA">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${t}</title>
  <meta name="description" content="${d}" />
  <link rel="canonical" href="${u}" />
  <meta name="theme-color" content="#635BFF" />

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Intralys CRM" />
  <meta property="og:title" content="${t}" />
  <meta property="og:description" content="${d}" />
  <meta property="og:url" content="${u}" />
  <meta property="og:image" content="${img}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:locale" content="fr_CA" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${t}" />
  <meta name="twitter:description" content="${d}" />
  <meta name="twitter:image" content="${img}" />
</head>
<body>
  <h1>${t}</h1>
  <p>${d}</p>
  <p><a href="${u}">${u}</a></p>
</body>
</html>`;
}

// Crawlers connus (case-insensitive) — CALQUE EXACT route-meta-ssr.ts:CRAWLER_PATTERNS.
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
 * Si la requête correspond à un crawler ET à un site publié (slug → publication
 * active), retourne un snapshot HTML méta/OG. Sinon retourne null ⇒ la requête
 * traverse vers le SPA hydraté. CALQUE EXACT maybeServeFunnelSsr.
 *
 * `env` typé `unknown` (calque maybeServeFunnelSsr — pas de couplage au type Env) ;
 * l'appelant (worker.ts) passe son `env`. Accès D1 défensif via cast local.
 */
export async function maybeServeSiteSsr(
  request: Request,
  env: unknown,
  url: URL,
): Promise<Response | null> {
  if (request.method !== 'GET') return null;

  const ua = request.headers.get('user-agent') || '';
  const isCrawler = CRAWLER_PATTERNS.some((re) => re.test(ua));
  if (!isCrawler) return null;

  // Match `/site/:slug` ou `/site/:slug/:page` (path public SPA, PAS l'API).
  const m = url.pathname.match(/^\/site\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!m) return null;
  const slug = decodeURIComponent(m[1]!);
  const pageSlug = m[2] ? decodeURIComponent(m[2]) : null;

  // CALQUE EXACT maybeServeFunnelSsr : accès D1 défensif via cast local (env
  // typé unknown — pas de couplage au type Env). try/catch ⇒ null. NE THROW JAMAIS.
  try {
    const db = (env as { DB?: { prepare: (q: string) => unknown } }).DB;
    if (!db) return null;

    const bindFirst = (q: string, ...a: unknown[]) =>
      (
        db.prepare(q) as {
          bind: (...x: unknown[]) => { first: () => Promise<unknown> };
        }
      )
        .bind(...a)
        .first();

    const pub = (await bindFirst(
      'SELECT site_id FROM site_publications WHERE slug = ? AND is_active = 1',
      slug,
    )) as { site_id: string } | null;
    if (!pub) return null;

    const site = (await bindFirst(
      'SELECT name, description FROM sites WHERE id = ?',
      pub.site_id,
    )) as { name: string | null; description: string | null } | null;

    // page ciblée (:page) sinon page d'accueil (is_home=1, fallback position ASC).
    const page = (pageSlug
      ? await bindFirst(
          'SELECT seo_title, seo_description, seo_image FROM site_pages WHERE site_id = ? AND slug = ?',
          pub.site_id,
          pageSlug,
        )
      : await bindFirst(
          'SELECT seo_title, seo_description, seo_image FROM site_pages WHERE site_id = ? ORDER BY is_home DESC, position ASC LIMIT 1',
          pub.site_id,
        )) as {
      seo_title: string | null;
      seo_description: string | null;
      seo_image: string | null;
    } | null;

    const title = page?.seo_title || site?.name || 'Intralys';
    const description =
      page?.seo_description || site?.description || 'Page propulsée par Intralys.';
    const image = page?.seo_image || DEFAULT_OG_IMAGE;
    const fullUrl = SITE_URL + url.pathname;

    const html = renderSnapshotHtml({ title, description, image }, fullUrl);
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=600, s-maxage=3600',
        'X-Robots-Tag': 'index, follow',
      },
    });
  } catch {
    // Table seq 111 absente / panne D1 : laisse traverser au SPA.
    return null;
  }
}
