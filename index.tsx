import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { edgeTable, triTable } from './MarchingCubesTables.js';

// --- Environments ---
const environments = [
    { name: 'Fiery Sky', url: 'the_sky_is_on_fire_1k.hdr' },
    { name: 'Small Studio', url: 'studio_small_03_1k.hdr' },
    { name: 'Warehouse', url: 'empty_warehouse_01_1k.hdr' },
    { name: 'Artist Workshop', url: 'artist_workshop_1k.hdr' },
    { name: 'Kloppenheim', url: 'kloppenheim_06_1k.hdr' },
    { name: 'Venice Sunset', url: 'venice_sunset_1k.hdr' },
    { name: 'Shanghai Bund', url: 'shanghai_bund_1k.hdr' },
    { name: 'Dawn', url: 'kiara_1_dawn_1k.hdr' },
    { name: 'Syferfontein', url: 'syferfontein_1d_clear_1k.hdr' },
    { name: 'Photo Studio', url: 'brown_photostudio_02_1k.hdr' },
    { name: 'Delta', url: 'delta_2_1k.hdr' },
    { name: 'Goegap', url: 'goegap_1k.hdr' },
    { name: 'Solitude', url: 'solitude_1k.hdr' }
];
const hdrPath = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/';
let currentEnvironment = environments[0];


// --- Parameters & State ---
const params = {
    sphereCount: 10,
    smoothK: 0.075,
    speed: 0.15,
    targetRadius: 0.0125,
    radiusVariance: 0.125,
    materialRoughness: 0.400,
    ior: 1.700,
    specular: 0.530,
    cellsPerAxis: 40,
    volumeRadius: 0.175,
    isoLevel: 0.0,
};

let scene, camera, renderer, material, mesh, controls, clock, rgbeLoader;
let spheres = [];
const maxSpheres = 64;

// --- UI State ---
let areJoysticksVisible = true;
let isPanelCollapsed = false;

// --- Helper Vectors (to avoid allocation in loops) ---
const p = new THREE.Vector3();
const cornerPositions = Array.from({ length: 8 }, () => new THREE.Vector3());
const cornerValues = new Float32Array(8);
const edgeIntersection = Array.from({ length: 12 }, () => new THREE.Vector3());
const normal_h = new THREE.Vector3();
const lookVector = new THREE.Vector2(0, 0);
const moveVector = new THREE.Vector2(0, 0);
const cameraForward = new THREE.Vector3();
const forwardOnPlane = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const moveDirection = new THREE.Vector3();

// --- Main Initialization ---
function init() {
    clock = new THREE.Clock();
    const container = document.getElementById('container');

    // Scene
    scene = new THREE.Scene();

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 0.45);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    // Material
    material = new THREE.MeshPhysicalMaterial({
        roughness: params.materialRoughness,
        metalness: 0.0,
        transmission: 1.0,
        ior: params.ior,
        specularIntensity: params.specular,
        envMapIntensity: 1.0,
        side: THREE.DoubleSide,
        transparent: true,
    });
    
    // Initial mesh
    const geometry = new THREE.BufferGeometry();
    mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0.5;

    // Spheres
    reseedSpheres(params.sphereCount);

    // UI
    setupUI();
    // Setup both joysticks
    setupJoystick('joystick-move-container', 'joystick-move-handle', moveVector);
    setupJoystick('joystick-look-container', 'joystick-look-handle', lookVector);

    // Event Listeners
    window.addEventListener('resize', onWindowResize);
    
    // Environment Lighting (Load last, then start animation)
    rgbeLoader = new RGBELoader().setPath(hdrPath);
    loadEnvironment(currentEnvironment.url, () => {
        // Start the animation loop once the initial environment is loaded
        animate();
    });
}

// --- Environment Loading ---
function loadEnvironment(url, onLoaded) {
    rgbeLoader.load(url, (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        scene.background = texture;
        scene.environment = texture;
        if (onLoaded) onLoaded();
    }, undefined, (error) => {
        console.error(`An error occurred loading the environment: ${url}`, error);
    });
}


// --- Animation & Update Loop ---
function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();

    // --- Camera Control Update ---

    // 1. Handle Look/Rotation from the right joystick
    if (controls && lookVector.lengthSq() > 0.0001) {
        const rotationSpeed = 1.5; // Radians per second
        const azimuthalAngleDelta = -lookVector.x * rotationSpeed * deltaTime;
        const polarAngleDelta = -lookVector.y * rotationSpeed * deltaTime;

        const offset = camera.position.clone().sub(controls.target);
        const yAxis = new THREE.Vector3(0, 1, 0);
        offset.applyAxisAngle(yAxis, azimuthalAngleDelta);

        const rightAxis = new THREE.Vector3().crossVectors(yAxis, offset).normalize();
        const currentPolarAngle = Math.acos(offset.y / offset.length());
        let newPolarAngle = currentPolarAngle + polarAngleDelta;
        newPolarAngle = Math.max(controls.minPolarAngle, Math.min(controls.maxPolarAngle, newPolarAngle));
        const finalPolarRotation = newPolarAngle - currentPolarAngle;
        offset.applyAxisAngle(rightAxis, finalPolarRotation);

        camera.position.copy(controls.target).add(offset);
    }
    
    // 2. Handle Move/Translation from the left joystick
    if (moveVector.lengthSq() > 0.0001) {
        const moveSpeed = 0.3; // Units per second
        
        // Get camera's local forward and right directions
        camera.getWorldDirection(cameraForward);
        
        // Project forward vector onto the horizontal plane (Y=0)
        forwardOnPlane.set(cameraForward.x, 0, cameraForward.z).normalize();
        
        // Right vector is perpendicular to the up vector and the forward vector
        cameraRight.crossVectors(camera.up, cameraForward).normalize();
        
        // Calculate movement direction based on joystick input
        const moveY = forwardOnPlane.multiplyScalar(-moveVector.y); // Forward/backward
        const moveX = cameraRight.multiplyScalar(moveVector.x); // Strafe left/right
        moveDirection.addVectors(moveX, moveY).normalize();

        const moveDelta = moveDirection.multiplyScalar(moveSpeed * deltaTime);

        // Move both camera and its target together
        camera.position.add(moveDelta);
        controls.target.add(moveDelta);
    }


    updateSpheres(deltaTime);
    updateMesh();
    controls.update();
    renderer.render(scene, camera);
}

// --- Sphere Logic ---
function reseedSpheres(count) {
    spheres = [];
    for (let i = 0; i < count; i++) {
        const radius = params.targetRadius + (Math.random() - 0.5) * 2 * params.radiusVariance * params.targetRadius;
        const padding = params.volumeRadius * (0.3 + params.smoothK * 3);
        spheres.push({
            position: new THREE.Vector3(
                (Math.random() - 0.5) * (params.volumeRadius - padding) * 2,
                (Math.random() - 0.5) * (params.volumeRadius - padding) * 2,
                (Math.random() - 0.5) * (params.volumeRadius - padding) * 2
            ),
            target: new THREE.Vector3(
                 (Math.random() - 0.5) * (params.volumeRadius - padding) * 2,
                 (Math.random() - 0.5) * (params.volumeRadius - padding) * 2,
                 (Math.random() - 0.5) * (params.volumeRadius - padding) * 2
            ),
            radius: radius,
            speed: (0.5 + Math.random() * 1.0) * params.speed,
        });
    }
}

function updateSpheres(deltaTime) {
    const padding = params.volumeRadius * (0.3 + params.smoothK * 3);
    const bounds = params.volumeRadius - padding;

    for (const sphere of spheres) {
        let direction = p.subVectors(sphere.target, sphere.position);
        const distance = direction.length();

        if (distance < 0.001) {
            sphere.target.set(
                (Math.random() - 0.5) * bounds * 2,
                (Math.random() - 0.5) * bounds * 2,
                (Math.random() - 0.5) * bounds * 2
            );
            continue;
        }

        const moveStep = sphere.speed * deltaTime;
        if (moveStep >= distance) {
            sphere.position.copy(sphere.target);
             sphere.target.set(
                (Math.random() - 0.5) * bounds * 2,
                (Math.random() - 0.5) * bounds * 2,
                (Math.random() - 0.5) * bounds * 2
            );
        } else {
            sphere.position.add(direction.normalize().multiplyScalar(moveStep));
        }
    }
}


// --- Marching Cubes Logic ---
function sdf_sphere(p, center, radius) {
    return p.distanceTo(center) - radius;
}

function smin(a, b, k) {
    const h = Math.max(0.0, Math.min(1.0, 0.5 + 0.5 * (b - a) / k));
    return a * h + b * (1.0 - h) - k * h * (1.0 - h);
}

function fieldValue(worldPos) {
    let d = 1e9;
    for (const sphere of spheres) {
        const di = sdf_sphere(worldPos, sphere.position, sphere.radius);
        d = smin(d, di, params.smoothK);
    }
    return d;
}

function estimateNormal(pos) {
    const h = 0.001;
    const nx = fieldValue(p.set(pos.x + h, pos.y, pos.z)) - fieldValue(p.set(pos.x - h, pos.y, pos.z));
    const ny = fieldValue(p.set(pos.x, pos.y + h, pos.z)) - fieldValue(p.set(pos.x, pos.y - h, pos.z));
    const nz = fieldValue(p.set(pos.x, pos.y, pos.z + h)) - fieldValue(p.set(pos.x, pos.y, pos.z - h));
    return normal_h.set(nx, ny, nz).normalize();
}

function interpolateVertex(p1, p2, v1, v2) {
    if (Math.abs(params.isoLevel - v1) < 0.00001) return p1;
    if (Math.abs(params.isoLevel - v2) < 0.00001) return p2;
    if (Math.abs(v1 - v2) < 0.00001) return p1;
    const t = (params.isoLevel - v1) / (v2 - v1);
    return new THREE.Vector3().lerpVectors(p1, p2, t);
}


function updateMesh() {
    const vertices = [];
    const normals = [];

    const cells = params.cellsPerAxis;
    const halfSize = params.volumeRadius;
    const cellSize = (halfSize * 2) / cells;
    const origin = -halfSize;

    for (let i = 0; i < cells; i++) {
        for (let j = 0; j < cells; j++) {
            for (let k = 0; k < cells; k++) {
                const cellOriginX = origin + i * cellSize;
                const cellOriginY = origin + j * cellSize;
                const cellOriginZ = origin + k * cellSize;
                
                cornerPositions[0].set(cellOriginX, cellOriginY, cellOriginZ);
                cornerPositions[1].set(cellOriginX + cellSize, cellOriginY, cellOriginZ);
                cornerPositions[2].set(cellOriginX + cellSize, cellOriginY + cellSize, cellOriginZ);
                cornerPositions[3].set(cellOriginX, cellOriginY + cellSize, cellOriginZ);
                cornerPositions[4].set(cellOriginX, cellOriginY, cellOriginZ + cellSize);
                cornerPositions[5].set(cellOriginX + cellSize, cellOriginY, cellOriginZ + cellSize);
                cornerPositions[6].set(cellOriginX + cellSize, cellOriginY + cellSize, cellOriginZ + cellSize);
                cornerPositions[7].set(cellOriginX, cellOriginY + cellSize, cellOriginZ + cellSize);

                let cubeIndex = 0;
                for (let c = 0; c < 8; c++) {
                    cornerValues[c] = fieldValue(cornerPositions[c]);
                    if (cornerValues[c] < params.isoLevel) cubeIndex |= (1 << c);
                }

                if (edgeTable[cubeIndex] === 0) continue;

                if (edgeTable[cubeIndex] & 1) edgeIntersection[0] = interpolateVertex(cornerPositions[0], cornerPositions[1], cornerValues[0], cornerValues[1]);
                if (edgeTable[cubeIndex] & 2) edgeIntersection[1] = interpolateVertex(cornerPositions[1], cornerPositions[2], cornerValues[1], cornerValues[2]);
                if (edgeTable[cubeIndex] & 4) edgeIntersection[2] = interpolateVertex(cornerPositions[2], cornerPositions[3], cornerValues[2], cornerValues[3]);
                if (edgeTable[cubeIndex] & 8) edgeIntersection[3] = interpolateVertex(cornerPositions[3], cornerPositions[0], cornerValues[3], cornerValues[0]);
                if (edgeTable[cubeIndex] & 16) edgeIntersection[4] = interpolateVertex(cornerPositions[4], cornerPositions[5], cornerValues[4], cornerValues[5]);
                if (edgeTable[cubeIndex] & 32) edgeIntersection[5] = interpolateVertex(cornerPositions[5], cornerPositions[6], cornerValues[5], cornerValues[6]);
                if (edgeTable[cubeIndex] & 64) edgeIntersection[6] = interpolateVertex(cornerPositions[6], cornerPositions[7], cornerValues[6], cornerValues[7]);
                if (edgeTable[cubeIndex] & 128) edgeIntersection[7] = interpolateVertex(cornerPositions[7], cornerPositions[4], cornerValues[7], cornerValues[4]);
                if (edgeTable[cubeIndex] & 256) edgeIntersection[8] = interpolateVertex(cornerPositions[0], cornerPositions[4], cornerValues[0], cornerValues[4]);
                if (edgeTable[cubeIndex] & 512) edgeIntersection[9] = interpolateVertex(cornerPositions[1], cornerPositions[5], cornerValues[1], cornerValues[5]);
                if (edgeTable[cubeIndex] & 1024) edgeIntersection[10] = interpolateVertex(cornerPositions[2], cornerPositions[6], cornerValues[2], cornerValues[6]);
                if (edgeTable[cubeIndex] & 2048) edgeIntersection[11] = interpolateVertex(cornerPositions[3], cornerPositions[7], cornerValues[3], cornerValues[7]);

                for (let t = 0; triTable[cubeIndex][t] !== -1; t += 3) {
                    const v1 = edgeIntersection[triTable[cubeIndex][t + 2]];
                    const v2 = edgeIntersection[triTable[cubeIndex][t + 1]];
                    const v3 = edgeIntersection[triTable[cubeIndex][t]];
                    
                    vertices.push(v1.x, v1.y, v1.z);
                    vertices.push(v2.x, v2.y, v2.z);
                    vertices.push(v3.x, v3.y, v3.z);

                    const n1 = estimateNormal(v1);
                    const n2 = estimateNormal(v2);
                    const n3 = estimateNormal(v3);

                    normals.push(n1.x, n1.y, n1.z);
                    normals.push(n2.x, n2.y, n2.z);
                    normals.push(n3.x, n3.y, n3.z);
                }
            }
        }
    }
    
    mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    mesh.geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    mesh.geometry.computeBoundingSphere();
}

// --- Reusable Joystick Setup ---
function setupJoystick(containerId: string, handleId: string, outputVector: THREE.Vector2) {
    const container = document.getElementById(containerId) as HTMLDivElement;
    const handle = document.getElementById(handleId) as HTMLDivElement;
    if (!container || !handle) return;

    const radius = container.offsetWidth / 2;
    let isDragging = false;
    let pointerId: number | null = null;

    const updateJoystick = (event: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        const centerX = rect.left + radius;
        const centerY = rect.top + radius;

        let dx = event.clientX - centerX;
        let dy = event.clientY - centerY;

        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > radius) {
            dx = (dx / distance) * radius;
            dy = (dy / distance) * radius;
        }

        handle.style.transform = `translate(${dx}px, ${dy}px)`;
        outputVector.set(dx / radius, dy / radius);
    };

    const onPointerDown = (event: PointerEvent) => {
        if (isDragging) return;

        event.preventDefault();
        event.stopPropagation();
        isDragging = true;
        pointerId = event.pointerId;
        container.setPointerCapture(pointerId);

        handle.style.transition = 'none';
        updateJoystick(event);
    };

    const onPointerMove = (event: PointerEvent) => {
        if (isDragging && event.pointerId === pointerId) {
            event.preventDefault();
            updateJoystick(event);
        }
    };

    const onPointerUp = (event: PointerEvent) => {
        if (isDragging && event.pointerId === pointerId) {
            isDragging = false;
            pointerId = null;
            
            outputVector.set(0, 0);
            handle.style.transition = 'transform 0.2s ease-out';
            handle.style.transform = 'translate(0px, 0px)';
        }
    };

    container.addEventListener('pointerdown', onPointerDown, { passive: false });
    container.addEventListener('pointermove', onPointerMove, { passive: false });
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);
}


// --- UI Interaction ---
function togglePanelCollapse() {
    isPanelCollapsed = !isPanelCollapsed;
    document.getElementById('ui-panel').classList.toggle('collapsed', isPanelCollapsed);
}

function toggleJoysticksVisibility() {
    areJoysticksVisible = !areJoysticksVisible;
    document.body.classList.toggle('joysticks-hidden', !areJoysticksVisible);
}

// --- UI Setup ---
function setupUI() {
    const uiPanel = document.getElementById('ui-panel');
    const collapseBtn = document.getElementById('collapse-button');
    
    // Clear panel content, but keep the collapse button
    while (uiPanel.firstChild !== collapseBtn) {
        if (uiPanel.firstChild) uiPanel.removeChild(uiPanel.firstChild);
    }
    while(collapseBtn.nextSibling) {
        uiPanel.removeChild(collapseBtn.nextSibling);
    }

    collapseBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>`;
    collapseBtn.addEventListener('click', togglePanelCollapse);
    
    const panelTitle = document.createElement('div');
    panelTitle.className = 'panel-title';
    panelTitle.textContent = 'Controls';
    uiPanel.appendChild(panelTitle);
    
    const controlsWrapper = document.createElement('div');
    controlsWrapper.id = 'controls-wrapper';
    uiPanel.appendChild(controlsWrapper);

    // Initial state
    uiPanel.classList.toggle('collapsed', isPanelCollapsed);
    document.body.classList.toggle('joysticks-hidden', !areJoysticksVisible);

    // --- Joystick Toggle ---
    const joystickRow = document.createElement('div');
    joystickRow.className = 'control-row';
    const joystickLabel = document.createElement('label');
    joystickLabel.htmlFor = 'joystick-toggle';
    joystickLabel.textContent = 'Joysticks';
    const toggleSwitch = document.createElement('label');
    toggleSwitch.className = 'toggle-switch';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'joystick-toggle';
    checkbox.checked = areJoysticksVisible;
    checkbox.addEventListener('change', toggleJoysticksVisibility);
    const slider = document.createElement('span');
    slider.className = 'slider';
    toggleSwitch.appendChild(checkbox);
    toggleSwitch.appendChild(slider);
    joystickRow.appendChild(joystickLabel);
    joystickRow.appendChild(toggleSwitch);
    controlsWrapper.appendChild(joystickRow);

    // --- Environment Selector ---
    const envRow = document.createElement('div');
    envRow.className = 'control-row';
    const envLabel = document.createElement('label');
    envLabel.htmlFor = 'env-select';
    envLabel.textContent = 'Environment';
    const envSelect = document.createElement('select');
    envSelect.id = 'env-select';
    environments.forEach(env => {
        const option = document.createElement('option');
        option.value = env.url;
        option.textContent = env.name;
        if (env.url === currentEnvironment.url) {
            option.selected = true;
        }
        envSelect.appendChild(option);
    });
    envSelect.addEventListener('change', (e) => {
        const target = e.target as HTMLSelectElement;
        const selectedUrl = target.value;
        const selectedEnv = environments.find(env => env.url === selectedUrl);
        if (selectedEnv) {
            currentEnvironment = selectedEnv;
            loadEnvironment(selectedEnv.url, null); 
        }
    });
    envRow.appendChild(envLabel);
    envRow.appendChild(envSelect);
    controlsWrapper.appendChild(envRow);
    
    // --- Other Controls ---
    const controls = [
        { label: 'Spheres', id: 'sphereCount', min: 1, max: maxSpheres, step: 1, value: params.sphereCount, isInt: true, onchange: (val) => { params.sphereCount = val; reseedSpheres(val); } },
        { label: 'Smooth K', id: 'smoothK', min: 0.001, max: 0.12, step: 0.001, value: params.smoothK, onchange: (val) => params.smoothK = val },
        { label: 'Speed', id: 'speed', min: 0.0, max: 1.0, step: 0.01, value: params.speed, onchange: (val) => { params.speed = val; reseedSpheres(params.sphereCount); } },
        { label: 'Material Roughness', id: 'materialRoughness', min: 0.0, max: 0.4, step: 0.01, value: params.materialRoughness, onchange: (val) => material.roughness = val },
        { label: 'Index of Refraction', id: 'ior', min: 1.0, max: 2.33, step: 0.01, value: params.ior, onchange: (val) => material.ior = val },
        { label: 'Specular', id: 'specular', min: 0.0, max: 1.0, step: 0.01, value: params.specular, onchange: (val) => material.specularIntensity = val },
        { label: 'Zoom', id: 'zoom', min: 30, max: 120, step: 1, value: camera.fov, isInt: true, onchange: (val) => { camera.fov = val; camera.updateProjectionMatrix(); } },
    ];

    controls.forEach(control => {
        const row = document.createElement('div');
        row.className = 'control-row';
        const label = document.createElement('label');
        label.htmlFor = control.id;
        const updateLabel = (val) => {
             label.innerHTML = `${control.label}: <span class="value-span">${parseFloat(val).toFixed(control.step < 0.1 ? 3 : (control.isInt ? 0 : 2))}</span>`;
        };
        updateLabel(control.value);
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = control.id;
        slider.min = control.min.toString();
        slider.max = control.max.toString();
        slider.step = control.step.toString();
        slider.value = control.value.toString();
        slider.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement;
            let val = parseFloat(target.value);
            if (control.isInt) val = parseInt(target.value, 10);
            control.onchange(val);
            updateLabel(val);
        });
        row.appendChild(label);
        row.appendChild(slider);
        controlsWrapper.appendChild(row);
    });
}

// --- Event Handlers ---
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Start ---
init();