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

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return json(res, { error: '服务器未配置 BLOB_READ_WRITE_TOKEN：请在 Vercel 项目 Settings → Environment Variables 中添加该变量（值为 Blob Store 的读写令牌）。' }, 500);
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
    const blob = await put(`${kind}/${Date.now()}-${safeName}`, buf, {
      access: 'public',
      token,
      addRandomSuffix: true,
      contentType: req.headers['content-type'] || 'application/octet-stream'
    });
    return json(res, { url: blob.downloadUrl, name: rawName });
  } catch (e) {
    return json(res, { error: e.message || '上传失败' }, 500);
  }
};
