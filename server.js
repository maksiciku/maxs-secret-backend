const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
const frontendURL = process.env.FRONTEND_URL || 'https://maxs-secret-frontend.vercel.app';
app.use(cors({ origin: frontendURL, credentials: true }));
app.use(express.json());

// Create HTTP server and WebSocket server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Global variables for caching and predictions
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
            console.error(`Error fetching market data: ${error.message}`);
            throw new Error('Failed to fetch market data');
        }
    }
    return cachedData;
}

// Helper: Calculate Moving Average
function calculateMovingAverage(data, days) {
    if (data.length < days) return 0;
    const recentData = data.slice(-days);
    const sum = recentData.reduce((acc, value) => acc + value, 0);
    return sum / days;
}

// Helper: Calculate Change Percentage
function calculateChangePercentage(newVal, oldVal) {
    if (oldVal === null) return 0;
    return ((newVal - oldVal) / oldVal) * 100;
}

// WebSocket: Real-Time Data and Notifications
wss.on('connection', (ws) => {
    console.log('WebSocket client connected');

    ws.on('message', (message) => {
        console.log('Received message from client:', message);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error.message);
    });

    ws.on('close', () => {
        console.log('WebSocket client disconnected');
    });

    const sendUpdates = async () => {
        try {
            const data = await fetchMarketData();
            ws.send(JSON.stringify({ marketData: data }));

            const portfolioValue = Object.values(data).reduce((acc, crypto) => acc + (crypto.usd || 0), 0);
            const changePercentage = calculateChangePercentage(portfolioValue, previousPortfolioValue);

            if (Math.abs(changePercentage) >= 5) {
                ws.send(JSON.stringify({
                    notification: `Portfolio value changed by ${changePercentage.toFixed(2)}% to $${portfolioValue.toFixed(2)}.`,
                }));
            }

            previousPortfolioValue = portfolioValue;
        } catch (error) {
            console.error('Error sending WebSocket updates:', error.message);
        }
    };

    const interval = setInterval(sendUpdates, 30000); // Send updates every 30 seconds

    ws.on('close', () => {
        clearInterval(interval);
    });
});

// REST API: Fetch Market Data
app.get('/api/market-data', async (req, res) => {
    try {
        const symbol = req.query.symbol || 'bitcoin';
        const response = await axios.get(
            `https://api.coingecko.com/api/v3/simple/price?ids=${symbol}&vs_currencies=usd`
        );
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching market data:', error.message);
        if (error.response && error.response.status === 429) {
            res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
        } else {
            res.status(500).json({ error: 'Error fetching market data' });
        }
    }
});

// REST API: Generate Predictions
app.get('/api/predict', async (req, res) => {
    const symbol = req.query.symbol || 'bitcoin';

    try {
        const response = await axios.get(
            `https://api.coingecko.com/api/v3/coins/${symbol.toLowerCase()}/market_chart`,
            { params: { vs_currency: 'usd', days: 10 } }
        );

        const priceData = response.data.prices;
        const prices = priceData.map((item) => item[1]);
        const shortTermMA = calculateMovingAverage(prices, 5);
        const longTermMA = calculateMovingAverage(prices, 10);

        let prediction = 'Hold';
        if (shortTermMA > longTermMA) prediction = 'Buy';
        else if (shortTermMA < longTermMA) prediction = 'Sell';

        const rationale = `Short-term MA (5-day): ${shortTermMA.toFixed(2)}, Long-term MA (10-day): ${longTermMA.toFixed(2)}.`;

        const newPrediction = {
            id: predictionHistory.length + 1,
            symbol: symbol.toUpperCase(),
            prediction,
            rationale,
            shortTermMA,
            longTermMA,
            timestamp: new Date(),
        };

        predictionHistory.push(newPrediction);

        res.json(newPrediction);
    } catch (error) {
        res.status(500).json({ error: 'Error generating prediction', details: error.message });
    }
});

// Portfolio Tracker
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
        res.status(500).json({ error: 'Error fetching portfolio data' });
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
