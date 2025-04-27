const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const dotenv = require('dotenv');

dotenv.config();

module.exports = async function initTelegramClient() {
    try {
      console.log('Инициализация Telegram клиента...');
      
      // Check for existing session string
      const sessionString = process.env.STRING_SESSION || '';
      const stringSession = new StringSession(sessionString);
      
      const client = new TelegramClient(
        stringSession,
        parseInt(process.env.API_ID),
        process.env.API_HASH,
        {
          connectionRetries: 10,
          timeout: 30000, // 30 second timeout
          retryDelay: 5000, // 5 seconds between retries
          autoReconnect: true,
          useWSS: true,
          maxConcurrentDownloads: 1, // Reduce connection load
          floodSleepLimit: 60 // Increase flood wait limit
        }
      );
      
      if (!stringSession.save()) {
        // No existing session - need to authenticate
        await client.start({
          phoneNumber: async () => process.env.PHONE_NUMBER || await input.text('Введите номер телефона: '),
          password: async () => process.env.PASSWORD || await input.text('Введите пароль (если есть): '),
          phoneCode: async () => await input.text('Введите код подтверждения: '),
          onError: (err) => console.log('Ошибка при авторизации:', err),
        });
        
        // Save new session string
        console.log('Сохраняем строку сессии. В следующий раз используйте эту строку в переменной окружения STRING_SESSION');
        console.log(stringSession.save());
      }
      
      console.log('Telegram клиент успешно инициализирован');
      return client;
    } catch (error) {
      console.error('Ошибка при инициализации Telegram клиента:', error);
      // Implement exponential backoff before retrying
      await new Promise(resolve => setTimeout(resolve, 5000));
      return initTelegramClient(); // Retry initialization
    }
};
