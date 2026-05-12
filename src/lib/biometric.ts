// ── Biometric Auth — FaceID / TouchID / Fingerprint ─────────
// Sprint 11 — Capacitor V1

import { Capacitor } from '@capacitor/core';

// ── Vérifier si la biométrie est disponible ─────────────────

export async function isBiometricAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;

  try {
    const { NativeBiometric } = await import('capacitor-native-biometric');
    const result = await NativeBiometric.isAvailable();
    return result.isAvailable;
  } catch {
    return false;
  }
}

// ── Enregistrer les credentials dans le keychain natif ──────

export async function saveBiometricCredentials(
  server: string,
  username: string,
  password: string
): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;

  try {
    const { NativeBiometric } = await import('capacitor-native-biometric');
    await NativeBiometric.setCredentials({
      server,
      username,
      password,
    });
    return true;
  } catch (err) {
    console.error('Erreur sauvegarde biometric credentials:', err);
    return false;
  }
}

// ── Récupérer les credentials via biométrie ─────────────────

export async function getBiometricCredentials(
  server: string,
  reason: string = 'Connectez-vous à Intralys'
): Promise<{ username: string; password: string } | null> {
  if (!Capacitor.isNativePlatform()) return null;

  try {
    const { NativeBiometric } = await import('capacitor-native-biometric');

    // Vérifier l'identité biométrique
    await NativeBiometric.verifyIdentity({
      reason,
      title: 'Intralys CRM',
      subtitle: 'Connexion biométrique',
      description: 'Utilisez FaceID ou votre empreinte pour vous connecter.',
    });

    // Récupérer les credentials
    const credentials = await NativeBiometric.getCredentials({ server });
    return {
      username: credentials.username,
      password: credentials.password,
    };
  } catch {
    // Biométrie échouée ou annulée par l'utilisateur
    return null;
  }
}

// ── Supprimer les credentials ───────────────────────────────

export async function deleteBiometricCredentials(server: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { NativeBiometric } = await import('capacitor-native-biometric');
    await NativeBiometric.deleteCredentials({ server });
  } catch (err) {
    console.error('Erreur suppression biometric credentials:', err);
  }
}
