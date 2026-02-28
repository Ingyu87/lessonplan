const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function test() {
    const apiKey = process.env.GEMINI_API_KEY;
    console.log('Using API Key:', apiKey.substring(0, 10) + '...');
    const genAI = new GoogleGenerativeAI(apiKey);

    // Try a very common model first as a baseline
    console.log('Testing gemini-1.5-flash...');
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent("Hello, say 'Test OK'");
        console.log('gemini-1.5-flash Response:', result.response.text());
    } catch (e) {
        console.error('gemini-1.5-flash Failed:', e.message);
        if (e.response) console.error('Details:', JSON.stringify(e.response, null, 2));
    }

    console.log('\nTesting gemini-2.0-flash-exp...');
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        const result = await model.generateContent("Hello, say 'Test OK'");
        console.log('gemini-2.0-flash-exp Response:', result.response.text());
    } catch (e) {
        console.error('gemini-2.0-flash-exp Failed:', e.message);
    }
}
test();
