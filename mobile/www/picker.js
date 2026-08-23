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

  var Preferences = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) || null;

  var els = {
    savedSection: document.getElementById('saved-section'),
    serverList: document.getElementById('server-list'),
    addTitle: document.getElementById('add-title'),
    form: document.getElementById('add-form'),
    name: document.getElementById('server-name'),
    url: document.getElementById('server-url'),
    connectBtn: document.getElementById('connect-btn'),
    errorMsg: document.getElementById('error-msg'),
  };

  /** 连接超时时间（毫秒），超过即认为服务器不可达 */
  var CONNECT_TIMEOUT_MS = 8000;

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

    /** 提交修改：校验地址，更新（或合并）对应条目后重新渲染 */
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
      if (other >= 0) {
        // 地址已属其它条目：合并到该项
        list[other].name = name;
        list.splice(idx, 1);
      } else {
        list[idx].name = name;
        list[idx].url = url;
      }
      await saveServers(list);
      render(list);
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
        list.splice(index, 1);
        await saveServers(list);
        render(list);
      };

      li.appendChild(info);
      li.appendChild(edit);
      li.appendChild(del);
      els.serverList.appendChild(li);
    });
  }

  async function connect(url) {
    await setLastServer(url);
    await setPickerUrl();
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
      await connect(server.url);
    } else {
      li.removeAttribute('data-connecting');
      li.classList.remove('connecting');
      showConnectError(server.url);
      els.errorMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /**
   * 探测服务器是否可达：跨域只能用 no-cors fetch（读不到响应体），
   * 只要 TCP/HTTP 能建立连接即视为可达；超时或连不上则返回 false。
   */
  function probe(url) {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, CONNECT_TIMEOUT_MS);
    return fetch(url + '/', { mode: 'no-cors', signal: controller.signal, cache: 'no-store' })
      .then(function () {
        clearTimeout(timer);
        return true;
      })
      .catch(function () {
        clearTimeout(timer);
        return false;
      });
  }

  /** 在表单下方显示一条连接失败提示 */
  function showConnectError(url) {
    els.errorMsg.textContent =
      '无法连接 ' + url + '。请检查地址是否正确、目标电脑是否开机、以及当前网络是否可达。';
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

    var reachable = await probe(url);
    if (reachable) {
      await connect(url);
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

  /** 隐藏 iOS 系统表单工具条（上/下箭头 + 打勾）。@capacitor/keyboard 默认隐藏，
   *  这里再显式调用一次，确保 WebView 加载完成后 swizzle 已生效。 */
  async function hideKeyboardAccessoryBar() {
    try {
      if (window.Capacitor && typeof window.Capacitor.registerPlugin === 'function') {
        var Keyboard = window.Capacitor.registerPlugin('Keyboard');
        await Keyboard.setAccessoryBarVisible({ isVisible: false });
      }
    } catch (e) {
      console.warn('[picker] failed to hide keyboard accessory bar:', e);
    }
  }

  (async function init() {
    await hideKeyboardAccessoryBar();
    var list = await getServers();
    render(list);
  })();
})();
