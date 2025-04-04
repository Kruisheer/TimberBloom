// script.js (Added movable/deletable points)

document.addEventListener('DOMContentLoaded', () => {

    const canvas = document.getElementById('preview-canvas');
    if (!canvas) { console.error("Canvas element not found!"); return; }
    const ctx = canvas.getContext('2d');

    // Controls & Buttons refs... (unchanged)
    const boundaryOffsetSlider = document.getElementById('boundaryOffset'); // etc.
    const boundaryOffsetValSpan = document.getElementById('boundaryOffset-val');
    const gapWidthSlider = document.getElementById('gapWidth');
    const gapWidthValSpan = document.getElementById('gapWidth-val');
    const holeDiamSlider = document.getElementById('holeDiam');
    const holeDiamValSpan = document.getElementById('holeDiam-val');
    const currentModeSpan = document.getElementById('current-mode');
    const btnModeAdd = document.getElementById('btn-mode-add');
    const btnModeHole = document.getElementById('btn-mode-hole');
    const btnClearSites = document.getElementById('clear-sites-btn');
    const btnClearAll = document.getElementById('clear-all-btn');
    const btnExport = document.getElementById('export-btn');
    const btnDownloadSvg = document.getElementById('download-svg-btn');
    const svgOutputTextarea = document.getElementById('svg-output');

    // --- State ---
    let state = {
        mode: 'addSites',
        internalSites: [],
        holePos: null,
        holeDiameter: 1.5,
        gapWidth: 1.0,
        finalCellPolygons: [],
        unboundedCellPolygons: [],
        exteriorBoundarySegments: [],
        // *** NEW Interaction State ***
        isDragging: false,
        draggingSiteIndex: null,
        hoveredSiteIndex: null, // For visual feedback on hover
    };

    // --- Constants ---
    const SITE_RADIUS = 4; // Slightly larger radius for easier clicking
    const SITE_INTERACTION_RADIUS_SQ = (SITE_RADIUS * 2.5) ** 2; // Squared radius for click/drag detection (more generous)
    const PREVIEW_FILL_COLOR = getCssVariable('--color-preview-fill') || '#E8E8E8';
    const PREVIEW_STROKE_COLOR = getCssVariable('--color-preview-stroke') || '#4D453E';
    const GAP_BORDER_COLOR = getCssVariable('--color-gap-border') || 'blue';
    const SITE_COLOR = getCssVariable('--color-site-vis') || '#888';
    const SITE_HOVER_COLOR = '#333'; // Darker color on hover/drag
    const SVG_STROKE_WIDTH = 0.5;
    const EPSILON = 1e-5;
    const VORONOI_BOUNDS_MARGIN = 50;
    const SHADOW_FILL_COLOR = 'rgba(200, 200, 200, 0.3)';
    const SHADOW_STROKE_COLOR = 'rgba(150, 150, 150, 0.4)';
    const SHADOW_LINE_DASH = [2, 3];
    const SEGMENT_KEY_PRECISION = 3;

    // --- Cursor Styles ---
    const CURSOR_DEFAULT = 'default';
    const CURSOR_ADD = 'copy';
    const CURSOR_HOLE = 'crosshair';
    const CURSOR_POINTER = 'pointer';
    const CURSOR_GRABBING = 'grabbing';
    const CURSOR_GRAB = 'grab';

    // --- Helper to get CSS Variables ---
    function getCssVariable(varName) {
        return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    }

    // --- Geometry Helpers (Unchanged: isPointInsidePolygon, calculateCentroid, offsetPolygon, circleToPolygon, reversePolygonWinding, isPointOnBounds, getSegmentKey) ---
    function isPointInsidePolygon(point, polygon) { /* ... */
        if (!polygon || polygon.length < 3) return false;
        const x = point.x, y = point.y;
        let isInside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;
            const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) isInside = !isInside;
        }
        return isInside;
    }
    function calculateCentroid(polygon) { /* ... */
        if (!polygon || polygon.length === 0) return null;
        let x = 0, y = 0, area = 0;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;
            const crossProduct = (xi * yj - xj * yi); area += crossProduct; x += (xi + xj) * crossProduct; y += (yi + yj) * crossProduct;
        } area /= 2;
        if (Math.abs(area) < EPSILON) {
            if (polygon.length === 0) return null;
            x = polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length; y = polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length; return { x, y };
        } x = x / (6 * area); y = y / (6 * area); return { x, y };
    }
    function offsetPolygon(polygon, distance) { /* ... */
        if (!polygon || polygon.length < 3) return polygon;
        const centroid = calculateCentroid(polygon); if (!centroid) return polygon;
        const offset = [];
        for (const vertex of polygon) {
            const dx = vertex.x - centroid.x; const dy = vertex.y - centroid.y; const len = Math.sqrt(dx * dx + dy * dy);
            if (len < EPSILON) { offset.push({ x: vertex.x, y: vertex.y }); continue; }
            const normX = dx / len; const normY = dy / len;
            const effectiveDistance = distance < 0 ? Math.max(distance, -len * 0.99) : distance;
            offset.push({ x: vertex.x + normX * effectiveDistance, y: vertex.y + normY * effectiveDistance });
        }
        return offset.length >= 3 ? offset : null;
    }
    function circleToPolygon(cx, cy, r, numSegments = 24) { /* ... */
        const polygon = [];
        for (let i = 0; i < numSegments; i++) {
            const angle = (i / numSegments) * Math.PI * 2;
            polygon.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
        } return polygon;
    }
    function reversePolygonWinding(polygon) { /* ... */
        if (!polygon || polygon.length < 3) { return polygon; }
        return polygon.slice().reverse();
    }
    function isPointOnBounds(point, bounds) { /* ... */
        const [xmin, ymin, xmax, ymax] = bounds;
        const boundEpsilon = EPSILON * 10;
        return Math.abs(point.x - xmin) < boundEpsilon ||
               Math.abs(point.x - xmax) < boundEpsilon ||
               Math.abs(point.y - ymin) < boundEpsilon ||
               Math.abs(point.y - ymax) < boundEpsilon;
    }
    function getSegmentKey(p1, p2, precision = SEGMENT_KEY_PRECISION) { /* ... */
        let pt1 = p1, pt2 = p2;
        if (p1.x > p2.x || (Math.abs(p1.x - p2.x) < EPSILON && p1.y > p2.y)) {
            pt1 = p2; pt2 = p1;
        }
        const x1 = pt1.x.toFixed(precision); const y1 = pt1.y.toFixed(precision);
        const x2 = pt2.x.toFixed(precision); const y2 = pt2.y.toFixed(precision);
        return `${x1},${y1}-${x2},${y2}`;
    }
    // --- NEW Interaction Helper ---
    function findSiteIndexAtPoint(x, y) {
        for (let i = state.internalSites.length - 1; i >= 0; i--) { // Iterate backwards for Z-index
            const site = state.internalSites[i];
            const dx = x - site.x;
            const dy = y - site.y;
            if (dx * dx + dy * dy < SITE_INTERACTION_RADIUS_SQ) {
                return i;
            }
        }
        return null; // Use null to indicate not found
    }

    // --- Core Processing Function (generateGeometry - Unchanged) ---
    function generateGeometry() {
        // console.log("--- generateGeometry START ---"); // Optional: less console noise
        state.finalCellPolygons = []; state.unboundedCellPolygons = []; state.exteriorBoundarySegments = [];
        // console.log("Sites:", state.internalSites);

        if (state.internalSites.length < 3) {
            // console.log("Need >= 3 sites."); // Optional
            requestAnimationFrame(drawPreview); updateButtonStates();
            // console.log("--- generateGeometry END (too few points) ---"); // Optional
            return;
        }
        if (typeof d3 === 'undefined' || !d3.Delaunay) { /* ... error handling ... */ return; }

        try {
            const sitesForD3 = state.internalSites.map(p => [p.x, p.y]);
            const delaunay = d3.Delaunay.from(sitesForD3);

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            state.internalSites.forEach(p => { /* ... find bounds ... */
                minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
             });
            const voronoiBounds = [ /* ... calculate bounds ... */
                minX - VORONOI_BOUNDS_MARGIN, minY - VORONOI_BOUNDS_MARGIN,
                maxX + VORONOI_BOUNDS_MARGIN, maxY + VORONOI_BOUNDS_MARGIN
            ];
            const voronoi = delaunay.voronoi(voronoiBounds);

            const originalBoundedCellsForHoleCheck = []; const allCellPolygons = []; const cellBoundedStatus = [];
            // Pass 1: Boundedness Check
            // console.log("Starting cell processing (Pass 1)..."); // Optional
            for (let i = 0; i < state.internalSites.length; i++) { /* ... check boundedness ... */
                 const cellPolygonPoints = voronoi.cellPolygon(i);
                 let cellPolygon = null; let isBounded = false;
                 if (cellPolygonPoints && cellPolygonPoints.length >= 3) {
                     cellPolygon = cellPolygonPoints.map(p => ({ x: p[0], y: p[1] }));
                     isBounded = !cellPolygon.some(p => isPointOnBounds(p, voronoiBounds));
                 }
                 allCellPolygons.push(cellPolygon); cellBoundedStatus.push(isBounded);
            }

             // Pass 2: Shrinking & Edge Analysis
             // console.log("Starting cell processing (Pass 2)..."); // Optional
             const segmentUsageCount = new Map();
             for (let i = 0; i < state.internalSites.length; i++) { /* ... shrink, count edges ... */
                const cellPolygon = allCellPolygons[i];
                const isBounded = cellBoundedStatus[i];
                if (cellPolygon) {
                    if (isBounded) {
                        originalBoundedCellsForHoleCheck.push(cellPolygon);
                        const shrunk = offsetPolygon(cellPolygon, -state.gapWidth / 2);
                        if (shrunk && shrunk.length >= 3) state.finalCellPolygons.push(shrunk);
                        for (let j = 0; j < cellPolygon.length; j++) {
                            const p1 = cellPolygon[j]; const p2 = cellPolygon[(j + 1) % cellPolygon.length];
                            const key = getSegmentKey(p1, p2);
                            segmentUsageCount.set(key, (segmentUsageCount.get(key) || 0) + 1);
                        }
                    } else { state.unboundedCellPolygons.push(cellPolygon); }
                }
             }

             // Pass 3: Extract exterior boundary segments
             // console.log("Extracting exterior boundary segments..."); // Optional
             for (let i = 0; i < state.internalSites.length; i++) { /* ... find exterior segments ... */
                 if (cellBoundedStatus[i] && allCellPolygons[i]) {
                     const cellPolygon = allCellPolygons[i];
                     for (let j = 0; j < cellPolygon.length; j++) {
                         const p1 = cellPolygon[j]; const p2 = cellPolygon[(j + 1) % cellPolygon.length];
                         const key = getSegmentKey(p1, p2);
                         if (segmentUsageCount.get(key) === 1) state.exteriorBoundarySegments.push([p1, p2]);
                     }
                 }
             }
            // console.log("Exterior segments found:", state.exteriorBoundarySegments.length); // Optional

            // Add Hole
            if (state.holePos) { /* ... hole logic ... */
                // console.log("Checking hole position:", state.holePos); // Optional
                let holeIncluded = false;
                for(const originalCell of originalBoundedCellsForHoleCheck) {
                    if(isPointInsidePolygon(state.holePos, originalCell)) {
                        const holePolygon = circleToPolygon(state.holePos.x, state.holePos.y, state.holeDiameter / 2);
                        if (holePolygon && holePolygon.length >= 3) {
                            state.finalCellPolygons.push(reversePolygonWinding(holePolygon));
                            holeIncluded = true; /*console.log("  ADDED hole polygon.");*/ break;
                        }
                    }
                }
                 /* if(!holeIncluded) console.log("  Hole position not inside original bounded cell."); */ // Optional
            } /* else { console.log("No hole position set."); } */ // Optional

        } catch (error) { /* ... error handling ... */
            console.error("**** Error during geometry generation: ****", error);
            state.finalCellPolygons = []; state.unboundedCellPolygons = []; state.exteriorBoundarySegments = [];
         }

        // console.log("Final polygons:", state.finalCellPolygons.length); // Optional
        updateButtonStates();
        requestAnimationFrame(drawPreview); // Redraw needed after geometry changes
        // console.log("--- generateGeometry END ---"); // Optional
    }

    // --- Drawing Function (Updated for Hover/Drag Highlight) ---
    function drawPreview() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 0. Draw Shadows (Unchanged)
        if (state.unboundedCellPolygons.length > 0) { /* ... draw shadows ... */
            ctx.fillStyle = SHADOW_FILL_COLOR; ctx.strokeStyle = SHADOW_STROKE_COLOR;
            ctx.lineWidth = 1; ctx.setLineDash(SHADOW_LINE_DASH);
            state.unboundedCellPolygons.forEach(polygon => {
                if (!polygon || polygon.length < 3) return;
                ctx.beginPath(); ctx.moveTo(polygon[0].x, polygon[0].y);
                for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i].x, polygon[i].y);
                ctx.closePath(); ctx.fill(); ctx.stroke();
            });
            ctx.setLineDash([]);
        }

        // 1. Draw Earring Fill (Unchanged)
        if (state.finalCellPolygons.length > 0) { /* ... draw fill ... */
            ctx.beginPath();
            state.finalCellPolygons.forEach(polygon => {
                 if (!polygon || polygon.length < 3) return;
                 ctx.moveTo(polygon[0].x, polygon[0].y);
                 for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i].x, polygon[i].y);
                 ctx.closePath();
            });
            ctx.fillStyle = PREVIEW_FILL_COLOR;
            ctx.fill('evenodd');
        }

        // 2. Draw Blue Border (Exterior Segments) (Unchanged)
        if (state.exteriorBoundarySegments.length > 0) { /* ... draw blue border ... */
            ctx.strokeStyle = GAP_BORDER_COLOR; ctx.lineWidth = 1.5; ctx.setLineDash([]);
            ctx.beginPath();
            state.exteriorBoundarySegments.forEach(segment => {
                const p1 = segment[0]; const p2 = segment[1];
                ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
            });
            ctx.stroke();
        }

        // 3. Draw Earring Stroke (Black Outline) (Unchanged)
        if (state.finalCellPolygons.length > 0) { /* ... draw black stroke ... */
             ctx.strokeStyle = PREVIEW_STROKE_COLOR; ctx.lineWidth = 1;
             state.finalCellPolygons.forEach(polygon => {
                 if (!polygon || polygon.length < 3) return;
                 ctx.beginPath();
                 ctx.moveTo(polygon[0].x, polygon[0].y);
                 for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i].x, polygon[i].y);
                 ctx.closePath(); ctx.stroke();
             });
        }

        // 4. Draw Internal Sites (User Points) - *** UPDATED for Hover/Drag ***
        if (state.internalSites.length > 0) {
            state.internalSites.forEach((p, index) => {
                // Use darker color if hovering or dragging this point
                ctx.fillStyle = (index === state.hoveredSiteIndex || index === state.draggingSiteIndex) ? SITE_HOVER_COLOR : SITE_COLOR;
                ctx.beginPath();
                ctx.arc(p.x, p.y, SITE_RADIUS, 0, Math.PI * 2);
                ctx.fill();
            });
        }

         // 5. Visualize Excluded Hole Center (Unchanged)
         if (state.holePos) { /* ... draw excluded hole ... */
            let holeIsIncluded = state.finalCellPolygons.some(/* ... check inclusion ... */);
            if (!holeIsIncluded) {
                 ctx.beginPath(); ctx.arc(state.holePos.x, state.holePos.y, state.holeDiameter / 2, 0, Math.PI * 2);
                 ctx.strokeStyle = 'rgba(220, 53, 69, 0.5)'; ctx.setLineDash([2, 2]);
                 ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
            }
         }
    }

    // --- SVG Generation/Download (Unchanged) ---
    function generateSvgString() { /* ... */ return ""; }
    function downloadSvgFile() { /* ... */ }

    // --- Event Handlers (Major Updates for Interaction) ---
    function setMode(newMode) {
        state.mode = newMode;
        // Reset interaction state when changing modes
        state.isDragging = false;
        state.draggingSiteIndex = null;
        state.hoveredSiteIndex = null;

        btnModeAdd.classList.toggle('active', newMode === 'addSites');
        btnModeHole.classList.toggle('active', newMode === 'setHole');
        currentModeSpan.textContent = newMode === 'addSites' ? "Add Internal Points" : "Set Hole Position";
        updateCursor(); // Update cursor based on new mode
        requestAnimationFrame(drawPreview); // Redraw to remove hover highlights etc.
    }

    function updateButtonStates() { /* ... (unchanged) ... */
        const canGenerate = state.internalSites.length >= 3 && state.finalCellPolygons.length > 0;
        btnClearSites.disabled = state.internalSites.length === 0;
        btnExport.disabled = !canGenerate;
        btnDownloadSvg.disabled = !canGenerate;
        boundaryOffsetSlider.disabled = true; boundaryOffsetValSpan.textContent = "N/A"; /* ... disable offset ... */
    }

    function getCanvasCoords(event) {
        const rect = canvas.getBoundingClientRect();
        // Use event.clientX/Y for mouse events, check touches for touch events
        const clientX = event.touches ? event.touches[0].clientX : event.clientX;
        const clientY = event.touches ? event.touches[0].clientY : event.clientY;
        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    }

    function updateCursor() {
        let cursor = CURSOR_DEFAULT;
        if (state.isDragging) {
            cursor = CURSOR_GRABBING;
        } else if (state.mode === 'addSites') {
            cursor = state.hoveredSiteIndex !== null ? CURSOR_GRAB : CURSOR_ADD;
        } else if (state.mode === 'setHole') {
            cursor = CURSOR_HOLE;
        }
        canvas.style.cursor = cursor;
    }


    function handleMouseDown(event) {
        event.preventDefault(); // Prevent text selection during drag
        const { x, y } = getCanvasCoords(event);
        const siteIndex = findSiteIndexAtPoint(x, y);

        if (state.mode === 'addSites') {
            // Check for delete action (Shift + Click on a site)
            if (event.shiftKey && siteIndex !== null) {
                state.internalSites.splice(siteIndex, 1); // Remove the site
                state.hoveredSiteIndex = null; // Clear hover state
                generateGeometry(); // Regenerate
                updateCursor();
            }
            // Check for drag start (Click on a site, no Shift)
            else if (siteIndex !== null) {
                state.isDragging = true;
                state.draggingSiteIndex = siteIndex;
                state.hoveredSiteIndex = null; // Clear hover when dragging starts
                updateCursor();
                requestAnimationFrame(drawPreview); // Redraw for drag highlight
            }
            // Check for adding a new point (Click on empty space)
            else {
                state.internalSites.push({ x, y });
                generateGeometry(); // Regenerate
            }
        } else if (state.mode === 'setHole') {
            // Set hole position (no dragging/deleting in this mode)
            state.holePos = { x, y };
            generateGeometry(); // Regenerate
        }
    }

    function handleMouseMove(event) {
        const { x, y } = getCanvasCoords(event);

        if (state.isDragging) {
            if (state.draggingSiteIndex !== null) {
                // Update the position of the dragged site
                state.internalSites[state.draggingSiteIndex].x = x;
                state.internalSites[state.draggingSiteIndex].y = y;
                // Real-time update: regenerate geometry immediately
                // Use throttling/debouncing here if performance becomes an issue
                generateGeometry();
            }
        } else {
            // Update hover state only if not dragging
            const currentlyHovered = findSiteIndexAtPoint(x, y);
            if (currentlyHovered !== state.hoveredSiteIndex) {
                state.hoveredSiteIndex = currentlyHovered;
                updateCursor();
                requestAnimationFrame(drawPreview); // Redraw for hover highlight change
            }
        }
    }

    function handleMouseUp(event) {
        if (state.isDragging) {
            state.isDragging = false;
            state.draggingSiteIndex = null;
            // Check if mouse is still over a site after dropping
            const { x, y } = getCanvasCoords(event);
            state.hoveredSiteIndex = findSiteIndexAtPoint(x, y);
            updateCursor();
            requestAnimationFrame(drawPreview); // Redraw to remove drag highlight
        }
    }

    function handleMouseLeave(event) {
        // Stop dragging if the mouse leaves the canvas
        if (state.isDragging) {
            state.isDragging = false;
            state.draggingSiteIndex = null;
        }
        // Clear hover state when leaving canvas
        if (state.hoveredSiteIndex !== null) {
            state.hoveredSiteIndex = null;
            requestAnimationFrame(drawPreview); // Redraw to remove hover highlight
        }
        updateCursor(); // Reset cursor
    }


    function clearAll() {
        state.internalSites = []; state.holePos = null;
        // Reset interaction state
        state.isDragging = false; state.draggingSiteIndex = null; state.hoveredSiteIndex = null;
        generateGeometry(); // Call to clear geometry state and redraw
        svgOutputTextarea.value = ""; setMode('addSites');
    }

    function clearSites() {
         state.internalSites = [];
         state.isDragging = false; state.draggingSiteIndex = null; state.hoveredSiteIndex = null;
         generateGeometry(); // Regenerate to clear geometry state and redraw
    }

    // --- Initial Setup (Listeners Updated) ---
    function setupListeners() {
        // Sliders
        gapWidthSlider.addEventListener('input', (e) => { state.gapWidth = parseFloat(e.target.value); gapWidthValSpan.textContent = state.gapWidth.toFixed(1); generateGeometry(); });
        holeDiamSlider.addEventListener('input', (e) => { state.holeDiameter = parseFloat(e.target.value); holeDiamValSpan.textContent = state.holeDiameter.toFixed(1); if(state.holePos) generateGeometry(); else requestAnimationFrame(drawPreview); });

        // Mode Buttons
        btnModeAdd.addEventListener('click', () => setMode('addSites'));
        btnModeHole.addEventListener('click', () => setMode('setHole'));

        // Action Buttons
        btnClearSites.addEventListener('click', clearSites);
        btnClearAll.addEventListener('click', clearAll);
        btnExport.addEventListener('click', () => { svgOutputTextarea.value = generateSvgString(); });
        btnDownloadSvg.addEventListener('click', downloadSvgFile);

        // *** Canvas Interaction Listeners ***
        canvas.addEventListener('mousedown', handleMouseDown);
        // Listen on window for mousemove/mouseup to handle dragging outside canvas bounds
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('mouseleave', handleMouseLeave); // Handle leaving canvas area

        // Optional: Add touch support (basic example)
        canvas.addEventListener('touchstart', handleMouseDown, { passive: false }); // Use same logic, passive:false to prevent scroll
        window.addEventListener('touchmove', handleMouseMove, { passive: false });
        window.addEventListener('touchend', handleMouseUp);
        window.addEventListener('touchcancel', handleMouseUp); // Treat cancel like touchend


        // Initial UI Update
        gapWidthValSpan.textContent = state.gapWidth.toFixed(1);
        holeDiamValSpan.textContent = state.holeDiameter.toFixed(1);
        clearAll(); // Initialize state, draw empty canvas, update buttons, set cursor
    }

    // --- Run ---
    setupListeners();

}); // End DOMContentLoaded