// ── Camera — Wrapper Capacitor Camera ───────────────────────
// Sprint 11 — Capacitor V1

import { Capacitor } from '@capacitor/core';
import type { Photo } from '@capacitor/camera';

export interface CapturedPhoto {
  dataUrl: string;
  format: string;
}

// ── Prendre une photo ou choisir depuis la galerie ──────────

export async function takePhoto(): Promise<CapturedPhoto | null> {
  if (!Capacitor.isNativePlatform()) {
    // Fallback web : input file
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'environment';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) { resolve(null); return; }
        const reader = new FileReader();
        reader.onload = () => {
          resolve({
            dataUrl: reader.result as string,
            format: file.type.split('/')[1] || 'jpeg',
          });
        };
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }

  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
    const photo: Photo = await Camera.getPhoto({
      quality: 85,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Prompt,
      width: 1200,
      height: 1200,
      correctOrientation: true,
    });

    if (!photo.dataUrl) return null;

    return {
      dataUrl: photo.dataUrl,
      format: photo.format,
    };
  } catch (err) {
    console.error('Erreur caméra:', err);
    return null;
  }
}

// ── Convertir un dataUrl en File pour upload ────────────────

export function dataUrlToFile(dataUrl: string, filename: string): File {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0]?.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const raw = parts[1] || '';
  const bstr = atob(raw);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
}
