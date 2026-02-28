const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    try {
        const models = await genAI.getGenerativeModel({ model: "gemini-pro" }).listModels(); // This is not how listModels works in the latest SDK
        // Let me check the correct SDK usage for listModels
    } catch (e) {
        console.log(e);
    }
}
const fs = require('fs');
async function check() {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    fs.writeFileSync('models.json', JSON.stringify(data, null, 2));
    console.log('models.json created');
}
check();
