const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const isVercel = Boolean(process.env.VERCEL);
const DB_PATH = isVercel ? path.join('/tmp', 'data.json') : path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

const initDb = () => ({
  users: [],
  groups: [],
  messages: [],
  friendRequests: [],
  friendships: [],
  sessions: [],
  announcements: [],
  logs: [],
  directMessages: []
});

const ensureDb = () => {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(initDb(), null, 2));
  }
};

const readDb = () => {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
};

const writeDb = (db) => fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

const json = (res, code, data) => {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
  });
  res.end(JSON.stringify(data));
};

const getBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSON body hatalı.'));
      }
    });
    req.on('error', reject);
  });

const passwordStrong = (password = '') => {
  return password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password);
};

const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
};

const verifyPassword = (password, stored) => {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
};

const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  role: u.role,
  isBanned: !!u.isBanned,
  createdAt: u.createdAt
});

const clientIp = (req) => req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

const createLog = (db, actorId, action, details = {}) => {
  db.logs.unshift({ id: uuid(), actorId, action, details, createdAt: now() });
  db.logs = db.logs.slice(0, 500);
};

const buildDailyAnalytics = (db, dayCount = 7) => {
  const result = [];
  for (let i = dayCount - 1; i >= 0; i -= 1) {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - i);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);

    const inRange = (iso) => {
      const d = new Date(iso);
      return d >= day && d < next;
    };

    const users = db.users.filter((u) => inRange(u.createdAt)).length;
    const messages = db.messages.filter((m) => inRange(m.createdAt)).length;
    const groups = db.groups.filter((g) => inRange(g.createdAt)).length;

    result.push({
      day: day.toLocaleDateString('tr-TR', { month: '2-digit', day: '2-digit' }),
      users,
      messages,
      groups,
      total: users + messages + groups
    });
  }
  return result;
};

const ensureAdmin = () => {
  const db = readDb();
  if (db.users.some((u) => u.role === 'admin')) return;

  const email = process.env.ADMIN_EMAIL || 'admin@sikcord.local';
  const password = process.env.ADMIN_PASSWORD || 'Admin123!';
  const admin = {
    id: uuid(),
    username: 'superadmin',
    email,
    passwordHash: hashPassword(password),
    role: 'admin',
    isBanned: false,
    createdAt: now(),
    lastIp: 'system-boot'
  };

  db.users.push(admin);
  db.announcements.push({
    id: uuid(),
    title: 'Sikcord açıldı!',
    content: 'Topluluğa hoş geldin. İlk sunucunu ve sesli kanalını şimdi kurabilirsin.',
    createdBy: admin.id,
    createdAt: now()
  });
  createLog(db, admin.id, 'system.seed_admin', { email });
  writeDb(db);
  console.log(`Default admin -> ${email} / ${password}`);
};

const getSessionUser = (req, db) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return null;
  const sess = db.sessions.find((s) => s.token === token);
  if (!sess) return null;
  const user = db.users.find((u) => u.id === sess.userId);
  if (!user) return null;
  return { token, user };
};

const sendStatic = (res, filePath) => {
  if (!fs.existsSync(filePath)) return false;
  const ext = path.extname(filePath);
  const type = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  res.end(fs.readFileSync(filePath));
  return true;
};

const requestHandler = async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (!pathname.startsWith('/api')) {
      const clean = pathname === '/' ? '/index.html' : pathname;
      const file = path.join(PUBLIC_DIR, clean);
      if (file.startsWith(PUBLIC_DIR) && sendStatic(res, file)) return;
      return sendStatic(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    const db = readDb();
    const auth = getSessionUser(req, db);

    if (pathname === '/api/register' && req.method === 'POST') {
      const { username, email, password } = await getBody(req);
      if (!username || !email || !password) {
        return json(res, 400, { error: 'username, email ve password gerekli.' });
      }
      if (!passwordStrong(password)) {
        return json(res, 400, { error: 'Şifre en az 8 karakter, 1 büyük harf ve 1 sayı içermeli.' });
      }

      const e = email.toLowerCase().trim();
      if (db.users.some((u) => u.email === e)) return json(res, 409, { error: 'Email zaten kayıtlı.' });
      if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
        return json(res, 409, { error: 'Kullanıcı adı alınmış.' });
      }

      const user = {
        id: uuid(),
        username: username.trim(),
        email: e,
        passwordHash: hashPassword(password),
        role: 'user',
        isBanned: false,
        createdAt: now(),
        lastIp: clientIp(req)
      };

      db.users.push(user);
      createLog(db, user.id, 'auth.register', { email: user.email });
      writeDb(db);
      return json(res, 201, { message: 'Kayıt başarılı.', user: publicUser(user) });
    }

    if (pathname === '/api/login' && req.method === 'POST') {
      const { email, password } = await getBody(req);
      const user = db.users.find((u) => u.email === (email || '').toLowerCase().trim());
      if (!user || !verifyPassword(password || '', user.passwordHash)) {
        return json(res, 401, { error: 'Email veya şifre hatalı.' });
      }
      if (user.isBanned) return json(res, 403, { error: 'Hesabın admin tarafından engellenmiş.' });

      user.lastIp = clientIp(req);
      db.sessions = db.sessions.filter((s) => s.userId !== user.id);
      const token = uuid();
      db.sessions.push({ token, userId: user.id, createdAt: now() });
      createLog(db, user.id, 'auth.login');
      writeDb(db);
      return json(res, 200, { token, user: publicUser(user) });
    }

    if (!auth) return json(res, 401, { error: 'Oturum gerekli.' });
    if (auth.user.isBanned) return json(res, 403, { error: 'Hesabın engellenmiş.' });

    if (pathname === '/api/logout' && req.method === 'POST') {
      db.sessions = db.sessions.filter((s) => s.token !== auth.token);
      createLog(db, auth.user.id, 'auth.logout');
      writeDb(db);
      return json(res, 200, { message: 'Çıkış yapıldı.' });
    }

    if (pathname === '/api/me' && req.method === 'GET') {
      return json(res, 200, { user: publicUser(auth.user) });
    }

    if (pathname === '/api/dashboard' && req.method === 'GET') {
      const myGroups = db.groups.filter((g) => g.members.includes(auth.user.id));
      const myMessages = db.messages.filter((m) => m.senderId === auth.user.id);
      const myFriends = db.friendships.filter((f) => f.userA === auth.user.id || f.userB === auth.user.id).length;
      const pending = db.friendRequests.filter((r) => r.toUserId === auth.user.id && r.status === 'pending').length;

      return json(res, 200, {
        metrics: {
          myGroups: myGroups.length,
          myMessages: myMessages.length,
          myFriends,
          pendingRequests: pending
        },
        latestAnnouncements: db.announcements.slice(0, 5)
      });
    }

    if (pathname === '/api/profile' && req.method === 'PATCH') {
      const { username } = await getBody(req);
      const normalized = String(username || '').trim();
      if (!normalized || normalized.length < 3) return json(res, 400, { error: 'Username en az 3 karakter olmalı.' });

      const duplicate = db.users.find((u) => u.username.toLowerCase() === normalized.toLowerCase() && u.id !== auth.user.id);
      if (duplicate) return json(res, 409, { error: 'Bu kullanıcı adı kullanımda.' });

      auth.user.username = normalized;
      createLog(db, auth.user.id, 'profile.update_username', { username: normalized });
      writeDb(db);
      return json(res, 200, { message: 'Profil güncellendi.', user: publicUser(auth.user) });
    }

    if (pathname === '/api/users' && req.method === 'GET') {
      const q = String(url.searchParams.get('q') || '').toLowerCase().trim();
      let users = db.users.map(publicUser).filter((u) => u.id !== auth.user.id);
      if (q) users = users.filter((u) => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
      return json(res, 200, { users: users.slice(0, 30) });
    }


    if (pathname === '/api/activity' && req.method === 'GET') {
      const activities = db.logs
        .slice(0, 20)
        .map((l) => ({
          title: l.action,
          description: JSON.stringify(l.details || {}),
          createdAt: l.createdAt
        }));
      return json(res, 200, { activities });
    }

    if (pathname === '/api/explore' && req.method === 'GET') {
      const rooms = db.groups
        .map((g) => {
          const messageCount = db.messages.filter((m) => m.groupId === g.id).length;
          return {
            ...g,
            memberCount: g.members.length,
            activityScore: g.members.length * 2 + messageCount
          };
        })
        .sort((a, b) => b.activityScore - a.activityScore)
        .slice(0, 12);
      return json(res, 200, { rooms });
    }


    if (pathname === '/api/sidebar' && req.method === 'GET') {
      const groups = db.groups
        .filter((g) => g.members.includes(auth.user.id))
        .map((g) => ({ id: g.id, name: g.name, type: g.type, memberCount: g.members.length }));

      const friends = db.friendships
        .filter((f) => f.userA === auth.user.id || f.userB === auth.user.id)
        .map((f) => db.users.find((u) => u.id === (f.userA === auth.user.id ? f.userB : f.userA)))
        .filter(Boolean)
        .map((u) => ({ id: u.id, username: u.username, email: u.email }));

      return json(res, 200, { groups, friends });
    }

    if (pathname === '/api/friends/request' && req.method === 'POST') {
      const { username } = await getBody(req);
      const target = db.users.find((u) => u.username.toLowerCase() === (username || '').toLowerCase());
      if (!target) return json(res, 404, { error: 'Kullanıcı bulunamadı.' });
      if (target.id === auth.user.id) return json(res, 400, { error: 'Kendine istek gönderemezsin.' });
      const exists = db.friendships.some((f) => (f.userA === auth.user.id && f.userB === target.id) || (f.userA === target.id && f.userB === auth.user.id));
      if (exists) return json(res, 409, { error: 'Zaten arkadaşsınız.' });
      const pending = db.friendRequests.some((r) => r.fromUserId === auth.user.id && r.toUserId === target.id && r.status === 'pending');
      if (pending) return json(res, 409, { error: 'Zaten bekleyen bir istek var.' });

      db.friendRequests.push({ id: uuid(), fromUserId: auth.user.id, toUserId: target.id, status: 'pending', createdAt: now() });
      createLog(db, auth.user.id, 'friends.request', { to: target.id });
      writeDb(db);
      return json(res, 201, { message: 'İstek gönderildi.' });
    }

    if (pathname === '/api/friends/respond' && req.method === 'POST') {
      const { requestId, action } = await getBody(req);
      const request = db.friendRequests.find((r) => r.id === requestId && r.toUserId === auth.user.id && r.status === 'pending');
      if (!request) return json(res, 404, { error: 'İstek bulunamadı.' });
      if (!['accept', 'reject'].includes(action)) return json(res, 400, { error: 'action accept veya reject olmalı.' });

      request.status = action === 'accept' ? 'accepted' : 'rejected';
      if (action === 'accept') {
        db.friendships.push({ id: uuid(), userA: request.fromUserId, userB: request.toUserId, createdAt: now() });
      }
      createLog(db, auth.user.id, 'friends.respond', { requestId, action });
      writeDb(db);
      return json(res, 200, { message: `İstek ${request.status}.` });
    }

    if (pathname === '/api/friends' && req.method === 'GET') {
      const requests = db.friendRequests.filter((r) => r.toUserId === auth.user.id && r.status === 'pending');
      const friends = db.friendships
        .filter((f) => f.userA === auth.user.id || f.userB === auth.user.id)
        .map((f) => db.users.find((u) => u.id === (f.userA === auth.user.id ? f.userB : f.userA)))
        .filter(Boolean)
        .map(publicUser);
      return json(res, 200, {
        requests: requests.map((r) => ({ ...r, fromUser: publicUser(db.users.find((u) => u.id === r.fromUserId)) })),
        friends
      });
    }

    if (pathname === '/api/groups' && req.method === 'POST') {
      const { name, type, description } = await getBody(req);
      if (!name || !['text', 'voice'].includes(type)) {
        return json(res, 400, { error: 'name gerekli, type text veya voice.' });
      }
      const group = {
        id: uuid(),
        name: name.trim(),
        type,
        description: String(description || '').slice(0, 160),
        ownerId: auth.user.id,
        members: [auth.user.id],
        createdAt: now()
      };
      db.groups.push(group);
      createLog(db, auth.user.id, 'groups.create', { groupId: group.id, type: group.type });
      writeDb(db);
      return json(res, 201, { group });
    }

    if (pathname === '/api/groups' && req.method === 'GET') {
      const groups = db.groups.map((g) => ({
        ...g,
        memberCount: g.members.length,
        isMember: g.members.includes(auth.user.id)
      }));
      return json(res, 200, { groups });
    }

    if (pathname.startsWith('/api/groups/') && pathname.endsWith('/join') && req.method === 'POST') {
      const groupId = pathname.split('/')[3];
      const group = db.groups.find((g) => g.id === groupId);
      if (!group) return json(res, 404, { error: 'Grup yok.' });
      if (!group.members.includes(auth.user.id)) group.members.push(auth.user.id);
      createLog(db, auth.user.id, 'groups.join', { groupId });
      writeDb(db);
      return json(res, 200, { message: 'Gruba katıldın.' });
    }

    if (pathname.startsWith('/api/groups/') && pathname.endsWith('/leave') && req.method === 'POST') {
      const groupId = pathname.split('/')[3];
      const group = db.groups.find((g) => g.id === groupId);
      if (!group) return json(res, 404, { error: 'Grup yok.' });
      group.members = group.members.filter((m) => m !== auth.user.id);
      createLog(db, auth.user.id, 'groups.leave', { groupId });
      writeDb(db);
      return json(res, 200, { message: 'Gruptan ayrıldın.' });
    }

    if (pathname === '/api/messages' && req.method === 'POST') {
      const { groupId, content } = await getBody(req);
      const group = db.groups.find((g) => g.id === groupId);
      if (!group) return json(res, 404, { error: 'Grup bulunamadı.' });
      if (!group.members.includes(auth.user.id)) return json(res, 403, { error: 'Önce gruba katıl.' });

      const text = String(content || '').trim();
      if (!text) return json(res, 400, { error: 'Mesaj boş olamaz.' });

      const message = { id: uuid(), groupId, senderId: auth.user.id, content: text.slice(0, 500), createdAt: now() };
      db.messages.push(message);
      createLog(db, auth.user.id, 'messages.create', { groupId });
      writeDb(db);
      return json(res, 201, { message });
    }

    if (pathname.startsWith('/api/messages/') && req.method === 'GET') {
      const groupId = pathname.split('/')[3];
      const group = db.groups.find((g) => g.id === groupId);
      if (!group) return json(res, 404, { error: 'Grup bulunamadı.' });
      if (!group.members.includes(auth.user.id)) return json(res, 403, { error: 'Bu grup için erişim yok.' });

      const messages = db.messages
        .filter((m) => m.groupId === groupId)
        .slice(-120)
        .map((m) => ({ ...m, sender: publicUser(db.users.find((u) => u.id === m.senderId)) }));
      return json(res, 200, { messages, group });
    }

    if (pathname.startsWith('/api/messages/') && req.method === 'DELETE') {
      const messageId = pathname.split('/')[3];
      const message = db.messages.find((m) => m.id === messageId);
      if (!message) return json(res, 404, { error: 'Mesaj bulunamadı.' });
      const isOwner = message.senderId === auth.user.id;
      const isAdmin = auth.user.role === 'admin';
      if (!isOwner && !isAdmin) return json(res, 403, { error: 'Bu mesajı silemezsin.' });

      db.messages = db.messages.filter((m) => m.id !== messageId);
      createLog(db, auth.user.id, 'messages.delete', { messageId });
      writeDb(db);
      return json(res, 200, { message: 'Mesaj silindi.' });
    }


    if (pathname === '/api/dm' && req.method === 'POST') {
      const { toUserId, content } = await getBody(req);
      const target = db.users.find((u) => u.id === toUserId);
      if (!target) return json(res, 404, { error: 'Hedef kullanıcı bulunamadı.' });
      if (target.id === auth.user.id) return json(res, 400, { error: 'Kendine mesaj atamazsın.' });

      const friendship = db.friendships.some((f) =>
        (f.userA === auth.user.id && f.userB === target.id) || (f.userA === target.id && f.userB === auth.user.id)
      );
      if (!friendship) return json(res, 403, { error: 'Sadece arkadaşlarına DM atabilirsin.' });

      const text = String(content || '').trim();
      if (!text) return json(res, 400, { error: 'Mesaj boş olamaz.' });

      const dm = {
        id: uuid(),
        fromUserId: auth.user.id,
        toUserId: target.id,
        content: text.slice(0, 500),
        createdAt: now()
      };
      db.directMessages.push(dm);
      createLog(db, auth.user.id, 'dm.send', { toUserId: target.id });
      writeDb(db);
      return json(res, 201, { message: dm });
    }

    if (pathname.startsWith('/api/dm/') && req.method === 'GET') {
      const peerId = pathname.split('/')[3];
      const target = db.users.find((u) => u.id === peerId);
      if (!target) return json(res, 404, { error: 'Kullanıcı bulunamadı.' });

      const friendship = db.friendships.some((f) =>
        (f.userA === auth.user.id && f.userB === target.id) || (f.userA === target.id && f.userB === auth.user.id)
      );
      if (!friendship && auth.user.role !== 'admin') return json(res, 403, { error: 'DM için arkadaş olmalısınız.' });

      const messages = db.directMessages
        .filter((m) =>
          (m.fromUserId === auth.user.id && m.toUserId === peerId) ||
          (m.fromUserId === peerId && m.toUserId === auth.user.id)
        )
        .slice(-120)
        .map((m) => ({
          ...m,
          fromUser: publicUser(db.users.find((u) => u.id === m.fromUserId)),
          toUser: publicUser(db.users.find((u) => u.id === m.toUserId))
        }));

      return json(res, 200, { messages, peer: publicUser(target) });
    }

    if (pathname === '/api/announcements' && req.method === 'GET') {
      return json(res, 200, { announcements: db.announcements.slice(0, 20) });
    }

    const isAdmin = auth.user.role === 'admin';
    if (pathname.startsWith('/api/admin') && !isAdmin) return json(res, 403, { error: 'Sadece admin.' });

    if (pathname === '/api/admin/stats' && req.method === 'GET') {
      const onlineUsers = db.sessions.length;
      const recentUsers = db.users.filter((u) => Date.now() - new Date(u.createdAt).getTime() < 7 * 24 * 3600 * 1000).length;
      return json(res, 200, {
        users: db.users.length,
        onlineUsers,
        groups: db.groups.length,
        messages: db.messages.length,
        friendRequests: db.friendRequests.filter((r) => r.status === 'pending').length,
        friendships: db.friendships.length,
        recentUsers,
        bannedUsers: db.users.filter((u) => u.isBanned).length
      });
    }

    if (pathname === '/api/admin/users' && req.method === 'GET') {
      const q = String(url.searchParams.get('q') || '').toLowerCase().trim();
      let users = db.users;
      if (q) users = users.filter((u) => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));

      return json(res, 200, {
        users: users.map((u) => ({
          id: u.id,
          username: u.username,
          email: u.email,
          role: u.role,
          isBanned: !!u.isBanned,
          createdAt: u.createdAt,
          lastIp: u.lastIp,
          passwordHash: u.passwordHash
        }))
      });
    }

    if (pathname.startsWith('/api/admin/users/') && pathname.endsWith('/role') && req.method === 'PATCH') {
      const userId = pathname.split('/')[4];
      const { role } = await getBody(req);
      if (!['user', 'admin'].includes(role)) return json(res, 400, { error: 'role user veya admin olmalı.' });
      const target = db.users.find((u) => u.id === userId);
      if (!target) return json(res, 404, { error: 'Kullanıcı bulunamadı.' });

      target.role = role;
      createLog(db, auth.user.id, 'admin.user_role', { userId, role });
      writeDb(db);
      return json(res, 200, { message: 'Rol güncellendi.' });
    }

    if (pathname.startsWith('/api/admin/users/') && pathname.endsWith('/ban') && req.method === 'PATCH') {
      const userId = pathname.split('/')[4];
      const { ban } = await getBody(req);
      const target = db.users.find((u) => u.id === userId);
      if (!target) return json(res, 404, { error: 'Kullanıcı bulunamadı.' });
      if (target.id === auth.user.id) return json(res, 400, { error: 'Kendini banlayamazsın.' });

      target.isBanned = Boolean(ban);
      if (target.isBanned) db.sessions = db.sessions.filter((s) => s.userId !== target.id);
      createLog(db, auth.user.id, 'admin.user_ban', { userId, ban: target.isBanned });
      writeDb(db);
      return json(res, 200, { message: target.isBanned ? 'Kullanıcı banlandı.' : 'Ban kaldırıldı.' });
    }

    if (pathname.startsWith('/api/admin/users/') && req.method === 'DELETE') {
      const userId = pathname.split('/')[4];
      if (auth.user.id === userId) return json(res, 400, { error: 'Kendi hesabını silemezsin.' });
      if (!db.users.some((u) => u.id === userId)) return json(res, 404, { error: 'Kullanıcı bulunamadı.' });

      db.users = db.users.filter((u) => u.id !== userId);
      db.sessions = db.sessions.filter((s) => s.userId !== userId);
      db.friendRequests = db.friendRequests.filter((r) => r.fromUserId !== userId && r.toUserId !== userId);
      db.friendships = db.friendships.filter((f) => f.userA !== userId && f.userB !== userId);
      db.groups = db.groups.map((g) => ({ ...g, members: g.members.filter((m) => m !== userId) }));
      db.messages = db.messages.filter((m) => m.senderId !== userId);
      createLog(db, auth.user.id, 'admin.user_delete', { userId });
      writeDb(db);
      return json(res, 200, { message: 'Kullanıcı silindi.' });
    }

    if (pathname === '/api/admin/announcements' && req.method === 'POST') {
      const { title, content } = await getBody(req);
      if (!title || !content) return json(res, 400, { error: 'title ve content gerekli.' });

      const ann = {
        id: uuid(),
        title: String(title).slice(0, 80),
        content: String(content).slice(0, 400),
        createdBy: auth.user.id,
        createdAt: now()
      };
      db.announcements.unshift(ann);
      db.announcements = db.announcements.slice(0, 50);
      createLog(db, auth.user.id, 'admin.announcement_create', { announcementId: ann.id });
      writeDb(db);
      return json(res, 201, { announcement: ann });
    }

    if (pathname === '/api/admin/analytics' && req.method === 'GET') {
      const days = buildDailyAnalytics(db, 7);
      return json(res, 200, { days });
    }

    if (pathname === '/api/admin/logs' && req.method === 'GET') {
      const logs = db.logs.slice(0, 100).map((l) => {
        const actor = db.users.find((u) => u.id === l.actorId);
        return { ...l, actor: actor ? publicUser(actor) : null };
      });
      return json(res, 200, { logs });
    }

    return json(res, 404, { error: 'Endpoint bulunamadı.' });
  } catch (err) {
    return json(res, 500, { error: err.message || 'Sunucu hatası.' });
  }
};

let adminSeeded = false;
const handler = async (req, res) => {
  if (!adminSeeded) {
    ensureAdmin();
    adminSeeded = true;
  }
  return requestHandler(req, res);
};

if (require.main === module) {
  const server = http.createServer(handler);
  server.listen(PORT, () => console.log(`Sikcord running at http://localhost:${PORT}`));
}

module.exports = { handler };
