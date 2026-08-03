# Render 后台逐项操作图文指南（超傻瓜版）

> 代码已经推上 GitHub（`phx126-cloud/stu-progress`）了。你只差在 render.com 网页端点几下，就能拿到**固定不变**的公网网址。
> 本指南每一步都标了「点哪个按钮、填什么」，跟着走就行，**完全不用开终端**。

---

## 第 1 步：打开 render.com 并登录

1. 浏览器打开 **https://render.com**
2. 右上角点 **「Sign Up」**（如果你还没账号）或 **「Log In」**（如果已有）
3. 在登录页选 **「Continue with GitHub」**（用 GitHub 一键登录，之前你注册好的那个 GitHub 账号）
4. 弹窗授权 → 点 **Authorize Render** → 自动跳回 Render 控制台

> 全程**不用绑信用卡、不花钱**。免费层（Free plan）永久免费。

---

## 第 2 步：新建一个 Web Service

1. 进控制台后，左上角 / 左侧边栏找 **「New」**（新建）下拉 → 点 **「Web Service」**
2. 会进入「Create a new Web Service」页面

---

## 第 3 步：连接你的 GitHub 仓库

1. 在「Connect a repository」区域，点 **「Connect GitHub」**（蓝色按钮）
2. 如果是第一次连，会跳到 GitHub 授权页 → 点 **「Authorize」**（你令牌 `github_pat_...` 已经在用，权限够）
3. 回到 Render 页面后，在仓库下拉框里选 **`phx126-cloud/stu-progress`**（就是你推上去的那个公开仓库）
4. 点 **「Connect」**

---

## 第 4 步：填写服务配置（照抄下面的值）

在「Service settings」表单里，逐项填：

| 字段 | 填什么 | 说明 |
|------|--------|------|
| **Name** | `stu-progress` | 服务名，随便起，默认就用这个 |
| **Region** | `Singapore` 或 `Oregon` | 选离你近的（新加坡最稳，国内访问快） |
| **Branch** | `main` | 代码推在 main 分支 |
| **Runtime** | `Node` | 我们的服务是 Node 写的 |
| **Build Command** | `npm install` | 拉依赖 |
| **Start Command** | `node server.js` | 启动同步服务 |

> 这 6 项**直接照抄**即可，不用改。

---

## 第 5 步：填环境变量（关键！飞书值从这里来）

往下滚到 **「Environment Variables」** 区（或点「Advanced」展开后才有），逐行添加：

点 **「Add Environment Variable」** 加一行，填 **key / value**：

1. **Key**: `FEISHU_APP_ID`  
   **Value**: 你飞书应用里的 `cli_` 开头那串  
   *（去 飞书开放平台 → 你的应用 → 凭证与基础信息 → App ID 复制）*

2. **Key**: `FEISHU_APP_SECRET`  
   **Value**: 你的 App Secret  
   *（同一页面下方的 App Secret，点「查看」复制）*

3. **Key**: `FEISHU_APP_TOKEN`  
   **Value**: 你的多维表格 `X` 开头那串  
   *（打开你的飞书多维表格，从浏览器地址栏 `/base/` 和 `?` 之间复制下来的那串）*

4. **Key**: `ACCESS_PASSWORD`  
   **Value**: `3a3ed5efb1c88e27`  
   *（网页访问口令，和本地 config.json 里的一致）*

5. **Key**: `PORT`  
   **Value**: `10000`  
   *（Render 免费层端口，照填）*

> ⚠️ 第 1~3 项就是当初你填进 `config.json` 的同款值——从飞书开放平台后台抄过来即可，三者缺一不可，否则部署后的网页连不上飞书。

---

## 第 6 步：创建服务

1. 滚到页面最底部
2. 点 **「Create Web Service」**（绿色大按钮）
3. 会进入「Deploying…」页面，等 **2~3 分钟** 构建

---

## 第 7 步：拿到固定网址

1. 构建完成后，服务详情页会显示一个网址，形如：
   **`https://stu-progress.onrender.com`**
2. 点这个网址（或自己复制到浏览器打开）
3. 首页会先弹**访问口令登录框** → 输入 `3a3ed5efb1c88e27` → 进入
4. 之后就能看到你飞书多维表格里的学员 / 职位 / 投递数据，双向同步正常

---

## 之后怎么用

- **网址固定不变**：`xxx.onrender.com` 不会再像 Cloudflare 隧道那样重启就换
- **24 小时常驻**：那台远程机器一直开着，你电脑合盖也不影响
- **免费**：Render 免费层，不绑卡、不花钱
- **改数据**：在飞书表格里改 → 网页自动同步；在网页上拖拽看板 → 实时写回飞书

---

## 常见问题

**Q：部署后打开网址显示「飞书未配置」？**  
A：说明第 5 步的飞书值没填对 / 漏填了。回去 Render 后台 → 你的服务 → Environment → 重新填那 3 个飞书值 → Save → 等重启生效。

**Q：网页能开但数据空白？**  
A：飞书 app_token 不对（不是你那个 `X` 开头的表格），或权限没给够。回飞书开放平台确认 bitable:app 权限已开通并**发布版本**。

**Q：不想每次手动填飞书值？**  
A：当前推上去的 `render.yaml` 是空的（为过 GitHub Push Protection）。你只在**首次**部署时填一次，之后常驻不需要再动。
