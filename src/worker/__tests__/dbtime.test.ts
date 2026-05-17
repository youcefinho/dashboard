// ── Tests src/lib/dbTime.ts — Sprint S2 / M3.4 ───────────────────────────────
// Fonctions PURES (zéro D1, zéro réseau) : robustesse + null-safety de la
// normalisation de timestamps hétérogènes (texte SQL / epoch-s / epoch-ms /
// null / NaN / format invalide). Helper figé S1 — ces tests le verrouillent.
import { describe, it, expect } from 'vitest';
import { toEpoch, toIsoSql } from '@/lib/dbTime';

// Repères stables (UTC) :
//  '2021-06-15 12:00:00' = 1623758400 s = 1623758400000 ms
const ISO_SQL = '2021-06-15 12:00:00';
const EPOCH_S = 1_623_758_400;
const EPOCH_MS = 1_623_758_400_000;

describe('toEpoch — texte SQL YYYY-MM-DD HH:MM:SS', () => {
  it('parse le format canonique projet en epoch-secondes UTC', () => {
    expect(toEpoch(ISO_SQL)).toBe(EPOCH_S);
  });

  it('tolère la variante ISO avec T séparateur', () => {
    expect(toEpoch('2021-06-15T12:00:00')).toBe(EPOCH_S);
  });

  it('tolère le suffixe Z et une fraction de seconde', () => {
    expect(toEpoch('2021-06-15T12:00:00.123Z')).toBe(EPOCH_S);
  });

  it('parse en UTC (pas en heure locale)', () => {
    // Epoch 0 → 1970-01-01 00:00:00 UTC. Si parsé en local, ce ne serait pas 0.
    expect(toEpoch('1970-01-01 00:00:00')).toBe(0);
  });

  it('trim les espaces autour de la chaîne', () => {
    expect(toEpoch(`  ${ISO_SQL}  `)).toBe(EPOCH_S);
  });
});

describe('toEpoch — entier epoch-secondes (unixepoch())', () => {
  it('retourne tel quel un entier déjà en secondes', () => {
    expect(toEpoch(EPOCH_S)).toBe(EPOCH_S);
  });

  it('accepte une chaîne purement numérique en secondes', () => {
    expect(toEpoch(String(EPOCH_S))).toBe(EPOCH_S);
  });

  it('borne basse plausible (~2001) acceptée', () => {
    expect(toEpoch(1_000_000_000)).toBe(1_000_000_000);
  });

  it('rejette un entier trop petit pour être un epoch-s plausible', () => {
    // 999_999_999 < EPOCH_S_MIN (1e9) et > 0 → hors borne secondes → null.
    expect(toEpoch(999_999_999)).toBeNull();
  });
});

describe('toEpoch — entier epoch-millisecondes (beta.ts magic_tokens)', () => {
  it('détecte les millisecondes (> borne secondes max) et ramène en s', () => {
    expect(toEpoch(EPOCH_MS)).toBe(EPOCH_S);
  });

  it('accepte une chaîne numérique en millisecondes', () => {
    expect(toEpoch(String(EPOCH_MS))).toBe(EPOCH_S);
  });

  it('ms hors borne après division → null', () => {
    // 999 (ms) → /1000 = 0 (floor) → < EPOCH_S_MIN → null. Mais 999 < EPOCH_S_MAX
    // donc traité comme secondes d'abord : 999 < EPOCH_S_MIN → null aussi.
    expect(toEpoch(999)).toBeNull();
  });
});

describe('toEpoch — null-safety & entrées invalides', () => {
  it('null → null', () => {
    expect(toEpoch(null)).toBeNull();
  });

  it('undefined → null', () => {
    expect(toEpoch(undefined as unknown as null)).toBeNull();
  });

  it('NaN → null', () => {
    expect(toEpoch(NaN)).toBeNull();
  });

  it('Infinity → null', () => {
    expect(toEpoch(Infinity)).toBeNull();
  });

  it('0 → null (epoch 0 numérique = sous la borne plausible)', () => {
    // Note asymétrie volontaire : 0 numérique → null (n <= 0 garde),
    // mais '1970-01-01 00:00:00' (texte) → 0 (chemin texte distinct).
    expect(toEpoch(0)).toBeNull();
  });

  it('entier négatif → null', () => {
    expect(toEpoch(-100)).toBeNull();
  });

  it('chaîne non-date → null', () => {
    expect(toEpoch('pas-une-date')).toBeNull();
  });

  it('chaîne vide → null', () => {
    expect(toEpoch('')).toBeNull();
  });

  it('format date partiel (sans heure) → null', () => {
    expect(toEpoch('2021-06-15')).toBeNull();
  });

  it('date calendaire invalide normalisée par Date.UTC (ne crash pas)', () => {
    // Date.UTC tolère les débordements (mois 13 → année+1). On vérifie
    // seulement l'absence de crash + un number fini ou null.
    const r = toEpoch('2021-13-40 25:61:61');
    expect(r === null || Number.isFinite(r)).toBe(true);
  });
});

describe('toIsoSql — normalisation vers texte SQL canonique', () => {
  it('entier secondes → texte YYYY-MM-DD HH:MM:SS', () => {
    expect(toIsoSql(EPOCH_S)).toBe(ISO_SQL);
  });

  it('entier millisecondes → texte SQL (s)', () => {
    expect(toIsoSql(EPOCH_MS)).toBe(ISO_SQL);
  });

  it('texte SQL → texte SQL identique (round-trip)', () => {
    expect(toIsoSql(ISO_SQL)).toBe(ISO_SQL);
  });

  it('null → null', () => {
    expect(toIsoSql(null)).toBeNull();
  });

  it('entrée invalide → null', () => {
    expect(toIsoSql('xxx')).toBeNull();
  });

  it('0 numérique → null (cohérent avec toEpoch)', () => {
    expect(toIsoSql(0)).toBeNull();
  });

  it('epoch 0 via texte → 1970-01-01 00:00:00 (borne basse texte)', () => {
    expect(toIsoSql('1970-01-01 00:00:00')).toBe('1970-01-01 00:00:00');
  });

  it('round-trip toEpoch(toIsoSql(x)) stable pour un epoch-s valide', () => {
    const iso = toIsoSql(EPOCH_S);
    expect(iso).not.toBeNull();
    expect(toEpoch(iso!)).toBe(EPOCH_S);
  });
});
