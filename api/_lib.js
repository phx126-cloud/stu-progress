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
const DELETE_PASSWORD = process.env.DELETE_PASSWORD || '';
const DELETE_PROTECTED = !!DELETE_PASSWORD; // 仅当设置了删除密码才启用删除校验
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

/* ---------------- 学员端无状态会话（独立 Cookie） ---------------- */
const STU_COOKIE = 'stu_session';
function signStu(payload) { return crypto.createHmac('sha256', (ACCESS_PASSWORD || 'x') + ':stu').update(payload).digest('hex'); }
function issueStuCookie(req, studentId) {
  const exp = Date.now() + SESSION_TTL;
  const payload = `${studentId}:${exp}`;
  const sig = signStu(payload);
  let c = `${STU_COOKIE}=${encodeURIComponent(payload)}.${sig}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL / 1000)}`;
  if ((req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https') c += '; Secure';
  return c;
}
function isStudentAuthed(req) {
  if (!AUTH_ENABLED) return null;
  const c = parseCookies(req)[STU_COOKIE];
  if (!c) return null;
  const idx = c.lastIndexOf('.');
  if (idx < 0) return null;
  const payload = c.slice(0, idx), sig = c.slice(idx + 1);
  if (signStu(payload) !== sig) return null;
  const parts = payload.split(':');
  if (parts.length < 2) return null;
  if (parseInt(parts[1], 10) < Date.now()) return null;
  return decodeURIComponent(parts[0]);
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
    ['简历链接', 1], ['简历文件名', 1], ['作品集', 1], ['备注', 1], ['期望城市', 1], ['加入日期', 1], ['学员密码', 1], ['简历历史', 1]
  ],
  '职位': [
    ['公司', 1], ['职位名称', 1], ['职位类型', 3, ['实习', '校招', '社招', '兼职']],
    ['城市', 1], ['薪资', 1], ['渠道', 1],
    ['公司性质', 3, ['央企', '国企', '上市', '大厂', '外企', '中小']],
    ['行业', 1], ['学历要求', 3, ['不限', '大专', '本科', '硕士', '博士']],
    ['届数', 3, ['不限', '26届', '27届', '28届', '29届']], ['专业要求', 1],
    ['状态', 3, ['招聘中', '已关闭']], ['JD链接', 1], ['备注', 1], ['职位图片', 1]
  ],
  '投递': [
    ['学员姓名', 1], ['公司', 1], ['职位名称', 1],
    ['阶段', 3, ['待投递', '已投递', '笔试', '面试', 'Offer', '未通过']],
    ['投递日期', 1], ['跟进日期', 1], ['下一步行动', 1], ['备注', 1], ['更新日期', 1], ['阶段变更时间', 1]
  ],
  '操作日志': [
    ['操作', 1], ['对象', 1], ['详情', 1], ['操作人', 1], ['时间', 1]
  ]
};
async function getTableFields(tid) {
  const d = await feishu('GET', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tid}/fields?page_size=200`);
  return d.items || [];
}
let tableIds = null;
let tableFieldNames = {}; // table_name -> Set(field_name)，保存时过滤掉飞书实际不存在的字段
// 热路径：只确认表存在并返回 table_id，不校验字段类型（字段校验很慢且表结构已稳定）
async function ensureTables() {
  if (tableIds) return tableIds;
  const d = await feishu('GET', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables?page_size=100`);
  const existing = {};
  (d.items || []).forEach(t => existing[t.name] = t.table_id);
  const ids = {};
  for (const name of Object.keys(TABLE_DEFS)) {
    let tid = existing[name];
    if (!tid) {
      const def = TABLE_DEFS[name];
      const fields = def.map(([fn, type, opts]) => ({
        field_name: fn, type,
        ...(opts ? { property: { options: opts.map(o => ({ name: o })) } } : {})
      }));
      const c = await feishu('POST', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables`, { table: { name, fields } });
      tid = c.table_id;
    }
    ids[name] = tid;
  }
  tableIds = ids;
  return ids;
}
// 仅在需要调整表结构（补列 / 修字段类型）时手动调用，平时不跑，避免无谓的飞书请求
async function repairTables() {
  const d = await feishu('GET', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables?page_size=100`);
  const existing = {};
  (d.items || []).forEach(t => existing[t.name] = t.table_id);
  const ids = {};
  for (const name of Object.keys(TABLE_DEFS)) {
    const def = TABLE_DEFS[name];
    let tid = existing[name];
    let fdefs = null;
    if (!tid) {
      const fields = def.map(([fn, type, opts]) => ({
        field_name: fn, type,
        ...(opts ? { property: { options: opts.map(o => ({ name: o })) } } : {})
      }));
      const c = await feishu('POST', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables`, { table: { name, fields } });
      tid = c.table_id;
    } else {
      fdefs = await getTableFields(tid);
      const expected = {};
      def.forEach(([fn, type]) => { expected[fn] = Number(type); });
      const bad = fdefs.find(f => expected[f.field_name] !== undefined && Number(f.type) !== expected[f.field_name]);
      if (bad) {
        console.warn(`表[${name}]字段[${bad.field_name}]类型不符，删除重建`);
        await feishu('DELETE', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tid}`);
        const fields = def.map(([fn, type, opts]) => ({
          field_name: fn, type,
          ...(opts ? { property: { options: opts.map(o => ({ name: o })) } } : {})
        }));
        const c = await feishu('POST', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables`, { table: { name, fields } });
        tid = c.table_id; fdefs = null;
      }
      if (fdefs) {
        const have = new Set(fdefs.map(f => f.field_name));
        for (const [fn, type, opts] of def) {
          if (!have.has(fn)) {
            await feishu('POST', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tid}/fields`, {
              field_name: fn, type,
              ...(opts ? { property: { options: opts.map(o => ({ name: o })) } } : {})
            });
          }
        }
      }
    }
    ids[name] = tid;
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
    resumeUrl: txt(f['简历链接']), resumeName: txt(f['简历文件名']), notes: txt(f['备注']), createdAt: txt(f['加入日期']),
    expectCity: txt(f['期望城市']),
    password: txt(f['学员密码']),
    resumeHistory: parseHistory(f['简历历史']),
    portfolio: txt(f['作品集']).split('\n').map(s => s.trim()).filter(Boolean).map((line, i) => {
      const parts = line.split('|');
      return { id: 'pf' + i, title: (parts[0] || '').trim(), url: (parts[1] || '').trim(), name: (parts[2] || '').trim() };
    })
  };
}
function stuFields(d) {
  return {
    '姓名': d.name || '', '联系方式': d.contact || '', '学校': d.school || '', '专业': d.major || '',
    '目标岗位': d.target || '', '辅导阶段': d.stage || '咨询中', '简历状态': d.resumeStatus || '待优化',
    '简历链接': d.resumeUrl || '',
    '简历文件名': d.resumeName || '',
    '作品集': (d.portfolio || []).map(p => [p.title, p.url, p.name].filter(Boolean).join('|')).join('\n'),
    '备注': d.notes || '', '期望城市': d.expectCity || '', '加入日期': d.createdAt || today(), '学员密码': d.password || '', '简历历史': JSON.stringify(d.resumeHistory || [])
  };
}
// 把飞书「职位图片」字段解析为 URL 数组（兼容 JSON 数组 / 换行 / 逗号 / 单链接）
function parseImgField(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(x => (x && (x.link || x.url)) || x).filter(Boolean);
  let s = typeof v === 'object' ? (v.text || v.link || '') : String(v);
  s = (s || '').trim();
  if (!s) return [];
  if (s[0] === '[') { try { const a = JSON.parse(s); if (Array.isArray(a)) return a.filter(Boolean); } catch (e) {} }
  return s.split(/[\n,]/).map(x => x.trim()).filter(Boolean);
}
// 把飞书「简历历史」字段解析为 {url,name,at} 数组（兼容 JSON 数组 / 空）
function parseHistory(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  let s = typeof v === 'object' ? (v.text || '') : String(v);
  s = (s || '').trim();
  if (!s) return [];
  try { const a = JSON.parse(s); if (Array.isArray(a)) return a; } catch (e) {}
  return [];
}
function jobFrom(r) {
  const f = r.fields || {};
  return {
    id: r.record_id,
    company: txt(f['公司']), title: txt(f['职位名称']), jobType: txt(f['职位类型']), city: txt(f['城市']),
    salary: txt(f['薪资']), source: txt(f['渠道']),
    nature: txt(f['公司性质']), industry: txt(f['行业']), edu: txt(f['学历要求']), cohort: txt(f['届数']), majors: txt(f['专业要求']),
    status: txt(f['状态']) || '招聘中', link: txt(f['JD链接']), notes: txt(f['备注']),
    images: parseImgField(f['职位图片'])
  };
}
function jobFields(d) {
  return {
    '公司': d.company || '', '职位名称': d.title || '', '职位类型': d.jobType || '', '城市': d.city || '', '薪资': d.salary || '',
    '渠道': d.source || '', '公司性质': d.nature || '', '行业': d.industry || '', '学历要求': d.edu || '', '届数': d.cohort || '', '专业要求': d.majors || '',
    '状态': d.status || '招聘中', 'JD链接': d.link || '', '备注': d.notes || '',
    '职位图片': JSON.stringify((d.images && d.images.length) ? d.images : [])
  };
}
function appFrom(r) {
  const f = r.fields || {};
  return {
    id: r.record_id,
    studentName: txt(f['学员姓名']), company: txt(f['公司']), jobTitle: txt(f['职位名称']),
    stage: txt(f['阶段']) || '待投递', appliedAt: txt(f['投递日期']), followUpDate: txt(f['跟进日期']),
    next: txt(f['下一步行动']), notes: txt(f['备注']), updatedAt: txt(f['更新日期']),
    stageChangedAt: txt(f['阶段变更时间'])
  };
}
function appFields(d, names) {
  return {
    '学员姓名': names.studentName || '', '公司': names.company || '', '职位名称': names.jobTitle || '',
    '阶段': d.stage || '待投递', '投递日期': d.appliedAt || '',
    '跟进日期': d.followUpDate || '', '下一步行动': d.next || '', '备注': d.notes || '', '更新日期': d.updatedAt || today(),
    '阶段变更时间': d.stageChangedAt || ''
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
  const logs = (await allRecords(ids['操作日志'])).map(r => ({
    action: txt(r.fields['操作']), target: txt(r.fields['对象']), detail: txt(r.fields['详情']),
    actor: txt(r.fields['操作人']), at: txt(r.fields['时间']), id: r.record_id
  })).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100);
  return { students, jobs, apps, logs };
}

// 表名映射 + 保存时字段白名单：只写飞书表实际存在的字段，避免旧表缺列报错
const TBL = { student: '学员', job: '职位', app: '投递' };
async function getAllowedFields(tableName, tid) {
  if (!tableFieldNames[tableName]) {
    const fds = await getTableFields(tid);
    tableFieldNames[tableName] = new Set(fds.map(f => f.field_name));
  }
  return tableFieldNames[tableName];
}
function keepExisting(fields, allowed) {
  const out = {};
  for (const k of Object.keys(fields)) if (allowed.has(k)) out[k] = fields[k];
  return out;
}

// 操作审计：写入「操作日志」表，失败不影响主流程
let REQ_ACTOR = '系统';
async function auditLog(action, target, detail) {
  try {
    const ids = await ensureTables();
    const tid = ids['操作日志'];
    if (!tid) return;
    const fields = keepExisting(
      { '操作': action || '', '对象': target || '', '详情': detail || '', '操作人': REQ_ACTOR, '时间': new Date().toISOString() },
      await getAllowedFields('操作日志', tid)
    );
    await feishu('POST', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tid}/records`, { fields });
  } catch (e) { /* 审计失败不影响主流程 */ }
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
    // 阶段变更时间：新建记录或阶段发生变化时记为当前时间，否则沿用原值
    let existingStage = null, existingChangedAt = '';
    if (id) {
      try { const er = await getRecord(tid, id); existingStage = txt(er.fields['阶段']); existingChangedAt = txt(er.fields['阶段变更时间']); } catch (e) {}
    }
    const newStage = data.stage || '待投递';
    const stageChanged = (existingStage === null) || (existingStage !== newStage);
    data.stageChangedAt = stageChanged ? new Date().toISOString() : existingChangedAt;
    fields = appFields(data, names);
  } else throw new Error('未知类型');
  // 只写飞书表里实际存在的字段，兼容未修复表结构的旧表（新增列不会因缺列而报错）
  fields = keepExisting(fields, await getAllowedFields(TBL[type], tid));
  const tgt = type === 'student' ? (data.name || '学员') : type === 'job' ? (data.company + '·' + data.title) : type === 'app' ? (data.studentName + '·' + data.company) : type;
  const isNew = !id;
  if (id) { await feishu('PUT', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tid}/records/${id}`, { fields }); }
  else { const c = await feishu('POST', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tid}/records`, { fields }); id = c.record.record_id; }
  auditLog(isNew ? '新增' : '编辑', tgt, '');
  return { id };
}

async function deleteEntity({ type, id }) {
  const ids = await ensureTables();
  let delTarget = type;
  const del = (tid, rid) => feishu('DELETE', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tid}/records/${rid}`);
  if (type === 'student') {
    let name = '';
    try { const r = await getRecord(ids['学员'], id); name = txt(r.fields['姓名']); } catch (e) {}
    delTarget = name || '学员';
    if (name) {
      const apps = await allRecords(ids['投递']);
      for (const a of apps) if (txt(a.fields['学员姓名']) === name) await del(ids['投递'], a.record_id);
    }
    await del(ids['学员'], id);
  } else if (type === 'job') {
    let company = '', title = '';
    try { const r = await getRecord(ids['职位'], id); company = txt(r.fields['公司']); title = txt(r.fields['职位名称']); } catch (e) {}
    delTarget = (company + '·' + title) || '职位';
    if (company || title) {
      const apps = await allRecords(ids['投递']);
      for (const a of apps) if (txt(a.fields['公司']) === company && txt(a.fields['职位名称']) === title) await del(ids['投递'], a.record_id);
    }
    await del(ids['职位'], id);
  } else if (type === 'app') {
    delTarget = '投递记录';
    await del(ids['投递'], id);
  } else throw new Error('未知类型');
  auditLog('删除', delTarget, '');
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

/* ================= AI 助手（LLM 代理，OpenAI 兼容协议） =================
 * 环境变量：AI_API_KEY（必填）、AI_BASE_URL（默认智谱开放平台）、AI_MODEL（默认 glm-4.7-flash，永久免费）
 * 未配置密钥时返回 aiNotConfigured，前端据此引导用户去 Vercel 控制台配置
 */
const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/+$/, '');
const AI_MODEL = process.env.AI_MODEL || 'glm-4.7-flash';

async function llmOnce(messages, opts, key, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(AI_BASE_URL + '/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: AI_MODEL, messages, temperature: opts.temperature == null ? 0.4 : opts.temperature, max_tokens: opts.maxTokens || 2400, thinking: { type: 'disabled' } })
    });
    if (!r.ok) { const t = await r.text().catch(() => ''); const e = new Error('AI 接口返回 ' + r.status + '：' + t.slice(0, 180)); e.status = r.status; throw e; }
    const d = await r.json();
    const c = d && d.choices && d.choices[0] && d.choices[0].message;
    if (!c || !c.content) { const e = new Error('AI 返回内容为空'); e.empty = true; throw e; }
    return c.content;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('AI 响应超时，请稍后重试');
    throw e;
  } finally { clearTimeout(timer); }
}

async function llmChat(messages, opts = {}) {
  const key = process.env.AI_API_KEY;
  if (!key) {
    const e = new Error('AI 功能尚未配置：请在 Vercel 项目 Settings → Environment Variables 添加 AI_API_KEY（推荐智谱 open.bigmodel.cn 的 glm-4.7-flash，免费）');
    e.aiNotConfigured = true;
    throw e;
  }
  const t0 = Date.now();
  const rateLimitMsg = 'AI 免费模型当前访问量过大（限流），请过 1-2 分钟再试；若频繁出现，可在 Vercel 环境变量 AI_MODEL 换成 glm-4-flash-250414 或接入 DeepSeek';
  try {
    return await llmOnce(messages, opts, key, 25000);
  } catch (e) {
    // 免费模型限流（429）或偶发空内容：仅在快速失败时自动重试 1 次（总耗时控制在函数 30s 上限内）
    const retryable = (e && e.status === 429) || (e && e.empty);
    if (!retryable) throw e;
    if (e && e.status === 429 && Date.now() - t0 > 8000) throw new Error(rateLimitMsg);
    await new Promise(r => setTimeout(r, 2500));
    try {
      return await llmOnce(messages, opts, key, 18000);
    } catch (e2) {
      if (e2 && e2.status === 429) throw new Error(rateLimitMsg);
      if (e2 && e2.empty) throw new Error('AI 返回内容为空，请重试');
      throw e2;
    }
  }
}

// 从模型输出中稳健提取 JSON（容忍 markdown 代码块/前后缀文本）
function extractJSON(text) {
  let s = String(text || '').trim().replace(/```json|```/g, '').trim();
  const a = s.indexOf('['), b = s.lastIndexOf(']');
  const c = s.indexOf('{'), d = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  else if (c >= 0 && d > c) s = s.slice(c, d + 1);
  return JSON.parse(s);
}

// 学员画像统一由服务端按 ID 权威读取（防止伪造他人资料）
async function aiStudentProfile(sid) {
  const ids = await ensureTables();
  return stuFrom(await getRecord(ids['学员'], sid));
}

async function aiTask(b, ctx) {
  try {
    const task = String((b || {}).task || '');
    const cut = (s, n) => String(s == null ? '' : s).slice(0, n);

    /* --- 任务1：生成简历初稿（管理端/学员端） --- */
    if (task === 'resume-draft') {
      let s = null;
      if (ctx.sid) s = await aiStudentProfile(ctx.sid);
      else if (b.studentId) s = await aiStudentProfile(b.studentId);
      if (!s) return { ok: false, error: '缺少学员信息，无法生成' };
      const extra = cut(b.extra, 3000);
      const sys = '你是一位有10年经验的求职辅导导师兼简历教练，擅长为应届生和年轻求职者撰写高质量中文简历。要求：1) 用 Markdown 输出，包含 求职意向、教育背景、实习与项目经历（STAR法则、突出量化成果）、专业技能、自我评价；2) 【最重要】严禁编造任何经历、数据或事实，只能基于给定资料组织语言，信息不足处用「【待补充：xxx】」明确标注；3) 语言精炼专业，动词开头，避免空洞套话；4) 直接输出简历正文，不要任何额外解释。';
      const user = '请为以下学员生成求职简历初稿。\n\n学员资料：' + JSON.stringify({ 姓名: s.name, 学校: s.school, 专业: s.major, 目标岗位: s.target, 期望城市: s.expectCity, 辅导阶段: s.stage, 备注: s.notes }) + '\n\n补充信息（经历/项目/技能等，可能为空）：' + (extra || '无');
      const text = await llmChat([{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.5, maxTokens: 2600 });
      return { ok: true, text };
    }

    /* --- 任务2：按 JD 定向优化简历（管理端/学员端） --- */
    if (task === 'resume-polish') {
      const resume = cut(b.resume, 9000), jd = cut(b.jd, 6000);
      if (!resume.trim() || !jd.trim()) return { ok: false, error: '请同时提供简历内容和目标 JD' };
      const sys = '你是一位资深简历优化专家。请把用户提供的简历按目标 JD 定向优化。输出分两部分：第一部分标题「## 优化后的简历」，给出完整 Markdown 简历；第二部分标题「## 修改说明」，逐条列出改了什么、为什么（对应 JD 的哪个要求）。【最重要】严禁编造简历中不存在的事实，只能重组结构、强化表达、对齐 JD 关键词。';
      const text = await llmChat([{ role: 'system', content: sys }, { role: 'user', content: '目标 JD：\n' + jd + '\n\n当前简历：\n' + resume }], { temperature: 0.4, maxTokens: 3000 });
      return { ok: true, text };
    }

    /* --- 任务3：AI 岗位推荐（学员端为主，管理端带 studentId 也可用） --- */
    if (task === 'job-match') {
      let s = null;
      if (ctx.sid) s = await aiStudentProfile(ctx.sid);
      else if (b.studentId) s = await aiStudentProfile(b.studentId);
      if (!s) return { ok: false, error: '缺少学员信息，无法推荐' };
      const ids = await ensureTables();
      const jobs = (await allRecords(ids['职位'])).map(jobFrom).filter(j => (j.status || '招聘中') !== '已关闭');
      if (!jobs.length) return { ok: false, error: '职位库暂无在招职位，请先在管理端添加' };
      const list = jobs.slice(0, 40).map((j, i) => ({ i, 公司: j.company, 职位: j.title, 城市: j.city || '', 类型: j.jobType || '', 薪资: j.salary || '', 行业: j.industry || '', 性质: j.nature || '', 学历: j.edu || '', 届数: j.cohort || '', 专业: (j.majors || '').slice(0, 80), 要求: (j.notes || '').slice(0, 200) }));
      const sys = '你是求职辅导导师，擅长为学员匹配职位。只输出严格 JSON 数组，不要 markdown 代码块、不要任何解释文字。';
      const pref = b.industry ? '\n学员行业偏好：' + cut(b.industry, 40) + '（优先推荐该行业的岗位）' : '';
      const user = '学员画像：' + JSON.stringify({ 学校: s.school, 专业: s.major, 目标岗位: s.target, 期望城市: s.expectCity, 备注: (s.notes || '').slice(0, 200) }) + pref + '\n\n职位列表：' + JSON.stringify(list) + '\n\n请为该学员匹配职位，输出 JSON 数组：[{"i":职位序号,"score":0到100的匹配分,"reason":"一句话推荐理由，结合学员背景与职位要求"}]。只保留 score>=50 的职位，按 score 从高到低排序，最多10条。';
      const out = await llmChat([{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.2, maxTokens: 1600 });
      const arr = extractJSON(out);
      if (!Array.isArray(arr)) throw new Error('AI 返回格式异常，请重试');
      const picks = [];
      for (const x of arr) {
        const j = jobs[x && x.i];
        if (!j || !Number.isFinite(Number(x.score))) continue;
        picks.push({ id: j.id, company: j.company, title: j.title, jobType: j.jobType, city: j.city, salary: j.salary, link: j.link, nature: j.nature || '', industry: j.industry || '', edu: j.edu || '', cohort: j.cohort || '', majors: j.majors || '', score: Math.round(Number(x.score)), reason: String(x.reason || '').slice(0, 120) });
      }
      picks.sort((a, b2) => b2.score - a.score);
      return { ok: true, list: picks.slice(0, 10) };
    }

    /* --- 任务4：JD 解析入库（仅管理端） --- */
    if (task === 'jd-parse') {
      if (!ctx.admin) return { ok: false, error: '该功能仅管理端可用' };
      const jd = cut(b.jd, 6000);
      if (!jd.trim()) return { ok: false, error: '请粘贴 JD 文本' };
      const sys = '你是招聘信息解析助手。只输出严格 JSON 对象，不要 markdown 代码块、不要任何解释文字。';
      const user = '从下面的招聘 JD 中提取结构化信息，输出 JSON：{"company":"公司名","title":"职位名称","jobType":"实习/校招/社招/兼职 四选一，判断不了留空","city":"城市","salary":"薪资范围如 20-35K·15薪，没有留空","nature":"公司性质：央企/国企/上市/大厂/外企/中小 六选一，按公司背景判断（如国务院国资委=央企、地方国资=国企、股票代码/上市公司=上市、知名互联网大厂=大厂），判断不了留空","industry":"所属行业，如 互联网/游戏/美妆/快消/新能源/金融/教育/医疗/汽车/智能制造/电商，判断不了留空","edu":"学历要求：不限/大专/本科/硕士/博士，没提留空","majors":"专业要求，JD中提到的专业方向用顿号分隔如「设计、新闻、中文」，不限或没提留空","cohort":"面向届数：26届/27届/28届，没提留空","source":"渠道来源如 Boss直聘/官网，没有留空","link":"JD链接，没有留空","notes":"职位要求要点摘要，100字内"}\n\nJD原文：\n' + jd;
      const out = await llmChat([{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.1, maxTokens: 900 });
      const g = extractJSON(out);
      const pick = v => String(v == null ? '' : v).trim().slice(0, 200);
      return { ok: true, job: { company: pick(g.company), title: pick(g.title), jobType: pick(g.jobType), city: pick(g.city), salary: pick(g.salary), nature: pick(g.nature), industry: pick(g.industry), edu: pick(g.edu), majors: pick(g.majors), cohort: pick(g.cohort), source: pick(g.source), link: pick(g.link), notes: pick(g.notes) } };
    }

    return { ok: false, error: '未知 AI 任务：' + (task || '(空)') };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'AI 调用失败', aiNotConfigured: !!(e && e.aiNotConfigured) };
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    REQ_ACTOR = isStudentAuthed(req) ? '学员' : (isAuthed(req) ? '管理员' : '未登录');
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

    // ===== 学员端（独立鉴权，不受管理员登录态影响） =====
    if (p === '/api/student-login' && req.method === 'POST') {
      const b = await readBody(req);
      const phone = (b.phone || '').trim();
      const pwd = (b.password || '').trim();
      if (!phone || !pwd) return json(res, { ok: false, error: '请输入手机号和密码' }, 400);
      const ids = await ensureTables();
      const records = await allRecords(ids['学员']);
      const match = records.find(r => txt(r.fields['联系方式']) === phone && (r.fields['学员密码'] || '') === pwd);
      if (!match) return json(res, { ok: false, error: '手机号或密码错误' }, 401);
      res.setHeader('Set-Cookie', issueStuCookie(req, match.record_id));
      return json(res, { ok: true });
    }
    if (p === '/api/student-logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', `${STU_COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
      return json(res, { ok: true });
    }

    // 学员本人数据 / 操作（需学员登录态，且不受管理员登录态影响）
    if (p === '/api/student/me' && req.method === 'GET') {
      const sid = isStudentAuthed(req);
      if (!sid) return json(res, { ok: false, error: '未登录或登录已过期', needLogin: true }, 401);
      const ids = await ensureTables();
      const r = await getRecord(ids['学员'], sid);
      const student = stuFrom(r);
      const apps = (await allRecords(ids['投递'])).map(appFrom).filter(a => a.studentName === student.name);
      return json(res, { ok: true, student, apps });
    }
    if (p === '/api/student/app' && req.method === 'POST') {
      const sid = isStudentAuthed(req);
      if (!sid) return json(res, { ok: false, error: '未登录或登录已过期', needLogin: true }, 401);
      const b = await readBody(req);
      const ids = await ensureTables();
      const r = await getRecord(ids['学员'], sid);
      const studentName = txt(r.fields['姓名']);
      // 编辑时校验：只能改自己的投递
      if (b.id) {
        const ar = await getRecord(ids['投递'], b.id);
        if (txt(ar.fields['学员姓名']) !== studentName) return json(res, { ok: false, error: '只能编辑自己的投递' }, 403);
      }
      const names = { studentName, company: b.company || '', jobTitle: b.jobTitle || '' };
      if (b.jobId) { try { const jr = await getRecord(ids['职位'], b.jobId); names.company = txt(jr.fields['公司']); names.jobTitle = txt(jr.fields['职位名称']); } catch (e) {} }
      await saveEntity({ type: 'app', id: b.id || null, data: { studentId: sid, studentName, company: names.company, jobTitle: names.jobTitle, stage: b.stage || '已投递', appliedAt: b.appliedAt || today(), next: b.next || '', notes: b.notes || '' } });
      return json(res, { ok: true });
    }
    if (p === '/api/student/app-delete' && req.method === 'POST') {
      const sid = isStudentAuthed(req);
      if (!sid) return json(res, { ok: false, error: '未登录或登录已过期', needLogin: true }, 401);
      const b = await readBody(req);
      const ids = await ensureTables();
      const sr = await getRecord(ids['学员'], sid);
      const studentName = txt(sr.fields['姓名']);
      const ar = await getRecord(ids['投递'], b.id);
      if (txt(ar.fields['学员姓名']) !== studentName) return json(res, { ok: false, error: '只能删除自己的投递' }, 403);
      await feishu('DELETE', `/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${ids['投递']}/records/${b.id}`);
      return json(res, { ok: true });
    }
    if (p === '/api/student/save' && req.method === 'POST') {
      const sid = isStudentAuthed(req);
      if (!sid) return json(res, { ok: false, error: '未登录或登录已过期', needLogin: true }, 401);
      const b = await readBody(req);
      const allowed = ['resumeUrl', 'resumeName', 'resumeStatus', 'portfolio', 'target', 'notes', 'expectCity', 'resumeHistory'];
      const patch = {}; allowed.forEach(k => { if (k in b) patch[k] = b[k]; });
      const ids = await ensureTables();
      const cur = stuFrom(await getRecord(ids['学员'], sid));
      // 简历版本管理：更换或移除简历时，旧版本自动归档进「简历历史」（客户端显式传 resumeHistory 时以客户端为准），最多保留 10 版
      if ('resumeUrl' in patch && !('resumeHistory' in b) && cur.resumeUrl && cur.resumeUrl !== patch.resumeUrl) {
        const hist = Array.isArray(cur.resumeHistory) ? cur.resumeHistory.slice() : [];
        hist.unshift({ url: cur.resumeUrl, name: cur.resumeName || '旧版简历', at: new Date().toISOString() });
        patch.resumeHistory = hist.slice(0, 10);
      }
      await saveEntity({ type: 'student', id: sid, data: { ...cur, ...patch } });
      return json(res, { ok: true });
    }

    // AI 助手：管理员或学员登录态均可调用（学员仅能操作自己的资料）
    if (p === '/api/ai' && req.method === 'POST') {
      const sid = isStudentAuthed(req);
      const admin = isAuthed(req);
      if (!sid && !admin) return json(res, { ok: false, error: '未登录或登录已过期', needLogin: true }, 401);
      return json(res, await aiTask(await readBody(req), { sid, admin }));
    }

    if (AUTH_ENABLED && !isAuthed(req)) return json(res, { ok: false, error: '未登录或登录已过期', needLogin: true }, 401);

    if (p === '/api/data' && req.method === 'GET') return json(res, { ok: true, data: await getData(), deleteProtected: DELETE_PROTECTED });
    if (p === '/api/save' && req.method === 'POST') { const r = await saveEntity(await readBody(req)); return json(res, { ok: true, id: r.id }); }
    if (p === '/api/repair' && req.method === 'POST') { await repairTables(); return json(res, { ok: true }); }
    if (p === '/api/delete' && req.method === 'POST') {
      const b = await readBody(req);
      if (DELETE_PROTECTED && b.deletePassword !== DELETE_PASSWORD) {
        return json(res, { ok: false, error: '删除密码错误', needDeletePwd: true }, 403);
      }
      await deleteEntity(b);
      return json(res, { ok: true });
    }
    if (p === '/api/migrate' && req.method === 'POST') return json(res, { ok: true, result: await migrate(await readBody(req)) });
    return json(res, { ok: false, error: '接口不存在' });
  } catch (e) {
    return json(res, { ok: false, error: e.message });
  }
}

module.exports = { handleApi, isAuthed, isStudentAuthed, json };
