const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
const { Chart } = require('chart.js');


module.exports = async function generateCharts(geo, pathConfig) {
    console.log(`Generating charts for ${geo}`);
    try {
        // Register required Chart.js controllers
        const { PieController, BarController, LineController } = require('chart.js');
        Chart.register(PieController, BarController, LineController);

        // Ensure analysis data exists
        const analysisPath = path.join(pathConfig.analyzed, `analysis_${geo}.json`);
        if (!fs.existsSync(analysisPath)) {
            throw new Error(`No analysis data found for ${geo}. Please run analysis first.`);
        }

        // Ensure charts directory exists
        if (!fs.existsSync(pathConfig.charts)) {
            fs.mkdirSync(pathConfig.charts, { recursive: true });
        }

        const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
        const charts = {};

        // 1. Sentiment chart
        const sentimentCanvas = createCanvas(800, 400);
        const sentimentCtx = sentimentCanvas.getContext('2d');
        new Chart(sentimentCtx, {
            type: 'pie',
            data: {
                labels: ['Позитивные', 'Негативные', 'Нейтральные'],
                datasets: [{
                    data: [
                        analysis.sentiments.positive, 
                        analysis.sentiments.negative, 
                        analysis.sentiments.neutral
                    ],
                    backgroundColor: ['#4CAF50', '#F44336', '#9E9E9E']
                }]
            }
        });
        const sentimentChartPath = path.join(pathConfig.charts, `sentiment_${geo}.png`);
        fs.writeFileSync(sentimentChartPath, sentimentCanvas.toBuffer());
        charts.sentiment = sentimentChartPath;

        // 2. Theme distribution chart
        const themeCanvas = createCanvas(800, 400);
        const themeCtx = themeCanvas.getContext('2d');
        new Chart(themeCtx, {
            type: 'bar',
            data: {
                labels: Object.keys(analysis.themeCount),
                datasets: [{
                    label: 'Темы',
                    data: Object.values(analysis.themeCount),
                    backgroundColor: '#2196F3'
                }]
            }
        });
        const themeChartPath = path.join(pathConfig.charts, `themes_${geo}.png`);
        fs.writeFileSync(themeChartPath, themeCanvas.toBuffer());
        charts.themes = themeChartPath;

        // 3. Needs and pains chart
        const needsCanvas = createCanvas(800, 400);
        const needsCtx = needsCanvas.getContext('2d');
        new Chart(needsCtx, {
            type: 'bar',
            data: {
                labels: Object.keys(analysis.needsCount),
                datasets: [{
                    label: 'Потребности и проблемы',
                    data: Object.values(analysis.needsCount),
                    backgroundColor: '#FF9800'
                }]
            }
        });
        const needsChartPath = path.join(pathConfig.charts, `needs_${geo}.png`);
        fs.writeFileSync(needsChartPath, needsCanvas.toBuffer());
        charts.needs = needsChartPath;

        // 4. Weekly trends chart
        const weeksLabels = Object.keys(analysis.weeklyTrends).sort();
        const weeklyData = weeksLabels.map(week => analysis.weeklyTrends[week].total);
        
        const trendsCanvas = createCanvas(800, 400);
        const trendsCtx = trendsCanvas.getContext('2d');
        new Chart(trendsCtx, {
            type: 'line',
            data: {
                labels: weeksLabels,
                datasets: [{
                    label: 'Сообщения по неделям',
                    data: weeklyData,
                    borderColor: '#673AB7',
                    fill: false
                }]
            }
        });
        const trendsChartPath = path.join(pathConfig.charts, `trends_${geo}.png`);
        fs.writeFileSync(trendsChartPath, trendsCanvas.toBuffer());
        charts.trends = trendsChartPath;

        console.log(`Charts for ${geo} generated successfully`);
        return charts;
    } catch (error) {
        console.error(`Error generating charts for ${geo}:`, error);
        throw error;
    }
};
