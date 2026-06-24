require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const Anthropic = require('@anthropic-ai/sdk');
const cron = require('node-cron');
const RSSParser = require('rss-parser');

const app = express();
const rssParser = new RSSParser();

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const RSS_FEEDS = [
  // 台灣新聞
  { name: '中央社', url: 'https://www.cna.com.tw/RSS/RSS_Index.aspx' },
  { name: '自由時報', url: 'https://news.ltn.com.tw/rss/all.xml' },
  // 國際新聞（中文）
  { name: 'BBC中文', url: 'https://feeds.bbci.co.uk/zhongwen/trad/rss.xml' },
  { name: '法廣中文', url: 'https://www.rfi.fr/tw/rss' },
];

async function fetchNews() {
  const allNews = [];
  for (const feed of RSS_FEEDS) {
    try {
      const parsed = await rssParser.parseURL(feed.url);
      const items = parsed.items.slice(0, 5).map(item => ({
        source: feed.name,
        title: item.title,
        summary: item.contentSnippet || item.content || '',
      }));
      allNews.push(...items);
    } catch (err) {
      console.error(`Failed to fetch ${feed.name}:`, err.message);
    }
  }
  return allNews;
}

async function generateNewsSummary(timeLabel) {
  const news = await fetchNews();
  if (news.length === 0) return '目前無法取得新聞，請稍後再試。';

  const newsText = news.map(n => `【${n.source}】${n.title}\n${n.summary}`).join('\n\n');

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 3000,
    messages: [
      {
        role: 'user',
        content: `你是戰地記者強尼，以下是最新新聞。請整理成${timeLabel}新聞完整報導，用繁體中文，挑選5則最重要的新聞，每則包含：
1. 📌 標題
2. 詳細內容說明（3-5句話，說清楚事件背景、發展、影響）
3. 💬 強尼點評（你的專業分析與看法，1-2句）

新聞之間用分隔線隔開，風格像資深戰地記者，直接、有力、有深度。

新聞來源：
${newsText}`,
      },
    ],
  });

  return message.content[0].text;
}

async function pushNews(timeLabel) {
  const userId = process.env.USER_LINE_ID;
  if (!userId) return;

  try {
    const summary = await generateNewsSummary(timeLabel);
    await client.pushMessage({
      to: userId,
      messages: [
        {
          type: 'text',
          text: `📰 戰地記者強尼｜${timeLabel}快報\n${'─'.repeat(20)}\n\n${summary}`,
        },
      ],
    });
    console.log(`${timeLabel}新聞已推送`);
  } catch (err) {
    console.error('推送失敗:', err);
  }
}

// 早上9點
cron.schedule('0 9 * * *', () => pushNews('早報'), { timezone: 'Asia/Taipei' });
// 中午12點
cron.schedule('0 12 * * *', () => pushNews('午報'), { timezone: 'Asia/Taipei' });
// 傍晚18點
cron.schedule('0 18 * * *', () => pushNews('晚報'), { timezone: 'Asia/Taipei' });

// Webhook（處理用戶傳訊）
app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  res.json({ status: 'ok' });

  for (const event of req.body.events) {
    if (event.type !== 'message' || event.message.type !== 'text') continue;
    const text = event.message.text.trim();

    if (text === '新聞' || text === '快訊' || text === '最新') {
      try {
        const summary = await generateNewsSummary('即時');
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `📰 戰地記者強尼｜即時快報\n${'─'.repeat(20)}\n\n${summary}` }],
        });
      } catch (err) {
        console.error(err);
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`戰地記者(強尼) 已啟動，監聽 port ${PORT}`);
});
