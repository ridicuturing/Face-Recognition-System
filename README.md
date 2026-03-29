# 人脸识别系统

基于浏览器的本地/云端人脸识别系统。

## 功能特性

- **本地版本**：数据存储在浏览器本地，无需联网
- **云端版本**：数据存储在服务器，支持多设备同步

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动服务器

```bash
npm start
# 或
node server.js
```

### 3. 访问系统

打开浏览器访问：`http://localhost:3000`

## 使用说明

### 首页
- 点击"本地版本"直接使用本地版
- 点击"云端服务版"进行登录

### 默认账号
- 用户名: `admin`
- 密码: `admin123`
- 用户名: `user`
- 密码: `user123`

### API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/login` | POST | 用户登录 |
| `/api/register` | POST | 用户注册 |
| `/api/me` | GET | 获取当前用户 |
| `/api/faces` | GET | 获取人脸列表 |
| `/api/faces` | POST | 添加人脸 |
| `/api/faces/:id` | DELETE | 删除人脸 |

## 技术栈

- 前端: HTML5, JavaScript, face-api.js
- 后端: Node.js, Express
- 数据库: SQLite
