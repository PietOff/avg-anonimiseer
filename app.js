/**
 * AVG Anonimiseer - Main Application
 * Handles UI interactions, PDF rendering, and coordination between modules
 * 
 * Features:
 * - Continuous scrolling (all pages visible)
 * - Feedback loop (learns from manual redactions)
 * - Automatic signature detection
 */

// Configure PDF.js - disable Web Workers for file:// protocol compatibility
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    pdfjsLib.disableWorker = true;
}

const App = {
    // State
    pdfDoc: null,
    pdfLibDoc: null,
    currentPage: 1,
    totalPages: 0,
    scale: 1.0,
    currentTool: 'select',
    isDrawing: false,
    drawStart: null,

    // Page canvases for continuous scrolling
    pageCanvases: [],
    pageContainers: [],


    // learnedWords/ignoredWords are now managed by Detector module

    // DOM Elements
    elements: {},

    /**
     * Initialize the application
     */
    init() {
        this.cacheElements();
        this.bindEvents();
        this.bindSearchEvents();
        console.log('AVG Anonimiseer initialized');

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
            btnExport: document.getElementById('btn-export'),
            btnClearMetadata: document.getElementById('btn-clear-metadata'),
            btnClearLearning: document.getElementById('btn-clear-learning'),

            // PDF viewer
            pdfViewer: document.getElementById('pdf-viewer'),
            pagesContainer: document.getElementById('pages-container'),

            // Controls
            btnZoomIn: document.getElementById('btn-zoom-in'),
            btnZoomOut: document.getElementById('btn-zoom-out'),
            zoomLevel: document.getElementById('zoom-level'),
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
        this.elements.btnExport.addEventListener('click', () => this.exportPDF());
        this.elements.btnClearMetadata.addEventListener('click', () => this.clearMetadata());
        this.elements.btnClearLearning?.addEventListener('click', () => this.clearLearnedData());

        // Zoom
        this.elements.btnZoomIn.addEventListener('click', () => this.zoom(0.25));
        this.elements.btnZoomOut.addEventListener('click', () => this.zoom(-0.25));

        // Scroll tracking for page indicator
        if (this.elements.pdfViewer) {
            this.elements.pdfViewer.addEventListener('scroll', () => this.updateCurrentPageFromScroll());
        }

        // Modal
        this.elements.modalClose.addEventListener('click', () => this.closeModal());
        this.elements.btnCancelDetection.addEventListener('click', () => this.closeModal());
        this.elements.btnApplyDetections.addEventListener('click', () => this.applyDetections());

        // Window resize
        window.addEventListener('resize', () => {
            if (this.pdfDoc) {
                this.renderAllRedactions();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
    },

    /**
     * Handle file selection
     */
    handleFileSelect(event) {
        const file = event.target.files[0];
        if (file) {
            this.loadFile(file);
        }
    },

    /**
     * Load a file
     */
    async loadFile(file) {
        const fileName = file.name.toLowerCase();
        const fileType = file.type.toLowerCase();

        if (fileType.includes('pdf') || fileName.endsWith('.pdf')) {
            await this.loadPDF(file);
        } else if (fileType.includes('image') || fileName.match(/\.(jpg|jpeg|png|gif|webp)$/)) {
            await this.loadImage(file);
        } else {
            alert('Niet ondersteund bestandstype.\n\nOndersteund: PDF, afbeeldingen (JPG/PNG)');
        }
    },

    /**
     * Load a PDF file with continuous scrolling
     */
    async loadPDF(file) {
        this.currentFileType = 'pdf';

        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdfJsData = new Uint8Array(arrayBuffer);
            const pdfLibData = new Uint8Array(arrayBuffer.slice(0));

            this.currentFile = file;
            this.pdfLibData = pdfLibData;

            const loadingTask = pdfjsLib.getDocument({ data: pdfJsData });

            const self = this;
            loadingTask.promise.then(async function (pdfDoc) {
                self.pdfDoc = pdfDoc;
                self.totalPages = pdfDoc.numPages;

                self.elements.filename.textContent = file.name;
                self.elements.totalPagesEl.textContent = self.totalPages;
                self.showEditor();

                // Render ALL pages for continuous scrolling
                await self.renderAllPages();

                // Initialize Redactor
                try {
                    await Redactor.init(self.pdfLibData);
                    await self.displayMetadata();
                } catch (redactorError) {
                    console.error('Redactor init error:', redactorError.message);
                    self.elements.metadataInfo.innerHTML = '<p class="empty-state">Redactie tijdelijk niet beschikbaar</p>';
                }

            }).catch(function (error) {
                console.error('PDF.js error:', error);
                alert('Fout bij het laden van de PDF: ' + error.message);
            });

        } catch (error) {
            console.error('Error loading PDF:', error);
            alert('Fout bij het laden van de PDF: ' + error.message);
        }
    },

    /**
     * Render ALL pages for continuous scrolling
     */
    async renderAllPages() {
        // Clear existing pages
        const container = this.elements.pagesContainer || this.elements.pdfViewer;
        container.innerHTML = '';
        this.pageCanvases = [];
        this.pageContainers = [];

        for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
            const page = await this.pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: this.scale });

            // Create page wrapper
            const pageWrapper = document.createElement('div');
            pageWrapper.className = 'pdf-page-wrapper';
            pageWrapper.dataset.page = pageNum;
            pageWrapper.style.position = 'relative';
            pageWrapper.style.marginBottom = '20px';
            pageWrapper.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';

            // Create canvas
            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-page-canvas';
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.display = 'block';

            const context = canvas.getContext('2d');

            // Render page
            await page.render({
                canvasContext: context,
                viewport: viewport
            }).promise;

            // Create redaction layer for this page
            const redactionLayer = document.createElement('div');
            redactionLayer.className = 'page-redaction-layer';
            redactionLayer.dataset.page = pageNum;
            redactionLayer.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: ${canvas.width}px;
                height: ${canvas.height}px;
                pointer-events: none;
            `;

            // Page number indicator
            const pageIndicator = document.createElement('div');
            pageIndicator.className = 'page-indicator';
            pageIndicator.textContent = `Pagina ${pageNum}`;
            pageIndicator.style.cssText = `
                position: absolute;
                bottom: 8px;
                right: 8px;
                background: rgba(0,0,0,0.7);
                color: white;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 12px;
                pointer-events: none;
            `;

            pageWrapper.appendChild(canvas);
            pageWrapper.appendChild(redactionLayer);
            pageWrapper.appendChild(pageIndicator);
            container.appendChild(pageWrapper);

            this.pageCanvases.push(canvas);
            this.pageContainers.push(pageWrapper);

            // Add mouse events for drawing on this page
            this.addPageMouseEvents(pageWrapper, pageNum, canvas, redactionLayer);
        }

        // Update current page indicator
        this.currentPage = 1;
        this.elements.currentPageEl.textContent = 1;

        // Render any existing redactions
        this.renderAllRedactions();
    },

    /**
     * Add mouse events for drawing redactions on a page
     */
    addPageMouseEvents(wrapper, pageNum, canvas, redactionLayer) {
        wrapper.addEventListener('mousedown', (e) => {
            if (this.currentTool !== 'redact') return;

            const rect = canvas.getBoundingClientRect();
            this.isDrawing = true;
            this.currentDrawingPage = pageNum;
            this.currentRedactionLayer = redactionLayer;
            this.drawStart = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };

            // Create preview
            const preview = document.createElement('div');
            preview.className = 'redaction-box preview';
            preview.id = 'redaction-preview';
            preview.style.left = this.drawStart.x + 'px';
            preview.style.top = this.drawStart.y + 'px';
            preview.style.pointerEvents = 'auto';
            redactionLayer.style.pointerEvents = 'auto';
            redactionLayer.appendChild(preview);
        });

        wrapper.addEventListener('mousemove', (e) => {
            if (!this.isDrawing || this.currentDrawingPage !== pageNum) return;

            const rect = canvas.getBoundingClientRect();
            const currentX = e.clientX - rect.left;
            const currentY = e.clientY - rect.top;

            const preview = document.getElementById('redaction-preview');
            if (preview) {
                const width = currentX - this.drawStart.x;
                const height = currentY - this.drawStart.y;

                preview.style.left = (width < 0 ? currentX : this.drawStart.x) + 'px';
                preview.style.top = (height < 0 ? currentY : this.drawStart.y) + 'px';
                preview.style.width = Math.abs(width) + 'px';
                preview.style.height = Math.abs(height) + 'px';
            }
        });

        wrapper.addEventListener('mouseup', (e) => {
            if (!this.isDrawing || this.currentDrawingPage !== pageNum) return;
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
                this.currentRedactionLayer.style.pointerEvents = 'none';

                if (bounds.width > 5 && bounds.height > 5) {
                    const pageHeight = 842;
                    const pdfBounds = Redactor.canvasToPdfCoords(bounds, pageHeight, this.scale);

                    Redactor.addRedaction(pageNum, pdfBounds, 'manual');
                    this.renderAllRedactions();
                    this.updateRedactionsList();

                    // FEEDBACK LOOP: Try to extract text from the selected area
                    this.learnFromManualRedaction(pageNum, bounds);
                }
            }
        });
    },

    /**
     * FEEDBACK LOOP: Learn from manual redactions
     * Extracts text from the selected area and adds it to learned words
     */
    async learnFromManualRedaction(pageNum, canvasBounds) {
        try {
            const page = await this.pdfDoc.getPage(pageNum);
            const textContent = await page.getTextContent();

            // Convert canvas bounds back to PDF coords for matching
            const pdfBounds = Redactor.canvasToPdfCoords(canvasBounds, 842, this.scale);

            // Find text items that overlap with the redaction area
            const matchedText = [];
            for (const item of textContent.items) {
                const itemX = item.transform[4];
                const itemY = item.transform[5];

                // Check if text item is within or near the redaction bounds
                if (itemX >= pdfBounds.x - 10 &&
                    itemX <= pdfBounds.x + pdfBounds.width + 10 &&
                    itemY >= pdfBounds.y - 10 &&
                    itemY <= pdfBounds.y + pdfBounds.height + 10) {
                    matchedText.push(item.str.trim());
                }
            }

            // Add matched text to learned words - sync with Detector!
            const fullText = matchedText.join(' ').trim();
            if (fullText.length > 2) {
                // Delegate completely to Detector
                if (typeof Detector !== 'undefined' && Detector.learnWord) {
                    Detector.learnWord(fullText);
                }
                console.log('Learned word from manual redaction:', fullText);

                // FEATURE: Global Redaction (Apply to all)
                // If the word is significant (>3 chars), try to find and redact it everywhere else
                if (fullText.length > 3) {
                    this.applyRedactionGlobally(fullText);
                }
            }
            console.log('Learned word from manual redaction:', fullText);
        } catch (error) {
            console.error('Error learning from redaction:', error);
        }
    },

    /**
     * Update current page based on scroll position
     */
    updateCurrentPageFromScroll() {
        const container = this.elements.pdfViewer;
        const scrollTop = container.scrollTop;

        for (let i = 0; i < this.pageContainers.length; i++) {
            const pageWrapper = this.pageContainers[i];
            const offsetTop = pageWrapper.offsetTop - container.offsetTop;
            const offsetBottom = offsetTop + pageWrapper.offsetHeight;

            if (scrollTop >= offsetTop - 100 && scrollTop < offsetBottom - 100) {
                this.currentPage = i + 1;
                this.elements.currentPageEl.textContent = this.currentPage;
                break;
            }
        }
    },

    /**
     * Render redactions on ALL pages
     */
    renderAllRedactions() {
        // Clear all redaction layers first
        document.querySelectorAll('.page-redaction-layer').forEach(layer => {
            layer.innerHTML = '';
        });

        for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
            const redactions = Redactor.getPageRedactions(pageNum);
            const redactionLayer = document.querySelector(`.page-redaction-layer[data-page="${pageNum}"]`);

            if (!redactionLayer) continue;

            for (const redaction of redactions) {
                const box = document.createElement('div');
                box.className = 'redaction-box';
                box.dataset.id = redaction.id;
                box.style.pointerEvents = 'auto';

                const pageHeight = 842;
                const canvasBounds = Redactor.pdfToCanvasCoords(
                    redaction.bounds,
                    pageHeight,
                    this.scale
                );

                box.style.left = canvasBounds.x + 'px';
                box.style.top = canvasBounds.y + 'px';
                box.style.width = canvasBounds.width + 'px';
                box.style.height = canvasBounds.height + 'px';

                // Delete button
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'redaction-delete-btn';
                deleteBtn.innerHTML = '✕';
                deleteBtn.title = 'Verwijder redactie';
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();

                    // FEEDBACK LOOP: If auto-detected, add to ignore list
                    if (redaction.value && redaction.type !== 'manual') {
                        // Delegate completely to Detector
                        if (typeof Detector !== 'undefined' && Detector.ignoreWord) {
                            Detector.ignoreWord(redaction.value);
                        }
                        console.log('Added to ignore list:', redaction.value);
                    }

                    Redactor.removeRedaction(redaction.id);
                    this.renderAllRedactions();
                    this.updateRedactionsList();
                });
                box.appendChild(deleteBtn);

                // Resize handles
                const handles = ['nw', 'ne', 'sw', 'se'];
                handles.forEach(pos => {
                    const handle = document.createElement('div');
                    handle.className = `redaction-resize-handle ${pos}`;
                    handle.addEventListener('mousedown', (e) => {
                        e.stopPropagation();
                        this.startResizing(e, redaction, pos, pageNum);
                    });
                    box.appendChild(handle);
                });

                // Move functionality
                box.classList.add('movable');
                box.addEventListener('mousedown', (e) => {
                    if (e.target === box) {
                        e.stopPropagation();
                        this.startMoving(e, redaction, pageNum);
                    }
                });

                redactionLayer.appendChild(box);
            }
        }
    },

    /**
     * Find and redact a specific word/phrase across the entire document
     */
    async applyRedactionGlobally(textToRedact) {
        if (!this.pdfDoc) return;

        console.log(`Applying global redaction for: "${textToRedact}"`);
        let totalApplied = 0;

        for (let i = 1; i <= this.pdfDoc.numPages; i++) {
            const page = await this.pdfDoc.getPage(i);
            const textContent = await page.getTextContent();

            // Reconstruct full text with items map for coordinate lookup
            const textItems = textContent.items;
            const fullPageText = textItems.map(item => item.str).join('');

            // Simple match?
            if (fullPageText.toLowerCase().includes(textToRedact.toLowerCase())) {
                // Find distinct occurrences
                for (const item of textItems) {
                    if (item.str.toLowerCase().includes(textToRedact.toLowerCase())) {
                        // Create a rough bounding box for this item
                        const x = item.transform[4];
                        const y = item.transform[5];
                        const width = item.width;
                        const height = item.height || 12; // Fallback height

                        // Check if already redacted
                        const isRedacted = this.isAreaRedacted(i, { x, y, width, height });

                        if (!isRedacted) {
                            Redactor.addRedaction(i, { x, y, width, height }, 'learned');
                            totalApplied++;
                        }
                    }
                }
            }
        }

        if (totalApplied > 0) {
            this.showToast(`Nog ${totalApplied} keer "${textToRedact}" zwartgelakt.`);
            this.renderAllRedactions();
        }
    },

    /**
     * Check if an area is already covered by a redaction
     */
    isAreaRedacted(pageNum, bounds) {
        const pageRedactions = Redactor.redactions[pageNum] || [];
        return pageRedactions.some(r => {
            return (bounds.x >= r.x && bounds.x + bounds.width <= r.x + r.width &&
                bounds.y >= r.y && bounds.y + bounds.height <= r.y + r.height);
        });
    },

    /**
     * Show a temporary toast message
     */
    showToast(message) {
        let toast = document.getElementById('toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast';
            toast.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: var(--accent-primary);
                color: white;
                padding: 10px 20px;
                border-radius: 8px;
                z-index: 1000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                opacity: 0;
                transition: opacity 0.3s;
            `;
            document.body.appendChild(toast);
        }

        toast.textContent = message;
        toast.style.opacity = '1';

        setTimeout(() => {
            toast.style.opacity = '0';
        }, 3000);
    },

    bindSearchEvents() {
        const searchInput = document.getElementById('search-input');
        const searchResults = document.getElementById('search-results');
        let debounceTimer;

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                const term = e.target.value.trim();

                debounceTimer = setTimeout(async () => {
                    if (term.length < 2) {
                        if (searchResults) searchResults.classList.add('hidden');
                        return;
                    }

                    if (searchResults) {
                        searchResults.classList.remove('hidden');
                        searchResults.innerHTML = '<div class="detection-item">Zoeken...</div>';
                    }

                    const count = await this.countOccurrencesGlobally(term);

                    if (searchResults) {
                        searchResults.innerHTML = `
                            <div class="detection-item" onclick="App.applyRedactionGlobally('${term}')">
                                <div style="flex:1">
                                    <span class="type">Gevonden: ~${count}x</span><br>
                                    <span class="value">"${term}"</span>
                                </div>
                                <button class="btn btn-small btn-tool" style="pointer-events:none">Lakken</button>
                            </div>
                        `;
                    }
                }, 500);
            });
        }
    },

    async countOccurrencesGlobally(term) {
        if (!this.pdfDoc) return 0;
        let count = 0;
        for (let i = 1; i <= Math.min(this.pdfDoc.numPages, 20); i++) {
            const page = await this.pdfDoc.getPage(i);
            const textContent = await page.getTextContent();
            const text = textContent.items.map(item => item.str).join(' ');
            if (text.toLowerCase().includes(term.toLowerCase())) {
                count++;
            }
        }
        return count + (this.pdfDoc.numPages > 20 ? '+' : '');
    },

    /**
     * Start resizing a redaction box
     */
    startResizing(e, redaction, handlePos, pageNum) {
        const startX = e.clientX;
        const startY = e.clientY;
        const startBounds = { ...redaction.bounds };

        const onMouseMove = (e) => {
            const dx = (e.clientX - startX) / this.scale;
            const dy = (e.clientY - startY) / this.scale;

            let newBounds = { ...startBounds };

            if (handlePos.includes('e')) newBounds.width = Math.max(10, startBounds.width + dx);
            if (handlePos.includes('w')) {
                newBounds.x = startBounds.x + dx;
                newBounds.width = Math.max(10, startBounds.width - dx);
            }
            if (handlePos.includes('s')) newBounds.height = Math.max(10, startBounds.height + dy);
            if (handlePos.includes('n')) {
                newBounds.y = startBounds.y - dy;
                newBounds.height = Math.max(10, startBounds.height + dy);
            }

            redaction.bounds = newBounds;
            this.renderAllRedactions();
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            this.updateRedactionsList();
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    },

    /**
     * Start moving a redaction box
     */
    startMoving(e, redaction, pageNum) {
        const startX = e.clientX;
        const startY = e.clientY;
        const startBounds = { ...redaction.bounds };

        const onMouseMove = (e) => {
            const dx = (e.clientX - startX) / this.scale;
            const dy = (e.clientY - startY) / this.scale;

            redaction.bounds.x = startBounds.x + dx;
            redaction.bounds.y = startBounds.y - dy;
            this.renderAllRedactions();
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            this.updateRedactionsList();
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    },

    /**
     * Load an image file
     */
    async loadImage(file) {
        this.currentFileType = 'image';

        const imageUrl = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            this.currentImage = img;
            this.pdfDoc = null;
            this.totalPages = 1;
            this.currentPage = 1;

            this.elements.filename.textContent = file.name;
            this.elements.totalPagesEl.textContent = '1';
            this.showEditor();

            this.renderImagePage(img);
        };

        img.src = imageUrl;
    },

    /**
     * Render image as a single page
     */
    renderImagePage(img) {
        const container = this.elements.pagesContainer || this.elements.pdfViewer;
        container.innerHTML = '';

        const pageWrapper = document.createElement('div');
        pageWrapper.className = 'pdf-page-wrapper';
        pageWrapper.dataset.page = 1;
        pageWrapper.style.position = 'relative';

        const canvas = document.createElement('canvas');
        canvas.width = img.width * this.scale;
        canvas.height = img.height * this.scale;
        canvas.style.display = 'block';

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const redactionLayer = document.createElement('div');
        redactionLayer.className = 'page-redaction-layer';
        redactionLayer.dataset.page = 1;
        redactionLayer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: ${canvas.width}px;
            height: ${canvas.height}px;
            pointer-events: none;
        `;

        pageWrapper.appendChild(canvas);
        pageWrapper.appendChild(redactionLayer);
        container.appendChild(pageWrapper);

        this.pageCanvases = [canvas];
        this.pageContainers = [pageWrapper];

        this.addPageMouseEvents(pageWrapper, 1, canvas, redactionLayer);
    },

    /**
     * Show editor, hide upload zone
     */
    showEditor() {
        this.elements.uploadZone.classList.add('hidden');
        this.elements.editor.classList.remove('hidden');
        document.querySelector('.info-panel')?.classList.add('hidden');
        // Hide the header for more editing space
        document.querySelector('.header')?.classList.add('hidden');
    },

    /**
     * Reset to upload view
     */
    resetToUpload() {
        this.elements.editor.classList.add('hidden');
        this.elements.uploadZone.classList.remove('hidden');
        document.querySelector('.info-panel')?.classList.remove('hidden');
        // Show the header again
        document.querySelector('.header')?.classList.remove('hidden');

        this.pdfDoc = null;
        this.currentPage = 1;
        this.scale = 1.0;
        this.scale = 1.0;
        // Do NOT clear learned data on reset - it's persistent now!
        Redactor.clearRedactions();
        this.elements.fileInput.value = '';
        this.updateRedactionsList();
    },

    /**
     * Set current tool
     */
    setTool(tool) {
        this.currentTool = tool;
        this.elements.toolSelect.classList.toggle('active', tool === 'select');
        this.elements.toolRedact.classList.toggle('active', tool === 'redact');

        // Update cursor on all page wrappers
        document.querySelectorAll('.pdf-page-wrapper').forEach(wrapper => {
            wrapper.style.cursor = tool === 'redact' ? 'crosshair' : 'default';
        });
    },

    /**
     * Zoom in/out
     */
    zoom(delta) {
        this.scale = Math.max(0.5, Math.min(3, this.scale + delta));
        this.elements.zoomLevel.textContent = Math.round(this.scale * 100) + '%';

        if (this.pdfDoc) {
            this.renderAllPages();
        } else if (this.currentImage) {
            this.renderImagePage(this.currentImage);
        }
    },

    /**
     * Scroll to specific page
     */
    goToPage(pageNumber) {
        if (pageNumber >= 1 && pageNumber <= this.totalPages && this.pageContainers[pageNumber - 1]) {
            this.pageContainers[pageNumber - 1].scrollIntoView({ behavior: 'smooth' });
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
     * Clear learned data
     */
    async clearLearnedData() {
        if (confirm('Weet u zeker dat u alle geleerde woorden en genegeerde woorden wilt wissen?')) {
            if (typeof Detector !== 'undefined' && Detector.clearLearnedData) {
                Detector.clearLearnedData();
                this.updateDetectionsList();
                alert('Geleerde data is gewist.');
            }
        }
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

        let html = `
            <div class="redactions-header">
                <span>${redactions.length} redactie(s)</span>
                <button class="btn-clear-all" title="Wis alle redacties">🗑️ Wis alle</button>
            </div>
        `;

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

        // Click to scroll to page
        this.elements.redactionsList.querySelectorAll('.redaction-info').forEach(info => {
            info.addEventListener('click', () => {
                const item = info.closest('.redaction-item');
                this.goToPage(parseInt(item.dataset.page));
            });
        });

        // Delete button
        this.elements.redactionsList.querySelectorAll('.btn-delete-redaction').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                Redactor.removeRedaction(btn.dataset.id);
                this.renderAllRedactions();
                this.updateRedactionsList();
            });
        });

        // Clear all
        const clearAllBtn = this.elements.redactionsList.querySelector('.btn-clear-all');
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => {
                if (confirm('Weet je zeker dat je alle redacties wilt verwijderen?')) {
                    Redactor.clearRedactions();
                    this.renderAllRedactions();
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

        await this.runDetection();
    },

    /**
     * Close modal
     */
    closeModal() {
        this.elements.modal.classList.add('hidden');
    },

    /**
     * Run automatic detection with feedback loop integration
     */
    async runDetection() {
        const allDetections = {
            byCategory: {},
            all: [],
            stats: { total: 0, categories: 0 }
        };

        this.textItemsPerPage = new Map();

        for (let i = 1; i <= this.totalPages; i++) {
            const page = await this.pdfDoc.getPage(i);
            const textContent = await page.getTextContent();
            const viewport = page.getViewport({ scale: 1 });

            const textItems = textContent.items.map(item => ({
                str: item.str,
                x: item.transform[4],
                y: item.transform[5],
                width: item.width,
                height: item.height || Math.abs(item.transform[0]) || 12,
                fontHeight: Math.abs(item.transform[0]) || 12
            }));
            this.textItemsPerPage.set(i, textItems);

            let combinedText = '';
            for (let j = 0; j < textItems.length; j++) {
                combinedText += textItems[j].str + ' ';
            }

            // Run standard detection
            // Detector now handles learned words and ignored words internally
            const pageDetections = Detector.detect(combinedText, i);

            // Get bounds for detections
            for (const detection of pageDetections.all) {
                const bounds = this.findTextBounds(detection.value, detection.startIndex, textItems, viewport);
                if (bounds) {
                    detection.bounds = bounds;
                }
            }

            // Merge results
            for (const [category, data] of Object.entries(pageDetections.byCategory)) {

                if (data.items.length === 0) continue;

                if (!allDetections.byCategory[category]) {
                    allDetections.byCategory[category] = {
                        name: data.name,
                        icon: data.icon,
                        items: []
                    };
                }
                allDetections.byCategory[category].items.push(...data.items);
            }

            // Add learned words category if any
            const learnedItems = pageDetections.all.filter(d => d.type === 'learned');
            if (learnedItems.length > 0) {
                if (!allDetections.byCategory['learned']) {
                    allDetections.byCategory['learned'] = {
                        name: 'Geleerde woorden',
                        icon: '🧠',
                        items: []
                    };
                }
                allDetections.byCategory['learned'].items.push(...learnedItems);
            }

            allDetections.all.push(...pageDetections.all);
        }

        allDetections.stats.total = allDetections.all.length;
        allDetections.stats.categories = Object.keys(allDetections.byCategory).length;

        this.currentDetections = allDetections;
        this.displayDetectionResults(allDetections);
    },

    /**
     * Escape regex special characters
     */
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    /**
     * Find bounding box for detected text
     */
    findTextBounds(searchValue, startIndex, textItems, viewport) {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        let found = false;

        const searchLower = searchValue.toLowerCase().trim();
        if (searchLower.length < 2) return null;

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

        const fullTextLower = fullText.toLowerCase();
        const matchIndex = fullTextLower.indexOf(searchLower);

        if (matchIndex !== -1) {
            const matchEnd = matchIndex + searchLower.length;

            for (const pos of itemPositions) {
                if (pos.endPos > matchIndex && pos.startPos < matchEnd) {
                    found = true;
                    const item = pos.item;
                    const x = item.x;
                    const fontHeight = item.fontHeight || 12;
                    const y = item.y - fontHeight;
                    const width = item.width || (item.str.length * fontHeight * 0.6);
                    const height = fontHeight;

                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x + width);
                    maxY = Math.max(maxY, y + height);
                }
            }
        }

        if (!found) {
            for (let i = 0; i < textItems.length; i++) {
                const item = textItems[i];
                const itemText = item.str.toLowerCase().trim();

                if (itemText.length >= 3 && itemText.includes(searchLower)) {
                    found = true;
                    const x = item.x;
                    const fontHeight = item.fontHeight || 12;
                    const y = item.y - fontHeight;
                    const width = item.width || (item.str.length * fontHeight * 0.6);
                    const height = fontHeight;

                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x + width);
                    maxY = Math.max(maxY, y + height);
                }
            }
        }

        if (!found || minX === Infinity) return null;

        const padding = 2;
        return {
            x: minX - padding,
            y: minY - padding,
            width: (maxX - minX) + (padding * 2),
            height: (maxY - minY) + (padding * 2)
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
                        Tip: Teken handmatig een redactie om het systeem te leren.
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
                                       ${item.selected !== false ? 'checked' : ''}>
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

            let bounds = item.bounds;
            if (!bounds) {
                const textItems = this.textItemsPerPage?.get(item.page);
                if (textItems) {
                    bounds = this.findTextBounds(item.value, 0, textItems, null);
                }
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

        this.renderAllRedactions();
        this.updateRedactionsList();
        this.updateDetectionsList();
        this.closeModal();
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

        let learnedInfo = '';

        // Use Detector state for stats
        if (typeof Detector !== 'undefined') {
            const learnedCount = Detector.getLearnedWords ? Detector.getLearnedWords().size : 0;
            const ignoredCount = Detector.getIgnoredWords ? Detector.getIgnoredWords().size : 0;

            if (learnedCount > 0) {
                learnedInfo = `<br><small>🧠 ${learnedCount} geleerd</small>`;
            }
            if (ignoredCount > 0) {
                learnedInfo += `<br><small>🚫 ${ignoredCount} genegeerd</small>`;
            }

            // Show/hide clear button
            if (this.elements.btnClearLearning) {
                if (learnedCount > 0 || ignoredCount > 0) {
                    this.elements.btnClearLearning.classList.remove('hidden');
                } else {
                    this.elements.btnClearLearning.classList.add('hidden');
                }
            }
        }

        this.elements.detectionsList.innerHTML = `
            <p style="font-size: 0.85rem; margin-bottom: 0.5rem;">
                ${this.currentDetections.stats.total} gevonden, ${applied} geredacteerd
                ${learnedInfo}
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
        if (event.key === 'Escape') {
            this.closeModal();
        }

        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
            event.preventDefault();
            this.exportPDF();
        }
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
