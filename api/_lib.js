/**
 * 学员进度管理 - Vercel Serverless 共享核心
 * 作用：代理飞书开放平台 API + 首次自动建表 + 无状态会话鉴权
 * 注意：Vercel Function 实例间不共享内存，会话改用 HMAC 签名 Cookie（无状态）
 */
const crypto = require('crypto');

const BASE = 'https://open.feishu.cn/open-apis';
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';
const AUTH_ENABLED = !!ACCESS_PASSWORD;
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || '';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const FEISHU_APP_TOKEN = process.env.FEISHU_APP_TOKEN || '';
const SESSION_TTL = 1000 * 60 * 60 * 24 * 7; // 7 天
const COOKIE_NAME = 'stu_auth';

/* ---------------- 无状态会话（HMAC 签名 Cookie） ---------------- */
function sign(payload) { return crypto.createHmac('sha256', ACCESS_PASSWORD || 'x').update(payload).digest('hex'); }
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function issueAuthCookie(req) {
  const exp = Date.now() + SESSION_TTL;
  const payload = String(exp);
  const sig = sign(payload);
  let c = `${COOKIE_NAME}=${payload}.${sig}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL / 1000)}`;
  if ((req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https') c += '; Secure';
  return c;
}
function isAuthed(req) {
  if (!AUTH_ENABLED) return true;
  const c = parseCookies(req)[COOKIE_NAME];
  if (!c) return false;
  const idx = c.lastIndexOf('.');
  if (idx < 0) return false;
  const payload = c.slice(0, idx), sig = c.slice(idx + 1);
  if (sign(payload) !== sig) return false;
  if (parseInt(payload, 10) < Date.now()) return false;
  return true;
}

function configured() {
  return !!(FEISHU_APP_ID && FEISHU_APP_SECRET && FEISHU_APP_TOKEN) &&
    !/填入|你的|xxxx/.test([FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_APP_TOKEN].join(''));
}
function today() { return new Date().toISOString().slice(0, 10); }

/* ---------------- 飞书 API 基础 ---------------- */
let tokenCache = { token: '', exp: 0 };
async function getToken() {
  if (Date.now() < tokenCache.exp - 60000) return tokenCache.token;
  const r = await fetch(BASE + '/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET })
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error('获取飞书凭证失败：' + j.msg + '（请检查 FEISHU_APP_ID / FEISHU_APP_SECRET）');
  tokenCache = { token: j.tenant_access_token, exp: Date.now() + j.expire * 1000 };
  return tokenCache.token;
}
async function feishu(method, url, body) {
  const t = await getToken();
  const r = await fetch(BASE + url, {
    method,
    headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json();
  if (j.code !== 0) {
    let hint = '';
    if (j.code === 91402 || /NOTEXIST/i.test(j.msg)) hint = '（app_token 不对，或还没把应用添加为多维表格的文档应用）';
    if (j.code === 99991672 || /permission/i.test(j.msg)) hint = '（应用缺少多维表格权限 bitable:app，开通后需发布版本）';
    throw new Error(`飞书接口错误 ${j.code}：${j.msg}${hint}`);
  }
  return j.data || {};
}

/* ---------------- 数据表定义与自动建表 ---------------- */
const TABLE_DEFS = {
  '学员': [
    ['姓名', 1], ['联系方式', 1], ['学校', 1], ['专业', 1], ['目标岗位', 1],
    ['辅导阶段', 3, ['咨询中', '辅导中', '求职中', '已上岸', '暂停']],
    ['简历状态', 3, ['待优化', '优化中', '已定稿']],
    ['简历链接', 1], ['作品集', 1], ['备注', 1], ['加入日期', 1]
  ],
  '职位': [
    ['公司', 1], ['职位名称', 1], ['城市', 1], ['薪资', 1], ['渠道', 1],
    ['状态', 3, ['招聘中', '已关闭']], ['JD链接', 1], ['备注', 1]
  ],
  '投递': [
    ['学员姓名', 1], ['公司', 1], ['职位名称', 1],
    ['阶段', 3, ['待投递', '已投递', '笔试', '面试', 'Offer', '未通过']],
    ['投递日期', 1], ['下一步行动', 1], ['备注', 1], ['更新日期', 1]
  ]
};
let tableIds = null;
async function ensureTables() {
  if (tableIds) return tableIds;
  const d = await feishu('GET', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables?page_size=100`);
  const existing = {};
  (d.items || []).forEach(t => existing[t.name] = t.table_id);
  const ids = {};
  for (const name of Object.keys(TABLE_DEFS)) {
    if (existing[name]) { ids[name] = existing[name]; continue; }
    const fields = TABLE_DEFS[name].map(([fn, type, opts]) => ({
      field_name: fn, type,
      ...(opts ? { property: { options: opts.map(o => ({ name: o })) } } : {})
    }));
    const c = await feishu('POST', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables`, { table: { name, fields } });
    ids[name] = c.table_id;
  }
  tableIds = ids;
  return ids;
}

/* ---------------- 记录读写 ---------------- */
async function allRecords(tid) {
  let items = [], pt = '';
  do {
    const d = await feishu('GET', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tid}/records?page_size=500${pt ? '&page_token=' + encodeURIComponent(pt) : ''}`);
    items = items.concat(d.items || []);
    pt = d.has_more ? d.page_token : '';
  } while (pt);
  return items;
}
async function getRecord(tid, rid) {
  const d = await feishu('GET', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tid}/records/${rid}`);
  return d.record;
}
function txt(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(x => (x && (x.text || x.link)) || '').join('');
  if (typeof v === 'object') return v.text || v.link || '';
  return String(v);
}

/* ---------------- 模型映射（飞书记录 <-> 网页数据） ---------------- */
function stuFrom(r) {
  const f = r.fields || {};
  return {
    id: r.record_id,
    name: txt(f['姓名']), contact: txt(f['联系方式']), school: txt(f['学校']),
    major: txt(f['专业']), target: txt(f['目标岗位']),
    stage: txt(f['辅导阶段']) || '咨询中',
    resumeStatus: txt(f['简历状态']) || '待优化',
    resumeUrl: txt(f['简历链接']), notes: txt(f['备注']), createdAt: txt(f['加入日期']),
    portfolio: txt(f['作品集']).split('\n').map(s => s.trim()).filter(Boolean).map((line, i) => {
      const [title, ...rest] = line.split('|');
      return { id: 'pf' + i, title: (title || '').trim(), url: rest.join('|').trim() };
    })
  };
}
function stuFields(d) {
  return {
    '姓名': d.name || '', '联系方式': d.contact || '', '学校': d.school || '', '专业': d.major || '',
    '目标岗位': d.target || '', '辅导阶段': d.stage || '咨询中', '简历状态': d.resumeStatus || '待优化',
    '简历链接': d.resumeUrl || '',
    '作品集': (d.portfolio || []).map(p => p.url ? `${p.title}|${p.url}` : p.title).join('\n'),
    '备注': d.notes || '', '加入日期': d.createdAt || today()
  };
}
function jobFrom(r) {
  const f = r.fields || {};
  return {
    id: r.record_id,
    company: txt(f['公司']), title: txt(f['职位名称']), city: txt(f['城市']),
    salary: txt(f['薪资']), source: txt(f['渠道']),
    status: txt(f['状态']) || '招聘中', link: txt(f['JD链接']), notes: txt(f['备注'])
  };
}
function jobFields(d) {
  return {
    '公司': d.company || '', '职位名称': d.title || '', '城市': d.city || '', '薪资': d.salary || '',
    '渠道': d.source || '', '状态': d.status || '招聘中', 'JD链接': d.link || '', '备注': d.notes || ''
  };
}
function appFrom(r) {
  const f = r.fields || {};
  return {
    id: r.record_id,
    studentName: txt(f['学员姓名']), company: txt(f['公司']), jobTitle: txt(f['职位名称']),
    stage: txt(f['阶段']) || '待投递', appliedAt: txt(f['投递日期']),
    next: txt(f['下一步行动']), notes: txt(f['备注']), updatedAt: txt(f['更新日期'])
  };
}
function appFields(d, names) {
  return {
    '学员姓名': names.studentName || '', '公司': names.company || '', '职位名称': names.jobTitle || '',
    '阶段': d.stage || '待投递', '投递日期': d.appliedAt || '',
    '下一步行动': d.next || '', '备注': d.notes || '', '更新日期': d.updatedAt || today()
  };
}

async function getData() {
  const ids = await ensureTables();
  const [sr, jr, ar] = await Promise.all([allRecords(ids['学员']), allRecords(ids['职位']), allRecords(ids['投递'])]);
  const students = sr.map(stuFrom);
  const jobs = jr.map(jobFrom);
  const apps = ar.map(appFrom).map(a => {
    const s = students.find(x => x.name === a.studentName);
    const j = jobs.find(x => x.company === a.company && x.title === a.jobTitle);
    return { ...a, studentId: s ? s.id : '', jobId: j ? j.id : '' };
  });
  return { students, jobs, apps };
}

async function saveEntity({ type, id, data }) {
  const ids = await ensureTables();
  let tid, fields;
  if (type === 'student') { tid = ids['学员']; fields = stuFields(data); }
  else if (type === 'job') { tid = ids['职位']; fields = jobFields(data); }
  else if (type === 'app') {
    tid = ids['投递'];
    const names = { studentName: data.studentName || '', company: data.company || '', jobTitle: data.jobTitle || '' };
    if (data.studentId) {
      try { const r = await getRecord(ids['学员'], data.studentId); names.studentName = txt(r.fields['姓名']); } catch (e) {}
    }
    if (data.jobId) {
      try { const r = await getRecord(ids['职位'], data.jobId); names.company = txt(r.fields['公司']); names.jobTitle = txt(r.fields['职位名称']); } catch (e) {}
    }
    fields = appFields(data, names);
  } else throw new Error('未知类型');
  if (id) await feishu('PUT', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tid}/records/${id}`, { fields });
  else await feishu('POST', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tid}/records`, { fields });
  return {};
}

async function deleteEntity({ type, id }) {
  const ids = await ensureTables();
  const del = (tid, rid) => feishu('DELETE', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tid}/records/${rid}`);
  if (type === 'student') {
    let name = '';
    try { const r = await getRecord(ids['学员'], id); name = txt(r.fields['姓名']); } catch (e) {}
    if (name) {
      const apps = await allRecords(ids['投递']);
      for (const a of apps) if (txt(a.fields['学员姓名']) === name) await del(ids['投递'], a.record_id);
    }
    await del(ids['学员'], id);
  } else if (type === 'job') {
    let company = '', title = '';
    try { const r = await getRecord(ids['职位'], id); company = txt(r.fields['公司']); title = txt(r.fields['职位名称']); } catch (e) {}
    if (company || title) {
      const apps = await allRecords(ids['投递']);
      for (const a of apps) if (txt(a.fields['公司']) === company && txt(a.fields['职位名称']) === title) await del(ids['投递'], a.record_id);
    }
    await del(ids['职位'], id);
  } else if (type === 'app') {
    await del(ids['投递'], id);
  } else throw new Error('未知类型');
  return {};
}

async function migrate(local) {
  const ids = await ensureTables();
  const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
  const batchCreate = async (tid, records) => {
    for (const part of chunk(records, 100)) {
      if (part.length) await feishu('POST', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tid}/records/batch_create`, { records: part.map(fields => ({ fields })) });
    }
  };
  const students = local.students || [], jobs = local.jobs || [], apps = local.apps || [];
  await batchCreate(ids['学员'], students.map(stuFields));
  await batchCreate(ids['职位'], jobs.map(jobFields));
  const appRecords = apps.map(a => {
    const s = students.find(x => x.id === a.studentId);
    const j = jobs.find(x => x.id === a.jobId);
    return appFields(a, { studentName: s ? s.name : '', company: j ? j.company : '', jobTitle: j ? j.title : '' });
  });
  await batchCreate(ids['投递'], appRecords);
  return { students: students.length, jobs: jobs.length, apps: apps.length };
}

/* ---------------- 请求处理 ---------------- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 10 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('请求体格式错误')); } });
    req.on('error', reject);
  });
}
function json(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

async function handleApi(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    // 登录 / 登出不受飞书配置与登录态限制
    if (p === '/api/login' && req.method === 'POST') {
      const b = await readBody(req);
      if (!AUTH_ENABLED) return json(res, { ok: false, error: '服务端未设置访问口令（请在 Vercel 环境变量设置 ACCESS_PASSWORD）' });
      if (b.password === ACCESS_PASSWORD) {
        res.setHeader('Set-Cookie', issueAuthCookie(req));
        return json(res, { ok: true });
      }
      return json(res, { ok: false, error: '访问口令错误' }, 401);
    }
    if (p === '/api/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
      return json(res, { ok: true });
    }
    if (!configured()) return json(res, { ok: false, error: '尚未配置飞书应用：请在 Vercel 环境变量填写 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_APP_TOKEN' });
    if (AUTH_ENABLED && !isAuthed(req)) return json(res, { ok: false, error: '未登录或登录已过期', needLogin: true }, 401);
    if (p === '/api/data' && req.method === 'GET') return json(res, { ok: true, data: await getData() });
    if (p === '/api/save' && req.method === 'POST') { await saveEntity(await readBody(req)); return json(res, { ok: true }); }
    if (p === '/api/delete' && req.method === 'POST') { await deleteEntity(await readBody(req)); return json(res, { ok: true }); }
    if (p === '/api/migrate' && req.method === 'POST') return json(res, { ok: true, result: await migrate(await readBody(req)) });
    return json(res, { ok: false, error: '接口不存在' });
  } catch (e) {
    return json(res, { ok: false, error: e.message });
  }
}

module.exports = { handleApi };
