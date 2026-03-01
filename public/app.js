const statusEl = document.getElementById('status');
const authSection = document.getElementById('authSection');
const appSection = document.getElementById('appSection');

const welcomeText = document.getElementById('welcomeText');
const roleBadge = document.getElementById('roleBadge');
const channelTitle = document.getElementById('channelTitle');
const channelMeta = document.getElementById('channelMeta');

const groupPillsEl = document.getElementById('groupPills');
const sidebarGroupsEl = document.getElementById('sidebarGroups');
const sidebarFriendsEl = document.getElementById('sidebarFriends');

const metricCardsEl = document.getElementById('metricCards');
const announcementsListEl = document.getElementById('announcementsList');
const activityListEl = document.getElementById('activityList');
const messagesEl = document.getElementById('messages');
const adminStatsEl = document.getElementById('adminStats');
const adminUsersEl = document.getElementById('adminUsers');

const dashboardPanel = document.getElementById('dashboardPanel');
const chatPanel = document.getElementById('chatPanel');
const adminPanel = document.getElementById('adminPanel');

const createGroupDialog = document.getElementById('createGroupDialog');

let token = localStorage.getItem('token') || '';
let me = null;
let sidebarData = { groups: [], friends: [] };
let active = { type: null, id: null };

const esc = (text = '') => String(text)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const api = async (url, method = 'GET', body) => {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Bir hata oluştu');
  return data;
};

const setStatus = (text, error = false) => {
  statusEl.textContent = text;
  statusEl.style.color = error ? '#ff7b97' : '#78ffbe';
};

const showPanel = (name) => {
  dashboardPanel.classList.toggle('hidden', name !== 'dashboard');
  chatPanel.classList.toggle('hidden', name !== 'chat');
  adminPanel.classList.toggle('hidden', name !== 'admin');
};

const renderMetrics = (target, obj) => {
  target.innerHTML = Object.entries(obj).map(([k, v]) => `
    <article class="metric">
      <small>${esc(k)}</small>
      <b>${esc(v)}</b>
    </article>
  `).join('');
};

const renderSidebar = () => {
  groupPillsEl.innerHTML = sidebarData.groups.map((g) => `
    <button class="pill ${active.type === 'group' && active.id === g.id ? 'active' : ''}" onclick="openGroup('${g.id}')">${esc(g.name.slice(0,2).toUpperCase())}</button>
  `).join('');

  sidebarGroupsEl.innerHTML = sidebarData.groups.length
    ? sidebarData.groups.map((g) => `
      <article class="nav-item ${active.type === 'group' && active.id === g.id ? 'active' : ''}" onclick="openGroup('${g.id}')">
        <strong># ${esc(g.name)}</strong>
        <small>${g.type === 'voice' ? 'Sesli' : 'Yazılı'} • ${esc(g.memberCount)} üye</small>
      </article>
    `).join('')
    : '<small>Henüz grubun yok.</small>';

  sidebarFriendsEl.innerHTML = sidebarData.friends.length
    ? sidebarData.friends.map((f) => `
      <article class="nav-item ${active.type === 'dm' && active.id === f.id ? 'active' : ''}" onclick="openDm('${f.id}')">
        <strong>@ ${esc(f.username)}</strong>
        <small>${esc(f.email)}</small>
      </article>
    `).join('')
    : '<small>Henüz arkadaşın yok.</small>';
};

const loadDashboard = async () => {
  const [dashboard, ann, activity] = await Promise.all([
    api('/api/dashboard'),
    api('/api/announcements'),
    api('/api/activity')
  ]);

  renderMetrics(metricCardsEl, dashboard.metrics);

  announcementsListEl.innerHTML = ann.announcements.slice(0, 8).map((a) => `
    <article class="item"><strong>${esc(a.title)}</strong><p>${esc(a.content)}</p></article>
  `).join('') || '<small>Duyuru yok.</small>';

  activityListEl.innerHTML = activity.activities.slice(0, 12).map((a) => `
    <article class="item"><strong>${esc(a.title)}</strong><small>${new Date(a.createdAt).toLocaleString()}</small></article>
  `).join('') || '<small>Aktivite yok.</small>';
};

const loadSidebar = async () => {
  sidebarData = await api('/api/sidebar');
  renderSidebar();
};

const loadGroupMessages = async (groupId) => {
  const data = await api(`/api/messages/${groupId}`);
  channelTitle.textContent = `# ${data.group.name}`;
  channelMeta.textContent = `${data.group.type === 'voice' ? 'Sesli oda' : 'Yazılı kanal'} • ${data.messages.length} mesaj`;

  messagesEl.innerHTML = data.messages.map((m) => `
    <article class="msg">
      <strong>${esc(m.sender?.username || 'Bilinmeyen')}</strong>
      <small> • ${new Date(m.createdAt).toLocaleString()}</small>
      <div>${esc(m.content)}</div>
    </article>
  `).join('') || '<small>Bu kanalda mesaj yok.</small>';

  showPanel('chat');
};

const loadDmMessages = async (friendId) => {
  const data = await api(`/api/dm/${friendId}`);
  channelTitle.textContent = `@ ${data.peer.username}`;
  channelMeta.textContent = 'Arkadaş ile özel konuşma';

  messagesEl.innerHTML = data.messages.map((m) => `
    <article class="msg">
      <strong>${esc(m.fromUser?.username || 'Bilinmeyen')}</strong>
      <small> • ${new Date(m.createdAt).toLocaleString()}</small>
      <div>${esc(m.content)}</div>
    </article>
  `).join('') || '<small>Henüz DM yok.</small>';

  showPanel('chat');
};

window.openGroup = async (groupId) => {
  try {
    active = { type: 'group', id: groupId };
    renderSidebar();
    await loadGroupMessages(groupId);
  } catch (e) {
    setStatus(e.message, true);
  }
};

window.openDm = async (friendId) => {
  try {
    active = { type: 'dm', id: friendId };
    renderSidebar();
    await loadDmMessages(friendId);
  } catch (e) {
    setStatus(e.message, true);
  }
};

const loadAdmin = async () => {
  if (me.role !== 'admin') return;
  const [stats, users] = await Promise.all([
    api('/api/admin/stats'),
    api('/api/admin/users')
  ]);

  renderMetrics(adminStatsEl, stats);
  adminUsersEl.innerHTML = users.users.map((u) => `
    <article class="item">
      <strong>${esc(u.username)} (${esc(u.role)}) ${u.isBanned ? '• BAN' : ''}</strong>
      <p>${esc(u.email)} • IP: ${esc(u.lastIp || '-')}</p>
      <small>${new Date(u.createdAt).toLocaleString()}</small>
    </article>
  `).join('');
};

const refreshAll = async () => {
  await Promise.all([loadDashboard(), loadSidebar()]);
  await loadAdmin();
};

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/register', 'POST', Object.fromEntries(new FormData(e.target).entries()));
    setStatus('Kayıt başarılı, giriş yapabilirsin.');
    e.target.reset();
  } catch (err) {
    setStatus(err.message, true);
  }
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await api('/api/login', 'POST', Object.fromEntries(new FormData(e.target).entries()));
    token = data.token;
    me = data.user;
    localStorage.setItem('token', token);
    authSection.classList.add('hidden');
    appSection.classList.remove('hidden');
    welcomeText.textContent = `Hoş geldin ${me.username}`;
    roleBadge.textContent = `${me.role.toUpperCase()} • ${me.email}`;
    document.getElementById('showAdmin').classList.toggle('hidden', me.role !== 'admin');
    await refreshAll();
    showPanel('dashboard');
    setStatus('Giriş başarılı.');
  } catch (err) {
    setStatus(err.message, true);
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try { await api('/api/logout', 'POST'); } catch {}
  token = '';
  me = null;
  localStorage.removeItem('token');
  appSection.classList.add('hidden');
  authSection.classList.remove('hidden');
  setStatus('Çıkış yapıldı.');
});

document.getElementById('refreshBtn').addEventListener('click', async () => {
  try { await refreshAll(); setStatus('Yenilendi.'); } catch (e) { setStatus(e.message, true); }
});

document.getElementById('showDashboard').addEventListener('click', () => showPanel('dashboard'));
document.getElementById('showAdmin').addEventListener('click', async () => {
  try {
    await loadAdmin();
    showPanel('admin');
  } catch (e) {
    setStatus(e.message, true);
  }
});

document.getElementById('messageForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const content = new FormData(e.target).get('content');
  try {
    if (active.type === 'group') {
      await api('/api/messages', 'POST', { groupId: active.id, content });
      await loadGroupMessages(active.id);
    } else if (active.type === 'dm') {
      await api('/api/dm', 'POST', { toUserId: active.id, content });
      await loadDmMessages(active.id);
    } else {
      throw new Error('Mesaj göndermek için grup veya DM seç.');
    }
    e.target.reset();
  } catch (err) {
    setStatus(err.message, true);
  }
});

document.getElementById('openCreateGroup').addEventListener('click', () => createGroupDialog.showModal());
document.getElementById('closeGroupDialog').addEventListener('click', () => createGroupDialog.close());
document.getElementById('createGroupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  try {
    await api('/api/groups', 'POST', data);
    createGroupDialog.close();
    await loadSidebar();
    setStatus('Yeni grup oluşturuldu.');
  } catch (err) {
    setStatus(err.message, true);
  }
});

const boot = async () => {
  if (!token) return;
  try {
    const data = await api('/api/me');
    me = data.user;
    authSection.classList.add('hidden');
    appSection.classList.remove('hidden');
    welcomeText.textContent = `Hoş geldin ${me.username}`;
    roleBadge.textContent = `${me.role.toUpperCase()} • ${me.email}`;
    document.getElementById('showAdmin').classList.toggle('hidden', me.role !== 'admin');
    await refreshAll();
    showPanel('dashboard');
  } catch {
    token = '';
    localStorage.removeItem('token');
  }
};

boot();
