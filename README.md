# MelChat Image Generator

基于 `melvincarvalho/melchat` 单 HTML 思路改造的 Vercel 静态网页应用，默认通过 OpenRouter/OpenAI 兼容接口生成图片，并保留 GitHub Models 兼容入口。

## 本地运行

```bash
npm run dev
```

打开 `http://localhost:3000`。

如需使用 Vercel CLI 本地模拟，可在登录 Vercel 后运行：

```bash
npm run vercel:dev
```

## Vercel 环境变量

- `OPENROUTER_API_KEY`: 默认 OpenRouter API Key。
- `GITHUB_TOKEN`: 可选 GitHub Models Token。

前端设置里的个人 API Key 只保存在当前页面内存中，刷新即消失。
