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

  var Preferences = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) || null;

  var els = {
    savedSection: document.getElementById('saved-section'),
    serverList: document.getElementById('server-list'),
    addTitle: document.getElementById('add-title'),
    form: document.getElementById('add-form'),
    name: document.getElementById('server-name'),
    url: document.getElementById('server-url'),
    connectBtn: document.getElementById('connect-btn'),
  };

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

      var go = document.createElement('button');
      go.className = 'icon-btn';
      go.textContent = '→';
      go.setAttribute('aria-label', '连接 ' + server.name);
      go.onclick = function () {
        connect(server.url);
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
      li.appendChild(go);
      li.appendChild(del);
      els.serverList.appendChild(li);
    });
  }

  function connect(url) {
    setLastServer(url);
    window.location.href = url;
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
    connect(url);
  });

  (async function init() {
    var list = await getServers();
    render(list);
  })();
})();
