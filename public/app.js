const state = {
  token: localStorage.getItem('token') || '',
  user: null,
  activeChat: null,
  activeType: 'private'
};

const socket = io();
const messageBox = document.getElementById('messages');

function authHeaders() {
  return { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' };
}

async function api(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Hata');
  return data;
}

function openAuth() { document.getElementById('authDialog').showModal(); }
function closeAuth() { document.getElementById('authDialog').close(); }
document.getElementById('openAuth').onclick = openAuth;
document.getElementById('closeAuth').onclick = closeAuth;

async function loadMe() {
  if (!state.token) return;
  try {
    state.user = await api('/api/me', { headers: authHeaders() });
    document.getElementById('profileCard').textContent = `${state.user.username} (${state.user.email})`;
    socket.emit('auth', state.token);
    await loadFriends();
    await loadGroups();
  } catch {
    localStorage.removeItem('token');
  }
}

async function loadFriends() {
  const data = await api('/api/friends', { headers: authHeaders() });
  const ul = document.getElementById('friendList');
  ul.innerHTML = '';
  data.friends.forEach((f) => {
    const li = document.createElement('li');
    li.innerHTML = `<b>${f.username}</b><button data-id="${f.id}">Sohbet</button>`;
    li.querySelector('button').onclick = () => selectPrivateChat(f.id, f.username);
    ul.appendChild(li);
  });

  const pending = document.getElementById('pendingList');
  pending.innerHTML = '';
  data.pending.forEach((p) => {
    const li = document.createElement('li');
    li.innerHTML = `${p.from_user} <button>Kabul</button>`;
    li.querySelector('button').onclick = async () => {
      await api(`/api/friends/respond/${p.id}`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ action: 'accepted' })
      });
      loadFriends();
    };
    pending.appendChild(li);
  });
}

async function loadGroups() {
  const groups = await api('/api/groups', { headers: authHeaders() });
  const ul = document.getElementById('groupList');
  ul.innerHTML = '';
  groups.forEach((g) => {
    const li = document.createElement('li');
    li.innerHTML = `<b>${g.name}</b><button data-id="${g.id}">Aç</button>`;
    li.querySelector('button').onclick = () => selectGroupChat(g.id, g.name);
    ul.appendChild(li);
  });
}

async function selectPrivateChat(friendId, username) {
  state.activeType = 'private';
  state.activeChat = friendId;
  document.getElementById('chatTitle').textContent = `${username} ile sohbet`;
  const messages = await api(`/api/messages/private/${friendId}`, { headers: authHeaders() });
  renderMessages(messages);
}

async function selectGroupChat(groupId, name) {
  state.activeType = 'group';
  state.activeChat = groupId;
  document.getElementById('chatTitle').textContent = `#${name}`;
  const messages = await api(`/api/messages/group/${groupId}`, { headers: authHeaders() });
  renderMessages(messages);
}

function renderMessages(messages) {
  messageBox.innerHTML = '';
  messages.forEach(addMessage);
  messageBox.scrollTop = messageBox.scrollHeight;
}

function addMessage(m) {
  const div = document.createElement('div');
  div.className = `msg ${m.sender_id === state.user?.id ? 'me' : ''}`;
  const img = m.image_url ? `<div><img src="${m.image_url}" style="max-width:200px;border-radius:8px;"/></div>` : '';
  div.innerHTML = `<b>${m.sender_name || 'Ben'}:</b> ${m.content || ''}${img}`;
  messageBox.appendChild(div);
}

document.getElementById('authForm').addEventListener('submit', (e) => e.preventDefault());
document.getElementById('loginBtn').onclick = async () => {
  const form = new FormData(document.getElementById('authForm'));
  const payload = Object.fromEntries(form.entries());
  const data = await api('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  state.token = data.token;
  localStorage.setItem('token', state.token);
  closeAuth();
  loadMe();
};

document.getElementById('registerBtn').onclick = async () => {
  const form = new FormData(document.getElementById('authForm'));
  const payload = Object.fromEntries(form.entries());
  await api('/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  alert('Kayıt tamamlandı, giriş yapabilirsiniz.');
};

document.getElementById('searchBtn').onclick = async () => {
  const q = document.getElementById('userSearch').value;
  const users = await api(`/api/users/search?q=${encodeURIComponent(q)}`, { headers: authHeaders() });
  const ul = document.getElementById('searchResults');
  ul.innerHTML = '';
  users.forEach((u) => {
    const li = document.createElement('li');
    li.innerHTML = `${u.username} <button>Arkadaş Ekle</button>`;
    li.querySelector('button').onclick = async () => {
      await api(`/api/friends/request/${u.id}`, { method: 'POST', headers: authHeaders() });
      alert('İstek gönderildi');
    };
    ul.appendChild(li);
  });
};

document.getElementById('groupForm').onsubmit = async (e) => {
  e.preventDefault();
  const name = new FormData(e.target).get('name');
  await api('/api/groups', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name }) });
  e.target.reset();
  loadGroups();
};

document.getElementById('messageForm').onsubmit = async (e) => {
  e.preventDefault();
  if (!state.activeChat) return alert('Önce bir sohbet seçin.');
  const content = document.getElementById('messageInput').value;
  const file = document.getElementById('imageInput').files[0];
  let imageUrl = null;
  if (file) {
    const fd = new FormData();
    fd.append('image', file);
    const r = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${state.token}` }, body: fd });
    const d = await r.json();
    imageUrl = d.imageUrl;
  }

  if (state.activeType === 'private') {
    socket.emit('private:message', { toUserId: state.activeChat, content, imageUrl });
  } else {
    socket.emit('group:message', { groupId: state.activeChat, content, imageUrl });
  }
  document.getElementById('messageInput').value = '';
  document.getElementById('imageInput').value = '';
};

socket.on('private:message', (m) => {
  if (state.activeType === 'private' && (m.sender_id === state.activeChat || m.receiver_id === state.activeChat)) addMessage(m);
});

socket.on('group:message', (m) => {
  if (state.activeType === 'group' && m.group_id === state.activeChat) addMessage(m);
});

let pc;
document.getElementById('joinVoice').onclick = async () => {
  const roomId = document.getElementById('voiceRoom').value || '1';
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  pc = new RTCPeerConnection();
  stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  pc.ontrack = (ev) => { document.getElementById('remoteAudio').srcObject = ev.streams[0]; };
  pc.onicecandidate = (ev) => {
    if (ev.candidate) socket.emit('voice:signal', { roomId, signal: { candidate: ev.candidate } });
  };
  socket.emit('voice:join', { roomId });
};

socket.on('voice:user-joined', async ({ socketId }) => {
  if (!pc) return;
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('voice:signal', { to: socketId, roomId: '1', signal: { sdp: pc.localDescription } });
});

socket.on('voice:signal', async ({ from, signal }) => {
  if (!pc) return;
  if (signal.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    if (signal.sdp.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('voice:signal', { to: from, roomId: '1', signal: { sdp: pc.localDescription } });
    }
  }
  if (signal.candidate) await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
});

loadMe();
