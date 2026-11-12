import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Register Service Worker for offline application shell caching on iOS Safari & Chromium
const updateSW = registerSW({
  immediate: true,
  onOfflineReady() {
    window.dispatchEvent(new CustomEvent('poolmint-sw-ready', { detail: { offlineReady: true } }));
  },
  onNeedRefresh() {
    updateSW(true);
  },
  onRegisterError(error) {
    console.error('Service Worker registration error:', error);
  },
});

createRoot(document.getElementById('root')!).render(<App />);
