/**
 * AVG Anonimiseer - Persistence Module
 * Handles local storage of PDF files and redaction state using IndexedDB
 * allowing work to continue after page refresh.
 */

const Persistence = {
    dbName: 'AVG-Anonimiseer-DB',
    storeName: 'session_store',
    dbVersion: 1,
    db: null,

    /**
     * Initialize IndexedDB
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = (event) => {
                console.error('[Persistence] Database error:', event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log('[Persistence] Database initialized');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'key' });
                }
            };
        });
    },

    /**
     * Save PDF file blob
     * @param {Blob|File} file
     */
    async saveFile(file) {
        return this.put('current_file', file);
    },

    /**
     * Load PDF file blob
     * @returns {Promise<Blob|File>}
     */
    async loadFile() {
        return this.get('current_file');
    },

    /**
     * Save redaction state (JSON string or object)
     * @param {Object} state
     */
    async saveState(state) {
        return this.put('redaction_state', state);
    },

    /**
     * Load redaction state
     * @returns {Promise<Object>}
     */
    async loadState() {
        return this.get('redaction_state');
    },

    /**
     * Save metadata (filename, etc)
     */
    async saveMetadata(metadata) {
        return this.put('file_metadata', metadata);
    },

    async loadMetadata() {
        return this.get('file_metadata');
    },

    /**
     * Clear all session data
     */
    async clearSession() {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear();

            request.onsuccess = () => {
                console.log('[Persistence] Session cleared');
                resolve();
            };
            request.onerror = (e) => reject(e);
        });
    },

    // Helper methods
    async put(key, value) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put({ key, value });

            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e);
        });
    },

    async get(key) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);

            request.onsuccess = (event) => {
                const result = event.target.result;
                resolve(result ? result.value : null);
            };
            request.onerror = (e) => reject(e);
        });
    }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Persistence;
}
