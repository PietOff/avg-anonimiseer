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
            btnApplyDetections: document.getElementById('btn-apply-detections'),
        };
    },

    /**
     * Bind event listeners
     */
    bindEvents() {


        // Upload
        this.elements.uploadZone.addEventListener('click', () => this.elements.fileInput.click());
        this.elements.uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.elements.uploadZone.classList.add('drag-over');
        });
        this.elements.uploadZone.addEventListener('dragleave', () => {
            this.elements.uploadZone.classList.remove('drag-over');
        });
        this.elements.uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.elements.uploadZone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file) this.loadFile(file);
        });

        this.elements.fileInput.addEventListener('change', (e) => {
            if (e.target.files[0]) this.loadFile(e.target.files[0]);
        });
        this.elements.browseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.elements.fileInput.click();
        });

        // Toolbar
        this.elements.btnBack.addEventListener('click', () => this.resetToUpload());
        // Toolbar
        this.elements.btnBack.addEventListener('click', () => this.resetToUpload());
        this.elements.toolSelect.addEventListener('click', () => this.setTool('select'));
        this.elements.toolRedact.addEventListener('click', () => this.setTool('redact'));

        // Detection Results - Click Delegations (Select All)
        if (this.elements.detectionResults) {
            this.elements.detectionResults.addEventListener('change', (e) => {
                if (e.target.classList.contains('select-all-category')) {
                    const category = e.target.dataset.category;
                    const isChecked = e.target.checked;
                    const inputs = this.elements.detectionResults.querySelectorAll(`input[data-category="${category}"]:not(.select-all-category)`);
                    inputs.forEach(input => input.checked = isChecked);
                }
            });
        }

        // Auto-detect: Use AI if key is set, otherwise standard
        this.elements.btnDetect.addEventListener('click', () => {
            const hasKey = typeof MistralService !== 'undefined' && !!MistralService.getApiKey();
            this.openDetectionModal(hasKey);
        });

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

        wrapper.addEventListener('mouseup', async (e) => {
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

                    // Add redaction immediately
                    const newRedaction = Redactor.addRedaction(pageNum, pdfBounds, 'manual');

                    // FEEDBACK LOOP: Try to extract text from the selected area
                    try {
                        const foundText = await this.extractTextFromBounds(pageNum, pdfBounds);
                        if (foundText) {
                            console.log("Manual redaction captured text:", foundText);
                            newRedaction.value = foundText;

                            // Learn this word? Optional. 
                            if (typeof Detector !== 'undefined' && Detector.learnWord) {
                                Detector.learnWord(foundText);
                            }
                        }
                    } catch (err) {
                        console.warn("Could not extract text from manual redaction:", err);
                    }

                    this.renderAllRedactions();
                    this.updateRedactionsList();
                }
            }
        });
    },

    /**
     * Helper: Extract text from specific PDF bounds
     */
    async extractTextFromBounds(pageNum, pdfBounds) {
        try {
            const page = await this.pdfDoc.getPage(pageNum);
            const textContent = await page.getTextContent();

            // Note: matching is approximate
            const matchedText = [];
            for (const item of textContent.items) {
                const itemX = item.transform[4];
                const itemY = item.transform[5];
                const itemHeight = item.height || 10;
                const itemWidth = item.width || (item.str.length * 5); // Estimate if missing

                // Check overlap
                // PDF coords: Y starts at bottom. 
                // Simple box intersection
                if (itemX + itemWidth >= pdfBounds.x &&
                    itemX <= pdfBounds.x + pdfBounds.width &&
                    itemY + itemHeight >= pdfBounds.y &&
                    itemY <= pdfBounds.y + pdfBounds.height) {

                    matchedText.push(item.str.trim());
                }
            }

            return matchedText.join(' ').trim();
        } catch (e) {
            console.error("Text extraction failed", e);
            return "";
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

                    // FEATURE: Global Deletion
                    // If this redaction has a known value, delete ALL instances of it
                    if (redaction.value && redaction.type !== 'manual') {
                        // Also add to ignore list so it doesn't come back
                        if (typeof Detector !== 'undefined' && Detector.ignoreWord) {
                            Detector.ignoreWord(redaction.value);
                        }
                        console.log('Added to ignore list:', redaction.value);

                        // Remove GLOBALLY
                        this.removeRedactionGlobally(redaction.value);
                    } else if (redaction.value) {
                        // Even for manual ones, if they have a value attached (from learning), delete global
                        // Ask for confirmation? For now, imply "Delete One = Delete All" as requested
                        this.removeRedactionGlobally(redaction.value);

                        // If it was manual/learned, we should probably unlearn it too?
                        // Detector.ignoreWord(redaction.value); // Maybe safest to ignore it now
                    } else {
                        // Fallback for empty value redactions
                        Redactor.removeRedaction(redaction.id);
                    }

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
     * Remove all redactions matching a specific text value
     */
    removeRedactionGlobally(value) {
        if (!value) return;

        console.log(`Removing global redactions for: "${value}"`);
        let count = 0;

        // Iterate over all pages in Redactor
        Object.keys(Redactor.redactions).forEach(pageNum => {
            const pageRedactions = Redactor.redactions[pageNum];

            // Filter out redactions that match the value
            // We need to keep ones that DO NOT match
            const toKeep = pageRedactions.filter(r => {
                if (r.value === value) {
                    count++;
                    return false; // Remove
                }
                return true; // Keep
            });

            Redactor.redactions[pageNum] = toKeep;
        });

        if (count > 0) {
            this.showToast(`${count} instanties van "${value}" verwijderd.`);
        }
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
     * @param {boolean} useAI - Whether to use Mistral AI
     */
    async runDetection(useAI = false) {
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
            const pageDetections = Detector.detect(combinedText, i);

            // Run AI detection if enabled
            if (useAI && typeof MistralService !== 'undefined') {
                try {
                    // Call backend proxy
                    const aiResults = await MistralService.analyzeText(combinedText);

                    // Merge AI results
                    // Mistral returns [{type, value, confidence}]
                    // We need to find ALL instances of these values in the text
                    for (const item of aiResults) {
                        const searchVal = item.value.trim();
                        if (searchVal.length < 2) continue;

                        let pos = -1;
                        let searchPos = 0;
                        const lowerText = combinedText.toLowerCase();
                        const lowerSearch = searchVal.toLowerCase();

                        // Find all occurrences
                        while ((pos = lowerText.indexOf(lowerSearch, searchPos)) !== -1) {
                            searchPos = pos + 1;

                            // Check if already detected by regex to avoid duplicates
                            const alreadyFound = pageDetections.all.some(d =>
                                d.startIndex === pos && d.value.length === searchVal.length
                            );

                            if (!alreadyFound && (!Detector.shouldExclude || !Detector.shouldExclude(searchVal, pos, combinedText))) {
                                pageDetections.all.push({
                                    type: item.type, // Map 'name', 'email', etc.
                                    name: 'AI: ' + (item.type.charAt(0).toUpperCase() + item.type.slice(1)),
                                    icon: '🤖',
                                    value: combinedText.substr(pos, searchVal.length), // Use actual text from doc
                                    page: i,
                                    startIndex: pos,
                                    endIndex: pos + searchVal.length,
                                    selected: true,
                                    confidence: item.confidence
                                });
                            }
                        }
                    }

                    // Group AI items into categories
                    // pageDetections.byCategory needs update
                    const categories = {};
                    pageDetections.all.forEach(det => {
                        const catKey = det.type;
                        if (!categories[catKey]) {
                            categories[catKey] = {
                                name: det.name || det.type,
                                icon: det.icon || '🔹',
                                items: []
                            };
                        }
                        categories[catKey].items.push(det);
                    });
                    pageDetections.byCategory = categories;

                } catch (err) {
                    console.error("AI Error on page " + i, err);
                    // Continue with regex results
                }
            }

            // Get bounds for all detections (Regex + AI)
            for (const detection of pageDetections.all) {
                const bounds = this.findTextBounds(detection.value, detection.startIndex, textItems, viewport);
                if (bounds) {
                    detection.bounds = bounds;
                }
            }

            // Merge results into global object
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
        if (!searchValue || searchValue.trim().length < 2) return null;

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        let found = false;

        // 1. Map text items to their positions in the full text string
        // This MUST match exactly how 'runDetection' builds the string for the Detector
        let fullText = '';
        const itemPositions = [];

        for (let i = 0; i < textItems.length; i++) {
            const item = textItems[i];
            const startPos = fullText.length;
            fullText += item.str;
            const endPos = fullText.length;

            // Store the range this item covers in the full text
            itemPositions.push({ startPos, endPos, item });

            fullText += ' '; // Add space between items (same as runDetection)
        }

        // 2. Identify text items that are part of the detected range [startIndex, endIndex]
        const endIndex = startIndex + searchValue.length;

        for (const pos of itemPositions) {
            // Check for overlap: 
            // Item ends after start of match AND Item starts before end of match
            if (pos.endPos > startIndex && pos.startPos < endIndex) {
                found = true;
                const item = pos.item;

                // Use the item's geometry
                const x = item.x;
                const fontHeight = item.fontHeight || 12;
                // PDF coordinates are usually bottom-left, verify if y needs adjustment
                // Standard PDF.js: y is bottom coordinate of baseline.
                // We want key bounds.
                const y = item.y - fontHeight; // Top Y (approx)

                // Calculate width: use provided width or fallback estimate
                const width = item.width || (item.str.length * fontHeight * 0.6);
                const height = fontHeight;

                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x + width);
                maxY = Math.max(maxY, y + height);
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
            // Group items by value (normalized)
            const groups = {};
            data.items.forEach(item => {
                const key = item.value.trim();
                if (!groups[key]) {
                    groups[key] = {
                        value: item.value, // Keep original
                        count: 0,
                        items: [],
                        selected: item.selected !== false
                    };
                }
                groups[key].count++;
                groups[key].items.push(item);
                // If any item in group is unselected by default, unselect group?
                // Or if any is selected, select group?
                // Let's bias towards initial detection state.
            });

            const sortedKeys = Object.keys(groups).sort();

            html += `
                <div class="detection-category">
                    <div class="detection-category-header">
                        <span class="detection-category-title">
                            ${data.icon} ${data.name}
                        </span>
                        <div style="display:flex; align-items:center; gap:10px;">
                            <label style="font-size:0.8rem; cursor:pointer; color:var(--primary); display:flex; align-items:center; gap:0.25rem;">
                                <input type="checkbox" class="select-all-category" data-category="${category}" checked>
                                Alles
                            </label>
                            <span class="detection-count">${data.items.length}</span>
                        </div>
                    </div>
                    <div class="detection-category-items">
                        ${sortedKeys.map((key, idx) => {
                const group = groups[key];
                const pages = [...new Set(group.items.map(i => i.page))].sort((a, b) => a - b).join(', ');
                const countLabel = group.count > 1 ? `<span style="font-size:0.8em; color:var(--text-muted);">(${group.count}x)</span>` : '';

                return `
                            <label class="detection-check-item">
                                <input type="checkbox" 
                                       data-category="${category}" 
                                       data-value="${encodeURIComponent(key)}"
                                       ${group.selected ? 'checked' : ''}>
                                <div style="display:flex; flex-direction:column; line-height:1.2;">
                                    <span class="value">${this.maskValue(group.value)} ${countLabel}</span>
                                    <span class="page" style="font-size:0.75rem;">P${pages}</span>
                                </div>
                            </label>
                        `;
            }).join('')}
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
        const itemsToRedact = [];

        for (const checkbox of checkboxes) {
            const category = checkbox.dataset.category;
            const value = decodeURIComponent(checkbox.dataset.value);

            const categoryData = this.currentDetections.byCategory[category];
            if (categoryData && categoryData.items) {
                // Determine matches by value
                const matches = categoryData.items.filter(item => {
                    // Normalize comparison
                    return item.value.trim() === value;
                });

                itemsToRedact.push(...matches);
            }
        }

        // Apply redactions
        for (const item of itemsToRedact) {
            let bounds = item.bounds;
            if (!bounds) {
                const textItems = this.textItemsPerPage?.get(item.page);
                if (textItems) {
                    bounds = this.findTextBounds(item.value, item.startIndex, textItems, null);
                }
                if (!bounds) {
                    bounds = {
                        x: 50,
                        y: 750,
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

        let itemsHtml = '';
        if (this.currentDetections) {
            // Flatten items
            const allItems = [];
            Object.values(this.currentDetections.byCategory).forEach(cat => {
                allItems.push(...cat.items);
            });

            // Limit display to 50 items to prevent lag
            const displayItems = allItems.slice(0, 50);

            itemsHtml = '<div class="detections-scrollable">';
            displayItems.forEach(item => {
                const isIgnored = Detector.shouldIgnore ? Detector.shouldIgnore(item.value) : false;
                const style = isIgnored ? 'opacity: 0.5; text-decoration: line-through;' : '';
                itemsHtml += `
                    <div class="detection-item" style="${style}">
                        <div style="flex:1; overflow:hidden;">
                            <span class="type">${item.icon || '🔹'} ${item.name}</span><br>
                            <span class="value" title="${item.value}">${this.maskValue(item.value)}</span>
                        </div>
                    </div>
                `;
            });
            if (allItems.length > 50) {
                itemsHtml += `<div class="detection-item" style="justify-content:center; color:var(--text-muted)">...en nog ${allItems.length - 50} items</div>`;
            }
            itemsHtml += '</div>';
        }

        this.elements.detectionsList.innerHTML = `
            <p style="font-size: 0.85rem; margin-bottom: 0.5rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem;">
                <strong>${this.currentDetections.stats.total} gevonden</strong> (${applied} toegepast)
                ${learnedInfo}
            </p>
            ${itemsHtml}
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
