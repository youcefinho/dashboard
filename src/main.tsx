import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { Capacitor } from '@capacitor/core';

// ── Init Capacitor plugins au boot (natif uniquement) ───────
async function initCapacitor() {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: '#009DDB' });
  } catch { /* non critique */ }

  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    // Cacher le splash après le render React
    setTimeout(() => { void SplashScreen.hide(); }, 1500);
  } catch { /* non critique */ }
}

void initCapacitor();

const root = document.getElementById('root');
if (!root) throw new Error('Élément #root introuvable');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
