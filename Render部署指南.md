# Render 部署超详细指南（傻瓜版）

本指南面向**完全不懂技术、没碰过云**的用户。跟着点就能把「学员进度管理」网站变成**固定网址、永久常驻、不花钱**的公网服务。

---

## 前置说明：你现在的代码已经是「云就绪」的了

之前已经把 `server.js` 里的飞书密钥改成**环境变量优先、config.json 兜底**：

```js
const FEISHU_APP_ID      = process.env.FEISHU_APP_ID      || config.app_id      || '';
const FEISHU_APP_SECRET  = process.env.FEISHU_APP_SECRET  || config.app_secret  || '';
const FEISHU_APP_TOKEN   = process.env.FEISHU_APP_TOKEN   || config.app_token   || '';
```

本地没设环境变量时自动读 `config.json`（和你现在一样）；**丢到 Render 时，只需在后台填这三个 env，不依赖任何本机文件**。

> 也就是说：你本机的代码，原封不动就能上云。

---

## 第 1 步：注册 GitHub（如果你还没有）

1. 打开 **https://github.com**
2. 点右上角 **Sign up**（注册）
3. 填三样：
   - **Email**：你的常用邮箱
   - **Password**：至少 15 位（例如 `Myp@ssw0rd2026!`）
   - **Username**：随意起，比如 `job-coach`
4. 点 **Create account**
5. 去邮箱收验证邮件 → 点里面的 **Verify email address** 链接
6. 回到 GitHub，按提示选「Free / Pro / Team」→ 一般选 **Free**（免费）
7. 勾选使用条款 → 点 **Finish**

> 如果你**早就有** GitHub 账号，这步直接跳过。

---

## 第 2 步：把代码推到 GitHub

你有两种方式，选最顺手的：

### 方式 A：GitHub Desktop（完全不用敲命令，推荐）

1. 下载安装 **GitHub Desktop**（desktop.github.com）
2. 登录你的 GitHub 账号
3. 点 **File → New Repository** → 名字填 `stu-progress` → 选个本地路径
4. 把 `/Users/penghaoxuan/WorkBuddy/2026-07-30-16-45-45/学员进度管理/` 里的所有文件**拖进**这个新仓库文件夹
5. 在 GitHub Desktop 里：**Summary** 填 `init` → 点 **Commit to main**
6. 点 **Publish branch**（推到 GitHub 远程仓库）

### 方式 B：命令行（如果你愿意敲几行）

在本机终端跑（路径换成你实际的）：

```bash
cd /Users/penghaoxuan/WorkBuddy/2026-07-30-16-45-45/学员进度管理
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/你的用户名/stu-progress.git
git push -u origin main
```

> 注意：`git remote add` 里的网址要换成你**自己**的 GitHub 仓库地址（在 GitHub 网页建好空仓库后复制它的 HTTPS 地址）。

---

## 第 3 步：注册 Render（核心，不用信用卡）

1. 打开 **https://render.com**
2. 点右上角 **Sign Up**
3. 最省事：**Continue with GitHub**（用 GitHub 一键登录，连信用卡都不用绑）
4. 授权完成后进 Render 后台

---

## 第 4 步：创建 Web Service

1. 后台左侧点 **New** → 选 **Web Service**
2. 连仓库：选 **Connect a GitHub repository** → 找到第 2 步推上去的 `stu-progress`
3. 填配置（**照抄**下面的值）：

| 字段 | 填什么 |
|------|--------|
| **Name** | `stu-progress` |
| **Environment** | `Node` |
| **Region** | 就近选（如 Singapore） |
| **Branch** | `main` |
| **Build Command** | `npm install` |
| **Start Command** | `node server.js` |

4. 展开 **Advanced → Environment Variables**，逐条添加（**值换成你真实的**）：

```
FEISHU_APP_ID      = 你的飞书 App ID（cli_ 开头）
FEISHexistsU_APP_SECRET  = 你的飞书 App Secret
FEISHU_APP_TOKEN   = 你的飞书多维表格 app_token（X 开头那串）
ACCESS_PASSWORD    = 3a3ed5efb1c88e27   （或你自定义的新口令）
PORT               = 10000
```

> 飞书三项的值，和你 `config.json` 里现在填的一模一样。复制粘贴过去即可。

5. 点右下角 **Create Web Service**

---

## 第 5 步：等部署完，拿固定网址

1. Render 会自动拉代码、`npm install`、启动 `node server.js`
2. 构建约 **2~3 分钟**（免费层首次稍慢）
3. 完成后顶部显示 **Live** 状态
4. 点 **Visit** 或复制那个 `https://stu-progress.onrender.com` 网址

这个网址**再也不会变**，关机也不受影响。

---

## 第 6 步：验证能用

1. 浏览器打开 `https://stu-progress.onrender.com`
2. 会先弹**访问口令**登录框
3. 输 `ACCESS_PASSWORD` 里设的那个值（比如 `3a3ed5efb1c88e27`）
4. 进入后能看到你飞书里的学员/职位/投递数据，双向同步正常

---

## 常见问题

**Q：免费层真的不花钱？**
A：对。Render 免费层**永久免费**，不用绑信用卡，不用付钱。只有超过每月 750 小时运行时长或要自定义域名时才可能涉及付费（你这规模完全用不到）。

**Q：网址会像 Cloudflare 隧道那样重启就换吗？**
A：**不会**。`onrender.com` 是 Render 分配给你的固定子域名，部署后永久不变。

**Q：我电脑关机了网站还能开吗？**
A：能。服务跑在 Render 的远程机器上，和你本机无关。

**Q：以后想改网页内容怎么办？**
A：改完本地代码 → 推到 GitHub（方式 A 的 Publish / 方式 B 的 `git push`）→ Render 会自动重新部署（或手动点 **Manual Deploy**）。

**Q：访问口令忘了/想换？**
A：在 Render 后台的 Environment Variables 里改 `ACCESS_PASSWORD` 的值 → 点 Save → Render 会自动重启生效。
