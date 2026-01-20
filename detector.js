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
     * Field labels that indicate personal data follows
     * These are common labels in Dutch soil reports (bodemrapporten)
     */
    fieldLabels: {
        // Primary labels - definitely personal data
        primary: [
            { label: 'opdrachtgever', name: 'Opdrachtgever', icon: '👤' },
            { label: 'eigenaar', name: 'Eigenaar', icon: '👤' },
            { label: 'contactpersoon', name: 'Contactpersoon', icon: '👤' },
            { label: 't.a.v.', name: 'Ter attentie van', icon: '👤' },
            { label: 'ter attentie van', name: 'Ter attentie van', icon: '👤' },
            { label: 'aanvrager', name: 'Aanvrager', icon: '👤' },
            { label: 'rechthebbende', name: 'Rechthebbende', icon: '👤' },
        ],
        // Professional labels - should NOT be redacted
        professional: [
            'adviesbureau', 'laboratorium', 'uitvoerder', 'veldwerker',
            'projectleider', 'rapporteur', 'opsteller', 'gecertificeerd',
            'beoordelaar', 'monsternemer', 'analist'
        ]
    },

    /**
     * Detect personal data based on field labels
     * This is the most accurate method for structured documents like soil reports
     */
    detectLabeledFields(text, pageNumber = 1) {
        const detections = [];
        const seen = new Set();

        for (const fieldDef of this.fieldLabels.primary) {
            // Create regex to find label followed by content
            // Match patterns like: "Opdrachtgever: Naam Achternaam" or "Opdrachtgever Naam Achternaam"
            const labelRegex = new RegExp(
                fieldDef.label + '[:\\s]+([^\\n]{3,50})',
                'gi'
            );

            let match;
            while ((match = labelRegex.exec(text)) !== null) {
                const value = match[1].trim();

                // Skip if it looks like a professional party
                const lowerValue = value.toLowerCase();
                const isProfessional = this.fieldLabels.professional.some(p =>
                    lowerValue.includes(p)
                );

                if (isProfessional) continue;

                // Skip if already seen
                if (seen.has(value.toLowerCase())) continue;
                seen.add(value.toLowerCase());

                // Skip very short values or values that look like section headers
                if (value.length < 3 || /^[0-9\.\s]+$/.test(value)) continue;

                detections.push({
                    type: 'labeled_field',
                    name: fieldDef.name,
                    icon: fieldDef.icon,
                    value: value,
                    page: pageNumber,
                    startIndex: match.index + match[0].indexOf(value),
                    endIndex: match.index + match[0].length,
                    confidence: 'high',
                    selected: true
                });
            }
        }

        return detections;
    },

    /**
     * Detect signatures - looks for professional titles followed by names
     * These patterns typically appear near signatures in Dutch reports
     */
    detectSignatures(text, pageNumber = 1) {
        const signatures = [];
        const seen = new Set();

        // Professional titles that indicate signatures
        // Format: title + name (e.g., "ing. J.P. de Vries")
        const signaturePatterns = [
            // Match "ing. Name" or "ir. Name" etc.
            /\b(ing\.|ir\.|drs\.|dr\.|mr\.|prof\.|msc\.?|bsc\.?)\s+([A-Z]\.?\s*)+([a-z]+\s+)?(van\s+|de\s+|der\s+|den\s+|ten\s+)?[A-Z][a-zàáâãäåæçèéêëìíîïñòóôõöùúûüý]+/gi,
            // Match full names after "Opgesteld door:" or "Gecontroleerd door:"
            /(?:opgesteld|gecontroleerd|goedgekeurd|beoordeeld)\s+door[:\s]+([A-Z][a-zàáâãäåæçèéêëìíîïñòóôõöùúûüý]+(?:\s+(?:van|de|der|den)\s+)?[A-Z][a-zàáâãäåæçèéêëìíîïñòóôõöùúûüý]+)/gi
        ];

        for (const pattern of signaturePatterns) {
            let match;
            pattern.lastIndex = 0;

            while ((match = pattern.exec(text)) !== null) {
                const value = match[0].trim();

                if (seen.has(value.toLowerCase())) continue;
                seen.add(value.toLowerCase());

                // Skip very short matches
                if (value.length < 5) continue;

                signatures.push({
                    type: 'signature',
                    name: 'Handtekening/Naam',
                    icon: '✍️',
                    value: value,
                    page: pageNumber,
                    startIndex: match.index,
                    endIndex: match.index + match[0].length,
                    confidence: 'high',
                    selected: true
                });
            }
        }

        return signatures;
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

        // Detect signatures (professional titles + names near signature areas)
        const signatures = this.detectSignatures(text, pageNumber);
        if (signatures.length > 0) {
            results.byCategory['signatures'] = {
                name: 'Handtekeningen/Ondertekenaars',
                icon: '✍️',
                items: signatures
            };
            results.all.push(...signatures);
            results.stats.categories++;
        }

        // PRIORITY: Detect labeled fields (most accurate for soil reports)
        const labeledFields = this.detectLabeledFields(text, pageNumber);
        if (labeledFields.length > 0) {
            results.byCategory['labeled_fields'] = {
                name: 'Geïdentificeerde velden',
                icon: '🏷️',
                items: labeledFields
            };
            results.all.push(...labeledFields);
            results.stats.categories++;
        }

        // Detect names (but exclude public officials) - lower priority
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

        // Public official titles AND government bodies to EXCLUDE from detection
        const publicOfficials = [
            // Titles
            'burgemeester', 'wethouder', 'gemeentesecretaris', 'griffier',
            'raadslid', 'raadsleden', 'minister', 'staatssecretaris',
            'commissaris', 'gedeputeerde', 'dijkgraaf', 'heemraad',
            'ombudsman', 'rechter', 'officier', 'notaris'
        ];

        // Government bodies - these are public, not personal data
        const governmentBodies = [
            'gemeente', 'provincie', 'waterschap', 'rijkswaterstaat', 'ministerie',
            'rijksoverheid', 'omgevingsdienst', 'veiligheidsregio', 'ggd',
            'kadaster', 'rvo', 'rivm', 'bodem+', 'team civiel', 'team civiele',
            'team', 'afdeling', 'dienst', 'sector', 'bureau'
        ];

        // CERTIFIED LABS AND ADVIESBUREAUS - These should NOT be anonymized
        // Based on BRL SIKB 2000/2100/6000 and AS3000 certified parties
        const certifiedParties = [
            // Common soil investigation companies
            'wareco', 'tauw', 'fugro', 'arcadis', 'antea', 'royal haskoning',
            'sweco', 'witteveen', 'bos', 'grontmij', 'oranjewoud', 'save',
            'enviso', 'ecopart', 'syncera', 'geofox', 'lexmond', 'kp adviseurs',
            'aveco de bondt', 'mvao', 'kruse', 'aeres', 'econsultancy',
            'milieuadviesbureau', 'bodeminzicht', 'grondslag',
            // Certified labs (AS3000)
            'eurofins', 'alcontrol', 'synlab', 'sgs', 'al-west', 'omegam',
            'agrolab', 'grondbank', 'nvwa'
        ];

        // Job titles/roles to exclude (these aren't personal names)
        const jobTitles = [
            'projectleider', 'trainee', 'stagiair', 'directeur', 'manager',
            'medewerker', 'adviseur', 'consultant', 'specialist', 'coordinator',
            'assistent', 'secretaris', 'voorzitter', 'penningmeester',
            'veldwerker', 'monsternemer', 'analist', 'rapporteur', 'opdrachtgever'
        ];

        // Common words that look like names but aren't - EXTENDED for soil reports
        const excludeWords = [
            // Document section headers (common false positives)
            'inhoud', 'bijlage', 'bijlagen', 'tekening', 'figuur', 'tabel',
            'analysecertificaten', 'analysecertificaat', 'toetsingskader',
            'conclusies', 'aanbevelingen', 'inleiding', 'samenvatting',
            'resultaten', 'onderzoeksopzet', 'methode', 'literatuur',
            'locatietekening', 'boorpunten', 'situatie', 'overzicht',
            'onderzoeksresultaten', 'lokale', 'achtergrondwaarden',
            // Soil report terms
            'bodemonderzoek', 'verkennend', 'nader', 'historisch', 'actualiserend',
            'bodemkwaliteit', 'grondwater', 'verontreiniging', 'sanering',
            'milieuhygiënisch', 'asbest', 'herontwikkeling', 'bestemmingsplan',
            // Cities (common in reports) - EXTENDED
            'nederland', 'amsterdam', 'rotterdam', 'utrecht', 'eindhoven',
            'leeuwarden', 'groningen', 'arnhem', 'nijmegen', 'tilburg',
            'den haag', 'haarlem', 'almere', 'breda', 'amersfoort',
            'reijndersbuurt', 'arendstuin',
            // Months
            'januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli',
            'augustus', 'september', 'oktober', 'november', 'december',
            // Education 
            'bachelor', 'master', 'hbo', 'mbo', 'wo', 'universiteit', 'hogeschool',
            // Location indicators
            'arendstuin', 'reijndersbuurt', 'woonwijk', 'bedrijventerrein'
        ];

        // Context words that indicate what follows is a professional party (don't redact)
        const contextExclusions = {
            // Education terms
            education: ['bachelor', 'master', 'hbo', 'mbo', 'wo', 'studie', 'opleiding'],
            // Professional context - names after these are likely certified parties
            professional: ['adviesbureau', 'laboratorium', 'lab', 'ingenieursbureau',
                'milieuadvies', 'uitgevoerd door', 'onderzocht door',
                'geanalyseerd door', 'bemonsterd door', 'gecertificeerd']
        };

        // Helper to check if a name should be excluded based on context
        const shouldExclude = (name, matchIndex, fullText) => {
            const lower = name.toLowerCase();

            // Check if it's a certified party (lab/adviesbureau) - these should NOT be anonymized
            for (const party of certifiedParties) {
                if (lower.includes(party) || party.includes(lower)) {
                    return true; // Exclude from anonymization = keep visible
                }
            }

            // Check against all static exclusion lists (including government bodies)
            for (const title of [...publicOfficials, ...governmentBodies, ...jobTitles, ...excludeWords]) {
                if (lower.includes(title) || title.includes(lower)) {
                    return true;
                }
            }

            // Exclude single words that are likely section headers
            if (!name.includes(' ') && name.length < 15) {
                return true;
            }

            // Context-aware check: look at word(s) before the match
            if (matchIndex > 0) {
                // Get 50 chars before the match
                const beforeText = fullText.substring(Math.max(0, matchIndex - 50), matchIndex).toLowerCase();
                const words = beforeText.trim().split(/\s+/);
                const precedingWord = words[words.length - 1] || '';

                // Check if preceding word indicates this is not a name
                for (const [category, contextWords] of Object.entries(contextExclusions)) {
                    for (const cw of contextWords) {
                        if (precedingWord === cw || precedingWord.endsWith(cw)) {
                            return true;
                        }
                    }
                }

                // If it ends with common company suffixes, exclude
                if (lower.endsWith(' bv') || lower.endsWith(' nv') ||
                    lower.endsWith(' b.v.') || lower.endsWith(' n.v.')) {
                    return true;
                }
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
                if (!seen.has(fullName.toLowerCase()) && !shouldExclude(fullName, match.index, text)) {
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

            if (!seen.has(fullName.toLowerCase()) && !shouldExclude(fullName, match.index, text)) {
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
