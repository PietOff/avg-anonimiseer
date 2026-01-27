const Detector = require('./detector.js');

console.log('--- TESTING SEARCH FUNCTION ---');

const text = "Dit is een test document over Leeuwarden en de gemeente Leeuwarden.";
const searchTerm = "Leeuwarden";

console.log(`Text: "${text}"`);
console.log(`Searching for: "${searchTerm}"`);

if (Detector.detectCustom) {
    const results = Detector.detectCustom(text, searchTerm);
    console.log(`Found ${results.length} matches.`);

    results.forEach((match, i) => {
        console.log(`${i + 1}. [${match.name}] "${match.value}" at index ${match.startIndex}`);
    });

    if (results.length === 2 && results[0].value === "Leeuwarden" && results[1].value === "Leeuwarden") {
        console.log('✅ Search test passed');
    } else {
        console.log('❌ Search test failed');
        process.exit(1);
    }
} else {
    console.error('❌ detectCustom method missing in Detector');
    process.exit(1);
}
