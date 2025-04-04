// script.js (Modified for shrink-wrapped blue border and SVG download)

document.addEventListener('DOMContentLoaded', () => {

    const canvas = document.getElementById('preview-canvas');
    if (!canvas) { console.error("Canvas element not found!"); return; }
    const ctx = canvas.getContext('2d');

    // Controls & Buttons (References remain the same)
    const boundaryOffsetSlider = document.getElementById('boundaryOffset');
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
        finalCellPolygons: [],    // Shrunk cells + hole (the earring)
        unboundedCellPolygons: [],// Original unbounded cells (shadows)
        exteriorBoundarySegments: [], // *** NEW: Segments for the outer blue line ***
    };

    // --- Constants ---
    const SITE_RADIUS = 3;
    const PREVIEW_FILL_COLOR = getCssVariable('--color-preview-fill') || '#E8E8E8';
    const PREVIEW_STROKE_COLOR = getCssVariable('--color-preview-stroke') || '#4D453E';
    const GAP_BORDER_COLOR = getCssVariable('--color-gap-border') || 'blue';
    const SITE_COLOR = getCssVariable('--color-site-vis') || '#888';
    const SVG_STROKE_WIDTH = 0.5;
    const EPSILON = 1e-5; // Increased tolerance slightly for segment matching
    const VORONOI_BOUNDS_MARGIN = 50;
    const SHADOW_FILL_COLOR = 'rgba(200, 200, 200, 0.3)';
    const SHADOW_STROKE_COLOR = 'rgba(150, 150, 150, 0.4)';
    const SHADOW_LINE_DASH = [2, 3];
    const SEGMENT_KEY_PRECISION = 3; // Precision for segment matching key

    // --- Helper to get CSS Variables ---
    function getCssVariable(varName) {
        return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    }

    // --- Geometry Helper Functions (Added getSegmentKey) ---

    function isPointInsidePolygon(point, polygon) { /* ... (unchanged) ... */
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
    function calculateCentroid(polygon) { /* ... (unchanged) ... */
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
    function offsetPolygon(polygon, distance) { /* ... (unchanged) ... */
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
    function circleToPolygon(cx, cy, r, numSegments = 24) { /* ... (unchanged) ... */
        const polygon = [];
        for (let i = 0; i < numSegments; i++) {
            const angle = (i / numSegments) * Math.PI * 2;
            polygon.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
        } return polygon;
    }
    function reversePolygonWinding(polygon) { /* ... (unchanged) ... */
        if (!polygon || polygon.length < 3) { return polygon; }
        return polygon.slice().reverse();
    }
    function isPointOnBounds(point, bounds) { /* ... (unchanged) ... */
        const [xmin, ymin, xmax, ymax] = bounds;
        // Use slightly larger tolerance for boundary check as well
        const boundEpsilon = EPSILON * 10;
        return Math.abs(point.x - xmin) < boundEpsilon ||
               Math.abs(point.x - xmax) < boundEpsilon ||
               Math.abs(point.y - ymin) < boundEpsilon ||
               Math.abs(point.y - ymax) < boundEpsilon;
    }

    // *** NEW: Helper to create a consistent key for a line segment ***
    function getSegmentKey(p1, p2, precision = SEGMENT_KEY_PRECISION) {
        // Sort points primarily by X, secondarily by Y to ensure consistency
        let pt1 = p1, pt2 = p2;
        if (p1.x > p2.x || (Math.abs(p1.x - p2.x) < EPSILON && p1.y > p2.y)) {
            pt1 = p2;
            pt2 = p1;
        }
        // Round coordinates to handle floating point inaccuracies
        const x1 = pt1.x.toFixed(precision);
        const y1 = pt1.y.toFixed(precision);
        const x2 = pt2.x.toFixed(precision);
        const y2 = pt2.y.toFixed(precision);
        return `${x1},${y1}-${x2},${y2}`;
    }

    // --- Core Processing Function (Major Update for Edge Analysis) ---
    function generateGeometry() {
        console.log("--- generateGeometry START ---");
        state.finalCellPolygons = [];
        state.unboundedCellPolygons = [];
        state.exteriorBoundarySegments = []; // Reset blue border segments

        console.log("Sites:", state.internalSites);

        if (state.internalSites.length < 3) {
            console.log("Need >= 3 sites.");
            requestAnimationFrame(drawPreview); updateButtonStates();
            console.log("--- generateGeometry END (too few points) ---"); return;
        }
        if (typeof d3 === 'undefined' || !d3.Delaunay) {
             console.error("d3-delaunay library not loaded!");
             console.log("--- generateGeometry END (d3 missing) ---"); return;
        }

        try {
            const sitesForD3 = state.internalSites.map(p => [p.x, p.y]);
            const delaunay = d3.Delaunay.from(sitesForD3);

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            state.internalSites.forEach(p => {
                minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
            });
            const voronoiBounds = [
                minX - VORONOI_BOUNDS_MARGIN, minY - VORONOI_BOUNDS_MARGIN,
                maxX + VORONOI_BOUNDS_MARGIN, maxY + VORONOI_BOUNDS_MARGIN
            ];
            const voronoi = delaunay.voronoi(voronoiBounds);

            const originalBoundedCellsForHoleCheck = [];
            const allCellPolygons = []; // Store ALL polygons (bounded and unbounded) temporarily
            const cellBoundedStatus = []; // Track if cell[i] is bounded

            // --- Pass 1: Calculate all cell polygons and determine boundedness ---
            console.log("Starting cell processing (Pass 1: Boundedness Check)...");
            for (let i = 0; i < state.internalSites.length; i++) {
                const cellPolygonPoints = voronoi.cellPolygon(i);
                let cellPolygon = null;
                let isBounded = false;

                if (cellPolygonPoints && cellPolygonPoints.length >= 3) {
                    cellPolygon = cellPolygonPoints.map(p => ({ x: p[0], y: p[1] }));
                    isBounded = true; // Assume bounded initially
                    for (const p of cellPolygon) {
                        if (isPointOnBounds(p, voronoiBounds)) {
                            isBounded = false;
                            break;
                        }
                    }
                }
                allCellPolygons.push(cellPolygon); // Store polygon (or null)
                cellBoundedStatus.push(isBounded); // Store status
            }

             // --- Pass 2: Process bounded cells and identify exterior edges ---
             console.log("Starting cell processing (Pass 2: Shrinking & Edge Analysis)...");
             const segmentUsageCount = new Map(); // Map<segmentKey, count>

             for (let i = 0; i < state.internalSites.length; i++) {
                 const cellPolygon = allCellPolygons[i];
                 const isBounded = cellBoundedStatus[i];

                 if (cellPolygon) { // Process only valid polygons
                     if (isBounded) {
                         originalBoundedCellsForHoleCheck.push(cellPolygon); // For hole check

                         // Shrink for the final earring shape
                         const shrunk = offsetPolygon(cellPolygon, -state.gapWidth / 2);
                         if (shrunk && shrunk.length >= 3) {
                             state.finalCellPolygons.push(shrunk);
                         }

                         // Analyze segments for the blue border
                         for (let j = 0; j < cellPolygon.length; j++) {
                             const p1 = cellPolygon[j];
                             const p2 = cellPolygon[(j + 1) % cellPolygon.length]; // Wrap around
                             const key = getSegmentKey(p1, p2);
                             segmentUsageCount.set(key, (segmentUsageCount.get(key) || 0) + 1);
                         }
                     } else {
                         // Store original unbounded cell for shadow visualization
                         state.unboundedCellPolygons.push(cellPolygon);
                     }
                 }
             }
             console.log("Finished cell processing passes.");


             // --- Pass 3: Extract exterior boundary segments ---
             console.log("Extracting exterior boundary segments...");
             for (let i = 0; i < state.internalSites.length; i++) {
                 if (cellBoundedStatus[i] && allCellPolygons[i]) {
                     const cellPolygon = allCellPolygons[i];
                     for (let j = 0; j < cellPolygon.length; j++) {
                         const p1 = cellPolygon[j];
                         const p2 = cellPolygon[(j + 1) % cellPolygon.length];
                         const key = getSegmentKey(p1, p2);
                         // An edge is exterior if it was only used by ONE bounded cell
                         if (segmentUsageCount.get(key) === 1) {
                             state.exteriorBoundarySegments.push([p1, p2]); // Store as [point, point]
                         }
                     }
                 }
             }
              console.log("Exterior segments found:", state.exteriorBoundarySegments.length);


            // Add Hole (logic unchanged, uses originalBoundedCellsForHoleCheck)
            if (state.holePos) {
                console.log("Checking hole position:", state.holePos);
                let holeIncluded = false;
                for(const originalCell of originalBoundedCellsForHoleCheck) {
                    if(isPointInsidePolygon(state.holePos, originalCell)) {
                        const holePolygon = circleToPolygon(state.holePos.x, state.holePos.y, state.holeDiameter / 2);
                        if (holePolygon && holePolygon.length >= 3) {
                            state.finalCellPolygons.push(reversePolygonWinding(holePolygon));
                            holeIncluded = true; console.log("  ADDED hole polygon."); break;
                        }
                    }
                }
                 if(!holeIncluded) console.log("  Hole position not inside any original bounded cell.");
            } else {
                console.log("No hole position set.");
            }

        } catch (error) {
            console.error("**** Error during geometry generation: ****", error);
            state.finalCellPolygons = []; state.unboundedCellPolygons = []; state.exteriorBoundarySegments = [];
        }

        console.log("Final polygons for earring:", state.finalCellPolygons.length);
        console.log("Unbounded polygons for shadow:", state.unboundedCellPolygons.length);
        console.log("Exterior segments for border:", state.exteriorBoundarySegments.length);
        updateButtonStates();
        requestAnimationFrame(drawPreview);
        console.log("--- generateGeometry END ---");
    }

    // --- Drawing Function (Updated for Exterior Segments) ---
    function drawPreview() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 0. Draw Shadows (Unbounded Cells) - Unchanged
        if (state.unboundedCellPolygons.length > 0) {
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

        // 1. Draw Earring Fill - Unchanged
        if (state.finalCellPolygons.length > 0) {
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

        // 2. *** NEW: Draw the Blue Border (Exterior Segments) ***
        if (state.exteriorBoundarySegments.length > 0) {
            ctx.strokeStyle = GAP_BORDER_COLOR;
            ctx.lineWidth = 1.5; // Keep slightly thicker
            ctx.setLineDash([]);
            ctx.beginPath(); // Start one path for all segments
            state.exteriorBoundarySegments.forEach(segment => {
                const p1 = segment[0];
                const p2 = segment[1];
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
            });
            ctx.stroke(); // Stroke all collected segments
        }

        // 3. Draw Earring Stroke (Black Outline) - Unchanged
        if (state.finalCellPolygons.length > 0) {
             ctx.strokeStyle = PREVIEW_STROKE_COLOR;
             ctx.lineWidth = 1;
             state.finalCellPolygons.forEach(polygon => {
                 if (!polygon || polygon.length < 3) return;
                 ctx.beginPath();
                 ctx.moveTo(polygon[0].x, polygon[0].y);
                 for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i].x, polygon[i].y);
                 ctx.closePath();
                 ctx.stroke();
             });
        }

        // 4. Draw Internal Sites - Unchanged
        if (state.internalSites.length > 0) {
            ctx.fillStyle = SITE_COLOR;
            state.internalSites.forEach(p => {
                ctx.beginPath(); ctx.arc(p.x, p.y, SITE_RADIUS, 0, Math.PI * 2); ctx.fill();
            });
        }

         // 5. Visualize Excluded Hole Center - Unchanged
         if (state.holePos) {
            let holeIsIncluded = state.finalCellPolygons.some(poly => {
                 const centroid = calculateCentroid(poly);
                 if (centroid && Math.abs(centroid.x - state.holePos.x) < EPSILON && Math.abs(centroid.y - state.holePos.y) < EPSILON) {
                     if (poly.length > 10) {
                        const dx = poly[0].x - centroid.x; const dy = poly[0].y - centroid.y;
                        const distSq = dx*dx + dy*dy; const radiusSq = (state.holeDiameter/2)**2;
                        return Math.abs(distSq - radiusSq) < state.holeDiameter;
                     }
                 } return false;
            });
            if (!holeIsIncluded) {
                 ctx.beginPath(); ctx.arc(state.holePos.x, state.holePos.y, state.holeDiameter / 2, 0, Math.PI * 2);
                 ctx.strokeStyle = 'rgba(220, 53, 69, 0.5)'; ctx.setLineDash([2, 2]);
                 ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
            }
        }
    }

    // --- SVG Generation (Unchanged) ---
    function generateSvgString() { /* ... (remains the same) ... */
        if (state.finalCellPolygons.length === 0) {
            return "<!-- Error: No valid internal Voronoi cells generated. Add more points. -->";
        }

        let svgPaths = "";
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        const pointsToPathAndUpdateBounds = (points) => {
             if (!points || points.length < 3) return "";
             let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} `;
             minX = Math.min(minX, points[0].x); minY = Math.min(minY, points[0].y);
             maxX = Math.max(maxX, points[0].x); maxY = Math.max(maxY, points[0].y);
             for (let i = 1; i < points.length; i++) {
                 d += `L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)} `;
                 minX = Math.min(minX, points[i].x); minY = Math.min(minY, points[i].y);
                 maxX = Math.max(maxX, points[i].x); maxY = Math.max(maxY, points[i].y);
             }
             d += "Z";
             return d;
        };

        let combinedPathData = "";
        state.finalCellPolygons.forEach((polygon) => {
             const pathData = pointsToPathAndUpdateBounds(polygon);
             if(pathData) {
                 combinedPathData += pathData + " ";
             }
        });

        if (!combinedPathData) {
             return "<!-- Error: Could not generate path data for SVG. -->";
        }

        // Set fill to 'none' and stroke to black for laser cutting default
        svgPaths += `  <path d="${combinedPathData.trim()}" fill-rule="evenodd" fill="none" stroke="#000000" stroke-width="${SVG_STROKE_WIDTH}" />\n`;

        if (minX === Infinity) {
            return "<!-- Error: Could not determine bounds for SVG. -->";
        }
        const svgWidth = Math.max(1, (maxX - minX)).toFixed(2);
        const svgHeight = Math.max(1, (maxY - minY)).toFixed(2);
        const padding = SVG_STROKE_WIDTH * 2;
        const viewBox = `${(minX - padding).toFixed(2)} ${(minY - padding).toFixed(2)} ${(parseFloat(svgWidth) + 2 * padding).toFixed(2)} ${(parseFloat(svgHeight) + 2 * padding).toFixed(2)}`;

        const svgComment = `<!-- Generated Voronoi Earring - Gap Width: ${state.gapWidth.toFixed(1)}, Hole Dia: ${state.holeDiameter.toFixed(1)} -->\n`;
        const svgContent = `<svg width="${svgWidth}px" height="${svgHeight}px" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">\n${svgComment}${svgPaths}</svg>`;
        return svgContent;
    }


    // --- SVG Download Function (Unchanged) ---
    function downloadSvgFile() { /* ... (remains the same) ... */
        const svgString = generateSvgString();
        if (svgString.startsWith("<!-- Error:")) {
            svgOutputTextarea.value = svgString;
            alert("Cannot download SVG: " + svgString.replace(/<!--|-->/g, '').trim());
            return;
        }
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `voronoi-earring-${Date.now()}.svg`;
        document.body.appendChild(link); link.click();
        document.body.removeChild(link); URL.revokeObjectURL(url);
        svgOutputTextarea.value = svgString; // Show in textarea too
    }

    // --- Event Handlers (clearAll updated) ---
    function setMode(newMode) { /* ... (unchanged) ... */
        state.mode = newMode;
        btnModeAdd.classList.toggle('active', newMode === 'addSites');
        btnModeHole.classList.toggle('active', newMode === 'setHole');
        currentModeSpan.textContent = newMode === 'addSites' ? "Add Internal Points" : "Set Hole Position";
        canvas.style.cursor = newMode === 'addSites' ? "copy" : "crosshair";
    }

    function updateButtonStates() { /* ... (unchanged, depends on finalCellPolygons) ... */
        const canGenerate = state.internalSites.length >= 3 && state.finalCellPolygons.length > 0;
        btnClearSites.disabled = state.internalSites.length === 0;
        btnExport.disabled = !canGenerate;
        btnDownloadSvg.disabled = !canGenerate;

        boundaryOffsetSlider.disabled = true;
        boundaryOffsetValSpan.textContent = "N/A";
        boundaryOffsetSlider.style.opacity = 0.5;
        boundaryOffsetSlider.style.cursor = 'not-allowed';
        const boundaryLabel = document.querySelector('label[for="boundaryOffset"]');
        if (boundaryLabel) boundaryLabel.style.opacity = 0.5;
    }

    function handleCanvasClick(event) { /* ... (unchanged) ... */
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        if (state.mode === 'addSites') {
            state.internalSites.push({ x, y });
            generateGeometry();
        } else if (state.mode === 'setHole') {
            state.holePos = { x, y };
            generateGeometry();
        }
    }

    function clearAll() {
        state.internalSites = [];
        state.holePos = null;
        // Geometry reset is handled by generateGeometry
        generateGeometry(); // Call to clear state and redraw canvas
        svgOutputTextarea.value = "";
        setMode('addSites');
        // updateButtonStates() called within generateGeometry
    }

    function clearSites() {
         state.internalSites = [];
         // Keep hole pos
         generateGeometry(); // Regenerate to clear geometry state and redraw
         // updateButtonStates() called within generateGeometry
    }

    // --- Initial Setup (Unchanged) ---
    function setupListeners() { /* ... (remains the same) ... */
        gapWidthSlider.addEventListener('input', (e) => { state.gapWidth = parseFloat(e.target.value); gapWidthValSpan.textContent = state.gapWidth.toFixed(1); generateGeometry(); });
        holeDiamSlider.addEventListener('input', (e) => { state.holeDiameter = parseFloat(e.target.value); holeDiamValSpan.textContent = state.holeDiameter.toFixed(1); if(state.holePos) generateGeometry(); else requestAnimationFrame(drawPreview); });
        btnModeAdd.addEventListener('click', () => setMode('addSites'));
        btnModeHole.addEventListener('click', () => setMode('setHole'));
        btnClearSites.addEventListener('click', clearSites);
        btnClearAll.addEventListener('click', clearAll);
        btnExport.addEventListener('click', () => { svgOutputTextarea.value = generateSvgString(); });
        btnDownloadSvg.addEventListener('click', downloadSvgFile);
        canvas.addEventListener('click', handleCanvasClick);
        gapWidthValSpan.textContent = state.gapWidth.toFixed(1);
        holeDiamValSpan.textContent = state.holeDiameter.toFixed(1);
        clearAll(); // Init
    }

    // --- Run ---
    setupListeners();

}); // End DOMContentLoaded