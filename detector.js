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

        // Dutch postal codes (stricter pattern to avoid matching dates like "2024 mei")
        postcode: {
            name: 'Postcode',
            icon: '📍',
            // Requires: 4 digits + space + 2 uppercase letters NOT followed by more letters
            regex: /\b[1-9][0-9]{3}\s?[A-Z]{2}(?![a-zA-Z])\b/g,
            validate: (match) => {
                // Additional validation: exclude patterns that look like years
                const digits = match.replace(/[^0-9]/g, '');
                const year = parseInt(digits);
                // If it looks like a year (1900-2100), reject it
                if (year >= 1900 && year <= 2100) {
                    return false;
                }
                return true;
            }
        },

        // Street addresses with house numbers (common in soil reports)
        address: {
            name: 'Adres',
            icon: '🏠',
            regex: /\b[A-Z][a-zàáâãäåæçèéêëìíîïñòóôõöùúûüý]+(?:straat|laan|weg|plein|singel|gracht|kade|dijk|hof|steeg|pad|dreef)\s+\d+[a-z]?(?:\s*[-\/]\s*\d+)?\b/gi,
            validate: () => true
        },

        // Cadastral numbers (kadastrale nummers - common in soil reports)
        kadastraal: {
            name: 'Kadastraal nr',
            icon: '📋',
            regex: /\b[A-Z]{3}\d{2}\s*[A-Z]\s*\d{4,5}\b/gi,
            validate: () => true
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

        // Detect names (but exclude public officials)
        const potentialNames = this.detectNames(text, pageNumber);
        if (potentialNames.length > 0) {
            results.byCategory['names'] = {
                name: 'Namen',
                icon: '👤',
                items: potentialNames.map(n => ({ ...n, selected: true })) // Pre-select names
            };
            results.all.push(...potentialNames);
            results.stats.categories++;
        }

        results.stats.total = results.all.length;
        return results;
    },

    /**
     * Detect potential names in text
     * Excludes public officials (burgemeester, wethouder, etc.)
     */
    detectNames(text, pageNumber = 1) {
        const names = [];
        const seen = new Set();

        // Public official titles to EXCLUDE from detection
        const publicOfficials = [
            'burgemeester', 'wethouder', 'gemeentesecretaris', 'griffier',
            'raadslid', 'raadsleden', 'minister', 'staatssecretaris',
            'commissaris', 'gedeputeerde', 'dijkgraaf', 'heemraad',
            'ombudsman', 'rechter', 'officier', 'notaris'
        ];

        // Job titles to exclude (these aren't personal names)
        const jobTitles = [
            'projectleider', 'trainee', 'stagiair', 'directeur', 'manager',
            'medewerker', 'adviseur', 'consultant', 'specialist', 'coordinator',
            'assistent', 'secretaris', 'voorzitter', 'penningmeester'
        ];

        // Common words that look like names but aren't
        const excludeWords = [
            'ervaring', 'opleiding', 'vaardigheden', 'profiel', 'samenvatting',
            'nederland', 'amsterdam', 'rotterdam', 'utrecht', 'eindhoven',
            'januari', 'februari', 'maart', 'april', 'juni', 'juli',
            'augustus', 'september', 'oktober', 'november', 'december'
        ];

        // Helper to check if a name should be excluded
        const shouldExclude = (name) => {
            const lower = name.toLowerCase();
            // Check against all exclusion lists
            for (const title of [...publicOfficials, ...jobTitles, ...excludeWords]) {
                if (lower.includes(title) || title.includes(lower)) {
                    return true;
                }
            }
            // Exclude single words that are likely section headers
            if (!name.includes(' ') && name.length < 15) {
                return true;
            }
            return false;
        };

        // Strategy 1: Find names after known prefixes (high confidence)
        for (const prefix of this.namePatterns.prefixes) {
            const regex = new RegExp(
                prefix.replace('.', '\\.') + '\\s+([A-Z][a-zàáâãäåæçèéêëìíîïñòóôõöùúûüý]+(?:\\s+(?:van|de|der|den|het|ten|ter|te)\\s+)?[A-Z][a-zàáâãäåæçèéêëìíîïñòóôõöùúûüý]+)',
                'gi'
            );

            let match;
            while ((match = regex.exec(text)) !== null) {
                const fullName = match[1];
                if (!seen.has(fullName.toLowerCase()) && !shouldExclude(fullName)) {
                    seen.add(fullName.toLowerCase());
                    names.push({
                        type: 'name',
                        name: 'Naam',
                        icon: '👤',
                        value: fullName,
                        page: pageNumber,
                        startIndex: match.index + prefix.length + 1,
                        endIndex: match.index + match[0].length,
                        confidence: 'high'
                    });
                }
            }
        }

        // Strategy 2: Find standalone full names (First Last or First van Last)
        // This catches names at the top of CVs, letters, etc.
        const fullNameRegex = /\b([A-Z][a-zàáâãäåæçèéêëìíîïñòóôõöùúûüý]+)\s+(?:(van|de|der|den|het|ten|ter|te)\s+)?([A-Z][a-zàáâãäåæçèéêëìíîïñòóôõöùúûüý]+(?:\s+[A-Z][a-zàáâãäåæçèéêëìíîïñòóôõöùúûüý]+)?)\b/g;

        let match;
        while ((match = fullNameRegex.exec(text)) !== null) {
            const firstName = match[1];
            const tussenvoegsel = match[2] || '';
            const lastName = match[3];
            const fullName = tussenvoegsel
                ? `${firstName} ${tussenvoegsel} ${lastName}`
                : `${firstName} ${lastName}`;

            if (!seen.has(fullName.toLowerCase()) && !shouldExclude(fullName)) {
                // Extra check: must look like a real name (not a place or month)
                const lowerFirst = firstName.toLowerCase();
                const lowerLast = lastName.toLowerCase();

                // Skip if it looks like a location or common word
                if (excludeWords.some(w => lowerFirst === w || lowerLast === w)) {
                    continue;
                }

                seen.add(fullName.toLowerCase());
                names.push({
                    type: 'name',
                    name: 'Naam',
                    icon: '👤',
                    value: fullName,
                    page: pageNumber,
                    startIndex: match.index,
                    endIndex: match.index + match[0].length,
                    confidence: 'medium'
                });
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
