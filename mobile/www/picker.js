/**
 * CloudCLI 移动端 · 服务器选择页
 *
 * 通过 Capacitor 原生桥（window.Capacitor.Plugins.Preferences）读写
 * 已保存的服务器列表，选择后导航到对应 CloudCLI 服务器地址。
 * 前端严格同源，加载服务器 origin 后登录/API/WebSocket 全部天然工作。
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'cloudcli.servers';
  var LAST_KEY = 'cloudcli.lastServer';
  var PICKER_URL_KEY = 'cloudcli.pickerUrl';
  var SERVER_NAME_KEY = 'cloudcli.serverName';

  // 原生注入的插件对象。选择页没有打包 @capacitor/core，而原生注入的
  // native-bridge.js 又不提供 registerPlugin，所以必须直接取 JSExport 注入
  // 到 window.Capacitor.Plugins 的插件对象（与 Preferences 的取法一致）。
  // 之前用 registerPlugin 取 ServerSession/WebCache 恒为 null：连接退化为
  // 整页导航、原生会话缓存失效，「返回服务器列表」也随之失效。
  var nativePlugins = (window.Capacitor && window.Capacitor.Plugins) || {};
  var Preferences = nativePlugins.Preferences || null;
  var WebCache = nativePlugins.WebCache || null;
  var ServerSession = nativePlugins.ServerSession || null;

  var els = {
    savedSection: document.getElementById('saved-section'),
    serverList: document.getElementById('server-list'),
    addTitle: document.getElementById('add-title'),
    form: document.getElementById('add-form'),
    name: document.getElementById('server-name'),
    url: document.getElementById('server-url'),
    connectBtn: document.getElementById('connect-btn'),
    errorMsg: document.getElementById('error-msg'),
    refreshBtn: document.getElementById('refresh-latency'),
    clearWebCache: document.getElementById('clear-web-cache'),
    cacheHint: document.getElementById('cache-hint'),
  };

  /** 连接超时时间（毫秒），超过即认为服务器不可达 */
  var CONNECT_TIMEOUT_MS = 8000;

  /** 延迟检测超时时间（毫秒），超过即认为服务器不可达 */
  var LATENCY_TIMEOUT_MS = 3000;

  /** 当前渲染中的服务器列表，供「重新检测」按钮使用 */
  var currentList = [];

  /** 读取已保存的服务器列表 */
  async function getServers() {
    if (!Preferences) return [];
    try {
      var res = await Preferences.get({ key: STORAGE_KEY });
      return res && res.value ? JSON.parse(res.value) : [];
    } catch (e) {
      return [];
    }
  }

  async function saveServers(list) {
    if (!Preferences) return;
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(list) });
  }

  async function setLastServer(url) {
    if (!Preferences) return;
    await Preferences.set({ key: LAST_KEY, value: url });
  }

  /**
   * 记录选择页地址，供已连接页面「返回服务器列表」使用。
   * Preferences 是原生存储，跨 origin 共享：远程服务器页面也能读到本值。
   */
  async function setPickerUrl() {
    if (!Preferences) return;
    await Preferences.set({ key: PICKER_URL_KEY, value: window.location.href });
  }

  /**
   * 记录当前连接的服务器名称，供已连接页面的侧边栏头部展示。
   * Preferences 是原生存储，跨 origin 共享：远程服务器页面也能读到本值。
   */
  async function setServerName(name) {
    if (!Preferences) return;
    await Preferences.set({ key: SERVER_NAME_KEY, value: name || '' });
  }

  /** 规范化服务器地址：补协议、去尾部斜杠 */
  function normalizeUrl(input) {
    var url = input.trim();
    if (!url) return null;
    if (!/^https?:\/\//i.test(url)) {
      url = 'http://' + url;
    }
    url = url.replace(/\/+$/, '');
    try {
      var parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return parsed.origin; // 去掉路径，只保留 origin
    } catch (e) {
      return null;
    }
  }

  /** 进入行内编辑模式：把该条目的信息替换为输入框 + 保存/取消 */
  function startEdit(li, server, list) {
    li.setAttribute('data-editing', 'true');
    li.innerHTML = '';

    var info = document.createElement('div');
    info.className = 'info';

    var nameInput = document.createElement('input');
    nameInput.className = 'edit-input';
    nameInput.maxLength = 40;
    nameInput.placeholder = '名称';
    nameInput.value = server.name || '';

    var urlInput = document.createElement('input');
    urlInput.className = 'edit-input';
    urlInput.placeholder = '服务器地址';
    urlInput.value = server.url;
    urlInput.inputMode = 'url';
    urlInput.autocapitalize = 'off';
    urlInput.autocorrect = 'off';
    urlInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit();
      }
    });

    info.appendChild(nameInput);
    info.appendChild(urlInput);

    var save = document.createElement('button');
    save.className = 'icon-btn save';
    save.textContent = '✓';
    save.setAttribute('aria-label', '保存修改');
    save.onclick = commitEdit;

    var cancel = document.createElement('button');
    cancel.className = 'icon-btn';
    cancel.textContent = '✕';
    cancel.setAttribute('aria-label', '取消编辑');
    cancel.onclick = function () {
      render(list);
    };

    /** 提交修改：校验地址，更新（或合并）对应条目后重新渲染。
     *  先在副本上应用修改，保存成功后再替换列表，避免保存失败时 UI 与存储不一致。 */
    async function commitEdit() {
      var url = normalizeUrl(urlInput.value);
      if (!url) {
        urlInput.focus();
        return;
      }
      var name = nameInput.value.trim() || url;
      var idx = list.findIndex(function (s) {
        return s === server;
      });
      if (idx === -1) return; // 条目已被并发删除
      var other = list.findIndex(function (s, i) {
        return i !== idx && s.url === url;
      });
      var next = list.slice();
      if (other >= 0) {
        // 地址已属其它条目：合并到该项
        next[other].name = name;
        next.splice(idx, 1);
      } else {
        next[idx].name = name;
        next[idx].url = url;
      }
      try {
        await saveServers(next);
        list.length = 0;
        next.forEach(function (s) {
          list.push(s);
        });
        render(list);
      } catch (e) {
        els.errorMsg.textContent = '保存修改失败，请重试';
        els.errorMsg.classList.remove('hidden');
      }
    }

    li.appendChild(info);
    li.appendChild(save);
    li.appendChild(cancel);

    nameInput.focus();
    if (nameInput.setSelectionRange) {
      nameInput.setSelectionRange(nameInput.value.length, nameInput.value.length);
    }
  }

  function render(list) {
    els.serverList.innerHTML = '';
    if (list.length === 0) {
      els.savedSection.classList.add('hidden');
      return;
    }
    els.savedSection.classList.remove('hidden');
    els.addTitle.textContent = '添加服务器';

    list.forEach(function (server, index) {
      var li = document.createElement('li');
      li.className = 'server-item';
      // 关联服务器对象，延迟检测按条目（而非列表下标）匹配
      li._server = server;
      // 点击整行连接该服务器；点击按钮或编辑输入框时不触发连接。
      li.onclick = function (e) {
        if (
          li.dataset.editing === 'true' ||
          (e.target && e.target.closest && e.target.closest('button, input'))
        ) {
          return;
        }
        connectServer(server, li);
      };

      var info = document.createElement('div');
      info.className = 'info';
      var name = document.createElement('div');
      name.className = 'name';
      name.textContent = server.name || server.url;
      var url = document.createElement('div');
      url.className = 'url';
      url.textContent = server.url;
      info.appendChild(name);
      info.appendChild(url);

      // 延迟徽标：条目右侧，渲染后由 detectAllLatencies 异步填充
      var latency = document.createElement('span');
      latency.className = 'latency';
      latency.textContent = '…';
      latency.setAttribute('aria-label', '检测延迟中');

      var edit = document.createElement('button');
      edit.className = 'icon-btn';
      edit.textContent = '✎';
      edit.setAttribute('aria-label', '编辑 ' + server.name);
      edit.onclick = function () {
        startEdit(li, server, list);
      };

      var del = document.createElement('button');
      del.className = 'icon-btn';
      del.textContent = '✕';
      del.setAttribute('aria-label', '删除 ' + server.name);
      del.onclick = async function () {
        var next = list.slice();
        next.splice(index, 1);
        try {
          await saveServers(next);
          list.length = 0;
          next.forEach(function (s) {
            list.push(s);
          });
          render(list);
        } catch (e) {
          els.errorMsg.textContent = '删除失败，请重试';
          els.errorMsg.classList.remove('hidden');
        }
      };

      li.appendChild(info);
      li.appendChild(latency);
      li.appendChild(edit);
      li.appendChild(del);
      els.serverList.appendChild(li);
    });

    detectAllLatencies(list);
  }

  /** 跳转前显示全屏"连接中"遮罩，避免点击后长时间无反馈；目标页的启动 splash 会衔接过渡。 */
  function showConnectingOverlay(name) {
    var overlay = document.createElement('div');
    overlay.className = 'connect-overlay';
    var label = name || '服务器';
    overlay.innerHTML =
      '<div class="connect-overlay-spinner"></div>' +
      '<div class="connect-overlay-text">正在连接 ' + label + '…</div>' +
      '<div class="connect-overlay-sub">首次加载可能需要一些时间</div>';
    document.body.appendChild(overlay);
  }

  async function connect(url, name) {
    await setLastServer(url);
    await setPickerUrl();
    await setServerName(name);

    if (ServerSession) {
      try {
        await ServerSession.switchToServer({ url: url });
        return;
      } catch (e) {
        // 原生会话缓存不可用时，降级为原来的网页跳转方式。
      }
    }

    showConnectingOverlay(name);
    window.location.href = url;
  }

  /**
   * 点击已保存服务器的一行进行连接：先探测可达性，可达则跳转；
   * 不可达时恢复该行可点状态并显示错误提示。连接期间整行置为不可点。
   */
  async function connectServer(server, li) {
    if (li.dataset.connecting === 'true') return;
    li.dataset.connecting = 'true';
    li.classList.add('connecting');
    els.errorMsg.classList.add('hidden');
    var reachable = await probe(server.url);
    if (reachable) {
      try {
        await connect(server.url, server.name);
      } finally {
        // 原生会话切换成功时选择页 webview 只是被隐藏、DOM 保留，必须清除
        // 连接中状态，否则返回服务器列表时该行仍呈灰色且不可点（data-connecting
        // 会让点击直接 return）。整页导航降级路径下页面已离开，清不清无影响。
        li.removeAttribute('data-connecting');
        li.classList.remove('connecting');
      }
    } else {
      li.removeAttribute('data-connecting');
      li.classList.remove('connecting');
      showConnectError(server.url);
      els.errorMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /**
   * 探测服务器是否真实可达：通过 cors 请求后端 /health 端点，
   * 拿到 2xx 响应才视为可达。frp 等场景下 TCP 层可能连通
   * （frps 能 accept），但后端服务挂掉 / 反代 5xx 时 /health
   * 不会返回 2xx，从而避免「有延迟但服务不可达」的误判。
   */
  function probe(url) {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, CONNECT_TIMEOUT_MS);
    return fetch(url + '/health', { mode: 'cors', signal: controller.signal, cache: 'no-store' })
      .then(function (res) {
        clearTimeout(timer);
        return res.ok;
      })
      .catch(function () {
        clearTimeout(timer);
        return false;
      });
  }

  /**
   * 测量服务器延迟（毫秒）：cors 请求 /health，收到 2xx 响应才计时结束；
   * 超时、连不上或后端返回非 2xx 均返回 null（视为不可达）。
   */
  function measureLatency(url) {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, LATENCY_TIMEOUT_MS);
    var start = performance.now();
    return fetch(url + '/health', { mode: 'cors', signal: controller.signal, cache: 'no-store' })
      .then(function (res) {
        clearTimeout(timer);
        return res.ok ? Math.round(performance.now() - start) : null;
      })
      .catch(function () {
        clearTimeout(timer);
        return null;
      });
  }

  /**
   * 并发检测当前列表中全部服务器的延迟并更新各自徽标。
   * 按条目自身匹配服务器（渲染时已把 server 挂到 li._server），
   * 不依赖列表数组顺序与 DOM 顺序的一致性。
   * 检测期间列表被重建（增删改/重新渲染）时，旧条目已脱离 DOM，直接丢弃过期结果。
   */
  async function detectAllLatencies(list) {
    currentList = list;
    var items = els.serverList.querySelectorAll('li');
    items.forEach(function (li) {
      var badge = li.querySelector('.latency');
      if (badge) badge.textContent = '…';
    });

    await Promise.all(Array.prototype.map.call(items, async function (li) {
      if (!document.body.contains(li)) return;
      var server = li._server;
      if (!server) return;
      var badge = li.querySelector('.latency');
      if (!badge) return;

      var ms = await measureLatency(server.url);
      if (!document.body.contains(li)) return; // 列表已重建，丢弃过期结果
      if (ms === null) {
        badge.textContent = '不可达';
        badge.className = 'latency down';
      } else {
        badge.textContent = ms + ' ms';
        badge.className = 'latency ok';
      }
    }));
  }

  /** 在表单下方显示一条连接失败提示 */
  function showConnectError(url) {
    var extra =
      url.indexOf('https://') === 0
        ? ' 若服务器使用自签 HTTPS 证书，请改用 http:// 或在设备上信任该证书。'
        : '';
    els.errorMsg.textContent =
      '无法连接 ' + url + '。请检查地址是否正确、目标电脑是否开机、以及当前网络是否可达。' + extra;
    els.errorMsg.classList.remove('hidden');
  }

  els.form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var url = normalizeUrl(els.url.value);
    if (!url) {
      els.url.focus();
      els.url.reportValidity?.();
      return;
    }
    var name = els.name.value.trim() || url;

    els.connectBtn.disabled = true;
    els.connectBtn.textContent = '连接中…';
    els.errorMsg.classList.add('hidden');

    var list = await getServers();
    var exists = list.find(function (s) {
      return s.url === url;
    });
    if (exists) {
      exists.name = name;
    } else {
      list.push({ name: name, url: url });
    }
    await saveServers(list);
    // 立即渲染列表：原生切换时选择页 webview 保留（只是被隐藏），
    // 否则返回列表时看不到刚添加的服务器、按钮也停留在「连接中…」。
    render(list);

    var reachable = await probe(url);
    if (reachable) {
      try {
        await connect(url, name);
      } finally {
        els.connectBtn.disabled = false;
        els.connectBtn.textContent = '连接';
      }
    } else {
      els.connectBtn.disabled = false;
      els.connectBtn.textContent = '连接';
      showConnectError(url);
      els.url.focus();
    }
  });

  // 修改地址时清掉上一次的连接错误提示
  els.url.addEventListener('input', function () {
    els.errorMsg.classList.add('hidden');
  });

  // 「重新检测」按钮：对当前列表重新测量延迟
  if (els.refreshBtn) {
    els.refreshBtn.addEventListener('click', function () {
      if (currentList.length === 0) return;
      detectAllLatencies(currentList);
    });
  }

  if (els.clearWebCache) {
    if (!WebCache) {
      els.clearWebCache.classList.add('hidden');
      if (els.cacheHint) els.cacheHint.classList.add('hidden');
    } else {
      els.clearWebCache.addEventListener('click', async function () {
        var confirmed = window.confirm(
          '将清除已连接服务器的网页缓存和登录状态，服务器列表会保留。是否继续？',
        );
        if (!confirmed) return;

        els.clearWebCache.disabled = true;
        els.clearWebCache.textContent = '正在清除…';
        try {
          await WebCache.clear();
          window.alert('应用缓存已清除，请重新连接服务器。');
          window.location.reload();
        } catch (e) {
          els.clearWebCache.disabled = false;
          els.clearWebCache.textContent = '清除应用缓存';
          window.alert('缓存清除失败，请重试。');
        }
      });
    }
  }

  /** 隐藏 iOS 系统表单工具条（上/下箭头 + 打勾）。@capacitor/keyboard 默认隐藏，
   *  这里再显式调用一次，确保 WebView 加载完成后 swizzle 已生效。 */
  async function hideKeyboardAccessoryBar() {
    try {
      var Keyboard = nativePlugins.Keyboard;
      if (Keyboard) {
        await Keyboard.setAccessoryBarVisible({ isVisible: false });
      }
    } catch (e) {
      console.warn('[picker] failed to hide keyboard accessory bar:', e);
    }
  }

  /**
   * 键盘弹出时把聚焦输入框抬到键盘上方。
   *
   * capacitor.config.ts 里 Keyboard.resize = 'none'，原生不缩放 WebView，
   * 键盘弹起时前端必须自行处理。本实现用标准 DOM focusin/focusout 驱动
   * （不依赖 Capacitor/visualViewport 事件，后者在本页实测不可靠）：临时
   * 撑高 body 产生滚动空间，再 scrollTo 把聚焦输入框移到键盘上方。键盘高度
   * 取 visualViewport 差值，拿不到时按「至少视口一半」保守估算，保证输入框
   * 落在视口上半部，常见键盘高度都挡不住。
   */
  function setupKeyboardAvoidance() {
    var body = document.body;

    function keyboardHeight() {
      var vv = window.visualViewport;
      return vv ? Math.max(0, window.innerHeight - vv.height) : 0;
    }

    function isInput(el) {
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    }

    /** 把当前聚焦输入框抬到键盘上方。幂等：目标用 scrollTo 绝对位置。 */
    function shift() {
      var el = document.activeElement;
      if (!isInput(el)) return;
      // 保守键盘高度：能拿到真实值就用，拿不到按「键盘至少占视口一半」估算，
      // 保证输入框滚到视口上半部——常见键盘高度都挡不住。
      var kh = keyboardHeight();
      var effectiveKh = Math.max(kh, window.innerHeight * 0.5);
      // 撑高 body 产生滚动空间
      body.style.minHeight = window.innerHeight + effectiveKh + 'px';
      // 目标滚动：输入框底部对齐（视口底部 - 键盘高度）上方留 16px
      var elBottomDoc = el.getBoundingClientRect().bottom + window.scrollY;
      var targetScroll = elBottomDoc - (window.innerHeight - effectiveKh) + 16;
      var maxScroll = body.scrollHeight - window.innerHeight;
      targetScroll = Math.max(0, Math.min(targetScroll, maxScroll));
      if (targetScroll > window.scrollY) {
        window.scrollTo(0, targetScroll);
      }
    }

    function reset() {
      body.style.minHeight = '';
    }

    // 主事件源：标准 DOM 事件，必然触发
    document.addEventListener('focusin', function () {
      // 键盘弹出动画期间重复尝试，覆盖动画时序
      setTimeout(shift, 80);
      setTimeout(shift, 250);
      setTimeout(shift, 450);
    });
    document.addEventListener('focusout', reset);

    // 辅助事件源：Capacitor 键盘事件（精确高度）与 visualViewport resize。
    // 注入的插件对象 addListener 同步返回句柄（不是 Promise），两种返回值都兼容。
    var Keyboard = nativePlugins.Keyboard;
    if (Keyboard && typeof Keyboard.addListener === 'function') {
      try {
        var showHandle = Keyboard.addListener('keyboardWillShow', function () {
          shift();
        });
        if (showHandle && typeof showHandle.catch === 'function') {
          showHandle.catch(function () {});
        }
        var hideHandle = Keyboard.addListener('keyboardWillHide', reset);
        if (hideHandle && typeof hideHandle.catch === 'function') {
          hideHandle.catch(function () {});
        }
      } catch (e) {
        console.warn('[picker] keyboard plugin unavailable:', e);
      }
    }
    var vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', function () {
        if (keyboardHeight() > 0) {
          shift();
        }
      });
    }
  }

  (async function init() {
    setupKeyboardAvoidance();
    await hideKeyboardAccessoryBar();
    var list = await getServers();
    render(list);
  })();
})();
