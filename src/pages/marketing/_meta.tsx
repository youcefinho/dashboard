// ── Sprint 47 M2.4 — MarketingMeta : SEO meta tags injection ─────────────────
// Composant léger zero-dep pour gérer <title>/description/og:/twitter:/canonical
// par page marketing sans embarquer react-helmet. Utilise useEffect pour patcher
// le document.head côté client. En SSR, l'effet ne s'exécute pas — c'est OK car
// le worker.ts ROUTE_META_SSR (Sprint 47 M2.4) gère le snapshot serveur pour
// les crawlers (Google/Facebook/Twitter).

import { useEffect } from 'react';

const SITE_URL = 'https://intralys.com';
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.svg`;

export interface MarketingMetaProps {
  /** <title> — max 60 chars recommandé pour SERP. */
  title: string;
  /** <meta description> — 150-160 chars idéal. */
  description: string;
  /** Path relatif sans domain, ex: "/marketing/pricing". Utilisé pour canonical + og:url. */
  path: string;
  /** OG image URL absolue. Default = /og-image.svg du projet. */
  image?: string;
  /** Twitter card style. Default summary_large_image. */
  twitterCard?: 'summary' | 'summary_large_image';
}

/**
 * Patch les meta tags du document.head pour la page courante. Préserve les
 * defaults définis dans index.html — modifie seulement ce qui est nécessaire.
 * Au démontage : restaure les valeurs originales (évite leak entre pages).
 */
export function MarketingMeta({
  title,
  description,
  path,
  image = DEFAULT_OG_IMAGE,
  twitterCard = 'summary_large_image',
}: MarketingMetaProps) {
  useEffect(() => {
    const fullUrl = SITE_URL + path;
    const prev = snapshotMeta();

    document.title = title;
    setMeta('name', 'description', description);
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:url', fullUrl);
    setMeta('property', 'og:image', image);
    setMeta('property', 'og:type', 'website');
    setMeta('name', 'twitter:card', twitterCard);
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', description);
    setMeta('name', 'twitter:image', image);
    setCanonical(fullUrl);

    return () => {
      // Restore previous values on unmount (avoid leaking page A meta into page B
      // during SPA navigation — important pour TanStack Router).
      document.title = prev.title;
      setMeta('name', 'description', prev.description);
      setMeta('property', 'og:title', prev.ogTitle);
      setMeta('property', 'og:description', prev.ogDescription);
      setMeta('property', 'og:url', prev.ogUrl);
      setMeta('property', 'og:image', prev.ogImage);
      setMeta('name', 'twitter:title', prev.twTitle);
      setMeta('name', 'twitter:description', prev.twDescription);
      setMeta('name', 'twitter:image', prev.twImage);
      setCanonical(prev.canonical);
    };
  }, [title, description, path, image, twitterCard]);

  return null;
}

// ── Helpers ────────────────────────────────────────────────
function setMeta(attr: 'name' | 'property', key: string, value: string) {
  if (typeof document === 'undefined') return;
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', value);
}

function setCanonical(url: string) {
  if (typeof document === 'undefined') return;
  let el = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', url);
}

function getMeta(attr: 'name' | 'property', key: string): string {
  if (typeof document === 'undefined') return '';
  const el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  return el?.getAttribute('content') ?? '';
}

function getCanonical(): string {
  if (typeof document === 'undefined') return '';
  const el = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  return el?.getAttribute('href') ?? '';
}

function snapshotMeta() {
  return {
    title: typeof document !== 'undefined' ? document.title : '',
    description: getMeta('name', 'description'),
    ogTitle: getMeta('property', 'og:title'),
    ogDescription: getMeta('property', 'og:description'),
    ogUrl: getMeta('property', 'og:url'),
    ogImage: getMeta('property', 'og:image'),
    twTitle: getMeta('name', 'twitter:title'),
    twDescription: getMeta('name', 'twitter:description'),
    twImage: getMeta('name', 'twitter:image'),
    canonical: getCanonical(),
  };
}
