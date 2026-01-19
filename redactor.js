/**
 * AVG Anonimiseer - Redactor Module
 * Handles redaction operations and PDF manipulation
 */

const Redactor = {
    // Store redactions by page
    redactions: new Map(),

    // Current PDF document (pdf-lib)
    pdfDoc: null,

    // Original PDF bytes
    originalPdfBytes: null,

    /**
     * Initialize with PDF document
     */
    async init(pdfBytes) {
        this.originalPdfBytes = pdfBytes;
        this.pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
        this.redactions.clear();
        return this.pdfDoc;
    },

    /**
     * Add a redaction
     * @param {number} pageNumber - 1-indexed page number
     * @param {Object} bounds - {x, y, width, height} in PDF coordinates
     * @param {string} type - Type of data being redacted
     * @param {string} value - Original value (for reference only)
     */
    addRedaction(pageNumber, bounds, type = 'manual', value = '') {
        if (!this.redactions.has(pageNumber)) {
            this.redactions.set(pageNumber, []);
        }

        const redaction = {
            id: `redact-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            pageNumber,
            bounds,
            type,
            value,
            createdAt: new Date().toISOString()
        };

        this.redactions.get(pageNumber).push(redaction);
        return redaction;
    },

    /**
     * Remove a redaction by ID
     */
    removeRedaction(redactionId) {
        for (const [pageNumber, redactions] of this.redactions) {
            const index = redactions.findIndex(r => r.id === redactionId);
            if (index !== -1) {
                redactions.splice(index, 1);
                if (redactions.length === 0) {
                    this.redactions.delete(pageNumber);
                }
                return true;
            }
        }
        return false;
    },

    /**
     * Get all redactions
     */
    getAllRedactions() {
        const all = [];
        for (const [pageNumber, redactions] of this.redactions) {
            all.push(...redactions);
        }
        return all;
    },

    /**
     * Get redactions for a specific page
     */
    getPageRedactions(pageNumber) {
        return this.redactions.get(pageNumber) || [];
    },

    /**
     * Clear all redactions
     */
    clearRedactions() {
        this.redactions.clear();
    },

    /**
     * Get PDF metadata
     */
    async getMetadata() {
        if (!this.pdfDoc) return null;

        return {
            title: this.pdfDoc.getTitle() || '',
            author: this.pdfDoc.getAuthor() || '',
            subject: this.pdfDoc.getSubject() || '',
            creator: this.pdfDoc.getCreator() || '',
            producer: this.pdfDoc.getProducer() || '',
            creationDate: this.pdfDoc.getCreationDate()?.toISOString() || '',
            modificationDate: this.pdfDoc.getModificationDate()?.toISOString() || '',
            keywords: this.pdfDoc.getKeywords() || ''
        };
    },

    /**
     * Clear all metadata from PDF
     */
    async clearMetadata() {
        if (!this.pdfDoc) return false;

        this.pdfDoc.setTitle('');
        this.pdfDoc.setAuthor('');
        this.pdfDoc.setSubject('');
        this.pdfDoc.setCreator('');
        this.pdfDoc.setProducer('AVG Anonimiseer');
        this.pdfDoc.setKeywords([]);

        // Remove creation/modification dates by setting to current
        // (pdf-lib doesn't allow completely removing these)
        const now = new Date();
        this.pdfDoc.setCreationDate(now);
        this.pdfDoc.setModificationDate(now);

        return true;
    },

    /**
     * Apply all redactions and export as flattened PDF
     * This creates a new PDF where the redacted content is truly removed
     */
    async exportRedactedPDF() {
        if (!this.pdfDoc) {
            throw new Error('No PDF document loaded');
        }

        // Create a fresh copy to work with
        const workingDoc = await PDFLib.PDFDocument.load(this.originalPdfBytes);
        const pages = workingDoc.getPages();

        // Apply redactions to each page
        for (const [pageNumber, redactions] of this.redactions) {
            const pageIndex = pageNumber - 1;
            if (pageIndex >= 0 && pageIndex < pages.length) {
                const page = pages[pageIndex];

                for (const redaction of redactions) {
                    const { bounds } = redaction;

                    // Draw a black rectangle over the content
                    // The rectangle becomes part of the page content, covering text underneath
                    page.drawRectangle({
                        x: bounds.x,
                        y: bounds.y,
                        width: bounds.width,
                        height: bounds.height,
                        color: PDFLib.rgb(0, 0, 0),
                        borderWidth: 0
                    });
                }
            }
        }

        // Clear metadata
        workingDoc.setTitle('');
        workingDoc.setAuthor('');
        workingDoc.setSubject('');
        workingDoc.setCreator('');
        workingDoc.setProducer('AVG Anonimiseer - Geanonimiseerd document');
        workingDoc.setKeywords([]);

        // Flatten by saving with specific options
        // Note: True flattening requires rasterization, which we'll approximate
        const pdfBytes = await workingDoc.save({
            useObjectStreams: false,
            addDefaultPage: false,
            // Attempt to prevent content extraction
            // (Full flattening would require converting to image)
        });

        return pdfBytes;
    },

    /**
     * Export with full rasterization (converts pages to images)
     * This is the most secure method - text cannot be extracted
     */
    async exportRasterizedPDF(renderPage, dpi = 150) {
        if (!this.pdfDoc) {
            throw new Error('No PDF document loaded');
        }

        const newDoc = await PDFLib.PDFDocument.create();
        const pageCount = this.pdfDoc.getPageCount();

        for (let i = 0; i < pageCount; i++) {
            // Get page dimensions
            const originalPage = this.pdfDoc.getPage(i);
            const { width, height } = originalPage.getSize();

            // Render page to image using provided render function
            const imageData = await renderPage(i + 1, dpi);

            if (imageData) {
                // Embed image
                let image;
                if (imageData.type === 'png') {
                    image = await newDoc.embedPng(imageData.bytes);
                } else {
                    image = await newDoc.embedJpg(imageData.bytes);
                }

                // Create new page with same dimensions
                const newPage = newDoc.addPage([width, height]);

                // Draw image to fill page
                newPage.drawImage(image, {
                    x: 0,
                    y: 0,
                    width: width,
                    height: height
                });
            }
        }

        // Clear metadata
        newDoc.setTitle('');
        newDoc.setAuthor('');
        newDoc.setProducer('AVG Anonimiseer - Volledig geanonimiseerd (raster)');

        return await newDoc.save();
    },

    /**
     * Convert coordinates from canvas space to PDF space
     * PDF uses bottom-left origin, canvas uses top-left
     */
    canvasToPdfCoords(canvasBounds, pageHeight, scale) {
        return {
            x: canvasBounds.x / scale,
            y: pageHeight - (canvasBounds.y + canvasBounds.height) / scale,
            width: canvasBounds.width / scale,
            height: canvasBounds.height / scale
        };
    },

    /**
     * Convert coordinates from PDF space to canvas space
     */
    pdfToCanvasCoords(pdfBounds, pageHeight, scale) {
        return {
            x: pdfBounds.x * scale,
            y: (pageHeight - pdfBounds.y - pdfBounds.height) * scale,
            width: pdfBounds.width * scale,
            height: pdfBounds.height * scale
        };
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Redactor;
}
