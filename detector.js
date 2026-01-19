/**
 * AVG Anonimiseer - Detector Module
 * Automatically detects personal data in text content
 */

const Detector = {
    // Detection patterns for Dutch personal data
    patterns: {
        // BSN (Burgerservicenummer) - 9 digits with 11-proof
        bsn: {
            name: 'BSN',
            icon: '🆔',
            regex: /\b[0-9]{9}\b/g,
            validate: (match) => Detector.validateBSN(match)
        },

        // IBAN - Dutch bank accounts
        iban: {
            name: 'IBAN',
            icon: '🏦',
            regex: /\b[A-Z]{2}[0-9]{2}[A-Z]{4}[0-9]{10}\b/gi,
            validate: () => true
        },

        // Email addresses
        email: {
            name: 'E-mail',
            icon: '📧',
            regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
            validate: () => true
        },

        // Dutch phone numbers
        phone: {
            name: 'Telefoon',
            icon: '📞',
            regex: /\b(?:\+31|0031|0)[\s.-]?(?:[0-9][\s.-]?){9}\b/g,
            validate: () => true
        },

        // Dutch postal codes
        postcode: {
            name: 'Postcode',
            icon: '📍',
            regex: /\b[1-9][0-9]{3}\s?[A-Za-z]{2}\b/g,
            validate: () => true
        },

        // Dates (potential birth dates)
        date: {
            name: 'Datum',
            icon: '📅',
            regex: /\b(?:0?[1-9]|[12][0-9]|3[01])[-\/.](?:0?[1-9]|1[012])[-\/.](?:19|20)?[0-9]{2}\b/g,
            validate: () => true
        },

        // License plates (Dutch)
        kenteken: {
            name: 'Kenteken',
            icon: '🚗',
            regex: /\b[A-Z0-9]{2,3}[-\s]?[A-Z0-9]{2,3}[-\s]?[A-Z0-9]{1,2}\b/g,
            validate: (match) => Detector.validateKenteken(match)
        },

        // IP addresses
        ip: {
            name: 'IP-adres',
            icon: '🌐',
            regex: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
            validate: () => true
        },

        // Passport/ID numbers
        documentnr: {
            name: 'Document Nr',
            icon: '📄',
            regex: /\b[A-Z]{2}[A-Z0-9]{7}\b/g,
            validate: () => true
        },

        // Initials/Paraphs (parafen)
        initialen: {
            name: 'Initialen/Paraaf',
            icon: '✍️',
            regex: /\b[A-Z]\.?[A-Z]\.?(?:[A-Z]\.?)?\b/g,
            validate: (match) => {
                // Filter out common abbreviations
                const common = ['NL', 'EU', 'VS', 'VK', 'BV', 'NV', 'CV', 'TV', 'PC', 'ID', 'OK', 'OF', 'EN', 'TE', 'IN', 'OP', 'MR', 'DR', 'IR', 'BC', 'MA', 'BA'];
                const cleaned = match.replace(/\./g, '').toUpperCase();
                return !common.includes(cleaned) && cleaned.length >= 2 && cleaned.length <= 4;
            }
        }
    },

    // Name patterns (harder to detect reliably)
    namePatterns: {
        // Common Dutch name prefixes that might indicate a name follows
        prefixes: ['de heer', 'mevrouw', 'mevr.', 'dhr.', 'mr.', 'dr.', 'ir.', 'prof.', 'ing.'],
        // Pattern for capitalized words (potential names)
        capitalizedWords: /\b[A-Z][a-zàáâãäåæçèéêëìíîïñòóôõöùúûüý]+(?:\s+(?:van|de|der|den|het|ten|ter|te)\s+)?[A-Z][a-zàáâãäåæçèéêëìíîïñòóôõöùúûüý]+\b/g
    },

    /**
     * Validate BSN using the 11-proof algorithm
     */
    validateBSN(bsn) {
        if (!/^[0-9]{9}$/.test(bsn)) return false;

        const digits = bsn.split('').map(Number);
        let sum = 0;

        for (let i = 0; i < 8; i++) {
            sum += digits[i] * (9 - i);
        }
        sum -= digits[8]; // Last digit is subtracted

        return sum % 11 === 0;
    },

    /**
     * Validate Dutch license plates (basic check)
     */
    validateKenteken(kenteken) {
        const cleaned = kenteken.replace(/[-\s]/g, '').toUpperCase();
        // Must have mix of letters and numbers
        const hasLetters = /[A-Z]/.test(cleaned);
        const hasNumbers = /[0-9]/.test(cleaned);
        return hasLetters && hasNumbers && cleaned.length >= 5 && cleaned.length <= 8;
    },

    /**
     * Detect all personal data in text
     * @param {string} text - The text to scan
     * @param {number} pageNumber - Optional page number for reference
     * @returns {Object} Categorized detections
     */
    detect(text, pageNumber = 1) {
        const results = {
            byCategory: {},
            all: [],
            stats: {
                total: 0,
                categories: 0
            }
        };

        // Scan for each pattern type
        for (const [type, pattern] of Object.entries(this.patterns)) {
            const matches = [];
            let match;

            // Reset regex lastIndex
            pattern.regex.lastIndex = 0;

            while ((match = pattern.regex.exec(text)) !== null) {
                const value = match[0];

                // Validate if validation function exists
                if (pattern.validate(value)) {
                    // Find position in text
                    const startIndex = match.index;
                    const endIndex = startIndex + value.length;

                    // Avoid duplicates
                    const isDuplicate = matches.some(m => m.value === value);
                    if (!isDuplicate) {
                        const detection = {
                            type,
                            name: pattern.name,
                            icon: pattern.icon,
                            value,
                            page: pageNumber,
                            startIndex,
                            endIndex,
                            selected: true // Pre-select for redaction
                        };
                        matches.push(detection);
                        results.all.push(detection);
                    }
                }
            }

            if (matches.length > 0) {
                results.byCategory[type] = {
                    name: pattern.name,
                    icon: pattern.icon,
                    items: matches
                };
                results.stats.categories++;
            }
        }

        // Detect potential names (with lower confidence)
        const potentialNames = this.detectNames(text, pageNumber);
        if (potentialNames.length > 0) {
            results.byCategory['names'] = {
                name: 'Mogelijke Namen',
                icon: '👤',
                items: potentialNames.map(n => ({ ...n, selected: false })) // Don't pre-select names
            };
            results.all.push(...potentialNames);
            results.stats.categories++;
        }

        results.stats.total = results.all.length;
        return results;
    },

    /**
     * Detect potential names in text
     */
    detectNames(text, pageNumber = 1) {
        const names = [];
        const seen = new Set();

        // Find names after known prefixes
        for (const prefix of this.namePatterns.prefixes) {
            const regex = new RegExp(
                prefix.replace('.', '\\.') + '\\s+([A-Z][a-zàáâãäåæçèéêëìíîïñòóôõöùúûüý]+(?:\\s+(?:van|de|der|den|het|ten|ter|te)\\s+)?[A-Z][a-zàáâãäåæçèéêëìíîïñòóôõöùúûüý]+)',
                'gi'
            );

            let match;
            while ((match = regex.exec(text)) !== null) {
                const fullName = match[1];
                if (!seen.has(fullName.toLowerCase())) {
                    seen.add(fullName.toLowerCase());
                    names.push({
                        type: 'name',
                        name: 'Naam',
                        icon: '👤',
                        value: fullName,
                        page: pageNumber,
                        startIndex: match.index,
                        endIndex: match.index + match[0].length,
                        confidence: 'high'
                    });
                }
            }
        }

        return names;
    },

    /**
     * Get summary of detection types
     */
    getCategories() {
        return Object.entries(this.patterns).map(([key, pattern]) => ({
            key,
            name: pattern.name,
            icon: pattern.icon
        }));
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Detector;
}
