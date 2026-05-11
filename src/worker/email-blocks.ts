// ── Email Blocks → HTML Compiler — Intralys CRM (Sprint 7) ──
// 8 block types : header, image, text, button, columns, divider, spacer, footer
// Compile en HTML email-safe (<table> + inline styles)

export type BlockType = 'header' | 'image' | 'text' | 'button' | 'columns' | 'divider' | 'spacer' | 'footer';

export interface EmailBlock {
  id: string;
  type: BlockType;
  config: Record<string, unknown>;
}

export interface HeaderBlockConfig {
  text: string;
  level: 1 | 2 | 3;
  align: 'left' | 'center' | 'right';
  color: string;
  backgroundColor: string;
}

export interface ImageBlockConfig {
  src: string;
  alt: string;
  width: string; // '100%' ou '600px'
  align: 'left' | 'center' | 'right';
  link: string;
}

export interface TextBlockConfig {
  html: string;
  color: string;
  fontSize: string;
  lineHeight: string;
  padding: string;
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

export interface ColumnsBlockConfig {
  columns: Array<{ html: string; width: string }>;
  gap: string;
}

export interface DividerBlockConfig {
  color: string;
  thickness: string;
  padding: string;
}

export interface SpacerBlockConfig {
  height: string;
}

export interface FooterBlockConfig {
  html: string;
  color: string;
  fontSize: string;
  align: 'left' | 'center' | 'right';
}

// ── Constantes de style email-safe ──────────────────────────
const EMAIL_MAX_WIDTH = '600px';
const FONT_FAMILY = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

// ── Block → HTML individuel ─────────────────────────────────

function renderHeader(config: Partial<HeaderBlockConfig>): string {
  const level = config.level || 2;
  const align = config.align || 'left';
  const color = config.color || '#1a1a2e';
  const bg = config.backgroundColor || 'transparent';
  const text = config.text || '';
  const sizes: Record<number, string> = { 1: '28px', 2: '22px', 3: '18px' };
  const fontSize = sizes[level] || '22px';

  return `<tr><td style="padding: 20px 30px; background-color: ${bg}; text-align: ${align};">
    <h${level} style="margin: 0; font-family: ${FONT_FAMILY}; font-size: ${fontSize}; font-weight: 700; color: ${color}; line-height: 1.3;">${text}</h${level}>
  </td></tr>`;
}

function renderImage(config: Partial<ImageBlockConfig>): string {
  const src = config.src || '';
  const alt = config.alt || '';
  const width = config.width || '100%';
  const align = config.align || 'center';
  const link = config.link || '';

  const img = `<img src="${src}" alt="${alt}" width="${width === '100%' ? '600' : width.replace('px', '')}" style="display: block; max-width: 100%; height: auto; border: 0;" />`;
  const wrapped = link ? `<a href="${link}" target="_blank">${img}</a>` : img;

  return `<tr><td style="padding: 0; text-align: ${align};">${wrapped}</td></tr>`;
}

function renderText(config: Partial<TextBlockConfig>): string {
  const html = config.html || '';
  const color = config.color || '#374151';
  const fontSize = config.fontSize || '15px';
  const lineHeight = config.lineHeight || '1.6';
  const padding = config.padding || '10px 30px';

  return `<tr><td style="padding: ${padding}; font-family: ${FONT_FAMILY}; font-size: ${fontSize}; line-height: ${lineHeight}; color: ${color};">${html}</td></tr>`;
}

function renderButton(config: Partial<ButtonBlockConfig>): string {
  const text = config.text || 'Cliquer ici';
  const url = config.url || '#';
  const bg = config.backgroundColor || '#009DDB';
  const color = config.color || '#ffffff';
  const radius = config.borderRadius || '6px';
  const align = config.align || 'center';
  const fullWidth = config.fullWidth || false;
  const widthStyle = fullWidth ? 'display: block; width: 100%; text-align: center;' : 'display: inline-block;';

  return `<tr><td style="padding: 15px 30px; text-align: ${align};">
    <a href="${url}" target="_blank" style="${widthStyle} padding: 14px 28px; background-color: ${bg}; color: ${color}; font-family: ${FONT_FAMILY}; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: ${radius}; mso-padding-alt: 0;">${text}</a>
  </td></tr>`;
}

function renderColumns(config: Partial<ColumnsBlockConfig>): string {
  const cols = config.columns || [{ html: '', width: '50%' }, { html: '', width: '50%' }];
  const gap = config.gap || '10px';

  const colsHtml = cols.map(col => {
    const w = col.width || `${Math.floor(100 / cols.length)}%`;
    return `<td style="width: ${w}; padding: 0 ${gap}; vertical-align: top; font-family: ${FONT_FAMILY}; font-size: 15px; line-height: 1.6; color: #374151;">${col.html}</td>`;
  }).join('');

  return `<tr><td style="padding: 10px 20px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${colsHtml}</tr></table>
  </td></tr>`;
}

function renderDivider(config: Partial<DividerBlockConfig>): string {
  const color = config.color || '#e5e7eb';
  const thickness = config.thickness || '1px';
  const padding = config.padding || '10px 30px';

  return `<tr><td style="padding: ${padding};"><hr style="border: 0; border-top: ${thickness} solid ${color}; margin: 0;" /></td></tr>`;
}

function renderSpacer(config: Partial<SpacerBlockConfig>): string {
  const height = config.height || '20px';
  return `<tr><td style="padding: 0; height: ${height}; font-size: 0; line-height: 0;">&nbsp;</td></tr>`;
}

function renderFooter(config: Partial<FooterBlockConfig>): string {
  const html = config.html || '© Intralys CRM';
  const color = config.color || '#9ca3af';
  const fontSize = config.fontSize || '12px';
  const align = config.align || 'center';

  return `<tr><td style="padding: 20px 30px; font-family: ${FONT_FAMILY}; font-size: ${fontSize}; line-height: 1.5; color: ${color}; text-align: ${align};">${html}</td></tr>`;
}

// ── Compilateur principal ───────────────────────────────────

export function compileBlocksToHtml(blocks: EmailBlock[], preheader?: string): string {
  const blocksHtml = blocks.map(block => {
    switch (block.type) {
      case 'header': return renderHeader(block.config as Partial<HeaderBlockConfig>);
      case 'image': return renderImage(block.config as Partial<ImageBlockConfig>);
      case 'text': return renderText(block.config as Partial<TextBlockConfig>);
      case 'button': return renderButton(block.config as Partial<ButtonBlockConfig>);
      case 'columns': return renderColumns(block.config as Partial<ColumnsBlockConfig>);
      case 'divider': return renderDivider(block.config as Partial<DividerBlockConfig>);
      case 'spacer': return renderSpacer(block.config as Partial<SpacerBlockConfig>);
      case 'footer': return renderFooter(block.config as Partial<FooterBlockConfig>);
      default: return '';
    }
  }).join('\n');

  const preheaderHtml = preheader
    ? `<div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Email</title>
  <!--[if mso]><style>table{border-collapse:collapse;}td{font-family:Arial,sans-serif;}</style><![endif]-->
  <style>
    @media screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .email-container td { padding-left: 15px !important; padding-right: 15px !important; }
      .columns-table td { display: block !important; width: 100% !important; padding: 5px 0 !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f5f7; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
  ${preheaderHtml}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f5f7;">
    <tr><td align="center" style="padding: 20px 0;">
      <table role="presentation" class="email-container" width="${EMAIL_MAX_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="max-width: ${EMAIL_MAX_WIDTH}; width: 100%; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
${blocksHtml}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Helpers ──────────────────────────────────────────────────

export function createDefaultBlock(type: BlockType): EmailBlock {
  const id = crypto.randomUUID();
  const defaults: Record<BlockType, Record<string, unknown>> = {
    header: { text: 'Titre', level: 2, align: 'left', color: '#1a1a2e', backgroundColor: 'transparent' },
    image: { src: '', alt: '', width: '100%', align: 'center', link: '' },
    text: { html: '<p>Votre texte ici...</p>', color: '#374151', fontSize: '15px', lineHeight: '1.6', padding: '10px 30px' },
    button: { text: 'Cliquer ici', url: '#', backgroundColor: '#009DDB', color: '#ffffff', borderRadius: '6px', align: 'center', fullWidth: false },
    columns: { columns: [{ html: 'Colonne 1', width: '50%' }, { html: 'Colonne 2', width: '50%' }], gap: '10px' },
    divider: { color: '#e5e7eb', thickness: '1px', padding: '10px 30px' },
    spacer: { height: '20px' },
    footer: { html: '© {{year}} — <a href="{{unsubscribe_url}}" style="color: #9ca3af;">Se désabonner</a>', color: '#9ca3af', fontSize: '12px', align: 'center' },
  };
  return { id, type, config: defaults[type] };
}

// ── A/B test : assignment déterministe par hash lead_id ──────

export function getAbVariant(leadId: string): 'A' | 'B' {
  // Hash simple : somme des char codes mod 2
  let hash = 0;
  for (let i = 0; i < leadId.length; i++) {
    hash = ((hash << 5) - hash + leadId.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 2 === 0) ? 'A' : 'B';
}

// ── Block labels + icônes pour le builder UI ─────────────────

export const BLOCK_PALETTE: Array<{ type: BlockType; label: string; icon: string }> = [
  { type: 'header', label: 'Titre', icon: '🔤' },
  { type: 'image', label: 'Image', icon: '🖼️' },
  { type: 'text', label: 'Texte', icon: '📝' },
  { type: 'button', label: 'Bouton', icon: '🔘' },
  { type: 'columns', label: 'Colonnes', icon: '▥' },
  { type: 'divider', label: 'Séparateur', icon: '─' },
  { type: 'spacer', label: 'Espace', icon: '↕️' },
  { type: 'footer', label: 'Pied de page', icon: '📋' },
];
