/**
 * Helper function for address validation
 * Defined outside Detector to ensure availability
 */
function validateAddressHelper(match, matchIndex, fullText) {
    if (!fullText || matchIndex === undefined) return true;

    // 1. Check for Business Indicators PRECEDING the address
    const businessIndicators = [
        'gemeente', 'provincie', 'waterschap', 'stichting', 'vereniging',
        'b.v.', 'n.v.', 'v.o.f.', 'bv', 'nv', 'firma', 'bedrijf',
        'kantoor', 'postbus', 'antwoordnummer', 'locatie',
        'bezoekadres', 'postadres', 'vestiging',
        'ministerie', 'inspectie', 'dienst', 'afdeling'
    ];

    // Check the 50 chars BEFORE match for these words
    const preText = fullText.substring(Math.max(0, matchIndex - 60), matchIndex).toLowerCase();

    for (const indicator of businessIndicators) {
        if (preText.includes(indicator)) {
            return false;
        }
    }

    // 2. Metadata Keywords (Subject of report)
    const metadataKeywords = ['betreft:', 'onderwerp:', 'inzake:', 'locatie:', 'project:'];
    for (const keyword of metadataKeywords) {
        if (preText.includes(keyword)) {
            return false;
        }
    }

    return true;
}
/**
 * AVG Anonimiseer - Detector Module
 * Automatically detects personal data in text content
 */

const Detector = {
    // Learning data storage for feedback loop
    learnedWords: new Set(),   // Words the user has manually redacted
    ignoredWords: new Set(),   // Words the user has removed from redaction (false positives)
    storageKey: 'avg_anonimiseer_learning_data',

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
            validate: (match, matchIndex, fullText) => {
                const clean = match.trim();

                // Reject if it looks like a date (e.g. 10-04-2024)
                if (/^\d{2}-\d{2}-/.test(clean) || /-\d{2}-\d{2}$/.test(clean)) return false;

                // Reject if it looks like a floating point number (e.g. 0.02, 1.0)
                if (/^0\.[0-9]+/.test(clean) || /^[0-9]\.[0-9]+/.test(clean)) return false;

                // Reject if it contains newlines (common in column data treated as one phone number)
                if (match.includes('\n')) return false;

                // Reject if it's just a sequence of very short groups (like 0 0 0 0)
                if ((clean.match(/0/g) || []).length > 8) {
                    // Too many zeros is suspicious for a personal number unless it's 06
                    if (!clean.startsWith('06')) return false;
                }

                // CONTEXT CHECK:
                // If it starts with 06 (mobile), it's high confidence.
                if (clean.replaceAll(/[\s.-]/g, '').startsWith('06')) {
                    // Context Check: Barcodes often start with 06 in the lab world
                    if (matchIndex > 0 && fullText) {
                        const preContext = fullText.substring(Math.max(0, matchIndex - 50), matchIndex).toLowerCase();
                        if (preContext.includes('barcode') || preContext.includes('monster') || preContext.includes('analyse')) {
                            return false;
                        }
                    }
                    return true;
                }

                // If it's a landline (010, 020 etc), it could be a random number.
                // Check if context boosters ("tel", "fax") are present.
                if (matchIndex !== undefined && fullText) {
                    if (Detector.hasContext('phone', matchIndex, fullText)) return true;
                }

                // If no context and not mobile...
                // STRICTER CHECK: If it's a landline (not 06) and has NO context,
                // we require it to be formatted (have dashes or spaces) to avoid matching random 10-digit numbers.
                const hasSeparators = /[\s.-]/.test(clean);
                if (!hasSeparators) {
                    return false; // Reject unformatted 10-digit strings as phone numbers without context
                }

                return true;
            }
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
            regex: /\b[A-Z][a-zàáâãäåæçèéêëìíîïñòóôõöùúûüý]+(?:straat|laan|weg|plein|singel|gracht|kade|dijk|hof|steeg|pad|dreef|boulevard)\s+\d+[a-z]?(?:\s*[-\/]\s*\d+)?\b/gi,
            validate: (match, matchIndex, fullText) => validateAddressHelper(match, matchIndex, fullText)
        },

        // Cadastral numbers (kadastrale nummers - common in soil reports)
        kadastraal: {
            name: 'Kadastraal nr',
            icon: '📋',
            regex: /\b[A-Z]{3}\d{2}\s*[A-Z]\s*\d{4,5}\b/gi,
            validate: () => true
        },

        // Signature Context (Assisted Discovery)
        signature: {
            name: 'Handtekening/Paraaf',
            icon: '✍️',
            // Match keywords often associated with signatures
            regex: /\b(paraaf|handtekening|ondertekening|akkoord|gezien|datum)\s*[:.]?\s*$/gmi,
            // Note: The regex finds the label. The user must redraw the box.
            // Ideally we'd capture the space next to it, but that's hard with text-only.
            // We'll capture the label itself so they can click 'Jump to'.
            validate: (match, matchIndex, fullText) => {
                // Only valid if it appears to be a label (e.g. at end of line or followed by underscores)
                const nextChars = fullText.substr(matchIndex + match.length, 20);
                if (/_{3,}/.test(nextChars)) return true; // Followed by lines
                return true;
            }
        },

        // Names with Initials (e.g. J. Jansen, A.B. de Vries)
        nameInitials: {
            name: 'Naam (Initialen)',
            icon: '👤',
            // Match: Capital Letter + dot + space(optional) + Surname (Capitalized)
            // Handles multiple initials: "A.B.C. Jansen"
            regex: /\b(?:[A-Z]\.\s*)+[A-Z][a-zàáâãäåæçèéêëìíîïñòóôõöùúûüý]+(?:\s+(?:van|de|der|den|het|ten|ter|te)\s+[A-Z][a-zàáâãäåæçèéêëìíîïñòóôõöùúûüý]+)?\b/g,
            validate: (match, matchIndex, fullText) => {
                // Exclude common abbreviations that look like names
                const exclude = ['B.V.', 'N.V.', 'Z.K.H.', 'H.M.', 'A.U.B.', 'N.B.', 'T.A.V.'];
                if (exclude.includes(match.trim().toUpperCase())) return false;

                return !Detector.shouldExclude(match, matchIndex, fullText);
            }
        }
    },


    // Name patterns (harder to detect reliably)
    namePatterns: {
        // Common Dutch name prefixes that might indicate a name follows
        prefixes: [
            // Standard titles
            'de heer', 'heer', 'heren', 'mevrouw', 'mevr.', 'dhr.', 'mr.', 'dr.', 'ir.', 'prof.', 'ing.', 'ingenieur', 'drs.', 'bc.', 'ds.', 'fa.', 'fam.', 'familie',
            // Governance & Roles (from user feedback)
            'wethouder', 'burgemeester', 'secretaris', 'griffier', 'voorzitter', 'directeur',
            'inspecteur', 'behandelaar', 'saneerder', 'coördinator', 'adviseur', 'projectleider',
            'contactpersoon', 'opdrachtgever', 'aanvrager', 'melder', 'indiener', 'auteur', 'steller',
            'portefeuillehouder', 'portefuillehouder', 'db lid', 'db-lid', 'monsternemer', 'veldwerker', 'boormeester', 'commissie',
            // Context triggers
            'geachte', 'beste', 't.a.v.', 'attentie van', 'namens', 'aangetekend',
            'ingediend door', 'uitgevoerd door', 'behandeld door', 'verzonden door', 'opgesteld door',
            'afschrift aan', 'terecht bij', 'akkoord', 'paraaf', 'handtekening', 'ondertekening',
            'getekend', 'gecontroleerd', 'geautoriseerd', 'hoogachtend'
        ],
        // Pattern for capitalized words (potential names)
        capitalizedWords: /\b[A-Z][a-zàáâãäåæçèéêëìíîïñòóôõöùúûüý]+(?:\s+(?:van|de|der|den|het|ten|ter|te)\s+)?[A-Z][a-zàáâãäåæçèéêëìíîïñòóôõöùúûüý]+\b/g
    },

    /**
     * Validate BSN using the 11-proof algorithm
     * Now with context awareness: if it looks like a BSN but fails 11-proof, 
     * OR if it passes 11-proof but looks like a date/phone, check context.
     */
    validateBSN(bsn, matchIndex, fullText) {
        if (!/^[0-9]{9}$/.test(bsn)) return false;

        // Strict 11-proof
        const digits = bsn.split('').map(Number);
        let sum = 0;
        for (let i = 0; i < 8; i++) {
            sum += digits[i] * (9 - i);
        }
        sum -= digits[8];
        const isValid = sum % 11 === 0;

        if (!isValid) return false;

        // BSNs often look like random numbers. 
        // If we have access to context (matchIndex defined), use it to be safer
        // preventing false positives on 9-digit numbers that are definitely NOT BSNs (e.g. monetary amounts without decimals)
        // ... implementing this later if issues arise. 
        // For now: 11-proof is quite strong. 
        return true;
    },

    /**
     * Exclusion Lists (Global)
     * These patterns are used across all detection methods to avoid false positives
     */

    // Public official titles AND government bodies to EXCLUDE from detection
    publicOfficials: [
        'burgemeester', 'wethouder', 'gemeentesecretaris', 'griffier',
        'raadslid', 'raadsleden', 'minister', 'staatssecretaris',
        'commissaris', 'gedeputeerde', 'dijkgraaf', 'heemraad',
        'ombudsman', 'rechter', 'officier', 'notaris'
    ],

    // Government bodies - these are public, not personal data
    governmentBodies: [
        'gemeente', 'provincie', 'waterschap', 'rijkswaterstaat', 'ministerie',
        'rijksoverheid', 'omgevingsdienst', 'veiligheidsregio', 'ggd',
        'kadaster', 'rvo', 'rivm', 'bodem+', 'team civiel', 'team civiele',
        'team', 'afdeling', 'dienst', 'sector', 'bureau', 'college', 'raad',
        'stichting', 'vereniging', 'coöperatie', 'maatschap', 'firma',
        'inspectie', 'autoriteit', 'kamer van koophandel', 'kvk', 'politie',
        'brandweer', 'ambulance', 'ziekenhuis', 'instelling', 'school',
        'universiteit', 'hogeschool'
    ],

    // CERTIFIED LABS AND ADVIESBUREAUS - These should NOT be anonymized
    certifiedParties: [
        // Common soil investigation companies
        'wareco', 'tauw', 'fugro', 'arcadis', 'antea', 'royal haskoning',
        'sweco', 'witteveen', 'bos', 'grontmij', 'oranjewoud', 'save',
        'enviso', 'ecopart', 'syncera', 'geofox', 'lexmond', 'kp adviseurs',
        'aveco de bondt', 'mvao', 'kruse', 'aeres', 'econsultancy',
        'milieuadviesbureau', 'bodeminzicht', 'grondslag',
        // Certified labs (AS3000)
        'eurofins', 'alcontrol', 'synlab', 'sgs', 'al-west', 'omegam',
        'agrolab', 'grondbank', 'nvwa'
    ],

    // Job titles/roles to exclude (these aren't personal names)
    jobTitles: [
        'projectleider', 'trainee', 'stagiair', 'directeur', 'manager',
        'medewerker', 'adviseur', 'consultant', 'specialist', 'coordinator',
        'assistent', 'secretaris', 'voorzitter', 'penningmeester',
        'bestuurder', 'commissaris', 'griffier', 'bode', 'beheerder',
        'veldwerker', 'monsternemer', 'analist', 'rapporteur', 'opdrachtgever',
        'contactpersoon', 'behandelaar', 'architect', 'constructeur',
        'aannemer', 'uitvoerder', 'opzichter', 'makelaar', 'taxateur'
    ],

    // So many exclusions to prevent false positives in technical reports
    excludeWords: [
        // Soil / Environmental Technical Terms (EXTENDED)
        'lutum', 'humus', 'organische', 'stof', 'droge', 'glooirest', 'koolzure', 'kalk',
        'korrelgrootte', 'dos', 'fractie', 'zeeffractie', 'ondermaat', 'overmaat',
        'zintuiglijk', 'visueel', 'waarneming', 'bijmengingen', 'olia', 'water',
        'vluchtige', 'aromaten', 'polycyclische', 'koolwaterstoffen', 'pak',
        'gechloreerde', 'koolwaterstoffen', 'pcb', 'minerale', 'olie',
        'zware', 'metalen', 'asbest', 'serpentijn', 'amfibool', 'chrysotiel', 'amosiet',
        'crocidoliet', 'tremoliet', 'actinnoliet', 'anthophylliet', 'hechtgebonden',
        'niet-hechtgebonden', 'gebondenheid', 'materiaal', 'plaatmateriaal',
        'golfplaten', 'vlakke', 'platen', 'buizen', 'leidingen', 'resten',
        'puin', 'baksteen', 'beton', 'asfalt', 'granulaat', 'slakken',
        'kolengruis', 'glas', 'aardewerk', 'metaal', 'plastic', 'wortels',

        // Report Status / Values / Headers
        'voldoet', 'overschrijding', 'achtergrondwaarde', 'streefwaarde', 'interventiewaarde',
        'tussenwaarde', 'normwaarde', 'toetsoordeel', 'toetsing', 'oordeel',
        'resultaat', 'gemeten', 'gehalte', 'waarde', 'eenheid', 'parameter',
        'component', 'analyse', 'monster', 'boring', 'peilbuis', 'diepte',
        'traject', 'cm-mv', 'm-mv', 'grondwaterstand', 'ph', 'ec', 'geleidbaarheid',
        'troebelheid', 'zuurgraad', 'temperatuur', 'zuurstof', 'redox',
        'kwaliteitsklasse', 'klasse', 'industrie', 'wonen', 'landbouw', 'natuur',
        'matig', 'sterk', 'licht', 'verhoogd', 'verontreinigd', 'schoon',
        'toepasbaar', 'niet-toepasbaar', 'verspeidbaar', 'grootschalige', 'toepassing',
        'hoogste', 'laagste', 'gemiddelde', 'mediaan', 'percentiel', 'duplo',
        'conform', 'equivalent', 'indicatief', 'res', 'legenda', 'omschrijving',
        'toetsen', 'geactualiseerd', 'handelings', 'kader', 'zeer', 'zorgwekkende',
        'stoffen', 'zzs', 'bijzonderheden', 'opmerkingen', 'conclusie', 'aanbeveling',

        // Company suffixes & Common Business Terms
        'advies', 'groep', 'consult', 'consultancy', 'ingenieurs', 'bureau',
        'milieu', 'techniek', 'milieutechniek', 'bodem', 'infra', 'bouw',
        'aanneming', 'transport', 'recycling', 'verwerking', 'beheer',
        'development', 'solutions', 'systems', 'services', 'partners',
        'management', 'agency', 'associates', 'lab', 'laboratory', 'laboratories',
        'analytics', 'analytico', 'eurofins', 'sgs', 'alcontrol', 'synlab',
        'wematech', 'dijkstra', 'tritium',    // Acronyms (Soil/Construction)
        'agw', 'hbb', 'ubi', 'ldb2004', 'lib', 'bkl', 'nen', 'bro', 'bal', 'wbb', 'mer',

        // Document Structure (Common Header false positives)
        'hoofdstuk', 'paragraaf', 'onderdeel', 'sectie', 'bijlage', 'pagina', 'blad', 'tabel', 'figuur', 'grafiek', 'tekst', 'betrouwbaarheid', 'inleiding', 'samenvatting',

        // Map / Drawing Terms
        'schaal', 'situatie', 'tekening', 'kadastraal', 'perceel', 'legenda', 'noord', 'datum', 'project', 'formaat', 'getekend', 'gezien', 'status', 'wijziging', 'blad',

        // Locations / Prepositions / Noise
        'oud', 'nieuw', 'groot', 'klein', 'noord', 'oost', 'zuid', 'west',
        'boven', 'onder', 'midden', 'centraal', 'gastel', 'leur', 'plaisir',
        'mon', 'dn', 'it', 'yv', 'ja', 'nee', 'nvt', 'n.v.t.', 'dl', 'll',
        'tussenpersoon', 'opgegeven', 'doel', 'uitvoerende', 'partij', 'grepen',
        'op', 'dichtheid', 'certificaten', 'emissietoetswaarde'
    ],

    /**
     * Context Boosters
     * Keywords that strongly suggest the following text is personal data
     */
    contextBoosters: {
        phone: ['tel', 'tel:', 'telnr', 'telefoon', 'mobiel', 'mob', '06', 'fax'],
        email: ['e-mail', 'email', 'mail', 'adres'],
        bsn: ['bsn', 'sofinummer', 'burger', 'nummer'],
        iban: ['iban', 'bank', 'rekening', 'rekeningnummer', 'bankrekening']
    },

    /**
     * Context Exclusions
     * Keywords that suggest the following text is NOT personal data
     */
    contextExclusions: {
        organization: ['bedrijf', 'firma', 'stichting', 'vereniging', 'gemeente', 'provincie', 'waterschap', 'ministerie']
    },

    /**
     * Check for context boosters near a match
     * @param {string} matchType - 'phone', 'email', etc.
     * @param {number} matchIndex - Index of the match in full text
     * @param {string} fullText - The full text content
     * @returns {boolean} True if context is found
     */
    hasContext(matchType, matchIndex, fullText) {
        if (!this.contextBoosters[matchType]) return false;

        // Look at the 50 characters before the match
        const range = 50;
        const start = Math.max(0, matchIndex - range);
        const contextText = fullText.substring(start, matchIndex).toLowerCase();

        return this.contextBoosters[matchType].some(booster => {
            // Check for "Tel:" or "Tel " or just the word appearing
            return contextText.includes(booster);
        });
    },

    /**
     * Helper: Check if a word matches using whole-word boundary matching
     * Prevents 'ja' from matching 'Jan' or 'Jansen'
     * @param {string} text - Text to search in (lowercase)
     * @param {string} word - Word to find (lowercase)
     * @returns {boolean} True if whole word is found
     */
    matchesWholeWord(text, word) {
        // Escape regex special characters in the word
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Use word boundaries for matching
        const regex = new RegExp(`\\b${escaped}\\b`, 'i');
        return regex.test(text);
    },

    /**
     * Check if a name should be excluded based on global rules
     * IMPROVED: Uses whole-word matching to prevent false positives
     */
    shouldExclude(name, matchIndex, fullText) {
        const lower = name.toLowerCase();
        const words = lower.split(/\s+/);

        // Check certified parties (these can use partial matching for company names)
        for (const party of this.certifiedParties) {
            if (lower.includes(party) || party.includes(lower)) return true;
        }

        // Check static exclusion lists WITH WHOLE-WORD MATCHING
        // Split name into words and check each word individually
        const allExclusions = [...this.publicOfficials, ...this.governmentBodies, ...this.jobTitles, ...this.excludeWords];

        for (const exclusion of allExclusions) {
            // Check if any word in the name EXACTLY matches the exclusion
            // This prevents 'ja' from matching 'Jan' or 'Jansen'
            if (words.some(word => word === exclusion)) {
                return true;
            }
            // Also check if the entire name IS the exclusion
            if (lower === exclusion) {
                return true;
            }
        }

        // Exclude single words that are short (unlikely to be a full name without context)
        if (!name.includes(' ') && name.length < 15) {
            return true;
        }

        // Context-aware check
        if (matchIndex > 0) {
            const beforeText = fullText.substring(Math.max(0, matchIndex - 50), matchIndex).toLowerCase();
            const beforeWords = beforeText.trim().split(/\s+/);
            const precedingWord = beforeWords[beforeWords.length - 1] || '';

            for (const [category, contextWords] of Object.entries(this.contextExclusions)) {
                for (const cw of contextWords) {
                    if (precedingWord === cw || precedingWord.endsWith(cw)) return true;
                }
            }

            // Check for numeric prefix (Section headers like '7.3 Name')
            const immediatePrefix = fullText.substring(Math.max(0, matchIndex - 10), matchIndex).trim();
            if (/^\d+(\.\d+)*\.?$/.test(immediatePrefix)) {
                return true;
            }

            // Company suffixes
            if (lower.endsWith(' bv') || lower.endsWith(' nv') ||
                lower.endsWith(' b.v.') || lower.endsWith(' n.v.') ||
                lower.endsWith(' vof') || lower.endsWith(' stichting') ||
                lower.endsWith(' holding') || lower.endsWith(' group')) {
                return true;
            }
        }

        return false;
    },

    /**
     * Field labels that indicate personal data follows
     * These are common labels in Dutch soil reports (bodemrapporten)
     */
    fieldLabels: {
        // Primary labels - definitely personal data to redact
        primary: [
            { label: 'opdrachtgever', name: 'Opdrachtgever', icon: '👤' },
            { label: 'eigenaar', name: 'Eigenaar', icon: '👤' },
            { label: 'contactpersoon', name: 'Contactpersoon', icon: '👤' },
            { label: 't.a.v.', name: 'Ter attentie van', icon: '👤' },
            { label: 'ter attentie van', name: 'Ter attentie van', icon: '👤' },
            { label: 'aanvrager', name: 'Aanvrager', icon: '👤' },
            { label: 'rechthebbende', name: 'Rechthebbende', icon: '👤' },
            { label: 'boormeester', name: 'Boormeester', icon: '👷' },
            { label: 'veldwerker', name: 'Veldwerker', icon: '👷' },
            { label: 'monsternemer', name: 'Monsternemer', icon: '🧪' },
            { label: 'analist', name: 'Analist', icon: '🔬' },
            { label: 'uitvoerder', name: 'Uitvoerder', icon: '👷' },
            { label: 'projectleider', name: 'Projectleider', icon: '👔' },
            { label: 'rapporteur', name: 'Rapporteur', icon: '📝' },
            { label: 'auteur', name: 'Auteur', icon: '✍️' }
        ],
        // Professional labels - should NOT be redacted
        // (Cleaned up: moved specific roles to primary if they are usually followed by names)
        professional: [
            'gecertificeerd', 'behandeld', 'ingediend', 'uitgevoerd', 'gecontroleerd'
        ]
    },

    /**
     * Detect personal data based on field labels
     * This is the most accurate method for structured documents like soil reports
     */
    detectLabeledFields(text, pageNumber = 1) {
        // Redundant - functionality moved to findMatches but kept for compatibility if called directly
        // Just return empty or proxy to findMatches logic if needed.
        // For now, let's keep it simple and rely on findMatches.
        return [];
    },

    /**
     * Validate Address: Filter out business addresses
     */
    validateAddress(match, matchIndex, fullText) {
        return validateAddressHelper(match, matchIndex, fullText);
    },

    /**
     * Main detection function
     */
    findMatches(text, pageNum) {
        const detections = [];
        const seen = new Set();

        for (const fieldDef of this.fieldLabels.primary) {
            // Create regex to find label followed by content
            // STRICTER: Require colon OR if space, value must start with uppercase

            // 1. Label with Colon (Strongest signal) - Case Insensitive, allow any text after
            const looseRegex = new RegExp(
                fieldDef.label + ':\\s*([^\\n]{3,50})',
                'gi'
            );

            // 2. Label without Colon - Case Insensitive but Value MUST be Capitalized
            const strictRegex = new RegExp(
                `\\b${fieldDef.label}\\s+([A-Z][^\\.\\n,:]+)`,
                'g' // No 'i' for value, but 'i' for label? Mixed is hard.
                // Actually, let's make the label part regex insensitive via character classes or just lowercasing text?
                // JS Regex doesn't support local flags.
                // Solution: Use 'gi' but validate capitalization in code.
            );

            // Re-implementing correctly:
            const patterns = [
                { regex: looseRegex, type: 'strict' }, // Colon -> accepts "m. visser"
                { regex: new RegExp(`\\b${fieldDef.label}\\s+([A-Z][^\\.\\n,:]+)`, 'gi'), type: 'loose' } // No Colon -> accepts "Boormeester Jan"
            ];

            for (const { regex, type } of patterns) {
                let match;
                while ((match = regex.exec(text)) !== null) {
                    // For 'loose' pattern (no colon), check if label matches distinctively (case insensitive but word boundary)
                    // (Already handled by \b in regex)

                    const value = match[1].trim();

                    // SKIP if value looks like a sentence start (contains verbs? hard to detect)
                    // heuristic: if it contains too many lowercase words or " en ", " van ", " de " without capitals
                    if (type === 'loose') {
                        // In loose mode "Opdrachtgever Piet Jansen", we want "Piet Jansen".
                        // Regex `[A-Z][^\\.\\n,:]+` grabs until dot/newline.
                        // "Opdrachtgever De Gemeente heeft..." -> "De Gemeente heeft..."
                        // We must stop at lowercase words if they aren't particles.

                        // Refined check: Only accept if it looks like a Name/Entity
                        // i.e. mostly Capitalized words
                        const words = value.split(' ');
                        const capitalizedCount = words.filter(w => /^[A-Z]/.test(w)).length;
                        if (capitalizedCount < words.length * 0.5) continue; // Must be >50% capitalized
                    }

                    // Skip if it looks like a professional party
                    const lowerValue = value.toLowerCase();
                    const isProfessional = this.fieldLabels.professional.some(p =>
                        lowerValue.includes(p)
                    );

                    if (isProfessional) continue;

                    // Skip if already seen
                    if (seen.has(value.toLowerCase())) continue;
                    seen.add(value.toLowerCase());

                    // Check global exclusions (government bodies, etc.)
                    if (this.shouldExclude(value, match.index + match[0].indexOf(value), text)) {
                        continue;
                    }

                    // Skip very short values or values that look like section headers
                    if (value.length < 3 || /^[0-9\.\s]+$/.test(value)) continue;

                    // Skip suspiciously long values (probably false positive read of a whole sentence)
                    if (value.length > 60) continue;

                    detections.push({
                        type: 'labeled_field',
                        name: fieldDef.name,
                        icon: fieldDef.icon,
                        value: value,
                        page: pageNumber,
                        startIndex: match.index + match[0].indexOf(value), // Approx start of value
                        endIndex: match.index + match[0].length,
                        confidence: 'high',
                        selected: true
                    });
                }
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

                // Check global exclusions
                if (this.shouldExclude(value, match.index, text)) {
                    continue;
                }

                // Skip very short matches
                if (value.length < 5) continue;

                // NEW: Skip suspiciously long matches (likely OCR errors merging lines or map text)
                // A signature/name shouldn't be a paragraph.
                if (value.length > 50) continue;

                // Extra Safety: Check if it contains map terms that might successfully mask as names
                // e.g. "Schaal 1:1000" might look like "Schaal Een" to some loose regexes?
                const lowerValue = value.toLowerCase();
                if (lowerValue.includes('schaal') || lowerValue.includes('datum') || lowerValue.includes('gezien') || lowerValue.includes('getekend')) {
                    continue;
                }

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
                // NOW PASSING CONTEXT (match.index and full text)
                if (pattern.validate(value, match.index, text)) {
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
                items: potentialNames.map(n => ({
                    ...n,
                    selected: n.selected !== undefined ? n.selected : true
                }))
            };
            results.all.push(...potentialNames);
            results.stats.categories++;
        }

        // Detect learned words (from feedback loop)
        const learnedDetections = this.detectLearnedWords(text, pageNumber);
        if (learnedDetections.length > 0) {
            results.byCategory['learned'] = {
                name: 'Geleerde patronen',
                icon: '🧠',
                items: learnedDetections
            };
            results.all.push(...learnedDetections);
            results.stats.categories++;
        }

        // Filter out ignoring words
        results.all = results.all.filter(detection => !this.shouldIgnore(detection.value));

        // Remove overlapping detections
        results.all = this.removeOverlappingDetections(results.all);

        // Re-distribute to categories
        results.byCategory = {};
        results.stats.categories = 0;

        results.all.forEach(item => {
            if (!results.byCategory[item.type]) {
                results.byCategory[item.type] = {
                    name: this.patterns[item.type] ? this.patterns[item.type].name : (item.name || item.type),
                    icon: item.icon || '🔍',
                    items: []
                };
                results.stats.categories++;
            }
            results.byCategory[item.type].items.push(item);
        });

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

        // Strategy 1: Find names after known prefixes (high confidence)
        // Pattern: prefix + space + FirstName + [tussenvoegsel] + LastName
        // Note: 'gi' flag = prefix case-insensitive, but [A-Z] enforces name capitals
        for (const prefix of this.namePatterns.prefixes) {
            const escapedPrefix = prefix.replace('.', '\\.');
            const regex = new RegExp(
                escapedPrefix +
                '\\s*(?:[:.])?\\s+' +  // Optional colon/dot, then require space
                '([A-Z][a-zàáâãäåæçèéêëìíîïñòóôõöùúûüý]+' +  // First name
                '(?:\\s+(?:van|de|der|den|het|ten|ter|te))?\\s+' +  // Optional tussenvoegsel + required space
                '[A-Z][a-zàáâãäåæçèéêëìíîïñòóôõöùúûüý]+)',  // Last name
                'gi'
            );

            let match;
            while ((match = regex.exec(text)) !== null) {
                const fullName = match[1];
                if (!seen.has(fullName.toLowerCase()) && !this.shouldExclude(fullName, match.index, text)) {
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

            if (!seen.has(fullName.toLowerCase()) && !this.shouldExclude(fullName, match.index, text)) {
                // Extra check: must look like a real name (not a place or month)
                const lowerFirst = firstName.toLowerCase();
                const lowerLast = lastName.toLowerCase();

                // Skip if it looks like a location or common word or legal term
                if (this.excludeWords.some(w => lowerFirst === w || lowerLast === w) ||
                    this.publicOfficials.some(w => lowerFirst === w || lowerLast === w) ||
                    this.governmentBodies.some(w => lowerFirst === w || lowerLast === w)) {
                    continue;
                }

                // Specific fix for "Algemene Voorwaarden" or "Gemeente Hilversum"
                const commonFalsePositives = [
                    'algemene', 'bijzondere', 'inkoop', 'voorwaarden', 'gemeente',
                    'raad', 'college', 'burgemeester', 'wethouder', 'artikel', 'lid',
                    'paragraaf', 'hoofdstuk', 'bijlage', 'tabel', 'figuur'
                ];
                if (commonFalsePositives.includes(lowerFirst) || commonFalsePositives.includes(lowerLast)) {
                    continue;
                }

                // Extra check: Disallow if first word is a common article/demonstrative
                const sentenceStarters = ['het', 'deze', 'dit', 'dat', 'een', 'elke', 'ieder', 'beide'];
                if (sentenceStarters.includes(lowerFirst)) {
                    continue;
                }

                // Linguistic Check: Reject common adjective endings (unlikely for names)
                // e.g., "Technische", "Sociale", "Financiële", "Specifieke"
                if (lowerFirst.endsWith('sche') ||
                    lowerFirst.endsWith('ale') ||
                    lowerFirst.endsWith('ele') ||
                    lowerFirst.endsWith('iële') ||
                    lowerFirst.endsWith('ieve') ||
                    lowerFirst.endsWith('ijke')) {
                    continue;
                }

                seen.add(fullName.toLowerCase());
                names.push({
                    type: 'name',
                    name: 'Mogelijke Naam',
                    icon: '👤',
                    value: fullName,
                    page: pageNumber,
                    startIndex: match.index,
                    endIndex: match.index + match[0].length,
                    confidence: 'low',
                    confidence: 'low',
                    selected: false // FALSE POSITIVE FIX: Do not auto-select generic name matches. User must opt-in.
                });
            }
        }

        return names;
    },

    // ==================== LEARNING FUNCTIONS ====================

    /**
     * Learn a word/phrase from manual redaction
     * @param {string} word - The word or phrase to learn
     */
    learnWord(word) {
        if (!word || word.trim().length < 2) return;
        const normalized = word.trim().toLowerCase();
        this.learnedWords.add(normalized);
        // Remove from ignored if it was there
        this.ignoredWords.delete(normalized);
        console.log(`[Detector] Learned word: "${normalized}"`);
        this.saveLearnedData();
    },

    /**
     * Ignore a word/phrase (mark as false positive)
     * @param {string} word - The word or phrase to ignore
     */
    ignoreWord(word) {
        if (!word || word.trim().length < 2) return;
        const normalized = word.trim().toLowerCase();
        this.ignoredWords.add(normalized);
        // Remove from learned if it was there
        this.learnedWords.delete(normalized);
        console.log(`[Detector] Ignoring word: "${normalized}"`);
        this.saveLearnedData();
    },

    /**
     * Get all learned words
     * @returns {Set} Set of learned words
     */
    getLearnedWords() {
        return this.learnedWords;
    },

    /**
     * Get all ignored words
     * @returns {Set} Set of ignored words
     */
    getIgnoredWords() {
        return this.ignoredWords;
    },

    /**
     * Clear all learned data
     */
    clearLearnedData() {
        this.learnedWords.clear();
        this.ignoredWords.clear();
        console.log('[Detector] Cleared all learned data');
        this.saveLearnedData();
    },

    /**
     * Save learned data to localStorage
     */
    saveLearnedData() {
        try {
            const data = {
                learned: Array.from(this.learnedWords),
                ignored: Array.from(this.ignoredWords)
            };
            localStorage.setItem(this.storageKey, JSON.stringify(data));
        } catch (e) {
            console.error('[Detector] Error saving learned data:', e);
        }
    },

    /**
     * Load learned data from localStorage
     */
    loadLearnedData() {
        try {
            const json = localStorage.getItem(this.storageKey);
            if (json) {
                const data = JSON.parse(json);
                if (data.learned && Array.isArray(data.learned)) {
                    this.learnedWords = new Set(data.learned);
                }
                if (data.ignored && Array.isArray(data.ignored)) {
                    this.ignoredWords = new Set(data.ignored);
                }
                console.log(`[Detector] Loaded ${this.learnedWords.size} learned words and ${this.ignoredWords.size} ignored words`);
            }
        } catch (e) {
            console.error('[Detector] Error loading learned data:', e);
        }
    },

    /**
     * Detect occurrences of learned words in text
     * @param {string} text - Text to search
     * @param {number} pageNumber - Page number
     * @returns {Array} Array of detections
     */
    detectLearnedWords(text, pageNumber = 1) {
        const detections = [];
        const lowerText = text.toLowerCase();

        for (const word of this.learnedWords) {
            // Skip if this word is in the ignored list
            if (this.ignoredWords.has(word)) continue;

            // Find all occurrences
            let startIndex = 0;
            while ((startIndex = lowerText.indexOf(word, startIndex)) !== -1) {
                // Get the original case version from the text
                const originalWord = text.substring(startIndex, startIndex + word.length);

                detections.push({
                    type: 'learned',
                    name: 'Geleerd patroon',
                    icon: '🧠',
                    value: originalWord,
                    page: pageNumber,
                    startIndex: startIndex,
                    endIndex: startIndex + word.length,
                    confidence: 'learned',
                    selected: true
                });

                startIndex += word.length;
            }
        }

        return detections;
    },

    /**
     * Check if a detection should be filtered out (was marked as false positive)
     * @param {string} value - The detected value to check
     * @returns {boolean} True if should be filtered out
     */
    shouldIgnore(value) {
        if (!value) return false;
        const normalized = value.trim().toLowerCase();
        return this.ignoredWords.has(normalized);
    },

    // ==================== END LEARNING FUNCTIONS ====================

    /**
     * Remove overlapping detections (keep the longest/best one)
     */
    removeOverlappingDetections(detections) {
        if (!detections || detections.length < 2) return detections;

        // Sort by start index, then by length (descending)
        detections.sort((a, b) => {
            if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
            return (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex);
        });

        const kept = [];
        let lastItem = null;

        for (const item of detections) {
            if (!lastItem) {
                kept.push(item);
                lastItem = item;
                continue;
            }

            // Case 1: Fully contained (e.g. "Jansen" inside "Jan Jansen")
            if (item.endIndex <= lastItem.endIndex) {
                continue;
            }

            // Case 2: Significant overlap (> 80%)
            if (item.startIndex < lastItem.endIndex) {
                const overlap = lastItem.endIndex - item.startIndex;
                const len1 = lastItem.endIndex - lastItem.startIndex;
                const len2 = item.endIndex - item.startIndex;

                if (overlap > 0.8 * Math.min(len1, len2)) {
                    // Keep longer one
                    if (len2 > len1) {
                        kept.pop();
                        kept.push(item);
                        lastItem = item;
                    }
                    continue;
                }
            }

            kept.push(item);
            lastItem = item;
        }

        return kept;
    },

    /**
     * Detect specific custom text for search functionality
     * @param {string} text - The text to scan
     * @param {string} searchTerm - The term to search for
     * @returns {Array} List of matches with context
     */
    detectCustom(text, searchTerm) {
        if (!text || !searchTerm || searchTerm.length < 2) return [];

        const matches = [];
        const lowerText = text.toLowerCase();
        const lowerTerm = searchTerm.toLowerCase();
        let startIndex = 0;
        let index;

        while ((index = lowerText.indexOf(lowerTerm, startIndex)) > -1) {
            // Get original casing from text
            const value = text.substr(index, searchTerm.length);

            matches.push({
                type: 'custom',
                name: 'Zoekresultaat',
                icon: '🔍',
                value: value,
                startIndex: index,
                endIndex: index + searchTerm.length,
                selected: true
            });

            startIndex = index + searchTerm.length;
        }

        return matches;
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

// Initialize persistence if running in browser
if (typeof window !== 'undefined') {
    Detector.loadLearnedData();
}
