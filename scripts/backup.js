/**
 * 学员进度管理 - 数据备份脚本
 * 登录 stu-progress.vercel.app，拉取全量数据（学员/职位/投递/日志），存 JSON 到 backups/。
 * 保留最近 30 份，自动清理更早的。
 * 用法：node scripts/backup.js
 * 配置：scripts/backup.config.json（gitignored）{ "baseUrl": "...", "password": "..." }
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cfgPath = path.join(__dirname, 'backup.config.json');
let cfg = { baseUrl: 'https://stu-progress.vercel.app', password: '' };
try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) }; } catch (e) {}
if (process.env.ACCESS_PASSWORD) cfg.password = process.env.ACCESS_PASSWORD;
if (process.env.BASE_URL) cfg.baseUrl = process.env.BASE_URL;

if (!cfg.password) { console.error('缺少密码：请在 scripts/backup.config.json 填 password，或设环境变量 ACCESS_PASSWORD'); process.exit(1); }

async function main() {
  // 1. 登录拿 cookie
  const lr = await fetch(cfg.baseUrl + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: cfg.password })
  });
  if (!lr.ok) throw new Error('登录接口 HTTP ' + lr.status);
  const setCookie = lr.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  if (!cookie) throw new Error('登录未返回会话 cookie，检查密码是否正确');

  // 2. 拉全量数据
  const dr = await fetch(cfg.baseUrl + '/api/data', { headers: { Cookie: cookie } });
  const dj = await dr.json().catch(() => null);
  if (!dj || !dj.ok) throw new Error('拉取数据失败：' + (dj && dj.error ? dj.error : 'HTTP ' + dr.status));
  const data = dj.data;

  // 3. 落盘
  const dir = path.join(ROOT, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const fname = `backup_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.json`;
  const payload = { exportedAt: now.toISOString(), counts: { students: data.students.length, jobs: data.jobs.length, apps: data.apps.length }, data };
  fs.writeFileSync(path.join(dir, fname), JSON.stringify(payload, null, 2));

  // 4. 只保留最近 30 份
  const files = fs.readdirSync(dir).filter(f => /^backup_.*\.json$/.test(f)).sort();
  const removed = [];
  while (files.length > 30) removed.push(files.shift());
  removed.forEach(f => fs.unlinkSync(path.join(dir, f)));

  console.log(`备份完成：${fname}`);
  console.log(`数据量：学员 ${data.students.length} · 职位 ${data.jobs.length} · 投递 ${data.apps.length} · 重复告警 ${(data._dups || []).length}`);
  console.log(`目录：${dir}（共保留 ${files.length - removed.length + (removed.length ? 0 : 0) || files.length} 份）`);
  if (removed.length) console.log(`清理旧备份 ${removed.length} 份`);
  if ((data._dups || []).length) console.log(`⚠️ 注意：检测到 ${data._dups.length} 组重复学员记录，建议登录管理端处理`);
}

main().catch(e => { console.error('备份失败：' + e.message); process.exit(1); });
