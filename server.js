const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = 'face-recognition-secret-key-2024';

// 中间件
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// 数据库初始化
const db = new Database('face Recognition.db');

// 创建表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS faces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    descriptors TEXT NOT NULL,
    thumbnail TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// 初始化默认用户
const initUsers = [
  { username: 'admin', password: 'admin123' },
  { username: 'user', password: 'user123' }
];

const existingUsers = db.prepare('SELECT COUNT(*) as count FROM users').get();
if (existingUsers.count === 0) {
  const insertUser = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
  for (const user of initUsers) {
    const hashedPassword = bcrypt.hashSync(user.password, 10);
    insertUser.run(user.username, hashedPassword);
  }
  console.log('默认用户已创建: admin/admin123, user/user123');
}

// 认证中间件
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: '未授权' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token无效' });
    }
    req.user = user;
    next();
  });
}

// ============ API 接口 ============

// 用户登录
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: '请提供用户名和密码' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
  
  res.json({
    token,
    user: { id: user.id, username: user.username }
  });
});

// 获取当前用户信息
app.get('/api/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// 获取用户的人脸数据
app.get('/api/faces', authenticateToken, (req, res) => {
  const faces = db.prepare('SELECT * FROM faces WHERE user_id = ? ORDER BY updated_at DESC').all(req.user.id);
  
  const result = faces.map(face => ({
    id: face.id,
    name: face.name,
    descriptors: JSON.parse(face.descriptors),
    thumbnail: face.thumbnail,
    updatedAt: face.updated_at
  }));
  
  res.json(result);
});

// 添加人脸数据
app.post('/api/faces', authenticateToken, (req, res) => {
  const { name, descriptors, thumbnail } = req.body;
  
  if (!name || !descriptors) {
    return res.status(400).json({ error: '请提供名称和描述符' });
  }

  const descriptorsJson = JSON.stringify(descriptors);
  
  // 检查是否已存在同名
  const existing = db.prepare('SELECT id FROM faces WHERE user_id = ? AND name = ?').get(req.user.id, name);
  
  if (existing) {
    // 更新
    db.prepare('UPDATE faces SET descriptors = ?, thumbnail = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(descriptorsJson, thumbnail || null, existing.id);
    res.json({ success: true, id: existing.id, message: '人脸数据已更新' });
  } else {
    // 新增
    const result = db.prepare('INSERT INTO faces (user_id, name, descriptors, thumbnail) VALUES (?, ?, ?, ?)')
      .run(req.user.id, name, descriptorsJson, thumbnail || null);
    res.json({ success: true, id: result.lastInsertRowid, message: '人脸数据已添加' });
  }
});

// 删除人脸数据
app.delete('/api/faces/:id', authenticateToken, req => {
  const { id } = req.params;
  
  const result = db.prepare('DELETE FROM faces WHERE id = ? AND user_id = ?').run(id, req.user.id);
  
  if (result.changes > 0) {
    return { success: true, message: '删除成功' };
  } else {
    return { error: '删除失败，人脸不存在' };
  }
});

// 用户注册
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: '请提供用户名和密码' });
  }

  try {
    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hashedPassword);
    
    res.json({ success: true, message: '注册成功', userId: result.lastInsertRowid });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: '用户名已存在' });
    }
    res.status(500).json({ error: '注册失败' });
  }
});

// 静态文件服务
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/local', (req, res) => {
  res.sendFile(path.join(__dirname, 'local.html'));
});

app.get('/cloud', (req, res) => {
  res.sendFile(path.join(__dirname, 'cloud.html'));
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`首页: http://localhost:${PORT}/index.html`);
});
