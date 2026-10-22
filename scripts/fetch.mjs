/* design-feed 抓取脚本：GitHub Actions 每小时运行
 * 产出 data/dribbble.json（Dribbble 热门 shots，多级来源容灾）
 *      data/uisdc.json（优设 UISDC 首页文章列表）
 * 无第三方依赖，单失败不影响另一个源
 */
import { writeFileSync, mkdirSync } from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
    },
    redirect: "follow",
  });
  if (!r.ok) throw new Error(url + " HTTP " + r.status);
  return r.text();
}

function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .trim();
}

/* ---- Dribbble：热门页 shot 链接（slug 自带标题） ---- */
function parseShots(html) {
  const seen = new Set();
  const items = [];
  const re = /href="(https:\/\/dribbble\.com\/shots\/(\d+)(-[^"?#\/]+)?)/g;
  let m;
  while ((m = re.exec(html))) {
    const id = m[2];
    if (seen.has(id)) continue;
    seen.add(id);
    const slug = m[3] ? m[3].slice(1) : "";
    const title = slug ? decodeURIComponent(slug).split("-").join(" ") : "Shot " + id;
    items.push({ title, url: m[1] });
    if (items.length >= 24) break;
  }
  return items;
}

/* ---- RSS 解析（RSSHub 用） ---- */
function parseRss(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[1];
    const get = (t) => {
      const mm = b.match(new RegExp("<" + t + "[^>]*>([\\s\\S]*?)</" + t + ">"));
      return mm ? decode(mm[1]) : "";
    };
    const title = get("title");
    const url = get("link");
    if (!title || !url) continue;
    // RSSHub 的 dribbble 标题常带 " by X on Dribbble" 尾巴，剪掉
    const clean = title.replace(/\s+by\s+[^ ]+\s+on\s+Dribbble\s*$/i, "");
    items.push({ title: clean || title, url });
    if (items.length >= 24) break;
  }
  return items;
}

/* ---- jina reader markdown 解析（最后兜底） ---- */
function parseJina(md) {
  const seen = new Set();
  const items = [];
  const re = /\[([^\]\[]{5,120})\]\((https:\/\/dribbble\.com\/shots\/\d+[^\)]*)\)/g;
  let m;
  while ((m = re.exec(md))) {
    const url = m[2].split(")")[0];
    const id = (url.match(/\/shots\/(\d+)/) || [])[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    items.push({ title: m[1].trim(), url });
    if (items.length >= 24) break;
  }
  return items;
}

async function dribbble() {
  const tries = [
    // 1. 直抓热门页（本地/部分环境可行，Actions 上常被 CF 盾拦）
    async () => {
      const html = await fetchText("https://dribbble.com/shots/popular");
      const items = parseShots(html);
      if (items.length < 5) throw new Error("direct parse got " + items.length);
      return items;
    },
    // 2. RSSHub 官方 + 社区镜像
    async () => {
      let err;
      for (const base of ["https://rsshub.app", "https://rsshub.rssforever.com"]) {
        try {
          const xml = await fetchText(base + "/dribbble/popular/week");
          const items = parseRss(xml);
          if (items.length >= 5) return items;
        } catch (e) { err = e; }
      }
      throw err || new Error("rsshub all failed");
    },
    // 3. r.jina.ai 渲染兜底
    async () => {
      const md = await fetchText("https://r.jina.ai/https://dribbble.com/shots/popular");
      const items = parseJina(md);
      if (items.length < 5) throw new Error("jina parse got " + items.length);
      return items;
    },
  ];
  let err;
  for (const t of tries) {
    try { return await t(); } catch (e) { err = e; }
  }
  throw err || new Error("dribbble all failed");
}

/* ---- 优设 UISDC：首页文章列表（h2.item-title） ---- */
async function uisdc() {
  const html = await fetchText("https://www.uisdc.com/");
  const seen = new Set();
  const items = [];
  const re = /<h2 class="item-title"><a[^>]*href="(https:\/\/www\.uisdc\.com\/[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = m[1];
    if (seen.has(url)) continue;
    seen.add(url);
    const title = decode(m[2]);
    if (!title) continue;
    items.push({ title, url });
    if (items.length >= 20) break;
  }
  if (items.length < 5) throw new Error("uisdc parse got " + items.length);
  return items;
}

const SOURCES = [
  { name: "dribbble", fn: dribbble },
  { name: "uisdc", fn: uisdc },
];

mkdirSync("data", { recursive: true });
for (const s of SOURCES) {
  try {
    const items = await s.fn();
    const payload = { updated_at: new Date().toISOString(), items };
    writeFileSync("data/" + s.name + ".json", JSON.stringify(payload, null, 1));
    console.log("OK", s.name, items.length, "items");
  } catch (e) {
    console.error("FAIL", s.name, e.message);
    process.exitCode = 1;
  }
}
