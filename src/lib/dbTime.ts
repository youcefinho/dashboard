/**
 * dbTime — Normalisation de timestamps D1 (lecture pure).
 *
 * ⚠️ Sprint S1 : fichier NOUVEAU, **non importé / non câblé nulle part**.
 * Zéro effet de bord, zéro changement comportemental en S1.
 * Usage prévu S2+ : normaliser à la LECTURE les comparaisons cross-format
 * (cf. docs/TIMESTAMP-CONSISTENCY-MAP.md) SANS mass-rewrite des requêtes.
 *
 * Contexte du problème (vérifié S1) :
 *  - Standard projet : colonnes `*_at` texte `YYYY-MM-DD HH:MM:SS` (UTC),
 *    alimentées par `datetime('now')` (146 occ / 58 fichiers worker).
 *  - Îlot minoritaire : colonnes INTEGER epoch-secondes via `unixepoch()`
 *    (sprint43/46/49/50, beta.ts, dashboards.ts).
 *  - Piège annexe : beta.ts magic_tokens.expires_at/used_at = millisecondes.
 *
 * Ces helpers acceptent les DEUX conventions (texte SQL OU entier) et
 * tolèrent les millisecondes, pour permettre une normalisation défensive
 * côté lecture quand on devra réconcilier les formats.
 */

const SQL_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z?$/;

// Bornes plausibles (secondes epoch) : 2001-09-09 → 2286-11-20.
// Sert à distinguer secondes vs millisecondes pour un entier nu.
const EPOCH_S_MIN = 1_000_000_000; // ~2001
const EPOCH_S_MAX = 9_999_999_999; // ~2286

/**
 * Convertit une valeur timestamp D1 hétérogène en **epoch secondes** (number).
 *
 * Accepte :
 *  - `'YYYY-MM-DD HH:MM:SS'` (ou variante `T`/`Z`/fraction) → parsé en UTC.
 *  - entier/chaîne numérique en epoch **secondes** (unixepoch()).
 *  - entier en epoch **millisecondes** (ex. beta.ts magic_tokens) → ramené en s.
 *
 * @returns epoch secondes, ou `null` si null/NaN/format invalide.
 */
export function toEpoch(v: string | number | null): number | null {
  if (v === null || v === undefined) return null;

  // Cas numérique (ou chaîne purement numérique) : epoch s ou ms.
  if (typeof v === 'number' || /^-?\d+$/.test(String(v).trim())) {
    const n = typeof v === 'number' ? v : parseInt(String(v).trim(), 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    // > borne secondes max ⇒ très probablement des millisecondes.
    if (n > EPOCH_S_MAX) {
      const s = Math.floor(n / 1000);
      return s >= EPOCH_S_MIN && s <= EPOCH_S_MAX ? s : null;
    }
    return n >= EPOCH_S_MIN && n <= EPOCH_S_MAX ? n : null;
  }

  // Cas texte SQL 'YYYY-MM-DD HH:MM:SS' (UTC, convention datetime('now')).
  const m = SQL_DATETIME_RE.exec(String(v).trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const ms = Date.UTC(
    Number(y), Number(mo) - 1, Number(d),
    Number(h), Number(mi), Number(s),
  );
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

/**
 * Normalise une valeur timestamp D1 hétérogène vers le **standard texte
 * projet** `'YYYY-MM-DD HH:MM:SS'` (UTC) — format `datetime('now')`.
 *
 * Utile S2+ pour rendre comparables (lexicographiquement) les colonnes
 * `unixepoch` (INTEGER) avec les colonnes texte historiques.
 *
 * @returns chaîne `'YYYY-MM-DD HH:MM:SS'`, ou `null` si invalide.
 */
export function toIsoSql(v: string | number | null): string | null {
  const epoch = toEpoch(v);
  if (epoch === null) return null;
  const dt = new Date(epoch * 1000);
  if (Number.isNaN(dt.getTime())) return null;
  // 'YYYY-MM-DDTHH:MM:SS.sssZ' → 'YYYY-MM-DD HH:MM:SS'
  return dt.toISOString().slice(0, 19).replace('T', ' ');
}
