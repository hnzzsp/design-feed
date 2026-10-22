# design-feed

每日速览（DailyPeek）新闻站的设计类数据管道。

GitHub Actions 每小时抓取并解析以下设计源，转为 JSON 提交到 `data/`：

| 数据 | 来源 | 说明 |
|------|------|------|
| `data/dribbble.json` | Dribbble 热门 shots | 直抓 → RSSHub → r.jina.ai 三级容灾 |
| `data/uisdc.json` | 优设 UISDC 首页文章 | 解析 `h2.item-title` 列表 |

前端（news/index.html）通过 `raw.githubusercontent.com` 读取这些 JSON，国内直接可达。
