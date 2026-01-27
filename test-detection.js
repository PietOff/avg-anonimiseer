const fs = require('fs');
const { PDFParse } = require('pdf-parse');
const Detector = require('./detector.js');

const filePath = '/Users/pieteroffereins/Downloads/16546-163704_VO_Reijndersbuurt_Leeuwarden.pdf';

console.log(`Reading file: ${filePath}`);

if (!fs.existsSync(filePath)) {
    console.error('File not found!');
    process.exit(1);
}

const dataBuffer = fs.readFileSync(filePath);

async function run() {
    try {
        console.log('Parsing PDF...');
        const parser = new PDFParse({ data: dataBuffer });
        const data = await parser.getText();

        console.log(`Text length: ${data.text.length} chars.`);

        // Run detection
        console.log('Running detection...');
        const results = Detector.detect(data.text);

        console.log('\n--- DETECTION RESULTS ---');
        console.log(`Total detections: ${results.stats.total}`);

        if (results.all.length === 0) {
            console.log('No personal data found.');
        } else {
            results.all.forEach((item, index) => {
                console.log(`${index + 1}. [${item.name}] (${item.type}): "${item.value}"`);
            });
        }

        console.log('\n--- CATEGORY BREAKDOWN ---');
        Object.entries(results.byCategory).forEach(([key, cat]) => {
            console.log(`${cat.name}: ${cat.items.length} items`);
        });

        // Cleanup if needed
        if (parser.destroy) {
            await parser.destroy();
        }

    } catch (err) {
        console.error('Error processing PDF:', err);
    }
}

run();
