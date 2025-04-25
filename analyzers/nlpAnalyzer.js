const natural = require('natural');
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
const { Chart } = require('chart.js');

module.exports = async function analyzeMessages(geo, pathConfig, themes, needsAndPains) {
    console.log(`Starting NLP analysis for ${geo}`);
    try {
        const csvFilePath = path.join(pathConfig.raw, `messages_${geo}.csv`);
        if (!fs.existsSync(csvFilePath)) {
            throw new Error(`No data found for ${geo}`);
        }

        // Read messages from CSV
        const data = fs.readFileSync(csvFilePath, 'utf8');
        const lines = data.split('\n').slice(1); // Skip header
        const messages = lines.filter(line => line.trim()).map(line => {
            const parts = line.split(',');
            let date;
            try {
                date = new Date(parts[1]);
                if (isNaN(date.getTime())) {
                    date = new Date(); // Fallback to current date if invalid
                }
            } catch (e) {
                date = new Date(); // Fallback to current date if error
            }
            return {
                id: parts[0],
                date: date,
                text: parts.slice(2, -2).join(','), // Handle commas in text
                group: parts[parts.length - 2],
                geo: parts[parts.length - 1]
            };
        });

        // Sentiment analysis with language detection
        const lang = ['DEU','ESP','PRT'].includes(geo) ? 'English' : 
                    ['RUS'].includes(geo) ? 'Russian' : 'English';
        const analyzer = new natural.SentimentAnalyzer(lang, natural.PorterStemmer, 'afinn');
        const sentiments = {
            positive: 0,
            negative: 0,
            neutral: 0
        };

        // Theme analysis
        const themeCount = {};
        Object.keys(themes).forEach(theme => {
            themeCount[theme] = 0;
        });

        // Needs and pains analysis
        const needsCount = {};
        Object.keys(needsAndPains).forEach(need => {
            needsCount[need] = 0;
        });

        // Phrase frequency
        const tokenizer = new natural.WordTokenizer();
        const phrasesCount = {};

        // Process each message
        messages.forEach(message => {
            if (!message.text) return;
            
            // Sentiment analysis
            const sentiment = analyzer.getSentiment(tokenizer.tokenize(message.text));
            if (sentiment > 0.2) sentiments.positive++;
            else if (sentiment < -0.2) sentiments.negative++;
            else sentiments.neutral++;

            // Theme analysis
            Object.keys(themes).forEach(theme => {
                const keywords = themes[theme];
                if (keywords.some(keyword => message.text.toLowerCase().includes(keyword))) {
                    themeCount[theme]++;
                }
            });

            // Needs and pains analysis
            Object.keys(needsAndPains).forEach(need => {
                const phrases = needsAndPains[need];
                if (phrases.some(phrase => message.text.toLowerCase().includes(phrase))) {
                    needsCount[need]++;
                }
            });

            // Extract phrases (simplified approach)
            const words = tokenizer.tokenize(message.text.toLowerCase());
            for (let i = 0; i < words.length - 1; i++) {
                const phrase = `${words[i]} ${words[i + 1]}`;
                phrasesCount[phrase] = (phrasesCount[phrase] || 0) + 1;
            }
        });

        // Sort phrases by frequency
        const topPhrases = Object.entries(phrasesCount)
            .map(([phrase, count]) => ({ phrase, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 20);

        // Time trend analysis (by week)
        const weeklyTrends = {};
        messages.forEach(message => {
            const date = new Date(message.date);
            const weekStart = new Date(date.setDate(date.getDate() - date.getDay()));
            const weekKey = weekStart.toISOString().split('T')[0];
            
            weeklyTrends[weekKey] = weeklyTrends[weekKey] || {
                total: 0,
                themes: Object.keys(themes).reduce((acc, theme) => ({ ...acc, [theme]: 0 }), {})
            };
            
            weeklyTrends[weekKey].total++;
            
            Object.keys(themes).forEach(theme => {
                const keywords = themes[theme];
                if (keywords.some(keyword => message.text.toLowerCase().includes(keyword))) {
                    weeklyTrends[weekKey].themes[theme]++;
                }
            });
        });

        // Save analysis results
        const analysisResult = {
            messageCount: messages.length,
            sentiments,
            themeCount,
            needsCount,
            topPhrases,
            weeklyTrends
        };

        const analysisPath = path.join(pathConfig.analyzed, `analysis_${geo}.json`);
        fs.writeFileSync(analysisPath, JSON.stringify(analysisResult, null, 2));
        console.log(`NLP analysis for ${geo} completed and saved`);
        
        return analysisResult;
    } catch (error) {
        console.error(`Error in NLP analysis for ${geo}:`, error);
        throw error;
    }
};
