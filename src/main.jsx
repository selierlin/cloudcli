import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App.tsx'
import { dismissSplash } from './utils/splash'

import './index.css'
import 'katex/dist/katex.min.css'

// Initialize i18n
import './i18n/config.js'

// Register service worker for PWA + Web Push support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err => {
    console.warn('Service worker registration failed:', err);
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// 启动 splash 不再在 React 挂载后立即移除，而是贯穿认证验证与项目加载，
// 由首次内容 ready（ProtectedRoute / AppContent）时调用 dismissSplash() 一次性淡出。
// 兜底：15s 后仍未 ready（异常时序）则强制移除，避免 splash 永久遮挡界面。
window.setTimeout(dismissSplash, 15000);
