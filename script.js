// script.js (Complete with Rounded Blue Border and All Helpers - Updated with Second Rounding Fix)

document.addEventListener('DOMContentLoaded', () => {

    const canvas = document.getElementById('preview-canvas');
    if (!canvas) { console.error("Canvas element not found!"); return; }
    const ctx = canvas.getContext('2d');

    // --- Control & Button References ---
    const boundaryOffsetSlider = document.getElementById('boundaryOffset');
    const boundaryOffsetValSpan = document.getElementById('boundaryOffset-val');
    const gapWidthSlider = document.getElementById('gapWidth');
    const gapWidthValSpan = document.getElementById('gapWidth-val');
    const holeDiamSlider = document.getElementById('holeDiam');
    const holeDiamValSpan = document.getElementById('holeDiam-val');
    const chamferRadiusSlider = document.getElementById('chamferRadius'); // New slider ref
    const chamferRadiusValSpan = document.getElementById('chamferRadius-val'); // New span ref
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
        chamferRadius: 0.0, // Corner rounding radius
        finalCellPolygons: [],    // Base shrunk cells + hole (raw polygons)
        displayCommandsList: [],  // Commands for drawing/SVG the main earring shape (rounded)
        unboundedCellPolygons: [],// Raw polygons for shadows
        rawBoundaryPolygons: [],  // Reconstructed outer boundary polygons (raw)
        roundedBoundaryCommandsList: [], // Commands for drawing the blue border (rounded)
        isDragging: false,
        draggingSiteIndex: null,
        hoveredSiteIndex: null,
    };

    // --- Constants ---
    const SITE_RADIUS = 4;
    const SITE_INTERACTION_RADIUS_SQ = (SITE_RADIUS * 2.5) ** 2;
    const SVG_STROKE_WIDTH = 0.5;
    const EPSILON = 1e-5; // Use for floating point comparisons
    const POINT_MATCH_EPSILON = EPSILON * 100; // Increased tolerance for point matching
    const MIN_EDGE_FOR_ROUNDING = EPSILON * 10; // Don't round corners with very short edges
    const VORONOI_BOUNDS_MARGIN = 50;
    const SHADOW_LINE_DASH = [2, 3];
    const SEGMENT_KEY_PRECISION = 3; // For segment counting
    const POINT_KEY_PRECISION = 5; // Higher precision for point map keys
    const CURSOR_DEFAULT = 'default'; const CURSOR_ADD = 'copy'; const CURSOR_HOLE = 'crosshair'; const CURSOR_POINTER = 'pointer'; const CURSOR_GRABBING = 'grabbing'; const CURSOR_GRAB = 'grab';

    // --- Dynamic Colors from CSS ---
    const PREVIEW_FILL_COLOR = getCssVariable('--color-preview-fill') || '#E8E8E8';
    const PREVIEW_STROKE_COLOR = getCssVariable('--color-preview-stroke') || '#4D453E';
    const GAP_BORDER_COLOR = getCssVariable('--color-gap-border') || 'blue';
    const SITE_COLOR = getCssVariable('--color-site-vis') || '#888';
    const SITE_HOVER_COLOR = '#333';
    const SHADOW_FILL_COLOR = 'rgba(200, 200, 200, 0.3)';
    const SHADOW_STROKE_COLOR = 'rgba(150, 150, 150, 0.4)';


    // --- Helper Functions ---

    function getCssVariable(varName) {
        try { // Add try-catch in case CSS variable isn't defined
           return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        } catch (e) {
            console.warn(`CSS variable ${varName} not found.`);
            return null; // Return null or a default value
        }
    }

    function isPointInsidePolygon(point, polygon) {
        if (!point || !polygon || polygon.length < 3) return false;
        const x = point.x, y = point.y;
        let isInside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;
            // Check if point y is between segment y endpoints, and point x is to the left of the edge
            const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) isInside = !isInside; // Flip state if edge is crossed
        }
        return isInside;
    }

    function calculateCentroid(polygon) {
        if (!polygon || polygon.length === 0) return null;
        let x = 0, y = 0, area = 0;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;
            const crossProduct = (xi * yj - xj * yi);
            area += crossProduct;
            x += (xi + xj) * crossProduct;
            y += (yi + yj) * crossProduct;
        }
        area /= 2;
        // Handle degenerate polygons (zero area) by averaging vertices
        if (Math.abs(area) < EPSILON) {
            if (polygon.length === 0) return null;
            x = polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length;
            y = polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length;
            return { x, y };
        }
        x = x / (6 * area);
        y = y / (6 * area);
        return { x, y };
    }

    function offsetPolygon(polygon, distance) {
        if (!polygon || polygon.length < 3) return polygon; // Return original if invalid
        const centroid = calculateCentroid(polygon);
        if (!centroid) return polygon; // Cannot offset without a centroid

        const offset = [];
        for (const vertex of polygon) {
            const dx = vertex.x - centroid.x;
            const dy = vertex.y - centroid.y;
            const len = Math.sqrt(dx * dx + dy * dy);

            if (len < EPSILON) { // If vertex is at centroid, keep it there
                offset.push({ x: vertex.x, y: vertex.y });
                continue;
            }
            const normX = dx / len;
            const normY = dy / len;

            // Adjust distance for shrinking to prevent polygon collapse/inversion
            const effectiveDistance = distance < 0 ? Math.max(distance, -len * 0.99) : distance;

            offset.push({
                x: vertex.x + normX * effectiveDistance,
                y: vertex.y + normY * effectiveDistance
            });
        }
        // Return null if the offset polygon is degenerate (less than 3 points)
        return offset.length >= 3 ? offset : null;
    }

    function circleToPolygon(cx, cy, r, numSegments = 24) {
        if (r <= 0 || numSegments < 3) return null; // Basic validation
        const polygon = [];
        for (let i = 0; i < numSegments; i++) {
            const angle = (i / numSegments) * Math.PI * 2;
            polygon.push({
                x: cx + Math.cos(angle) * r,
                y: cy + Math.sin(angle) * r
            });
        }
        return polygon;
    }

    function reversePolygonWinding(polygon) {
        if (!polygon || polygon.length < 3) { return polygon; }
        return polygon.slice().reverse();
    }

    function isPointOnBounds(point, bounds) {
        if (!point || !bounds) return false;
        const [xmin, ymin, xmax, ymax] = bounds;
        // Use a slightly larger epsilon for boundary checks due to floating point inaccuracies
        const boundEpsilon = EPSILON * 100;
        return Math.abs(point.x - xmin) < boundEpsilon ||
               Math.abs(point.x - xmax) < boundEpsilon ||
               Math.abs(point.y - ymin) < boundEpsilon ||
               Math.abs(point.y - ymax) < boundEpsilon;
    }

    function getSegmentKey(p1, p2, precision = SEGMENT_KEY_PRECISION) {
        if(!p1 || !p2) return null;
        // Sort points primarily by X, secondarily by Y to ensure consistency regardless of order p1, p2
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

    function findSiteIndexAtPoint(x, y) {
        for (let i = state.internalSites.length - 1; i >= 0; i--) { // Iterate backwards (last added is visually on top)
            const site = state.internalSites[i];
            const dx = x - site.x;
            const dy = y - site.y;
            if (dx * dx + dy * dy < SITE_INTERACTION_RADIUS_SQ) {
                return i; // Return index if point is within interaction radius
            }
        }
        return null; // Return null if no site found at this point
    }

    function getCanvasCoords(event) {
        const rect = canvas.getBoundingClientRect();
        // Use event.clientX/Y for mouse events, check touches array for touch events
        const clientX = event.touches ? event.touches[0].clientX : event.clientX;
        const clientY = event.touches ? event.touches[0].clientY : event.clientY;
        // Calculate coordinates relative to the canvas top-left corner
        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    }

    function pointsAreEqual(p1, p2, epsilon = POINT_MATCH_EPSILON) {
        if (!p1 || !p2) return false;
        return Math.abs(p1.x - p2.x) < epsilon && Math.abs(p1.y - p2.y) < epsilon;
    }

    function pointToKey(p, precision = POINT_KEY_PRECISION) {
        if (!p) return null;
        return `${p.x.toFixed(precision)},${p.y.toFixed(precision)}`;
    }

    function reconstructBoundaryPolygons(segments) {
        if (!segments || segments.length === 0) return [];

        const polygons = [];
        const remainingSegments = new Set(segments); // Track unused segments
        const adjacency = new Map(); // Map<pointKey, { point: {x,y}, segments: Set<segmentRef> }>

        // Build adjacency list: map point coordinates (as keys) to the segments connected to that point
        for (const segment of segments) {
            const [p1, p2] = segment;
            const key1 = pointToKey(p1);
            const key2 = pointToKey(p2);

            if (!key1 || !key2) { console.warn("Invalid segment points:", segment); continue; }

            if (!adjacency.has(key1)) adjacency.set(key1, { point: p1, segments: new Set() });
            if (!adjacency.has(key2)) adjacency.set(key2, { point: p2, segments: new Set() });

            adjacency.get(key1).segments.add(segment);
            adjacency.get(key2).segments.add(segment);
        }

        // Iterate while there are unused segments
        while (remainingSegments.size > 0) {
            const currentPolygonPoints = [];
            // Pick an arbitrary starting segment from the remaining set
            let startSegment;
            for (const seg of remainingSegments) { // Simple way to get first element
                 startSegment = seg;
                 break;
            }
            if (!startSegment) break; // Should not happen if size > 0, but safety check

            remainingSegments.delete(startSegment); // Mark as used

            let [p1, p2] = startSegment;
            currentPolygonPoints.push(p1); // Add the first point
            let currentPoint = p2;         // The point we need to find the next connection for
            const startPoint = p1;         // Remember where this path started

            let safetyBreak = segments.length + 5; // Prevent potential infinite loops

            // Follow the path segment by segment
            while (safetyBreak-- > 0) {
                currentPolygonPoints.push(currentPoint); // Add the current point
                const currentKey = pointToKey(currentPoint);

                // Check if we are back at the start point
                if (pointsAreEqual(currentPoint, startPoint)) {
                     currentPolygonPoints.pop(); // Remove duplicate last point if it matches start
                     // console.log("Loop closed successfully.");
                     break; // End of this polygon path
                }


                const candidates = adjacency.get(currentKey); // Segments connected to currentPoint

                if (!candidates) {
                     console.warn("Boundary reconstruction: No adjacency entry for point", currentPoint);
                     break; // Cannot continue path
                }

                // Find the *other* unused segment connected to currentPoint
                let nextSegment = null;
                for (const seg of candidates.segments) {
                    if (remainingSegments.has(seg)) { // Check if this segment is unused
                        nextSegment = seg;
                        break;
                    }
                }

                 // If no unused segment found, it's an error or dead end (shouldn't happen for closed loops)
                if (!nextSegment) {
                    console.warn("Boundary reconstruction: Path did not close back to start point or dead end.", startPoint, currentPoint);
                    break; // End of this polygon path
                }


                // Found the next segment
                remainingSegments.delete(nextSegment); // Mark it as used
                const [s1, s2] = nextSegment;

                // Determine which end of the nextSegment is the *next* point in the path
                if (pointsAreEqual(s1, currentPoint)) {
                    currentPoint = s2;
                } else if (pointsAreEqual(s2, currentPoint)) {
                    currentPoint = s1;
                } else {
                    // This shouldn't happen if adjacency list is correct
                    console.error("Boundary reconstruction: Segment connection mismatch!", currentPoint, nextSegment);
                    break; // Error condition
                }
            } // End while(true) path following loop

             if (safetyBreak <= 0) {
                  console.error("Boundary reconstruction: Safety break triggered, potential infinite loop.");
             }

            // Add the completed polygon if it's valid
            if (currentPolygonPoints.length >= 3) {
                polygons.push(currentPolygonPoints);
            } else if (currentPolygonPoints.length > 0){
                 console.warn("Boundary reconstruction: Found short polygon path, discarding.", currentPolygonPoints);
            }
        } // End while(remainingSegments) loop

        // console.log(`Reconstructed ${polygons.length} raw boundary polygons.`);
        return polygons;
    }

    // Helper to get the defined end point of the last command added
    function getCommandEndPoint(command) {
        if (!command) return null;
        // M, L, Q all define their endpoint in 'pt'
        if (command.type === 'M' || command.type === 'L' || command.type === 'Q') {
            return command.pt;
        }
        // 'Z' doesn't have an explicit point in this structure,
        // but conceptually returns to the start of the subpath.
        return null;
    }

    // **** START OF UPDATED FUNCTION ****
    function applyCornerRounding(polygon, radius) {
        const commands = [];
        if (!polygon || polygon.length < 3) {
            // console.log("Skipping rounding for degenerate polygon:", polygon);
            return commands;
        }
        const n = polygon.length;

        // --- Handle non-rounded case separately for simplicity ---
        if (radius <= EPSILON) {
            commands.push({ type: 'M', pt: polygon[0] });
            let lastAddedPoint = polygon[0];
            for (let i = 1; i < n; i++) {
                if (!pointsAreEqual(polygon[i], lastAddedPoint, EPSILON)) {
                     commands.push({ type: 'L', pt: polygon[i] });
                     lastAddedPoint = polygon[i];
                }
            }
            // Close path if it's not implicitly closed and has more than just M
             if (commands.length > 1 && !pointsAreEqual(polygon[0], lastAddedPoint, EPSILON)) {
                 commands.push({ type: 'Z' });
             } else if (commands.length < 2) { // Only M was added
                  return [];
             }
            // console.log("Sharp polygon commands:", JSON.stringify(commands));
            return commands;
        }
        // --- End non-rounded case ---


        // --- Pre-calculate start point based on the LAST corner's properties ---
        let effectiveStartPoint;
        const p_last = polygon[n - 1];
        const p_prev_last = polygon[n - 2]; // Point before the last one
        const p_next_last = polygon[0];     // Point after the last one (wraps around)

        const v1_last_x = p_prev_last.x - p_last.x;
        const v1_last_y = p_prev_last.y - p_last.y;
        const v2_last_x = p_next_last.x - p_last.x;
        const v2_last_y = p_next_last.y - p_last.y;

        const len1_last = Math.sqrt(v1_last_x * v1_last_x + v1_last_y * v1_last_y);
        const len2_last = Math.sqrt(v2_last_x * v2_last_x + v2_last_y * v2_last_y);

        const maxRadius_last = (len1_last > EPSILON && len2_last > EPSILON) ? Math.min(len1_last, len2_last) / 2 : 0;
        const actualRadius_last = Math.max(0, Math.min(radius, maxRadius_last));
        const isLastSharp = actualRadius_last < EPSILON || len1_last < MIN_EDGE_FOR_ROUNDING || len2_last < MIN_EDGE_FOR_ROUNDING;

        if (isLastSharp) {
            effectiveStartPoint = p_last; // Start at the sharp corner vertex
        } else {
            // Start at the end-tangent point (t2) of the last corner's arc
            const t2x_last = p_last.x + (v2_last_x / len2_last) * actualRadius_last;
            const t2y_last = p_last.y + (v2_last_y / len2_last) * actualRadius_last;
            effectiveStartPoint = { x: t2x_last, y: t2y_last };
        }
        // --- End Pre-calculation ---

        // Start the path!
        commands.push({ type: 'M', pt: effectiveStartPoint });

        // --- Loop through all corners ---
        for (let i = 0; i < n; i++) {
            const p_prev = polygon[(i + n - 1) % n];
            const p_curr = polygon[i];
            const p_next = polygon[(i + 1) % n];

            // Calculate vectors and lengths for the current corner
            const v1x = p_prev.x - p_curr.x;
            const v1y = p_prev.y - p_curr.y;
            const v2x = p_next.x - p_curr.x;
            const v2y = p_next.y - p_curr.y;

            const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
            const len2 = Math.sqrt(v2x * v2x + v2y * v2y);

            // Determine effective radius and if the corner is sharp
            const maxRadius = (len1 > EPSILON && len2 > EPSILON) ? Math.min(len1, len2) / 2 : 0;
            const actualRadius = Math.max(0, Math.min(radius, maxRadius));
            const isSharp = actualRadius < EPSILON || len1 < MIN_EDGE_FOR_ROUNDING || len2 < MIN_EDGE_FOR_ROUNDING;

            // Get the current position of the path
            const lastPt = getCommandEndPoint(commands[commands.length - 1]);
            if (!lastPt) { // Should only happen on first iteration if M failed? Safety check.
                 console.error("Error: Could not get last point in path generation.");
                 return []; // Cannot continue
            }

            if (isSharp) {
                // --- Handle Sharp Corner ---
                // Add LineTo the sharp vertex IF the path isn't already there
                if (!pointsAreEqual(lastPt, p_curr, EPSILON)) {
                    commands.push({ type: 'L', pt: p_curr });
                }
            } else {
                // --- Handle Rounded Corner ---
                // Calculate tangent points T1 (on incoming segment) and T2 (on outgoing segment)
                const t1x = p_curr.x + (v1x / len1) * actualRadius;
                const t1y = p_curr.y + (v1y / len1) * actualRadius;
                const t2x = p_curr.x + (v2x / len2) * actualRadius;
                const t2y = p_curr.y + (v2y / len2) * actualRadius;
                const t1 = { x: t1x, y: t1y }; // Start of arc
                const t2 = { x: t2x, y: t2y }; // End of arc

                // Add LineTo the start of the arc (t1) IF the path isn't already there
                if (!pointsAreEqual(lastPt, t1, EPSILON)) {
                    commands.push({ type: 'L', pt: t1 });
                }

                // Add the quadratic curve for the rounded corner
                commands.push({ type: 'Q', ctrl: p_curr, pt: t2 });
            }
        } // --- End for loop ---

        // --- Close the path ---
        // Add Z command. This correctly joins the end of the last segment
        // (which should be at effectiveStartPoint if calculations are precise)
        // back to the initial M point. SVG handles the 'Z' appropriately.
        if (commands.length > 1) { // Only add Z if there's more than just the initial M
           commands.push({ type: 'Z' });
        }

        // --- Final cleanup for degenerate cases ---
        // e.g., M followed immediately by Z is pointless if start/end matched
        if (commands.length === 2 && commands[0].type === 'M' && commands[1].type === 'Z') {
             const firstPt = getCommandEndPoint(commands[0]);
             // Check if the M point itself was valid before removing Z
             if (firstPt) {
                // This case usually means the polygon was tiny or collapsed.
                // console.log("Removing degenerate M->Z path.");
                return [];
             }
             // If firstPt is null, something went wrong earlier, but still return empty.
             return [];
        }
        // If only M remains after the loop (e.g., extremely small polygon)
        if (commands.length < 2) {
            // console.log("Removing path with only M command.");
            return [];
        }

        // console.log("Rounded polygon commands:", JSON.stringify(commands));
        return commands;
    }
    // **** END OF UPDATED FUNCTION ****


    function regenerateDisplayGeometry() {
        // Regenerate commands for the main earring shape
        state.displayCommandsList = [];
        if (state.finalCellPolygons.length > 0) {
            state.finalCellPolygons.forEach(poly => {
                const commands = applyCornerRounding(poly, state.chamferRadius);
                if (commands.length > 0) state.displayCommandsList.push(commands);
            });
        }

        // Regenerate commands for the blue boundary line
        state.roundedBoundaryCommandsList = [];
        if (state.rawBoundaryPolygons.length > 0) {
            state.rawBoundaryPolygons.forEach(poly => {
                const commands = applyCornerRounding(poly, state.chamferRadius);
                 if (commands.length > 0) state.roundedBoundaryCommandsList.push(commands);
            });
        }
        // console.log("Display commands:", state.displayCommandsList.length, "Boundary commands:", state.roundedBoundaryCommandsList.length);

        requestAnimationFrame(drawPreview); // Trigger redraw with updated commands
    }


    // --- Core Processing Function ---
    function generateGeometry() {
        // Clear previous results
        state.finalCellPolygons = [];
        state.unboundedCellPolygons = [];
        state.rawBoundaryPolygons = []; // Clear raw boundary polygons

        if (state.internalSites.length < 3) {
            regenerateDisplayGeometry(); // Clear display lists & redraw empty state
            updateButtonStates();
            return;
        }
        if (typeof d3 === 'undefined' || !d3.Delaunay) { console.error("d3-delaunay missing!"); return; }

        try {
            const sitesForD3 = state.internalSites.map(p => [p.x, p.y]);
            const delaunay = d3.Delaunay.from(sitesForD3);
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            state.internalSites.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
            const voronoiBounds = [ minX - VORONOI_BOUNDS_MARGIN, minY - VORONOI_BOUNDS_MARGIN, maxX + VORONOI_BOUNDS_MARGIN, maxY + VORONOI_BOUNDS_MARGIN ];
            const voronoi = delaunay.voronoi(voronoiBounds);

            const originalBoundedCellsForHoleCheck = [];
            const allCellPolygons = [];
            const cellBoundedStatus = [];
            let exteriorSegments = []; // Temp list to hold segments before reconstruction

            // Pass 1: Boundedness Check
            for (let i = 0; i < state.internalSites.length; i++) {
                const cellPolygonPoints = voronoi.cellPolygon(i);
                let cellPolygon = null; let isBounded = false;
                if (cellPolygonPoints && cellPolygonPoints.length >= 3) {
                    cellPolygon = cellPolygonPoints.map(p => ({ x: p[0], y: p[1] }));
                    isBounded = !cellPolygon.some(p => isPointOnBounds(p, voronoiBounds));
                }
                allCellPolygons.push(cellPolygon); cellBoundedStatus.push(isBounded);
            }

            // Pass 2: Shrinking & Edge Counting
            const segmentUsageCount = new Map();
            for (let i = 0; i < state.internalSites.length; i++) {
                const cellPolygon = allCellPolygons[i]; const isBounded = cellBoundedStatus[i];
                if (cellPolygon) {
                    if (isBounded) {
                        originalBoundedCellsForHoleCheck.push(cellPolygon);
                        const shrunk = offsetPolygon(cellPolygon, -state.gapWidth / 2);
                        if (shrunk && shrunk.length >= 3) state.finalCellPolygons.push(shrunk);
                        for (let j = 0; j < cellPolygon.length; j++) {
                            const p1 = cellPolygon[j]; const p2 = cellPolygon[(j + 1) % cellPolygon.length];
                            const key = getSegmentKey(p1, p2);
                            if (key) segmentUsageCount.set(key, (segmentUsageCount.get(key) || 0) + 1);
                        }
                    } else { state.unboundedCellPolygons.push(cellPolygon); }
                }
            }

            // Pass 3: Extract exterior boundary *segments* (temporary)
             for (let i = 0; i < state.internalSites.length; i++) {
                 if (cellBoundedStatus[i] && allCellPolygons[i]) {
                     const cellPolygon = allCellPolygons[i];
                     for (let j = 0; j < cellPolygon.length; j++) {
                         const p1 = cellPolygon[j]; const p2 = cellPolygon[(j + 1) % cellPolygon.length];
                         const key = getSegmentKey(p1, p2);
                         if (key && segmentUsageCount.get(key) === 1) {
                             exteriorSegments.push([p1, p2]); // Add raw segment
                         }
                     }
                 }
             }

            // Reconstruct boundary polygons from segments
            state.rawBoundaryPolygons = reconstructBoundaryPolygons(exteriorSegments);

            // Add Hole (adds polygon to state.finalCellPolygons)
            if (state.holePos) {
                 let holeIncluded = false;
                 for(const originalCell of originalBoundedCellsForHoleCheck) {
                     if(isPointInsidePolygon(state.holePos, originalCell)) {
                         const holePolygon = circleToPolygon(state.holePos.x, state.holePos.y, state.holeDiameter / 2);
                         if (holePolygon && holePolygon.length >= 3) {
                             state.finalCellPolygons.push(reversePolygonWinding(holePolygon));
                             holeIncluded = true; break;
                         }
                     }
                 }
            }

        } catch (error) {
            console.error("**** Error during geometry generation: ****", error);
            state.finalCellPolygons = []; state.unboundedCellPolygons = []; state.rawBoundaryPolygons = [];
        }

        // Regenerate display geometry (applies rounding to finalCellPolygons and rawBoundaryPolygons)
        regenerateDisplayGeometry();
        updateButtonStates();
    }

    // --- Drawing Function ---
    function drawPreview() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 0. Draw Shadows
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

        // --- Draw Main Earring Shape (Fill & Stroke) ---
        if (state.displayCommandsList.length > 0) {
            ctx.beginPath(); // Combined path for fill/stroke
            state.displayCommandsList.forEach(commandList => {
                if (!commandList || commandList.length < 2) return;
                commandList.forEach(cmd => {
                    switch (cmd.type) {
                        case 'M': ctx.moveTo(cmd.pt.x, cmd.pt.y); break;
                        case 'L': ctx.lineTo(cmd.pt.x, cmd.pt.y); break;
                        case 'Q': ctx.quadraticCurveTo(cmd.ctrl.x, cmd.ctrl.y, cmd.pt.x, cmd.pt.y); break;
                        case 'Z': ctx.closePath(); break;
                    }
                });
            });
            // Fill
            ctx.fillStyle = PREVIEW_FILL_COLOR;
            ctx.fill('evenodd');
            // Stroke (Black outline)
            ctx.strokeStyle = PREVIEW_STROKE_COLOR;
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // --- Draw Blue Border (Rounded) ---
        if (state.roundedBoundaryCommandsList.length > 0) {
            ctx.strokeStyle = GAP_BORDER_COLOR;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([]);
            ctx.beginPath(); // Start path for blue lines
            state.roundedBoundaryCommandsList.forEach(commandList => {
                 if (!commandList || commandList.length < 2) return;
                  commandList.forEach(cmd => {
                     switch (cmd.type) {
                         case 'M': ctx.moveTo(cmd.pt.x, cmd.pt.y); break;
                         case 'L': ctx.lineTo(cmd.pt.x, cmd.pt.y); break;
                         case 'Q': ctx.quadraticCurveTo(cmd.ctrl.x, cmd.ctrl.y, cmd.pt.x, cmd.pt.y); break;
                         case 'Z': ctx.closePath(); break;
                     }
                 });
            });
            ctx.stroke(); // Stroke the blue rounded boundary
        }


        // 4. Draw Internal Sites
        if (state.internalSites.length > 0) {
             state.internalSites.forEach((p, index) => {
                 ctx.fillStyle = (index === state.hoveredSiteIndex || index === state.draggingSiteIndex) ? SITE_HOVER_COLOR : SITE_COLOR;
                 ctx.beginPath();
                 ctx.arc(p.x, p.y, SITE_RADIUS, 0, Math.PI * 2);
                 ctx.fill();
             });
        }

         // 5. Visualize Excluded Hole Center
         if (state.holePos) {
              const approxHoleRadiusSq = (state.holeDiameter / 2)**2;
              let holeIsIncluded = state.finalCellPolygons.some(poly =>
                 poly.length > 10 && // Basic check for a circle polygon
                 poly.every(p => { // Check if all points are roughly equidistant from holePos
                     const dx = p.x - state.holePos.x; const dy = p.y - state.holePos.y;
                     const distSq = dx*dx + dy*dy;
                     // Use a tolerance band around the expected squared radius
                     return Math.abs(distSq - approxHoleRadiusSq) < approxHoleRadiusSq * 0.75; // Increased tolerance
                 })
             );
             if (!holeIsIncluded) {
                  ctx.beginPath(); ctx.arc(state.holePos.x, state.holePos.y, state.holeDiameter / 2, 0, Math.PI * 2);
                  ctx.strokeStyle = 'rgba(220, 53, 69, 0.5)'; ctx.setLineDash([2, 2]);
                  ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
             }
        }
    }

    // --- SVG Generation ---
    function generateSvgString() {
        if (!state.displayCommandsList || state.displayCommandsList.length === 0) {
             if (state.finalCellPolygons.length === 0 && state.rawBoundaryPolygons.length === 0) return "<!-- Error: No valid cells or boundary generated. Add 3+ points. -->";
             else if (state.finalCellPolygons.length === 0) return "<!-- Error: Failed to generate internal cell geometry. -->";
             else return "<!-- Error: Failed to generate display commands from geometry. -->";
        }
        let combinedPathData = ""; let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const updateBounds = (pt) => { if(!pt) return; minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y); maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y); };
        state.displayCommandsList.forEach(commandList => {
            if (!commandList || commandList.length < 2) return; let segmentData = "";
            commandList.forEach(cmd => {
                 switch (cmd.type) {
                    case 'M': segmentData += `M ${cmd.pt.x.toFixed(2)} ${cmd.pt.y.toFixed(2)} `; updateBounds(cmd.pt); break;
                    case 'L': segmentData += `L ${cmd.pt.x.toFixed(2)} ${cmd.pt.y.toFixed(2)} `; updateBounds(cmd.pt); break;
                    case 'Q': segmentData += `Q ${cmd.ctrl.x.toFixed(2)} ${cmd.ctrl.y.toFixed(2)} ${cmd.pt.x.toFixed(2)} ${cmd.pt.y.toFixed(2)} `; updateBounds(cmd.ctrl); updateBounds(cmd.pt); break;
                    case 'Z': segmentData += 'Z '; break;
                }
            }); combinedPathData += segmentData;
        });
        if (!combinedPathData) return "<!-- Error: Could not generate path data string. -->";
        const svgPaths = `  <path d="${combinedPathData.trim()}" fill-rule="evenodd" fill="none" stroke="#000000" stroke-width="${SVG_STROKE_WIDTH}" />\n`;
        if (minX === Infinity) return "<!-- Error: Could not determine SVG bounds. -->";
        const svgWidth = Math.max(1, (maxX - minX)).toFixed(2); const svgHeight = Math.max(1, (maxY - minY)).toFixed(2); const padding = SVG_STROKE_WIDTH * 2;
        const viewBox = `${(minX - padding).toFixed(2)} ${(minY - padding).toFixed(2)} ${(parseFloat(svgWidth) + 2 * padding).toFixed(2)} ${(parseFloat(svgHeight) + 2 * padding).toFixed(2)}`;
        const svgComment = `<!-- Generated Voronoi Earring - Gap: ${state.gapWidth.toFixed(1)}, Hole: ${state.holeDiameter.toFixed(1)}, Rounding: ${state.chamferRadius.toFixed(1)} -->\n`;
        const svgContent = `<svg width="${svgWidth}px" height="${svgHeight}px" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">\n${svgComment}${svgPaths}</svg>`;
        return svgContent;
    }

    // --- SVG Download Function ---
    function downloadSvgFile() {
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
        svgOutputTextarea.value = svgString;
    }

    // --- Event Handlers ---
    function setMode(newMode) { state.mode = newMode; state.isDragging = false; state.draggingSiteIndex = null; state.hoveredSiteIndex = null; btnModeAdd.classList.toggle('active', newMode === 'addSites'); btnModeHole.classList.toggle('active', newMode === 'setHole'); currentModeSpan.textContent = newMode === 'addSites' ? "Add Internal Points" : "Set Hole Position"; updateCursor(); requestAnimationFrame(drawPreview); }
    function updateButtonStates() { const hasGeometry = state.finalCellPolygons.length > 0 || state.rawBoundaryPolygons.length > 0; const canGenerate = state.internalSites.length >= 3 && hasGeometry && state.displayCommandsList.length > 0; btnClearSites.disabled = state.internalSites.length === 0; btnExport.disabled = !canGenerate; btnDownloadSvg.disabled = !canGenerate; boundaryOffsetSlider.disabled = true; boundaryOffsetValSpan.textContent = "N/A"; boundaryOffsetSlider.style.opacity = 0.5; boundaryOffsetSlider.style.cursor = 'not-allowed'; const boundaryLabel = document.querySelector('label[for="boundaryOffset"]'); if (boundaryLabel) boundaryLabel.style.opacity = 0.5;}
    function updateCursor() { let cursor = CURSOR_DEFAULT; if (state.isDragging) cursor = CURSOR_GRABBING; else if (state.mode === 'addSites') cursor = state.hoveredSiteIndex !== null ? CURSOR_GRAB : CURSOR_ADD; else if (state.mode === 'setHole') cursor = CURSOR_HOLE; canvas.style.cursor = cursor;}
    function handleMouseDown(event) { event.preventDefault(); const { x, y } = getCanvasCoords(event); const siteIndex = findSiteIndexAtPoint(x, y); if (state.mode === 'addSites') { if (event.shiftKey && siteIndex !== null) { state.internalSites.splice(siteIndex, 1); state.hoveredSiteIndex = null; generateGeometry(); updateCursor(); } else if (siteIndex !== null) { state.isDragging = true; state.draggingSiteIndex = siteIndex; state.hoveredSiteIndex = null; updateCursor(); requestAnimationFrame(drawPreview); } else { state.internalSites.push({ x, y }); generateGeometry(); } } else if (state.mode === 'setHole') { state.holePos = { x, y }; generateGeometry(); } }
    function handleMouseMove(event) { if (!state.isDragging && state.mode !== 'addSites') return; const { x, y } = getCanvasCoords(event); if (state.isDragging) { if (state.draggingSiteIndex !== null && state.draggingSiteIndex < state.internalSites.length) { state.internalSites[state.draggingSiteIndex].x = x; state.internalSites[state.draggingSiteIndex].y = y; generateGeometry(); } else { state.isDragging = false; state.draggingSiteIndex = null; updateCursor(); } } else { const currentlyHovered = findSiteIndexAtPoint(x, y); if (currentlyHovered !== state.hoveredSiteIndex) { state.hoveredSiteIndex = currentlyHovered; updateCursor(); requestAnimationFrame(drawPreview); } } }
    function handleMouseUp(event) { if (state.isDragging) { state.isDragging = false; state.draggingSiteIndex = null; const { x, y } = getCanvasCoords(event); state.hoveredSiteIndex = findSiteIndexAtPoint(x, y); updateCursor(); requestAnimationFrame(drawPreview); } }
    function handleMouseLeave(event) { if (state.isDragging) { state.isDragging = false; state.draggingSiteIndex = null; } if (state.hoveredSiteIndex !== null) { state.hoveredSiteIndex = null; requestAnimationFrame(drawPreview); } updateCursor(); }
    function clearAll() { state.internalSites = []; state.holePos = null; state.isDragging = false; state.draggingSiteIndex = null; state.hoveredSiteIndex = null; generateGeometry(); svgOutputTextarea.value = "Add 3+ points and click 'Generate SVG Code' or 'Download SVG'"; setMode('addSites'); updateButtonStates(); }
    function clearSites() { state.internalSites = []; state.isDragging = false; state.draggingSiteIndex = null; state.hoveredSiteIndex = null; generateGeometry(); }


    // --- Initial Setup ---
    function setupListeners() {
        // Sliders
        gapWidthSlider.addEventListener('input', (e) => { state.gapWidth = parseFloat(e.target.value); gapWidthValSpan.textContent = state.gapWidth.toFixed(1); generateGeometry(); });
        holeDiamSlider.addEventListener('input', (e) => { state.holeDiameter = parseFloat(e.target.value); holeDiamValSpan.textContent = state.holeDiameter.toFixed(1); if(state.holePos) generateGeometry(); else requestAnimationFrame(drawPreview); });
        chamferRadiusSlider.addEventListener('input', (e) => {
            state.chamferRadius = parseFloat(e.target.value);
            chamferRadiusValSpan.textContent = state.chamferRadius.toFixed(1);
            regenerateDisplayGeometry(); // Only regenerate display/rounding, not full Voronoi
            // No need to call updateButtonStates here, regenerateDisplayGeometry calls draw, which doesn't change button states
        });

        // Buttons and Canvas Listeners
        btnModeAdd.addEventListener('click', () => setMode('addSites')); btnModeHole.addEventListener('click', () => setMode('setHole'));
        btnClearSites.addEventListener('click', clearSites); btnClearAll.addEventListener('click', clearAll);
        btnExport.addEventListener('click', () => { svgOutputTextarea.value = generateSvgString(); }); btnDownloadSvg.addEventListener('click', downloadSvgFile);
        canvas.addEventListener('mousedown', handleMouseDown); window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp); canvas.addEventListener('mouseleave', handleMouseLeave);
        // Touch events mapping to mouse handlers
        canvas.addEventListener('touchstart', (e) => { e.preventDefault(); handleMouseDown(e); }, { passive: false });
        window.addEventListener('touchmove', (e) => { if (state.isDragging) { e.preventDefault(); handleMouseMove(e); }}, { passive: false }); // Prevent scroll only when dragging on canvas
        window.addEventListener('touchend', handleMouseUp);
        window.addEventListener('touchcancel', handleMouseUp);

        // Initial UI Update
        gapWidthValSpan.textContent = state.gapWidth.toFixed(1);
        holeDiamValSpan.textContent = state.holeDiameter.toFixed(1);
        chamferRadiusValSpan.textContent = state.chamferRadius.toFixed(1);
        clearAll(); // Initialize state and UI
    }

    // --- Run ---
    setupListeners();

}); // End DOMContentLoaded