// ── Funnel Blocks → HTML Compiler — Intralys CRM (LOT FUNNEL, Sprint 1) ─────
//
// Modèle de blocs des landing pages / funnels. CALQUE STRUCTUREL de
// src/worker/email-blocks.ts (BlockType / interfaces config / createDefaultBlock
// / BLOCK_PALETTE) — MAIS compilateur HTML WEB RESPONSIVE NEUF (PAS le
// compilateur email <table> ; un funnel est une page web moderne, pas un mail).
//
// ⚠ SURFACE DE TYPES FIGÉE PHASE A (Manager-A SOLO) — recopiée verbatim dans
//   docs/LOT-FUNNEL.md §6.C. NE PAS MODIFIER en Phase B/C : Manager-B (backend
//   funnels.ts) et Manager-C (front builder + corps compile) consomment ces
//   types tels quels. Seuls les CORPS de compileBlocksToHtml / createDefaultBlock
//   sont écrits en Phase C (balisés `// CORPS PHASE C`). Ce fichier est owned
//   Manager-C en Phase B pour l'IMPLÉMENTATION ; sa SIGNATURE est gelée ici.
//
// Sérialisation : un FunnelBlock[] est stocké tel quel en JSON dans
//   funnel_pages.blocks (TEXT, DEFAULT '[]'). Lecture/écriture ATOMIQUE de la
//   page entière (PAS de table funnel_blocks normalisée — verdict figé).
//
// Compatible Cloudflare Workers (Web Standards API, crypto.randomUUID).

// ── 8 BlockType FIGÉS ───────────────────────────────────────────────────────
export type BlockType =
  | 'hero'
  | 'text'
  | 'image'
  | 'video'
  | 'form'
  | 'button'
  | 'cta'
  | 'spacer';

export interface FunnelBlock {
  id: string;
  type: BlockType;
  config: Record<string, unknown>;
}

// ── Schéma `config` FIGÉ par type ───────────────────────────────────────────

export interface HeroBlockConfig {
  headline: string;
  subheadline: string;
  align: 'left' | 'center' | 'right';
  backgroundColor: string;
  textColor: string;
  backgroundImage: string; // URL ou '' (aucune)
}

export interface TextBlockConfig {
  html: string;
  color: string;
  fontSize: string; // ex '16px'
  align: 'left' | 'center' | 'right';
  maxWidth: string; // ex '720px' ou '100%'
}

export interface ImageBlockConfig {
  src: string;
  alt: string;
  width: string; // ex '100%' ou '600px'
  align: 'left' | 'center' | 'right';
  link: string; // URL ou '' (non cliquable)
}

export interface VideoBlockConfig {
  url: string; // YouTube/Vimeo/MP4 — embed responsive 16:9
  autoplay: boolean;
  align: 'left' | 'center' | 'right';
}

// Le bloc 'form' est le point de capture → CRM. `fields` décrit les champs
// rendus ; la soumission POST /api/p/:slug/submit RÉUTILISE le pipeline
// forms.ts (voir docs/LOT-FUNNEL.md §6.F). Conventions de `name` calquées
// forms.ts:69-73 (name|nom, email, phone|telephone, message|note) pour le
// mapping lead sans glue supplémentaire.
export interface FormBlockConfig {
  fields: Array<{
    name: string;
    label: string;
    type: 'text' | 'email' | 'tel' | 'textarea' | 'select';
    required: boolean;
    options?: string[]; // pour type 'select'
  }>;
  submitLabel: string;
  successMessage: string;
  redirectUrl: string; // URL post-submit ou '' (affiche successMessage)
}

export interface ButtonBlockConfig {
  text: string;
  url: string;
  backgroundColor: string;
  color: string;
  borderRadius: string;
  align: 'left' | 'center' | 'right';
  fullWidth: boolean;
}

// 'cta' = bloc d'appel à l'action composite (titre + texte + bouton) pour les
// étapes upsell/thankyou.
export interface CtaBlockConfig {
  headline: string;
  text: string;
  buttonText: string;
  buttonUrl: string;
  backgroundColor: string;
  textColor: string;
  buttonColor: string;
  align: 'left' | 'center' | 'right';
}

export interface SpacerBlockConfig {
  height: string; // ex '40px'
}

// ── Compilateur principal — CORPS PHASE C ───────────────────────────────────
// SIGNATURE FIGÉE Phase A. Le corps réel (rendu web responsive moderne :
// container max-width, flex/grid, <video> embed, <form> postant
// /api/p/:slug/submit) est écrit Phase C par Manager-C. Stub minimal non
// bloquant : renvoie un squelette HTML valide pour ne pas casser le build /
// les imports tant que le corps n'est pas écrit.
// Sécurité XSS : échappement HTML — CALQUE EXACT route-meta-ssr.ts:218-225
// (escapeHtml). Tout contenu utilisateur (config des blocs) rendu publiquement
// DOIT être échappé. Non négociable (§6.C / brief).
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
const escAttr = esc;

// Sanitize URL : seulement http(s), mailto, tel, ancres, chemins relatifs.
// Toute autre valeur (javascript:, data:, vbscript:…) → '#'.
function safeUrl(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '#';
  if (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(s)) return esc(s);
  return '#';
}

const ALIGN_MAP: Record<string, 'left' | 'center' | 'right'> = {
  left: 'left',
  center: 'center',
  right: 'right',
};
function safeAlign(v: unknown): 'left' | 'center' | 'right' {
  return ALIGN_MAP[String(v ?? 'left')] || 'left';
}

// Embed vidéo responsive 16:9 (YouTube / Vimeo iframe ; sinon <video>).
function renderVideoEmbed(rawUrl: string, autoplay: boolean): string {
  const url = String(rawUrl || '').trim();
  if (!url) return '';
  const ap = autoplay ? 1 : 0;
  const yt = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/i,
  );
  if (yt) {
    return `<iframe class="fb-video" src="https://www.youtube.com/embed/${esc(yt[1])}?autoplay=${ap}&rel=0" title="video" frameborder="0" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
  }
  const vm = url.match(/vimeo\.com\/(\d+)/i);
  if (vm) {
    return `<iframe class="fb-video" src="https://player.vimeo.com/video/${esc(vm[1])}?autoplay=${ap}" title="video" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
  }
  const src = safeUrl(url);
  if (src === '#') return '';
  return `<video class="fb-video" src="${src}" controls ${autoplay ? 'autoplay muted' : ''} playsinline></video>`;
}

// ── Rendu d'un bloc individuel (web responsive moderne) ─────────────────────
function renderBlock(block: FunnelBlock): string {
  const c = (block.config || {}) as Record<string, unknown>;
  switch (block.type) {
    case 'hero': {
      const align = safeAlign(c.align ?? 'center');
      const bg = esc((c.backgroundColor as string) || '#0b1220');
      const fg = esc((c.textColor as string) || '#ffffff');
      const bgImg = String(c.backgroundImage || '').trim();
      const bgImgUrl = bgImg ? safeUrl(bgImg) : '';
      const bgStyle =
        bgImgUrl && bgImgUrl !== '#'
          ? `background:${bg} url('${bgImgUrl}') center/cover no-repeat;`
          : `background:${bg};`;
      return `<section class="fb-hero" style="${bgStyle}color:${fg};text-align:${align};">
  <div class="fb-container">
    <h1 class="fb-hero-title">${esc(c.headline)}</h1>
    ${c.subheadline ? `<p class="fb-hero-sub">${esc(c.subheadline)}</p>` : ''}
  </div>
</section>`;
    }
    case 'text': {
      const align = safeAlign(c.align);
      const color = esc((c.color as string) || '#374151');
      const fontSize = esc((c.fontSize as string) || '16px');
      const maxWidth = esc((c.maxWidth as string) || '720px');
      // Contenu saisi par l'éditeur : on ÉCHAPPE (rendu public, pas de HTML
      // arbitraire injecté) ; les retours ligne deviennent des <br>.
      const safeHtml = esc(c.html).replace(/\n/g, '<br>');
      return `<section class="fb-section"><div class="fb-container" style="max-width:${maxWidth};">
  <div class="fb-text" style="color:${color};font-size:${fontSize};text-align:${align};">${safeHtml}</div>
</div></section>`;
    }
    case 'image': {
      const src = safeUrl(c.src);
      if (src === '#') return '';
      const alt = escAttr(c.alt);
      const width = esc((c.width as string) || '100%');
      const align = safeAlign(c.align ?? 'center');
      const link = String(c.link || '').trim();
      const img = `<img class="fb-img" src="${src}" alt="${alt}" style="width:${width};max-width:100%;" loading="lazy" />`;
      const wrapped = link
        ? `<a href="${safeUrl(link)}" target="_blank" rel="noopener noreferrer">${img}</a>`
        : img;
      return `<section class="fb-section"><div class="fb-container" style="text-align:${align};">${wrapped}</div></section>`;
    }
    case 'video': {
      const align = safeAlign(c.align ?? 'center');
      const embed = renderVideoEmbed(String(c.url || ''), Boolean(c.autoplay));
      if (!embed) return '';
      return `<section class="fb-section"><div class="fb-container" style="text-align:${align};">
  <div class="fb-video-wrap">${embed}</div>
</div></section>`;
    }
    case 'form': {
      const fields = Array.isArray(c.fields)
        ? (c.fields as FormBlockConfig['fields'])
        : [];
      const submitLabel = esc((c.submitLabel as string) || 'Envoyer');
      const fieldsHtml = fields
        .map((f) => {
          const name = escAttr(f?.name || '');
          const label = esc(f?.label || '');
          const required = f?.required ? 'required' : '';
          const reqMark = f?.required ? ' <span class="fb-req">*</span>' : '';
          const id = `fb-f-${name || Math.random().toString(36).slice(2, 8)}`;
          let control: string;
          if (f?.type === 'textarea') {
            control = `<textarea id="${id}" name="${name}" ${required} rows="4" class="fb-input"></textarea>`;
          } else if (f?.type === 'select') {
            const opts = Array.isArray(f?.options) ? f.options : [];
            control = `<select id="${id}" name="${name}" ${required} class="fb-input">
        <option value="">—</option>
        ${opts.map((o) => `<option value="${escAttr(o)}">${esc(o)}</option>`).join('')}
      </select>`;
          } else {
            const inputType =
              f?.type === 'email' ? 'email' : f?.type === 'tel' ? 'tel' : 'text';
            control = `<input id="${id}" type="${inputType}" name="${name}" ${required} class="fb-input" />`;
          }
          return `<div class="fb-field">
      <label for="${id}" class="fb-label">${label}${reqMark}</label>
      ${control}
    </div>`;
        })
        .join('\n');
      // <form> postant POST /api/p/:slug/submit. data-* lus par le SPA hydraté
      // (PublicFunnel.tsx) qui intercepte le submit (fetch).
      return `<section class="fb-section"><div class="fb-container fb-container--narrow">
  <form class="fb-form" data-fb-form data-fb-success="${escAttr(c.successMessage || '')}" data-fb-redirect="${escAttr(c.redirectUrl || '')}">
    ${fieldsHtml}
    <button type="submit" class="fb-btn fb-btn--block">${submitLabel}</button>
  </form>
</div></section>`;
    }
    case 'button': {
      const text = esc((c.text as string) || '');
      const url = safeUrl(c.url);
      const bg = esc((c.backgroundColor as string) || '#635BFF');
      const color = esc((c.color as string) || '#ffffff');
      const radius = esc((c.borderRadius as string) || '8px');
      const align = safeAlign(c.align ?? 'center');
      const fullWidth = Boolean(c.fullWidth);
      const wstyle = fullWidth
        ? 'display:block;width:100%;text-align:center;'
        : 'display:inline-block;';
      return `<section class="fb-section"><div class="fb-container" style="text-align:${align};">
  <a href="${url}" target="_blank" rel="noopener noreferrer" class="fb-btn" style="${wstyle}background:${bg};color:${color};border-radius:${radius};">${text}</a>
</div></section>`;
    }
    case 'cta': {
      const align = safeAlign(c.align ?? 'center');
      const bg = esc((c.backgroundColor as string) || '#0b1220');
      const fg = esc((c.textColor as string) || '#ffffff');
      const btnColor = esc((c.buttonColor as string) || '#635BFF');
      const btnUrl = safeUrl(c.buttonUrl);
      return `<section class="fb-cta" style="background:${bg};color:${fg};text-align:${align};">
  <div class="fb-container">
    <h2 class="fb-cta-title">${esc(c.headline)}</h2>
    ${c.text ? `<p class="fb-cta-text">${esc(c.text)}</p>` : ''}
    <a href="${btnUrl}" target="_blank" rel="noopener noreferrer" class="fb-btn" style="background:${btnColor};color:#ffffff;">${esc((c.buttonText as string) || '')}</a>
  </div>
</section>`;
    }
    case 'spacer': {
      const h = esc((c.height as string) || '40px');
      return `<div class="fb-spacer" style="height:${h};" aria-hidden="true"></div>`;
    }
    default:
      return '';
  }
}

// ── Compilateur principal — CORPS PHASE C ───────────────────────────────────
// SIGNATURE FIGÉE Phase A. Rendu web responsive moderne (container max-width,
// sections full-width, <video> 16:9, <form> postant POST /api/p/:slug/submit,
// titre SEO via opts.title). CSS inline sobre cohérent Stripe. TOUT contenu
// utilisateur échappé (esc / safeUrl) — sécurité XSS critique (rendu public).
export function compileBlocksToHtml(
  blocks: FunnelBlock[],
  opts?: { slug?: string; title?: string },
): string {
  const list = Array.isArray(blocks) ? blocks : [];
  const body = list.map(renderBlock).join('\n');
  const title = esc(opts?.title || 'Intralys');
  return `<!DOCTYPE html>
<html lang="fr-CA">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a2e;background:#ffffff;line-height:1.6;-webkit-font-smoothing:antialiased;}
.fb-container{width:100%;max-width:1080px;margin:0 auto;padding:0 24px;}
.fb-container--narrow{max-width:560px;}
.fb-section{padding:48px 0;}
.fb-hero{padding:96px 0;}
.fb-hero-title{font-size:clamp(32px,5vw,52px);font-weight:800;line-height:1.15;margin-bottom:16px;}
.fb-hero-sub{font-size:clamp(16px,2.2vw,20px);opacity:0.92;max-width:640px;margin:0 auto;}
.fb-text{margin:0 auto;}
.fb-img{display:inline-block;height:auto;border-radius:8px;}
.fb-video-wrap{position:relative;width:100%;max-width:880px;margin:0 auto;aspect-ratio:16/9;}
.fb-video{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:10px;background:#000;}
.fb-form{display:flex;flex-direction:column;gap:16px;}
.fb-field{display:flex;flex-direction:column;gap:6px;text-align:left;}
.fb-label{font-size:13px;font-weight:600;color:#374151;}
.fb-req{color:#E93D3D;}
.fb-input{width:100%;padding:11px 13px;border:1px solid #d6dae1;border-radius:8px;font-size:15px;font-family:inherit;background:#fff;color:#1a1a2e;transition:border-color .15s;}
.fb-input:focus{outline:none;border-color:#635BFF;box-shadow:0 0 0 3px rgba(99,91,255,0.15);}
.fb-btn{display:inline-block;padding:13px 28px;background:#635BFF;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border:0;border-radius:8px;cursor:pointer;font-family:inherit;transition:filter .15s,transform .15s;}
.fb-btn:hover{filter:brightness(1.06);transform:translateY(-1px);}
.fb-btn--block{width:100%;text-align:center;}
.fb-cta{padding:72px 0;}
.fb-cta-title{font-size:clamp(26px,4vw,38px);font-weight:800;margin-bottom:12px;}
.fb-cta-text{font-size:18px;opacity:0.9;margin-bottom:24px;}
.fb-spacer{width:100%;}
@media (max-width:640px){.fb-hero{padding:64px 0;}.fb-section{padding:36px 0;}.fb-container{padding:0 18px;}}
@media (prefers-reduced-motion:reduce){.fb-btn{transition:none;}}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

// ── Helper : bloc par défaut — CORPS PHASE C ────────────────────────────────
// SIGNATURE FIGÉE Phase A. Renvoie un FunnelBlock valide (id généré + config
// par défaut typée). Phase A : config par défaut minimale conforme aux
// interfaces ci-dessus ; Phase C peut enrichir les valeurs sans changer les
// CLÉS (le schéma config est gelé §6.C).
export function createDefaultBlock(type: BlockType): FunnelBlock {
  const id = crypto.randomUUID();
  // CORPS PHASE C — valeurs de défaut affinées (couleurs marque, copy QC).
  // Phase A : défauts minimaux conformes aux interfaces *BlockConfig figées.
  const defaults: Record<BlockType, Record<string, unknown>> = {
    hero: {
      headline: 'Votre titre accrocheur',
      subheadline: 'Une phrase qui explique la valeur.',
      align: 'center',
      backgroundColor: '#0b1220',
      textColor: '#ffffff',
      backgroundImage: '',
    },
    text: {
      html: '<p>Votre texte ici…</p>',
      color: '#374151',
      fontSize: '16px',
      align: 'left',
      maxWidth: '720px',
    },
    image: { src: '', alt: '', width: '100%', align: 'center', link: '' },
    video: { url: '', autoplay: false, align: 'center' },
    form: {
      fields: [
        { name: 'name', label: 'Nom', type: 'text', required: true },
        { name: 'email', label: 'Courriel', type: 'email', required: true },
        { name: 'phone', label: 'Téléphone', type: 'tel', required: false },
      ],
      submitLabel: 'Envoyer',
      successMessage: 'Merci ! Nous vous contacterons sous peu.',
      redirectUrl: '',
    },
    button: {
      text: 'En savoir plus',
      url: '#',
      backgroundColor: '#635BFF',
      color: '#ffffff',
      borderRadius: '8px',
      align: 'center',
      fullWidth: false,
    },
    cta: {
      headline: 'Prêt à commencer ?',
      text: 'Joignez-vous à nous dès aujourd’hui.',
      buttonText: 'Commencer',
      buttonUrl: '#',
      backgroundColor: '#0b1220',
      textColor: '#ffffff',
      buttonColor: '#635BFF',
      align: 'center',
    },
    spacer: { height: '40px' },
  };
  return { id, type, config: defaults[type] };
}

// ── Palette du builder UI — FIGÉE Phase A ───────────────────────────────────
// (label = clé i18n résolue côté front via t() ; icon = nom Lucide pour la
// primitive <Icon> du design system — calque l'usage Lucide existant.)
export const BLOCK_PALETTE: Array<{
  type: BlockType;
  labelKey: string;
  icon: string;
}> = [
  { type: 'hero', labelKey: 'funnel.block.hero', icon: 'LayoutTemplate' },
  { type: 'text', labelKey: 'funnel.block.text', icon: 'Type' },
  { type: 'image', labelKey: 'funnel.block.image', icon: 'Image' },
  { type: 'video', labelKey: 'funnel.block.video', icon: 'Video' },
  { type: 'form', labelKey: 'funnel.block.form', icon: 'FormInput' },
  { type: 'button', labelKey: 'funnel.block.button', icon: 'MousePointerClick' },
  { type: 'cta', labelKey: 'funnel.block.cta', icon: 'Megaphone' },
  { type: 'spacer', labelKey: 'funnel.block.spacer', icon: 'MoveVertical' },
];
