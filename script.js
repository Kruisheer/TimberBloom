const canvas = document.getElementById('preview-canvas');
const ctx = canvas.getContext('2d');

// Controls
const widthSlider = document.getElementById('width');
const heightSlider = document.getElementById('height');
const freqSlider = document.getElementById('frequency');
const ampSlider = document.getElementById('amplitude');
const thickSlider = document.getElementById('thickness');
const holeDiamSlider = document.getElementById('holeDiam');

// Value Displays
const widthValSpan = document.getElementById('width-val');
const heightValSpan = document.getElementById('height-val');
const freqValSpan = document.getElementById('freq-val');
const ampValSpan = document.getElementById('amp-val');
const thickValSpan = document.getElementById('thick-val');
const holeDiamValSpan = document.getElementById('holeDiam-val');
const holePosInfoDiv = document.getElementById('hole-pos-info');

// Export
const exportBtn = document.getElementById('export-btn');
const svgOutputTextarea = document.getElementById('svg-output');

// --- State ---
let state = {
    width: 50,
    height: 40,
    frequency: 3,
    amplitude: 5,
    thickness: 1.5,
    holeDiameter: 1.5,
    holePos: null, // { x: mm, y: mm } relative to top-left of shape
    points: [] // Store calculated points
};

// --- Core Functions ---

function generateWavyPoints() {
    const points = [];
    const numSegments = 50; // How many points to define the curve
    const halfHeight = state.height / 2;
    const effectiveAmplitude = Math.min(state.amplitude, halfHeight); // Don't let waves exceed half height

    // Top edge
    for (let i = 0; i <= numSegments; i++) {
        const x = (i / numSegments) * state.width;
        // Sine wave: y = amplitude * sin(frequency * angle)
        // Angle needs to map 0 -> width to 0 -> frequency * 2 * PI
        const angle = (i / numSegments) * state.frequency * 2 * Math.PI;
        const yOffset = effectiveAmplitude * Math.sin(angle);
        // Base the wave around y = halfHeight/2 (roughly top quarter)
        const y = halfHeight / 2 - yOffset;
        points.push({ x, y });
    }

    // Bottom edge (reverse direction to connect properly)
    // Use a slightly different wave (e.g., cosine or phase shift)
    for (let i = numSegments; i >= 0; i--) {
        const x = (i / numSegments) * state.width;
        const angle = (i / numSegments) * state.frequency * 2 * Math.PI;
        // Inverted cosine wave for variety, based around bottom quarter
        const yOffset = effectiveAmplitude * Math.cos(angle + Math.PI / 4); // Phase shift
        const y = halfHeight + halfHeight / 2 + yOffset;
        points.push({ x, y });
    }

    state.points = points; // Store generated points
}

function drawPreview() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (state.points.length < 2) return;

    // Calculate scale and center offset to fit shape in canvas
    const padding = 20; // Pixels padding
    const availableWidth = canvas.width - 2 * padding;
    const availableHeight = canvas.height - 2 * padding;

    const scaleX = availableWidth / state.width;
    const scaleY = availableHeight / state.height;
    const scale = Math.min(scaleX, scaleY); // Use uniform scaling

    const drawWidth = state.width * scale;
    const drawHeight = state.height * scale;
    const offsetX = (canvas.width - drawWidth) / 2;
    const offsetY = (canvas.height - drawHeight) / 2;

    // Apply scaling and translation
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Draw the shape
    ctx.beginPath();
    ctx.moveTo(state.points[0].x, state.points[0].y);
    for (let i = 1; i < state.points.length; i++) {
        // Use quadratic curves for smoothness (optional, lineTo is simpler)
        // Need to calculate control points for curves, sticking to lineTo for simplicity here
         ctx.lineTo(state.points[i].x, state.points[i].y);
    }
    ctx.closePath();

    // Style based on state
    ctx.lineWidth = state.thickness; // Note: thickness is in 'mm', but scales with the drawing
    ctx.strokeStyle = '#333333';
    ctx.stroke();

    // Draw the hole if set
    if (state.holePos) {
        ctx.beginPath();
        ctx.arc(
            state.holePos.x,
            state.holePos.y,
            state.holeDiameter / 2, // Radius
            0,
            2 * Math.PI
        );
         ctx.fillStyle = '#ffffff'; // Draw white circle to simulate hole
         ctx.fill();
         ctx.lineWidth = 0.5; // Thinner stroke for hole outline
         ctx.strokeStyle = '#888888';
         ctx.stroke();
    }

    ctx.restore(); // Restore context before drawing anything else
}

function generateSvgString() {
    if (state.points.length < 2) return "";

    // Create the path 'd' attribute string
    let pathData = `M ${state.points[0].x.toFixed(2)} ${state.points[0].y.toFixed(2)} `;
    for (let i = 1; i < state.points.length; i++) {
        pathData += `L ${state.points[i].x.toFixed(2)} ${state.points[i].y.toFixed(2)} `;
    }
    pathData += "Z"; // Close the path

    // Add hole circle if it exists
    let holeCircle = "";
    if (state.holePos) {
        holeCircle = `\n  <circle cx="${state.holePos.x.toFixed(2)}" cy="${state.holePos.y.toFixed(2)}" r="${(state.holeDiameter / 2).toFixed(2)}" fill="none" stroke="#000000" stroke-width="${state.thickness * 0.3}" /> <!-- NOTE: Laser cutters often ignore fill, only cut strokes -->`;
         // Alternatively, make the hole a cut-out path using path subtraction (more complex)
         // For simple laser cutting, just drawing the circle path is usually sufficient.
    }


    // IMPORTANT: ViewBox should match the actual dimensions for 1:1 scale
    const svgContent = `<svg width="${state.width}mm" height="${state.height}mm" viewBox="0 0 ${state.width} ${state.height}" xmlns="http://www.w3.org/2000/svg">
  <path d="${pathData}" fill="none" stroke="#000000" stroke-width="${state.thickness.toFixed(2)}" />${holeCircle}
</svg>`;

    return svgContent;
}

// --- Event Handlers ---

function updateStateAndDraw() {
    // Read values from sliders
    state.width = parseFloat(widthSlider.value);
    state.height = parseFloat(heightSlider.value);
    state.frequency = parseFloat(freqSlider.value);
    state.amplitude = parseFloat(ampSlider.value);
    state.thickness = parseFloat(thickSlider.value);
    state.holeDiameter = parseFloat(holeDiamSlider.value);

    // Update display spans
    widthValSpan.textContent = state.width;
    heightValSpan.textContent = state.height;
    freqValSpan.textContent = state.frequency.toFixed(1);
    ampValSpan.textContent = state.amplitude.toFixed(1);
    thickValSpan.textContent = state.thickness.toFixed(1);
    holeDiamValSpan.textContent = state.holeDiameter.toFixed(1);


    // Regenerate points and redraw
    generateWavyPoints();

     // Check if hole is still within bounds, reset if not
     if (state.holePos && (state.holePos.x > state.width || state.holePos.y > state.height)) {
        state.holePos = null;
        holePosInfoDiv.textContent = `Hole: Not set (out of bounds)`;
     }


    requestAnimationFrame(drawPreview); // Use rAF for smoother updates
}

function handleCanvasClick(event) {
     // Calculate click position relative to canvas element
    const rect = canvas.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    // Convert canvas click coordinates back to shape coordinates (inverse of drawing logic)
    const padding = 20;
    const availableWidth = canvas.width - 2 * padding;
    const availableHeight = canvas.height - 2 * padding;
    const scaleX = availableWidth / state.width;
    const scaleY = availableHeight / state.height;
    const scale = Math.min(scaleX, scaleY);
    const drawWidth = state.width * scale;
    const drawHeight = state.height * scale;
    const offsetX = (canvas.width - drawWidth) / 2;
    const offsetY = (canvas.height - drawHeight) / 2;

    // Click relative to the scaled drawing's top-left corner
    const shapeClickX = (clickX - offsetX) / scale;
    const shapeClickY = (clickY - offsetY) / scale;


     // Basic check if click is within the bounding box of the shape
     if (shapeClickX >= 0 && shapeClickX <= state.width && shapeClickY >= 0 && shapeClickY <= state.height) {
        state.holePos = { x: shapeClickX, y: shapeClickY };
        holePosInfoDiv.textContent = `Hole @ (${shapeClickX.toFixed(1)}, ${shapeClickY.toFixed(1)}) mm`;
        requestAnimationFrame(drawPreview); // Redraw with hole
     } else {
        console.log("Click outside shape bounds.");
     }
}


// --- Initial Setup ---

// Attach listeners to all sliders
[widthSlider, heightSlider, freqSlider, ampSlider, thickSlider, holeDiamSlider].forEach(slider => {
    slider.addEventListener('input', updateStateAndDraw);
});

// Export button listener
exportBtn.addEventListener('click', () => {
    const svgCode = generateSvgString();
    svgOutputTextarea.value = svgCode;
});

// Canvas click listener
canvas.addEventListener('click', handleCanvasClick);


// Initial draw
updateStateAndDraw();
