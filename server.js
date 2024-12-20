const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Create HTTP server and WebSocket server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Global variables for caching
let cachedData = null;
let lastFetched = 0;
let previousPortfolioValue = null;
let predictionHistory = [];

// Helper: Fetch Market Data
async function fetchMarketData() {
    const now = Date.now();
    if (!cachedData || now - lastFetched > 60000) {
        const trackedSymbols = ['bitcoin', 'ethereum', 'dogecoin', 'litecoin'];
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${trackedSymbols.join(',')}&vs_currencies=usd`;

        try {
            const response = await axios.get(url);
            cachedData = response.data;
            lastFetched = now;
        } catch (error) {
            throw new Error(`Failed to fetch market data: ${error.message}`);
        }
    }
    return cachedData;
}

// Helper: Calculate Change Percentage
function calculateChangePercentage(newVal, oldVal) {
    if (oldVal === null) return 0;
    return ((newVal - oldVal) / oldVal) * 100;
}

// WebSocket: Real-Time Data and Notifications
wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket');

    ws.on('message', (message) => {
        console.log('Received:', message);
    });

    ws.send(JSON.stringify({ message: 'Welcome to WebSocket server!' }));

    const sendUpdates = async () => {
        try {
            const data = await fetchMarketData();

            // Send real-time market data
            ws.send(JSON.stringify({ marketData: data }));

            // Calculate and send notifications for significant portfolio changes
            const portfolioValue = Object.values(data).reduce((acc, crypto) => acc + (crypto.usd || 0), 0);
            const changePercentage = calculateChangePercentage(portfolioValue, previousPortfolioValue);

            if (Math.abs(changePercentage) >= 5) {
                ws.send(
                    JSON.stringify({
                        notification: `Portfolio value changed by ${changePercentage.toFixed(2)}% to $${portfolioValue.toFixed(2)}.`,
                    })
                );
            }

            previousPortfolioValue = portfolioValue;
        } catch (error) {
            console.error('WebSocket error:', error.message);
        }
    };

    const interval = setInterval(sendUpdates, 10000); // Updates every 10 seconds

    ws.on('close', () => {
        console.log('Client disconnected');
        clearInterval(interval);
    });
});

// REST API: Fetch Market Data
async function fetchMarketData() {
    const now = Date.now();
    // Cache data for 5 minutes instead of 1 minute
    if (!cachedData || now - lastFetched > 300000) {
        const trackedSymbols = ['bitcoin', 'ethereum', 'dogecoin', 'litecoin'];
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${trackedSymbols.join(',')}&vs_currencies=usd`;

        try {
            const response = await axios.get(url);
            cachedData = response.data;
            lastFetched = now;
        } catch (error) {
            throw new Error(`Failed to fetch market data: ${error.message}`);
        }
    }
    return cachedData;
}

// REST API: Generate Predictions
app.get('/api/predict', async (req, res) => {
    const symbol = req.query.symbol || 'bitcoin';

    try {
        const response = await axios.get(
            `https://api.coingecko.com/api/v3/coins/${symbol.toLowerCase()}/market_chart`,
            { params: { vs_currency: 'usd', days: 10 } }
        );

        const priceData = response.data.prices; // [timestamp, price]
        const prices = priceData.map((item) => item[1]); // Extract prices
        const timestamps = priceData.map((item) => new Date(item[0]).toLocaleDateString()); // Convert timestamps

        const shortTermMA = calculateMovingAverage(prices, 5);
        const longTermMA = calculateMovingAverage(prices, 10);

        let prediction = 'Hold';
        if (shortTermMA > longTermMA) prediction = 'Buy';
        else if (shortTermMA < longTermMA) prediction = 'Sell';

        const rationale = `Short-term MA (5-day): ${shortTermMA.toFixed(
            2
        )}, Long-term MA (10-day): ${longTermMA.toFixed(
            2
        )}. Prediction is based on moving averages.`;

        const newPrediction = {
            id: predictionHistory.length + 1,
            symbol: symbol.toUpperCase(),
            prediction,
            rationale,
            shortTermMA,
            longTermMA,
            prices,
            timestamps,
            actual: null,
            timestamp: new Date(),
        };

        predictionHistory.push(newPrediction);

        res.json(newPrediction);
    } catch (error) {
        console.error('Error generating prediction:', error.message);
        res.status(500).json({ error: 'Error generating prediction', details: error.message });
    }
});

// Helper: Calculate Moving Average
function calculateMovingAverage(data, days) {
    if (data.length < days) return 0;
    const recentData = data.slice(-days);
    const sum = recentData.reduce((acc, value) => acc + value, 0);
    return sum / days;
}

// REST API: Update Prediction Outcomes
app.post('/api/actual', (req, res) => {
    const { id, actual } = req.body;
    const prediction = predictionHistory.find((p) => p.id === Number(id));
    if (prediction) {
        prediction.actual = actual;
        res.json({ message: 'Prediction updated successfully!', prediction });
    } else {
        res.status(404).json({ message: 'Prediction not found.' });
    }
});

// REST API: Calculate Accuracy
app.get('/api/accuracy', (req, res) => {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const recentPredictions = predictionHistory.filter(
        (p) => new Date(p.timestamp) > oneWeekAgo && p.actual
    );
    const correctPredictions = recentPredictions.filter((p) => p.prediction === p.actual).length;
    const totalPredictions = recentPredictions.length;

    const accuracy = totalPredictions
        ? ((correctPredictions / totalPredictions) * 100).toFixed(2)
        : 0;

    res.json({
        weeklyAccuracy: { accuracy: `${accuracy}%`, total: totalPredictions, correct: correctPredictions },
        historicalData: predictionHistory,
    });
});

// REST API: Portfolio Tracker
app.get('/api/portfolio', async (req, res) => {
    try {
        const symbols = req.query.symbols ? req.query.symbols.split(',') : ['bitcoin'];
        const response = await axios.get(
            `https://api.coingecko.com/api/v3/simple/price?ids=${symbols.join(',')}&vs_currencies=usd`
        );

        const data = response.data;
        const portfolioValue = symbols.reduce((acc, symbol) => acc + (data[symbol]?.usd || 0), 0);

        res.json({ data, portfolioValue });
    } catch (error) {
        console.error('Error fetching portfolio data:', error.message);
        res.status(500).send('Error fetching portfolio data');
    }
});

// Root Endpoint
app.get('/', (req, res) => {
    res.send('Server is running!');
});

// Start Server
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
