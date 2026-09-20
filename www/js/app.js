/* =================================================================
   pDisk - Single Page Application
   ================================================================= */

// ===== Configuration =====
const API_BASE = window.location.origin + '/ask/';
const UPLOAD_URL = window.location.origin + '/upload';

// ===== i18n - Multi Language Support =====
var _langData = {};
var _currentLang = 'en';
var _i18nLangFiles = {};

function t(key, params) {
  var text = _langData[key];
  if (text === undefined) text = key;
  if (params) {
    for (var k in params) {
      text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), params[k]);
    }
  }
  return text;
}

function applyLanguage() {
  // Update html lang attribute
  document.documentElement.lang = _currentLang;
  // Apply data-i18n (textContent)
  var els = document.querySelectorAll('[data-i18n]');
  for (var i = 0; i < els.length; i++) {
    var key = els[i].getAttribute('data-i18n');
    els[i].textContent = t(key);
  }
  // Apply data-i18n-placeholder (placeholder attribute)
  var phs = document.querySelectorAll('[data-i18n-placeholder]');
  for (var i = 0; i < phs.length; i++) {
    var key = phs[i].getAttribute('data-i18n-placeholder');
    phs[i].placeholder = t(key);
  }
  // Update page title
  document.title = t('app.title');
}

function initLanguage(onReady) {
  var lang = navigator.language || 'en';
  var tryLangs = [lang];
  // Add prefix-only variant (e.g., 'zh' from 'zh-CN')
  if (lang.indexOf('-') > 0) {
    tryLangs.push(lang.split('-')[0]);
  }
  // Always fallback to 'en'
  if (tryLangs.indexOf('en') < 0) tryLangs.push('en');
  // Deduplicate
  tryLangs = tryLangs.filter(function(v, i, a) { return a.indexOf(v) === i; });

  function tryLoad(idx) {
    if (idx >= tryLangs.length) {
      applyLanguage();
      if (onReady) onReady();
      return;
    }
    var l = tryLangs[idx];
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'lang/' + l + '.json', true);
    xhr.onload = function() {
      if (xhr.status === 200) {
        try {
          _langData = JSON.parse(xhr.responseText);
          _currentLang = l;
          applyLanguage();
          if (onReady) onReady();
          return;
        } catch(e) {}
      }
      tryLoad(idx + 1);
    };
    xhr.onerror = function() { tryLoad(idx + 1); };
    xhr.send();
  }
  tryLoad(0);
}

// ===== State =====
let currentUser = null;
let currentDir = '';
let recentUploads = [];
let adminUsers = [];
let _fileSortBy = 'name';
let _fileSortOrder = 'asc';
let _adminSortBy = 'name';
let _adminSortOrder = 'asc';
let _shareSortBy = 'name';
let _shareSortOrder = 'asc';
let _shareUnlocked = false;

// ===== File Sorting =====
function sortFiles(files, sortBy, sortOrder) {
  if (!files || files.length === 0) return files;
  var dir = sortOrder === 'desc' ? -1 : 1;
  var sorted = files.slice();
  sorted.sort(function(a, b) {
    var va, vb;
    if (sortBy === 'time') {
      va = a.createTime || '';
      vb = b.createTime || '';
    } else {
      va = (a.name || '').toLowerCase();
      vb = (b.name || '').toLowerCase();
    }
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
  return sorted;
}

// ===== Utility: URL Encode Helper =====
function urlEncodeParam(key, value) {
  return encodeURIComponent(key) + '=' + encodeURIComponent(value == null ? '' : String(value));
}
function paramsToUrlEncoded(params) {
  var parts = [];
  for (var key in params) {
    if (params.hasOwnProperty(key)) {
      parts.push(urlEncodeParam(key, params[key]));
    }
  }
  return parts.join('&');
}

// ===== Utility: API Request =====
function postRequest(apiName, params, callback) {
  var xhr = new XMLHttpRequest();
  xhr.open('POST', API_BASE + apiName, true);
  xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');

  // 从 params 中提取 token，放入 Authorization 请求头（Bearer 认证）
  var authToken = '';
  if (params && params.token) {
    authToken = params.token;
    delete params.token;
  }
  if (authToken) {
    xhr.setRequestHeader('Authorization', 'Bearer ' + authToken);
  }

  xhr.onload = function() {
    try {
      var text = xhr.responseText;
      // WebPascal 服务器将 Content-Type 写入了响应体，需要跳过
      var jsonStart = text.indexOf('{');
      if (jsonStart > 0) text = text.substring(jsonStart);
      var res = JSON.parse(text);
      // Token 验证失败，清除登录信息并跳转登录页（仅在不需要 token 的 API 不会触发，因为这些 API 不会返回 401）
      if (res.code === 401) {
        clearAuth();
        updateNavVisibility();
        navigateTo('login');
        showToast(t('toast.pleaseLogin'));
        return;
      }
      callback(null, res);
    } catch (e) {
      callback(new Error('Invalid response'), null);
    }
  };
  xhr.onerror = function() { callback(new Error('Network error'), null); };
  // 使用 application/x-www-form-urlencoded 提交参数，参数进行 URL 编码
  xhr.send(paramsToUrlEncoded(params));
}

// ===== Utility: Format Size =====
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var i = Math.floor(Math.log(bytes) / Math.log(1024));
  if (i >= units.length) i = units.length - 1;
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 2 : 0) + ' ' + units[i];
}

function formatTime(ts) {
  if (!ts) return '-';
  var d = new Date(ts);
  var pad = function(n) { return n < 10 ? '0' + n : n; };
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// ===== Traffic Stats Polling =====
var _trafficTimer = null;
var _prevUp = 0;
var _prevDown = 0;

function updateTrafficDisplay(upRate, downRate) {
  var upEl = document.getElementById('upRate');
  var downEl = document.getElementById('downRate');
  if (upEl) upEl.textContent = upRate || '0 B';
  if (downEl) downEl.textContent = downRate || '0 B';

  // Share page indicator
  var svUpEl = document.getElementById('svUpRate');
  var svDownEl = document.getElementById('svDownRate');
  if (svUpEl) svUpEl.textContent = upRate || '0 B';
  if (svDownEl) svDownEl.textContent = downRate || '0 B';
}

function fetchTrafficStats() {
  // 网盘未登录 且 分享页未解锁时跳过
  var token = getToken();
  var svList = document.getElementById('svFileList');
  var shareUnlocked = !svList || svList.querySelectorAll('li').length > 0;
  if (!token && !shareUnlocked) return;

  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/stats', true);
  xhr.onload = function() {
    if (xhr.status === 200) {
      try {
        var res = JSON.parse(xhr.responseText);
        if (res.code === 200 && res.data) {
          // send_rate = 服务端发送 = 客户端下载, recv_rate = 服务端接收 = 客户端上传
          updateTrafficDisplay(res.data.recv_rate, res.data.send_rate);
        }
      } catch(e) {}
    }
  };
  xhr.onerror = function() {}; // Silently fail
  xhr.send();
}

function startTrafficPolling() {
  // 防止重复启动
  if (_trafficTimer) return;
  // Initial fetch
  fetchTrafficStats();
  // Poll every 3 seconds
  _trafficTimer = setInterval(fetchTrafficStats, 3000);
}

function stopTrafficPolling() {
  if (_trafficTimer) {
    clearInterval(_trafficTimer);
    _trafficTimer = null;
  }
}

// ===== Utility: Get Token =====
function getToken() { return localStorage.getItem('pdisk_token'); }
function getUsername() { return localStorage.getItem('pdisk_username'); }
function getNickname() { return localStorage.getItem('pdisk_nickname'); }
function getIsAdmin() { return localStorage.getItem('pdisk_isAdmin') === '1'; }

function setAuth(token, username, nickname, email, isAdmin) {
  localStorage.setItem('pdisk_token', token);
  localStorage.setItem('pdisk_username', username);
  localStorage.setItem('pdisk_nickname', nickname);
  localStorage.setItem('pdisk_email', email || '');
  localStorage.setItem('pdisk_isAdmin', isAdmin === 0 ? '0' : '1');
}

function clearAuth() {
  localStorage.removeItem('pdisk_token');
  localStorage.removeItem('pdisk_username');
  localStorage.removeItem('pdisk_nickname');
  localStorage.removeItem('pdisk_email');
  localStorage.removeItem('pdisk_isAdmin');
}

// ===== Base62 (Snowflake ID <-> short string) =====
var BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function encodeBase62(num) {
  num = BigInt(num);
  if (num <= 0n) return '0';
  var result = '';
  var n = num;
  while (n > 0n) {
    result = BASE62[Number(n % 62n)] + result;
    n = n / 62n;
  }
  return result;
}
function decodeBase62(str) {
  if (!str) return 0n;
  var result = 0n;
  for (var i = 0; i < str.length; i++) {
    result = result * 62n + BigInt(BASE62.indexOf(str[i]));
  }
  return result;
}

// ===== Dialog Helper =====
var _dialogOverlay = null;

function showDialog(html, extraClass) {
  // Remove any existing dialog overlay
  if (_dialogOverlay) { _dialogOverlay.remove(); _dialogOverlay = null; }

  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:500;display:flex;align-items:center;justify-content:center;padding:20px;';

  var dlg = document.createElement('div');
  dlg.className = 'dialog' + (extraClass ? ' ' + extraClass : '');
  dlg.innerHTML = html;

  overlay.appendChild(dlg);
  overlay.addEventListener('click', function(e) { if (e.target === this) closeDialog(); });
  document.body.appendChild(overlay);
  _dialogOverlay = overlay;
  applyLanguage();
}

function closeDialog() {
  if (_dialogOverlay) { _dialogOverlay.remove(); _dialogOverlay = null; }
}

function showConfirmDialog(message, onConfirm, btnClass) {
  if (!btnClass) btnClass = 'btn-danger';
  showDialog(
    '<div class="dialog-title" data-i18n="dialog.confirm">' + t('dialog.confirm') + '</div>' +
    '<div style="margin-bottom:16px;font-size:14px;color:#333;">' + escHtml(message) + '</div>' +
    '<div class="dialog-actions">' +
      '<button class="btn btn-outline" onclick="closeDialog()" data-i18n="btn.cancel">' + t('btn.cancel') + '</button>' +
      '<button class="btn ' + btnClass + '" id="confirmDialogBtn" data-i18n="btn.confirm">' + t('btn.confirm') + '</button>' +
    '</div>'
  );
  setTimeout(function() {
    var btn = document.getElementById('confirmDialogBtn');
    if (btn) {
      btn.addEventListener('click', function() {
        closeDialog();
        if (onConfirm) onConfirm();
      });
    }
  }, 50);
}

// ===== Toast =====
function showToast(msg) {
  var d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.75);color:#fff;padding:12px 24px;border-radius:8px;z-index:10010;font-size:14px;max-width:80%;text-align:center;';
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(function() { d.remove(); }, 2000);
}

// ===== SPA Router =====
function navigateTo(page) {
  // Hide all pages
  var pages = document.querySelectorAll('.page');
  for (var i = 0; i < pages.length; i++) pages[i].classList.remove('active');

  var targetPage = document.getElementById('page-' + page);
  if (targetPage) targetPage.classList.add('active');

  // Update nav
  var navItems = document.querySelectorAll('.bottom-nav .nav-item');
  for (var i = 0; i < navItems.length; i++) {
    var d = navItems[i].getAttribute('data-page');
    navItems[i].classList.toggle('active', d === page);
  }

  // Update title
  var titles = { login: 'app.title', home: 'nav.home', files: 'nav.files', profile: 'nav.profile', admin: 'nav.admin' };
  document.getElementById('pageTitle').textContent = t(titles[page] || 'app.title');

  // Page-specific init
  if (page === 'home') { loadRecentFiles(); loadMyShares(); }
  if (page === 'files') loadFileList();
  if (page === 'profile') loadProfile();
  if (page === 'admin') loadAdminData();

  // 隐藏不属于当前页面的批量操作行
  var fileBatchRow = document.getElementById('batchActionsRow');
  var adminBatchRow = document.getElementById('adminBatchActionsRow');
  if (page !== 'files') {
    if (fileBatchRow) fileBatchRow.style.display = 'none';
  }
  if (page !== 'admin') {
    if (adminBatchRow) adminBatchRow.style.display = 'none';
  }
}

// ===== Navigation Events =====
document.getElementById('bottomNav').addEventListener('click', function(e) {
  var item = e.target.closest('.nav-item');
  if (!item) return;
  var page = item.getAttribute('data-page');
  if (page === 'logout') {
    clearAuth();
    showToast(t('toast.loggedOut'));
    updateNavVisibility();
    // 隐藏流量指示器
    var ti = document.getElementById('trafficIndicator');
    if (ti) ti.classList.remove('show');
    // 停止流量轮询
    stopTrafficPolling();
    navigateTo('login');
    return;
  }
  navigateTo(page);
});

// ===== Update Nav Visibility =====
function updateNavVisibility() {
  var adminNav = document.getElementById('navAdmin');
  var bottomNav = document.getElementById('bottomNav');
  var shareFab = document.getElementById('shareFab');
  var uploadFab = document.getElementById('uploadFab');
  var hasToken = !!getToken();
  if (getIsAdmin() && hasToken) {
    adminNav.classList.remove('hidden');
  } else {
    adminNav.classList.add('hidden');
  }
  // 未登录时隐藏整个底部导航
  if (bottomNav) {
    bottomNav.style.display = hasToken ? 'flex' : 'none';
  }
  // 登录时显示悬浮分享/上传按钮，未登录时隐藏
  if (shareFab) {
    shareFab.style.display = hasToken ? 'flex' : 'none';
  }
  if (uploadFab) {
    uploadFab.style.display = hasToken ? 'flex' : 'none';
    // 登录成功（FAB 由隐藏转为可见）后重新定位，避免使用隐藏时的 0 尺寸算出的错误坐标
    // requestAnimationFrame 确保布局完成、尺寸可测量后再定位
    if (hasToken && window.relocateUploadFab) {
      if (window.requestAnimationFrame) {
        window.requestAnimationFrame(function() { window.relocateUploadFab(); });
      } else {
        window.relocateUploadFab();
      }
    }
  }
  // 未登录时隐藏常驻上传对话框
  var uploadDlg = document.getElementById('uploadDialogOverlay');
  if (uploadDlg) uploadDlg.style.display = 'none';
}

// =================================================================
// PAGE: LOGIN
// =================================================================
(function() {
  var loginTabs = document.getElementById('loginTabs');
  loginTabs.addEventListener('click', function(e) {
    var tab = e.target.closest('.tab-item');
    if (!tab) return;
    var t = tab.getAttribute('data-tab');
    document.querySelectorAll('#loginTabs .tab-item').forEach(function(el) { el.classList.remove('active'); });
    tab.classList.add('active');
    document.getElementById('form-login').style.display = t === 'login' ? 'block' : 'none';
    document.getElementById('form-register').style.display = t === 'register' ? 'block' : 'none';
  });

  // Login
  document.getElementById('loginBtn').addEventListener('click', function() {
    var username = document.getElementById('loginUsername').value.trim();
    var password = document.getElementById('loginPassword').value;
    if (!username || !password) { showToast(t('login.fillAll')); return; }
    var btn = this;
    btn.disabled = true;
    btn.textContent = t('login.loggingIn');
    postRequest('login.api', { username: username, password: password }, function(err, res) {
      btn.disabled = false;
      btn.textContent = t('login.btn');
      if (err || res.code !== 200) {
        showToast(t(res && res.msg) || t('toast.loginFailed'));
        return;
      }
      setAuth(res.data.token, res.data.username, res.data.nickname, res.data.email, res.data.isAdmin);
      updateNavVisibility();
      navigateTo('home');
      // 显示流量指示器并启动轮询
      var ti = document.getElementById('trafficIndicator');
      if (ti) ti.classList.add('show');
      startTrafficPolling();
      showToast(t('toast.loginSuccess'));
    });
  });

  // Register
  document.getElementById('registerBtn').addEventListener('click', function() {
    var username = document.getElementById('regUsername').value.trim();
    var email = document.getElementById('regEmail').value.trim();
    var nickname = document.getElementById('regNickname').value.trim();
    var password = document.getElementById('regPassword').value;
    var confirmPwd = document.getElementById('regConfirmPwd').value;
    if (!username || !email || !nickname || !password) { showToast(t('login.fillAll')); return; }
    if (password !== confirmPwd) { showToast(t('login.pwdMismatch')); return; }
    var btn = this;
    btn.disabled = true;
    btn.textContent = t('login.registering');
    postRequest('register.api', { username: username, password: password, email: email, nickname: nickname }, function(err, res) {
      btn.disabled = false;
      btn.textContent = t('register.btn');
      if (err || res.code !== 200) {
        showToast(t(res && res.msg) || t('toast.registerFailed'));
        return;
      }
      showToast(t('toast.registerSuccess'));
      // Switch to login tab
      document.querySelector('#loginTabs .tab-item[data-tab="login"]').click();
    });
  });

  // Enter key for login
  document.getElementById('loginPassword').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('loginBtn').click();
  });
  document.getElementById('loginUsername').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('loginBtn').click();
  });

  // Enter key for register
  document.getElementById('regConfirmPwd').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('registerBtn').click();
  });

  // Forgot password
  document.getElementById('forgotLink').addEventListener('click', function() {
    showDialog(
      '<div class="dialog-title"><svg class="icon" style="vertical-align:middle;margin-right:4px;"><use href="#icon-key"/></svg> <span data-i18n="forgot.title">' + t('forgot.title') + '</span></div>' +
      '<div class="form-group"><label data-i18n="forgot.username">' + t('forgot.username') + '</label><input class="form-input" id="forgotUsername" placeholder="' + t('forgot.usernamePlaceholder') + '" data-i18n-placeholder="forgot.usernamePlaceholder"></div>' +
      '<div class="form-group"><label data-i18n="forgot.email">' + t('forgot.email') + '</label><input class="form-input" id="forgotEmail" type="email" placeholder="' + t('forgot.emailPlaceholder') + '" data-i18n-placeholder="forgot.emailPlaceholder"></div>' +
      '<div class="dialog-actions">' +
        '<button class="btn btn-outline" onclick="closeDialog()" data-i18n="btn.cancel">' + t('btn.cancel') + '</button>' +
        '<button class="btn btn-primary" id="forgotSubmitBtn" data-i18n="forgot.submit">' + t('forgot.submit') + '</button>' +
      '</div>'
    );
    document.getElementById('forgotSubmitBtn').addEventListener('click', function() {
      var u = document.getElementById('forgotUsername').value.trim();
      var e = document.getElementById('forgotEmail').value.trim();
      if (!u || !e) { showToast(t('login.fillAll')); return; }
      postRequest('reset_pwd_request.api', { username: u, email: e }, function(err, res) {
        if (err || res.code !== 200) { showToast(t(res && res.msg) || t('toast.submitFailed')); return; }
        showToast(t('toast.resetSubmitted'));
        closeDialog();
      });
    });
    // Enter key for forgot password dialog
    var forgotEmailInput = document.getElementById('forgotEmail');
    if (forgotEmailInput) {
      forgotEmailInput.addEventListener('keydown', function(ev) {
        if (ev.key === 'Enter') document.getElementById('forgotSubmitBtn').click();
      });
    }
  });

  // 页面加载后显示登录表单
  setTimeout(function() {
    document.getElementById('loginTabs').style.display = 'flex';
    document.getElementById('form-login').style.display = 'block';
  }, 500);
})();

// =================================================================
// Upload (shared logic — used by home upload area AND upload dialog)
// 设计：上传 session 提升为全局 _uploadSession，与 DOM 解耦；
//       上传对话框 DOM 常驻，仅切换 display，显示/隐藏不中断进行中的上传。
// =================================================================

// 全局上传 session（一次上传的生命周期）
window._uploadSession = null;

// 计算当前上传目标目录的绝对路径
// - files 页 + _currentDir 有值：返回当前目录绝对路径
// - 其它页面（首页/profile/admin/...）：返回空字符串，代表根目录
function getUploadTargetDir() {
  var activePage = document.querySelector('.page.active');
  if (!activePage || activePage.id !== 'page-files') return '';
  var dir = _currentDir;
  if (!dir) return '';
  if (dir.indexOf('/up/') !== 0) {
    dir = '/up/' + getUsername() + '/' + String(dir).replace(/^\//, '');
  }
  return dir;
}

// 在指定 DOM 容器内启动一次上传（目标：queueEl/summaryEl，可选 dir）
function startUpload(files, dir) {
  var token = getToken();
  if (!token) { showToast(t('toast.pleaseLogin')); navigateTo('login'); return; }

  var queueEl = document.getElementById('uploadQueue');
  var summaryEl = document.getElementById('uploadSummary');
  // 若首页上传区不可用（未渲染），回退到对话框 DOM
  if (!queueEl || queueEl.offsetParent === null) {
    queueEl = document.getElementById('uploadDialogQueue');
    summaryEl = document.getElementById('uploadDialogSummary');
  }

  var total = files.length;
  var done = 0, failed = 0;
  var uploadState = { currentRate: 0 };

  // 全局 session（保存当前上传目标 UI 引用，供 dialog 隐藏/显示时复用）
  window._uploadSession = {
    queueEl: queueEl,
    summaryEl: summaryEl,
    dir: dir || ''
  };

  // 构建队列 UI
  queueEl.innerHTML = '';
  var items = [];
  for (var i = 0; i < total; i++) {
    var f = files[i];
    var div = document.createElement('div');
    div.className = 'upload-queue-item';
    div.innerHTML = '<span class="uq-name">' + escHtml(f.name) + '</span>' +
      '<span class="uq-status waiting">' + t('upload.waiting') + '</span>' +
      '<div class="uq-bar"><div class="uq-bar-fill" style="width:0%"></div></div>';
    queueEl.appendChild(div);
    items.push({ el: div, file: f, statusEl: div.querySelector('.uq-status'), barEl: div.querySelector('.uq-bar-fill') });
  }

  updateSummary();

  function formatRate(bytesPerSec) {
    if (bytesPerSec < 1024) return bytesPerSec + ' B/s';
    var kb = bytesPerSec / 1024;
    if (kb < 1024) return kb.toFixed(1) + ' KB/s';
    var mb = kb / 1024;
    return mb.toFixed(2) + ' MB/s';
  }

  function updateFabBadge() {
    var badge = document.getElementById('uploadFabBadge');
    if (!badge) return;
    var pending = total - done - failed;
    if (pending > 0) {
      badge.textContent = pending;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  function updateSummary() {
    var pending = total - done - failed;
    summaryEl.style.display = 'block';
    var txt = t('upload.completedCount', { done: done, total: total });
    if (pending > 0) txt += t('upload.remaining', { remaining: pending });
    if (uploadState.currentRate > 0) txt += ' ' + formatRate(uploadState.currentRate);
    summaryEl.textContent = txt;
    updateFabBadge();
  }

  // 顺序上传
  var idx = 0;
  function uploadNext() {
    if (idx >= total) {
      summaryEl.textContent = t('upload.allDone', { n: total });
      showToast(t('upload.complete', { done: done, failed: failed }));
      loadRecentFiles();
      updateFabBadge();
      // 全部完成后清空 session 引用（DOM 保留供下次复用，进度显示为"全部完成"）
      setTimeout(function() { if (window._uploadSession) window._uploadSession = null; }, 3000);
      return;
    }
    items[idx].statusEl.textContent = t('upload.uploading');
    items[idx].statusEl.className = 'uq-status';
    uploadOne(items[idx], token, dir, uploadState, updateSummary, function(success) {
      if (success) { done++; } else { failed++; }
      idx++;
      updateSummary();
      uploadNext();
    });
  }
  uploadNext();
}

// 上传单个文件（先 upload 临时文件，再 upload.api 定稿到目标目录）
function uploadOne(item, token, dir, uploadState, updateSummaryFn, callback) {
  var file = item.file;

  var formData = new FormData();
  formData.append('file', file);

  var xhr = new XMLHttpRequest();
  xhr.open('POST', UPLOAD_URL, true);

  var lastLoaded = 0;
  var lastTime = Date.now();
  xhr.upload.onprogress = function(e) {
    if (e.lengthComputable) {
      var now = Date.now();
      var elapsed = (now - lastTime) / 1000;
      if (elapsed > 0) {
        var delta = e.loaded - lastLoaded;
        uploadState.currentRate = delta / elapsed;
        lastTime = now;
        lastLoaded = e.loaded;
      }
      var pct = Math.round((e.loaded / e.total) * 100);
      item.barEl.style.width = pct + '%';
      item.statusEl.textContent = pct + '%';
      updateSummaryFn();
    }
  };

  xhr.onload = function() {
    if (xhr.status !== 200) {
      item.statusEl.textContent = t('upload.httpError');
      item.statusEl.className = 'uq-status fail';
      item.barEl.className = 'uq-bar-fill fail';
      callback(false);
      return;
    }
    try {
      var res = JSON.parse(xhr.responseText);
    } catch(e) {
      item.statusEl.textContent = t('upload.parseError');
      item.statusEl.className = 'uq-status fail';
      item.barEl.className = 'uq-bar-fill fail';
      callback(false);
      return;
    }
    if (res.code !== 200) {
      item.statusEl.textContent = t(res && res.msg) || t('upload.failed');
      item.statusEl.className = 'uq-status fail';
      item.barEl.className = 'uq-bar-fill fail';
      callback(false);
      return;
    }
    var tempPath = res.data;
    // 第二步：定稿到目标目录（传 dir 参数；dir 为空时后端回退到根目录）
    item.statusEl.textContent = t('upload.processing');
    var params = 'tempPath=' + encodeURIComponent(tempPath) + '&filename=' + encodeURIComponent(file.name);
    if (dir) params += '&dir=' + encodeURIComponent(dir);
    var xhr2 = new XMLHttpRequest();
    xhr2.open('POST', API_BASE + 'upload.api', true);
    xhr2.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhr2.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr2.onload = function() {
      try {
        var text2 = xhr2.responseText;
        var jsonStart2 = text2.indexOf('{');
        if (jsonStart2 > 0) text2 = text2.substring(jsonStart2);
        var res2 = JSON.parse(text2);
      } catch(e) {
        item.statusEl.textContent = t('upload.processFailed');
        item.statusEl.className = 'uq-status fail';
        item.barEl.className = 'uq-bar-fill fail';
        callback(false);
        return;
      }
      if (xhr2.status !== 200 || res2.code !== 200) {
        item.statusEl.textContent = t(res2 && res2.msg) || t('upload.processFailed');
        item.statusEl.className = 'uq-status fail';
        item.barEl.className = 'uq-bar-fill fail';
        callback(false);
        return;
      }
      item.barEl.style.width = '100%';
      item.barEl.className = 'uq-bar-fill done';
      item.statusEl.textContent = t('upload.completed');
      item.statusEl.className = 'uq-status done';
      callback(true);
    };
    xhr2.onerror = function() {
      item.statusEl.textContent = t('upload.processFailed');
      item.statusEl.className = 'uq-status fail';
      item.barEl.className = 'uq-bar-fill fail';
      callback(false);
    };
    xhr2.send(params);
  };

  xhr.onerror = function() {
    item.statusEl.textContent = t('upload.networkError');
    item.statusEl.className = 'uq-status fail';
    item.barEl.className = 'uq-bar-fill fail';
    callback(false);
  };

  xhr.send(formData);
}

// 在指定上传区 DOM 内绑定 拖放/点击 事件（首页和上传对话框共用）
function bindUploadArea(areaEl, inputEl, onFiles) {
  if (!areaEl || !inputEl) return;
  areaEl.addEventListener('click', function(e) {
    if (e.target.closest('.upload-queue') || e.target.closest('.progress-wrap')) return;
    inputEl.click();
  });
  inputEl.addEventListener('change', function() {
    if (this.files.length > 0) onFiles(this.files, inputEl);
    inputEl.value = ''; // 允许重复选择同一文件
  });
  areaEl.addEventListener('dragover', function(e) {
    e.preventDefault();
    this.classList.add('dragover');
  });
  areaEl.addEventListener('dragleave', function(e) {
    e.preventDefault();
    this.classList.remove('dragover');
  });
  areaEl.addEventListener('drop', function(e) {
    e.preventDefault();
    this.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files, inputEl);
  });
}

// ===== 首页上传区 IIFE =====
(function() {
  var uploadArea = document.getElementById('uploadArea');
  var fileInput = document.getElementById('fileInput');
  if (!uploadArea || !fileInput) return;
  bindUploadArea(uploadArea, fileInput, function(files) {
    startUpload(files, ''); // 首页固定上传到根目录
  });
})();

// ===== 上传对话框 IIFE =====
(function() {
  var overlay = document.getElementById('uploadDialogOverlay');
  var area = document.getElementById('uploadDialogArea');
  var input = document.getElementById('uploadDialogFileInput');
  var hint = document.getElementById('uploadDialogHint');
  if (!overlay || !area || !input) return;

  bindUploadArea(area, input, function(files) {
    var dir = getUploadTargetDir();
    startUpload(files, dir);
  });

  // 渲染目标目录提示行
  window.renderUploadDialogHint = function() {
    if (!hint) return;
    var dir = getUploadTargetDir();
    if (dir) {
      var userRoot = '/up/' + getUsername() + '/';
      var rel = '';
      if (dir.indexOf(userRoot) === 0) rel = dir.substring(userRoot.length);
      hint.textContent = t('upload.dialog.dirHint', { path: rel || '/' });
      hint.style.display = 'block';
    } else {
      hint.textContent = t('upload.dialog.rootHint');
      hint.style.display = 'block';
    }
  };
})();

// ===== 上传对话框 显示/隐藏 切换（FAB 与对话框共用，显示/隐藏不中断进行中的上传） =====
function toggleUploadDialog(show) {
  var overlay = document.getElementById('uploadDialogOverlay');
  if (!overlay) return;
  if (!getToken()) {
    if (show !== false) { showToast(t('toast.pleaseLogin')); return; }
    overlay.style.display = 'none';
    return;
  }
  var shouldShow = show === undefined ? (overlay.style.display === 'none') : !!show;
  if (shouldShow) {
    renderUploadDialogHint();
    overlay.style.display = 'flex';
  } else {
    // 隐藏 ≠ 取消上传，xhr 继续后台进行
    overlay.style.display = 'none';
  }
}

// =================================================================
// Recent Files (shared helper)
// =================================================================
function loadRecentFiles() {
  var token = getToken();
  if (!token) return;
  postRequest('file_list.api', { token: token, recent: '1' }, function(err, res) {
    var container = document.getElementById('recentFiles');
    if (err || res.code !== 200 || !res.data) {
      container.innerHTML = '<div class="empty-state">' + t('files.loadFailed') + '</div>';
      return;
    }
    var files = res.data.files || [];
    // Sort by createTime descending, take top 3
    files.sort(function(a, b) { return (b.createTime || '').localeCompare(a.createTime || ''); });
    var recent = files.slice(0, 3);
    if (recent.length === 0) {
      container.innerHTML = '<div class="empty-state">' + t('recent.empty') + '</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < recent.length; i++) {
      var f = recent[i];
      html += '<div class="file-item">' +
        '<div class="file-icon file"><svg class="icon"><use href="#icon-file"/></svg></div>' +
        '<div class="file-info">' +
          '<div class="file-name">' + escHtml(f.name) + '</div>' +
          '<div class="file-meta">' + formatSize(f.size || 0) + ' &middot; ' + (f.createTime || '') + '</div>' +
        '</div>' +
      '</div>';
    }
    container.innerHTML = html;
  });
}

// =================================================================
// PAGE: FILES
// =================================================================
var _currentDir = '';
var _selectedFiles = new Set();
var _selectedFileNames = {};

function loadFileList(dir) {
  var token = getToken();
  if (!token) return;
  if (dir !== undefined) _currentDir = dir;

  // Clear selection when switching directories
  _selectedFiles.clear();
  _selectedFileNames = {};
  var batchRow = document.getElementById('batchActionsRow');
  if (batchRow) batchRow.style.display = 'none';
  var batchCountEl = document.getElementById('batchCount');
  if (batchCountEl) { batchCountEl.textContent = t('files.selectedNone'); batchCountEl.style.display = 'none'; }

  var container = document.getElementById('fileListContainer');
  container.innerHTML = '<div class="loading">' + t('files.loading') + '</div>';

  var params = { token: token };
  // 如果传入的是相对路径，转为绝对路径
  var dirPath = _currentDir;
  if (dirPath && dirPath.indexOf('/up/') !== 0) {
    dirPath = '/up/' + getUsername() + '/' + dirPath.replace(/^\//, '');
  }
  if (dirPath) params.dir = dirPath;

  postRequest('file_list.api', params, function(err, res) {
    if (err || res.code !== 200 || !res.data) {
      if (res && (res.msg === 'dir.notExist' || res.msg === '目录不存在')) {
        container.innerHTML = '<div class="empty-state">' + t('files.noFiles') + '</div>';
      } else {
        container.innerHTML = '<div class="empty-state">' + t('files.loadFailed') + '</div>';
      }
      return;
    }
    renderFileList(res.data);
  });
}

function renderFileList(data) {
  var container = document.getElementById('fileListContainer');
  var breadcrumb = document.getElementById('breadcrumb');

  var currentDir = data.currentDir || '/up/' + getUsername() + '/';
  var parentDir = data.parentDir || '';
  var username = getUsername();
  var basePrefix = '/up/' + username + '/';

  // 从 currentDir 中提取相对路径部分（不显示 /up/username/）
  var relPath = '';
  if (currentDir.indexOf(basePrefix) === 0) {
    relPath = currentDir.substring(basePrefix.length);
  }
  if (relPath.endsWith('/')) relPath = relPath.slice(0, -1);

  var parts = relPath ? relPath.split('/') : [];

  // 构建面包屑：根目录不显示完整路径
  var bcHtml = '<span class="crumb" onclick="goToDir(\'\')" data-i18n="files.root">' + t('files.root') + '</span>';
  var cum = '';
  for (var i = 0; i < parts.length; i++) {
    cum += (i > 0 ? '/' : '') + parts[i];
    if (i < parts.length - 1) {
      bcHtml += '<span class="sep">/</span><span class="crumb" onclick="goToDir(\'' + cum + '\')">' + escHtml(parts[i]) + '</span>';
    } else {
      bcHtml += '<span class="sep">/</span><span class="crumb">' + escHtml(parts[i]) + '</span>';
    }
  }
  breadcrumb.innerHTML = bcHtml;

  // Update back button state
  var backBtn = document.getElementById('goBackBtn');
  if (parentDir && parentDir.indexOf(basePrefix) === 0) {
    backBtn.style.display = 'inline-flex';
    var parentRel = parentDir.substring(basePrefix.length).replace(/\/$/, '');
    backBtn.onclick = function() { goToDir(parentRel); };
  } else {
    backBtn.style.display = 'none';
  }

  var dirs = data.dirs || [];
  var files = data.files || [];
  // 应用排序
  files = sortFiles(files, _fileSortBy, _fileSortOrder);
  var html = '';

  if (dirs.length === 0 && files.length === 0) {
    html += '<div class="empty-state" style="padding:20px;"><svg class="icon icon-lg" style="display:block;margin:0 auto 8px;"><use href="#icon-folder"/></svg> ' + t('files.empty') + '</div>';
    container.innerHTML = html;
    return;
  }

  // Directories
  for (var i = 0; i < dirs.length; i++) {
    var d = dirs[i];
    var dirRelPath = relPath ? (relPath + '/' + d.name) : d.name;
    html += '<div class="file-item" style="cursor:pointer;" onclick="goToDir(\'' + escAttr(dirRelPath) + '\')">' +
      '<div class="file-icon dir"><svg class="icon"><use href="#icon-folder"/></svg></div>' +
      '<div class="file-info">' +
        '<div class="file-name" title="' + escAttr(d.name) + '">' + escHtml(d.name) + '</div>' +
        '<div class="file-meta" data-i18n="files.dir">' + t('files.dir') + '</div>' +
      '</div>' +
      '<div class="dir-delete-btn">' +
        '<button class="btn btn-danger btn-sm" onclick="deleteDir(\'' + escAttr(dirRelPath) + '\', event)" data-i18n="files.delete">' + t('files.delete') + '</button>' +
      '</div>' +
    '</div>';
  }

  // Files
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var filePath = f.path || '';
    var fileUrl = f.url || filePath;
    var encodedUrl = encodeURI(fileUrl);
    var sel = _selectedFiles.has(filePath) ? ' selected' : '';
    var ext = (f.name || '').split('.').pop().toLowerCase();
    var isImg = ['jpg','jpeg','png','gif','bmp','webp','svg','ico','tiff','tif'].indexOf(ext) >= 0;
    var isAudio = ['mp3','wav','ogg','flac','aac','m4a','wma','opus'].indexOf(ext) >= 0;
    var isVideo = ['mp4','webm','mov','avi','mkv','flv','wmv','m4v','3gp'].indexOf(ext) >= 0;
    var isPdf = ext === 'pdf';
    var isOffice = ['docx','xlsx','pptx'].indexOf(ext) >= 0;
    var isText = ['txt','log','sha','ini','conf','cfg','md','json','xml','html','css','js'].indexOf(ext) >= 0;
    var nameCls = isImg ? 'file-name file-name-img' : (isAudio ? 'file-name file-name-audio' : (isVideo ? 'file-name file-name-video' : (isPdf ? 'file-name file-name-pdf' : (isOffice ? 'file-name file-name-office' : (isText ? 'file-name file-name-txt' : 'file-name')))));
    var clickHandler = '';
    if (isImg) {
      clickHandler = ' onclick="event.stopPropagation();showImagePreview(window.location.origin+\'' + escAttr(encodedUrl) + '\')"';
    } else if (isAudio) {
      var safeName = escHtml(f.name).replace(/'/g, '\\\'');
      clickHandler = ' onclick="event.stopPropagation();audioPlayerPlay(\'' + safeName + '\',window.location.origin+\'' + escAttr(encodedUrl) + '\')"';
    } else if (isVideo) {
      clickHandler = ' onclick="event.stopPropagation();showVideoPreview(window.location.origin+\'' + escAttr(encodedUrl) + '\')"';
    } else if (isPdf) {
      clickHandler = ' onclick="event.stopPropagation();showPdfPreview(window.location.origin+\'' + escAttr(encodedUrl) + '\')"';
    } else if (isOffice) {
      clickHandler = ' onclick="event.stopPropagation();showOfficePreview(window.location.origin+\'' + escAttr(encodedUrl) + '\')"';
    } else if (isText) {
      clickHandler = ' onclick="event.stopPropagation();showTxtPreview(window.location.origin+\'' + escAttr(encodedUrl) + '\',\'' + escAttr(f.name) + '\')"';
    }
    html += '<div class="file-item' + sel + '" data-path="' + escAttr(filePath) + '">' +
      '<div class="file-cb"><input type="checkbox" onchange="toggleFileSelect(\'' + escAttr(filePath) + '\', this)"></div>' +
      '<div class="file-icon file"><svg class="icon"><use href="#icon-file"/></svg></div>' +
      '<div class="file-info">' +
        '<div class="' + nameCls + '" title="' + escAttr(f.name) + '"' + clickHandler + '>' + escHtml(f.name) + '</div>' +
        '<div class="file-meta">' + formatSize(f.size || 0) + ' &middot; ' + (f.createTime || '') + '</div>' +
      '</div>' +
      '<div class="file-actions" id="fa-' + i + '">' +
        '<button class="btn btn-sm btn-outline" onclick="showCopyDialog(\'' + escAttr(filePath) + '\',\'' + escAttr(f.name) + '\')" data-i18n="files.copy">' + t('files.copy') + '</button>' +
        '<button class="btn btn-danger btn-sm" onclick="deleteFile(\'' + escAttr(filePath) + '\', event, \'' + escAttr(f.name) + '\')" data-i18n="files.delete">' + t('files.delete') + '</button>' +
        '<button class="btn btn-sm file-btn-blue" onclick="copyLink(\'' + escAttr(encodedUrl) + '\')" data-i18n="files.link">' + t('files.link') + '</button>' +
        '<a class="btn btn-sm file-btn-orange" href="javascript:void(0);" onclick="event.stopPropagation();downloadFile(\'' + escAttr(filePath) + '\',\'' + escAttr(f.name) + '\')" data-i18n="files.download">' + t('files.download') + '</a>' +
      '</div>' +
      '<button class="action-toggle" onclick="toggleFileActions(this,' + i + ')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg></button>' +
    '</div>';
  }
  container.innerHTML = html;

  // Show/hide select-all and restore checkbox states
  var selectAllLabel = document.getElementById('selectAllLabel');
  var selectAllCb = document.getElementById('selectAllCb');
  if (files.length > 0) {
    selectAllLabel.style.display = 'inline-flex';
    var allSelected = files.every(function(f) { return _selectedFiles.has(f.path); });
    selectAllCb.checked = allSelected;
  } else {
    selectAllLabel.style.display = 'none';
  }
  updateBatchBar();
}

function goToDir(dir) {
  _currentDir = dir;
  loadFileList(dir);
}

function onFileSortChange() {
  var sb = document.getElementById('fileSortBy');
  var so = document.getElementById('fileSortOrder');
  if (sb) _fileSortBy = sb.value;
  if (so) _fileSortOrder = so.value;
  loadFileList();
}

function onAdminSortChange() {
  var sb = document.getElementById('adminSortBy');
  var so = document.getElementById('adminSortOrder');
  if (sb) _adminSortBy = sb.value;
  if (so) _adminSortOrder = so.value;
  // 重新加载当前目录
  if (_adminTargetUser) loadAdminFileList();
}

function onShareSortChange() {
  var sb = document.getElementById('svSortBy');
  var so = document.getElementById('svSortOrder');
  if (sb) _shareSortBy = sb.value;
  if (so) _shareSortOrder = so.value;
  // 重新渲染当前文件列表
  var listEl = document.getElementById('svFileList');
  if (listEl && listEl._shareFiles) {
    renderShareFileList(listEl._shareFiles);
  }
}

function escHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== Image Preview & Audio Player =====

function showImagePreview(url) {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:600;display:flex;align-items:center;justify-content:center;';
  overlay.addEventListener('click', function(e) { if (e.target === this) overlay.remove(); });

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;display:inline-block;';

  var img = document.createElement('img');
  img.src = url;
  img.style.cssText = 'max-width:90vw;max-height:85vh;border-radius:8px;display:block;box-shadow:0 8px 30px rgba(0,0,0,0.3);';

  var closeBtn = document.createElement('span');
  closeBtn.onclick = function() { overlay.remove(); };
  closeBtn.style.cssText = 'position:absolute;top:-14px;right:-14px;z-index:10;width:32px;height:32px;border-radius:50%;background:#1f2937;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
  closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  var keyHandler = function(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', keyHandler); } };
  document.addEventListener('keydown', keyHandler);

  wrapper.appendChild(closeBtn);
  wrapper.appendChild(img);
  overlay.appendChild(wrapper);
  document.body.appendChild(overlay);
}

function showVideoPreview(url) {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:600;display:flex;align-items:center;justify-content:center;';

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;display:inline-block;border-radius:8px;';

  var video = document.createElement('video');
  video.controls = true;
  video.autoplay = true;
  video.src = url;
  video.style.cssText = 'max-width:90vw;max-height:85vh;border-radius:8px;display:block;box-shadow:0 8px 30px rgba(0,0,0,0.3);background:#000;';

  var closeBtn = document.createElement('span');
  closeBtn.onclick = function() { video.pause(); video.removeAttribute('src'); video.load(); overlay.remove(); };
  closeBtn.style.cssText = 'position:absolute;top:-14px;right:-14px;z-index:10;width:32px;height:32px;border-radius:50%;background:#1f2937;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
  closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  var keyHandler = function(e) { if (e.key === 'Escape') { video.pause(); video.removeAttribute('src'); video.load(); overlay.remove(); document.removeEventListener('keydown', keyHandler); } };
  document.addEventListener('keydown', keyHandler);
  overlay.addEventListener('click', function(e) { if (e.target === this) { video.pause(); video.removeAttribute('src'); video.load(); overlay.remove(); } });

  wrapper.appendChild(closeBtn);
  wrapper.appendChild(video);
  overlay.appendChild(wrapper);
  document.body.appendChild(overlay);
}

function showPdfPreview(url) {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:600;display:flex;align-items:center;justify-content:center;';

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;width:96vw;height:94vh;border-radius:8px;overflow:hidden;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,0.3);';

  var obj = document.createElement('object');
  obj.setAttribute('data', url);
  obj.setAttribute('type', 'application/pdf');
  obj.setAttribute('width', '100%');
  obj.setAttribute('height', '100%');
  obj.innerHTML = '<p style="text-align:center;padding:40px;">您的浏览器不支持PDF预览，请<a href="' + url + '" target="_blank">下载文件</a>。</p>';

  var closeBtn = document.createElement('span');
  closeBtn.onclick = function() { overlay.remove(); };
  closeBtn.style.cssText = 'position:absolute;top:8px;right:8px;z-index:10;width:32px;height:32px;border-radius:50%;background:#1f2937;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
  closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  var keyHandler = function(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', keyHandler); } };
  document.addEventListener('keydown', keyHandler);
  overlay.addEventListener('click', function(e) { if (e.target === this) overlay.remove(); });

  wrapper.appendChild(closeBtn);
  wrapper.appendChild(obj);
  overlay.appendChild(wrapper);
  document.body.appendChild(overlay);
}

function _createOfficeOverlay() {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:600;display:flex;align-items:center;justify-content:center;';
  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;width:96vw;height:94vh;border-radius:8px;overflow:hidden;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,0.3);';
  var closeBtn = document.createElement('span');
  closeBtn.onclick = function() { overlay.remove(); };
  closeBtn.style.cssText = 'position:absolute;top:8px;right:8px;z-index:10;width:32px;height:32px;border-radius:50%;background:#1f2937;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
  closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var keyHandler = function(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', keyHandler); } };
  document.addEventListener('keydown', keyHandler);
  overlay.addEventListener('click', function(e) { if (e.target === this) overlay.remove(); });
  wrapper.appendChild(closeBtn);
  overlay.appendChild(wrapper);
  document.body.appendChild(overlay);
  return { overlay: overlay, wrapper: wrapper };
}

function _createTxtOverlay(content, fileName) {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:600;display:flex;align-items:center;justify-content:center;';
  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;width:96vw;height:94vh;border-radius:8px;overflow:hidden;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,0.3);display:flex;flex-direction:column;';
  var closeBtn = document.createElement('span');
  closeBtn.onclick = function() { overlay.remove(); };
  closeBtn.style.cssText = 'position:absolute;top:8px;right:8px;z-index:10;width:32px;height:32px;border-radius:50%;background:#1f2937;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
  closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var keyHandler = function(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', keyHandler); } };
  document.addEventListener('keydown', keyHandler);
  overlay.addEventListener('click', function(e) { if (e.target === this) overlay.remove(); });

  var header = document.createElement('div');
  header.style.cssText = 'padding:12px 16px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:12px;background:#f9fafb;flex-shrink:0;';
  var fileNameSpan = document.createElement('span');
  fileNameSpan.style.cssText = 'font-size:14px;font-weight:500;color:#1f2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
  fileNameSpan.textContent = fileName || 'text file';
  header.appendChild(fileNameSpan);
  header.appendChild(closeBtn);

  var contentDiv = document.createElement('pre');
  contentDiv.style.cssText = 'flex:1;overflow:auto;padding:16px;margin:0;font-family:Consolas,"Courier New",monospace;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-all;color:#1f2937;background:#fafafa;';
  contentDiv.textContent = content;

  wrapper.appendChild(header);
  wrapper.appendChild(contentDiv);
  overlay.appendChild(wrapper);
  document.body.appendChild(overlay);
}

function showTxtPreview(url, fileName) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.responseType = 'arraybuffer';
  xhr.onload = function() {
    if (xhr.status === 200) {
      var buffer = xhr.response;
      var text = '';

      // 先尝试 UTF-8
      var decoder = new TextDecoder('utf-8', { fatal: false });
      text = decoder.decode(buffer);

      // 若包含替换字符 �，则改用 GBK 重新解码
      if (text.indexOf('\uFFFD') !== -1) {
        decoder = new TextDecoder('gbk');
        text = decoder.decode(buffer);
      }

      _createTxtOverlay(text, fileName || '');
    } else {
      showToast('Failed to read file');
    }
  };
  xhr.onerror = function() {
    showToast('Failed to read file');
  };
  xhr.send();
}

function _fetchArrayBuffer(url) {
  return new Promise(function(resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = function() { resolve(xhr.response); };
    xhr.onerror = function() { reject(new Error('File download failed')); };
    xhr.send();
  });
}

function _showDocxPreview(url) {
  var parts = _createOfficeOverlay();
  var wrapper = parts.wrapper;
  var container = document.createElement('div');
  var containerPadding = window.innerWidth <= 768 ? '8px' : '20px';
  container.style.cssText = 'width:100%;height:100%;overflow:auto;padding:' + containerPadding + ';box-sizing:border-box;background:#f5f5f5;';
  container.innerHTML = '<p style="text-align:center;padding:40px;color:#666;">Loading...</p>';
  wrapper.appendChild(container);
  _fetchArrayBuffer(url).then(function(buf) {
    container.innerHTML = '';
    if (window.mammoth) {
      var contentDiv = document.createElement('div');
      contentDiv.className = 'mammoth-content';
      container.appendChild(contentDiv);
      return window.mammoth.convertToHtml({arrayBuffer: buf}).then(function(result) {
        contentDiv.innerHTML = result.value;
      });
    } else {
      throw new Error('mammoth.js library not loaded.');
    }
  }).catch(function(err) {
    container.innerHTML = '<p style="text-align:center;padding:40px;color:#dc2626;">Error: ' + err.message + '</p>';
  });
}

function _showXlsxPreview(url) {
  var parts = _createOfficeOverlay();
  var wrapper = parts.wrapper;
  var container = document.createElement('div');
  container.style.cssText = 'width:100%;height:100%;overflow:auto;padding:16px;box-sizing:border-box;';
  container.innerHTML = '<p style="text-align:center;padding:40px;color:#666;">Loading...</p>';
  wrapper.appendChild(container);
  _fetchArrayBuffer(url).then(function(buf) {
    var wb = new ExcelJS.Workbook();
    return wb.xlsx.load(buf).then(function() {
      container.innerHTML = '';
      var tabNav = document.createElement('div');
      tabNav.className = 'xlsx-tab-nav';
      var tabBody = document.createElement('div');
      tabBody.className = 'xlsx-tab-body';
      wb.eachSheet(function(ws, idx) {
        var tab = document.createElement('button');
        tab.className = 'xlsx-tab-btn' + (idx === 1 ? ' active' : '');
        tab.textContent = ws.name;
        tab.onclick = function() {
          var btns = tabNav.querySelectorAll('.xlsx-tab-btn');
          for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
          tab.classList.add('active');
          var panels = tabBody.querySelectorAll('.xlsx-sheet-panel');
          for (var i = 0; i < panels.length; i++) panels[i].style.display = 'none';
          document.getElementById('xlsx-sheet-' + idx).style.display = 'block';
        };
        tabNav.appendChild(tab);
        var panel = document.createElement('div');
        panel.id = 'xlsx-sheet-' + idx;
        panel.className = 'xlsx-sheet-panel';
        if (idx !== 1) panel.style.display = 'none';
        var table = document.createElement('table');
        table.className = 'xlsx-table';
        ws.eachRow({ includeEmpty: false }, function(row, rowNumber) {
          var tr = document.createElement('tr');
          row.eachCell({ includeEmpty: true }, function(cell, colNumber) {
            var td = document.createElement(rowNumber === 1 ? 'th' : 'td');
            var val = cell.value;
            if (val !== null && val !== undefined && typeof val === 'object' && val.result !== undefined) val = val.result;
            td.textContent = val != null ? String(val) : '';
            if (cell.style && cell.style.font && cell.style.font.bold) td.style.fontWeight = 'bold';
            tr.appendChild(td);
          });
          table.appendChild(tr);
        });
        panel.appendChild(table);
        tabBody.appendChild(panel);
      });
      container.appendChild(tabNav);
      container.appendChild(tabBody);
    });
  }).catch(function(err) {
    container.innerHTML = '<p style="text-align:center;padding:40px;color:#dc2626;">Error: ' + err.message + '</p>';
  });
}

function _showPptxPreview(url) {
  var parts = _createOfficeOverlay();
  var wrapper = parts.wrapper;
  wrapper.style.background = '#1a1a2e';
  var container = document.createElement('div');
  container.style.cssText = 'width:100%;height:100%;overflow:auto;padding:20px;box-sizing:border-box;';
  container.innerHTML = '<p style="color:#aaa;text-align:center;padding:40px;">Loading...</p>';
  wrapper.appendChild(container);
  _fetchArrayBuffer(url).then(function(buf) {
    container.innerHTML = '';
    var slidesWrap = document.createElement('div');
    slidesWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:16px;';
    container.appendChild(slidesWrap);
    if (!window.createPPTXProcessor) throw new Error('PptxViewJS library not loaded.');
    var tempDiv = document.createElement('div');
    var processor = window.createPPTXProcessor({ container: tempDiv, data: buf });
    return processor.initialize().then(function() {
      return processor.loadFromArrayBuffer(buf);
    }).then(function() {
      var count = processor.getSlidesCount();
      var dims = processor.getSlideDimensions();
      var ratio = dims.cy / dims.cx;
      var canvasW = Math.min(Math.floor((window.innerWidth * 0.92 - 40)), 1200);
      var canvasH = Math.round(canvasW * ratio);
      if (canvasH > Math.floor(window.innerHeight * 0.85)) {
        canvasH = Math.floor(window.innerHeight * 0.85);
        canvasW = Math.round(canvasH / ratio);
      }
      var chain = Promise.resolve();
      for (var i = 0; i < count; i++) {
        (function(idx) {
          chain = chain.then(function() {
            var canvas = document.createElement('canvas');
            canvas.width = canvasW;
            canvas.height = canvasH;
            canvas.style.cssText = 'max-width:100%;box-shadow:0 2px 12px rgba(0,0,0,0.3);border-radius:4px;';
            slidesWrap.appendChild(canvas);
            return processor.renderSlide(canvas, idx);
          });
        })(i);
      }
      return chain;
    });
  }).catch(function(err) {
    container.innerHTML = '<p style="color:#f87171;text-align:center;padding:40px;">Error: ' + err.message + '</p>';
  });
}

function showOfficePreview(url) {
  var ext = (url.split('.').pop() || '').toLowerCase().split('?')[0];
  if (ext === 'docx') {
    _showDocxPreview(url);
  } else if (ext === 'xlsx') {
    _showXlsxPreview(url);
  } else if (ext === 'pptx') {
    _showPptxPreview(url);
  } else {
    window.open(url, '_blank');
  }
}

// ===== Floating Audio Player =====
var _audioCtx = {
  el: null, audio: null, playing: false,
  title: '', url: '', dragStartX: 0, dragStartY: 0,
  dragOrigX: 0, dragOrigY: 0, dragging: false,
  seeking: false, seekEnabled: true,
  playlist: [], playIndex: -1, playMode: 0, skip8: false,
  _skip8Timer: null
};
// playMode: 0=顺序, 1=随机, 2=单曲循环

// 播放模式图标: 0=顺序 ↻, 1=随机 🔀, 2=单曲循环 🔂
var _playModeIcons = [
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M3 4l17 17"/></svg>',
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><path d="M11 7v10l2-3"/></svg>'
];

// 初始化：创建单一音频元素，事件监听只绑定一次
(function() {
  var audio = new Audio();
  audio.loop = false; // 默认顺序播放，ended 触发切歌
  _audioCtx.audio = audio;

  // 从 localStorage 恢复播放模式和首尾跳过状态
  var savedMode = parseInt(localStorage.getItem('ap_playMode')) || 0;
  _audioCtx.playMode = savedMode;
  if (savedMode === 2) audio.loop = true;
  document.getElementById('apModeBtn').innerHTML = _playModeIcons[savedMode];

  _audioCtx.skip8 = localStorage.getItem('ap_skip8') === '1';
  document.getElementById('apSkip8Cb').checked = _audioCtx.skip8;

  var titleEl = document.getElementById('apTitle');
  var timeEl = document.getElementById('apTime');
  var fillEl = document.getElementById('apProgressFill');
  var playBtn = document.getElementById('apPlayBtn');
  var progressBar = document.getElementById('apProgressBar');

  // 音频事件
  audio.addEventListener('loadedmetadata', function() {
    timeEl.textContent = fmtAudioTime(audio.duration);
  });
  audio.addEventListener('timeupdate', function() {
    if (audio.duration) {
      fillEl.style.width = ((audio.currentTime / audio.duration) * 100) + '%';
      timeEl.textContent = fmtAudioTime(audio.currentTime) + ' / ' + fmtAudioTime(audio.duration);
    }
  });
  audio.addEventListener('ended', function() {
    // 非单曲循环模式：自动根据播放模式切下一首
    if (_audioCtx.playMode !== 2 && _audioCtx.playlist.length > 0) {
      _audioPlayNext();
      return;
    }
    // 单曲循环不触发 ended（audio.loop=true），不会到这里
  });

  // 进度条寻轨 — 使用 Pointer Events 统一鼠标和触摸
  function doSeek(clientX) {
    if (!_audioCtx.seekEnabled) return;
    if (!audio || !audio.duration || !isFinite(audio.duration)) return;
    var rect = progressBar.getBoundingClientRect();
    var pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    audio.currentTime = pct * audio.duration;
  }

  progressBar.addEventListener('pointerdown', function(e) {
    if (!_audioCtx.seekEnabled) { e.preventDefault(); return; }
    e.preventDefault();
    doSeek(e.clientX);
    _audioCtx.seeking = true;
    progressBar.setPointerCapture(e.pointerId);
  });
  progressBar.addEventListener('pointermove', function(e) {
    if (!_audioCtx.seeking) return;
    doSeek(e.clientX);
  });
  progressBar.addEventListener('pointerup', function(e) {
    _audioCtx.seeking = false;
    progressBar.releasePointerCapture(e.pointerId);
  });
  progressBar.addEventListener('pointercancel', function() {
    _audioCtx.seeking = false;
  });
})();

// 核心播放函数
function _audioDoPlay(title, url) {
  var timeEl = document.getElementById('apTime');
  var fillEl = document.getElementById('apProgressFill');
  var playBtn = document.getElementById('apPlayBtn');
  var audio = _audioCtx.audio;

  // 停止当前播放
  audio.pause();
  if (_audioCtx._skip8Timer) { clearTimeout(_audioCtx._skip8Timer); _audioCtx._skip8Timer = null; }

  _audioCtx.title = title;
  _audioCtx.url = url;
  _audioCtx.playing = true;
  _audioCtx.seekEnabled = true;

  document.getElementById('apTitle').textContent = title;
  playBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  fillEl.style.width = '0%';
  timeEl.textContent = '...';

  audio.src = url;
  audio.load();

  // 文件加载失败（如 404）时自动跳到下一首
  audio.addEventListener('error', function errorHandler() {
    audio.removeEventListener('error', errorHandler);
    // 播放列表模式下自动跳下一首
    if (_audioCtx.playlist.length > 1) {
      _audioPlayNext();
    }
  });

  // 首尾跳过8秒
  var shouldSkip8 = _audioCtx.skip8;
  audio.addEventListener('canplay', function skip8Handler() {
    if (shouldSkip8 && _audioCtx.skip8 && audio.duration > 16) {
      audio.currentTime = 8;
    }
    audio.removeEventListener('canplay', skip8Handler);
    shouldSkip8 = false;
  });

  audio.play().catch(function() {});
}

// 单曲播放入口
function audioPlayerPlay(title, url) {
  _audioCtx.playlist = [{ title: title, url: url }];
  _audioCtx.playIndex = 0;
  _audioDoPlay(title, url);
  _showPlayer();
}

// 自动播放下一首
function _audioPlayNext() {
  var list = _audioCtx.playlist;
  if (list.length === 0) return;
  var mode = _audioCtx.playMode;
  var idx = _audioCtx.playIndex;

  if (mode === 0) {
    // 顺序
    idx++;
    if (idx >= list.length) idx = 0;
  } else if (mode === 1) {
    // 随机
    var newIdx;
    do { newIdx = Math.floor(Math.random() * list.length); } while (newIdx === idx && list.length > 1);
    idx = newIdx;
  }
  // mode === 2: 单曲循环，依靠 audio.loop=true，不触发此函数

  _audioCtx.playIndex = idx;
  var item = list[idx];
  _audioDoPlay(item.title, item.url);
}

function audioPlayerPrev() {
  var list = _audioCtx.playlist;
  if (list.length === 0) return;
  var idx = _audioCtx.playIndex;
  idx--;
  if (idx < 0) idx = list.length - 1;
  _audioCtx.playIndex = idx;
  var item = list[idx];
  _audioDoPlay(item.title, item.url);
}

function audioPlayerNext() {
  var list = _audioCtx.playlist;
  if (list.length === 0) return;
  var idx = _audioCtx.playIndex;
  idx++;
  if (idx >= list.length) idx = 0;
  _audioCtx.playIndex = idx;
  var item = list[idx];
  _audioDoPlay(item.title, item.url);
}

function audioPlayerCycleMode() {
  _audioCtx.playMode = (_audioCtx.playMode + 1) % 3;
  localStorage.setItem('ap_playMode', _audioCtx.playMode);
  var audio = _audioCtx.audio;
  if (_audioCtx.playMode === 2) {
    audio.loop = true;
  } else {
    audio.loop = false;
  }
  document.getElementById('apModeBtn').innerHTML = _playModeIcons[_audioCtx.playMode];
}

function audioPlayerUpdateSkip8() {
  _audioCtx.skip8 = document.getElementById('apSkip8Cb').checked;
  localStorage.setItem('ap_skip8', _audioCtx.skip8 ? '1' : '0');
}

function _showPlayer() {
  var player = document.getElementById('audioPlayer');
  if (!player.style.left || player.style.left === 'auto') {
    // 默认位置：视口底部偏上，避免与悬浮分享/返回顶部按钮重叠
    var vw = window.innerWidth, vh = window.innerHeight;
    var pw = 360; // 播放器宽度
    player.style.left = Math.max(8, (vw - pw) / 2) + 'px';
    player.style.top = Math.max(8, vh - 260) + 'px';
  }
  player.style.display = 'block';
  document.getElementById('apMinimizedIcon').style.display = 'none';
}

// 处理"播放完毕"事件（首尾跳过8秒的结尾检测，以及非单曲循环的切歌）
(function() {
  var audio = _audioCtx.audio; // 尚未初始化，在下面回退
  // 延迟绑定，等 audio 初始化后再用
  setTimeout(function() {
    audio = _audioCtx.audio;
    if (!audio) return;
    var timeEl = document.getElementById('apTime');
    var fillEl = document.getElementById('apProgressFill');
    var playBtn = document.getElementById('apPlayBtn');

    audio.addEventListener('timeupdate', function() {
      if (!_audioCtx.skip8 || !audio.duration || audio.duration <= 16) return;
      var endThresh = audio.duration - 8;
      if (audio.currentTime >= endThresh) {
        // 尾8秒到达，结束或切下一首
        if (_audioCtx.playMode === 2 || _audioCtx.playlist.length <= 1 || _audioCtx.playIndex >= _audioCtx.playlist.length) {
          // 单曲循环或无播放列表：重新从8秒开始
          audio.currentTime = 8;
        } else {
          // 切下一首
          _audioPlayNext();
        }
      }
    });
  }, 100);
})();

function audioPlayerToggle() {
  if (!_audioCtx.audio) return;
  var btn = document.getElementById('apPlayBtn');
  if (_audioCtx.playing) {
    _audioCtx.audio.pause();
    _audioCtx.playing = false;
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  } else {
    _audioCtx.audio.play();
    _audioCtx.playing = true;
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  }
}

function audioPlayerStop() {
  if (!_audioCtx.audio) return;
  _audioCtx.audio.pause();
  _audioCtx.audio.currentTime = 0;
  _audioCtx.playing = false;
  document.getElementById('apPlayBtn').innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  document.getElementById('apProgressFill').style.width = '0%';
  document.getElementById('apTime').textContent = '0:00 / ' + fmtAudioTime(_audioCtx.audio.duration || 0);
  if (_audioCtx._skip8Timer) { clearTimeout(_audioCtx._skip8Timer); _audioCtx._skip8Timer = null; }
}

function audioPlayerClose() {
  audioPlayerStop();
  document.getElementById('audioPlayer').style.display = 'none';
  document.getElementById('apMinimizedIcon').style.display = 'none';
}

function audioPlayerMinimize() {
  document.getElementById('audioPlayer').style.display = 'none';
  var icon = document.getElementById('apMinimizedIcon');
  icon.style.display = 'flex';
  icon.style.bottom = '80px';
  icon.style.right = '84px';
  _audioCtx._minimized = true;
}

function audioPlayerRestore() {
  document.getElementById('apMinimizedIcon').style.display = 'none';
  _audioCtx._minimized = false;
  _showPlayer();
}

// Format seconds to m:ss
function fmtAudioTime(secs) {
  if (!secs || isNaN(secs)) return '0:00';
  var m = Math.floor(secs / 60);
  var s = Math.floor(secs % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

// Audio player drag (mouse + touch)
(function() {
  var header = document.getElementById('apHeader');
  var player = document.getElementById('audioPlayer');
  var icon = document.getElementById('apMinimizedIcon');

  function dragStart(clientX, clientY, e) {
    if (e && e.target && e.target.closest && e.target.closest('.ap-close, .ap-minimize')) return;
    _audioCtx.dragging = true;
    _audioCtx.dragStartX = clientX;
    _audioCtx.dragStartY = clientY;
    if (player.style.display === 'block') {
      _audioCtx.dragOrigX = parseInt(player.style.left) || 0;
      _audioCtx.dragOrigY = parseInt(player.style.top) || 0;
    } else {
      _audioCtx.dragOrigX = parseInt(icon.style.right) || 16;
      _audioCtx.dragOrigY = parseInt(icon.style.bottom) || 64;
    }
    if (e) e.preventDefault();
  }
  function dragMove(clientX, clientY) {
    if (!_audioCtx.dragging) return;
    var dx = clientX - _audioCtx.dragStartX;
    var dy = clientY - _audioCtx.dragStartY;
    if (player.style.display === 'block') {
      player.style.left = (_audioCtx.dragOrigX + dx) + 'px';
      player.style.top = (_audioCtx.dragOrigY + dy) + 'px';
    } else {
      icon.style.right = (_audioCtx.dragOrigX - dx) + 'px';
      icon.style.bottom = (_audioCtx.dragOrigY - dy) + 'px';
    }
  }
  function dragEnd() {
    _audioCtx.dragging = false;
  }

  // Mouse events
  header.addEventListener('mousedown', function(e) { dragStart(e.clientX, e.clientY, e); });
  icon.addEventListener('mousedown', function(e) { dragStart(e.clientX, e.clientY, e); });
  document.addEventListener('mousemove', function(e) { dragMove(e.clientX, e.clientY); });
  document.addEventListener('mouseup', dragEnd);

  // Touch events
  header.addEventListener('touchstart', function(e) {
    var t = e.touches[0];
    dragStart(t.clientX, t.clientY, e);
  }, { passive: false });
  icon.addEventListener('touchstart', function(e) {
    var t = e.touches[0];
    _audioCtx.dragging = true;
    _audioCtx.dragStartX = t.clientX;
    _audioCtx.dragStartY = t.clientY;
    _audioCtx.dragOrigX = parseInt(icon.style.right) || 16;
    _audioCtx.dragOrigY = parseInt(icon.style.bottom) || 64;
  }, { passive: true });
  document.addEventListener('touchmove', function(e) {
    var t = e.touches[0];
    dragMove(t.clientX, t.clientY);
  }, { passive: false });
  document.addEventListener('touchend', dragEnd);

  // Progress bar seek — assign click handler inside audioPlayerPlay
  // (see audioPlayerPlay for the onclick binding)
})();

// ===== File Operations =====
function deleteFile(path, e, fileName) {
  if (e) e.stopPropagation();
  var msg = fileName ? t('dialog.confirmDeleteFile') + '\n' + fileName : t('dialog.confirmDeleteFile');
  showConfirmDialog(msg, function() {
    var token = getToken();
    postRequest('file_delete.api', { token: token, path: path }, function(err, res) {
      if (err || res.code !== 200) { showToast(t(res && res.msg) || t('toast.deleteFailed')); return; }
      showToast(t('toast.deleteSuccess'));
      loadFileList();
      loadRecentFiles();
    });
  });
}

function deleteDir(dirRelPath, e) {
  if (e) e.stopPropagation();
  showConfirmDialog(t('dialog.confirmDeleteDir'), function() {
    var token = getToken();
    var username = getUsername();
    var fullPath = '/up/' + username + '/' + dirRelPath;
    if (!fullPath.endsWith('/')) fullPath += '/';
    postRequest('dir_delete.api', { token: token, dirPath: fullPath }, function(err, res) {
      if (err || res.code !== 200) { showToast(t(res && res.msg) || t('toast.deleteFailed')); return; }
      showToast(t('toast.dirDeleteSuccess'));
      loadFileList();
    });
  });
}

// ===== Batch Operations =====
function toggleFileActions(btn, idx) {
  var actions = document.getElementById('fa-' + idx);
  if (!actions) return;
  var isOpen = actions.classList.contains('show');
  // close all other open actions
  document.querySelectorAll('.file-actions.show').forEach(function(el) { el.classList.remove('show'); });
  document.querySelectorAll('.action-toggle.open').forEach(function(el) { el.classList.remove('open'); });
  if (!isOpen) {
    actions.classList.add('show');
    btn.classList.add('open');
  }
}

function toggleUserActions(btn, idx) {
  var actions = document.getElementById('ua-' + idx);
  if (!actions) return;
  var isOpen = actions.classList.contains('show');
  document.querySelectorAll('.user-actions.show').forEach(function(el) { el.classList.remove('show'); });
  document.querySelectorAll('.user-item .action-toggle.open').forEach(function(el) { el.classList.remove('open'); });
  if (!isOpen) {
    actions.classList.add('show');
    btn.classList.add('open');
  }
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('.file-actions') && !e.target.closest('.user-actions') && !e.target.closest('.action-toggle')) {
    document.querySelectorAll('.file-actions.show').forEach(function(el) { el.classList.remove('show'); });
    document.querySelectorAll('.user-actions.show').forEach(function(el) { el.classList.remove('show'); });
    document.querySelectorAll('.action-toggle.open').forEach(function(el) { el.classList.remove('open'); });
  }
});

function toggleFileSelect(path, cb) {
  if (cb.checked) {
    _selectedFiles.add(path);
    // Get display name from the .file-name element in the same row
    var item = cb.closest('.file-item');
    if (item) {
      var nameEl = item.querySelector('.file-name');
      if (nameEl) _selectedFileNames[path] = nameEl.textContent.trim();
    }
  } else {
    _selectedFiles.delete(path);
    delete _selectedFileNames[path];
  }
  // Update item highlight
  var items = document.querySelectorAll('#fileListContainer .file-item');
  items.forEach(function(el) {
    if (el.getAttribute('data-path') === path) {
      if (cb.checked) el.classList.add('selected');
      else el.classList.remove('selected');
    }
  });
  updateBatchBar();
}

function toggleSelectAll() {
  var cb = document.getElementById('selectAllCb');
  var checked = cb.checked;
  var items = document.querySelectorAll('#fileListContainer .file-item');
  items.forEach(function(el) {
    var p = el.getAttribute('data-path');
    if (!p) return;
    var chk = el.querySelector('.file-cb input');
    if (chk) chk.checked = checked;
    if (checked) {
      _selectedFiles.add(p);
      var nameEl = el.querySelector('.file-name');
      if (nameEl) _selectedFileNames[p] = nameEl.textContent.trim();
      el.classList.add('selected');
    } else {
      _selectedFiles.delete(p);
      delete _selectedFileNames[p];
      el.classList.remove('selected');
    }
  });
  updateBatchBar();
}

function updateBatchBar() {
  var count = _selectedFiles.size;
  var row = document.getElementById('batchActionsRow');
  var el = document.getElementById('batchCount');
  if (!row) return;
  if (count > 0) {
    row.style.display = 'flex';
    if (el) { el.textContent = t('files.selected', { n: count }); el.style.display = 'inline'; }
  } else {
    row.style.display = 'none';
    if (el) { el.textContent = t('files.selectedNone'); el.style.display = 'none'; }
  }
  // 仅当勾选中包含音乐或视频文件时显示播放按钮
  var playBtn = document.getElementById('batchPlayBtn');
  if (playBtn) playBtn.style.display = hasMediaSelected(_selectedFiles) ? '' : 'none';
}

// 检查所选文件集合中是否包含音乐或视频文件
function hasMediaSelected(selectedSet) {
  var mediaExts = ['mp3','wav','ogg','flac','aac','m4a','wma','opus','mp4','webm','mov','avi','mkv','flv','wmv','m4v','3gp'];
  var found = false;
  selectedSet.forEach(function(p) {
    var ext = (p.split('.').pop() || '').toLowerCase();
    if (mediaExts.indexOf(ext) >= 0) found = true;
  });
  return found;
}

function batchDelete() {
  var paths = Array.from(_selectedFiles);
  if (paths.length === 0) return;
  showConfirmDialog(t('dialog.confirmBatchDelete', { n: paths.length }), function() {
    var token = getToken();
    var done = 0, total = paths.length;
    paths.forEach(function(p) {
      postRequest('file_delete.api', { token: token, path: p }, function(err, res) {
        done++;
        if (done === total) {
          _selectedFiles.clear();
          showToast(t('toast.deleteCompleted'));
          loadFileList();
          loadRecentFiles();
        }
      });
    });
  });
}

function batchCopy() {
  var paths = Array.from(_selectedFiles);
  if (paths.length === 0) return;
  var token = getToken();
  var username = getUsername();
  var basePrefix = '/up/' + username + '/';
  var fileList = paths.map(function(p) { return _selectedFileNames[p] || p.replace(basePrefix, ''); }).join(', ');
  var html = '<div class="dialog-title"><svg class="icon" style="vertical-align:middle;margin-right:4px;"><use href="#icon-clipboard"/></svg> ' + t('files.batchCopy') + '</div>';
  html += '<div style="margin-bottom:12px;font-size:13px;color:#666;">' + t('files.batchCopyDesc', { n: paths.length, files: escHtml(fileList) }) + '</div>';
  html += '<div class="form-group"><label>' + t('files.selectTarget') + '</label><div class="dir-tree" id="batchDirTree">';
  html += '<div class="loading" style="padding:12px;text-align:center;font-size:13px;color:#999;">' + t('files.loading') + '...</div>';
  html += '</div></div>';
  html += '<input type="hidden" id="batchCopyTargetDir" value="">';
  html += '<div class="dialog-actions">' +
    '<button class="btn btn-outline" onclick="closeDialog()" data-i18n="btn.cancel">' + t('btn.cancel') + '</button>' +
    '<button class="btn btn-primary" id="batchCopyBtn" disabled onclick="doBatchCopy()" data-i18n="files.copy">' + t('files.copy') + '</button>' +
  '</div>';
  showDialog(html);

  // Load dir tree
  postRequest('dir_tree.api', { token: token }, function(err, res) {
    var treeEl = document.getElementById('batchDirTree');
    if (err || res.code !== 200) {
      treeEl.innerHTML = '<div style="padding:12px;font-size:13px;color:#999;">' + t('files.loadFailed') + '</div>';
      return;
    }
    var dirs = res.data || [];
    var treeHtml = '<div class="dir-tree-item selected" data-path="" onclick="selectBatchDir(this, \'\')" data-i18n="files.rootDir">' + t('files.rootDir') + '</div>';
    for (var i = 0; i < dirs.length; i++) {
      var indent = (dirs[i].relPath.match(/\//g) || []).length;
      var padding = (indent + 1) * 20;
      treeHtml += '<div class="dir-tree-item" data-path="' + escAttr(dirs[i].relPath) + '" onclick="selectBatchDir(this, \'' + escAttr(dirs[i].relPath) + '\')" style="padding-left:' + padding + 'px;">' + escHtml(dirs[i].relPath) + '</div>';
    }
    treeEl.innerHTML = treeHtml;
  });
}

function selectBatchDir(el, path) {
  document.querySelectorAll('#batchDirTree .dir-tree-item').forEach(function(e) { e.classList.remove('selected'); });
  if (el) el.classList.add('selected');
  document.getElementById('batchCopyTargetDir').value = path;
  document.getElementById('batchCopyBtn').disabled = false;
}

function doBatchCopy() {
  var targetDir = document.getElementById('batchCopyTargetDir').value;
  var token = getToken();
  var username = getUsername();
  var fullTarget = targetDir;
  if (fullTarget && fullTarget.indexOf('/up/') !== 0) {
    fullTarget = '/up/' + username + '/' + fullTarget;
  } else if (!fullTarget) {
    fullTarget = '/up/' + username + '/';
  }
  fullTarget = fullTarget.replace(/\/$/, '') + '/';
  var paths = Array.from(_selectedFiles);
  closeDialog();
  showToast(t('upload.copying', { n: paths.length }));
  var done = 0, total = paths.length;
  paths.forEach(function(p) {
    var copyBody = urlEncodeParam('path', p) + '&' + urlEncodeParam('targetDir', fullTarget) + '&' + urlEncodeParam('originalName', _selectedFileNames[p] || '');
    var xhrCopy = new XMLHttpRequest();
    xhrCopy.open('POST', API_BASE + 'file_copy.api', true);
    xhrCopy.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhrCopy.setRequestHeader('Authorization', 'Bearer ' + token);
    xhrCopy.onload = function() {
      done++;
      if (done === total) {
        showToast(t('upload.copyDone', { n: done }));
        loadFileList();
      }
    };
    xhrCopy.onerror = function() {
      done++;
      if (done === total) {
        showToast(t('upload.copyDone', { n: done }));
        loadFileList();
      }
    };
    xhrCopy.send(copyBody);
  });
}

function batchPlay() {
  var paths = Array.from(_selectedFiles);
  if (paths.length === 0) return;
  var audioExts = ['mp3','wav','ogg','flac','aac','m4a','wma','opus'];
  var videoExts = ['mp4','webm','mov','avi','mkv','flv','wmv','m4v','3gp'];
  var playlist = [];
  var videoList = [];
  for (var i = 0; i < paths.length; i++) {
    var ext = paths[i].split('.').pop().toLowerCase();
    var name = _selectedFileNames[paths[i]] || paths[i].split('/').pop();
    var url = window.location.origin + encodeURI(paths[i]);
    if (audioExts.indexOf(ext) >= 0) {
      playlist.push({ title: name, url: url });
    } else if (videoExts.indexOf(ext) >= 0) {
      videoList.push({ title: name, url: url });
    }
  }
  // 有音乐文件时只添加音乐文件并打开音乐播放器
  if (playlist.length > 0) {
    _audioCtx.playlist = playlist;
    _audioCtx.playIndex = 0;
    if (_audioCtx.playMode !== 2) _audioCtx.audio.loop = false;
    _audioDoPlay(playlist[0].title, playlist[0].url);
    _showPlayer();
  } else if (videoList.length > 0) {
    // 只有视频文件没有音乐文件时，打开视频播放器
    showVideoPreview(videoList[0].url);
  } else {
    showToast(t('files.noAudioSelected'));
  }
}

// 批量下载：利用 setTimeout 间隔2秒为勾选的文件创建带 download 的 a 链接并激活下载，避免浏览器多文件下载授权提示
function batchDownload() {
  var paths = Array.from(_selectedFiles);
  if (paths.length === 0) return;
  showToast(t('files.batchDownloadStart', { n: paths.length }));
  var i = 0;
  function downloadNext() {
    if (i >= paths.length) return;
    var p = paths[i];
    var name = _selectedFileNames[p] || p.split('/').pop();
    var a = document.createElement('a');
    a.href = window.location.origin + encodeURI(p);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    i++;
    if (i < paths.length) {
      setTimeout(downloadNext, 2000);
    }
  }
  downloadNext();
}

// 单文件下载
function downloadFile(filePath, fileName) {
  showToast(t('files.batchDownloadStart', { n: 1 }));
  var a = document.createElement('a');
  // 如果 filePath 已经是完整URL（分享页面传入），直接使用；否则拼 origin
  if (filePath.indexOf('http://') === 0 || filePath.indexOf('https://') === 0) {
    a.href = filePath;
  } else {
    a.href = window.location.origin + encodeURI(filePath);
  }
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ===== Share Feature =====
var _shareFiles = []; // { file: originalName, url: realPath } - 待分享文件缓存

function genSharePwd() {
  var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  var s = '';
  for (var i = 0; i < 5; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

// 打开分享创建对话框（显示当前缓存的待分享文件）
function openShareDialog() {
  if (!getToken()) { showToast(t('toast.pleaseLogin')); return; }
  showShareDialog();
}

// 将文件添加到分享缓存（去重）
function addFilesToShareQueue(files) {
  if (!files || files.length === 0) return 0;
  var added = 0;
  var existingUrls = {};
  for (var i = 0; i < _shareFiles.length; i++) existingUrls[_shareFiles[i].url] = true;
  for (var j = 0; j < files.length; j++) {
    var f = files[j];
    if (!f || !f.url) continue;
    if (existingUrls[f.url]) continue;
    _shareFiles.push({ file: f.file || f.url.split('/').pop(), url: f.url });
    existingUrls[f.url] = true;
    added++;
  }
  updateShareFabBadge();
  return added;
}

// 移除分享缓存中的某个文件
function removeShareFile(idx) {
  _shareFiles.splice(idx, 1);
  if (typeof renderShareFiles === 'function') renderShareFiles();
  updateShareFabBadge();
}

// 清空分享缓存
function clearShareQueue() {
  _shareFiles = [];
  updateShareFabBadge();
}

// 更新悬浮分享按钮上的数字徽章
function updateShareFabBadge() {
  var fab = document.getElementById('shareFab');
  if (!fab) return;
  // 查找或创建徽章元素
  var badge = fab.querySelector('.share-fab-badge');
  var count = _shareFiles.length;
  if (count === 0) {
    if (badge) badge.remove();
    fab.classList.remove('has-badge');
    return;
  }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'share-fab-badge';
    fab.appendChild(badge);
  }
  badge.textContent = count > 99 ? '99+' : String(count);
  fab.classList.add('has-badge');
}

function showShareDialog() {
  if (_dialogOverlay) { _dialogOverlay.remove(); _dialogOverlay = null; }
  var overlay = document.createElement('div');
  overlay.className = 'share-dialog-overlay';
  var pwd = genSharePwd();
  var today = new Date();
  var dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  overlay.innerHTML =
    '<div class="share-dialog">' +
      '<div class="share-dialog-header">' +
        '<div class="share-dialog-title">' + t('share.createTitle') + '</div>' +
        '<span class="share-dialog-close" onclick="closeShareDialog()"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>' +
      '</div>' +
      '<div class="share-dialog-body">' +
        '<div class="share-field"><label>' + t('share.title') + '</label><input class="share-input" id="shareTitleInput" value="' + escAttr(t('share.defaultTitlePrefix') + ' ' + dateStr) + '"></div>' +
        '<div class="share-field"><label>' + t('share.pwd') + '</label><input class="share-input share-pwd" id="sharePwdInput" value="' + pwd + '" readonly></div>' +
        '<div class="share-field">' +
          '<div class="share-files-label-row">' +
            '<label>' + t('share.files') + ' (' + _shareFiles.length + ')</label>' +
            '<span class="share-clear-all" onclick="clearShareQueue();renderShareFiles();" data-i18n="share.clearAll">' + t('share.clearAll') + '</span>' +
          '</div>' +
          '<div class="share-files" id="shareFilesList"></div>' +
        '</div>' +
      '</div>' +
      '<div class="share-dialog-footer">' +
        '<button class="btn btn-outline btn-sm" onclick="closeShareDialog()">' + t('dialog.cancel') + '</button>' +
        '<button class="btn btn-primary btn-sm" onclick="confirmShare()">' + t('share.confirm') + '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  _dialogOverlay = overlay;
  renderShareFiles();
}

function closeShareDialog() {
  if (_dialogOverlay) { _dialogOverlay.remove(); _dialogOverlay = null; }
}

function renderShareFiles() {
  var c = document.getElementById('shareFilesList');
  if (!c) return;
  if (_shareFiles.length === 0) {
    c.innerHTML = '<div class="share-empty">' + t('share.emptyHint') + '</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < _shareFiles.length; i++) {
    var f = _shareFiles[i];
    html += '<div class="share-file-item">' +
      '<svg class="icon" style="flex-shrink:0;color:#6b7280;"><use href="#icon-file"/></svg>' +
      '<span class="share-file-name">' + escHtml(f.file) + '</span>' +
      '<span class="share-file-remove" onclick="removeShareFile(' + i + ')">' + t('dialog.delete') + '</span>' +
    '</div>';
  }
  c.innerHTML = html;
}

function batchShare() {
  var paths = Array.from(_selectedFiles);
  if (paths.length === 0) { showToast(t('files.pleaseSelect')); return; }
  if (!getToken()) { showToast(t('toast.pleaseLogin')); return; }
  var filesToAdd = [];
  for (var i = 0; i < paths.length; i++) {
    var p = paths[i];
    var name = _selectedFileNames[p] || p.split('/').pop();
    var url;
    if (p.indexOf('/up/') === 0) {
      // 路径已经包含 /up/ 前缀
      url = p;
    } else if (p.indexOf('/') === 0) {
      // 路径以 / 开头但不是 /up/，需要补全
      url = '/up/' + getUsername() + p;
    } else {
      // 相对路径
      url = '/up/' + getUsername() + '/' + p;
    }
    filesToAdd.push({ file: name, url: url });
  }
  var added = addFilesToShareQueue(filesToAdd);
  if (added > 0) {
    showToast(t('share.addedToQueue', { n: added }));
  } else {
    showToast(t('share.allInQueue'));
  }
}

function confirmShare() {
  if (!getToken()) { showToast(t('toast.pleaseLogin')); return; }
  if (_shareFiles.length === 0) { showToast(t('share.needFiles')); return; }
  var titleEl = document.getElementById('shareTitleInput');
  var pwdEl = document.getElementById('sharePwdInput');
  var title = titleEl ? titleEl.value.trim() : '';
  var pwd = pwdEl ? pwdEl.value.trim() : '';
  if (!title) { showToast(t('share.needTitle')); return; }
  if (!/^[a-z0-9]{5}$/.test(pwd)) { showToast(t('share.pwdInvalid')); return; }
  // 保存当前文件列表（请求异步，避免回调时已被清空）
  var filesToCreate = _shareFiles.slice();
  postRequest('share_create.api', {
    token: getToken(),
    title: title,
    password: pwd,
    files: JSON.stringify(filesToCreate)
  }, function(err, res) {
    if (err || res.code !== 200) { showToast(t(res && res.msg) || t('share.createFailed')); return; }
    var shareIdStr = encodeBase62(res.shareId);
    var url = window.location.origin + window.location.pathname + '?s=' + shareIdStr;
    var urlWithPwd = url + '&p=' + pwd;
    var resultHtml =
      '<div class="dialog-title">' + t('share.created') + '</div>' +
      '<div class="form-group"><label>' + t('share.title') + '</label><div>' + escHtml(title) + '</div></div>' +
      '<div class="form-group"><label>' + t('share.pwd') + '</label><div style="letter-spacing:4px;font-family:monospace;font-size:18px;color:#22c55e;">' + escHtml(pwd) + '</div></div>' +
      '<div class="form-group"><label>' + t('share.url') + '</label><div style="word-break:break-all;user-select:all;font-family:monospace;font-size:14px;color:#3b82f6;">' + escHtml(url) + '</div></div>' +
      '<div class="flex gap-8 mt-12">' +
        '<button class="btn btn-primary btn-block" id="shareCopyUrlBtn">' + t('share.copyUrl') + '</button>' +
      '</div>';
    closeShareDialog();
    // 创建成功后清空缓存
    clearShareQueue();
    showDialog(resultHtml);
    var copyBtn = document.getElementById('shareCopyUrlBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        copyText(urlWithPwd);
        showToast(t('toast.copySuccess'));
      });
    }
    if (typeof loadMyShares === 'function') loadMyShares();
  });
}

function copyText(s) {
  var inp = document.createElement('input');
  inp.value = s;
  document.body.appendChild(inp);
  inp.select();
  try { document.execCommand('copy'); } catch(e) {}
  document.body.removeChild(inp);
}

// Event delegation for data-copy buttons (share copy url/pwd)
document.addEventListener('click', function(e) {
  var btn = e.target.closest('[data-copy]');
  if (btn) {
    copyText(btn.getAttribute('data-copy'));
    showToast(t(btn.getAttribute('data-toast') || 'toast.copySuccess'));
  }
});

function loadMyShares() {
  var c = document.getElementById('mySharesList');
  if (!c) return;
  if (!getToken()) { c.innerHTML = '<div class="empty-state">' + t('share.empty') + '</div>'; return; }
  postRequest('share_my_list.api', { token: getToken() }, function(err, res) {
    if (err || res.code !== 200 || !res.data || res.data.length === 0) {
      c.innerHTML = '<div class="empty-state">' + t('share.empty') + '</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < res.data.length; i++) {
      var s = res.data[i];
      var shortId = encodeBase62(s.FShareID);
      var url = window.location.origin + window.location.pathname + '?s=' + shortId;
      var urlWithPwd = url + '&p=' + s.FPassword;
      html += '<div class="share-item">' +
        '<div class="share-item-title"><a href="' + escAttr(urlWithPwd) + '" target="_blank" rel="noopener noreferrer">' + escHtml(s.FTitle) + '</a></div>' +
        '<div class="share-item-meta">' + t('share.fileCount', { n: s.FFilesCount }) + ' &middot; ' + escHtml(s.FCreateTime || '') + '</div>' +
        '<div class="share-item-actions">' +
          '<button class="share-action-btn share-btn-pwd" data-copy="' + escAttr(s.FPassword) + '" data-toast="toast.copyPwdSuccess">' + t('share.copyPwd') + '</button>' +
          '<button class="share-action-btn share-btn-link" data-copy="' + escAttr(urlWithPwd) + '" data-toast="toast.copySuccess">' + t('share.copyUrl') + '</button>' +
          '<button class="share-action-btn share-btn-del" onclick="deleteShare(\'' + s.FShareID + '\', \'' + escAttr(s.FTitle) + '\', false)">' + t('dialog.delete') + '</button>' +
        '</div>' +
      '</div>';
    }
    c.innerHTML = html;
  });
}

function deleteShare(shareId, title, isAdmin) {
  showConfirmDialog(t('share.confirmDeleteTitle', { title: title || '' }), function() {
    postRequest('share_delete.api', { token: getToken(), shareId: shareId }, function(err, res) {
      if (err || res.code !== 200) { showToast(t(res && res.msg) || t('toast.deleteFailed')); return; }
      showToast(t('toast.deleteSuccess'));
      if (isAdmin) loadAdminShares(); else loadMyShares();
    });
  });
}

function loadAdminShares() {
  var c = document.getElementById('adminShareList');
  if (!c) return;
  c.innerHTML = '<div class="loading">' + t('files.loading') + '</div>';
  postRequest('share_admin_list.api', { token: getToken() }, function(err, res) {
    if (err || res.code !== 200 || !res.data) {
      c.innerHTML = '<div class="empty-state">' + t('admin.loadFailed') + '</div>';
      return;
    }
    if (res.data.length === 0) {
      c.innerHTML = '<div class="empty-state">' + t('share.empty') + '</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < res.data.length; i++) {
      var s = res.data[i];
      var shortId = encodeBase62(s.FShareID);
      var url = window.location.origin + window.location.pathname + '?s=' + shortId;
      var urlWithPwd = url + '&p=' + s.FPassword;
      html += '<div class="share-item">' +
        '<div class="share-item-title"><a href="' + escAttr(urlWithPwd) + '" target="_blank" rel="noopener noreferrer">' + escHtml(s.FTitle) + '</a> <span style="color:#6b7280;font-weight:400;">@' + escHtml(s.FNickname) + ' (' + escHtml(s.FUsername) + ')</span></div>' +
        '<div class="share-item-meta">' + t('share.fileCount', { n: s.FFilesCount }) + ' &middot; ' + escHtml(s.FCreateTime || '') + ' &middot; <span style="color:#22c55e;">' + escHtml(s.FPassword) + '</span></div>' +
        '<div class="share-item-actions">' +
          '<button class="share-action-btn share-btn-link" data-copy="' + escAttr(urlWithPwd) + '" data-toast="toast.copySuccess">' + t('share.copyUrl') + '</button>' +
          '<button class="share-action-btn share-btn-del" onclick="deleteShare(\'' + s.FShareID + '\', \'' + escAttr(s.FTitle) + '\', true)">' + t('dialog.delete') + '</button>' +
        '</div>' +
      '</div>';
    }
    c.innerHTML = html;
  });
}

function openShareViewPage(shortId) {
  // Hide app container, show share view page
  var appEl = document.getElementById('app');
  if (appEl) appEl.style.display = 'none';
  var fab = document.getElementById('shareFab');
  if (fab) fab.style.display = 'none';
  var btt = document.getElementById('backToTop');
  if (btt) btt.style.display = 'none';
  var batchRowEl = document.getElementById('batchActionsRow');
  if (batchRowEl) batchRowEl.style.display = 'none';
  var adminBatchRowEl = document.getElementById('adminBatchActionsRow');
  if (adminBatchRowEl) adminBatchRowEl.style.display = 'none';
  var svp = document.getElementById('shareViewPage');
  if (svp) svp.style.display = 'block';
  // 分享页未解锁时隐藏流量指示器
  var st = document.getElementById('shareTrafficIndicator');
  if (st) st.style.display = 'none';

  // Verify share exists
  postRequest('share_view.api', { shareId: decodeBase62(shortId).toString(), password: '__check__' }, function(err, res) {
    var titleEl = document.getElementById('svTitle');
    var metaEl = document.getElementById('svMeta');
    if (err || res.code === 404) {
      titleEl.textContent = t('share.notExist');
      metaEl.textContent = '';
      return;
    }
    if (res.code === 200 && res.data) {
      titleEl.textContent = res.data.title;
      metaEl.textContent = t('share.sharedBy') + ': ' + res.data.nickname;
    }
  });

  // Bind unlock button
  var pwdBtn = document.getElementById('svPwdBtn');
  if (pwdBtn) pwdBtn.onclick = function() { unlockShareView(shortId); };
  var pwdInput = document.getElementById('svPwdInput');
  if (pwdInput) {
    pwdInput.onkeydown = function(e) { if (e.key === 'Enter') unlockShareView(shortId); };
  }

  // Auto-fill password from URL parameter &p= and try auto-unlock
  var urlParamsP = new URLSearchParams(window.location.search).get('p');
  if (urlParamsP && pwdInput) {
    pwdInput.value = urlParamsP;
    unlockShareView(shortId);
  }
}

function unlockShareView(shortId) {
  var pwdInput = document.getElementById('svPwdInput');
  var pwd = pwdInput ? pwdInput.value.trim() : '';
  if (!/^[a-z0-9]{5}$/.test(pwd)) { showToast(t('share.pwdInvalid')); return; }
  postRequest('share_view.api', { shareId: decodeBase62(shortId).toString(), password: pwd }, function(err, res) {
    if (err || res.code !== 200 || !res.data) {
      showToast(t(res && res.msg) || t('share.pwdWrong'));
      return;
    }
    var titleEl = document.getElementById('svTitle');
    var metaEl = document.getElementById('svMeta');
    titleEl.textContent = res.data.title;
    metaEl.textContent = t('share.sharedBy') + ': ' + res.data.nickname;
    var listEl = document.getElementById('svFileList');
    // 解锁后隐藏输入框和按钮
    var pwdWrap = document.querySelector('.share-view-pwd-wrap');
    if (pwdWrap) pwdWrap.style.display = 'none';
    // 解锁后显示提示和排序栏
    var hintEl = document.getElementById('svHint');
    if (hintEl) hintEl.style.display = 'block';
    var sortBar = document.getElementById('svSortBar');
    if (sortBar) sortBar.style.display = 'flex';
    // 解锁后显示流量指示器
    var st = document.getElementById('shareTrafficIndicator');
    if (st) st.style.display = 'flex';
    // 分享页解锁后启动流量轮询
    startTrafficPolling();
    var files = res.data.files || [];
    listEl._shareFiles = files;
    renderShareFileList(files);
  });
}

function renderShareFileList(files) {
  var listEl = document.getElementById('svFileList');
  if (!listEl) return;
  // 重置分享页面选择状态
  _shareSelectedFiles = {};
  // 应用排序（将 f.file 映射为 name 以便复用 sortFiles）
  var mapped = files.map(function(f) {
    return { name: f.file || '', createTime: f.createTime || '' };
  });
  var sortedIdx = sortFiles(mapped, _shareSortBy, _shareSortOrder);
  // 重新映射回原数组
  var nameToFile = {};
  for (var k = 0; k < files.length; k++) {
    nameToFile[files[k].file || ''] = files[k];
  }
  var sortedFiles = [];
  for (var m = 0; m < sortedIdx.length; m++) {
    var f = nameToFile[sortedIdx[m].name];
    if (f) sortedFiles.push(f);
  }
  var html = '';
  for (var i = 0; i < sortedFiles.length; i++) {
    var f = sortedFiles[i];
    var fullUrl = window.location.origin + f.url;
    var fileName = f.file || '';
    var encodedUrl = encodeURI(f.url);
    var ext = (fileName || '').split('.').pop().toLowerCase();
    var isImg = ['jpg','jpeg','png','gif','bmp','webp','svg','ico','tiff','tif'].indexOf(ext) >= 0;
    var isAudio = ['mp3','wav','ogg','flac','aac','m4a','wma','opus'].indexOf(ext) >= 0;
    var isVideo = ['mp4','webm','mov','avi','mkv','flv','wmv','m4v','3gp'].indexOf(ext) >= 0;
    var isPdf = ext === 'pdf';
    var isOffice = ['docx','xlsx','pptx'].indexOf(ext) >= 0;
    var isText = ['txt','log','sha','ini','conf','cfg','md','json','xml','html','css','js'].indexOf(ext) >= 0;
    var isMedia = isAudio || isVideo;
    var nameCls = isImg ? 'file-name-link file-name-link-img' : (isAudio ? 'file-name-link file-name-link-audio' : (isVideo ? 'file-name-link file-name-link-video' : (isPdf ? 'file-name-link file-name-link-pdf' : (isOffice ? 'file-name-link file-name-link-office' : (isText ? 'file-name-link file-name-link-txt' : 'file-name-link')))));
    var exists = (f.exists !== false);
    var clickHandler = '';
    if (exists) {
      if (isImg) {
        clickHandler = ' onclick="event.stopPropagation();showImagePreview(window.location.origin+\'' + escAttr(encodedUrl) + '\')"';
      } else if (isAudio) {
        var safeName = escHtml(fileName).replace(/'/g, '\\\'');
        clickHandler = ' onclick="event.stopPropagation();audioPlayerPlay(\'' + safeName + '\',window.location.origin+\'' + escAttr(encodedUrl) + '\')"';
      } else if (isVideo) {
        clickHandler = ' onclick="event.stopPropagation();showVideoPreview(window.location.origin+\'' + escAttr(encodedUrl) + '\')"';
      } else if (isPdf) {
        clickHandler = ' onclick="event.stopPropagation();showPdfPreview(window.location.origin+\'' + escAttr(encodedUrl) + '\')"';
      } else if (isOffice) {
        clickHandler = ' onclick="event.stopPropagation();showOfficePreview(window.location.origin+\'' + escAttr(encodedUrl) + '\')"';
      } else if (isText) {
        clickHandler = ' onclick="event.stopPropagation();showTxtPreview(window.location.origin+\'' + escAttr(encodedUrl) + '\',\'' + escAttr(fileName) + '\')"';
      }
    }
    var fileMeta = '';
    if (f.sizeStr || f.createTime) {
      var parts = [];
      if (f.sizeStr) parts.push(escHtml(f.sizeStr));
      if (f.createTime) parts.push(escHtml(f.createTime));
      fileMeta = '<div class="file-meta">' + parts.join(' &middot; ') + '</div>';
    }
    var liCls = exists ? '' : ' file-missing';
    var copyCls = 'share-view-copy-btn' + (exists ? '' : ' disabled');
    var dlCls = 'share-view-dl-btn' + (exists ? '' : ' disabled');
    var copyHref = exists ? ('copyText(\'' + escAttr(fullUrl) + '\');showToast(t(\'toast.copySuccess\'));event.stopPropagation();') : 'return false;event.stopPropagation();';
    var key = escAttr(fileName);
    var dlAction = exists ? ('downloadFile(\'' + escAttr(fullUrl) + '\',\'' + key + '\');event.stopPropagation();') : 'return false;event.stopPropagation();';
    html += '<li class="' + liCls.trim() + '" data-name="' + key + '" data-media="' + (isMedia ? '1' : '0') + '" data-url="' + escAttr(fullUrl) + '">' +
      '<div class="file-cb"><input type="checkbox" onchange="toggleShareFileSelect(\'' + key + '\', this)"></div>' +
      '<svg class="icon file-icon-inline"><use href="#icon-file"/></svg>' +
      '<div class="file-info">' +
        '<span class="' + nameCls + '" title="' + escAttr(fileName) + '"' + clickHandler + '>' + escHtml(fileName) + '</span>' +
        fileMeta +
      '</div>' +
      '<div class="file-actions" id="svfa-' + i + '">' +
        '<button class="' + copyCls + '" onclick="' + copyHref + '" data-i18n="share.copyUrl">' + t('share.copyUrl') + '</button>' +
        '<a class="' + dlCls + '" href="javascript:void(0);" onclick="' + dlAction + '" data-i18n="share.downloadFile">' + t('share.downloadFile') + '</a>' +
      '</div>' +
      '<button class="action-toggle" onclick="toggleSvFileActions(this,' + i + ')" aria-label="actions"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg></button>' +
    '</li>';
  }
  listEl.innerHTML = html;

  // 显示/隐藏全选checkbox和播放按钮
  var allCbLabel = document.getElementById('svSelectAllLabel');
  if (allCbLabel) allCbLabel.style.display = sortedFiles.length > 0 ? 'inline-flex' : 'none';
  var allCb = document.getElementById('svSelectAllCb');
  if (allCb) allCb.checked = false;
  var fp = document.getElementById('svFloatPlay');
  if (fp) fp.style.display = 'none';
  var fd = document.getElementById('svFloatDownload');
  if (fd) fd.style.display = 'none';
  shareUpdateBatchBar();
}

// ===== Share View Selection =====
var _shareSelectedFiles = {};

function toggleShareFileSelect(name, cb) {
  if (cb.checked) {
    _shareSelectedFiles[name] = true;
  } else {
    delete _shareSelectedFiles[name];
  }
  // 更新 li 高亮
  var items = document.querySelectorAll('#svFileList li');
  for (var i = 0; i < items.length; i++) {
    var li = items[i];
    if (li.getAttribute('data-name') === name) {
      if (cb.checked) li.classList.add('selected');
      else li.classList.remove('selected');
    }
  }
  // 同步全选框
  var totalItems = items.length;
  var selCount = 0;
  for (var k = 0; k < items.length; k++) {
    if (items[k].classList.contains('selected')) selCount++;
  }
  var allCb = document.getElementById('svSelectAllCb');
  if (allCb) allCb.checked = (totalItems > 0 && selCount === totalItems);
  shareUpdateBatchBar();
}

function toggleShareSelectAll() {
  var allCb = document.getElementById('svSelectAllCb');
  if (!allCb) return;
  var checked = allCb.checked;
  _shareSelectedFiles = {};
  var items = document.querySelectorAll('#svFileList li');
  for (var i = 0; i < items.length; i++) {
    var li = items[i];
    var chk = li.querySelector('.file-cb input');
    if (chk) chk.checked = checked;
    if (checked) {
      _shareSelectedFiles[li.getAttribute('data-name')] = true;
      li.classList.add('selected');
    } else {
      li.classList.remove('selected');
    }
  }
  shareUpdateBatchBar();
}

function shareUpdateBatchBar() {
  var count = 0;
  var mediaExts = ['mp3','wav','ogg','flac','aac','m4a','wma','opus','mp4','webm','mov','avi','mkv','flv','wmv','m4v','3gp'];
  var hasMedia = false;
  var items = document.querySelectorAll('#svFileList li.selected');
  for (var k in _shareSelectedFiles) {
    if (_shareSelectedFiles.hasOwnProperty(k) && _shareSelectedFiles[k]) count++;
  }
  // 检查勾选文件中是否包含音乐或视频
  for (var i = 0; i < items.length; i++) {
    var name = items[i].getAttribute('data-name') || '';
    var ext = (name.split('.').pop() || '').toLowerCase();
    if (mediaExts.indexOf(ext) >= 0) { hasMedia = true; break; }
  }
  var fp = document.getElementById('svFloatPlay');
  if (fp) fp.style.display = (count > 0 && hasMedia) ? 'inline-flex' : 'none';
  var fd = document.getElementById('svFloatDownload');
  if (fd) fd.style.display = count > 0 ? 'inline-flex' : 'none';
}

function toggleSvFileActions(btn, idx) {
  var actions = document.getElementById('svfa-' + idx);
  if (!actions) return;
  var isOpen = actions.classList.contains('show');
  // 关闭其他已打开的
  document.querySelectorAll('#svFileList .file-actions.show').forEach(function(el) { el.classList.remove('show'); });
  document.querySelectorAll('#svFileList .action-toggle.open').forEach(function(el) { el.classList.remove('open'); });
  if (!isOpen) {
    actions.classList.add('show');
    btn.classList.add('open');
  }
}

function shareBatchPlay() {
  // 收集已选中的可播放文件（音频+视频）
  var audioExts = ['mp3','wav','ogg','flac','aac','m4a','wma','opus'];
  var videoExts = ['mp4','webm','mov','avi','mkv','flv','wmv','m4v','3gp'];
  var playlist = [];
  var videoList = [];
  var items = document.querySelectorAll('#svFileList li.selected');
  for (var i = 0; i < items.length; i++) {
    var li = items[i];
    var name = li.getAttribute('data-name') || '';
    var url = li.getAttribute('data-url') || '';
    if (!name || !url) continue;
    var ext = name.split('.').pop().toLowerCase();
    if (audioExts.indexOf(ext) >= 0) {
      playlist.push({ title: name, url: url });
    } else if (videoExts.indexOf(ext) >= 0) {
      videoList.push({ name: name, url: url });
    }
  }
  // 有音乐文件时只添加音乐文件并打开音乐播放器
  if (playlist.length > 0) {
    _audioCtx.playlist = playlist;
    _audioCtx.playIndex = 0;
    if (_audioCtx.playMode !== 2) _audioCtx.audio.loop = false;
    _audioDoPlay(playlist[0].title, playlist[0].url);
    _showPlayer();
  } else if (videoList.length > 0) {
    // 只有视频文件没有音乐文件时，打开视频播放器
    showVideoPreview(videoList[0].url);
  } else {
    showToast(t('files.noAudioSelected'));
  }
}

// 分享页批量下载：利用 setTimeout 间隔1.5秒为勾选的文件创建带 download 的 a 链接并激活下载
function shareBatchDownload() {
  var items = document.querySelectorAll('#svFileList li.selected');
  if (items.length === 0) return;
  var files = [];
  for (var i = 0; i < items.length; i++) {
    var li = items[i];
    var name = li.getAttribute('data-name') || '';
    var url = li.getAttribute('data-url') || '';
    if (name && url) {
      files.push({ name: name, url: url });
    }
  }
  if (files.length === 0) return;
  showToast(t('files.batchDownloadStart', { n: files.length }));
  var idx = 0;
  function downloadNext() {
    if (idx >= files.length) return;
    var a = document.createElement('a');
    a.href = files[idx].url;
    a.download = files[idx].name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    idx++;
    if (idx < files.length) {
      setTimeout(downloadNext, 1500);
    }
  }
  downloadNext();
}

function copyLink(url) {
  var link = window.location.origin + url;
  var inp = document.createElement('input');
  inp.value = link;
  document.body.appendChild(inp);
  inp.select();
  try {
    document.execCommand('copy');
    showToast(t('toast.copySuccess'));
  } catch(e) {
    showToast(t('toast.copyFailed'));
  }
  document.body.removeChild(inp);
}

function showCopyDialog(path, originalName) {
  var token = getToken();
  var username = getUsername();
  var basePrefix = '/up/' + username + '/';
  var html = '<div class="dialog-title"><svg class="icon" style="vertical-align:middle;margin-right:4px;"><use href="#icon-clipboard"/></svg> ' + t('files.copyTo') + '</div>';
  html += '<div style="margin-bottom:12px;font-size:13px;color:#666;">' + t('files.targetFile', { path: escHtml(originalName || path.replace(basePrefix, '')) }) + '</div>';
  html += '<div class="form-group"><label>' + t('files.selectTarget') + '</label><div class="dir-tree" id="dirTree">';
  html += '<div class="loading" style="padding:12px;text-align:center;font-size:13px;color:#999;">' + t('files.loading') + '...</div>';
  html += '</div></div>';
  html += '<input type="hidden" id="copyTargetDir" value="">';
  html += '<div class="dialog-actions">' +
    '<button class="btn btn-outline" onclick="closeDialog()" data-i18n="btn.cancel">' + t('btn.cancel') + '</button>' +
    '<button class="btn btn-primary" onclick="doCopyFile(\'' + escAttr(path) + '\',\'' + escAttr(originalName || '') + '\')" data-i18n="files.copy">' + t('files.copy') + '</button>' +
  '</div>';
  showDialog(html);

  postRequest('dir_tree.api', { token: token }, function(err, res) {
    if (err || res.code !== 200) { showToast(t('toast.loadDirFailed')); return; }
    var dirs = res.data || [];
    dirs.sort(function(a, b) { return a.relPath < b.relPath ? -1 : 1; });
    var treeHtml = '<div class="dir-tree-item selected" data-path="" onclick="selectCopyDir(this)"><span class="tree-icon"><svg class="icon" style="width:14px;height:14px;"><use href="#icon-folder"/></svg></span><span data-i18n="files.rootDir">' + t('files.rootDir') + '</span></div>';
    for (var i = 0; i < dirs.length; i++) {
      var relPath = dirs[i].relPath;
      var name = relPath;
      var slashIdx = relPath.lastIndexOf('/');
      if (slashIdx >= 0) name = relPath.substring(slashIdx + 1);
      var depth = relPath.split('/').length;
      var padding = 12 + depth * 20;
      treeHtml += '<div class="dir-tree-item" data-path="' + escAttr(relPath) + '" onclick="selectCopyDir(this)" style="padding-left:' + padding + 'px">' +
        '<span class="tree-icon"><svg class="icon" style="width:14px;height:14px;"><use href="#icon-folder"/></svg></span>' +
        '<span class="dir-tree-item-label">' + escHtml(name) + '</span></div>';
    }
    document.getElementById('dirTree').innerHTML = treeHtml;
    document.getElementById('copyTargetDir').value = '';
  });
}

function selectCopyDir(el) {
  var items = document.querySelectorAll('.dir-tree-item');
  for (var i = 0; i < items.length; i++) items[i].classList.remove('selected');
  el.classList.add('selected');
  document.getElementById('copyTargetDir').value = el.getAttribute('data-path') || '';
}

function doCopyFile(path, originalName) {
  var targetDir = document.getElementById('copyTargetDir').value;
  var token = getToken();
  var username = getUsername();
  var fullTarget = targetDir;
  if (fullTarget && fullTarget.indexOf('/up/') !== 0) {
    fullTarget = '/up/' + username + '/' + fullTarget;
  } else if (!fullTarget) {
    fullTarget = '/up/' + username + '/';
  }
  fullTarget = fullTarget.replace(/\/$/, '') + '/';
  var copyBody = urlEncodeParam('path', path) + '&' + urlEncodeParam('targetDir', fullTarget) + '&' + urlEncodeParam('originalName', originalName || '');
  var xhrCopy = new XMLHttpRequest();
  xhrCopy.open('POST', API_BASE + 'file_copy.api', true);
  xhrCopy.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  xhrCopy.setRequestHeader('Authorization', 'Bearer ' + token);
  xhrCopy.onload = function() {
    try {
      var text = xhrCopy.responseText;
      var jsonStart = text.indexOf('{');
      if (jsonStart > 0) text = text.substring(jsonStart);
      var res = JSON.parse(text);
    } catch(e) {
      showToast(t('toast.copyFailed'));
      return;
    }
    if (xhrCopy.status !== 200 || res.code !== 200) {
      showToast(t(res && res.msg) || t('toast.copyFailed'));
      return;
    }
    showToast(t('toast.copySuccess'));
    closeDialog();
    loadFileList();
  };
  xhrCopy.onerror = function() {
    showToast(t('toast.copyFailed'));
  };
  xhrCopy.send(copyBody);
}

// ===== Create Directory =====
document.getElementById('createDirBtn').addEventListener('click', function() {
  showDialog(
    '<div class="dialog-title"><svg class="icon" style="vertical-align:middle;margin-right:4px;"><use href="#icon-folder"/></svg> <span data-i18n="createDir.title">' + t('createDir.title') + '</span></div>' +
    '<div class="form-group"><label data-i18n="createDir.label">' + t('createDir.label') + '</label><input class="form-input" id="newDirName" placeholder="' + t('createDir.placeholder') + '" data-i18n-placeholder="createDir.placeholder"></div>' +
    '<div class="dialog-actions">' +
      '<button class="btn btn-outline" onclick="closeDialog()" data-i18n="btn.cancel">' + t('btn.cancel') + '</button>' +
      '<button class="btn btn-primary" id="createDirSubmit" data-i18n="createDir.btn">' + t('createDir.btn') + '</button>' +
    '</div>'
  );
  document.getElementById('createDirSubmit').addEventListener('click', function() {
    var dirname = document.getElementById('newDirName').value.trim();
    if (!dirname) { showToast(t('toast.enterDirName')); return; }
    var token = getToken();
    postRequest('dir_create.api', { token: token, dirname: dirname, dir: _currentDir }, function(err, res) {
      if (err || res.code !== 200) { showToast(t(res && res.msg) || t('createDir.failed')); return; }
      showToast(t('createDir.success'));
      closeDialog();
      loadFileList();
    });
  });
});

// =================================================================
// PAGE: PROFILE
// =================================================================
function loadProfile() {
  var token = getToken();
  if (!token) return;

  document.getElementById('profileAvatar').textContent = (getNickname() || getUsername() || 'U').charAt(0).toUpperCase();
  document.getElementById('profileName').textContent = getNickname() || getUsername() || t('profile.user');
  document.getElementById('profileNickname').textContent = '@' + (getUsername() || 'unknown');
  document.getElementById('profileUsername').textContent = getUsername() || '-';
  document.getElementById('profileEmail').textContent = localStorage.getItem('pdisk_email') || '-';
  document.getElementById('profileRole').textContent = getIsAdmin() ? t('profile.roleAdmin') : t('profile.roleUser');

  // Load disk info
  postRequest('disk_info.api', { token: token }, function(err, res) {
    if (err || res.code !== 200) return;
    var d = res.data;
    var usedPct = d.usedPercent || 0;
    var circumference = 2 * Math.PI * 52;
    var fillLen = (usedPct / 100) * circumference;

    document.getElementById('diskRingFill').setAttribute('stroke-dasharray', fillLen + ' ' + circumference);
    document.getElementById('diskPercentText').textContent = (usedPct).toFixed(2) + '%';
    document.getElementById('diskUsed').textContent = d.usedStr || formatSize(d.used || 0);
    document.getElementById('diskTotal').textContent = d.quotaStr || formatSize(d.quota || 0);
    document.getElementById('diskFree').textContent = d.freeStr || formatSize(d.free || 0);
  });
}

// ===== Change Password =====
function showChangePwdDialog() {
  showDialog(
    '<div class="dialog-title" data-i18n="changePwd.title">' + t('changePwd.title') + '</div>' +
    '<div class="form-group"><label data-i18n="changePwd.oldPwd">' + t('changePwd.oldPwd') + '</label><div class="pwd-input-wrap">' +
    '<input class="form-input" id="oldPwd" type="password" placeholder="' + t('changePwd.oldPwdPlaceholder') + '" data-i18n-placeholder="changePwd.oldPwdPlaceholder">' +
    '<span class="pwd-toggle" onclick="toggleFieldVis(\'oldPwd\')">' +
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
    '</span></div></div>' +
    '<div class="form-group"><label data-i18n="changePwd.newPwd">' + t('changePwd.newPwd') + '</label><div class="pwd-input-wrap">' +
    '<input class="form-input" id="newPwd" type="password" placeholder="' + t('changePwd.newPwdPlaceholder') + '" data-i18n-placeholder="changePwd.newPwdPlaceholder">' +
    '<span class="pwd-toggle" onclick="toggleFieldVis(\'newPwd\')">' +
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
    '</span></div></div>' +
    '<div class="form-group"><label data-i18n="changePwd.confirmPwd">' + t('changePwd.confirmPwd') + '</label><div class="pwd-input-wrap">' +
    '<input class="form-input" id="confirmPwd" type="password" placeholder="' + t('changePwd.confirmPwdPlaceholder') + '" data-i18n-placeholder="changePwd.confirmPwdPlaceholder">' +
    '<span class="pwd-toggle" onclick="toggleFieldVis(\'confirmPwd\')">' +
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
    '</span></div></div>' +
    '<div class="dialog-actions">' +
    '<button class="btn btn-outline" onclick="closeDialog()" data-i18n="btn.cancel">' + t('btn.cancel') + '</button>' +
    '<button class="btn btn-primary" onclick="doChangePassword()" data-i18n="changePwd.btn">' + t('changePwd.btn') + '</button>' +
    '</div>'
  );
  // Enter key for change password dialog
  var confirmPwdInput = document.getElementById('confirmPwd');
  if (confirmPwdInput) {
    confirmPwdInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') doChangePassword();
    });
  }
}

function toggleFieldVis(id) {
  var input = document.getElementById(id);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

function doChangePassword() {
  var oldPwd = document.getElementById('oldPwd').value;
  var newPwd = document.getElementById('newPwd').value;
  var confirmPwd = document.getElementById('confirmPwd').value;

  if (!oldPwd) { showToast(t('changePwd.enterOld')); return; }
  if (!newPwd) { showToast(t('changePwd.enterNew')); return; }
  if (newPwd.length < 4) { showToast(t('changePwd.tooShort')); return; }
  if (newPwd !== confirmPwd) { showToast(t('changePwd.mismatch')); return; }

  postRequest('change_pwd.api', { token: getToken(), oldPassword: oldPwd, newPassword: newPwd }, function(err, res) {
    if (err || res.code !== 200) { showToast(t(res && res.msg) || t('changePwd.failed')); return; }
    showToast(t('changePwd.success'));
    closeDialog();
  });
}

// =================================================================
// PAGE: ADMIN
// =================================================================
function loadAdminData() {
  if (!getToken() || !getIsAdmin()) return;
  var activeSub = document.querySelector('.admin-sub-page.active');
  if (activeSub) {
    var id = activeSub.id;
    if (id === 'admin-users') {
      loadAdminUsers();
      loadSettings();
    }
    else if (id === 'admin-reset-pwd') loadResetPwdList();
  }
}

// Admin Sub Tabs
document.getElementById('adminSubTabs').addEventListener('click', function(e) {
  var tab = e.target.closest('.admin-sub-tab');
  if (!tab) return;
  var sub = tab.getAttribute('data-sub');
  document.querySelectorAll('.admin-sub-tab').forEach(function(el) { el.classList.remove('active'); });
  tab.classList.add('active');
  document.querySelectorAll('.admin-sub-page').forEach(function(el) { el.classList.remove('active'); });
  var target = document.getElementById('admin-' + sub);
  if (target) target.classList.add('active');
  if (sub === 'users') {
    loadAdminUsers();
    loadSettings();
  }
  else if (sub === 'reset-pwd') loadResetPwdList();
  else if (sub === 'user-files') loadAdminFileUsers();
  else if (sub === 'shares') loadAdminShares();
  // 切换管理子页面时隐藏批量操作行
  var adminBatchRow = document.getElementById('adminBatchActionsRow');
  if (adminBatchRow && sub !== 'user-files') adminBatchRow.style.display = 'none';
});

// ===== Admin: Settings =====
var _settingsCache = {};

function loadSettings() {
  postRequest('settings_list.api', {}, function(err, res) {
    if (err || res.code !== 200 || !res.data) {
      // 如果加载失败或没有数据，使用默认值
      _settingsCache = { allowRegistration: '1', defaultQuota: '10' };
    } else {
      _settingsCache = { allowRegistration: '1', defaultQuota: '10' };
      for (var i = 0; i < res.data.length; i++) {
        _settingsCache[res.data[i].FKey] = res.data[i].FValue;
      }
    }
    // 更新允许注册开关
    var allowRegSwitch = document.getElementById('allowRegSwitch');
    if (allowRegSwitch) {
      allowRegSwitch.checked = (_settingsCache['allowRegistration'] === '1');
    }
    // 更新默认配额输入框
    var defaultQuotaInput = document.getElementById('defaultQuotaInput');
    if (defaultQuotaInput) {
      defaultQuotaInput.value = _settingsCache['defaultQuota'] || '10';
    }
  });
}

function applyDefaultQuota() {
  var input = document.getElementById('defaultQuotaInput');
  var val = input.value.trim();
  if (!val || isNaN(val) || parseInt(val) < 1) {
    showToast('请输入有效的整数');
    return;
  }
  postRequest('settings_update.api', { token: getToken(), key: 'defaultQuota', value: val }, function(err, res) {
    if (err || res.code !== 200) {
      showToast(t(res && res.msg) || t('settings.updateFailed'));
      return;
    }
    showToast(t('settings.updated'));
    _settingsCache['defaultQuota'] = val;
  });
}

document.addEventListener('change', function(e) {
  if (e.target.id === 'allowRegSwitch') {
    var status = document.getElementById('allowRegStatus');
    if (status) {
      status.textContent = e.target.checked ? '已开启' : '已关闭';
    }
    postRequest('settings_update.api', { token: getToken(), key: 'allowRegistration', value: e.target.checked ? '1' : '0' }, function(err, res) {
      if (err || res.code !== 200) {
        showToast(t(res && res.msg) || t('settings.updateFailed'));
        e.target.checked = !e.target.checked;
        if (status) status.textContent = e.target.checked ? '已开启' : '已关闭';
        return;
      }
      _settingsCache['allowRegistration'] = e.target.checked ? '1' : '0';
      showToast(t('settings.updated'));
    });
  }
});

// ===== Admin: User Management =====
function loadAdminUsers() {
  var container = document.getElementById('adminUserContainer');
  container.innerHTML = '<div class="loading">' + t('files.loading') + '</div>';
  postRequest('admin_user_list.api', { token: getToken() }, function(err, res) {
    if (err || res.code !== 200 || !res.data) {
      container.innerHTML = '<div class="empty-state">' + t('admin.loadFailed') + '</div>';
      return;
    }
    adminUsers = res.data;
    var html = '';
    for (var i = 0; i < res.data.length; i++) {
      var u = res.data[i];
      var isDisabled = u.FDisabled === 1;
      var usedPercent = 0;
      if (u.FQuota > 0) {
        var quotaBytes = u.FQuota * 1048576; // MB to bytes
        usedPercent = (u.FUsedSpace || 0) / quotaBytes;
      }
      var diskColor = '#22c55e';
      if (usedPercent >= 0.66) diskColor = '#ef4444';
      else if (usedPercent >= 0.5) diskColor = '#f97316';
      else if (usedPercent >= 0.33) diskColor = '#22c55e';
      html += '<div class="user-item">' +
        '<div class="user-avatar">' + (u.FUsername || '?').charAt(0).toUpperCase() + '</div>' +
        '<div class="user-info">' +
          '<div class="user-name">' + escHtml(u.FNickname ? u.FNickname + '（' + u.FUsername + '）' : u.FUsername || '-') + '</div>' +
          '<div class="user-meta">' + escHtml(u.FEmail || '') + (u.FIsAdmin ? ' ' + t('user.adminTag') : '') + '</div>' +
          '<div class="user-disk">' +
            '<span><span style="color:' + diskColor + '"><strong>' + escHtml(u.FUsedSpaceStr || '0 B') + '</strong></span> / <strong>' + escHtml(u.FQuotaStr || '10 GB') + '</strong></span>' +
            '<div class="user-disk-bar"><div class="user-disk-fill" style="width:' + Math.min(100, Math.max(0, usedPercent * 100)).toFixed(1) + '%"></div></div>' +
          '</div>' +
        '</div>' +
        '<span class="user-status ' + (isDisabled ? 'disabled' : 'active') + '">' + (isDisabled ? t('user.status.disabled') : t('user.status.active')) + '</span>' +
        '<div class="user-actions" id="ua-' + i + '">' +
          '<button class="btn btn-sm" style="background:#fff;color:#374151;border:1px solid #d1d5db;" onclick="showQuotaDialog(\'' + escAttr(u.FUsername) + '\', ' + u.FQuota + ')">' +
            t('admin.quota') +
          '</button>' +
          '<button class="btn btn-sm btn-warning" onclick="toggleUser(\'' + escAttr(u.FUsername) + '\', ' + (isDisabled ? 1 : 0) + ')">' +
            (isDisabled ? t('btn.enable') : t('btn.disable')) +
          '</button>' +
          '<button class="btn btn-sm btn-danger" onclick="deleteUser(\'' + escAttr(u.FUsername) + '\')" data-i18n="btn.deleteUser">' + t('btn.deleteUser') + '</button>' +
        '</div>' +
        '<button class="action-toggle" onclick="toggleUserActions(this,' + i + ')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg></button>' +
      '</div>';
    }
    container.innerHTML = html || '<div class="empty-state">' + t('admin.noUsers') + '</div>';
  });
}

function toggleUser(targetUser, enable) {
  var action = enable ? 'enable' : 'disable';
  var msg = t('dialog.confirmToggleUser', { action: enable ? t('action.enable') : t('action.disable'), user: targetUser });
  var btnClass = enable ? 'btn-success' : 'btn-danger';
  showConfirmDialog(msg, function() {
    postRequest('admin_user_toggle.api', { token: getToken(), targetUser: targetUser, action: action }, function(err, res) {
      if (err || res.code !== 200) { showToast(t(res && res.msg) || t('changePwd.failed')); return; }
      showToast(t(res.msg) || t('toast.approveSuccess'));
      loadAdminUsers();
    });
  }, btnClass);
}

function deleteUser(targetUser) {
  showConfirmDialog(t('dialog.confirmDeleteUser', { user: targetUser }), function() {
    postRequest('admin_user_delete.api', { token: getToken(), targetUser: targetUser }, function(err, res) {
      if (err || res.code !== 200) { showToast(t(res && res.msg) || t('changePwd.failed')); return; }
      showToast(t(res.msg) || t('toast.deleteSuccess'));
      loadAdminUsers();
    });
  }, 'btn-danger');
}

function showQuotaDialog(username, currentQuotaMB) {
  var currentQuotaGB = Math.round(currentQuotaMB / 1024);
  showDialog(
    '<div class="dialog-title" data-i18n="admin.setQuota">' + t('admin.setQuota') + '</div>' +
    '<div class="form-group"><label>' + escHtml(username) + '</label></div>' +
    '<div class="form-group"><label data-i18n="settings.defaultQuota">默认配额</label><div style="display:flex;align-items:center;gap:8px;"><input class="form-input" id="quotaInput" type="number" value="' + currentQuotaGB + '" min="1" step="1" style="width:120px;"><span style="font-size:14px;color:#374151;" data-i18n="settings.quotaUnit">GB</span></div></div>' +
    '<div class="dialog-actions">' +
      '<button class="btn btn-outline" onclick="closeDialog()" data-i18n="btn.cancel">' + t('btn.cancel') + '</button>' +
      '<button class="btn btn-primary" onclick="doSetQuota(\'' + escAttr(username) + '\', ' + currentQuotaMB + ')" data-i18n="btn.confirm">' + t('btn.confirm') + '</button>' +
    '</div>'
  );
}

function doSetQuota(username, oldQuotaMB) {
  var input = document.getElementById('quotaInput');
  var quotaGB = parseInt(input.value);
  if (!quotaGB || quotaGB < 1) {
    showToast(t('admin.quotaInvalid'));
    return;
  }
  postRequest('admin_user_quota.api', { token: getToken(), targetUser: username, quotaGB: String(quotaGB) }, function(err, res) {
    if (err || res.code !== 200) { showToast(t(res && res.msg) || t('changePwd.failed')); return; }
    showToast(t(res.msg) || t('toast.approveSuccess'));
    closeDialog();
    loadAdminUsers();
  });
}

function syncDiskUsage() {
  showConfirmDialog(t('admin.syncDiskConfirm'), function() {
    postRequest('sync_disk_usage.api', { token: getToken() }, function(err, res) {
      if (err || res.code !== 200) { showToast(t(res && res.msg) || t('changePwd.failed')); return; }
      var syncData = res.data || {};
      showToast(t('syncDisk.complete', { added: syncData.added || 0, deleted: syncData.deleted || 0, changed: syncData.changed || 0 }));
      loadAdminUsers();
    });
  }, 'btn-primary');
}

// ===== Admin: Reset Password =====
function loadResetPwdList() {
  var container = document.getElementById('resetPwdList');
  container.innerHTML = '<div class="loading">' + t('files.loading') + '</div>';
  postRequest('reset_pwd_list.api', { token: getToken() }, function(err, res) {
    if (err || res.code !== 200 || !res.data) {
      container.innerHTML = '<div class="empty-state">' + t('recent.empty') + '</div>';
      return;
    }
    var list = res.data;
    if (!Array.isArray(list) || list.length === 0) {
      container.innerHTML = '<div class="empty-state">' + t('recent.empty') + '</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var statusKey = r.FStatus === 1 ? 'user.status.processed' : (r.FStatus === 2 ? 'user.status.rejected' : 'user.status.pending');
      var statusText = t(statusKey);
      html += '<div class="file-item" style="flex-wrap:wrap;">' +
        '<div class="file-info" style="flex-basis:100%;margin-bottom:6px;">' +
          '<div class="file-name">' + escHtml(r.FUsername || '-') + ' (' + escHtml(r.FEmail || '') + ')</div>' +
          '<div class="file-meta">' + t('admin.requestTime', { time: r.FRequestTime || '-' }) + ' | ' + t('admin.status', { status: statusText }) + '</div>' +
        '</div>' +
        '<div class="flex gap-8" style="width:100%;">' +
          (r.FStatus === 0 ? (
            '<button class="btn btn-sm btn-success" onclick="approveReset(\'' + escAttr(r.FID) + '\')" data-i18n="btn.approve">' + t('btn.approve') + '</button>' +
            '<button class="btn btn-sm btn-danger" onclick="rejectReset(\'' + escAttr(r.FID) + '\')" data-i18n="btn.reject">' + t('btn.reject') + '</button>'
          ) : '<span class="text-muted" style="padding:6px 0;font-size:12px;" data-i18n="admin.processed">' + t('admin.processed') + '</span>') +
        '</div>' +
      '</div>';
    }
    container.innerHTML = html;
  });
}

function approveReset(id) {
  var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  var pwd = '';
  for (var i = 0; i < 6; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  showDialog(
    '<div class="dialog-title" data-i18n="approvePwd.title">' + t('approvePwd.title') + '</div>' +
    '<div class="form-group"><label data-i18n="approvePwd.newPwd">' + t('approvePwd.newPwd') + '</label><div class="pwd-input-wrap">' +
    '<input class="form-input" id="resetNewPwd" type="password" value="' + pwd + '">' +
    '<span class="pwd-toggle" onclick="togglePwdVis()">' +
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
    '</span></div></div>' +
    '<div class="dialog-actions">' +
      '<button class="btn btn-outline" onclick="closeDialog()" data-i18n="btn.cancel">' + t('btn.cancel') + '</button>' +
      '<button class="btn btn-success" onclick="doApproveReset(\'' + escAttr(id) + '\')" data-i18n="btn.approveConfirm">' + t('btn.approveConfirm') + '</button>' +
    '</div>'
  );
}

function togglePwdVis() {
  var input = document.getElementById('resetNewPwd');
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

function doApproveReset(id) {
  var newPassword = document.getElementById('resetNewPwd').value;
  if (!newPassword) { showToast(t('approvePwd.enterPwd')); return; }
  postRequest('reset_pwd_process.api', { token: getToken(), resetId: id, action: 'approve', newPassword: newPassword }, function(err, res) {
    if (err || res.code !== 200) { showToast(t(res && res.msg) || t('changePwd.failed')); return; }
    showToast(t('approvePwd.success'));
    closeDialog();
    loadResetPwdList();
  });
}

function rejectReset(id) {
  if (!id) { showToast(t('toast.errorIdEmpty')); return; }
  showConfirmDialog(t('dialog.confirmRejectReset'), function() {
    postRequest('reset_pwd_process.api', { token: getToken(), resetId: id, action: 'reject' }, function(err, res) {
      if (err || res.code !== 200) { showToast(t(res && res.msg) || t('changePwd.failed')); return; }
      showToast(t('toast.rejected'));
      loadResetPwdList();
    });
  });
}

// ===== Admin: User Files =====
var _adminTargetUser = '';
var _adminCurrentDir = '';
var _adminSelectedFiles = new Set();
var _adminSelectedFileNames = {};

function loadAdminFileUsers() {
  postRequest('admin_user_list.api', { token: getToken() }, function(err, res) {
    var sel = document.getElementById('adminFileUser');
    if (err || res.code !== 200 || !res.data) {
      sel.innerHTML = '<option>' + t('admin.loadFailed') + '</option>';
      return;
    }
    var html = '<option value="">' + t('admin.selectUserPlaceholder') + '</option>';
    for (var i = 0; i < res.data.length; i++) {
      html += '<option value="' + escAttr(res.data[i].FUsername) + '">' + escHtml(res.data[i].FNickname + ' (' + res.data[i].FUsername + ')') + '</option>';
    }
    sel.innerHTML = html;
  });
}

function loadAdminFileList(dir) {
  var token = getToken();
  if (dir !== undefined) _adminCurrentDir = dir;

  _adminSelectedFiles.clear();
  _adminSelectedFileNames = {};
  var batchRow = document.getElementById('adminBatchActionsRow');
  if (batchRow) batchRow.style.display = 'none';
  var batchCountEl = document.getElementById('adminBatchCount');
  if (batchCountEl) { batchCountEl.textContent = t('files.selectedNone'); batchCountEl.style.display = 'none'; }

  var container = document.getElementById('adminFileList');
  container.innerHTML = '<div class="loading">' + t('files.loading') + '</div>';

  var params = { token: token, targetUser: _adminTargetUser };
  if (_adminCurrentDir) params.dir = _adminCurrentDir;

  postRequest('admin_file_browse.api', params, function(err, res) {
    if (err || res.code !== 200 || !res.data) {
      container.innerHTML = '<div class="empty-state">' + t('files.loadFailed') + '</div>';
      return;
    }
    renderAdminFileList(res.data);
  });
}

function renderAdminFileList(data) {
  var container = document.getElementById('adminFileList');
  var breadcrumb = document.getElementById('adminFileBreadcrumb');

  var currentDir = data.currentDir || '/up/' + _adminTargetUser + '/';
  var parentDir = data.parentDir || '';
  var userRoot = data.userRoot || '/up/' + _adminTargetUser + '/';

  _adminCurrentDir = currentDir;

  var relPath = '';
  if (currentDir.indexOf(userRoot) === 0) {
    relPath = currentDir.substring(userRoot.length);
  }
  if (relPath.endsWith('/')) relPath = relPath.slice(0, -1);
  var parts = relPath ? relPath.split('/') : [];

  var bcHtml = '<span class="crumb" onclick="adminGoToDir(\'' + escAttr(userRoot) + '\')">' + escHtml(_adminTargetUser) + '</span>';
  var cum = '';
  for (var i = 0; i < parts.length; i++) {
    cum += (i > 0 ? '/' : '') + parts[i];
    var fullDir = userRoot + cum + '/';
    if (i < parts.length - 1) {
      bcHtml += '<span class="sep">/</span><span class="crumb" onclick="adminGoToDir(\'' + escAttr(fullDir) + '\')">' + escHtml(parts[i]) + '</span>';
    } else {
      bcHtml += '<span class="sep">/</span><span class="crumb">' + escHtml(parts[i]) + '</span>';
    }
  }
  breadcrumb.innerHTML = bcHtml;

  var dirs = data.dirs || [];
  var files = data.files || [];
  // 应用排序
  files = sortFiles(files, _adminSortBy, _adminSortOrder);
  var html = '';

  if (parentDir) {
    html += '<div class="file-item" style="cursor:pointer;" onclick="adminGoToDir(\'' + escAttr(parentDir) + '\')">' +
      '<div class="file-icon dir"><svg class="icon"><use href="#icon-folder"/></svg></div>' +
      '<div class="file-info"><div class="file-name">.. / ' + t('files.goUp') + '</div></div>' +
    '</div>';
  }

  for (var i = 0; i < dirs.length; i++) {
    var dirFullPath = currentDir + dirs[i].name + '/';
    html += '<div class="file-item" style="cursor:pointer;" onclick="adminGoToDir(\'' + escAttr(dirFullPath) + '\')">' +
      '<div class="file-icon dir"><svg class="icon"><use href="#icon-folder"/></svg></div>' +
      '<div class="file-info">' +
        '<div class="file-name" title="' + escAttr(dirs[i].name) + '">' + escHtml(dirs[i].name) + '</div>' +
        '<div class="file-meta" data-i18n="files.dir">' + t('files.dir') + '</div>' +
      '</div>' +
      '<div class="dir-delete-btn"><button class="btn btn-danger btn-sm" onclick="adminDeleteDir(\'' + escAttr(dirFullPath) + '\', event)" data-i18n="files.delete">' + t('files.delete') + '</button></div>' +
    '</div>';
  }

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var filePath = f.path || f.name;
    var fileUrl = f.url || filePath;
    var encodedUrl = encodeURI(fileUrl);
    var sel = _adminSelectedFiles.has(filePath) ? ' selected' : '';
    var ext = (f.name || '').split('.').pop().toLowerCase();
    var isImg = ['jpg','jpeg','png','gif','bmp','webp','svg','ico','tiff','tif'].indexOf(ext) >= 0;
    var isAudio = ['mp3','wav','ogg','flac','aac','m4a','wma','opus'].indexOf(ext) >= 0;
    var isVideo = ['mp4','webm','mov','avi','mkv','flv','wmv','m4v','3gp'].indexOf(ext) >= 0;
    var isPdf = ext === 'pdf';
    var isOffice = ['docx','xlsx','pptx'].indexOf(ext) >= 0;
    var isText = ['txt','log','sha','ini','conf','cfg','md','json','xml','html','css','js'].indexOf(ext) >= 0;
    var nameCls = isImg ? 'file-name file-name-img' : (isAudio ? 'file-name file-name-audio' : (isVideo ? 'file-name file-name-video' : (isPdf ? 'file-name file-name-pdf' : (isOffice ? 'file-name file-name-office' : (isText ? 'file-name file-name-txt' : 'file-name')))));
    var clickHandler = '';
    if (isImg) {
      clickHandler = ' onclick="event.stopPropagation();showImagePreview(window.location.origin+\'' + escAttr(encodedUrl) + '\')"';
    } else if (isAudio) {
      var safeName = escHtml(f.name).replace(/'/g, '\\\'');
      clickHandler = ' onclick="event.stopPropagation();audioPlayerPlay(\'' + safeName + '\',window.location.origin+\'' + escAttr(encodedUrl) + '\')"';
    } else if (isVideo) {
      clickHandler = ' onclick="event.stopPropagation();showVideoPreview(window.location.origin+\'' + escAttr(encodedUrl) + '\')"';
    } else if (isPdf) {
      clickHandler = ' onclick="event.stopPropagation();showPdfPreview(window.location.origin+\'' + escAttr(encodedUrl) + '\')"';
    } else if (isOffice) {
      clickHandler = ' onclick="event.stopPropagation();showOfficePreview(window.location.origin+\'' + escAttr(encodedUrl) + '\')"';
    } else if (isText) {
      clickHandler = ' onclick="event.stopPropagation();showTxtPreview(window.location.origin+\'' + escAttr(encodedUrl) + '\',\'' + escAttr(f.name) + '\')"';
    }
    html += '<div class="file-item' + sel + '" data-path="' + escAttr(filePath) + '">' +
      '<div class="file-cb"><input type="checkbox" onchange="adminToggleFileSelect(\'' + escAttr(filePath) + '\', this)"></div>' +
      '<div class="file-icon file"><svg class="icon"><use href="#icon-file"/></svg></div>' +
      '<div class="file-info">' +
        '<div class="' + nameCls + '" title="' + escAttr(f.name) + '"' + clickHandler + '>' + escHtml(f.name) + '</div>' +
        '<div class="file-meta">' + formatSize(f.size || 0) + '</div>' +
      '</div>' +
      '<div class="file-actions" id="afa-' + i + '">' +
        '<button class="btn btn-danger btn-sm" onclick="adminDeleteFile(\'' + escAttr(filePath) + '\', event)" data-i18n="files.delete">' + t('files.delete') + '</button>' +
        '<a class="btn btn-sm file-btn-orange" href="javascript:void(0);" onclick="event.stopPropagation();downloadFile(\'' + escAttr(filePath) + '\',\'' + escAttr(f.name) + '\')" data-i18n="files.download">' + t('files.download') + '</a>' +
      '</div>' +
      '<button class="action-toggle" onclick="adminToggleFileActions(this,' + i + ')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg></button>' +
    '</div>';
  }

  if (dirs.length === 0 && files.length === 0 && !parentDir) {
    html = '<div class="empty-state">' + t('files.empty') + '</div>';
  }

  container.innerHTML = html;

  var selLabel = document.getElementById('adminSelectAllLabel');
  var selCb = document.getElementById('adminSelectAllCb');
  if (files.length > 0) {
    selLabel.style.display = 'inline-flex';
    var allSelected = files.every(function(f) { return _adminSelectedFiles.has(f.path || f.name); });
    selCb.checked = allSelected;
  } else {
    selLabel.style.display = 'none';
  }
  adminUpdateBatchBar();
}

function adminGoToDir(dirPath) {
  loadAdminFileList(dirPath);
}

function adminDeleteDir(dirPath, e) {
  if (e) e.stopPropagation();
  showConfirmDialog(t('dialog.confirmDeleteDir'), function() {
    postRequest('admin_dir_delete.api', { token: getToken(), dirPath: dirPath }, function(err, res) {
      if (err || res.code !== 200) { showToast(t(res && res.msg) || t('toast.deleteFailed')); return; }
      showToast(t('toast.dirDeleteSuccess'));
      loadAdminFileList();
    });
  });
}

function adminDeleteFile(filePath, e) {
  if (e) e.stopPropagation();
  showConfirmDialog(t('dialog.confirmDeleteFile'), function() {
    postRequest('admin_file_delete.api', { token: getToken(), filePath: filePath }, function(err, res) {
      if (err || res.code !== 200) { showToast(t(res && res.msg) || t('toast.deleteFailed')); return; }
      showToast(t('toast.deleteSuccess'));
      loadAdminFileList();
    });
  });
}

// ===== Admin Batch Operations =====
function adminToggleFileSelect(path, cb) {
  if (cb.checked) {
    _adminSelectedFiles.add(path);
    var item = cb.closest('.file-item');
    if (item) {
      var nameEl = item.querySelector('.file-name');
      if (nameEl) _adminSelectedFileNames[path] = nameEl.textContent.trim();
    }
  } else {
    _adminSelectedFiles.delete(path);
    delete _adminSelectedFileNames[path];
  }
  var items = document.querySelectorAll('#adminFileList .file-item');
  items.forEach(function(el) {
    if (el.getAttribute('data-path') === path) {
      if (cb.checked) el.classList.add('selected');
      else el.classList.remove('selected');
    }
  });
  adminUpdateBatchBar();
}

function adminToggleSelectAll() {
  var cb = document.getElementById('adminSelectAllCb');
  var checked = cb.checked;
  var items = document.querySelectorAll('#adminFileList .file-item');
  items.forEach(function(el) {
    var p = el.getAttribute('data-path');
    if (!p) return;
    var chk = el.querySelector('.file-cb input');
    if (chk) chk.checked = checked;
    if (checked) {
      _adminSelectedFiles.add(p);
      var nameEl = el.querySelector('.file-name');
      if (nameEl) _adminSelectedFileNames[p] = nameEl.textContent.trim();
      el.classList.add('selected');
    } else {
      _adminSelectedFiles.delete(p);
      delete _adminSelectedFileNames[p];
      el.classList.remove('selected');
    }
  });
  adminUpdateBatchBar();
}

function adminUpdateBatchBar() {
  var count = _adminSelectedFiles.size;
  var row = document.getElementById('adminBatchActionsRow');
  var el = document.getElementById('adminBatchCount');
  if (!row) return;
  if (count > 0) {
    row.style.display = 'flex';
    if (el) { el.textContent = t('files.selected', { n: count }); el.style.display = 'inline'; }
  } else {
    row.style.display = 'none';
    if (el) { el.textContent = t('files.selectedNone'); el.style.display = 'none'; }
  }
  // 仅当勾选中包含音乐或视频文件时显示播放按钮
  var playBtn = document.getElementById('adminBatchPlayBtn');
  if (playBtn) playBtn.style.display = hasMediaSelected(_adminSelectedFiles) ? '' : 'none';
}

var _adminOpenFileActionsIdx = -1;
function adminToggleFileActions(btn, idx) {
  var target = document.getElementById('afa-' + idx);
  if (!target) return;
  var isOpen = target.classList.contains('show');
  // Close all other admin file actions
  document.querySelectorAll('#adminFileList .file-actions.show').forEach(function(el) {
    el.classList.remove('show');
  });
  document.querySelectorAll('#adminFileList .action-toggle.open').forEach(function(el) {
    el.classList.remove('open');
  });
  if (!isOpen) {
    target.classList.add('show');
    btn.classList.add('open');
    _adminOpenFileActionsIdx = idx;
  } else {
    _adminOpenFileActionsIdx = -1;
  }
}

function adminBatchPlay() {
  var paths = Array.from(_adminSelectedFiles);
  if (paths.length === 0) return;
  var audioExts = ['mp3','wav','ogg','flac','aac','m4a','wma','opus'];
  var videoExts = ['mp4','webm','mov','avi','mkv','flv','wmv','m4v','3gp'];
  var playlist = [];
  var videoList = [];
  for (var i = 0; i < paths.length; i++) {
    var ext = paths[i].split('.').pop().toLowerCase();
    var name = _adminSelectedFileNames[paths[i]] || paths[i].split('/').pop();
    var url = window.location.origin + encodeURI(paths[i]);
    if (audioExts.indexOf(ext) >= 0) {
      playlist.push({ title: name, url: url });
    } else if (videoExts.indexOf(ext) >= 0) {
      videoList.push({ title: name, url: url });
    }
  }
  // 有音乐文件时只添加音乐文件并打开音乐播放器
  if (playlist.length > 0) {
    _audioCtx.playlist = playlist;
    _audioCtx.playIndex = 0;
    if (_audioCtx.playMode !== 2) _audioCtx.audio.loop = false;
    _audioDoPlay(playlist[0].title, playlist[0].url);
    _showPlayer();
  } else if (videoList.length > 0) {
    // 只有视频文件没有音乐文件时，打开视频播放器
    showVideoPreview(videoList[0].url);
  } else {
    showToast(t('files.noAudioSelected'));
  }
}

// 批量下载：利用 setTimeout 间隔1.5秒为勾选的文件创建带 download 的 a 链接并激活下载，避免浏览器多文件下载授权提示
function adminBatchDownload() {
  var paths = Array.from(_adminSelectedFiles);
  if (paths.length === 0) return;
  showToast(t('files.batchDownloadStart', { n: paths.length }));
  var i = 0;
  function downloadNext() {
    if (i >= paths.length) return;
    var p = paths[i];
    var name = _adminSelectedFileNames[p] || p.split('/').pop();
    var a = document.createElement('a');
    a.href = window.location.origin + encodeURI(p);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    i++;
    if (i < paths.length) {
      setTimeout(downloadNext, 1500);
    }
  }
  downloadNext();
}

function adminBatchDelete() {
  var paths = Array.from(_adminSelectedFiles);
  if (paths.length === 0) return;
  showConfirmDialog(t('dialog.confirmBatchDelete', { n: paths.length }), function() {
    var done = 0, total = paths.length;
    paths.forEach(function(p) {
      postRequest('admin_file_delete.api', { token: getToken(), filePath: p }, function(err, res) {
        done++;
        if (done === total) {
          _adminSelectedFiles.clear();
          _adminSelectedFileNames = {};
          showToast(t('toast.deleteCompleted'));
          loadAdminFileList();
        }
      });
    });
  });
}

document.getElementById('adminBrowseBtn').addEventListener('click', function() {
  var targetUser = document.getElementById('adminFileUser').value;
  if (!targetUser) { showToast(t('toast.selectUser')); return; }
  _adminTargetUser = targetUser;
  _adminCurrentDir = '';
  var container = document.getElementById('adminFileList');
  container.innerHTML = '<div class="loading">' + t('files.loading') + '</div>';
  loadAdminFileList();
});

// =================================================================
// INIT
// =================================================================
(function init() {
  // i18n: detect language first, then init the app
  function startApp() {
    // Detect share link (?s=...) - 免登录查看
    var urlParams = new URLSearchParams(window.location.search);
    var shareShortId = urlParams.get('s');
    if (shareShortId) {
      openShareViewPage(shareShortId);
      // 分享页不启动流量轮询，等密码验证通过后在 unlockShareView 中启动
      return;
    }

    var token = getToken();
    if (token) {
      updateNavVisibility();
      navigateTo('home');
      // 刷新页面时显示流量指示器并启动轮询
      var ti = document.getElementById('trafficIndicator');
      if (ti) ti.classList.add('show');
      startTrafficPolling();
    } else {
      updateNavVisibility();
      navigateTo('login');
    }

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeDialog();
    });
  }

  // Initialize i18n, then start app
  if (typeof initLanguage === 'function') {
    initLanguage(startApp);
  } else {
    startApp();
  }
})();
(function(){
  var btn=document.getElementById('backToTop');
  window.addEventListener('scroll',function(){
    if(window.scrollY>300){btn.style.display='flex';setTimeout(function(){btn.style.opacity='1'},0)}
    else{btn.style.opacity='0';setTimeout(function(){btn.style.display='none'},300)}
  });
})();

// 悬浮分享按钮支持拖动
(function() {
  var fab = document.getElementById('shareFab');
  if (!fab) return;
  // 默认位置：根据屏幕宽度区分手机/电脑
  var DEFAULT_RIGHT = 30;
  var DEFAULT_BOTTOM = 80 + 44 + 6; // backToTop bottom(80) + height(44) + gap(6) = 130
  // 计算默认位置（基于视口）
  function getDefaultPos() {
    var w = fab.offsetWidth || 44;
    var h = fab.offsetHeight || 44;
    var isMobile = window.innerWidth <= 480;
    if (isMobile) {
      // 手机：按钮在视口右下角，返回顶部上方
      return {
        left: Math.max(8, window.innerWidth - DEFAULT_RIGHT - w),
        top: Math.max(8, window.innerHeight - DEFAULT_BOTTOM - h)
      };
    } else {
      // 电脑：按钮在 app-container 右侧，底部对齐返回顶部按钮上方
      var appEl = document.getElementById('app');
      var appRect = appEl ? appEl.getBoundingClientRect() : null;
      if (appRect) {
        // 放在 app-container 右边缘外侧
        var left = appRect.right + 12;
        // 如果超出视口，则放在 app-container 左边缘外侧
        if (left + w > window.innerWidth - 8) {
          left = appRect.left - w - 12;
        }
        // 如果还是放不下，就放在视口右侧
        if (left < 8) {
          left = window.innerWidth - DEFAULT_RIGHT - w;
        }
        var top = window.innerHeight - DEFAULT_BOTTOM - h;
        return { left: Math.max(8, left), top: Math.max(8, top) };
      }
      return {
        left: Math.max(8, window.innerWidth - DEFAULT_RIGHT - w),
        top: Math.max(8, window.innerHeight - DEFAULT_BOTTOM - h)
      };
    }
  }
  // 返回顶部按钮位置（用于重叠检测）
  function getBackToTopRect() {
    var bttW = 44, bttH = 44;
    return {
      left: window.innerWidth - 30 - bttW,
      top: window.innerHeight - 80 - bttH,
      right: window.innerWidth - 30,
      bottom: window.innerHeight - 80
    };
  }
  // 检测位置是否与返回顶部按钮重叠
  function isOverlappingBackToTop(left, top) {
    var w = fab.offsetWidth || 44, h = fab.offsetHeight || 44;
    var btt = getBackToTopRect();
    var fabRight = left + w, fabBottom = top + h;
    // 距离阈值：水平或垂直距离小于 16px 视为重叠
    var threshold = 16;
    var horizGap = Math.max(btt.left - fabRight, left - btt.right, 0);
    var vertGap = Math.max(btt.top - fabBottom, top - btt.bottom, 0);
    // 水平或垂直都在阈值内即视为重叠
    return horizGap < threshold && vertGap < threshold;
  }
  // 检测位置是否在视口内
  function isInViewport(left, top) {
    var w = fab.offsetWidth || 44, h = fab.offsetHeight || 44;
    return left >= 0 && top >= 0 && left + w <= window.innerWidth && top + h <= window.innerHeight;
  }
  // 恢复保存的位置（如果无效则使用默认）
  try {
    var saved = localStorage.getItem('shareFabPos');
    var usedDefault = true;
    if (saved) {
      var p = JSON.parse(saved);
      if (p && typeof p.x === 'number' && typeof p.y === 'number' && p.x >= 0 && p.y >= 0) {
        // 检查是否在视口内且不与返回顶部按钮重叠
        if (isInViewport(p.x, p.y) && !isOverlappingBackToTop(p.x, p.y)) {
          fab.style.left = p.x + 'px';
          fab.style.top = p.y + 'px';
          fab.style.right = 'auto';
          fab.style.bottom = 'auto';
          usedDefault = false;
        }
      }
    }
    if (usedDefault) {
      var def = getDefaultPos();
      fab.style.left = def.left + 'px';
      fab.style.top = def.top + 'px';
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
    }
  } catch (e) {
    var def = getDefaultPos();
    fab.style.left = def.left + 'px';
    fab.style.top = def.top + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
  }
  var dragging = false, moved = false, dragStartX = 0, dragStartY = 0, startLeft = 0, startTop = 0, activePointerId = null;
  function onDown(e) {
    var pt = e.touches ? e.touches[0] : e;
    dragging = true;
    moved = false;
    activePointerId = e.pointerId !== undefined ? e.pointerId : null;
    fab.classList.add('dragging');
    dragStartX = pt.clientX;
    dragStartY = pt.clientY;
    var rect = fab.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    if (e.cancelable) e.preventDefault();
  }
  function onMove(e) {
    if (!dragging) return;
    var pt = e.touches ? e.touches[0] : e;
    var dx = pt.clientX - dragStartX;
    var dy = pt.clientY - dragStartY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    if (!moved) return;
    var w = fab.offsetWidth, h = fab.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight;
    var nx = Math.max(0, Math.min(vw - w, startLeft + dx));
    var ny = Math.max(0, Math.min(vh - h, startTop + dy));
    fab.style.left = nx + 'px';
    fab.style.top = ny + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
    if (e.cancelable) e.preventDefault();
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    fab.classList.remove('dragging');
    if (moved) {
      var rect = fab.getBoundingClientRect();
      // 如果新位置与返回顶部按钮重叠，则恢复到默认位置
      if (isOverlappingBackToTop(rect.left, rect.top)) {
        var def = getDefaultPos();
        fab.style.left = def.left + 'px';
        fab.style.top = def.top + 'px';
        fab.style.right = 'auto';
        fab.style.bottom = 'auto';
        try { localStorage.removeItem('shareFabPos'); } catch (e) {}
      } else {
        try { localStorage.setItem('shareFabPos', JSON.stringify({ x: rect.left, y: rect.top })); } catch (e) {}
      }
    }
    // 延迟重置 moved，避免与 click 事件竞争
    setTimeout(function() { moved = false; }, 0);
  }
  // 使用 Pointer Events 统一鼠标/触摸/手写笔
  if (window.PointerEvent) {
    fab.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  } else {
    fab.addEventListener('mousedown', onDown);
    fab.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    window.addEventListener('touchcancel', onUp);
  }
  // 拖动后阻止 click 触发 openShareDialog
  fab.addEventListener('click', function(e) {
    if (moved) { e.stopPropagation(); e.preventDefault(); }
  }, true);
  // 窗口大小变化时重新定位
  var resizeTimer = null;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      var def = getDefaultPos();
      fab.style.left = def.left + 'px';
      fab.style.top = def.top + 'px';
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
      try { localStorage.removeItem('shareFabPos'); } catch (e) {}
    }, 200);
  });
})();

// =================================================================
// Upload FAB — 独立拖拽/持久化（默认水平位置与 shareFab 一致，垂直错开避免重叠）
// 复刻 shareFab 的 Pointer Events 拖动 + localStorage 持久化 + 视口校验
// 与 shareFab 相同的 guard：onUp 仅在本 FAB 上按下过（dragging=true）才生效，
// 避免点击页面其它位置时误触发导致位置被重算而"消失"
// =================================================================
(function() {
  var fab = document.getElementById('uploadFab');
  if (!fab) return;

  // 默认位置：与 shareFab 一致（app-container 外侧靠左），垂直方向上移 50px 避免重叠
  var DEFAULT_RIGHT = 30;
  var DEFAULT_BOTTOM = 80 + 44 + 6 + 50; // shareFab bottom(130) + 50 = 180
  var MOVED_THRESHOLD = 5;
  var moved = false;
  var dragging = false;

  // 初始位置（从 localStorage 恢复或使用默认）
  // 注意：元素被隐藏时 offsetWidth/offsetHeight 为 0，必须兜底 44，否则定位会偏到视口角落
  function getSize() {
    return { w: fab.offsetWidth || 44, h: fab.offsetHeight || 44 };
  }
  function getDefaultPos() {
    var s = getSize();
    var isMobile = window.innerWidth <= 480;
    if (isMobile) {
      // 手机：视口右下角，返回顶部上方
      return {
        left: Math.max(8, window.innerWidth - DEFAULT_RIGHT - s.w),
        top: Math.max(8, window.innerHeight - DEFAULT_BOTTOM - s.h)
      };
    } else {
      // 电脑：与分享 FAB 一致，放在 app-container 右边缘外侧（靠左显示）
      var appEl = document.getElementById('app');
      var appRect = appEl ? appEl.getBoundingClientRect() : null;
      if (appRect) {
        var left = appRect.right + 12;
        if (left + s.w > window.innerWidth - 8) {
          left = appRect.left - s.w - 12;
        }
        if (left < 8) {
          left = window.innerWidth - DEFAULT_RIGHT - s.w;
        }
        var top = window.innerHeight - DEFAULT_BOTTOM - s.h;
        return { left: Math.max(8, left), top: Math.max(8, top) };
      }
      return {
        left: Math.max(8, window.innerWidth - DEFAULT_RIGHT - s.w),
        top: Math.max(8, window.innerHeight - DEFAULT_BOTTOM - s.h)
      };
    }
  }

  // 重新定位上传 FAB（登录成功后调用，此时 FAB 已可见，尺寸可正确测量）
  window.relocateUploadFab = function() {
    if (!fab) return;
    var s = getSize();
    var left = 0, top = 0;
    var restored = false;
    try {
      var saved = localStorage.getItem('uploadFabPos');
      if (saved) {
        var p = JSON.parse(saved);
        if (p && typeof p.x === 'number' && typeof p.y === 'number') {
          var inX = p.x >= 0 && p.x <= Math.max(0, window.innerWidth - s.w);
          var inY = p.y >= 0 && p.y <= Math.max(0, window.innerHeight - s.h);
          if (inX && inY) { left = p.x; top = p.y; restored = true; }
        }
      }
    } catch(e) {}
    if (!restored) {
      var def = getDefaultPos();
      left = def.left; top = def.top;
      try { localStorage.removeItem('uploadFabPos'); } catch (e) {}
    }
    fab.style.left = left + 'px';
    fab.style.top = top + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
  };

  // 恢复持久化位置（带视口校验；若元素当前隐藏则仅记录，登录成功后由 relocateUploadFab 重新定位）
  var pos = null;
  var fabVisible = fab.offsetParent !== null;
  try {
    var saved = localStorage.getItem('uploadFabPos');
    if (saved) {
      var p = JSON.parse(saved);
      if (p && typeof p.x === 'number' && typeof p.y === 'number') {
        var s = getSize();
        var inX = p.x >= 0 && p.x <= Math.max(0, window.innerWidth - s.w);
        var inY = p.y >= 0 && p.y <= Math.max(0, window.innerHeight - s.h);
        if (inX && inY) pos = { x: p.x, y: p.y };
      }
    }
  } catch(e) {}
  if (!pos) pos = getDefaultPos();
  fab.style.left = pos.x + 'px';
  fab.style.top = pos.y + 'px';
  fab.style.right = 'auto';
  fab.style.bottom = 'auto';
  // 元素当前不可见（未登录被隐藏），尺寸不可靠，标记待登录时重新定位；
  // 同时清理可能用 0 尺寸算出的脏坐标，避免登录后定位到视口角落
  if (!fabVisible) {
    fab._needsRelocate = true;
    try { localStorage.removeItem('uploadFabPos'); } catch (e) {}
    var defInit = getDefaultPos();
    fab.style.left = defInit.left + 'px';
    fab.style.top = defInit.top + 'px';
  }

  var startX = 0, startY = 0, fabStartX = 0, fabStartY = 0;

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var rect = fab.getBoundingClientRect();
    startX = (e.touches ? e.touches[0].clientX : e.clientX);
    startY = (e.touches ? e.touches[0].clientY : e.clientY);
    fabStartX = rect.left;
    fabStartY = rect.top;
    moved = false;
    dragging = true;
    fab.classList.add('dragging');
    if (fab.setPointerCapture) {
      try { fab.setPointerCapture(e.pointerId); } catch (err) {}
    }
    if (e.preventDefault) e.preventDefault();
  }

  function onMove(e) {
    if (!dragging) return;
    var cx = (e.touches ? e.touches[0].clientX : e.clientX);
    var cy = (e.touches ? e.touches[0].clientY : e.clientY);
    var dx = cx - startX, dy = cy - startY;
    if (Math.abs(dx) > MOVED_THRESHOLD || Math.abs(dy) > MOVED_THRESHOLD) moved = true;
    var w = fab.offsetWidth, h = fab.offsetHeight;
    var newLeft = Math.min(Math.max(0, fabStartX + dx), window.innerWidth - w);
    var newTop = Math.min(Math.max(0, fabStartY + dy), window.innerHeight - h);
    fab.style.left = newLeft + 'px';
    fab.style.top = newTop + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
    if (e.cancelable) e.preventDefault();
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    fab.classList.remove('dragging');
    var rect = fab.getBoundingClientRect();
    var w = fab.offsetWidth || 44, h = fab.offsetHeight || 44;
    if (!moved) {
      // 仅点击 FAB 未拖动：保持位置，不写回（避免无效写回）
      setTimeout(function() { moved = false; }, 0);
      return;
    }
    if (rect.left < -w * 0.5 || rect.top < -h * 0.5) {
      // 拖出视口：回到默认位置（与 shareFab 水平对齐，垂直错开）
      var def = getDefaultPos();
      fab.style.left = def.left + 'px';
      fab.style.top = def.top + 'px';
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
      try { localStorage.removeItem('uploadFabPos'); } catch (e) {}
    } else {
      // 正常拖动到视口内：持久化新位置
      try { localStorage.setItem('uploadFabPos', JSON.stringify({ x: rect.left, y: rect.top })); } catch (e) {}
    }
    setTimeout(function() { moved = false; }, 0);
  }

  if (window.PointerEvent) {
    fab.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  } else {
    fab.addEventListener('mousedown', onDown);
    fab.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    window.addEventListener('touchcancel', onUp);
  }
  fab.addEventListener('click', function(e) {
    if (moved) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  var resizeTimer = null;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      var def = getDefaultPos();
      fab.style.left = def.left + 'px';
      fab.style.top = def.top + 'px';
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
      try { localStorage.removeItem('uploadFabPos'); } catch (e) {}
    }, 200);
  });
})();
