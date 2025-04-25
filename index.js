const { Telegraf, Markup } = require('telegraf');
const { Api, TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs');
const path = require('path');
const natural = require('natural');
const { Chart } = require('chart.js');
const { createCanvas } = require('canvas');
const axios = require('axios');
const schedule = require('node-schedule');
const parseMessages = require('./parsers/messageParser');

require('dotenv').config();

// Report Types
const REPORT_TYPES = require('./config/reportTypes');
// Telegram Chat Configuration
const GEO_CONFIG = require('./config/geoConfig');
// Define themes for analysis
const themes = require('./config/themes');
// Define needs and pains for analysis
const needsAndPains = require('./config/needsAndPains');


// Bot Configuration
const BOT_TOKEN = process.env.BOT_TOKEN;
// const SESSION_FILE_PATH = path.join(__dirname, 'telegram_session.session');
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// Update all geoConfig references to use GEO_CONFIG instead
const pathConfig = {
  raw: path.join(__dirname, 'data', 'raw'),
  analyzed: path.join(__dirname, 'data', 'analyzed'),
  reports: path.join(__dirname, 'data', 'reports'),
  charts: path.join(__dirname, 'data', 'charts'),
  cache: path.join(__dirname, 'data', 'cache')
};

// Create directories if they don't exist
Object.values(pathConfig).forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Initialize Telegram bot
const bot = new Telegraf(BOT_TOKEN);

// Initialize Telegram client for parsing messages
const initTelegramClient = require('./telegram/client');
let telegramClient = null;

const analyzeMessages = require('./analyzers/nlpAnalyzer');

const generateCharts = require('./visualization/chartGenerator');

const DeepSeekLLM = require('./llm/deepseek');

const sendContent = require('./delivery/contentSender');

// Function to generate report content
async function generateContent(type, geo) {
  try {
    const llm = new DeepSeekLLM(pathConfig, "deepseek", "deepseek-reasoner", 4000, geo);
    
    // Validate geo first
    if (!GEO_CONFIG[geo]) {
      throw new Error(`Invalid geo code: ${geo}`);
    }

    // Handle all possible report types
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
        throw new Error(`Invalid report type: ${type}. Valid types are: ${Object.values(REPORT_TYPES).join(', ')}`);
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
    // Any additional weekly processing can be added here
  });
}

bot.start(async (ctx) => {
  await ctx.replyWithMarkdown(
    '🖥️ *Добро пожаловать в TG-AI-REPORTER!* 🖥️\n\n' +
    'Этот бот поможет вам получить аналитические отчеты и визуализации по различным регионам.\n\n' +
    'Что вы хотите сделать?',
    {
      reply_markup: {
        inline_keyboard: [
          // [{ text: "📋 Получить отчеты", callback_data: "get_reports" }],
          // [{ text: "📊 Посмотреть графики", callback_data: "view_charts" }],
          [{ text: "🌍 Выбрать регион", callback_data: "select_geo" }]
        ]
      }
    }
  );
  
  // Добавление удобных кнопок в нижней панели для быстрого доступа
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

// Обработка команды помощи
// Register help command with Telegram API
bot.telegram.setMyCommands([
  { command: 'help', description: 'Показать справку' },
  { command: 'start', description: 'Начать работу с ботом' },
  { command: 'geo', description: 'Выбрать регион' },
  { command: 'cancel', description: 'Отменить текущую операцию' }
]);

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

// Обработка текстовых команд для улучшения UX
// Handle geo selection command
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

bot.hears(['🌍 Выбрать регион', 'Выбрать регион', 'Выбрать гео', '/geo'], (ctx) => {
  return handleGeoSelection(ctx);
});

bot.hears(['📋 Получить отчеты', 'Отчеты', '/reports'], (ctx) => {
  ctx.answerCbQuery && ctx.answerCbQuery();
  return handleMenu(ctx, 'Report for');
});

bot.hears(['📊 Графики', 'Графики', '/charts'], (ctx) => {
  ctx.answerCbQuery && ctx.answerCbQuery();
  return handleMenu(ctx, 'Charts for');
});

bot.hears(['ℹ️ Помощь', 'Помощь', '/help'], (ctx) => {
  ctx.answerCbQuery && ctx.answerCbQuery();
  return showHelp(ctx);
});

// Команда для отмены текущей операции
bot.command('cancel', (ctx) => {
  return ctx.reply('✅ Текущая операция отменена', {
    reply_markup: {
      inline_keyboard: [[{ text: '↩️ На главную', callback_data: 'back_main' }]]
    }
  });
});


// Улучшенный обработчик выбора региона
bot.action(/geo_(.+)/, async (ctx) => {
  const geo = ctx.match[1];
  const geoName = GEO_CONFIG[geo].name;
  
  await ctx.editMessageText(
    `📌 *Выбран регион: ${geoName}*\n\nВыберите действие:`, 
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📝 Отчет', callback_data: `report_only_${geo}` }, 
            // { text: '📊 Графики', callback_data: `charts_only_${geo}` }
          ],
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

// Handle chart view selection
bot.action(/charts_(.+)/, async (ctx) => {
  const geo = ctx.match[1].toUpperCase(); // Ensure uppercase geo code
  
  if (!GEO_CONFIG[geo]) {
    await ctx.reply(`❌ Invalid region code: ${geo}. Available regions: ${Object.keys(GEO_CONFIG).join(', ')}`);
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
  const geo = ctx.match[2].toUpperCase(); // Ensure uppercase geo code
  
  if (!GEO_CONFIG[geo]) {
    await ctx.reply(`❌ Invalid region code: ${geo}. Available regions: ${Object.keys(GEO_CONFIG).join(', ')}`);
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

// Handle report button - shows last generated report
bot.action(/report_only_(.+)/, async (ctx) => {
  const geo = ctx.match[1];
  try {
    const llm = new DeepSeekLLM(pathConfig, "deepseek", "deepseek-reasoner", 4000, geo);
    const report = await llm.generate_report(geo, false); // Get cached report
    await sendContent(ctx, REPORT_TYPES.REPORT, geo, report, pathConfig, generateCharts);
  } catch (error) {
    await ctx.reply(`❌ Error getting report: ${error.message}`);
  }
});

// Handle new report button - generates fresh report with progress bar
bot.action(/new_report_(.+)/, async (ctx) => {
  const geo = ctx.match[1];
  const geoName = GEO_CONFIG[geo].name;
  const userID = ctx.from.id;
  let progressInterval;
  
  try {
    // Show initial progress message
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

    // Progress simulation
    let progress = 10;
    progressInterval = setInterval(async () => {
      try {
        progress = Math.min(progress + 5, 90); // Don't go to 100% until done
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

    // Generate report
    const llm = new DeepSeekLLM(pathConfig, "deepseek", "deepseek-reasoner", 4000, geo);
    const report = await llm.generate_report(geo, true);

    // Complete progress
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
    const report = await llm.generate_report(geo, false); // Get cached report
    await sendContent(ctx, REPORT_TYPES.FULL, geo, report, pathConfig, generateCharts);
  } catch (error) {
    await ctx.reply(`❌ Error getting full report: ${error.message}`);
  }
});

// Handle charts button - shows last generated charts
bot.action(/charts_only_(.+)/, async (ctx) => {
  const geo = ctx.match[1];
  try {
    await sendContent(ctx, REPORT_TYPES.CHARTS, geo, '', pathConfig, generateCharts);
  } catch (error) {
    await ctx.reply(`❌ Error getting charts: ${error.message}`);
  }
});

// Handle new charts button - generates fresh charts
bot.action(/new_charts_(.+)/, async (ctx) => {
  const geo = ctx.match[1];
  try {
    await generateCharts(geo);
    await sendContent(ctx, REPORT_TYPES.NEW_CHARTS, geo, '', pathConfig, generateCharts);
  } catch (error) {
    await ctx.reply(`❌ Error generating new charts: ${error.message}`);
  }
});

// Обработка отчетов с прогресс-баром и возможностью отмены
async function handleReport(ctx) {
  // Extract type and geo from callback data
  const match = ctx.match[0].match(/^([a-z_]+)_([A-Z]+)$/);
  if (!match) {
    return ctx.reply('❌ Invalid request format');
  }
  
  const type = match[1];
  const geo = match[2];
  
  if (!geo || !GEO_CONFIG[geo]) {
    return ctx.reply('❌ Неизвестный регион');
  }

  // Validate report type
  const validTypes = [
    'report_only', 'charts_only', 'full_report',
    'new_report', 'new_charts',
    ...Object.values(REPORT_TYPES)
  ];
  
  if (!validTypes.includes(type)) {
    return ctx.reply(`❌ Неподдерживаемый тип отчета: ${type}`);
  }
  const geoName = GEO_CONFIG[geo].name;
  const userID = ctx.from.id;
  let progressInterval;
  let cancelRequested = false;
  
  try {
    // Handle cached reports/charts
    if (type === 'report_only' || type === 'charts_only') {
      const cacheType = type === 'report_only' ? REPORT_TYPES.REPORT : REPORT_TYPES.CHARTS;
      const cachedContent = await checkCache(cacheType, geo);
      if (cachedContent) {
        await ctx.reply(`✅ Используем кешированные данные для ${geoName}`);
        await sendContent(ctx, cacheType, geo, cachedContent);
        return;
      }
    }

    // Handle new reports/charts
    if (type === 'new_report' || type === 'new_charts') {
      const reportType = type === 'new_report' ? REPORT_TYPES.REPORT : REPORT_TYPES.CHARTS;
      const report = await generateContent(reportType, geo);
      updateCache(reportType, geo, report);
      await sendContent(ctx, reportType, geo, report);
      return;
    }

    // Handle full reports (always generate fresh)
    if (type === 'full_report') {
      const report = await generateContent(REPORT_TYPES.FULL, geo);
      updateCache(REPORT_TYPES.FULL, geo, report);
      await sendContent(ctx, REPORT_TYPES.FULL, geo, report);
      return;
    }
    
    // Отправляем сообщение о начале генерации с кнопкой отмены
    const progressMessage = await ctx.replyWithMarkdown(
      getProgressMessage(type, geo), 
      {
        reply_markup: { 
          inline_keyboard: [
            [{ text: '❌ Отменить', callback_data: `cancel_${userID}_${Date.now()}` }]
          ] 
        }
      }
    );

    // Имитация прогресса с интервалом обновления
    let progress = 0;
    progressInterval = setInterval(async () => {
      if (cancelRequested) {
        clearInterval(progressInterval);
        return;
      }
      
      try {
        progress = Math.min(progress + 5, 95); // Не доходим до 100% для имитации ожидания финального результата
        
        // Динамически изменяющийся текст в зависимости от прогресса
        const progressText = getProgressUpdate(type, geo, progress);
        
        await ctx.telegram.editMessageText(
          ctx.chat.id, 
          progressMessage.message_id, 
          null, 
          progressText, 
          { 
            parse_mode: 'Markdown',
            reply_markup: { 
              inline_keyboard: [
                [{ text: '❌ Отменить', callback_data: `cancel_${userID}_${Date.now()}` }]
              ] 
            }
          }
        );
      } catch (editError) {
        console.log('Progress update error:', editError.message);
      }
    }, 2000);
    
    // Обработка запроса на отмену
    const cancelHandler = async (cancelCtx) => {
      const [cancelUserId] = cancelCtx.match[1].split('_');
      if (cancelCtx.from.id.toString() === cancelUserId) {
        cancelRequested = true;
        await cancelCtx.answerCbQuery('⚠️ Операция отменяется...');
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          progressMessage.message_id,
          null,
          '❌ *Операция отменена пользователем*',
          { parse_mode: 'Markdown' }
        );
        
        // Удаляем обработчик после использования
        bot.action(/cancel_(.+)/, () => {});
      }
    };
    
    // Регистрируем обработчик для отмены
    bot.action(/cancel_(.+)/, cancelHandler);
    
    // Генерируем контент, если операция не была отменена
    if (!cancelRequested) {
      const report = await generateContent(type, geo);
      
      // Обновляем кеш
      updateCache(type, geo, report);
      
      // Останавливаем индикатор прогресса
      clearInterval(progressInterval);
      progressInterval = null;
      
      // Показываем финальное сообщение об успешном завершении
      const completion = getCompletionMessage(type, geo);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMessage.message_id,
        null,
        completion.text,
        { 
          parse_mode: 'Markdown',
          reply_markup: completion.reply_markup 
        }
      );
      
      // Отправляем содержимое отчета
      await sendContent(ctx, type, geo, report);
    }
    
    // Удаляем обработчик после завершения
    bot.action(/cancel_(.+)/, () => {});
    
  } catch (error) {
    console.error(`Error in handleReport:`, error);
    
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
    
    await ctx.replyWithMarkdown(
      getErrorMessage(type, geo), 
      {
        reply_markup: { 
          inline_keyboard: [
            [{ text: '🔄 Повторить', callback_data: `${type}_${geo}` }],
            [{ text: '◀️ Вернуться назад', callback_data: `geo_${geo}` }]
          ] 
        }
      }
    );
  }
}

// Функции для работы с кешем
async function checkCache(type, geo) {
  try {
    const cacheTime = 3600000; // 1 час в миллисекундах
    const cacheFile = path.join(pathConfig.cache, `${type}_${geo}.json`);
    
    if (fs.existsSync(cacheFile)) {
      const stats = fs.statSync(cacheFile);
      const fileAge = Date.now() - stats.mtimeMs;
      
      // Если кеш свежий, используем его
      if (fileAge < cacheTime) {
        const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        return cacheData.content;
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
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    
    const cacheFile = path.join(cacheDir, `${type}_${geo}.json`);
    fs.writeFileSync(cacheFile, JSON.stringify({
      content,
      timestamp: Date.now()
    }));
  } catch (error) {
    console.error('Cache update error:', error);
  }
}

// Улучшенные сообщения о процессе
function getProgressMessage(type, geo) {
  const geoName = GEO_CONFIG[geo].name;
  let icon = '📝';
  let action = 'отчета';
  
  switch (type) {
    case REPORT_TYPES.REPORT:
      icon = '📝';
      action = 'отчета';
      break;
    case REPORT_TYPES.CHARTS:
      icon = '📊';
      action = 'графиков';
      break;
    case REPORT_TYPES.FULL:
      icon = '🚀';
      action = 'полного отчета';
      break;
    case REPORT_TYPES.NEW_REPORT:
      icon = '🔄';
      action = 'нового отчета';
      break;
    case REPORT_TYPES.NEW_CHARTS:
      icon = '🔄';
      action = 'новых графиков';
      break;
  }
  
  return `${icon} *Начинаем подготовку ${action} для региона ${geoName}*\n\nПожалуйста, подождите. Это может занять некоторое время...`;
}

function getProgressUpdate(type, geo, progress) {
  const geoName = GEO_CONFIG[geo].name;
  let action;
  
  switch (type) {
    case REPORT_TYPES.REPORT:
    case REPORT_TYPES.NEW_REPORT:
      action = 'отчета';
      break;
    case REPORT_TYPES.CHARTS:
    case REPORT_TYPES.NEW_CHARTS:
      action = 'графиков';
      break;
    case REPORT_TYPES.FULL:
      action = 'полного отчета';
      break;
  }
  
  // Создаем более информативный прогресс-бар
  const totalBlocks = 20;
  const filledBlocks = Math.floor(progress / 100 * totalBlocks);
  const progressBar = '▰'.repeat(filledBlocks) + '▱'.repeat(totalBlocks - filledBlocks);
  
  // Динамическое описание текущего этапа обработки в зависимости от прогресса
  let progressStage;
  if (progress < 20) {
    progressStage = "Сбор данных...";
  } else if (progress < 40) {
    progressStage = "Анализ информации...";
  } else if (progress < 60) {
    progressStage = "Генерация контента...";
  } else if (progress < 80) {
    progressStage = "Подготовка результатов...";
  } else {
    progressStage = "Финальная обработка...";
  }
  
  const remainingTime = Math.max(0, 30 - (progress * 0.3)).toFixed(0);
  
  return `*Создание ${action} для ${geoName}: ${progress}%*\n` +
    `${progressBar}\n\n` +
    `Текущий этап: ${progressStage}\n` +
    `⏳ Примерное время ожидания: ${remainingTime} секунд`;
}

function getErrorMessage(type, geo) {
  const geoName = GEO_CONFIG[geo].name;
  let action;
  
  switch (type) {
    case 'report_only':
      action = 'отчета';
      break;
    case 'charts_only':
      action = 'графиков';
      break;
    case 'full_report':
      action = 'полного отчета';
      break;
    case 'new_report':
      action = 'нового отчета';
      break;
    case 'new_charts':
      action = 'новых графиков';
      break;
    default:
      action = 'данных';
  }

  return `❌ *Ошибка при создании ${action} для ${geoName}*\n\n` +
    `Пожалуйста, попробуйте снова или обратитесь в поддержку.`;
}

function getCompletionMessage(type, geo) {
  const geoName = GEO_CONFIG[geo].name;
  const flag = {
    'DEU': '🇩🇪',
    'ESP': '🇪🇸', 
    'PRT': '🇵🇹'
  }[geo] || '🌍';

  let message, buttons;
  
  switch (type) {
    case REPORT_TYPES.REPORT:
      message = `✅ *Отчет успешно сгенерирован!* ${flag}\n\nРегион: ${geoName}\nДата: ${getCurrentDate()}\n\nОтчет содержит актуальную информацию и аналитические данные.`;
      buttons = [
        [{ text: '📊 Показать графики', callback_data: `charts_${geo}` }],
        [{ text: '🔄 Создать новый отчет', callback_data: `new_report_${geo}` }],
        [{ text: '📈 Полный отчет', callback_data: `full_report_${geo}` }]
      ];
      break;
    case REPORT_TYPES.CHARTS:
      message = `✅ *Графики успешно сгенерированы!* ${flag}\n\nРегион: ${geoName}\nДата: ${getCurrentDate()}\n\nВизуализации подготовлены на основе последних доступных данных.`;
      buttons = [
        [{ text: '📋 Показать отчет', callback_data: `report_${geo}` }],
        [{ text: '🔄 Создать новые графики', callback_data: `new_charts_${geo}` }],
        [{ text: '📈 Полный отчет', callback_data: `full_report_${geo}` }]
      ];
      break;
    case REPORT_TYPES.FULL:
      message = `✅ *Полный отчет успешно сгенерирован!* ${flag}\n\nРегион: ${geoName}\nДата: ${getCurrentDate()}\n\nОтчет включает в себя аналитическую информацию и визуализации.`;
      buttons = [
        [{ text: '📋 Только отчет', callback_data: `report_${geo}` }],
        [{ text: '📊 Только графики', callback_data: `charts_${geo}` }],
        [{ text: '🔄 Создать заново', callback_data: `full_report_${geo}` }]
      ];
      break;
    case REPORT_TYPES.NEW_REPORT:
      message = `✅ *Новый отчет успешно сгенерирован!* ${flag}\n\nРегион: ${geoName}\nДата: ${getCurrentDate()}\n\nОтчет содержит самые свежие данные.`;
      buttons = [
        [{ text: '📊 Показать графики', callback_data: `charts_${geo}` }],
        [{ text: '📈 Полный отчет', callback_data: `full_report_${geo}` }]
      ];
      break;
    case REPORT_TYPES.NEW_CHARTS:
      message = `✅ *Новые графики успешно сгенерированы!* ${flag}\n\nРегион: ${geoName}\nДата: ${getCurrentDate()}\n\nВизуализации обновлены согласно последним данным.`;
      buttons = [
        [{ text: '📋 Показать отчет', callback_data: `report_${geo}` }],
        [{ text: '📈 Полный отчет', callback_data: `full_report_${geo}` }]
      ];
      break;
  }

  return {
    text: message,
    reply_markup: {
      inline_keyboard: buttons
    }
  };
}

// Helper function to get formatted current date
function getCurrentDate() {
  const now = new Date();
  return now.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

// Original report handler (kept for reference but not used directly)
async function oldReportHandler(ctx) {
  const geo = ctx.match[1];
  const userID = ctx.from.id;
  let progressInterval;
  
  try {
    // Show initial progress message
    const progressMessage = await ctx.replyWithMarkdown(
      `🚀 *Начато создание отчета для ${GEO_CONFIG[geo].name}*\n` +
      `▰▰▰▰▰▰▰▰▰▰ 0%\n` +
      `⏳ Примерное время: 15-30 секунд`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ Отменить', callback_data: `cancel_${userID}` }]
          ]
        }
      }
    );

    // Progress simulation
    let progress = 0;
    progressInterval = setInterval(async () => {
      try {
        progress += 10;
        const progressBar = '▰'.repeat(progress/10) + '▱'.repeat(10 - progress/10);
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          progressMessage.message_id,
          null,
          `🚀 *Прогресс отчета: ${progress}%*\n` +
          `${progressBar}\n` +
          `⏳ Осталось: ${30 - (progress*0.3)} секунд`,
          { parse_mode: 'Markdown' }
        );
      } catch (editError) {
        console.log('Progress update error:', editError.message);
      }
    }, 3000);

    // Real report generation
    const llm = new DeepSeekLLM(pathConfig, "deepseek", "deepseek-reasoner", 4000, geo);
    const report = await llm.generate_report(geo);
    
    // Format and send report
    clearInterval(progressInterval);
    const formattedReport = `📊 *${GEO_CONFIG[geo].name} Analytics Report*\n\n${report}`;
    
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      progressMessage.message_id,
      null,
      `✅ *Отчет успешно сгенерирован!*\n` +
      `📥 Доступен для скачивания 24 часа`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📩 Скачать PDF', callback_data: `download_${geo}` }],
            [{ text: '📊 Посмотреть онлайн', url: 'https://analytics.example.com/reports' }]
          ]
        }
      }
    );

    // Send all charts
    const chartTypes = ['sentiment', 'themes', 'needs', 'trends'];
    for (const type of chartTypes) {
      const chartPath = path.join(pathConfig.charts, `${type}_${geo}.png`);
      if (fs.existsSync(chartPath)) {
        await ctx.replyWithPhoto({ source: chartPath }, {
          caption: type === 'sentiment' ? '📊 Анализ настроений' :
                   type === 'themes' ? '📈 Распределение тем' :
                   type === 'needs' ? '🔍 Потребности и проблемы' :
                   '📅 Недельные тренды'
        });
      }
    }

    // Send report
    await ctx.replyWithMarkdown(formattedReport, {
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Создать снова', callback_data: `report_${geo}` }],
          [{ text: '📚 Все отчеты', callback_data: 'all_reports' }]
        ]
      }
    });

  } catch (error) {
    clearInterval(progressInterval);
    await ctx.replyWithMarkdown(
      `❌ *Ошибка при создании отчета*\n` +
      `🔧 ${error.message}\n` +
      `⚠️ Пожалуйста, попробуйте снова или обратитесь в поддержку`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Повторить', callback_data: `report_${geo}` }],
            [{ text: '📞 Поддержка', callback_data: 'contact_support' }]
          ]
        }
      }
    );
  }
}
      

// Cancel operation handler - immediately stops any ongoing operation
bot.action(/cancel_(.+)/, async (ctx) => {
  const userID = ctx.match[1].split('_')[0];
  if (ctx.from.id.toString() === userID) {
    // Immediately stop any ongoing processing
    process.emit('SIGINT');
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
    text: `${geo === 'DEU' ? '🇩🇪' : geo === 'ESP' ? '🇪🇸' : geo === 'PRT' ? '🇵🇹' : geo === 'POL' ? '🇵🇱' : geo === 'SWE' ? '🇸🇪' : geo === 'FRA' ? '🇫🇷' : geo === 'ITA' ? '🇮🇹' : '🇨🇿'} Отчет для ${GEO_CONFIG[geo].name}`, 
    callback_data: `report_${geo}` 
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
    text: `${geo === 'DEU' ? '🇩🇪' : geo === 'ESP' ? '🇪🇸' : geo === 'PRT' ? '🇵🇹' : geo === 'POL' ? '🇵🇱' : geo === 'SWE' ? '🇸🇪' : geo === 'FRA' ? '🇫🇷' : geo === 'ITA' ? '🇮🇹' : '🇨🇿'} Графики для ${GEO_CONFIG[geo].name}`, 
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
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
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
