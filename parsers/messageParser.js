const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { createObjectCsvWriter } = require('csv-writer');
const path = require('path');
const GEO_CONFIG = require('../config/geoConfig');
const fs = require('fs');

async function withRetry(fn, maxRetries = 3, delay = 2000) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < maxRetries - 1) {
        console.log(`Retry ${i + 1}/${maxRetries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

module.exports = async function parseMessages(geo, config, pathConfig, telegramClient) {
    console.log(`Starting message parsing for ${geo}`);
    try {
      const groups = config[geo].chat_ids;
      let allMessages = [];
  
      for (const group of groups) {
        console.log(`Parsing messages from group: ${group}`);
        
        // Convert group ID to proper channel format
        const channelId = group.toString().startsWith('-100') ? 
          group : 
          `-100${Math.abs(group)}`;
        
        let inputEntity;
        try {
          // Get input entity with retry
          inputEntity = await withRetry(async () => {
            if (!telegramClient.connected) {
              await telegramClient.connect();
            }
            return await telegramClient.getInputEntity(channelId);
          });
        } catch (error) {
          if (error.message.includes('CHANNEL_INVALID') || 
              error.message.includes('Could not find the input entity')) {
            console.warn(`Skipping group ${group} - channel access invalid (you may have been removed)`);
            continue; // Skip to next group
          }
          throw error; // Re-throw other errors
        }
        
        // Get messages with retry
        const messages = await withRetry(async () => {
          if (!telegramClient.connected) {
            await telegramClient.connect();
          }
          return await telegramClient.getMessages(inputEntity, { 
            limit: 100,
            timeout: 10000 // 10 second timeout
          });
        });
        
        for (const message of messages) {
          if (message.message) { // В новом API текст сообщения доступен через message.message
            allMessages.push({
              id: message.id,
              date: new Date(message.date * 1000).toISOString(), // конвертируем Unix timestamp в ISO
              text: message.message,
              group: group,
              geo: geo
            });
          }
        }
      }
  
      if (allMessages.length === 0) {
        console.log('No messages found to save');
        return;
      }

      const csvPath = path.join(pathConfig.raw, `messages_${geo}.csv`);
      const csvWriter = createObjectCsvWriter({
        path: csvPath,
        header: [
          {id: 'id', title: 'ID'},
          {id: 'date', title: 'Date'},
          {id: 'text', title: 'Text'},
          {id: 'group', title: 'Group'},
          {id: 'geo', title: 'Geo'}
        ]
      });

      await csvWriter.writeRecords(allMessages);
      console.log(`Successfully saved ${allMessages.length} messages to ${csvPath}`);
    } catch (error) {
      console.error(`Error parsing messages for ${geo}:`, error);
      throw error;
    }
};
