# ANTIGRAVITY-DESIGN-SPRINT.md — Refonte UX/UI complète

> Sprint design rédigé le 2026-05-10 par Claude Opus 4.7 sur demande de Rochdi.
> **Constat :** "elle ressemble à rien" — le dark OKLCH luxury actuel ne match pas l'usage CRM courtier 8h/jour. Pivot vers **GHL futuriste moderne simple, fond blanc**.
> **Pause features :** OK après Sprint 2 vertical Leads. Sprint design = ~7 jours. Reprise features Sprint 3+ après.

**Précondition :** Sprint 2 (vertical Leads) terminé et committé. Build vert.

---

## 1. Direction artistique — references

### Inspirations modernes B2B SaaS 2026

| Référence | Ce qu'on prend |
|---|---|
| **GHL UI 2026** | Layout 2 sidebars (modules + sub-nav), tableaux compacts, dashboards data-dense |
| **Linear** | Animations sub-100ms, keyboard-first, feedback instantané |
| **Vercel Dashboard** | Whitespace généreux, typography Geist, charts épurés |
| **Notion** | Inline edits, hover reveal actions, drag&drop fluide |
| **Stripe Dashboard** | Tableaux scannables, sticky headers, données massives lisibles |
| **Cal.com** | Booking pages clean, calendar views polies |
| **Plain.com** | Inbox conversations design moderne |
| **Attio** | Custom fields builder, smart lists UX |

### Mots-clés direction
- **Clean** : pas de bordures partout, juste là où ça compte
- **Spacious** : padding généreux, jamais étriqué
- **Calm** : couleurs douces, pas d'accents agressifs partout
- **Confident** : typography forte, hiérarchie claire
- **Fast** : animations 150-200ms max, perceptible mais pas en travers
- **Light primary** : fond blanc/très light gray par défaut, dark mode optionnel

---

## 2. Design tokens — refonte complète

### 2.1 — Couleurs (LIGHT MODE = primary)

> **Source de vérité :** palette extraite du site live `intralys.com` (config Tailwind + CSS vars). Direction "multi-couleurs intentionnelle" = bleu cyan signature + accents warm + palette élargie pour différencier badges/sub-accounts/stages.

```css
/* ── Brand Intralys (signature) ─────────────────────────── */
--brand-primary:  #009DDB;                      /* bleu cyan signature Intralys */
--brand-hover:    #007EAF;                      /* darker pour hover */
--brand-soft:     #C6EAF7;                      /* secondary Intralys — soft backgrounds */
--brand-tint:     #E8F6FC;                      /* tint très light pour rows hover, badges */
--brand-strong:   #006A93;                      /* dark accents */

/* ── Accent warm (CTAs urgents, conversions) ──────────── */
--accent-orange:  #D96E27;                      /* orange brûlé Intralys */
--accent-orange-soft: #FCEDE0;                  /* soft variant */

/* ── Backgrounds (light mode) ───────────────────────────── */
--bg-canvas:      #FAFBFC;                      /* fond app — blanc cassé tirant légèrement bleu */
--bg-surface:     #FFFFFF;                      /* cards, modals — blanc pur */
--bg-subtle:      #F5F7FA;                      /* hover row, section headers */
--bg-muted:       #EDF1F5;                      /* skeletons, disabled */
--bg-inverse:     #0D0D18;                      /* sidebar dark Intralys */
--bg-inverse-2:   #1a1a2e;                      /* gradient stop pour hero/sidebar */

/* ── Text ──────────────────────────────────────────────── */
--text-primary:   #0D0D18;                      /* dark Intralys pour body/titres */
--text-secondary: #4A5468;                      /* labels, descriptions */
--text-muted:     #8A93A4;                      /* placeholders, hints */
--text-inverse:   #FAFBFC;                      /* sur bg-inverse */
--text-inverse-mut: #8A93A4;                    /* sur bg-inverse, muted */
--text-link:      #188BF6;                      /* liens (bleu vif Intralys) */

/* ── Borders ───────────────────────────────────────────── */
--border-subtle:  #EDF1F5;                      /* dividers fins */
--border-default: #DDE3EB;                      /* cards, inputs */
--border-strong:  #C2CBD7;                      /* focus, active */

/* ── Status (palette ÉLARGIE Intralys multi-couleurs) ── */
--success:       #37CA37;                       /* vert vif Intralys (cf. badges +250%) */
--success-soft:  #DEF7DE;
--info:          #188BF6;                       /* bleu vif Intralys (link color) */
--info-soft:     #DBE9FE;
--warning:       #FF9A00;                       /* orange vif Intralys */
--warning-soft:  #FFEDD5;
--danger:        #E93D3D;                       /* rouge Intralys */
--danger-soft:   #FCDFDF;

/* ── Palette extended — multi-couleurs (Intralys) ──────── */
/* Pour distinguer sub-accounts, tags, segments, custom badges */
--color-cobalt:  #155EEF;                       /* bleu deep */
--color-malibu:  #63B3ED;                       /* bleu doux */
--color-indigo:  #757BBD;                       /* indigo doux */
--color-purple:  #D6BCFA;                       /* violet pastel */
--color-pink:    #FBB6CE;                       /* rose */
--color-teal:    #81E6D9;                       /* turquoise */
--color-yellow:  #FAF089;                       /* jaune doux */
--color-coral:   #F6AD55;                       /* corail */

/* ── Pipeline stages (mapping multi-couleurs) ──────────── */
--stage-new:        var(--brand-primary);       /* bleu cyan = nouveau lead */
--stage-contacted:  var(--info);                /* bleu vif = contact établi */
--stage-meeting:    var(--warning);             /* orange = action requise */
--stage-signed:     var(--success);             /* vert = win */
--stage-closed:     var(--text-muted);          /* gris = neutre */
--stage-lost:       var(--danger);              /* rouge = perte */

/* ── Sub-account color tags (chaque client a sa couleur) ─ */
--client-color-1: var(--brand-primary);         /* Mathis Guimont — bleu cyan */
--client-color-2: var(--accent-orange);         /* Serujan — orange */
--client-color-3: var(--color-purple);          /* Intralys — purple */
--client-color-4: var(--color-teal);            /* Buteau — teal */
--client-color-5: var(--color-coral);           /* EG Services — coral */
--client-color-6: var(--success);               /* Gatineau Premier — vert */

/* ── Focus ring ────────────────────────────────────────── */
--ring: rgba(0, 157, 219, 0.25);                /* brand cyan 25% */

/* ── Decorative gradients (inspirés intralys.com) ─────── */
--gradient-hero-dark:  linear-gradient(135deg, #0D0D18 0%, #1a1a2e 100%);
--gradient-shimmer:    linear-gradient(45deg, transparent 30%, rgba(0, 157, 219, 0.05) 50%, transparent 70%);
--gradient-blob:       linear-gradient(45deg, rgba(0, 157, 219, 0.10), rgba(198, 234, 247, 0.05));
--gradient-grid:       linear-gradient(rgba(0, 157, 219, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 157, 219, 0.08) 1px, transparent 1px);
--gradient-radial:     radial-gradient(circle at 25% 25%, rgba(0, 157, 219, 0.08) 0%, transparent 50%);
--gradient-cta:        linear-gradient(135deg, #009DDB 0%, #188BF6 100%);
--gradient-warm:       linear-gradient(135deg, #D96E27 0%, #FF9A00 100%);
```

### Animations signature Intralys (à reproduire)

```css
/* Shimmer subtle pour sections clés (hero, cards features) */
@keyframes shimmer { 
  0%, 100% { transform: translateX(-100%); opacity: 0; } 
  50%      { transform: translateX(100%);  opacity: 0.3; } 
}
.shimmer-bg { 
  position: relative; 
  overflow: hidden; 
}
.shimmer-bg::before {
  content: ''; 
  position: absolute; 
  inset: 0;
  background: var(--gradient-shimmer);
  animation: shimmer 8s ease-in-out infinite;
}

/* Float pour blobs decoratifs (sub-account avatars, hero shapes) */
@keyframes float {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  33%      { transform: translateY(-12px) rotate(120deg); }
  66%      { transform: translateY(8px) rotate(240deg); }
}

/* Card lift hover signature Intralys */
.card-lift { 
  transition: all 0.3s ease; 
}
.card-lift:hover { 
  transform: translateY(-5px); 
  box-shadow: 0 20px 40px rgba(0, 157, 219, 0.15); 
}

/* Grid pattern background (sections "tech") */
.grid-pattern { 
  background-image: var(--gradient-grid); 
  background-size: 50px 50px; 
}
```

### 2.2 — Couleurs (DARK MODE — toggle)

```css
[data-theme="dark"] {
  --bg-canvas:     oklch(0.13 0.01 260);
  --bg-surface:    oklch(0.17 0.012 260);
  --bg-subtle:     oklch(0.20 0.014 260);
  --bg-muted:      oklch(0.23 0.015 260);
  --bg-inverse:    oklch(0.97 0 0);

  --text-primary:    oklch(0.96 0 0);
  --text-secondary:  oklch(0.72 0.005 260);
  --text-muted:      oklch(0.55 0.005 260);
  --text-inverse:    oklch(0.18 0.01 260);

  --border-subtle:  oklch(0.22 0.012 260);
  --border-default: oklch(0.28 0.014 260);
  --border-strong:  oklch(0.38 0.015 260);

  --brand-primary:  oklch(0.70 0.20 264);
  --brand-hover:    oklch(0.78 0.20 264);
  --brand-soft:     oklch(0.25 0.08 264);
}
```

### 2.3 — Typography

```css
--font-sans: 'Inter', 'SF Pro Text', system-ui, -apple-system, sans-serif;
--font-display: 'Inter', system-ui, sans-serif;        /* avec font-feature-settings: "ss01", "cv11" */
--font-mono: 'JetBrains Mono', 'SF Mono', monospace;

/* Scale — 1.2 ratio, base 14px */
--text-2xs: 11px / 14px;
--text-xs:  12px / 16px;
--text-sm:  13px / 18px;
--text-base: 14px / 20px;       /* body default */
--text-md:  15px / 22px;
--text-lg:  17px / 24px;
--text-xl:  20px / 28px;
--text-2xl: 24px / 32px;
--text-3xl: 30px / 38px;        /* page titles */
--text-4xl: 36px / 44px;
--text-5xl: 48px / 56px;        /* hero stats */

/* Weights */
--weight-regular: 400;
--weight-medium: 500;
--weight-semibold: 600;
--weight-bold: 700;

/* Letter-spacing */
--tracking-tight: -0.01em;       /* sur titres */
--tracking-normal: 0;
--tracking-wide: 0.02em;         /* sur all-caps labels */
```

**Inter avec features `ss01 cv11`** = chiffres tabular + alternates plus modernes (essentiel pour dashboards).

### 2.4 — Espacement (scale 4)

```css
--space-1:  4px;
--space-2:  8px;
--space-3:  12px;
--space-4:  16px;
--space-5:  20px;
--space-6:  24px;
--space-8:  32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
--space-20: 80px;
--space-24: 96px;
```

**Règle d'or :** `--space-4` = padding card par défaut. `--space-6` = padding section. `--space-2` = gap entre éléments inline.

### 2.5 — Border radius

```css
--radius-xs: 4px;        /* badges, tags */
--radius-sm: 6px;        /* inputs, small buttons */
--radius-md: 8px;        /* cards, modals contenu */
--radius-lg: 12px;       /* modals containers, cards principales */
--radius-xl: 16px;       /* hero blocks */
--radius-2xl: 20px;
--radius-full: 9999px;   /* avatars, badges arrondis */
```

### 2.6 — Shadows (subtiles, light mode-friendly)

```css
--shadow-xs:    0 1px 2px oklch(0 0 0 / 0.04);
--shadow-sm:    0 1px 3px oklch(0 0 0 / 0.06), 0 1px 2px oklch(0 0 0 / 0.04);
--shadow-md:    0 4px 6px oklch(0 0 0 / 0.05), 0 2px 4px oklch(0 0 0 / 0.04);
--shadow-lg:    0 10px 15px oklch(0 0 0 / 0.07), 0 4px 6px oklch(0 0 0 / 0.05);
--shadow-xl:    0 20px 25px oklch(0 0 0 / 0.08), 0 10px 10px oklch(0 0 0 / 0.04);
--shadow-popover: 0 12px 24px oklch(0 0 0 / 0.10), 0 0 0 1px oklch(0 0 0 / 0.04);
```

### 2.7 — Transitions

```css
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);          /* arrivée naturelle */
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);   /* léger overshoot */

--duration-instant: 80ms;
--duration-fast: 150ms;
--duration-base: 200ms;
--duration-slow: 300ms;
```

**Règle :** hover state = 80ms. Transitions de layout = 200ms. Modals = 300ms.

---

## 3. Layout général — refonte

### 3.1 — Sidebar (left, dark contrast)

**Style GHL :** sidebar fond foncé `--bg-inverse` (oklch 0.18) sur fond app blanc → contraste fort qui guide l'œil. Largeur 240px expanded, 64px collapsed (icônes seulement).

```
┌────────────┐ ┌─────────────────────────────────────────────────┐
│  [I] Intra │ │  Header: Page Title    [Search ⌘K] 🔔 ⚙ 👤    │
│            │ ├─────────────────────────────────────────────────┤
│  📊 Dash   │ │                                                 │
│  👥 Leads  │ │   Page content                                  │
│  💼 Pipe   │ │                                                 │
│  💬 Inbox  │ │                                                 │
│  📧 Templ  │ │                                                 │
│  ⚡ Wflow  │ │                                                 │
│  📅 Cal    │ │                                                 │
│  ✓ Tasks   │ │                                                 │
│  📊 Repo   │ │                                                 │
│  ⚙ Settings│ │                                                 │
│            │ │                                                 │
│  ────────  │ │                                                 │
│  RB Rochdi │ │                                                 │
│  Admin     │ │                                                 │
└────────────┘ └─────────────────────────────────────────────────┘
```

**Items navigation :**
- Icon 18px + label 13px medium
- Padding 10px 12px
- Border-radius 6px
- État active : `bg: --brand-soft` + `color: --brand-primary` + bar latérale 2px brand
- État hover : `bg: oklch(1 0 0 / 0.04)` (subtle white tint sur bg dark)
- Section dividers : line subtle + label uppercase 11px tracking-wide

**Footer sidebar :**
- Avatar circle 32px
- Name + role (xs muted)
- Toggle theme + logout icons

**Collapsible :** bouton chevron en haut de sidebar, slide animation 200ms. State persisted en localStorage.

### 3.2 — Header (top bar)

**Style :** fond blanc, hauteur 56px, sticky, border-bottom subtle.

```
┌──────────────────────────────────────────────────────────────┐
│  Page Title           [🔍 Search anything ⌘K]   🔔 🌙 👤 ▾ │
└──────────────────────────────────────────────────────────────┘
```

- Page title : `text-lg semibold`, gauche
- Search global : center, max-width 480px, `bg-subtle` + border-subtle
- Right cluster : notifications cloche (badge), theme toggle, avatar dropdown
- Hover items : `bg-subtle` + scale 1.02

### 3.3 — Sub-navigation contextuelle (NEW)

GHL a un **2e niveau** de nav : quand tu cliques "Settings", la sidebar à gauche affiche les sous-pages.

**Implémentation :** ajouter une `<SubNav />` rail 200px entre sidebar principale et content, visible uniquement sur certaines pages (Settings, Reports, Workflows detail).

```
[Sidebar 240] [SubNav 200] [Content flex-1]
```

### 3.4 — Content area

- `padding: 32px 40px` desktop
- `max-width` selon page (1400px pour dashboards data-dense, 800px pour formulaires)
- `bg: --bg-canvas`

---

## 4. Composants à refaire

### 4.1 — Button (5 variants × 3 sizes)

```tsx
// Variants : primary, secondary, ghost, destructive, link
// Sizes : sm (32px), md (38px), lg (44px)
// States : default, hover, active, focus, disabled, loading

// Primary
bg: --brand-primary
color: white
hover: bg-brand-hover, scale-[0.98]
focus: ring-2 ring-brand-soft ring-offset-2

// Secondary
bg: --bg-surface
border: 1px solid --border-default
color: --text-primary
hover: bg-bg-subtle, border-strong

// Ghost
bg: transparent
color: --text-secondary
hover: bg-bg-subtle, color-text-primary

// Destructive
bg: --danger
color: white
hover: brightness-1.1

// Link
bg: transparent
color: --brand-primary
underline on hover, no border
```

**Icon support :** prop `leftIcon` et `rightIcon`, gap 6px.
**Loading :** spinner remplace contenu, garde la width.

### 4.2 — Input (text, number, email, url, search)

```css
height: 38px;
padding: 0 12px;
border: 1px solid --border-default;
border-radius: --radius-sm;
background: --bg-surface;
font-size: 14px;
transition: all 150ms;

&:hover { border-color: --border-strong; }
&:focus {
  border-color: --brand-primary;
  box-shadow: 0 0 0 3px --ring;
  outline: none;
}
&[aria-invalid="true"] {
  border-color: --danger;
  box-shadow: 0 0 0 3px --danger-soft;
}
```

**Variants :** `with-icon-left`, `with-icon-right`, `with-suffix-text`, `with-clear-button`.

### 4.3 — Card

```css
background: --bg-surface;
border: 1px solid --border-subtle;
border-radius: --radius-lg;
padding: --space-6;
transition: all 200ms --ease-out;

/* Interactive variant */
&[data-interactive] {
  cursor: pointer;
}
&[data-interactive]:hover {
  border-color: --border-default;
  box-shadow: --shadow-md;
  transform: translateY(-1px);
}
```

**Pas d'ombres par défaut.** Just border + bg différent du canvas. Ombre seulement au hover sur cards interactives.

### 4.4 — Badge

```tsx
// Variants by intent : neutral, brand, success, warning, danger, info
// Sizes : sm (h: 20px), md (h: 24px)
// Fill modes : solid, soft (bg tinted), outline

// Soft (default — utilisé pour status badges)
bg: --{intent}-soft
color: --{intent}
padding: 2px 8px
font-size: 11px
font-weight: 500
border-radius: --radius-full
```

Exemples :
- `<Badge intent="success" fill="soft">Signé</Badge>` → fond vert très clair, texte vert sage
- `<Badge intent="danger" fill="solid">Urgent</Badge>` → fond rouge, texte blanc

### 4.5 — Table (data-dense)

```css
/* Header */
th {
  background: --bg-subtle;
  border-bottom: 1px solid --border-subtle;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  color: --text-secondary;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  position: sticky;
  top: 0;
}

/* Body */
td {
  padding: 10px 12px;
  border-bottom: 1px solid --border-subtle;
  font-size: 13px;
  vertical-align: middle;
}

tr:hover td {
  background: --bg-subtle;
}

tr[data-selected="true"] td {
  background: --brand-soft;
}

/* Checkbox column */
.checkbox-cell {
  width: 36px;
  padding-left: 16px;
}
```

**Comportements :**
- Sticky header au scroll
- Hover row entire highlight
- Click row entire (sauf zones interactives) = navigate to detail
- Shift-click range select
- Cmd-click multi-select toggle

### 4.6 — Modal

```css
/* Backdrop */
position: fixed;
inset: 0;
background: oklch(0.18 0.015 260 / 0.5);
backdrop-filter: blur(4px);

/* Container */
position: fixed;
top: 50%;
left: 50%;
transform: translate(-50%, -50%);
background: --bg-surface;
border-radius: --radius-lg;
box-shadow: --shadow-xl;
max-width: 480px (sm), 640px (md), 960px (lg);
animation: modal-in 200ms --ease-spring;

@keyframes modal-in {
  from { opacity: 0; transform: translate(-50%, -48%) scale(0.96); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
```

**Header / Body / Footer pattern :**
- Header : 60px, padding 20px 24px, border-bottom subtle, close button en X
- Body : padding 24px, scrollable si long
- Footer : 64px, padding 16px 24px, border-top subtle, alignement right pour actions

### 4.7 — Toast / Notifications

**Position :** top-right corner, stacked.
**Animation :** slide-in from right 300ms spring.
**Types :** success / error / warning / info.
**Auto-dismiss :** 5s, pause au hover, swipe to dismiss.
**Action button optionnel :** "Annuler" pour undo P1.7 bulk delete.

Lib suggérée : `sonner` (npm) — léger, accessible, beau par défaut.

### 4.8 — Skeleton loaders

**Animation :** wave shimmer subtile, pas pulse.
```css
background: linear-gradient(
  90deg,
  --bg-muted 0%,
  --bg-subtle 50%,
  --bg-muted 100%
);
background-size: 200% 100%;
animation: shimmer 1.5s infinite;
border-radius: --radius-sm;
```

### 4.9 — Empty states

**Pattern :** icon 64px (illustration), titre, description, CTA primary.
- Icon : illustration line-art monochrome `--text-muted`
- Padding 80px vertical
- Centered

Pour chaque empty state, garder le ton **encourageant** (pas "0 leads" mais "Créez votre premier lead pour commencer").

### 4.10 — Sidebar dropdown / popover

**Animation :** scale-in from origin, 150ms.
**Style :** `--shadow-popover` (multi-layer with subtle ring), `--radius-md`, padding 4px (items 8px).
**Items :** hover bg-subtle, active brand-soft.

---

## 5. Pages — refonte par ordre de priorité

### 5.1 — Dashboard (refonte 1.5j)

**Avant** : cards centered, stat icons emoji, bg dark.
**Après** :
- Header sticky avec page title + period selector + filters + export button
- Grid 12 colonnes responsive (col-span-3 pour stat cards, col-span-6 pour graphs, col-span-12 pour activity feed)
- Stat cards refondues : large number 36px, label uppercase 11px tracking-wide, delta % avec arrow color, sparkline mini-chart
- Graphs Recharts avec couleurs --brand-primary et lighter shades
- Activity feed temps réel (cf. enrichissement Dashboard du DEPTH-AUDIT §1)
- Empty states illustrés

Inspiration : **Vercel Dashboard** + **Linear Insights**.

### 5.2 — Leads list (refonte 1.5j)

**Avant** : table simple, filtres sidebar.
**Après** :
- Top bar : search wide + filter chips (cliquables, removables) + bulk actions visible si selection
- Table data-dense Stripe-style :
  - Checkbox col, Avatar+Name col (sticky), email, phone, status badge, source badge, deal value (right-aligned), score (mini-bar), date (relative), actions (3 dots hover-reveal)
- Pagination cursor en footer (lignes par page selector)
- Sticky toolbar au scroll
- Switch list/cards/map view en haut à droite

Inspiration : **Attio** + **Stripe Customers**.

### 5.3 — LeadDetail (refonte 2j)

**Avant** : 3 tabs verticales, infos plates.
**Après** :
- Layout 2-column : left 320px (contact card sticky), right flex-1 (tabs content)
- Left card :
  - Avatar 80px center
  - Name 24px bold + lifecycle stage pill
  - Quick actions row (5 icon buttons : 📞 💬 📧 📅 📝)
  - Score visualisé (circular progress)
  - Owner / Source / Last activity en stats compactes
  - Tags chips
  - Custom fields collapsibles
- Right tabs :
  - Activity / Conversations / Tasks / Opportunities / Files / Forms / Workflows / Settings (8-9 tabs)
  - Tab content full-width
  - Inline editable fields partout
- Top bar contextual : breadcrumb + actions (star, more menu)

Inspiration : **Notion contact page** + **HubSpot deal view**.

### 5.4 — Pipeline kanban (refonte 1j)

**Avant** : 6 colonnes, cartes denses, header simple.
**Après** :
- Column header avec couleur stage subtle (bg-subtle teinté avec --stage-{x})
- Card design refait : avatar contact + nom + value (right) + tags + days-in-stage badge (color-coded)
- Drag & drop avec smooth animation + drop indicator clear
- Pipeline selector dropdown en haut (multi-pipelines)
- Filter bar discrète (chips removables)
- KPIs pipeline en sticky top : value, count, weighted forecast, dormants

Inspiration : **Linear board view**.

### 5.5 — Conversations Inbox (refonte 1j)

**Avant** : 2 panneaux statiques.
**Après** :
- 3 panneaux : left thread list 320px / center thread detail flex-1 / right contact info 320px (collapsible)
- Thread item : avatar, contact name, last message preview (1 line), timestamp relative, unread dot, channel icon
- Composer footer : tab Email/SMS/Note + textarea + send button + secondary actions (template, snippet, schedule)
- Message bubbles : outbound right brand-soft / inbound left bg-subtle
- Internal notes : yellow tint background (post-it style)

Inspiration : **Plain.com** + **Linear inbox**.

### 5.6 — Calendar (refonte 0.5j)

**Avant** : vue semaine + liste.
**Après** :
- View switcher : Day / Week / Month / Agenda (segmented control)
- Color-coded events selon type (--stage-* couleurs)
- Drag-to-reschedule
- Mini calendar nav en sidebar gauche
- "Today" button + period nav arrows

Inspiration : **Cal.com**.

### 5.7 — Workflows builder (refonte 2j — gros)

**Avant** : layout vertical steps.
**Après** :
- Canvas 2D React Flow style (zoom, pan, mini-map)
- Steps en cards rectangulaires connectées par lignes courbes
- Toolbox latérale gauche : drag&drop steps depuis palette
- Properties panel droite : édition step sélectionné
- Top bar : workflow name, save, test run, publish toggle

Inspiration : **n8n editor** + **Zapier visual editor**.

### 5.8 — Settings (refonte 1j)

**Avant** : page basique.
**Après** :
- Sub-navigation gauche (cf. §3.3)
- Sections groupées : Account / Team / Billing / Integrations / Lead capture / Communication / Compliance / Developer
- Chaque section : carte large avec form inputs alignés
- Save bar sticky bottom (apparaît si dirty)

Inspiration : **Stripe Dashboard settings**.

---

## 6. Animations & micro-interactions

### 6.1 — Transitions globales
- Page transitions : fade 150ms (pas de slide qui distrait)
- Modal in/out : scale + fade 200ms spring
- Tab switches : crossfade 100ms
- Sidebar collapse : width transition 200ms ease-out

### 6.2 — Hover micro-interactions
- Buttons : `transform: scale(0.98)` au :active
- Cards interactive : `translateY(-1px)` + shadow up au :hover
- Table rows : bg-subtle au :hover
- Icon buttons : bg-subtle ring-1 au :hover

### 6.3 — Feedback actions
- Save success : toast top-right + green check mark animation 800ms
- Delete : toast avec bouton "Annuler" (10s window pour undo)
- Loading buttons : spinner inline + texte → disabled
- Optimistic UI : update state immédiat, rollback si error

### 6.4 — Drag & drop (kanban, custom fields, columns)
- Pickup : ghost à 0.4 opacity
- Drag : cursor grabbing + lift shadow
- Drop zone : border-strong + bg-brand-soft tint
- Snap to position avec spring animation 300ms

### 6.5 — Loading states
- Skeleton shimmer (cf. 4.8) — JAMAIS spinner full-page
- Inline spinners pour actions courtes
- Top progress bar pour navigation entre pages (lib `nprogress` ou maison)

---

## 7. Accessibilité (WCAG 2.1 AA)

- Contraste : minimum 4.5:1 pour body, 3:1 pour large text
- Focus visible partout : `outline: 2px solid --brand-primary; outline-offset: 2px`
- Keyboard navigation : Tab through tous les inputs/buttons, Esc close modals, Cmd+K search
- ARIA labels sur icon buttons
- Skip-to-content link
- Screen reader friendly : `aria-live` pour toasts, `aria-busy` pour loading
- Color not the only indicator : icons + text pour status

---

## 8. Plan sprint design — phases ordonnées

### Phase D.0 — Setup (0.5j)
- Installer `lucide-react` (icons cohérents, retire les SVG inline)
- Installer `sonner` (toasts)
- Installer `cmdk` (command palette refonte si besoin)
- Installer `@radix-ui/react-{dialog,dropdown-menu,popover,tabs,tooltip,toggle-group}` (primitives accessibles)
- Configurer Tailwind v4 avec les nouveaux tokens dans `src/index.css`
- Créer `src/components/ui/` files séparés par composant (Button.tsx, Card.tsx, Input.tsx, Badge.tsx, Modal.tsx, Toast.tsx, Skeleton.tsx, EmptyState.tsx, Table.tsx, DropdownMenu.tsx, Popover.tsx, Tabs.tsx)

### Phase D.1 — Tokens + composants UI core (1j)
- Refondre `src/index.css` avec tokens §2
- Refondre `src/components/ui/index.tsx` → splitter en files individuels
- Implémenter Button, Input, Card, Badge, Modal, Toast, Skeleton, EmptyState, Table, DropdownMenu, Popover, Tabs avec les specs §4
- Créer page `/dev/components` (visible uniquement en dev) qui showcase tous les composants → permet à Rochdi de valider visuel avant d'appliquer

### Phase D.2 — Layout principal (1j)
- Refondre `Sidebar.tsx` : fond dark contrast, items refaits, footer avatar/logout
- Refondre `AppLayout.tsx` : header sticky 56px, search global wide, theme toggle, avatar dropdown
- Créer `SubNav.tsx` pour Settings/Reports/Workflows
- Toggle dark/light fonctionnel + persisté

### Phase D.3 — Pages prioritaires (4j)
Dans cet ordre :
- Dashboard refonte (1.5j) — §5.1
- Leads list refonte (1.5j) — §5.2
- LeadDetail refonte (2j) — §5.3 (gros morceau, garde-le pour le bout)

Les autres pages (Pipeline, Inbox, Calendar, Workflows, Settings, Templates, Tasks, Reports) sont à refaire dans Sprint Design 2 (~5j).

### Phase D.4 — Polish global (0.5j)
- Animations transitions de pages
- Audit consistency (tous les boutons identiques, tous les badges idem, etc.)
- Mobile responsive review (bonus avant sprint mobile)
- Lighthouse audit + fix score < 90

**Total Sprint Design : ~7 jours.**

---

## 9. Mockup HTML standalone

Voir fichier `design-mockup.html` à la racine du projet (créé en parallèle de ce doc).

Ouvre-le dans le browser pour visualiser tout de suite la nouvelle direction artistique avant qu'Antigravity ne refonde le code.

---

## 10. Status tracker Sprint Design

| Phase | Tâche | Status | Commit |
|---|---|---|---|
| D.0 | Setup deps + structure | ⬜ todo | — |
| D.1 | Tokens + UI core components | ⬜ todo | — |
| D.2 | Layout (Sidebar + Header + SubNav) | ⬜ todo | — |
| D.3a | Dashboard refonte | ⬜ todo | — |
| D.3b | Leads list refonte | ⬜ todo | — |
| D.3c | LeadDetail refonte | ⬜ todo | — |
| D.4 | Polish + audit a11y + responsive | ⬜ todo | — |

---

## 11. Workflow recommandé

1. Rochdi ouvre `design-mockup.html` dans browser → valide direction
2. Si OK → Antigravity lance Phase D.0 setup
3. Antigravity push Phase D.1 → Rochdi visite `/dev/components` → valide
4. Phase par phase, validation Rochdi à chaque grosse refonte de page
5. À la fin du sprint, Sprint 3 features peut reprendre (vertical Conversations)

**Pause features assumée :** Sprint 3+ démarre uniquement après que Sprint Design soit committé et validé visuellement.

---

_Document généré le 2026-05-10 par Claude Opus 4.7. Direction artistique GHL futuriste moderne simple, light primary. Sprint design 7 jours en pause des features._
