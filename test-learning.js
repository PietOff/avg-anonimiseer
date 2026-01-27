const Detector = require('./detector.js');

console.log('--- TESTING LEARNING FUNCTION ---');

// Mock localStorage for Node environment
if (typeof localStorage === 'undefined') {
    global.localStorage = {
        store: {},
        getItem: function (key) { return this.store[key] || null; },
        setItem: function (key, value) { this.store[key] = value.toString(); },
        removeItem: function (key) { delete this.store[key]; },
        clear: function () { this.store = {}; }
    };
}

// 1. Initial State
console.log('\n[1] Initial State');
Detector.clearLearnedData(); // Reset
const text = "Dit is een test met het woord Humbug en een naam Jan Jansen.";
let results = Detector.detect(text);
const humbugFound = results.all.some(x => x.value === 'Humbug');
console.log(`"Humbug" initially found? ${humbugFound}`); // Should be false

// 2. Learning a word
console.log('\n[2] Learning "Humbug"');
Detector.learnWord('Humbug');
results = Detector.detect(text);
const humbugLearned = results.all.some(x => x.value === 'Humbug' && x.type === 'learned');
console.log(`"Humbug" found after learning? ${humbugLearned}`);

// 3. Ignoring a word
console.log('\n[3] Ignoring "Jan Jansen" (simulated false positive)');
// First check it IS found
const janFound = results.all.some(x => x.value === 'Jan Jansen');
console.log(`"Jan Jansen" initially found? ${janFound}`);

Detector.ignoreWord('Jan Jansen');
results = Detector.detect(text);
const janIgnored = results.all.some(x => x.value === 'Jan Jansen');
console.log(`"Jan Jansen" found after ignoring? ${janIgnored}`);

// 4. Persistence Check
console.log('\n[4] Persistence Check');
const stored = localStorage.getItem('avg_anonimiseer_learning_data');
console.log(`Storage content: ${stored}`);
const parsed = JSON.parse(stored);
console.log(`Stored learned: ${parsed.learned.includes('humbug')}`);
console.log(`Stored ignored: ${parsed.ignored.includes('jan jansen')}`);

if (humbugLearned && !janIgnored && parsed.learned.includes('humbug')) {
    console.log('\n✅ LEARNING FUNCTION WORKS CORRECTLY');
} else {
    console.log('\n❌ LEARNING FUNCTION FAILED');
    process.exit(1);
}
