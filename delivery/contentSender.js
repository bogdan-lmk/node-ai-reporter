const fs = require('fs');
const path = require('path');

module.exports = async function sendContent(ctx, type, geo, content, pathConfig, generateCharts) {
  try {
    if (type === 'report' || type === 'new_report' || type === 'full') {
      // For reports, use provided content or load from file
      if (!content) {
        const reportPath = path.join(pathConfig.reports, `report_${geo}.txt`);
        if (fs.existsSync(reportPath)) {
          content = fs.readFileSync(reportPath, 'utf8');
        }
      }
      await ctx.reply(content, { disable_web_page_preview: true });
    }
    
    if (type === 'charts' || type === 'new_charts' || type === 'full') {
      // For charts, use existing files (don't regenerate unless new_charts)
      if (type === 'new_charts') {
        await generateCharts(geo, pathConfig);
      }
      
      const chartTypes = ['sentiment', 'themes', 'needs', 'trends'];
      for (const chartType of chartTypes) {
        const chartPath = path.join(pathConfig.charts, `${chartType}_${geo}.png`);
        if (fs.existsSync(chartPath)) {
          try {
            await ctx.replyWithPhoto({ source: fs.createReadStream(chartPath) }, {
              caption: `${chartType} chart for ${geo}`
            });
          } catch (photoError) {
            console.error(`Error sending ${chartType} chart:`, photoError);
            await ctx.reply(`Failed to send ${chartType} chart. ${photoError.message}`);
          }
        } else {
          console.error(`Chart file missing: ${chartPath}`);
          await ctx.reply(`⚠️ Could not find ${chartType} chart for ${geo}`);
        }
      }
    }
  } catch (error) {
    console.error('Error sending content:', error);
    await ctx.reply(`❌ Error sending content: ${error.message}`);
    throw error;
  }
};
