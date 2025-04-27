const { Telegraf, Markup } = require('telegraf');


const fs = require('fs');
const path = require('path');

const schedule = require('node-schedule');
const parseMessages = require('./parsers/messageParser');

require('dotenv').config();

// Configuration imports
const REPORT_TYPES = require('./config/reportTypes');
const GEO_CONFIG = require('./config/geoConfig');
const themes = require('./config/themes');
const needsAndPains = require('./config/needsAndPains');

// Bot Configuration
const BOT_TOKEN = process.env.BOT_TOKEN;


// Directory paths
const pathConfig = {
  raw: path.join(__dirname, 'data', 'raw'),
  analyzed: path.join(__dirname, 'data', 'analyzed'),
  reports: path.join(__dirname, 'data', 'reports'),
  charts: path.join(__dirname, 'data', 'charts'),
  cache: path.join(__dirname, 'data', 'cache')
};

// Create directories if they don't exist
Object.values(pathConfig).forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Initialize Telegram bot
const bot = new Telegraf(BOT_TOKEN);

// Initialize Telegram client for parsing messages
const initTelegramClient = require('./telegram/client');
let telegramClient = null;

// Import required modules
const analyzeMessages = require('./analyzers/nlpAnalyzer');
const generateCharts = require('./visualization/chartGenerator');
const DeepSeekLLM = require('./llm/deepseek');
const sendContent = require('./delivery/contentSender');

// Function to generate report content
async function generateContent(type, geo) {
  try {
    const llm = new DeepSeekLLM(pathConfig, "deepseek", "deepseek-reasoner", 4000, geo);
    
    if (!GEO_CONFIG[geo]) throw new Error(`Invalid geo code: ${geo}`);

    switch(type) {
      case REPORT_TYPES.REPORT:
      case 'report_only':
      case REPORT_TYPES.NEW_REPORT:
        return await llm.generate_report(geo);
      case REPORT_TYPES.CHARTS: 
      case 'charts_only':
      case REPORT_TYPES.NEW_CHARTS:
        await generateCharts(geo, pathConfig);
        return 'Charts generated successfully';
      case REPORT_TYPES.FULL:
      case 'full_report':
        const report = await llm.generate_report(geo);
        await generateCharts(geo, pathConfig);
        return report;
      default:
        throw new Error(`Invalid report type: ${type}`);
    }
  } catch (error) {
    console.error('Error generating content:', error);
    throw error;
  }
}

// Main processing function
async function processGeo(geo) {
  try {
    await parseMessages(geo, GEO_CONFIG, pathConfig, telegramClient);
    await analyzeMessages(geo, pathConfig, themes, needsAndPains);
    await generateCharts(geo, pathConfig);
    const llm = new DeepSeekLLM(pathConfig, "deepseek", "deepseek-reasoner", 4000, geo);
    await llm.generate_report(geo);
    console.log(`Complete processing for ${geo} finished`);
    return true;
  } catch (error) {
    console.error(`Error in processing pipeline for ${geo}:`, error);
    return false;
  }
}

// Schedule jobs
function scheduleJobs() {
  // Daily job
  schedule.scheduleJob('0 0 * * *', async () => {
    console.log('Running daily processing');
    for (const geo of Object.keys(GEO_CONFIG)) {
      await processGeo(geo);
    }
  });

  // Weekly job
  schedule.scheduleJob('0 0 * * 0', async () => {
    console.log('Running weekly processing');
  });
}

// Helper functions
function getCurrentDate() {
  const now = new Date();
  return now.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

async function checkCache(type, geo) {
  try {
    const cacheTime = 3600000; // 1 hour
    const cacheFile = path.join(pathConfig.cache, `${type}_${geo}.json`);
    
    if (fs.existsSync(cacheFile)) {
      const stats = fs.statSync(cacheFile);
      const fileAge = Date.now() - stats.mtimeMs;
      
      if (fileAge < cacheTime) {
        return JSON.parse(fs.readFileSync(cacheFile, 'utf8')).content;
      }
    }
    return null;
  } catch (error) {
    console.error('Cache check error:', error);
    return null;
  }
}

function updateCache(type, geo, content) {
  try {
    const cacheDir = pathConfig.cache;
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    
    const cacheFile = path.join(cacheDir, `${type}_${geo}.json`);
    fs.writeFileSync(cacheFile, JSON.stringify({
      content,
      timestamp: Date.now()
    }));
  } catch (error) {
    console.error('Cache update error:', error);
  }
}

// Bot handlers
bot.start(async (ctx) => {
  await ctx.replyWithMarkdown(
    '🖥️ *Добро пожаловать в TG-AI-REPORTER!* 🖥️\n\n' +
    'Этот бот поможет вам получить аналитические отчеты и визуализации по различным регионам.\n\n' +
    'Что вы хотите сделать?',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🌍 Выбрать регион", callback_data: "select_geo" }]
        ]
      }
    }
  );
  
  await ctx.reply('Используйте быстрые команды:', {
    reply_markup: {
      keyboard: [
        ['🌍 Выбрать регион']
      ],
      resize_keyboard: true,
      persistent: true
    }
  });
});

// Register help command
bot.telegram.setMyCommands([
  { command: 'help', description: 'Показать справку' },
  { command: 'start', description: 'Начать работу с ботом' },
  { command: 'geo', description: 'Выбрать регион' },
  { command: 'cancel', description: 'Отменить текущую операцию' }
]);

// Help command handler
async function showHelp(ctx) {
  await ctx.replyWithMarkdown(
    '*📚 Справка по использованию бота*\n\n' +
    '• Для начала работы выберите интересующий вас регион\n' +
    '• Вы можете получить только текстовый отчет, только графики или полный отчет с графиками\n' +
    '• Графики доступны в нескольких категориях: настроения, темы, потребности и тренды\n' +
    '• Вы можете в любой момент вернуться в главное меню\n\n' +
    '*Доступные команды:*\n' +
    '/start - Начать работу с ботом\n' +
    '/help - Показать эту справку\n' +
    '/geo - Выбрать регион\n' +
    '/reports - Получить список отчетов\n' +
    '/charts - Получить список графиков\n' +
    '/cancel - Отменить текущую операцию',
    {
      reply_markup: {
        inline_keyboard: [[{ text: '↩️ На главную', callback_data: 'back_main' }]]
      }
    }
  );
}

bot.command('help', async (ctx) => {
  try {
    await showHelp(ctx);
  } catch (error) {
    console.error('Error showing help:', error);
    await ctx.reply('Произошла ошибка при отображении справки');
  }
});

bot.action('help', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await showHelp(ctx);
  } catch (error) {
    console.error('Error showing help:', error);
    await ctx.reply('Произошла ошибка при отображении справки');
  }
});

// Geo selection handler
function handleGeoSelection(ctx) {
  const geoButtons = [
    [
      { text: '🇩🇪 Германия', callback_data: 'geo_DEU' },
      { text: '🇪🇸 Испания', callback_data: 'geo_ESP' },
      { text: '🇵🇹 Португалия', callback_data: 'geo_PRT' }
    ],
    [
      { text: '🇵🇱 Польша', callback_data: 'geo_POL' },
      { text: '🇸🇪 Швеция', callback_data: 'geo_SWE' },
      { text: '🇫🇷 Франция', callback_data: 'geo_FRA' }
    ],
    [
      { text: '🇮🇹 Италия', callback_data: 'geo_ITA' },
      { text: '🇨🇿 Чехия', callback_data: 'geo_CZE' }
    ],
    [
      { text: '◀️ На главную', callback_data: 'back_main' }
    ]
  ];

  return ctx.reply('🌍 Выберите регион:', {
    reply_markup: {
      inline_keyboard: geoButtons
    }
  });
}

// Text commands
bot.hears(['🌍 Выбрать регион', 'Выбрать регион', 'Выбрать гео', '/geo'], handleGeoSelection);

bot.hears(['📋 Получить отчеты', 'Отчеты', '/reports'], (ctx) => {
  ctx.answerCbQuery && ctx.answerCbQuery();
  return ctx.reply('Выберите регион для отчета:', {
    reply_markup: {
      inline_keyboard: Object.keys(GEO_CONFIG).map(geo => 
        [{ text: `${GEO_CONFIG[geo].name}`, callback_data: `report_only_${geo}` }]
      ).concat([[{ text: '◀️ На главную', callback_data: 'back_main' }]])
    }
  });
});

bot.hears(['📊 Графики', 'Графики', '/charts'], (ctx) => {
  ctx.answerCbQuery && ctx.answerCbQuery();
  return ctx.reply('Выберите регион для графиков:', {
    reply_markup: {
      inline_keyboard: Object.keys(GEO_CONFIG).map(geo => 
        [{ text: `${GEO_CONFIG[geo].name}`, callback_data: `charts_only_${geo}` }]
      ).concat([[{ text: '◀️ На главную', callback_data: 'back_main' }]])
    }
  });
});

bot.hears(['ℹ️ Помощь', 'Помощь', '/help'], (ctx) => {
  ctx.answerCbQuery && ctx.answerCbQuery();
  return showHelp(ctx);
});

bot.command('cancel', (ctx) => {
  return ctx.reply('✅ Текущая операция отменена', {
    reply_markup: {
      inline_keyboard: [[{ text: '↩️ На главную', callback_data: 'back_main' }]]
    }
  });
});

// Callback handlers
bot.action(/geo_(.+)/, async (ctx) => {
  const geo = ctx.match[1];
  const geoName = GEO_CONFIG[geo].name;
  
  await ctx.editMessageText(
    `📌 *Выбран регион: ${geoName}*\n\nВыберите действие:`, 
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📝 Отчет', callback_data: `report_only_${geo}` }],
          [{ text: '📈 Полный отчет + графики', callback_data: `full_report_${geo}` }],
          [
            { text: '🔄 Новый отчет', callback_data: `new_report_${geo}` }, 
            { text: '📊 Графики', callback_data: `new_charts_${geo}` }
          ],
          [{ text: '◀️ Назад к выбору региона', callback_data: 'select_geo' }]
        ]
      }
    }
  );
});

// Handle report button - shows last generated report
bot.action(/report_only_(.+)/, async (ctx) => {
  const geo = ctx.match[1];
  try {
    const llm = new DeepSeekLLM(pathConfig, "deepseek", "deepseek-reasoner", 4000, geo);
    const report = await llm.generate_report(geo, false);
    await sendContent(ctx, REPORT_TYPES.REPORT, geo, report, pathConfig, generateCharts);
  } catch (error) {
    await ctx.reply(`❌ Error getting report: ${error.message}`);
  }
});

// Handle new report button
bot.action(/new_report_(.+)/, async (ctx) => {
  const geo = ctx.match[1];
  const geoName = GEO_CONFIG[geo].name;
  const userID = ctx.from.id;
  let progressInterval;
  
  try {
    const progressMessage = await ctx.replyWithMarkdown(
      `🔄 *Генерация нового отчета для ${geoName}*\n` +
      `▰▱▱▱▱▱▱▱▱▱ 10%\n` +
      `⏳ Примерное время: 30-60 секунд`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ Отменить', callback_data: `cancel_${userID}` }]
          ]
        }
      }
    );

    let progress = 10;
    progressInterval = setInterval(async () => {
      try {
        progress = Math.min(progress + 5, 90);
        const progressBar = '▰'.repeat(Math.floor(progress/10)) + '▱'.repeat(10 - Math.floor(progress/10));
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          progressMessage.message_id,
          null,
          `🔄 *Прогресс отчета: ${progress}%*\n` +
          `${progressBar}\n` +
          `⏳ Осталось: ${Math.max(5, 60 - (progress*0.6))} секунд`,
          { parse_mode: 'Markdown' }
        );
      } catch (editError) {
        console.log('Progress update error:', editError.message);
      }
    }, 2000);

    const llm = new DeepSeekLLM(pathConfig, "deepseek", "deepseek-reasoner", 4000, geo);
    const report = await llm.generate_report(geo, true);

    clearInterval(progressInterval);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      progressMessage.message_id,
      null,
      `✅ *Новый отчет для ${geoName} готов!*\n` +
      `▰▰▰▰▰▰▰▰▰▰ 100%`,
      { parse_mode: 'Markdown' }
    );

    await sendContent(ctx, REPORT_TYPES.NEW_REPORT, geo, report, pathConfig, generateCharts);
  } catch (error) {
    if (progressInterval) clearInterval(progressInterval);
    await ctx.reply(`❌ Ошибка генерации отчета: ${error.message}`);
  }
});

// Handle full report - shows last report + last charts
bot.action(/full_report_(.+)/, async (ctx) => {
  const geo = ctx.match[1];
  try {
    const llm = new DeepSeekLLM(pathConfig, "deepseek", "deepseek-reasoner", 4000, geo);
    const report = await llm.generate_report(geo, false);
    await sendContent(ctx, REPORT_TYPES.FULL, geo, report, pathConfig, generateCharts);
  } catch (error) {
    await ctx.reply(`❌ Error getting full report: ${error.message}`);
  }
});

// Handle charts button
bot.action(/charts_only_(.+)/, async (ctx) => {
  const geo = ctx.match[1];
  try {
    await sendContent(ctx, REPORT_TYPES.CHARTS, geo, '', pathConfig, generateCharts);
  } catch (error) {
    await ctx.reply(`❌ Error getting charts: ${error.message}`);
  }
});

// Handle new charts button
bot.action(/new_charts_(.+)/, async (ctx) => {
  const geo = ctx.match[1];
  try {
    await generateCharts(geo);
    await sendContent(ctx, REPORT_TYPES.NEW_CHARTS, geo, '', pathConfig, generateCharts);
  } catch (error) {
    await ctx.reply(`❌ Error generating new charts: ${error.message}`);
  }
});

// Handle chart types
bot.action(/charts_(.+)/, async (ctx) => {
  const geo = ctx.match[1].toUpperCase();
  
  if (!GEO_CONFIG[geo]) {
    await ctx.reply(`❌ Invalid region code: ${geo}`);
    return;
  }
  
  await ctx.reply(`Выберите тип графика для ${geo}:`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Анализ настроений', callback_data: `chart_sentiment_${geo}` }],
        [{ text: 'Распределение тем', callback_data: `chart_themes_${geo}` }],
        [{ text: 'Потребности и проблемы', callback_data: `chart_needs_${geo}` }],
        [{ text: 'Недельные тренды', callback_data: `chart_trends_${geo}` }],
        [{ text: 'Назад', callback_data: `geo_${geo}` }]
      ]
    }
  });
});

// Handle specific chart view
bot.action(/chart_([a-z]+)_([A-Z]+)/, async (ctx) => {
  const chartType = ctx.match[1];
  const geo = ctx.match[2].toUpperCase();
  
  if (!GEO_CONFIG[geo]) {
    await ctx.reply(`❌ Invalid region code: ${geo}`);
    return;
  }
  
  try {
    const chartPath = path.join(pathConfig.charts, `${chartType}_${geo}.png`);
    if (!fs.existsSync(chartPath)) {
      await generateCharts(geo, pathConfig);
    }
    
    await ctx.replyWithPhoto({ source: chartPath }, {
      caption: `${chartType === 'sentiment' ? 'Анализ настроений' : 
                chartType === 'themes' ? 'Распределение тем' :
                chartType === 'needs' ? 'Потребности и проблемы' :
                'Недельные тренды'} для ${geo}`
    });
  } catch (error) {
    await ctx.reply(`❌ Error displaying chart: ${error.message}`);
  }
});

// Cancel operation handler
bot.action(/cancel_(.+)/, async (ctx) => {
  const userID = ctx.match[1].split('_')[0];
  if (ctx.from.id.toString() === userID) {
    await ctx.answerCbQuery('⚠️ Операция отменена!');
    await ctx.deleteMessage();
    await ctx.reply('✅ Текущая операция успешно отменена');
  }
});

// Handle geo selection menu
bot.action('select_geo', async (ctx) => {
  const geoButtons = [
    [
      { text: '🇩🇪 Германия', callback_data: 'geo_DEU' },
      { text: '🇪🇸 Испания', callback_data: 'geo_ESP' },
      { text: '🇵🇹 Португалия', callback_data: 'geo_PRT' }
    ],
    [
      { text: '🇵🇱 Польша', callback_data: 'geo_POL' },
      { text: '🇸🇪 Швеция', callback_data: 'geo_SWE' },
      { text: '🇫🇷 Франция', callback_data: 'geo_FRA' }
    ],
    [
      { text: '🇮🇹 Италия', callback_data: 'geo_ITA' },
      { text: '🇨🇿 Чехия', callback_data: 'geo_CZE' }
    ],
    [
      { text: '◀️ На главную', callback_data: 'back_main' }
    ]
  ];

  await ctx.editMessageText('🌍 Выберите регион:', {
    reply_markup: {
      inline_keyboard: geoButtons
    }
  });
});

// Back to main menu
bot.action('back_main', async (ctx) => {
  await ctx.editMessageText('Главное меню', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🌍 Выбрать регион', callback_data: 'select_geo' }],
        [{ text: '📋 Получить отчеты', callback_data: 'get_reports' }],
        [{ text: '📊 Посмотреть графики', callback_data: 'view_charts' }]
      ]
    }
  });
});

// Get reports menu
bot.action('get_reports', async (ctx) => {
  const geoButtons = Object.keys(GEO_CONFIG).map(geo => [{ 
    text: `${GEO_CONFIG[geo].name}`, 
    callback_data: `report_only_${geo}` 
  }]);
  geoButtons.push([{ text: '◀️ На главную', callback_data: 'back_main' }]);
  
  await ctx.reply('📋 Выберите регион для отчета:', {
    reply_markup: {
      inline_keyboard: geoButtons
    }
  });
});

// View charts menu
bot.action('view_charts', async (ctx) => {
  const geoButtons = Object.keys(GEO_CONFIG).map(geo => [{ 
    text: `${GEO_CONFIG[geo].name}`, 
    callback_data: `charts_${geo}` 
  }]);
  geoButtons.push([{ text: '◀️ На главную', callback_data: 'back_main' }]);
  
  await ctx.reply('📊 Выберите регион для графиков:', {
    reply_markup: {
      inline_keyboard: geoButtons
    }
  });
});

// Main function to start bot
async function startBot() {
  try {
    // Initialize directories
    Object.values(pathConfig).forEach(dir => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
    
    // Initialize Telegram client
    telegramClient = await initTelegramClient();
    
    // Schedule jobs
    scheduleJobs();
    
    // Start initial processing for all geos
    console.log('Starting initial processing for all geos');
    for (const geo of Object.keys(GEO_CONFIG)) {
      processGeo(geo).catch(console.error);
    }
    
    // Start the bot
    bot.launch();
    console.log('Bot started');
  } catch (error) {
    console.error('Error starting bot:', error);
  }
}

// Start the bot
startBot();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));