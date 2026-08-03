/**
 * 文件上传接口 —— 接收浏览器直传的文件，存入 Vercel Blob（云端），返回公开下载地址。
 * 文件存在 Vercel 云端，与飞书/浏览器解耦，关电脑、换设备都能访问。
 */
const { put } = require('@vercel/blob');
const { isAuthed, json } = require('./_lib');

const MAX = 12 * 1024 * 1024; // 12MB 上限

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, { error: 'Method Not Allowed' }, 405);
  if (!isAuthed(req)) return json(res, { error: '未登录或登录已过期', needLogin: true }, 401);

  // 兼容两种 Vercel Blob 认证方式：
  // 1) 旧方式：创建 Blob Store 时自动注入 BLOB_READ_WRITE_TOKEN
  // 2) 新方式（推荐）：连接项目到 Blob Store 时走 OIDC（BLOB_STORE_ID + VERCEL_OIDC_TOKEN）
  const hasStatic = !!process.env.BLOB_READ_WRITE_TOKEN;
  const hasOidc = !!process.env.BLOB_STORE_ID;
  if (!hasStatic && !hasOidc) {
    return json(res, { error: '服务器未连接 Vercel Blob：请先在 Vercel 项目 Storage 中创建 Blob Store 并关联本项目。' }, 500);
  }

  try {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX) return json(res, { error: '文件超过 12MB，请压缩后上传，或改用链接填写。' }, 413);
      chunks.push(c);
    }
    const buf = Buffer.concat(chunks);
    if (!buf.length) return json(res, { error: '未收到文件内容' }, 400);

    const rawName = (req.query.name || 'file').toString().slice(0, 120);
    const safeName = rawName.replace(/[^\w.\-]/g, '_').slice(0, 80) || 'file';
    const kind = req.query.kind === 'portfolio' ? 'portfolio' : 'resume';
    const options = {
      access: 'public',
      addRandomSuffix: true,
      contentType: req.headers['content-type'] || 'application/octet-stream'
    };
    if (hasStatic) options.token = process.env.BLOB_READ_WRITE_TOKEN;
    const blob = await put(`${kind}/${Date.now()}-${safeName}`, buf, options);
    return json(res, { url: blob.downloadUrl, name: rawName });
  } catch (e) {
    return json(res, { error: e.message || '上传失败' }, 500);
  }
};
