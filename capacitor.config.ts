import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.intralys.crm',
  appName: 'Intralys CRM',
  webDir: 'dist',
  server: {
    // En production, l'app charge depuis le serveur Cloudflare
    url: 'https://crm.intralys.com',
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#009DDB',
      showSpinner: true,
      spinnerColor: '#FFFFFF',
      launchShowDuration: 1500,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#009DDB',
    },
    Keyboard: {
      resize: 'body',
      scrollPadding: false,
    },
  },
};

export default config;
