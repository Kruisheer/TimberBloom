// script.js (Modified)

// Ensure the script runs after the DOM is ready (due to 'defer' in HTML)
document.addEventListener('DOMContentLoaded', () => {

    const canvas = document.getElementById('preview-canvas');
    if (!canvas) { console.error("Canvas element not found!"); return; }
    const ctx = canvas.getContext('2d');

    // Controls
    const boundaryOffsetSlider = document.getElementById('boundaryOffset');
    const boundaryOffsetValSpan = document.getElementById('boundaryOffset-val');
    const gapWidthSlider = document.getElementById('gapWidth');
    const gapWidthValSpan = document.getElementById('gapWidth-val');
    const holeDiamSlider = document.getElementById('holeDiam');
    const holeDiamValSpan = document.getElementById('holeDiam-val');
    const currentModeSpan = document.getElementById('current-mode');

    // Buttons
    const btnModeAdd = document.getElementById('btn-mode-add');
    const btnModeHole = document.getElementById('btn-mode-hole');
    const btnClearSites = document.getElementById('clear-sites-btn');
    const btnClearAll = document.getElementById('clear-all-btn');
    const btnExport = document.getElementById('export-btn');

    // Export
    const svgOutputTextarea = document.getElementById('svg-output');

    // --- State ---
    let state = {
        mode: 'addSites',
        internalSites: [],
        holePos: null,
        holeDiameter: 1.5,
        gapWidth: 1.0, // Now means TOTAL gap between cells
        // Boundary offset related state removed
        finalCellPolygons: [], // Store the valid, shrunk, BOUNDED Voronoi cells + hole
        unboundedCellPolygons: [], // Store the original UNBOUNDED cells for visualization
    };

    // --- Constants ---
    const SITE_RADIUS = 3;
    const PREVIEW_FILL_COLOR = '#E8E8E8'; // Main earring fill
    const PREVIEW_STROKE_COLOR = '#4D453E'; // Main earring stroke
    const SITE_COLOR = '#888';
    const SVG_STROKE_WIDTH = 0.5;
    const EPSILON = 1e-5; // Small tolerance for checking boundary vertices
    const VORONOI_BOUNDS_MARGIN = 50; // Generous margin for Voronoi calculation

    // --- NEW Constants for Shadow Visualization ---
    const SHADOW_FILL_COLOR = 'rgba(200, 200, 200, 0.3)'; // Light gray, semi-transparent
    const SHADOW_STROKE_COLOR = 'rgba(150, 150, 150, 0.4)'; // Lighter gray stroke
    const SHADOW_LINE_DASH = [2, 3]; // Dashed line style for shadow

    // --- Geometry Helper Functions (Unchanged from your version) ---

    function isPointInsidePolygon(point, polygon) {
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

    function calculateCentroid(polygon) {
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

    // Offset polygon inwards (negative distance) or outwards (positive distance)
    function offsetPolygon(polygon, distance) {
        if (!polygon || polygon.length < 3) return polygon;
        const centroid = calculateCentroid(polygon); if (!centroid) return polygon;
        const offset = [];
        for (const vertex of polygon) {
            const dx = vertex.x - centroid.x; const dy = vertex.y - centroid.y; const len = Math.sqrt(dx * dx + dy * dy);
            if (len < EPSILON) { offset.push({ x: vertex.x, y: vertex.y }); continue; }
            const normX = dx / len; const normY = dy / len;
            // Adjust distance for shrinking to prevent polygon collapse/inversion
            const effectiveDistance = distance < 0 ? Math.max(distance, -len * 0.99) : distance;
            offset.push({ x: vertex.x + normX * effectiveDistance, y: vertex.y + normY * effectiveDistance });
        }
        // Return null if the offset polygon is degenerate
        return offset.length >= 3 ? offset : null;
    }

    function circleToPolygon(cx, cy, r, numSegments = 24) {
        const polygon = [];
        for (let i = 0; i < numSegments; i++) {
            const angle = (i / numSegments) * Math.PI * 2;
            polygon.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
        } return polygon;
    }

    // Reverse winding order (useful for holes in SVG/Canvas)
    function reversePolygonWinding(polygon) {
        if (!polygon || polygon.length < 3) { return polygon; }
        return polygon.slice().reverse();
    }

    // Helper to check if a point lies approximately on the boundary rectangle
    function isPointOnBounds(point, bounds) {
        const [xmin, ymin, xmax, ymax] = bounds;
        return Math.abs(point.x - xmin) < EPSILON ||
               Math.abs(point.x - xmax) < EPSILON ||
               Math.abs(point.y - ymin) < EPSILON ||
               Math.abs(point.y - ymax) < EPSILON;
    }

    // --- Core Processing Function ---
    function generateGeometry() {
        console.log("--- generateGeometry START ---");
        state.finalCellPolygons = []; // Reset the final list for the earring shape
        state.unboundedCellPolygons = []; // Reset the list for shadow visualization
        console.log("Sites:", state.internalSites);

        if (state.internalSites.length < 3) {
            console.log("Need at least 3 sites. Skipping detailed calculation.");
            requestAnimationFrame(drawPreview);
            updateButtonStates();
            console.log("--- generateGeometry END (too few points) ---");
            return;
        }

        if (typeof d3 === 'undefined' || !d3.Delaunay) {
            console.error("d3-delaunay library not loaded!");
            console.log("--- generateGeometry END (d3 missing) ---");
            return;
        }

        try {
            const sitesForD3 = state.internalSites.map(p => [p.x, p.y]);
            console.log("Sites for d3:", sitesForD3);
            const delaunay = d3.Delaunay.from(sitesForD3);
            console.log("Delaunay object created");

            // 1. Calculate dynamic bounds for Voronoi calculation
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            state.internalSites.forEach(p => {
                minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
            });
            const voronoiBounds = [
                minX - VORONOI_BOUNDS_MARGIN, minY - VORONOI_BOUNDS_MARGIN,
                maxX + VORONOI_BOUNDS_MARGIN, maxY + VORONOI_BOUNDS_MARGIN
            ];
            console.log("Voronoi Bounds:", voronoiBounds);

            // 2. Calculate Voronoi diagram clipped to bounds
            const voronoi = delaunay.voronoi(voronoiBounds);
            console.log("Voronoi object created");

            const originalBoundedCells = []; // Keep track of original bounded cells for hole check

            // 3. Filter, Shrink (if bounded), and Collect Cells
            console.log("Starting cell processing loop...");
            for (let i = 0; i < state.internalSites.length; i++) {
                // console.log(`-- Processing cell ${i} --`); // Less verbose logging
                const cellPolygonPoints = voronoi.cellPolygon(i);

                if (cellPolygonPoints && cellPolygonPoints.length >= 3) {
                    let isBounded = true;
                    // Check if ANY vertex of the cell lies on the calculation boundary
                    for (const p of cellPolygonPoints) {
                        if (isPointOnBounds({x: p[0], y: p[1]}, voronoiBounds)) {
                            isBounded = false;
                            break;
                        }
                    }
                    // console.log(`  Cell ${i} bounded: ${isBounded}`); // Less verbose logging

                    // Convert d3 points [x,y] to our format {x, y}
                    const cellPolygon = cellPolygonPoints.map(p => ({ x: p[0], y: p[1] }));

                    if (isBounded) {
                        originalBoundedCells.push(cellPolygon); // Store original shape for hole check

                        // Shrink the bounded cell by half the gap width
                        const shrunk = offsetPolygon(cellPolygon, -state.gapWidth / 2);
                        // console.log(`  Cell ${i} shrunk result:`, shrunk ? `Valid (${shrunk.length} pts)` : 'INVALID/NULL');

                        if (shrunk && shrunk.length >= 3) {
                             // Add the valid shrunk cell to our final list (for the earring)
                             state.finalCellPolygons.push(shrunk);
                             // console.log(`  ADDED shrunk cell ${i} to final list`);
                        }
                    } else {
                        // *** Store the ORIGINAL unbounded cell for visualization ***
                        state.unboundedCellPolygons.push(cellPolygon);
                        // console.log(`  STORED unbounded cell ${i} for visualization`);
                    }
                } else {
                     // console.log(`  Cell ${i} polygon invalid (null or <3 points)`);
                }
            }
            console.log("Finished cell processing loop.");

            // 4. Add Hole if its center is inside any original *bounded* cell
            if (state.holePos) {
                console.log("Checking hole position:", state.holePos);
                let holeIncluded = false;
                // console.log("Original bounded cells found:", originalBoundedCells.length);
                for(const originalCell of originalBoundedCells) {
                    if(isPointInsidePolygon(state.holePos, originalCell)) {
                        // console.log("  Hole is inside an original bounded cell.");
                        const holePolygon = circleToPolygon(state.holePos.x, state.holePos.y, state.holeDiameter / 2);
                        if (holePolygon && holePolygon.length >= 3) {
                            // Add hole with reversed winding to final polygons list
                            state.finalCellPolygons.push(reversePolygonWinding(holePolygon));
                            holeIncluded = true;
                            console.log("  ADDED hole polygon to final list.");
                            break; // Add only once
                        } else {
                            console.log("  Failed to create valid hole polygon.");
                        }
                    }
                }
                 if(!holeIncluded) {
                    console.log("  Hole position was not inside any original bounded cell.");
                 }
            } else {
                console.log("No hole position set.");
            }

        } catch (error) {
            console.error("**** Caught error during geometry generation: ****", error);
            state.finalCellPolygons = []; // Ensure reset on error
            state.unboundedCellPolygons = []; // Ensure reset on error
        }

        console.log("Final polygons for earring:", state.finalCellPolygons.length);
        console.log("Unbounded polygons for shadow:", state.unboundedCellPolygons.length);
        updateButtonStates();
        requestAnimationFrame(drawPreview);
        console.log("--- generateGeometry END ---");
    }

    // --- Drawing Function ---
    function drawPreview() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 0. Draw Unbounded Cells (Shadows) - Draw first so they are underneath
        if (state.unboundedCellPolygons.length > 0) {
            ctx.fillStyle = SHADOW_FILL_COLOR;
            ctx.strokeStyle = SHADOW_STROKE_COLOR;
            ctx.lineWidth = 1;
            ctx.setLineDash(SHADOW_LINE_DASH); // Use dashed lines for shadow outlines

            state.unboundedCellPolygons.forEach(polygon => {
                if (!polygon || polygon.length < 3) return;
                ctx.beginPath();
                ctx.moveTo(polygon[0].x, polygon[0].y);
                for (let i = 1; i < polygon.length; i++) {
                    ctx.lineTo(polygon[i].x, polygon[i].y);
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke(); // Stroke the dashed line
            });
            ctx.setLineDash([]); // Reset line dash for subsequent drawing
        }

        // 1. Draw the final earring shape (collection of shrunken cells + hole)
        if (state.finalCellPolygons.length > 0) {
            ctx.beginPath(); // Start one path for all pieces of the final shape

            // Add paths for all valid shrunken cells and the hole
            state.finalCellPolygons.forEach(polygon => {
                 if (!polygon || polygon.length < 3) return;
                 ctx.moveTo(polygon[0].x, polygon[0].y);
                 for (let i = 1; i < polygon.length; i++) {
                     ctx.lineTo(polygon[i].x, polygon[i].y);
                 }
                 ctx.closePath(); // Close each sub-path (cell or hole)
            });

            // Fill all pieces together using the even-odd rule to handle the hole correctly
            ctx.fillStyle = PREVIEW_FILL_COLOR;
            ctx.fill('evenodd'); // Use 'evenodd' fill rule

            // Stroke only the outlines of the filled shape
            // We re-trace the paths to stroke them individually
            ctx.strokeStyle = PREVIEW_STROKE_COLOR;
            ctx.lineWidth = 1;
            state.finalCellPolygons.forEach(polygon => {
                 if (!polygon || polygon.length < 3) return;
                 ctx.beginPath(); // Separate path for each stroke
                 ctx.moveTo(polygon[0].x, polygon[0].y);
                 for (let i = 1; i < polygon.length; i++) {
                     ctx.lineTo(polygon[i].x, polygon[i].y);
                 }
                 ctx.closePath();
                 ctx.stroke(); // Stroke each part
            });
        }

        // 2. Draw Internal Sites (User Points) - Draw on top of everything
        if (state.internalSites.length > 0) {
            ctx.fillStyle = SITE_COLOR;
            state.internalSites.forEach(p => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, SITE_RADIUS, 0, Math.PI * 2);
                ctx.fill();
            });
        }

         // 3. Optional: Visualize Hole Center if set but not included in final shape
         //    (This helps debug why a hole might not be appearing)
        if (state.holePos) {
            let holeIsIncluded = false;
            // Check if a polygon approximating the hole exists in the final list
            for(const poly of state.finalCellPolygons) {
                 const centroid = calculateCentroid(poly);
                 // Approximate check: is the centroid close to the hole center and is it roughly circular?
                 if (centroid && Math.abs(centroid.x - state.holePos.x) < EPSILON && Math.abs(centroid.y - state.holePos.y) < EPSILON ) {
                     // Further check: distance from centroid to first point approx radius?
                     if (poly.length > 10) { // Assume circle has many segments
                        const dx = poly[0].x - centroid.x;
                        const dy = poly[0].y - centroid.y;
                        const distSq = dx*dx + dy*dy;
                        const radiusSq = (state.holeDiameter/2) * (state.holeDiameter/2);
                        if(Math.abs(distSq - radiusSq) < state.holeDiameter) { // Generous tolerance
                            holeIsIncluded = true;
                            break;
                        }
                     }
                 }
            }
            if (!holeIsIncluded) {
                 ctx.beginPath();
                 ctx.arc(state.holePos.x, state.holePos.y, state.holeDiameter / 2, 0, Math.PI * 2);
                 ctx.strokeStyle = 'rgba(220, 53, 69, 0.5)'; // Faint red dashed outline
                 ctx.setLineDash([2, 2]);
                 ctx.lineWidth = 1;
                 ctx.stroke();
                 ctx.setLineDash([]); // Reset dash pattern
            }
        }
    }

    // --- SVG Generation (Unchanged - Only exports the final shape) ---
    function generateSvgString() {
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

        // Generate a path element combining all final polygons (using evenodd rule for holes)
        let combinedPathData = "";
        state.finalCellPolygons.forEach((polygon) => {
             const pathData = pointsToPathAndUpdateBounds(polygon);
             if(pathData) {
                 combinedPathData += pathData + " "; // Add space between M...Z segments
             }
        });

        if (!combinedPathData) { // Handle case where no valid paths were generated
             return "<!-- Error: Could not generate path data for SVG. -->";
        }

        // Add the combined path with fill rule
        svgPaths += `  <path d="${combinedPathData.trim()}" fill-rule="evenodd" fill="#CCCCCC" stroke="#000000" stroke-width="${SVG_STROKE_WIDTH}" />\n`;
        // Note: SVG fill is set to gray (#CCCCCC) for visibility, user can change it. Stroke is black.

        // Calculate final viewBox based on actual drawn geometry bounds
        if (minX === Infinity) {
            return "<!-- Error: Could not determine bounds for SVG. -->";
        }
        const svgWidth = Math.max(1, (maxX - minX)).toFixed(2);
        const svgHeight = Math.max(1, (maxY - minY)).toFixed(2);
        const padding = SVG_STROKE_WIDTH * 2; // Add a bit more padding around
        const viewBox = `${(minX - padding).toFixed(2)} ${(minY - padding).toFixed(2)} ${(parseFloat(svgWidth) + 2 * padding).toFixed(2)} ${(parseFloat(svgHeight) + 2 * padding).toFixed(2)}`;

        const svgComment = `<!-- Generated Voronoi Earring - Gap Width: ${state.gapWidth.toFixed(1)}, Hole Dia: ${state.holeDiameter.toFixed(1)} -->\n`;
        const svgContent = `<svg width="${svgWidth}px" height="${svgHeight}px" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">\n${svgComment}${svgPaths}</svg>`;
        return svgContent;
    }


    // --- Event Handlers (Mostly Unchanged) ---
    function setMode(newMode) {
        state.mode = newMode;
        btnModeAdd.classList.toggle('active', newMode === 'addSites');
        btnModeHole.classList.toggle('active', newMode === 'setHole');
        let modeText = newMode === 'addSites' ? "Add Internal Points" : "Set Hole Position";
        let cursorStyle = newMode === 'addSites' ? "copy" : "crosshair";
        currentModeSpan.textContent = modeText;
        canvas.style.cursor = cursorStyle;
    }

    function updateButtonStates() {
        const canGenerate = state.internalSites.length >= 3;
        btnClearSites.disabled = state.internalSites.length === 0;
        // Enable export only if valid final polygons have been generated
        btnExport.disabled = state.finalCellPolygons.length === 0;

        // Disable boundary offset slider (as before)
        boundaryOffsetSlider.disabled = true;
        boundaryOffsetValSpan.textContent = "N/A";
        boundaryOffsetSlider.style.opacity = 0.5;
        boundaryOffsetSlider.style.cursor = 'not-allowed';
        const boundaryLabel = document.querySelector('label[for="boundaryOffset"]');
        if (boundaryLabel) boundaryLabel.style.opacity = 0.5;
    }

    function handleCanvasClick(event) {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        if (state.mode === 'addSites') {
            state.internalSites.push({ x, y });
            generateGeometry();
        } else if (state.mode === 'setHole') {
            state.holePos = { x, y };
            generateGeometry(); // Regenerate to check hole inclusion and update preview
        }
    }

    function clearAll() {
        state.internalSites = []; state.holePos = null;
        state.finalCellPolygons = [];
        state.unboundedCellPolygons = []; // Clear shadow polygons too
        svgOutputTextarea.value = "";
        setMode('addSites');
        updateButtonStates();
        requestAnimationFrame(drawPreview);
    }

    function clearSites() {
         state.internalSites = [];
         // Keep hole position if it was set
         generateGeometry(); // Regenerate (will clear polygons)
         updateButtonStates();
    }

    // --- Initial Setup (Unchanged) ---
    function setupListeners() {
        // Boundary Offset slider listener REMOVED

        gapWidthSlider.addEventListener('input', (e) => {
            state.gapWidth = parseFloat(e.target.value);
            gapWidthValSpan.textContent = state.gapWidth.toFixed(1);
            generateGeometry();
        });
        holeDiamSlider.addEventListener('input', (e) => {
            state.holeDiameter = parseFloat(e.target.value);
            holeDiamValSpan.textContent = state.holeDiameter.toFixed(1);
            // Regenerate geometry if hole exists to update its polygon size/check inclusion
            if(state.holePos) {
                generateGeometry();
            } else {
                // If no hole is placed yet, just redraw to update potential preview
                requestAnimationFrame(drawPreview);
            }
        });

        // Mode Buttons
        btnModeAdd.addEventListener('click', () => setMode('addSites'));
        btnModeHole.addEventListener('click', () => setMode('setHole'));

        // Action Buttons
        btnClearSites.addEventListener('click', clearSites);
        btnClearAll.addEventListener('click', clearAll);
        btnExport.addEventListener('click', () => {
            svgOutputTextarea.value = generateSvgString();
        });

        // Canvas Interaction
        canvas.addEventListener('click', handleCanvasClick);

        // Initial UI Update
        gapWidthValSpan.textContent = state.gapWidth.toFixed(1);
        holeDiamValSpan.textContent = state.holeDiameter.toFixed(1);
        clearAll(); // Initialize state, draw empty canvas, update buttons
    }

    // --- Run ---
    setupListeners();

}); // End DOMContentLoaded