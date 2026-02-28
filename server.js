const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const Database = require('better-sqlite3');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_voice_chat_key';

const db = new Database('app.db');
db.pragma('journal_mode = WAL');

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      is_admin INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT,
      last_ip TEXT
    );

    CREATE TABLE IF NOT EXISTS friend_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(sender_id, receiver_id)
    );

    CREATE TABLE IF NOT EXISTS friendships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      friend_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, friend_id)
    );

    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_id INTEGER NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT DEFAULT 'member',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER,
      group_id INTEGER,
      content TEXT,
      image_url TEXT,
      type TEXT DEFAULT 'text',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS voice_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const adminUser = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminUser) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (username, email, password_hash, is_admin) VALUES (?, ?, ?, 1)')
      .run('admin', 'admin@local.dev', hash);
    console.log('Default admin created: admin / admin123');
  }
}

initDb();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, path.join(__dirname, 'public', 'uploads')),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});
const upload = multer({ storage });

function getIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function authRequired(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token gerekli' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Geçersiz token' });
  }
}

function adminRequired(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Admin yetkisi gerekli' });
  next();
}

app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'Eksik bilgi' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
      .run(username.trim(), email.trim().toLowerCase(), hash);
    res.json({ id: info.lastInsertRowid, message: 'Kayıt başarılı' });
  } catch (err) {
    res.status(400).json({ error: 'Kullanıcı adı veya e-posta kullanımda' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email?.trim().toLowerCase());
  if (!user) return res.status(401).json({ error: 'Kullanıcı bulunamadı' });
  if (!bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Şifre yanlış' });
  }
  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP, last_ip = ? WHERE id = ?').run(getIp(req), user.id);
  const token = jwt.sign({ id: user.id, username: user.username, is_admin: !!user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, username: user.username, email: user.email, is_admin: !!user.is_admin } });
});

app.get('/api/me', authRequired, (req, res) => {
  const user = db.prepare('SELECT id, username, email, avatar_url, is_admin, created_at, last_login_at FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

app.get('/api/users/search', authRequired, (req, res) => {
  const q = (req.query.q || '').toString();
  const users = db.prepare(`
    SELECT id, username, email, avatar_url
    FROM users
    WHERE username LIKE ? AND id != ?
    LIMIT 20
  `).all(`%${q}%`, req.user.id);
  res.json(users);
});

app.post('/api/friends/request/:id', authRequired, (req, res) => {
  const receiverId = Number(req.params.id);
  if (!receiverId || receiverId === req.user.id) return res.status(400).json({ error: 'Geçersiz kullanıcı' });
  try {
    db.prepare('INSERT INTO friend_requests (sender_id, receiver_id) VALUES (?, ?)').run(req.user.id, receiverId);
    res.json({ message: 'Arkadaşlık isteği gönderildi' });
  } catch {
    res.status(400).json({ error: 'İstek zaten mevcut' });
  }
});

app.post('/api/friends/respond/:requestId', authRequired, (req, res) => {
  const requestId = Number(req.params.requestId);
  const { action } = req.body;
  const fr = db.prepare('SELECT * FROM friend_requests WHERE id = ? AND receiver_id = ?').get(requestId, req.user.id);
  if (!fr) return res.status(404).json({ error: 'İstek bulunamadı' });

  const tx = db.transaction(() => {
    db.prepare('UPDATE friend_requests SET status = ? WHERE id = ?').run(action, requestId);
    if (action === 'accepted') {
      db.prepare('INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)').run(fr.sender_id, fr.receiver_id);
      db.prepare('INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)').run(fr.receiver_id, fr.sender_id);
    }
  });
  tx();
  res.json({ message: 'İstek güncellendi' });
});

app.get('/api/friends', authRequired, (req, res) => {
  const friends = db.prepare(`
    SELECT u.id, u.username, u.email, u.avatar_url
    FROM friendships f
    JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ?
  `).all(req.user.id);

  const pending = db.prepare(`
    SELECT fr.id, u.username AS from_user
    FROM friend_requests fr
    JOIN users u ON u.id = fr.sender_id
    WHERE fr.receiver_id = ? AND fr.status = 'pending'
  `).all(req.user.id);

  res.json({ friends, pending });
});

app.post('/api/groups', authRequired, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Grup adı gerekli' });
  const tx = db.transaction(() => {
    const info = db.prepare('INSERT INTO groups (name, owner_id, description) VALUES (?, ?, ?)').run(name, req.user.id, description || '');
    db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)').run(info.lastInsertRowid, req.user.id, 'owner');
    return info.lastInsertRowid;
  });
  const groupId = tx();
  res.json({ groupId, message: 'Grup oluşturuldu' });
});

app.get('/api/groups', authRequired, (req, res) => {
  const groups = db.prepare(`
    SELECT g.id, g.name, g.description, g.created_at
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE gm.user_id = ?
  `).all(req.user.id);
  res.json(groups);
});

app.post('/api/groups/:id/members', authRequired, (req, res) => {
  const groupId = Number(req.params.id);
  const { userId } = req.body;
  const membership = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, req.user.id);
  if (!membership) return res.status(403).json({ error: 'Grup üyesi değilsiniz' });
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupId, Number(userId));
  res.json({ message: 'Üye eklendi' });
});

app.get('/api/messages/private/:friendId', authRequired, (req, res) => {
  const friendId = Number(req.params.friendId);
  const rows = db.prepare(`
    SELECT m.*, u.username AS sender_name
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
    ORDER BY m.id ASC
  `).all(req.user.id, friendId, friendId, req.user.id);
  res.json(rows);
});

app.get('/api/messages/group/:groupId', authRequired, (req, res) => {
  const groupId = Number(req.params.groupId);
  const rows = db.prepare(`
    SELECT m.*, u.username AS sender_name
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.group_id = ?
    ORDER BY m.id ASC
  `).all(groupId);
  res.json(rows);
});

app.post('/api/upload', authRequired, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya yok' });
  res.json({ imageUrl: `/uploads/${req.file.filename}` });
});

app.get('/api/admin/users', authRequired, adminRequired, (req, res) => {
  const users = db.prepare(`
    SELECT id, username, email, password_hash, last_ip, is_admin, created_at, last_login_at
    FROM users
    ORDER BY id DESC
  `).all();
  res.json(users);
});

app.get('/api/admin/stats', authRequired, adminRequired, (_, res) => {
  const [users] = db.prepare('SELECT COUNT(*) as c FROM users').all();
  const [groups] = db.prepare('SELECT COUNT(*) as c FROM groups').all();
  const [messages] = db.prepare('SELECT COUNT(*) as c FROM messages').all();
  const [friends] = db.prepare('SELECT COUNT(*) as c FROM friendships').all();
  res.json({ users: users.c, groups: groups.c, messages: messages.c, friendships: friends.c });
});

const onlineUsers = new Map();

io.on('connection', (socket) => {
  socket.on('auth', (token) => {
    try {
      const user = jwt.verify(token, JWT_SECRET);
      socket.data.user = user;
      onlineUsers.set(user.id, socket.id);
      io.emit('presence:update', Array.from(onlineUsers.keys()));
    } catch {
      socket.emit('auth:error', 'Token doğrulanamadı');
    }
  });

  socket.on('private:message', ({ toUserId, content, imageUrl }) => {
    const user = socket.data.user;
    if (!user) return;
    const info = db.prepare('INSERT INTO messages (sender_id, receiver_id, content, image_url, type) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, Number(toUserId), content || '', imageUrl || null, imageUrl ? 'image' : 'text');
    const payload = {
      id: info.lastInsertRowid,
      sender_id: user.id,
      sender_name: user.username,
      receiver_id: Number(toUserId),
      content,
      image_url: imageUrl || null,
      created_at: new Date().toISOString()
    };
    const targetSocket = onlineUsers.get(Number(toUserId));
    if (targetSocket) io.to(targetSocket).emit('private:message', payload);
    socket.emit('private:message', payload);
  });

  socket.on('group:message', ({ groupId, content, imageUrl }) => {
    const user = socket.data.user;
    if (!user) return;
    const info = db.prepare('INSERT INTO messages (sender_id, group_id, content, image_url, type) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, Number(groupId), content || '', imageUrl || null, imageUrl ? 'image' : 'text');
    const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(Number(groupId));
    const payload = {
      id: info.lastInsertRowid,
      sender_id: user.id,
      sender_name: user.username,
      group_id: Number(groupId),
      content,
      image_url: imageUrl || null,
      created_at: new Date().toISOString()
    };
    members.forEach((m) => {
      const sid = onlineUsers.get(m.user_id);
      if (sid) io.to(sid).emit('group:message', payload);
    });
  });

  socket.on('voice:join', ({ roomId }) => {
    socket.join(`voice:${roomId}`);
    socket.to(`voice:${roomId}`).emit('voice:user-joined', { userId: socket.data.user?.id, socketId: socket.id });
  });

  socket.on('voice:signal', ({ roomId, to, signal }) => {
    io.to(to).emit('voice:signal', { from: socket.id, signal, roomId });
  });

  socket.on('disconnect', () => {
    if (socket.data.user?.id) {
      onlineUsers.delete(socket.data.user.id);
      io.emit('presence:update', Array.from(onlineUsers.keys()));
    }
  });
});

app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server http://localhost:${PORT}`);
});
