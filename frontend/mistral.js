/**
 * AVG Anonimiseer - Mistral AI Service (Frontend)
 * Communicates with the Python Backend Proxy
 * 
 * Features:
 * - Request queue with concurrency control (prevents 429 errors)
 * - Keep-alive ping to prevent cold starts
 */

const MistralService = {
    // Backend URL
    BACKEND_URL: 'https://avg-anonimiseer.onrender.com/api/analyze',

    // Request queue configuration
    _queue: [],
    _activeRequests: 0,
    MAX_CONCURRENT: 2,  // Limit concurrent requests to prevent rate limiting

    // Keep-alive interval reference
    _keepAliveInterval: null,

    /**
     * Initialize the service (call once on app start)
     */
    init() {
        // Start keep-alive pings to prevent Render cold starts
        this.startKeepAlive();
    },

    /**
     * Keep-alive ping to prevent Render free tier spin-down
     * Pings every 10 minutes
     */
    startKeepAlive() {
        if (this._keepAliveInterval) return; // Already running

        const baseUrl = this.BACKEND_URL.replace('/api/analyze', '');

        // Initial ping
        fetch(baseUrl).catch(() => { });

        // Ping every 10 minutes (600,000ms)
        this._keepAliveInterval = setInterval(() => {
            fetch(baseUrl).catch(() => { });
            console.log('🔄 Keep-alive ping sent to backend');
        }, 600000);
    },

    /**
     * Process the next request in the queue
     */
    async _processQueue() {
        if (this._activeRequests >= this.MAX_CONCURRENT || this._queue.length === 0) {
            return;
        }

        const { request, resolve, reject } = this._queue.shift();
        this._activeRequests++;

        try {
            const result = await this._executeRequest(request);
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            this._activeRequests--;
            // Process next item in queue
            this._processQueue();
        }
    },

    /**
     * Execute a single API request
     */
    async _executeRequest(request) {
        const response = await fetch(request.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(request.body)
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `Backend Error: ${response.statusText}`);
        }

        return response.json();
    },

    /**
     * Add a request to the queue
     */
    _enqueue(request) {
        return new Promise((resolve, reject) => {
            this._queue.push({ request, resolve, reject });
            this._processQueue();
        });
    },

    /**
     * Analyze text using the Backend Proxy
     * @param {string} text - The text to analyze
     * @returns {Promise<Array>} - Array of found items
     */
    async analyzeText(text) {
        try {
            const result = await this._enqueue({
                url: this.BACKEND_URL,
                body: { text: text }
            });
            return result;
        } catch (error) {
            console.error('AI Analysis failed:', error);
            throw error;
        }
    },

    // Legacy support for app.js checks
    getApiKey() {
        return "backend-managed";
    },

    /**
     * Analyze image using Pixtral Vision (Backend)
     * @param {string} base64Image - Base64 encoded image
     * @param {number} pageNum - Page number (for logging)
     * @returns {Promise<Array>} - Array of signatures [{bounds: [y,x,y,x]}]
     */
    async analyzeImage(base64Image, pageNum) {
        try {
            const baseUrl = this.BACKEND_URL.replace('/api/analyze', '');
            const visionUrl = `${baseUrl}/api/analyze-image`;

            const result = await this._enqueue({
                url: visionUrl,
                body: {
                    image: base64Image,
                    pageNum: pageNum
                }
            });
            return result;
        } catch (error) {
            console.error('Vision Analysis failed:', error);
            // Non-blocking error for now
            return [];
        }
    }
};

// Auto-initialize when loaded
if (typeof window !== 'undefined') {
    MistralService.init();
}

// Export for Node.js testing
if (typeof module !== 'undefined') {
    module.exports = MistralService;
}
