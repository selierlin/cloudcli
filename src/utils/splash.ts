/**
 * 隐藏并移除启动 splash（幂等）。
 *
 * 启动 splash（index.html 中的 #app-splash）从 HTML 就绪起一直保持到「首个稳定
 * 内容 ready」再一次性淡出，覆盖认证验证与项目加载期间本会闪现的多个 loading 页，
 * 避免启动时反复切换不同界面。由 ProtectedRoute（登录 / 设置 / 引导分支）与
 * AppContent（主内容加载完成）调用。
 */
export function dismissSplash(): void {
  const splash = document.getElementById('app-splash');
  if (!splash || splash.dataset.dismissed === '1') {
    return;
  }

  splash.dataset.dismissed = '1';
  splash.classList.add('splash-hidden');
  window.setTimeout(() => splash.remove(), 300);
}
