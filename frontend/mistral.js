/**
 * AVG Anonimiseer - Mistral AI Service (Frontend)
 * Communicates with the Python Backend Proxy
 */

const MistralService = {
    // Default to localhost for dev, but this should be configured!
    // For Vercel/Render, you might want to hardcode the Render URL 
    // or use a relative path if deployed on same domain (unlikely here).
    // Backend URL (Update this after deploying backend)
    BACKEND_URL: 'https://avg-anonimiseer.onrender.com/api/analyze',

    /**
     * Analyze text using the Backend Proxy
     * @param {string} text - The text to analyze
     * @returns {Promise<Array>} - Array of found items
     */
    async analyzeText(text) {
        try {
            const response = await fetch(this.BACKEND_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ text: text })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.detail || `Backend Error: ${response.statusText}`);
            }

            const foundItems = await response.json();
            return foundItems;

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
            // New endpoint for vision
            // Assuming the base URL is the same domain/server
            const baseUrl = this.BACKEND_URL.replace('/api/analyze', '');
            const visionUrl = `${baseUrl}/api/analyze-image`;

            const response = await fetch(visionUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    image: base64Image,
                    pageNum: pageNum
                })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.detail || `Backend Vision Error: ${response.statusText}`);
            }

            const signatures = await response.json();
            return signatures;

        } catch (error) {
            console.error('Vision Analysis failed:', error);
            // Non-blocking error for now
            return [];
        }
    }
};

// Export for Node.js testing
if (typeof module !== 'undefined') {
    module.exports = MistralService;
}
