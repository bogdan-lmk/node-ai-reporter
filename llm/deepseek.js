const fs = require('fs');
const path = require('path');
const axios = require('axios');
const GEO_CONFIG = require('../config/geoConfig');

class DeepSeekLLM {
  constructor(path_config, provider = "deepseek", model = "deepseek-reasoner", max_tokens = 4000, active_geo = null) {
    this.path_config = path_config;
    this.provider = provider;
    this.model = model;
    this.max_tokens = max_tokens;
    this.active_geo = active_geo;
    this.api_key = process.env.DEEPSEEK_API_KEY;
  }

  async generate_report(geo, forceNew = false) {
    console.log(`Generating report for ${geo} using ${this.model}`);
    
    // Check cache first if not forcing new report
    if (!forceNew) {
      const cachedReport = await this.checkCache('report', geo);
      if (cachedReport) {
        console.log(`Using cached report for ${geo}`);
        return cachedReport;
      }
    }

    try {
      // Load analysis data
      const analysisPath = path.join(this.path_config.analyzed, `analysis_${geo}.json`);
      if (!fs.existsSync(analysisPath)) {
        throw new Error(`No analysis data found for ${geo}`);
      }

      const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
      
      // Load raw messages
      const csvFilePath = path.join(this.path_config.raw, `messages_${geo}.csv`);
      if (!fs.existsSync(csvFilePath)) {
        throw new Error(`No message data found for ${geo}`);
      }

      const data = fs.readFileSync(csvFilePath, 'utf8');
      const lines = data.split('\n').slice(1); // Skip header
      const messages = lines.filter(line => line.trim()).map(line => {
        const parts = line.split(',');
        return {
          id: parts[0],
          date: parts[1],
          text: parts.slice(2, -2).join(','), // Handle commas in text
          group: parts[parts.length - 2],
          geo: parts[parts.length - 1]
        };
      });

      // Prepare prompt for LLM
      const recentMessages = messages.length > 50 ? messages.slice(0, 50) : messages;
      const sentiment_stats = analysis.sentiments;
      const phrases_stats = analysis.topPhrases;
      
      const lang = ['DEU','ESP','PRT'].includes(geo) ? 'английском' : 
                  ['RUS'].includes(geo) ? 'русском' : 'украинском';
      
      const prompt = `
      Проанализируй сообщения из чатов на русском и украинском языке и создай аналитический отчет.
      Используй только ключевые данные и основные выводы, без излишней детализации.
      
      Контекст:
      - География: ${GEO_CONFIG[geo].name}
      - Всего сообщений: ${messages.length}
      - Период анализа: последние 7 дней
      
      Основные метрики:
      1. Эмоциональный фон:
         - Позитивных: ${sentiment_stats.positive} (${Math.round(sentiment_stats.positive/messages.length*100)}%)
         - Негативных: ${sentiment_stats.negative} (${Math.round(sentiment_stats.negative/messages.length*100)}%)
         - Нейтральных: ${sentiment_stats.neutral} (${Math.round(sentiment_stats.neutral/messages.length*100)}%)
      
      2. Топ-5 популярных фраз:
      ${phrases_stats.slice(0, 5).map(p => `- "${p.phrase}" (${p.count} раз)`).join('\n')}
      
      3. Распределение по темам:
      ${Object.entries(analysis.themeCount).map(([k,v]) => `- ${k}: ${v} сообщений`).join('\n')}
      
      Требования к отчету:
      1. Структура:
         - Среднее резюме (10-12 предложений)
         - Детальный анализ по темам
         - Эмоциональная картина
         - Проблемы и потребности
         - Рекомендации
      
      2. Особенности:
         - Учитывай языковые особенности ${lang} языка
         - Анализируй контекст фраз, а не только частоту
         - Выявляй скрытые проблемы
         - Предлагай практические решения
      
      3. Формат:
         - Четкая структура с заголовками
         - Без markdown разметки (##, **, ---)
         - Простой текстовый формат
         - Конкретные цифры и примеры
      
      Пример вывода:
      "Анализ чатов по Украине выявил...
      Основные темы: 1) Жилье (45%) 2) Документы (30%)...
      Наибольшие проблемы: языковой барьер, поиск жилья...
      Рекомендации: создать гайд по аренде, добавить чат-бота..."
      `;

      // Call DeepSeek API with retry logic
      const maxRetries = 3;
      let lastError = null;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await Promise.race([
            axios.post(
              'https://api.deepseek.com/v1/chat/completions',
              {
                model: this.model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: this.max_tokens,
                temperature: 0.7
              },
              {
                headers: {
                  'Authorization': `Bearer ${this.api_key}`,
                  'Content-Type': 'application/json'
                },
                timeout: 600000 // 10 minute timeout
              }
            ),
            new Promise((_, reject) => 
                  setTimeout(() => reject(new Error(`API timeout after 10 minutes (attempt ${attempt}/${maxRetries})`)), 600000)
            )
          ]);

          const report = response.data.choices[0].message.content;
          
          // Save report
          const reportPath = path.join(this.path_config.reports, `report_${geo}.txt`);
          fs.writeFileSync(reportPath, report);
          
          // Update cache
          this.updateCache('report', geo, report);
          
          console.log(`Report for ${geo} generated and saved`);
          return report;
        } catch (error) {
          lastError = error;
          console.error(`Attempt ${attempt} failed:`, error.message);
          if (attempt < maxRetries) {
            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
          }
        }
      }
      
      throw lastError || new Error('Failed after all retry attempts');
    } catch (error) {
      console.error(`Error generating report for ${geo}:`, error);
      throw error;
    }
  }

  async checkCache(type, geo) {
    try {
      const cacheTime = 3600000; // 1 hour in milliseconds
      const cacheFile = path.join(this.path_config.cache, `${type}_${geo}.json`);
      
      if (fs.existsSync(cacheFile)) {
        const stats = fs.statSync(cacheFile);
        const fileAge = Date.now() - stats.mtimeMs;
        
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

  updateCache(type, geo, content) {
    try {
      const cacheDir = this.path_config.cache;
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
}

module.exports = DeepSeekLLM;
