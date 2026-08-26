# AI 功能配置指南（一期）

平台已内置 AI 助手（管理端 + 学员端），只需配置一个大模型密钥即可启用。

## 一、获取 API Key（免费，2 分钟）

1. 打开 https://open.bigmodel.cn （智谱开放平台），手机号注册；
2. 右上角「API 密钥」→ 创建密钥 → 复制；
3. 默认模型 `glm-4.7-flash` **永久免费**，无需充值。

> 也可用 DeepSeek（platform.deepseek.com）等任何 OpenAI 兼容接口，见下方「换其他模型」。

## 二、配置到 Vercel（1 分钟）

1. 打开 https://vercel.com → 进入 stu-progress 项目；
2. **Settings → Environment Variables**，添加：

| Name | Value |
|---|---|
| `AI_API_KEY` | 你复制的密钥 |

3. （可选，不填用默认智谱免费模型）

| Name | Value |
|---|---|
| `AI_BASE_URL` | 默认 `https://open.bigmodel.cn/api/paas/v4` |
| `AI_MODEL` | 默认 `glm-4.7-flash` |

4. 添加后需**重新部署**才生效：Deployments → 最新一条 → 右侧菜单 → Redeploy。

### 换其他模型（如 DeepSeek）
- `AI_BASE_URL` = `https://api.deepseek.com`
- `AI_MODEL` = `deepseek-chat`
- `AI_API_KEY` = DeepSeek 的密钥

## 三、功能入口

**管理端**
- 学员抽屉 →「🤖 AI 简历助手」：生成简历初稿 / 按 JD 优化（可复制、打印存 PDF）
- 职位库 →「🤖 JD 解析入库」：粘贴招聘信息原文，AI 自动提取字段入库

**学员端（student.html）**
- 「AI 助手」卡片 →「为我推荐职位」：按学员画像给职位库打分排序，可一键记录投递
- 「AI 简历助手」：生成初稿 / 按 JD 优化

## 四、顺手建议

- 管理口令 `ACCESS_PASSWORD` 建议同时在环境变量里换成新的强口令（旧口令曾出现在 git 历史中，已停止跟踪 config.json）。
- AI 有「严禁编造简历事实」的约束，信息不足会标注【待补充】，仍需人工把关。
