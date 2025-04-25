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
          connectionRetries: 5,
          timeout: 10000, // 10 second timeout
          retryDelay: 2000, // 2 seconds between retries
          autoReconnect: true,
          useWSS: true // Use WebSocket for better connection stability
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
      throw error;
    }
};
