import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
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

// 启动 splash 只覆盖 JS bundle 下载/执行与首次渲染；React 挂载后淡出移除。
// 双层 requestAnimationFrame 确保在浏览器完成首次绘制后才隐藏。
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const splash = document.getElementById('app-splash');
    if (splash) {
      splash.classList.add('splash-hidden');
      window.setTimeout(() => splash.remove(), 300);
    }
  });
});
