# Vercel 部署指南（免费 · 不用信用卡 · 关电脑也能用）

> 代码已经改造成 Vercel 兼容版（`api/` 下是 Serverless Function，前端 `index.html` 自动托管）。
> 本指南教你把它部署到 Vercel，**全程不用绑信用卡、不花钱**，部署完拿到固定网址 `xxx.vercel.app`，关电脑也照常用。

---

## 第 1 步：注册 Vercel

1. 打开 **https://vercel.com**
2. 右上角 **「Sign Up」** → 选 **「Continue with GitHub」**（用你之前的 GitHub 账号一键登录）
3. 授权后进入 Vercel 控制台

> 个人免费层（Hobby）**不用绑信用卡**。

---

## 第 2 步：导入你的 GitHub 仓库

1. 控制台点 **「Add New」→「Project」**
2. 在 **「Import Git Repository」** 里找到 **`phx126-cloud/stu-progress`** → 点 **「Import」**
3. 配置项（基本不用改）：
   - **Framework Preset**：选 **Other**（或留空）
   - **Build Command**：留空（Vercel 会自动 `npm install` 并托管静态文件 + `api/` 函数）
   - **Output Directory**：留空（默认）
   - **Install Command**：留空（默认 `npm install`）

---

## 第 3 步：填写环境变量（关键！）

往下滚到 **「Environment Variables」**，逐行添加这 **4 个**（Vercel 不需要 PORT，平台自己管端口）：

| 名称 | 值 | 从哪里拿 |
|------|-----|---------|
| `FEISHU_APP_ID` | 你的 `cli_` 开头那串 | 飞书开放平台 → 你的应用 → 凭证页 → App ID |
| `FEISHU_APP_SECRET` | 你的 App Secret | 同一页面 → App Secret（点查看复制）|
| `FEISHU_APP_TOKEN` | 你的 `X` 开头那串 | 飞书多维表格网址 `/base/` 与 `?` 之间复制 |
| `ACCESS_PASSWORD` | `3a3ed5efb1c88e27` | 网页访问口令（和在本地用的一样）|

点击 **「Add」** 把每行加进去，4 个都加完。

> ⚠️ 飞书三项就是你在飞书开放平台后台看到、当初填进 `config.json` 的同款值。三者缺一不可，否则部署后的网页连不上飞书。

---

## 第 4 步：部署

1. 滚到最底部点 **「Deploy」**
2. 等 **1~2 分钟** 构建（首次会连飞书自动建好「学员/职位/投递」三张表）
3. 完成后显示 **「Congratulations」**，并给出一个网址，形如：
   **`https://stu-progress.vercel.app`**

> 这个网址**永久固定不变**，关机、合盖、关电脑都不影响。

---

## 第 5 步：打开使用

1. 浏览器打开 `https://stu-progress.vercel.app`
2. 先弹**访问口令登录框** → 输入 `3a3ed5efb1c88e27` → 进入
3. 网页上新增/拖拽一条投递 → 去飞书多维表格看是否同步
4. 在飞书表格改一个值 → 网页 15 秒内自动刷新

两边同步正常，部署完成 🎉

---

## 之后怎么用

- **网址固定不变**：`xxx.vercel.app` 不会再换
- **24 小时常驻**：跑在 Vercel 远程机器，你电脑关了也照常访问
- **免费**：Hobby 层不用绑卡、不花钱
- **代码更新**：本地改完 `git push` 到 GitHub，Vercel 会自动重新部署

---

## 常见问题

**Q：部署后打开显示「尚未配置飞书应用」？**
A：第 3 步飞书值没填/填错。回去 Vercel 项目 → Settings → Environment Variables 核对三个飞书值，Save 后重新 Deploy。

**Q：网页能开但数据空白？**
A：`FEISHU_APP_TOKEN` 不对（不是你那个 `X` 开头的表格），或飞书应用没开通 `bitable:app` 权限并发布版本。回飞书开放平台确认。

**Q：要不要绑信用卡？**
A：不需要。Hobby 免费层直接 GitHub 登录即可，零信用卡。

**Q：想要自己的域名（如 `app.你的名字.com`）？**
A：Vercel 里项目 → Settings → Domains，添加你的域名并按提示在域名商处加一条 CNAME 解析即可，免费。
