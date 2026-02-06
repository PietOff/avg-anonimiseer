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

// DEBUG: Confirm app loads
console.log('AVG App loading...');
// alert('AVG App is geladen! (Als je dit ziet, werkt de basis)');

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

    // Validation State
    validatedPages: new Set(),

    // Page canvases for continuous scrolling
    pageCanvases: [],
    pageContainers: [],
    pageDimensions: [], // Store dimensions per page



    // learnedWords/ignoredWords are now managed by Detector module

    // DOM Elements
    elements: {},

    /**
     * Initialize the application
     */
    async init() {
        this.cacheElements();
        this.bindEvents();
        this.bindSearchEvents();
        console.log('AVG Anonimiseer initialized');

        // Initialize Persistence
        if (typeof Persistence !== 'undefined') {
            try {
                await Persistence.init();
                this.checkSavedSession();
            } catch (e) {
                console.error('Persistence init failed:', e);
            }
        }

        if (typeof pdfjsLib === 'undefined') {
            console.error('PDF.js library not loaded!');
        }
        if (typeof PDFLib === 'undefined') {
            console.error('pdf-lib library not loaded!');
        }
    },

    /**
     * Check for and restore saved session
     */
    async checkSavedSession() {
        try {
            const file = await Persistence.loadFile();
            if (file) {
                const metadata = await Persistence.loadMetadata();
                console.log('Restoring saved session...', metadata);

                if (confirm('Er is een eerder document gevonden. Wil je verdergaan waar je gebleven was?')) {
                    const arrayBuffer = await file.arrayBuffer();
                    await this.loadPDFValues(arrayBuffer, metadata ? metadata.name : 'Hersteld document');

                    // Restore redactions
                    const savedState = await Persistence.loadState();
                    if (savedState) {
                        Redactor.redactions = new Map(JSON.parse(savedState));
                        Redactor.saveState(); // Update history with restored state
                        this.renderAllRedactions();
                        this.updateRedactionsList();
                        this.showToast('Sessie hersteld ✅');
                    }
                } else {
                    await Persistence.clearSession();
                }
            }
        } catch (e) {
            console.error('Error restoring session:', e);
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
        this.elements.uploadZone.addEventListener('click', () => {
            console.log('Upload zone clicked');
            this.elements.fileInput.click();
        });
        this.elements.uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.elements.uploadZone.classList.add('drag-over');
        });
        this.elements.uploadZone.addEventListener('dragleave', () => {
            this.elements.uploadZone.classList.remove('drag-over');
        });
        this.elements.uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            console.log('File dropped');
            this.elements.uploadZone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file) {
                console.log('File detected:', file.name);
                this.loadFile(file);
            }
            this.elements.detectionResults.classList.remove('hidden');
        });

        this.elements.fileInput.addEventListener('change', (e) => {
            console.log('File input changed');
            if (e.target.files[0]) {
                console.log('File selected:', e.target.files[0].name);
                this.loadFile(e.target.files[0]);
            }
        });

        // Setup sidebar action handlers (global hidden element to capture events from string templates)
        if (!document.getElementById('sidebar-action-handlers')) {
            const handler = document.createElement('div');
            handler.id = 'sidebar-action-handlers';
            handler.style.display = 'none';
            document.body.appendChild(handler);

            handler.addEventListener('ignore', (e) => {
                if (typeof Detector !== 'undefined' && Detector.ignoreWord) {
                    Detector.ignoreWord(e.detail);
                    this.updateDetectionsList();
                }
            });

            handler.addEventListener('jump', (e) => {
                // Scroll to page
                const page = document.querySelector(`.page-redaction-layer[data-page="${e.detail.page}"]`);
                if (page) {
                    page.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Highlight the specific text? (Complex, skipping for now)
                }
            });
        }

        this.elements.browseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('Browse button clicked');
            this.elements.fileInput.click();
        });

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

        this.elements.btnExport.addEventListener('click', async () => {
            // Soft validation check
            const remaining = this.totalPages - this.validatedPages.size;
            if (remaining > 0) {
                const proceed = confirm(`Let op: Nog ${remaining} pagina('s) zijn niet gemarkeerd als gecontroleerd.\n\nWil je toch exporteren?`);
                if (!proceed) return;
            }
            this.exportPDF();
        });

        // Toggle Mark All
        const btnValidateAll = document.getElementById('btn-validate-all');
        if (btnValidateAll) {
            btnValidateAll.addEventListener('click', () => this.markAllPagesValidated());
        }

        // Undo / Redo
        const btnUndo = document.getElementById('btn-undo');
        const btnRedo = document.getElementById('btn-redo');
        if (btnUndo) {
            btnUndo.addEventListener('click', () => {
                if (Redactor.undo()) {
                    this.renderAllRedactions();
                    this.updateRedactionsList();
                    this.updateDetectionsList();
                }
            });
        }
        if (btnRedo) {
            btnRedo.addEventListener('click', () => {
                if (Redactor.redo()) {
                    this.renderAllRedactions();
                    this.updateRedactionsList();
                    this.updateDetectionsList();
                }
            });
        }

        // Audit Log
        const btnAuditLog = document.getElementById('btn-audit-log');
        if (btnAuditLog) {
            btnAuditLog.addEventListener('click', () => this.generateAuditLog());
        }

        this.elements.btnClearMetadata.addEventListener('click', () => {
            this.clearMetadata();
            // Also option to clear persistence explicitly? 
            // For now, let's keep it separate or implicitly clear if user starts new file.
        });

        // Add specific "Hervat/Reset" UI if needed, but for now init check handles it.

        // Manual "Reset App" button (could look for id 'btn-reset-app')
        const btnResetApp = document.getElementById('btn-reset-app');
        if (btnResetApp) {
            btnResetApp.addEventListener('click', async () => {
                if (confirm('Weet je zeker dat je alles wilt wissen en opnieuw wilt beginnen?')) {
                    if (typeof Persistence !== 'undefined') await Persistence.clearSession();
                    window.location.reload();
                }
            });
        }

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

                    // Save to persistence
                    if (typeof Persistence !== 'undefined') {
                        // Re-create blob if needed or just save the buffer if possible (Persistence expects Blob/File)
                        const blob = new Blob([self.pdfLibData], { type: 'application/pdf' });
                        Persistence.saveFile(blob);
                        Persistence.saveMetadata({ name: file.name, date: new Date().toISOString() });
                    }

                    await self.displayMetadata();

                    // AUTO-DETECT NAMES (Added Feature)
                    setTimeout(() => {
                        self.autoDetectNames();
                    }, 500);

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

        // Update validation progress bar
        this.updateValidationProgress();

        // 1. First, create ALL wrappers in correct order (Synchronous)
        // This ensures Page 1 is always before Page 2, regardless of render speed.
        const renderTasks = [];

        for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
            // Create page wrapper
            const pageWrapper = document.createElement('div');
            pageWrapper.className = 'pdf-page-wrapper';
            pageWrapper.id = `page-wrapper-${pageNum}`;
            pageWrapper.dataset.page = pageNum;
            pageWrapper.style.position = 'relative';
            pageWrapper.style.marginBottom = '20px';
            pageWrapper.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';

            // --- VALIDATION HEADER START ---
            const validationHeader = document.createElement('div');
            validationHeader.className = 'page-validation-header';
            validationHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; background: var(--bg-secondary); padding: 0.5rem; border-radius: 4px;';

            const isChecked = this.validatedPages.has(pageNum);
            const statusText = isChecked ? '✅ Gecontroleerd' : 'Markeer als gecontroleerd';

            validationHeader.innerHTML = `
                <div class="page-label" style="font-weight: bold;">Pagina ${pageNum}</div>
                <label class="validation-toggle" style="cursor: pointer; display: flex; align-items: center; gap: 0.5rem;">
                    <input type="checkbox" class="validation-checkbox" data-page="${pageNum}" ${isChecked ? 'checked' : ''}>
                    <span class="validation-status-text" style="font-size: 0.9rem; color: var(--text-color);">${statusText}</span>
                </label>
            `;
            pageWrapper.appendChild(validationHeader);
            // --- VALIDATION HEADER END ---

            // Canvas Wrapper
            const canvasWrapper = document.createElement('div');
            canvasWrapper.className = 'canvas-wrapper';
            canvasWrapper.style.position = 'relative';
            if (isChecked) canvasWrapper.classList.add('page-validated');
            pageWrapper.appendChild(canvasWrapper);

            // Container Append (Order Guaranteed)
            container.appendChild(pageWrapper);
            this.pageContainers.push(pageWrapper);

            // Bind checkbox event
            const checkbox = validationHeader.querySelector('.validation-checkbox');
            checkbox.addEventListener('change', (e) => {
                this.togglePageValidation(pageNum, e.target.checked);
            });

            // 2. Prepare Async Render Task
            renderTasks.push(async () => {
                const page = await this.pdfDoc.getPage(pageNum);
                const viewport = page.getViewport({ scale: this.scale });

                // Store unscaled dimensions
                const unscaledViewport = page.getViewport({ scale: 1.0 });
                this.pageDimensions[pageNum] = {
                    width: unscaledViewport.width,
                    height: unscaledViewport.height
                };

                // Create canvas
                const canvas = document.createElement('canvas');
                canvas.className = 'pdf-page-canvas';
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                canvas.style.display = 'block';

                const context = canvas.getContext('2d');
                await page.render({
                    canvasContext: context,
                    viewport: viewport
                }).promise;

                canvasWrapper.appendChild(canvas);
                this.pageCanvases[pageNum - 1] = canvas; // Store by index

                // Create redaction layer
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
                canvasWrapper.appendChild(redactionLayer);

                // Add mouse events
                this.addPageMouseEvents(pageWrapper, pageNum, canvas, redactionLayer);
            });
        }

        // 3. Execute all renders in parallel (Performance fix)
        // We catch errors to avoid one page crash stopping all
        await Promise.all(renderTasks.map(task => task().catch(err => console.error(err))));

        // Update current page indicator
        this.currentPage = 1;
        this.elements.currentPageEl.textContent = 1;

        // Render any existing redactions
        this.renderAllRedactions();
        this.updateUndoRedoUI();
    },

    /**
     * Mark ALL pages as validated
     */
    markAllPagesValidated() {
        if (!confirm('Weet u zeker dat u alle pagina\'s in één keer wilt goedkeuren?')) return;

        for (let i = 1; i <= this.totalPages; i++) {
            this.validatedPages.add(i);
        }

        // Force UI update for all pages
        // Optimization: Instead of re-rendering everything, we just update classes if DOM exists
        for (let i = 1; i <= this.totalPages; i++) {
            const wrapper = document.getElementById(`page-wrapper-${i}`);
            if (wrapper) {
                // Update visual state directly
                const label = wrapper.querySelector('.validation-status-text');
                const canvasWrapper = wrapper.querySelector('.canvas-wrapper');
                const checkbox = wrapper.querySelector('.validation-checkbox');

                if (label) label.textContent = '✅ Gecontroleerd';
                if (canvasWrapper) canvasWrapper.classList.add('page-validated');
                if (checkbox) checkbox.checked = true;
            }
        }

        this.updateValidationProgress();
        this.showToast('✅ Alle pagina\'s zijn goedgekeurd!');
    },

    /**
     * Helper: Toggle page validation status
     */
    togglePageValidation(pageNum, isValidated, autoAdvance = true) {
        // ... (existing logic)
        console.log(`Toggling page ${pageNum} to ${isValidated}`);
        if (isValidated) {
            this.validatedPages.add(pageNum);
        } else {
            this.validatedPages.delete(pageNum);
        }

        const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
        if (wrapper) {
            const label = wrapper.querySelector('.validation-status-text');
            const canvasWrapper = wrapper.querySelector('.canvas-wrapper');
            const checkbox = wrapper.querySelector('.validation-checkbox');

            label.textContent = isValidated ? '✅ Gecontroleerd' : 'Markeer als gecontroleerd';

            if (isValidated) {
                canvasWrapper.classList.add('page-validated');
            } else {
                canvasWrapper.classList.remove('page-validated');
            }

            // Force checkbox state
            if (checkbox) checkbox.checked = isValidated;
        }

        this.updateValidationProgress();
        if (this.renderPageList) this.renderPageList();

        // AUTO-ADVANCE: If validated, go to next page
        if (isValidated && autoAdvance && pageNum < this.totalPages) {
            // Small delay for visual feedback
            setTimeout(() => {
                this.goToPage(pageNum + 1);
            }, 300);
        }
    },

    /**
     * Helper: Update validation progress bar
     */
    updateValidationProgress() {
        const count = this.validatedPages.size;
        const total = this.pdfDoc ? this.pdfDoc.numPages : 0;
        const percent = total > 0 ? (count / total) * 100 : 0;

        const bar = document.getElementById('validation-bar');
        const countEl = document.getElementById('validation-count');
        const totalEl = document.getElementById('validation-total');
        const fillEl = document.getElementById('validation-progress-fill');

        if (bar) {
            bar.classList.remove('hidden');
            if (countEl) countEl.textContent = count;
            if (totalEl) totalEl.textContent = total;
            if (fillEl) {
                fillEl.style.width = `${percent}%`;
                fillEl.style.backgroundColor = count === total ? '#10b981' : '#2563eb';
            }
        }

        this.updateExportButtonState();
    },

    /**
     * Update Export Button State
     */
    updateExportButtonState() {
        if (!this.elements.btnExport) return;

        // Validation is now soft-check (warning only)
        // We always allow export, but visual feedback is nice
        const allValidated = this.validatedPages.size === this.totalPages;
        this.elements.btnExport.classList.remove('btn-disabled'); // Ensure always enabled

        if (allValidated) {
            this.elements.btnExport.title = "Exporteer veilige PDF";
        } else {
            this.elements.btnExport.title = `Nog ${this.totalPages - this.validatedPages.size} pagina's te controleren (Klik om toch te exporteren)`;
        }
    },

    /**
     * Add mouse events for drawing redactions on a page
     */
    addPageMouseEvents(wrapper, pageNum, canvas, redactionLayer) {
        wrapper.addEventListener('mousedown', (e) => {
            if (this.currentTool !== 'redact') return;

            // Fix: Ignore clicks on validation controls
            if (e.target.closest('.validation-toggle')) return;

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
                    // Get actual page height for correct coordinate conversion
                    const page = await this.pdfDoc.getPage(pageNum);
                    const viewport = page.getViewport({ scale: 1.0 });
                    const pageHeight = viewport.height;

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

                            // Global redaction prompt -> AUTO APPLY
                            // Global redaction prompt -> AUTO APPLY logic
                            // Heuristic: 
                            // > 4 chars: Safe to assume it's a word/name -> Auto apply
                            // 2-4 chars: Ambiguous (could be "van" or signature noise) -> Ask
                            // < 2 chars: Ignored (local only)

                            if (foundText.length > 4) {
                                this.showToast(`Automatisch "${foundText}" overal gelakt.`);
                                this.applyRedactionGlobally(foundText);
                            } else if (foundText.length >= 2) {
                                // Small delay to let the UI update first
                                setTimeout(() => {
                                    if (confirm(`Tekst herkend: "${foundText}"\n\nWil je dit woord OVERAL in het document zwart lakken?`)) {
                                        this.applyRedactionGlobally(foundText);
                                    }
                                }, 50);
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
     * IMPROVED: Uses overlap percentage to find the BEST matching text,
     * not just any text that touches the selection area.
     */
    async extractTextFromBounds(pageNum, pdfBounds) {
        try {
            const page = await this.pdfDoc.getPage(pageNum);
            const textContent = await page.getTextContent();

            // Store matches with their overlap scores
            const matches = [];

            for (const item of textContent.items) {
                if (!item.str || !item.str.trim()) continue;

                const itemX = item.transform[4];
                const itemY = item.transform[5];
                const itemHeight = item.height || 10;
                const itemWidth = item.width || (item.str.length * 5);

                // Calculate intersection area
                const xOverlapStart = Math.max(itemX, pdfBounds.x);
                const xOverlapEnd = Math.min(itemX + itemWidth, pdfBounds.x + pdfBounds.width);
                const yOverlapStart = Math.max(itemY, pdfBounds.y);
                const yOverlapEnd = Math.min(itemY + itemHeight, pdfBounds.y + pdfBounds.height);

                const xOverlap = Math.max(0, xOverlapEnd - xOverlapStart);
                const yOverlap = Math.max(0, yOverlapEnd - yOverlapStart);
                const overlapArea = xOverlap * yOverlap;

                if (overlapArea > 0) {
                    const itemArea = itemWidth * itemHeight;
                    const overlapPercent = (overlapArea / itemArea) * 100;

                    // Only consider items with >30% overlap (configurable threshold)
                    if (overlapPercent > 30) {
                        matches.push({
                            text: item.str.trim(),
                            overlapPercent: overlapPercent,
                            area: itemArea,
                            x: itemX,
                            y: itemY
                        });
                    }
                }
            }

            // Sort by overlap percentage (highest first)
            matches.sort((a, b) => b.overlapPercent - a.overlapPercent);

            // If we found good matches
            if (matches.length > 0) {
                // SMART SELECTION:
                // If the top match has >70% overlap, it's likely the target - return just that
                // Otherwise, combine adjacent items that are on the same line (similar Y)

                const bestMatch = matches[0];

                if (bestMatch.overlapPercent > 70 && matches.length === 1) {
                    // Single clear match
                    return bestMatch.text;
                }

                // Multiple matches - filter to only those on similar Y (same line)
                // and with >50% overlap
                const lineMatches = matches.filter(m =>
                    m.overlapPercent > 50 &&
                    Math.abs(m.y - bestMatch.y) < 15  // Same line (within 15 PDF units)
                );

                // Sort by X position to get reading order
                lineMatches.sort((a, b) => a.x - b.x);

                // Join texts, remove duplicates
                const uniqueTexts = [...new Set(lineMatches.map(m => m.text))];
                return uniqueTexts.join(' ').trim();
            }

            // FALLBACK: If no overlap matches, find the CLOSEST single item
            console.log("No overlap matches, trying nearest neighbor...");

            const boxCenterX = pdfBounds.x + (pdfBounds.width / 2);
            const boxCenterY = pdfBounds.y + (pdfBounds.height / 2);

            let closestItem = null;
            let minDistance = Infinity;
            const MAX_DISTANCE = 20;

            for (const item of textContent.items) {
                if (!item.str || !item.str.trim()) continue;

                const itemWidth = item.width || (item.str.length * 4);
                const itemHeight = item.height || 10;
                const itemCenterX = item.transform[4] + (itemWidth / 2);
                const itemCenterY = item.transform[5] + (itemHeight / 2);

                const dx = boxCenterX - itemCenterX;
                const dy = boxCenterY - itemCenterY;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < minDistance && dist < MAX_DISTANCE) {
                    minDistance = dist;
                    closestItem = item;
                }
            }

            if (closestItem) {
                console.log(`Found nearest item: "${closestItem.str}" (dist: ${minDistance.toFixed(2)})`);
                return closestItem.str.trim();
            }

            return "";
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
        if (!container) return;

        const viewCenter = container.scrollTop + (container.clientHeight / 2);

        // Find the page that contains the center point of the view
        for (let i = 0; i < this.pageContainers.length; i++) {
            const pageWrapper = this.pageContainers[i];

            // Calculate strictly relative to the container scrolling content
            const pageTop = pageWrapper.offsetTop;
            const pageBottom = pageTop + pageWrapper.offsetHeight;

            if (viewCenter >= pageTop && viewCenter <= pageBottom) {
                const newPage = i + 1;
                if (this.currentPage !== newPage) {
                    this.currentPage = newPage;
                    this.elements.currentPageEl.textContent = this.currentPage;
                    // console.log(`Current page updated to: ${newPage}`);
                }
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

                // Use actual page height if available, otherwise fallback to A4
                const dims = this.pageDimensions[pageNum];
                const pageHeight = dims ? dims.height : 842;

                const canvasBounds = Redactor.pdfToCanvasCoords(
                    redaction.bounds,
                    pageHeight,
                    this.scale
                );

                box.style.left = canvasBounds.x + 'px';
                box.style.top = canvasBounds.y + 'px';
                box.style.width = canvasBounds.width + 'px';
                box.style.width = canvasBounds.width + 'px';
                box.style.height = canvasBounds.height + 'px';

                // VISUAL SIGNAL WORDS (Yellow Highlight)
                if (redaction.type === 'indicator') {
                    box.style.backgroundColor = 'rgba(255, 215, 0, 0.3)'; // Transparent Yellow
                    box.style.border = '2px dashed #fbc02d'; // Orange-Yellow border
                    box.title = 'Signaalwoord: Klik om zwart te lakken';

                    // Click to convert to real redaction
                    box.addEventListener('click', async (e) => {
                        e.stopPropagation(); // Prevent other clicks

                        // Ignore if we just dragged the box
                        if (this.isDragging) return;

                        if (confirm(`Wil je "${redaction.value}" zwart lakken?`)) {
                            // Convert to manual redaction
                            redaction.type = 'manual';
                            // Call update to refresh UI
                            await this.renderAllRedactions();
                            this.updateRedactionsList();
                        }
                    });
                }

                // Delete button - Now for BOTH standard and indicators
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'redaction-delete-btn';
                deleteBtn.innerHTML = '✕';
                deleteBtn.title = 'Verwijder redactie';
                // Adjust color for indicators if needed
                if (redaction.type === 'indicator') {
                    deleteBtn.style.background = 'rgba(0,0,0,0.1)';
                    deleteBtn.style.color = '#333';
                }

                // Use mousedown to prevent drag-start from interfering
                deleteBtn.addEventListener('mousedown', async (e) => {
                    e.stopPropagation(); // Crucial
                    e.preventDefault();  // Prevent focus theft
                    console.log('Delete button clicked for:', redaction);

                    try {
                        const allRedactions = Redactor.getAllRedactions();
                        const instances = allRedactions.filter(r => r.value === redaction.value && redaction.value);

                        // FIX: For manual redactions, default to single delete to avoid accidents
                        // Only prompt for global delete if it's a learned/detected pattern OR if user explicitly asks (future feat)

                        if (redaction.type !== 'manual' && instances.length > 1) {
                            const confirmGlobal = confirm(`Dit woord komt ${instances.length} keer voor. Wil je deze OVERAL verwijderen?\n\nOK = Overal\nAnnuleren = Alleen dit exemplaar`);
                            if (confirmGlobal) {
                                if (typeof Detector !== 'undefined' && Detector.ignoreWord) {
                                    Detector.ignoreWord(redaction.value);
                                }
                                this.removeRedactionGlobally(redaction.value);
                            } else {
                                Redactor.removeRedaction(redaction.id);
                            }
                        } else {
                            // Manual redaction OR single instance -> Always single delete
                            Redactor.removeRedaction(redaction.id);
                        }
                    } catch (err) {
                        console.error('Delete failed:', err);
                        alert('Fout bij verwijderen: ' + err.message);
                    }

                    // Force re-render
                    await this.renderAllRedactions();
                    this.updateRedactionsList();
                });
                box.appendChild(deleteBtn);

                // SHARED INTERACTION (Move & Resize) - Applies to ALL types including indicators

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

                // Bidirectional Highlighting
                box.addEventListener('click', (e) => {
                    if (e.target === box || e.target.classList.contains('redaction-resize-handle')) {
                        e.stopPropagation();

                        // 1. Remove highlight from all items
                        document.querySelectorAll('.redaction-item').forEach(el => el.classList.remove('selected'));

                        // 2. Find and highlight sidebar item
                        const sidebarItem = document.querySelector(`.redaction-item[data-id="${redaction.id}"]`);
                        if (sidebarItem) {
                            sidebarItem.classList.add('selected');
                            sidebarItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    }
                });

                redactionLayer.appendChild(box);
            }
        }
        this.updateUndoRedoUI();
    },

    /**
     * Update Undo/Redo button states
     */
    updateUndoRedoUI() {
        const btnUndo = document.getElementById('btn-undo');
        const btnRedo = document.getElementById('btn-redo');

        if (btnUndo) {
            btnUndo.disabled = !Redactor.canUndo();
            btnUndo.style.opacity = btnUndo.disabled ? '0.5' : '1';
        }
        if (btnRedo) {
            btnRedo.disabled = !Redactor.canRedo();
            btnRedo.style.opacity = btnRedo.disabled ? '0.5' : '1';
        }
    },

    /**
     * Find and redact a specific word/phrase across the entire document
     */
    async applyRedactionGlobally(textToRedact) {
        if (!this.pdfDoc || !textToRedact) return;

        const cleanSearch = textToRedact.trim().toLowerCase();
        if (cleanSearch.length < 2) return;

        // Normalize for comparison: remove spaces
        const normalizedSearch = cleanSearch.replace(/\s+/g, '');

        console.log(`Applying global redaction for: "${cleanSearch}" (normalized: "${normalizedSearch}")`);
        let totalApplied = 0;

        for (let pageNum = 1; pageNum <= this.pdfDoc.numPages; pageNum++) {
            const page = await this.pdfDoc.getPage(pageNum);
            const textContent = await page.getTextContent();
            const textItems = textContent.items;

            // Iterate through each text item as a potential starting point
            for (let itemIndex = 0; itemIndex < textItems.length; itemIndex++) {
                const startItem = textItems[itemIndex];
                if (!startItem || !startItem.str) continue;

                // Build a combined string from this item + up to 4 more (lookahead of 5 total)
                let combined = startItem.str;
                let normalizedCombined = combined.toLowerCase().replace(/\s+/g, '');
                const itemsInSequence = [startItem];

                // Check single item first
                if (normalizedCombined.includes(normalizedSearch)) {
                    // Single item match!
                    const bounds = {
                        x: startItem.transform[4],
                        y: startItem.transform[5],
                        width: startItem.width > 0 ? startItem.width : (startItem.str.length * 5),
                        height: startItem.height || 12
                    };

                    if (!this.isAreaRedacted(pageNum, bounds)) {
                        console.log(`Global match (single) on p${pageNum}: "${startItem.str}"`);
                        Redactor.addRedaction(pageNum, bounds, 'learned', cleanSearch);
                        totalApplied++;
                    }
                    continue; // Move to next item
                }

                // Not found in single item, look ahead up to 4 more items
                for (let ahead = 1; ahead <= 4; ahead++) {
                    const nextItem = textItems[itemIndex + ahead];
                    if (!nextItem || !nextItem.str) break;

                    combined += ' ' + nextItem.str;
                    normalizedCombined = combined.toLowerCase().replace(/\s+/g, '');
                    itemsInSequence.push(nextItem);

                    // Check if the combined text contains the search term
                    if (normalizedCombined.includes(normalizedSearch)) {
                        // Calculate union bounds of all items in sequence
                        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

                        itemsInSequence.forEach(seqItem => {
                            const bx = seqItem.transform[4];
                            const by = seqItem.transform[5];
                            const bh = seqItem.height || 12;
                            const bw = seqItem.width > 0 ? seqItem.width : (seqItem.str.length * 5);

                            minX = Math.min(minX, bx);
                            minY = Math.min(minY, by);
                            maxX = Math.max(maxX, bx + bw);
                            maxY = Math.max(maxY, by + bh);
                        });

                        const unionBounds = {
                            x: minX,
                            y: minY,
                            width: maxX - minX,
                            height: maxY - minY
                        };

                        if (!this.isAreaRedacted(pageNum, unionBounds)) {
                            console.log(`Global match (sequence) on p${pageNum}: "${combined}"`);
                            Redactor.addRedaction(pageNum, unionBounds, 'learned', cleanSearch);
                            totalApplied++;
                        }
                        break; // Found it, stop looking ahead
                    }
                }
            }
        }

        if (totalApplied > 0) {
            this.showToast(`Nog ${totalApplied} keer "${textToRedact}" automatisch zwartgelakt.`);
            await this.renderAllRedactions();
            this.updateRedactionsList();
        }
    },

    /**
     * Check if an area is already covered by a redaction
     */
    isAreaRedacted(pageNum, bounds) {
        const pageRedactions = Redactor.redactions[pageNum] || [];
        return pageRedactions.some(r => {
            // Check intersection with existing redactions
            // Logic fixed: access r.bounds instead of r direct x/y
            const b = r.bounds;
            // A tolerant intersection check
            return (bounds.x < b.x + b.width &&
                bounds.x + bounds.width > b.x &&
                bounds.y < b.y + b.height &&
                bounds.y + bounds.height > b.y);

            /* Old incorrect logic:
            return (bounds.x >= r.x && bounds.x + bounds.width <= r.x + r.width &&
                bounds.y >= r.y && bounds.y + bounds.height <= r.y + r.height);
            */
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

        // Iterate over Map (pageNum -> redactionsArray)
        // Check if Redactor.redactions is Map or Object to be safe
        const isMap = Redactor.redactions instanceof Map;

        if (isMap) {
            for (const [pageNum, pageRedactions] of Redactor.redactions) {
                const initialLength = pageRedactions.length;
                const keptRedactions = pageRedactions.filter(r => r.value !== value);

                if (keptRedactions.length < initialLength) {
                    count += (initialLength - keptRedactions.length);
                    if (keptRedactions.length === 0) {
                        Redactor.redactions.delete(pageNum);
                    } else {
                        Redactor.redactions.set(pageNum, keptRedactions);
                    }
                }
            }
        } else {
            // Fallback if it's somehow an Object (shouldn't be, but robust)
            Object.keys(Redactor.redactions).forEach(pageNum => {
                const pageRedactions = Redactor.redactions[pageNum];
                const initialLength = pageRedactions.length;
                const keptRedactions = pageRedactions.filter(r => r.value !== value);
                if (keptRedactions.length < initialLength) {
                    count += (initialLength - keptRedactions.length);
                    Redactor.redactions[pageNum] = keptRedactions;
                }
            });
        }

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

        // Reset drag state
        this.isDragging = false;

        const onMouseMove = (e) => {
            const dx = (e.clientX - startX) / this.scale;
            const dy = (e.clientY - startY) / this.scale;

            // If moved more than a few pixels, consider it a drag
            if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) {
                this.isDragging = true;
            }

            if (!this.isDragging) return;

            redaction.bounds.x = startBounds.x + dx;
            redaction.bounds.y = startBounds.y - dy;
            this.renderAllRedactions();
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            this.updateRedactionsList();

            // Delay resetting isDragging so click handler can check it
            setTimeout(() => {
                this.isDragging = false;
            }, 100);
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

        // Store dimensions for detection
        this.pageDimensions = []; // Reset
        this.pageDimensions[1] = {
            width: img.width,
            height: img.height
        };

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
     * Render the list of pages in the sidebar
     */
    renderPageList() {
        // Create section if it doesn't exist
        let sidebarSection = document.querySelector('.page-list-section');
        if (!sidebarSection) {
            sidebarSection = document.createElement('div');
            sidebarSection.className = 'sidebar-section page-list-section';
            sidebarSection.innerHTML = '<h3>Pagina\'s</h3>';

            // Find correct place to insert (before Redactions)
            const sidebar = this.elements.detectionsList.closest('.sidebar');
            const redactionsSection = this.elements.redactionsList.closest('.sidebar-section');
            if (sidebar && redactionsSection) {
                sidebar.insertBefore(sidebarSection, redactionsSection);
            }
        }

        // Clear list
        let list = sidebarSection.querySelector('.detections-list');
        if (!list) {
            list = document.createElement('div');
            list.className = 'detections-list'; // Reuse styling
            list.style.maxHeight = '300px';
            sidebarSection.appendChild(list);
        } else {
            list.innerHTML = '';
        }

        for (let i = 1; i <= this.totalPages; i++) {
            const item = document.createElement('div');
            item.className = 'detection-item'; // Reuse styling
            item.style.justifyContent = 'flex-start';
            item.style.gap = '10px';

            const isValidated = this.validatedPages.has(i);
            const statusIcon = isValidated ? '✅' : '📄';

            item.innerHTML = `
                <span style="font-size: 1.2em">${statusIcon}</span>
                <span>Pagina ${i}</span>
            `;

            // Highlight current page
            if (i === this.currentPage) {
                item.style.background = 'var(--bg-glass-hover)';
                item.style.borderLeft = '3px solid var(--accent-primary)';
            }

            item.addEventListener('click', () => {
                this.goToPage(i);
            });

            list.appendChild(item);
        }
    },


    /**
     * Zoom in/out
     */
    zoom(delta) {
        const container = this.elements.pdfViewer;
        const currentScale = this.scale;
        const newScale = Math.max(0.5, Math.min(3, currentScale + delta));

        // Calculate center point relative to content height
        // scrollTop + half viewport height = visual center
        const viewCenterRatio = (container.scrollTop + container.clientHeight / 2) / container.scrollHeight;

        this.scale = newScale;
        this.elements.zoomLevel.textContent = Math.round(this.scale * 100) + '%';

        if (this.pdfDoc) {
            this.renderAllPages().then(() => {
                // Restore center point
                // New scrollHeight is roughly old * (newScale / oldScale)
                // But safer to just take the new scrollHeight
                const newScrollTop = (viewCenterRatio * container.scrollHeight) - (container.clientHeight / 2);
                container.scrollTop = newScrollTop;
            });
        } else if (this.currentImage) {
            this.renderImagePage(this.currentImage);
        }
    },

    /**
     * Scroll to specific page
     */
    goToPage(pageNumber) {
        if (pageNumber >= 1 && pageNumber <= this.totalPages && this.pageContainers[pageNumber - 1]) {
            // Update state IMMEDIATELY so keyboard shortcuts work right away
            this.currentPage = pageNumber;
            this.elements.currentPageEl.textContent = pageNumber;

            this.pageContainers[pageNumber - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        const list = this.elements.redactionsList;
        list.innerHTML = '';

        const redactions = Redactor.getAllRedactions();

        // Save state to persistence on every update
        if (typeof Persistence !== 'undefined') {
            const state = JSON.stringify(Array.from(Redactor.redactions.entries()));
            Persistence.saveState(state);
        }

        if (redactions.length === 0) {
            list.innerHTML = '<p class="empty-state">Nog geen redacties toegevoegd</p>';
            return;
        }

        // Sort by page number then Y position
        redactions.sort((a, b) => {
            if (a.page !== b.page) return a.page - b.page;
            return a.bounds.y - b.bounds.y;
        });

        redactions.forEach(r => {
            const item = document.createElement('div');
            item.className = 'redaction-item';
            item.dataset.id = r.id; // Crucial for bidirectional highlighting

            // Determine display text
            let displayText = r.value || (r.type === 'manual' ? 'Handmatige selectie' : 'Gedetecteerd item');
            let icon = '✏️';

            if (r.type !== 'manual') icon = '🔍';
            if (r.value) icon = '📝'; // Icon for text-based redactions

            item.innerHTML = `
                <div style="display:flex; flex-direction:column; gap:2px;">
                    <span style="font-weight:500; font-size: 0.9em;">
                        ${icon} ${displayText.length > 25 ? displayText.substring(0, 25) + '...' : displayText}
                    </span>
                    <span class="type">Pagina ${r.page} • ${r.type}</span>
                </div>
                <button class="btn-delete-redaction" title="Verwijder">✕</button>
            `;

            // Click to scroll to redaction
            item.addEventListener('click', () => {
                this.goToPage(r.page);
                setTimeout(() => {
                    const box = document.querySelector(`.redaction-box[data-id="${r.id}"]`);
                    if (box) {
                        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        // Remove highlight from others
                        document.querySelectorAll('.redaction-box').forEach(el => el.style.boxShadow = '');
                        // Add highlight
                        box.style.boxShadow = '0 0 0 4px var(--accent-warning)';
                        setTimeout(() => box.style.boxShadow = '', 2000);
                    }
                }, 100);
            });

            // Delete button
            const deleteBtn = item.querySelector('.btn-delete-redaction');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();

                const allRedactions = Redactor.getAllRedactions();
                const instances = allRedactions.filter(rd => rd.value === r.value && r.value);

                if (instances.length > 1) {
                    const confirmGlobal = confirm(`Dit woord komt ${instances.length} keer voor. Wil je deze OVERAL verwijderen?\n\nOK = Overal\nAnnuleren = Alleen dit exemplaar`);
                    if (confirmGlobal) {
                        this.removeRedactionGlobally(r.value);
                    } else {
                        Redactor.removeRedaction(r.id);
                    }
                } else {
                    Redactor.removeRedaction(r.id);
                }

                this.renderAllRedactions();
                this.updateRedactionsList();
            });

            list.appendChild(item);
        });
    },
    // End of updateRedactionsList


    /**
     * Automatic Name Detection on Load
     * Scans specifically for names (via prefixes) and adds them as indicators
     */
    async autoDetectNames() {
        if (!this.pdfDoc) return;

        console.log("Starting auto-detection for names...");
        this.showToast("🔎 Scannen op namen...");

        let totalFound = 0;

        try {
            // Loop through all pages
            const numPages = this.pdfDoc.numPages;

            for (let i = 1; i <= numPages; i++) {
                const page = await this.pdfDoc.getPage(i);
                const textContent = await page.getTextContent();
                const text = textContent.items.map(item => item.str).join(' ');

                // Use Detector but only take 'names' category
                const results = Detector.detect(text, i);

                if (results.byCategory && results.byCategory['names']) {
                    const names = results.byCategory['names'].items;

                    for (const item of names) {
                        // Create INDICATOR redaction
                        // Map text index to PDF bounds
                        const bounds = await this.findTextBoundsOnPage(i, item.value);
                        if (bounds) {
                            if (!this.isAreaRedacted(i, bounds)) {
                                // Add as indicator (yellow box)
                                Redactor.addRedaction(i, bounds, 'indicator', item.value);
                                totalFound++;
                            }
                        }
                    }
                }

                // Yield to UI thread every few pages
                if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
            }

            if (totalFound > 0) {
                this.showToast(`✨ ${totalFound} mogelijke namen gemarkeerd.`);
                await this.renderAllRedactions();
                this.updateRedactionsList();
            } else {
                console.log("Auto-detection finished: No names found.");
            }

        } catch (err) {
            console.error("Auto-detect error:", err);
        }
    },

    /**
     * Helper to find bounds of specific text on a page
     * (Simplified version of global search logic)
     */
    async findTextBoundsOnPage(pageNum, textToFind) {
        try {
            const page = await this.pdfDoc.getPage(pageNum);
            const textContent = await page.getTextContent();
            const textItems = textContent.items;

            const cleanSearch = textToFind.trim().toLowerCase().replace(/\s+/g, '');
            if (!cleanSearch) return null;

            for (let itemIndex = 0; itemIndex < textItems.length; itemIndex++) {
                const startItem = textItems[itemIndex];

                // Try single item match
                let combined = startItem.str;
                let normalizedCombined = combined.toLowerCase().replace(/\s+/g, '');

                if (normalizedCombined.includes(cleanSearch)) {
                    // Found in single item
                    return {
                        x: startItem.transform[4],
                        y: startItem.transform[5],
                        width: startItem.width || (startItem.str.length * 5),
                        height: startItem.height || 12
                    };
                }

                // Try sequence (up to 4 items)
                const itemsInSequence = [startItem];
                for (let ahead = 1; ahead <= 4; ahead++) {
                    const nextItem = textItems[itemIndex + ahead];
                    if (!nextItem) break;

                    combined += ' ' + nextItem.str;
                    normalizedCombined = combined.toLowerCase().replace(/\s+/g, '');
                    itemsInSequence.push(nextItem);

                    if (normalizedCombined.includes(cleanSearch)) {
                        // Found in sequence - calculate union bounds
                        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                        itemsInSequence.forEach(seqItem => {
                            const bx = seqItem.transform[4];
                            const by = seqItem.transform[5];
                            const bh = seqItem.height || 12;
                            const bw = seqItem.width || (seqItem.str.length * 5);
                            minX = Math.min(minX, bx);
                            minY = Math.min(minY, by);
                            maxX = Math.max(maxX, bx + bw);
                            maxY = Math.max(maxY, by + bh);
                        });

                        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
                    }
                }
            }
        } catch (e) {
            console.error("Bounds search error:", e);
        }
        return null;
    },

    /**
     * Open detection modal
     */
    async openDetectionModal() {
        this.elements.modal.classList.remove('hidden');
        // ... (rest of implementation)

        this.elements.detectionProgress.classList.remove('hidden');
        this.elements.detectionResults.classList.add('hidden');
        this.elements.btnApplyDetections.classList.add('hidden');

        try {
            await this.runDetection();
        } catch (error) {
            console.error('Detection failed:', error);
            this.elements.detectionResults.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: var(--accent-danger);">
                    <p>❌ Er is een fout opgetreden tijdens het scannen.</p>
                    <p style="font-size: 0.8em; margin-top: 0.5rem;">${error.message}</p>
                </div>
            `;
            this.elements.detectionProgress.classList.add('hidden');
            this.elements.detectionResults.classList.remove('hidden');
        }

        // Feature: AI Vision Trigger
        if (typeof MistralService !== 'undefined') {
            const footer = this.elements.modal.querySelector('.modal-footer');
            let visionBtn = document.getElementById('btn-vision-scan');
            if (!visionBtn) {
                visionBtn = document.createElement('button');
                visionBtn.id = 'btn-vision-scan';
                visionBtn.className = 'btn btn-warning'; // Distinct color
                visionBtn.style.marginRight = 'auto'; // Push to left
                visionBtn.innerHTML = '👁️ Visuele Scan (Handtekeningen)';
                visionBtn.title = 'Gebruik AI Vision om krabbels en handtekeningen te vinden (Traag)';
                visionBtn.addEventListener('click', () => this.runVisualDetection());
                footer.insertBefore(visionBtn, footer.firstChild);
            }
            visionBtn.classList.remove('hidden');
        }
    },

    /**
     * Run Visual Detection (Vision API)
     */
    async runVisualDetection() {
        if (!confirm("Visuele scan duurt langer (een paar seconden per pagina). Wil je doorgaan?")) return;

        this.elements.detectionResults.classList.add('hidden');
        this.elements.detectionProgress.classList.remove('hidden');
        const progressText = this.elements.detectionProgress.querySelector('p');

        let totalSignatures = 0;

        for (let i = 1; i <= this.totalPages; i++) {
            progressText.textContent = `Visuele analyse van pagina ${i}/${this.totalPages}...`;

            try {
                let base64;
                // Get page canvas
                if (this.pdfDoc) {
                    const page = await this.pdfDoc.getPage(i);
                    const viewport = page.getViewport({ scale: 1.5 }); // Higher quality for vision
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    await page.render({ canvasContext: context, viewport: viewport }).promise;
                    base64 = canvas.toDataURL('image/jpeg', 0.8);
                } else if (this.currentImage && i === 1) {
                    // Image support
                    const canvas = document.createElement('canvas');
                    // Limit max size for API performance? 
                    // For now use full size or scaled if huge
                    canvas.width = this.currentImage.width;
                    canvas.height = this.currentImage.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(this.currentImage, 0, 0);
                    base64 = canvas.toDataURL('image/jpeg', 0.8);
                } else {
                    continue;
                }

                // Call Vision API

                // Call Vision API
                const signatures = await MistralService.analyzeImage(base64, i);

                // Process Results
                if (signatures && signatures.length > 0) {
                    signatures.forEach((sig, index) => {
                        // Sig bounds are normalized [xmin, ymin, xmax, ymax, confidence]
                        const [xmin, ymin, xmax, ymax, confidence = 100] = sig;

                        // Filter: Low confidence (less than 60%)
                        if (confidence < 60) {
                            console.log(`Skipping signature: Low confidence (${confidence}%)`);
                            return;
                        }

                        // Get dimensions
                        const pdfPageWidth = this.pageDimensions[i].width;
                        const pdfPageHeight = this.pageDimensions[i].height;

                        const width = ((xmax - xmin) / 1000) * pdfPageWidth;
                        const height = ((ymax - ymin) / 1000) * pdfPageHeight;

                        // Filter: Too small (likely noise/dots)
                        // E.g. less than 1% of page width or height
                        if (width < pdfPageWidth * 0.02 || height < pdfPageHeight * 0.01) {
                            console.log(`Skipping signature: Too small (${width.toFixed(0)}x${height.toFixed(0)})`);
                            return;
                        }

                        const x = (xmin / 1000) * pdfPageWidth;

                        // Y is messy. Vision usually gives top-down. PDF is bottom-up.
                        // But wait, our API prompt said normalized coordinates. 
                        // Let's assume Top-Left 0,0 for Vision. 
                        // PDF 0,0 is Bottom-Left.
                        // So y (bottom) = PageHeight - (y_top + height)
                        // y_top_px = (ymin / 1000) * pdfPageHeight
                        const yTop = (ymin / 1000) * pdfPageHeight;
                        const yBottom = pdfPageHeight - yTop - height;

                        // Add to detections
                        if (!this.currentDetections.byCategory['signature']) {
                            this.currentDetections.byCategory['signature'] = {
                                name: 'Visuele Handtekeningen',
                                icon: '✍️',
                                items: []
                            };
                        }

                        const sigValue = `Handtekening (Visueel) - P${i}-${index + 1}`;

                        this.currentDetections.all.push({
                            type: 'signature',
                            value: sigValue,
                            page: i,
                            bounds: { x, y: yBottom, width, height },
                            selected: true
                        });

                        this.currentDetections.byCategory['signature'].items.push({
                            type: 'signature',
                            value: sigValue,
                            page: i,
                            bounds: { x, y: yBottom, width, height },
                            selected: true,
                            name: `Visuele Handtekening ${index + 1}`
                        });

                        totalSignatures++;
                    });
                }

            } catch (err) {
                console.error(`Visual scan failed for page ${i}`, err);
            }
        }

        // Update UI
        this.displayDetectionResults(this.currentDetections);
        this.showToast(`Visuele scan klaar. ${totalSignatures} handtekeningen gevonden.`);
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

        // Guard: Text detection requires PDF text layer
        if (!this.pdfDoc) {
            console.log("Text detection skipped: No PDF loaded (likely an image).");
            this.currentDetections = allDetections;
            this.displayDetectionResults(allDetections);
            return;
        }

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
                                let name = 'AI: ' + (item.type.charAt(0).toUpperCase() + item.type.slice(1));
                                let icon = '🤖';

                                if (item.type === 'indicator') {
                                    name = 'Signaalwoord';
                                    icon = '👁️';
                                }

                                pageDetections.all.push({
                                    type: item.type, // Map 'name', 'email', etc.
                                    name: name,
                                    icon: icon,
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
                    // Start with exact text bounds
                    detection.bounds = bounds;

                    // Feature: Auto-expand for signatures
                    if (detection.type === 'signature') {
                        // Signatures are usually ABOVE the line "Handtekening"
                        // Expand significantly upwards
                        detection.bounds = {
                            x: bounds.x - 20, // A bit wider
                            y: bounds.y + bounds.height + 5, // PDF coords: Y is bottom-up. +Y means UP.
                            width: bounds.width + 100, // Make it wide enough for a signature
                            height: 60 // Capture 60pts above the text
                        };
                        detection.name = "Handtekening (Gebied)";
                        detection.selected = true; // Auto-select signatures
                    }
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
                // PDF coordinates: item.y is the baseline.
                // We want the box bottom to be slightly below baseline (for descenders)
                const y = item.y - (fontHeight * 0.25);
                const height = fontHeight * 1.25;

                // Calculate width: use provided width or fallback estimate
                const width = item.width || (item.str.length * fontHeight * 0.6);


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
                                    <span class="value">${group.value} ${countLabel}</span>
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
                    <div class="detection-item" style="${style}" data-value="${item.value}">
                        <div style="flex:1; overflow:hidden;" onclick="document.querySelector('#sidebar-action-handlers').dispatchEvent(new CustomEvent('jump', {detail: {page: ${item.page}, value: '${item.value.replace(/'/g, "\\'")}'}}))">
                            <span class="type">${item.icon || '🔹'} ${item.name} <span style="font-size:0.8em; opacity:0.7;">(P${item.page})</span></span><br>
                            <span class="value" title="${item.value}">${item.value}</span>
                        </div>
                        <button class="btn-icon-small delete-detection" title="Negeer dit woord" onclick="event.stopPropagation(); document.querySelector('#sidebar-action-handlers').dispatchEvent(new CustomEvent('ignore', {detail: '${item.value.replace(/'/g, "\\'")}'}))">
                            ✕
                        </button>
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
     * Generate and download an Audit Log CSV
     */
    generateAuditLog() {
        const redactions = Redactor.getAllRedactions();
        if (redactions.length === 0) {
            this.showToast('ℹ️ Er zijn nog geen redacties om te loggen.');
            return;
        }

        // Header
        let csvContent = "Pagina;Type;Reden;Locatie;Inhoud (Veilig);Tijdstip\n";

        // Rows
        redactions.sort((a, b) => a.page - b.page).forEach(r => {
            const type = r.type === 'manual' ? 'Handmatig' : 'Detectie';

            // Determine reason based on type
            let reason = 'Handmatige selectie';
            if (r.type === 'bsn') reason = 'BSN';
            else if (r.type === 'email') reason = 'E-mailadres';
            else if (r.type === 'phone') reason = 'Telefoonnummer';
            else if (r.type === 'iban') reason = 'IBAN';
            else if (r.type === 'postcode') reason = 'Postcode';
            else if (r.type === 'name' || r.type === 'names') reason = 'Persoonsnaam';
            else if (r.type === 'signature') reason = 'Handtekening';

            // Mask content for privacy in the log itself (show only metadata/pattern)
            let content = r.value || '';
            let safeContent = '***';

            if (content.length > 0) {
                if (r.type === 'email') {
                    // m***@domain.com
                    const parts = content.split('@');
                    if (parts.length === 2) {
                        safeContent = content.substring(0, 1) + '***@' + parts[1];
                    }
                } else if (content.length > 5) {
                    // First 1, last 1
                    safeContent = content.substring(0, 1) + '***' + content.substring(content.length - 1);
                }
            }

            const timestamp = new Date().toLocaleString('nl-NL');
            const location = `X:${Math.round(r.bounds.x)} Y:${Math.round(r.bounds.y)}`;

            // Escape semicolons and quotes
            const escape = (txt) => `"${txt && txt.toString().replace(/"/g, '""')}"`;

            csvContent += `${r.page};${type};${reason};${escape(location)};${escape(safeContent)};${timestamp}\n`;
        });

        // Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `audit_log_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    /**
     * Handle keyboard shortcuts
     */
    handleKeyboard(event) {
        if (event.key === 'Escape') {
            this.closeModal();
        }

        if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
            event.preventDefault();
            if (event.shiftKey) {
                // Redo
                if (Redactor.redo()) {
                    this.renderAllRedactions();
                    this.updateRedactionsList();
                    this.updateDetectionsList();
                }
            } else {
                // Undo
                if (Redactor.undo()) {
                    this.renderAllRedactions();
                    this.updateRedactionsList();
                    this.updateDetectionsList();
                }
            }
        }

        // SHORTCUT: Shift+Enter or Cmd+Enter to toggle validation for CURRENT PAGE
        if ((event.shiftKey || event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            if (this.currentPage) {
                const isCurrentlyValidated = this.validatedPages.has(this.currentPage);
                const newState = !isCurrentlyValidated;

                this.togglePageValidation(this.currentPage, newState);

                // Show brief feedback
                const status = newState ? 'Goedgekeurd' : 'Niet meer goedgekeurd';
                this.showToast(`Pagina ${this.currentPage}: ${status}`);

                // Optional: Auto-scroll to next page if approved? 
                // Let's keep it manual for now to avoid confusion.
            }
        }
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
