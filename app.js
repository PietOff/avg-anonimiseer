/**
 * AVG Anonimiseer - Main Application
 * Handles UI interactions, PDF rendering, and coordination between modules
 */

// Configure PDF.js - disable Web Workers for file:// protocol compatibility
// This allows the app to work when opened directly from the filesystem
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    // Disable worker entirely for file:// protocol
    pdfjsLib.disableWorker = true;
}

const App = {
    // State
    pdfDoc: null,           // PDF.js document
    pdfLibDoc: null,        // pdf-lib document
    currentPage: 1,
    totalPages: 0,
    scale: 1.0,
    currentTool: 'select',
    isDrawing: false,
    drawStart: null,

    // DOM Elements
    elements: {},

    /**
     * Initialize the application
     */
    init() {
        this.cacheElements();
        this.bindEvents();
        console.log('AVG Anonimiseer initialized');

        // Check if libraries are loaded
        if (typeof pdfjsLib === 'undefined') {
            console.error('PDF.js library not loaded!');
        }
        if (typeof PDFLib === 'undefined') {
            console.error('pdf-lib library not loaded!');
        }
    },

    /**
     * Cache DOM elements for performance
     */
    cacheElements() {
        this.elements = {
            // Upload zone
            uploadZone: document.getElementById('upload-zone'),
            fileInput: document.getElementById('file-input'),
            browseBtn: document.getElementById('browse-btn'),

            // Editor
            editor: document.getElementById('editor'),
            filename: document.getElementById('filename'),

            // Tools
            btnBack: document.getElementById('btn-back'),
            toolSelect: document.getElementById('tool-select'),
            toolRedact: document.getElementById('tool-redact'),
            btnDetect: document.getElementById('btn-detect'),
            btnExport: document.getElementById('btn-export'),
            btnClearMetadata: document.getElementById('btn-clear-metadata'),

            // PDF viewer
            pdfViewer: document.getElementById('pdf-viewer'),
            pdfCanvas: document.getElementById('pdf-canvas'),
            redactionLayer: document.getElementById('redaction-layer'),
            textLayer: document.getElementById('text-layer'),

            // Controls
            btnZoomIn: document.getElementById('btn-zoom-in'),
            btnZoomOut: document.getElementById('btn-zoom-out'),
            zoomLevel: document.getElementById('zoom-level'),
            btnPrevPage: document.getElementById('btn-prev-page'),
            btnNextPage: document.getElementById('btn-next-page'),
            currentPageEl: document.getElementById('current-page'),
            totalPagesEl: document.getElementById('total-pages'),

            // Sidebar
            detectionsList: document.getElementById('detections-list'),
            redactionsList: document.getElementById('redactions-list'),
            metadataInfo: document.getElementById('metadata-info'),

            // Modal
            modal: document.getElementById('detection-modal'),
            modalClose: document.getElementById('modal-close'),
            detectionProgress: document.getElementById('detection-progress'),
            detectionResults: document.getElementById('detection-results'),
            btnCancelDetection: document.getElementById('btn-cancel-detection'),
            btnApplyDetections: document.getElementById('btn-apply-detections')
        };
    },

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Upload zone
        this.elements.uploadZone.addEventListener('click', () => this.elements.fileInput.click());
        this.elements.browseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.elements.fileInput.click();
        });
        this.elements.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        // Drag and drop
        this.elements.uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.elements.uploadZone.classList.add('dragover');
        });
        this.elements.uploadZone.addEventListener('dragleave', () => {
            this.elements.uploadZone.classList.remove('dragover');
        });
        this.elements.uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.elements.uploadZone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                this.loadFile(e.dataTransfer.files[0]);
            }
        });

        // Toolbar
        this.elements.btnBack.addEventListener('click', () => this.resetToUpload());
        this.elements.toolSelect.addEventListener('click', () => this.setTool('select'));
        this.elements.toolRedact.addEventListener('click', () => this.setTool('redact'));
        this.elements.btnDetect.addEventListener('click', () => this.openDetectionModal());
        this.elements.btnExport.addEventListener('click', () => this.exportPDF());
        this.elements.btnClearMetadata.addEventListener('click', () => this.clearMetadata());

        // Zoom and navigation
        this.elements.btnZoomIn.addEventListener('click', () => this.zoom(0.25));
        this.elements.btnZoomOut.addEventListener('click', () => this.zoom(-0.25));
        this.elements.btnPrevPage.addEventListener('click', () => this.goToPage(this.currentPage - 1));
        this.elements.btnNextPage.addEventListener('click', () => this.goToPage(this.currentPage + 1));

        // Canvas interactions for manual redaction
        this.elements.pdfViewer.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.elements.pdfViewer.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.elements.pdfViewer.addEventListener('mouseup', (e) => this.handleMouseUp(e));

        // Modal
        this.elements.modalClose.addEventListener('click', () => this.closeModal());
        this.elements.btnCancelDetection.addEventListener('click', () => this.closeModal());
        this.elements.btnApplyDetections.addEventListener('click', () => this.applyDetections());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
    },

    /**
     * Handle file selection
     */
    handleFileSelect(event) {
        console.log('File select event triggered');
        console.log('Files:', event.target.files);
        const file = event.target.files[0];
        if (file) {
            console.log('File selected:', file.name);
            this.loadFile(file);
        } else {
            console.log('No file selected');
        }
    },

    /**
     * Load a file - routes to appropriate handler based on type
     */
    async loadFile(file) {
        console.log('Loading file:', file.name, 'Type:', file.type, 'Size:', file.size);

        const fileName = file.name.toLowerCase();
        const fileType = file.type.toLowerCase();

        // Determine file type and route to handler
        if (fileType.includes('pdf') || fileName.endsWith('.pdf')) {
            await this.loadPDF(file);
        } else if (fileType.includes('image') || fileName.match(/\.(jpg|jpeg|png|gif|webp)$/)) {
            await this.loadImage(file);
        } else if (fileType.includes('word') || fileName.match(/\.(docx|doc)$/)) {
            await this.loadDocx(file);
        } else {
            alert('Niet ondersteund bestandstype: ' + fileType + '\n\nOndersteund: PDF, Word (.docx), afbeeldingen (JPG/PNG)');
            return;
        }
    },

    /**
     * Load a PDF file
     */
    async loadPDF(file) {
        this.currentFileType = 'pdf';

        try {
            console.log('Reading file as ArrayBuffer...');
            const arrayBuffer = await file.arrayBuffer();
            console.log('ArrayBuffer size:', arrayBuffer.byteLength);

            // Create copies to ensure data isn't corrupted
            const pdfJsData = new Uint8Array(arrayBuffer);
            const pdfLibData = new Uint8Array(arrayBuffer.slice(0)); // Create independent copy

            console.log('Uint8Array for PDF.js length:', pdfJsData.length);
            console.log('Uint8Array for pdf-lib length:', pdfLibData.length);

            // Check PDF header
            const header = String.fromCharCode(...pdfJsData.slice(0, 8));
            console.log('PDF Header:', header);

            // Store file for later use
            this.currentFile = file;
            this.pdfLibData = pdfLibData;

            // Load with PDF.js for rendering
            console.log('Loading with PDF.js...');
            const loadingTask = pdfjsLib.getDocument({ data: pdfJsData });

            const self = this;
            loadingTask.promise.then(async function (pdfDoc) {
                console.log('PDF.js loaded successfully, pages:', pdfDoc.numPages);
                self.pdfDoc = pdfDoc;
                self.totalPages = pdfDoc.numPages;

                // Update UI FIRST - show the editor even before Redactor init
                self.elements.filename.textContent = file.name;
                self.elements.totalPagesEl.textContent = self.totalPages;
                self.showEditor();
                console.log('UI updated, showing editor');

                // Render first page
                console.log('Rendering first page...');
                await self.renderPage(1);
                console.log('First page rendered');

                // Initialize Redactor with pdf-lib (separate try/catch)
                try {
                    console.log('Initializing Redactor with pdf-lib...');
                    console.log('pdf-lib data header:', String.fromCharCode(...self.pdfLibData.slice(0, 8)));
                    await Redactor.init(self.pdfLibData);
                    console.log('Redactor initialized successfully');

                    // Load metadata only if Redactor worked
                    await self.displayMetadata();
                } catch (redactorError) {
                    console.error('Redactor init error (non-fatal):', redactorError.message);
                    // Show warning but continue - viewing still works
                    self.elements.metadataInfo.innerHTML = '<p class="empty-state">Redactie tijdelijk niet beschikbaar</p>';
                }

                console.log('PDF fully loaded and displayed');

            }).catch(function (error) {
                console.error('PDF.js error:', error);
                alert('Fout bij het laden van de PDF: ' + error.message);
            });

        } catch (error) {
            console.error('Error loading PDF:', error);
            console.error('Error stack:', error.stack);
            alert('Fout bij het laden van de PDF: ' + error.message);
        }
    },

    /**
     * Load an image file (JPG/PNG)
     */
    async loadImage(file) {
        this.currentFileType = 'image';
        console.log('Loading image:', file.name);

        try {
            const imageUrl = URL.createObjectURL(file);
            const img = new Image();

            img.onload = () => {
                console.log('Image loaded:', img.width, 'x', img.height);

                // Store image for later
                this.currentImage = img;
                this.pdfDoc = null;
                this.totalPages = 1;
                this.currentPage = 1;

                // Update UI
                this.elements.filename.textContent = file.name;
                this.elements.totalPagesEl.textContent = '1';
                this.showEditor();

                // Render image to canvas
                this.renderImage();

                // Clear Redactor state
                Redactor.clearRedactions();
                this.updateRedactionsList();

                // Update metadata display
                this.elements.metadataInfo.innerHTML = `
                    <div class="metadata-row">
                        <span class="metadata-label">Formaat:</span>
                        <span class="metadata-value">${file.type}</span>
                    </div>
                    <div class="metadata-row">
                        <span class="metadata-label">Afmetingen:</span>
                        <span class="metadata-value">${img.width} × ${img.height}px</span>
                    </div>
                `;

                console.log('Image fully loaded');
            };

            img.onerror = () => {
                alert('Fout bij het laden van de afbeelding');
            };

            img.src = imageUrl;

        } catch (error) {
            console.error('Error loading image:', error);
            alert('Fout bij het laden van de afbeelding: ' + error.message);
        }
    },

    /**
     * Render the current image to canvas
     */
    renderImage() {
        if (!this.currentImage) return;

        const canvas = this.elements.pdfCanvas;
        const ctx = canvas.getContext('2d');

        // Apply scale
        const width = this.currentImage.width * this.scale;
        const height = this.currentImage.height * this.scale;

        canvas.width = width;
        canvas.height = height;

        ctx.drawImage(this.currentImage, 0, 0, width, height);

        // Re-render redactions
        this.renderRedactions();
    },

    /**
     * Load a DOCX file
     */
    async loadDocx(file) {
        this.currentFileType = 'docx';
        console.log('Loading DOCX:', file.name);

        try {
            const arrayBuffer = await file.arrayBuffer();

            // Convert to HTML using mammoth
            console.log('Converting DOCX with mammoth.js...');
            const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer });

            console.log('DOCX converted, HTML length:', result.value.length);
            if (result.messages.length > 0) {
                console.log('Mammoth messages:', result.messages);
            }

            // Store for later
            this.docxHtml = result.value;
            this.pdfDoc = null;
            this.currentImage = null;
            this.totalPages = 1;
            this.currentPage = 1;

            // Update UI
            this.elements.filename.textContent = file.name;
            this.elements.totalPagesEl.textContent = '1';
            this.showEditor();

            // Render DOCX content
            this.renderDocx();

            // Clear Redactor state
            Redactor.clearRedactions();
            this.updateRedactionsList();

            // Update metadata
            this.elements.metadataInfo.innerHTML = `
                <div class="metadata-row">
                    <span class="metadata-label">Formaat:</span>
                    <span class="metadata-value">Word Document</span>
                </div>
            `;

            console.log('DOCX fully loaded');

        } catch (error) {
            console.error('Error loading DOCX:', error);
            alert('Fout bij het laden van Word document: ' + error.message);
        }
    },

    /**
     * Render DOCX content
     */
    renderDocx() {
        if (!this.docxHtml) return;

        const canvas = this.elements.pdfCanvas;
        const ctx = canvas.getContext('2d');

        // Create a temporary container for the HTML
        const container = document.createElement('div');
        container.style.cssText = `
            position: absolute;
            left: -9999px;
            width: 800px;
            padding: 40px;
            background: white;
            font-family: 'Inter', sans-serif;
            font-size: 14px;
            line-height: 1.6;
        `;
        container.innerHTML = this.docxHtml;
        document.body.appendChild(container);

        // Get dimensions
        const width = 800;
        const height = Math.max(600, container.scrollHeight);

        // Set canvas size
        canvas.width = width * this.scale;
        canvas.height = height * this.scale;

        // Draw white background
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Use foreignObject to render HTML to canvas
        const svgData = `
            <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
                <foreignObject width="100%" height="100%">
                    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: sans-serif; font-size: 14px; padding: 40px; line-height: 1.6;">
                        ${this.docxHtml}
                    </div>
                </foreignObject>
            </svg>
        `;

        const img = new Image();
        const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        img.onload = () => {
            ctx.scale(this.scale, this.scale);
            ctx.drawImage(img, 0, 0);
            ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
            URL.revokeObjectURL(url);
            this.renderRedactions();
        };

        img.onerror = () => {
            // Fallback: just show placeholder
            ctx.fillStyle = '#333';
            ctx.font = '16px Inter, sans-serif';
            ctx.fillText('Word document geladen - ', 40, 60);
            ctx.fillText('Redacties kunnen worden toegevoegd', 40, 85);
            this.renderRedactions();
        };

        img.src = url;
        document.body.removeChild(container);
    },

    /**
     * Show editor, hide upload zone
     */
    showEditor() {
        this.elements.uploadZone.classList.add('hidden');
        this.elements.editor.classList.remove('hidden');
        document.querySelector('.info-panel').classList.add('hidden');
    },

    /**
     * Reset to upload view
     */
    resetToUpload() {
        this.elements.editor.classList.add('hidden');
        this.elements.uploadZone.classList.remove('hidden');
        document.querySelector('.info-panel').classList.remove('hidden');

        this.pdfDoc = null;
        this.currentPage = 1;
        this.scale = 1.0;
        Redactor.clearRedactions();
        this.elements.fileInput.value = '';
        this.updateRedactionsList();
    },

    /**
     * Render a specific page
     */
    async renderPage(pageNumber) {
        if (!this.pdfDoc || pageNumber < 1 || pageNumber > this.totalPages) return;

        this.currentPage = pageNumber;
        this.elements.currentPageEl.textContent = pageNumber;

        const page = await this.pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: this.scale });

        const canvas = this.elements.pdfCanvas;
        const context = canvas.getContext('2d');

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        // Clear canvas
        context.clearRect(0, 0, canvas.width, canvas.height);

        // Render PDF page
        await page.render({
            canvasContext: context,
            viewport: viewport
        }).promise;

        // Update redaction layer
        this.renderRedactions();
    },

    /**
     * Render redaction boxes
     */
    renderRedactions() {
        this.elements.redactionLayer.innerHTML = '';

        const redactions = Redactor.getPageRedactions(this.currentPage);
        const canvas = this.elements.pdfCanvas;

        // Position layer over canvas
        const canvasRect = canvas.getBoundingClientRect();
        const viewerRect = this.elements.pdfViewer.getBoundingClientRect();

        this.elements.redactionLayer.style.left = (canvas.offsetLeft) + 'px';
        this.elements.redactionLayer.style.top = (canvas.offsetTop) + 'px';
        this.elements.redactionLayer.style.width = canvas.width + 'px';
        this.elements.redactionLayer.style.height = canvas.height + 'px';

        for (const redaction of redactions) {
            const box = document.createElement('div');
            box.className = 'redaction-box';
            box.dataset.id = redaction.id;

            // Convert PDF coords to canvas coords
            const pageHeight = this.pdfDoc ? 842 : 800; // Approximate A4 height
            const canvasBounds = Redactor.pdfToCanvasCoords(
                redaction.bounds,
                pageHeight,
                this.scale
            );

            box.style.left = canvasBounds.x + 'px';
            box.style.top = canvasBounds.y + 'px';
            box.style.width = canvasBounds.width + 'px';
            box.style.height = canvasBounds.height + 'px';

            // Double-click to remove
            box.addEventListener('dblclick', () => {
                Redactor.removeRedaction(redaction.id);
                this.renderRedactions();
                this.updateRedactionsList();
            });

            this.elements.redactionLayer.appendChild(box);
        }
    },

    /**
     * Set current tool
     */
    setTool(tool) {
        this.currentTool = tool;
        this.elements.toolSelect.classList.toggle('active', tool === 'select');
        this.elements.toolRedact.classList.toggle('active', tool === 'redact');

        this.elements.pdfViewer.style.cursor = tool === 'redact' ? 'crosshair' : 'default';
    },

    /**
     * Handle mouse down for drawing redactions
     */
    handleMouseDown(event) {
        if (this.currentTool !== 'redact') return;

        const rect = this.elements.pdfCanvas.getBoundingClientRect();
        this.isDrawing = true;
        this.drawStart = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };

        // Create preview box
        const preview = document.createElement('div');
        preview.className = 'redaction-box preview';
        preview.id = 'redaction-preview';
        preview.style.left = this.drawStart.x + 'px';
        preview.style.top = this.drawStart.y + 'px';
        this.elements.redactionLayer.appendChild(preview);
    },

    /**
     * Handle mouse move for drawing
     */
    handleMouseMove(event) {
        if (!this.isDrawing) return;

        const rect = this.elements.pdfCanvas.getBoundingClientRect();
        const currentX = event.clientX - rect.left;
        const currentY = event.clientY - rect.top;

        const preview = document.getElementById('redaction-preview');
        if (preview) {
            const width = currentX - this.drawStart.x;
            const height = currentY - this.drawStart.y;

            preview.style.left = (width < 0 ? currentX : this.drawStart.x) + 'px';
            preview.style.top = (height < 0 ? currentY : this.drawStart.y) + 'px';
            preview.style.width = Math.abs(width) + 'px';
            preview.style.height = Math.abs(height) + 'px';
        }
    },

    /**
     * Handle mouse up - finalize redaction
     */
    handleMouseUp(event) {
        if (!this.isDrawing) return;
        this.isDrawing = false;

        const preview = document.getElementById('redaction-preview');
        if (preview) {
            const bounds = {
                x: parseFloat(preview.style.left),
                y: parseFloat(preview.style.top),
                width: parseFloat(preview.style.width),
                height: parseFloat(preview.style.height)
            };

            preview.remove();

            // Only create redaction if it has some size
            if (bounds.width > 5 && bounds.height > 5) {
                // Convert to PDF coordinates
                const pageHeight = 842; // A4 height in points
                const pdfBounds = Redactor.canvasToPdfCoords(bounds, pageHeight, this.scale);

                Redactor.addRedaction(this.currentPage, pdfBounds, 'manual');
                this.renderRedactions();
                this.updateRedactionsList();
            }
        }
    },

    /**
     * Zoom in/out
     */
    zoom(delta) {
        this.scale = Math.max(0.5, Math.min(3, this.scale + delta));
        this.elements.zoomLevel.textContent = Math.round(this.scale * 100) + '%';

        // Re-render based on file type
        if (this.currentFileType === 'image') {
            this.renderImage();
        } else if (this.currentFileType === 'docx') {
            this.renderDocx();
        } else {
            this.renderPage(this.currentPage);
        }
    },

    /**
     * Go to page
     */
    goToPage(pageNumber) {
        if (pageNumber >= 1 && pageNumber <= this.totalPages) {
            this.renderPage(pageNumber);
        }
    },

    /**
     * Display PDF metadata
     */
    async displayMetadata() {
        const metadata = await Redactor.getMetadata();
        if (!metadata) {
            this.elements.metadataInfo.innerHTML = '<p class="empty-state">Geen metadata gevonden</p>';
            return;
        }

        const fields = [
            { label: 'Titel', value: metadata.title },
            { label: 'Auteur', value: metadata.author },
            { label: 'Gemaakt', value: metadata.creationDate ? new Date(metadata.creationDate).toLocaleDateString('nl-NL') : '' },
            { label: 'Producer', value: metadata.producer }
        ];

        const hasMetadata = fields.some(f => f.value);

        if (!hasMetadata) {
            this.elements.metadataInfo.innerHTML = '<p class="empty-state">Geen metadata gevonden</p>';
            return;
        }

        this.elements.metadataInfo.innerHTML = fields
            .filter(f => f.value)
            .map(f => `
                <div class="metadata-row">
                    <span class="metadata-label">${f.label}:</span>
                    <span class="metadata-value">${f.value}</span>
                </div>
            `).join('');
    },

    /**
     * Clear metadata
     */
    async clearMetadata() {
        await Redactor.clearMetadata();
        this.elements.metadataInfo.innerHTML = `
            <div class="metadata-row">
                <span class="metadata-value redacted">✓ Metadata gewist</span>
            </div>
        `;
    },

    /**
     * Update redactions list in sidebar
     */
    updateRedactionsList() {
        const redactions = Redactor.getAllRedactions();

        if (redactions.length === 0) {
            this.elements.redactionsList.innerHTML = '<p class="empty-state">Nog geen redacties toegevoegd</p>';
            return;
        }

        // Add header with clear all button
        let html = `
            <div class="redactions-header">
                <span>${redactions.length} redactie(s)</span>
                <button class="btn-clear-all" title="Wis alle redacties">🗑️ Wis alle</button>
            </div>
        `;

        // Add each redaction with delete button
        html += redactions.map(r => `
            <div class="redaction-item" data-id="${r.id}" data-page="${r.pageNumber}">
                <div class="redaction-info">
                    <span class="type">${r.type === 'manual' ? '✏️' : '🔍'}</span>
                    <span class="value">${r.value || 'Handmatig'}</span>
                    <span class="page">P${r.pageNumber}</span>
                </div>
                <button class="btn-delete-redaction" data-id="${r.id}" title="Verwijder">✕</button>
            </div>
        `).join('');

        this.elements.redactionsList.innerHTML = html;

        // Click item to navigate
        this.elements.redactionsList.querySelectorAll('.redaction-info').forEach(info => {
            info.addEventListener('click', () => {
                const item = info.closest('.redaction-item');
                this.goToPage(parseInt(item.dataset.page));
            });
        });

        // Delete button handler
        this.elements.redactionsList.querySelectorAll('.btn-delete-redaction').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                Redactor.removeRedaction(id);
                this.renderRedactions();
                this.updateRedactionsList();
            });
        });

        // Clear all button handler
        const clearAllBtn = this.elements.redactionsList.querySelector('.btn-clear-all');
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => {
                if (confirm('Weet je zeker dat je alle redacties wilt verwijderen?')) {
                    Redactor.clearRedactions();
                    this.renderRedactions();
                    this.updateRedactionsList();
                }
            });
        }
    },

    /**
     * Open detection modal
     */
    async openDetectionModal() {
        this.elements.modal.classList.remove('hidden');
        this.elements.detectionProgress.classList.remove('hidden');
        this.elements.detectionResults.classList.add('hidden');
        this.elements.btnApplyDetections.classList.add('hidden');

        // Run detection
        await this.runDetection();
    },

    /**
     * Close modal
     */
    closeModal() {
        this.elements.modal.classList.add('hidden');
    },

    /**
     * Run automatic detection
     */
    async runDetection() {
        const allDetections = {
            byCategory: {},
            all: [],
            stats: { total: 0, categories: 0 }
        };

        // Store text item positions for each page
        this.textItemsPerPage = new Map();

        // Extract text from each page with position information
        for (let i = 1; i <= this.totalPages; i++) {
            const page = await this.pdfDoc.getPage(i);
            const textContent = await page.getTextContent();
            const viewport = page.getViewport({ scale: 1 });

            // Store text items with their positions for this page
            const textItems = textContent.items.map(item => ({
                str: item.str,
                // PDF.js transform: [scaleX, skewY, skewX, scaleY, translateX, translateY]
                x: item.transform[4],
                y: item.transform[5],
                width: item.width,
                height: item.height || Math.abs(item.transform[0]) || 12, // Fallback to font size
                fontHeight: Math.abs(item.transform[0]) || 12
            }));
            this.textItemsPerPage.set(i, textItems);

            // Build combined text with position tracking
            let combinedText = '';
            const positionMap = []; // Maps character index to text item

            for (let j = 0; j < textItems.length; j++) {
                const item = textItems[j];
                const startPos = combinedText.length;
                combinedText += item.str;
                const endPos = combinedText.length;

                // Map each character position to this text item
                positionMap.push({
                    startPos,
                    endPos,
                    item,
                    itemIndex: j
                });

                combinedText += ' '; // Add space between items
            }

            const pageDetections = Detector.detect(combinedText, i);

            // Enhance detections with position information
            for (const detection of pageDetections.all) {
                // Find which text item(s) contain this detection
                const bounds = this.findTextBounds(detection.value, detection.startIndex, positionMap, textItems, viewport);
                if (bounds) {
                    detection.bounds = bounds;
                }
            }

            // Merge results
            for (const [category, data] of Object.entries(pageDetections.byCategory)) {
                if (!allDetections.byCategory[category]) {
                    allDetections.byCategory[category] = {
                        name: data.name,
                        icon: data.icon,
                        items: []
                    };
                }
                allDetections.byCategory[category].items.push(...data.items);
            }
            allDetections.all.push(...pageDetections.all);
        }

        allDetections.stats.total = allDetections.all.length;
        allDetections.stats.categories = Object.keys(allDetections.byCategory).length;

        // Store for later application
        this.currentDetections = allDetections;

        // Display results
        this.displayDetectionResults(allDetections);
    },

    /**
     * Find the bounding box for detected text based on PDF text items
     */
    findTextBounds(searchValue, startIndex, positionMap, textItems, viewport) {
        // Find text items that contain the detection
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        let found = false;

        const searchLower = searchValue.toLowerCase().trim();

        // Skip empty or very short search values
        if (searchLower.length < 2) {
            return null;
        }

        // Strategy 1: Find exact match or significant overlap
        // Build the full text and track positions
        let fullText = '';
        const itemPositions = [];

        for (let i = 0; i < textItems.length; i++) {
            const item = textItems[i];
            const startPos = fullText.length;
            fullText += item.str;
            const endPos = fullText.length;
            itemPositions.push({ startPos, endPos, item });
            fullText += ' ';
        }

        // Find the search value in the full text
        const fullTextLower = fullText.toLowerCase();
        const matchIndex = fullTextLower.indexOf(searchLower);

        if (matchIndex !== -1) {
            const matchEnd = matchIndex + searchLower.length;

            // Find which text items overlap with this match
            for (const pos of itemPositions) {
                // Check if this item overlaps with the match range
                if (pos.endPos > matchIndex && pos.startPos < matchEnd) {
                    found = true;
                    const item = pos.item;
                    const x = item.x;
                    const y = item.y;
                    const width = item.width || (item.str.length * item.fontHeight * 0.6);
                    const height = item.fontHeight || 12;

                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x + width);
                    maxY = Math.max(maxY, y + height);
                }
            }
        }

        // Strategy 2: Direct item match (for items that contain the full value)
        if (!found) {
            for (let i = 0; i < textItems.length; i++) {
                const item = textItems[i];
                const itemText = item.str.toLowerCase().trim();

                // Only match if the item contains the search value OR 
                // the search value equals this item exactly
                if (itemText.length >= 3 && itemText.includes(searchLower)) {
                    found = true;
                    const x = item.x;
                    const y = item.y;
                    const width = item.width || (item.str.length * item.fontHeight * 0.6);
                    const height = item.fontHeight || 12;

                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x + width);
                    maxY = Math.max(maxY, y + height);
                }
            }
        }

        if (!found || minX === Infinity) {
            return null;
        }

        // Sanity check: bounds should not be larger than reasonable
        const maxWidth = 500; // Max reasonable width for a single redaction
        const maxHeight = 50; // Max reasonable height

        let width = maxX - minX;
        let height = maxY - minY;

        if (width > maxWidth || height > maxHeight) {
            // Bounds are too large, something went wrong
            // Fall back to estimating from search value length
            return {
                x: minX,
                y: minY,
                width: Math.min(width, searchValue.length * 8),
                height: Math.min(height, 16)
            };
        }

        // Add some padding
        const padding = 2;
        return {
            x: minX - padding,
            y: minY - padding,
            width: width + (padding * 2),
            height: height + (padding * 2)
        };
    },

    /**
     * Display detection results in modal
     */
    displayDetectionResults(detections) {
        this.elements.detectionProgress.classList.add('hidden');
        this.elements.detectionResults.classList.remove('hidden');

        if (detections.stats.total === 0) {
            this.elements.detectionResults.innerHTML = `
                <div style="text-align: center; padding: 2rem;">
                    <p style="font-size: 3rem; margin-bottom: 1rem;">✅</p>
                    <p>Geen persoonsgegevens gedetecteerd!</p>
                    <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.5rem;">
                        Tip: Controleer handmatig op indirecte identificatoren.
                    </p>
                </div>
            `;
            return;
        }

        this.elements.btnApplyDetections.classList.remove('hidden');

        let html = `
            <p style="margin-bottom: 1rem; color: var(--text-secondary);">
                ${detections.stats.total} item(s) gevonden in ${detections.stats.categories} categorie(ën)
            </p>
        `;

        for (const [category, data] of Object.entries(detections.byCategory)) {
            html += `
                <div class="detection-category">
                    <div class="detection-category-header">
                        <span class="detection-category-title">
                            ${data.icon} ${data.name}
                        </span>
                        <span class="detection-count">${data.items.length}</span>
                    </div>
                    <div class="detection-category-items">
                        ${data.items.map((item, idx) => `
                            <label class="detection-check-item">
                                <input type="checkbox" 
                                       data-category="${category}" 
                                       data-index="${idx}"
                                       ${item.selected ? 'checked' : ''}>
                                <span class="value">${this.maskValue(item.value)}</span>
                                <span class="page">P${item.page}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        this.elements.detectionResults.innerHTML = html;
    },

    /**
     * Mask part of sensitive value for display
     */
    maskValue(value) {
        if (value.length <= 4) return value;
        const visible = Math.min(4, Math.floor(value.length / 3));
        return value.substring(0, visible) + '•'.repeat(value.length - visible);
    },

    /**
     * Apply selected detections as redactions
     */
    async applyDetections() {
        const checkboxes = this.elements.detectionResults.querySelectorAll('input[type="checkbox"]:checked');

        for (const checkbox of checkboxes) {
            const category = checkbox.dataset.category;
            const index = parseInt(checkbox.dataset.index);
            const item = this.currentDetections.byCategory[category].items[index];

            // Use the actual bounds from text detection if available
            let bounds;
            if (item.bounds) {
                bounds = item.bounds;
            } else {
                // Fallback: try to find bounds now if not stored
                const textItems = this.textItemsPerPage?.get(item.page);
                if (textItems) {
                    bounds = this.findTextBoundsFromItems(item.value, textItems);
                }

                // Ultimate fallback with reasonable defaults
                if (!bounds) {
                    bounds = {
                        x: 50,
                        y: 750 - (index * 20),
                        width: Math.max(item.value.length * 8, 50),
                        height: 16
                    };
                }
            }

            Redactor.addRedaction(item.page, bounds, item.type, item.value);
        }

        this.renderRedactions();
        this.updateRedactionsList();
        this.updateDetectionsList();
        this.closeModal();
    },

    /**
     * Find text bounds from stored text items (fallback method)
     */
    findTextBoundsFromItems(searchValue, textItems) {
        const searchLower = searchValue.toLowerCase();

        for (const item of textItems) {
            if (item.str.toLowerCase().includes(searchLower) ||
                searchLower.includes(item.str.toLowerCase().trim())) {
                const width = item.width || (item.str.length * item.fontHeight * 0.6);
                return {
                    x: item.x - 2,
                    y: item.y - 2,
                    width: Math.max(width, searchValue.length * 8) + 4,
                    height: item.fontHeight + 4
                };
            }
        }
        return null;
    },

    /**
     * Update detections list in sidebar
     */
    updateDetectionsList() {
        if (!this.currentDetections || this.currentDetections.stats.total === 0) {
            this.elements.detectionsList.innerHTML = '<p class="empty-state">Klik op "Auto-detectie" om te scannen</p>';
            return;
        }

        const applied = Redactor.getAllRedactions().length;
        this.elements.detectionsList.innerHTML = `
            <p style="font-size: 0.85rem; margin-bottom: 0.5rem;">
                ${this.currentDetections.stats.total} gevonden, ${applied} geredacteerd
            </p>
        `;
    },

    /**
     * Export redacted PDF
     */
    async exportPDF() {
        try {
            this.elements.btnExport.disabled = true;
            this.elements.btnExport.innerHTML = '<span class="spinner" style="width: 16px; height: 16px;"></span> Bezig...';

            const pdfBytes = await Redactor.exportRedactedPDF();

            // Create download
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'geanonimiseerd_' + this.elements.filename.textContent;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

        } catch (error) {
            console.error('Export error:', error);
            alert('Fout bij exporteren. Probeer het opnieuw.');
        } finally {
            this.elements.btnExport.disabled = false;
            this.elements.btnExport.innerHTML = '<span>💾</span> Exporteer veilige PDF';
        }
    },

    /**
     * Handle keyboard shortcuts
     */
    handleKeyboard(event) {
        // Escape to close modal
        if (event.key === 'Escape') {
            this.closeModal();
        }

        // Arrow keys for navigation
        if (event.key === 'ArrowLeft') {
            this.goToPage(this.currentPage - 1);
        } else if (event.key === 'ArrowRight') {
            this.goToPage(this.currentPage + 1);
        }

        // Ctrl/Cmd + S to export
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
            event.preventDefault();
            this.exportPDF();
        }
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
