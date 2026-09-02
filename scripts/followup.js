/**
 * 学员进度管理 - 待跟进早报脚本
 * 登录 stu-progress.vercel.app，拉取数据，按投递表的「跟进日期」计算逾期 / 今日 / 3 天内待跟进清单，输出早报文本。
 * 终态投递（Offer / 未通过）不计入跟进。
 * 用法：node scripts/followup.js
 * 配置：scripts/backup.config.json（gitignored）{ "baseUrl": "...", "password": "..." }
 */
const fs = require('fs');
const path = require('path');

const cfgPath = path.join(__dirname, 'backup.config.json');
let cfg = { baseUrl: 'https://stu-progress.vercel.app', password: '' };
try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) }; } catch (e) {}
if (process.env.ACCESS_PASSWORD) cfg.password = process.env.ACCESS_PASSWORD;
if (process.env.BASE_URL) cfg.baseUrl = process.env.BASE_URL;

if (!cfg.password) { console.error('缺少密码：请在 scripts/backup.config.json 填 password，或设环境变量 ACCESS_PASSWORD'); process.exit(1); }

const TERMINAL = ['Offer', 'offer', '未通过'];
function parseDate(s) {
  if (!s) return null;
  const n = Number(s);
  if (!isNaN(n) && n > 946684800000) return new Date(n);       // 毫秒时间戳
  if (!isNaN(n) && n > 946684800) return new Date(n * 1000);   // 秒时间戳
  const d = new Date(String(s).replace(/\./g, '-'));
  return isNaN(d.getTime()) ? null : d;
}
function dayDiff(a, b) { return Math.round((a - b) / 86400000); }
function fmt(d) { return `${d.getMonth() + 1}/${d.getDate()}`; }

async function main() {
  const lr = await fetch(cfg.baseUrl + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: cfg.password })
  });
  if (!lr.ok) throw new Error('登录接口 HTTP ' + lr.status);
  const cookie = (lr.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error('登录未返回会话 cookie，检查密码是否正确');

  const dr = await fetch(cfg.baseUrl + '/api/data', { headers: { Cookie: cookie } });
  const dj = await dr.json().catch(() => null);
  if (!dj || !dj.ok) throw new Error('拉取数据失败：' + (dj && dj.error ? dj.error : 'HTTP ' + dr.status));
  const { students, apps } = dj.data;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const stageOf = name => (students.find(s => s.name === name) || {}).stage || '';

  const overdue = [], todayList = [], soon = [];
  for (const a of apps) {
    if (TERMINAL.some(t => (a.stage || '').includes(t))) continue;
    const next = parseDate(a.followUpDate);
    if (!next) continue;
    const diff = dayDiff(next, today);
    const item = {
      who: `${a.studentName} · ${a.company || '?'}${a.jobTitle ? ' ' + a.jobTitle : ''}`,
      stage: a.stage || '待投递', next, next2: a.next || ''
    };
    if (diff < 0) overdue.push({ ...item, diff: -diff });
    else if (diff === 0) todayList.push(item);
    else if (diff <= 3) soon.push({ ...item, diff });
  }
  const line = (it, tag) => {
    const when = tag === 'over' ? `逾期 ${it.diff} 天` : tag === 'today' ? '今天' : `${it.diff} 天后`;
    return `- ${it.who}（${it.stage}）【${when}，${fmt(it.next)}】${it.next2 ? ' 下一步：' + it.next2 : ''}`;
  };

  console.log('════════ 学员跟进早报 ' + fmt(new Date()) + ' ════════');
  console.log(`学员总数 ${students.length} · 投递总数 ${apps.length}`);
  console.log('');
  console.log(`🔴 逾期未跟进（${overdue.length} 条）：`);
  console.log(overdue.length ? overdue.map(it => line(it, 'over')).join('\n') : '  无 ✅');
  console.log('');
  console.log(`🟡 今天应跟进（${todayList.length} 条）：`);
  console.log(todayList.length ? todayList.map(it => line(it, 'today')).join('\n') : '  无 ✅');
  console.log('');
  console.log(`🟢 未来 3 天内（${soon.length} 条）：`);
  console.log(soon.length ? soon.map(it => line(it, 'soon')).join('\n') : '  无 ✅');
  console.log('');
  if (!overdue.length && !todayList.length && !soon.length) console.log('🎉 当前没有需要跟进的投递，一切正常！');
}
main().catch(e => { console.error('早报生成失败：' + e.message); process.exit(1); });
