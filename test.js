console.log('Script loaded, Three.js available:', typeof THREE !== 'undefined');

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, creating scene...');
    
    if (typeof THREE !== 'undefined') {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

        const renderer = new THREE.WebGLRenderer();
        renderer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(renderer.domElement);

        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        const cube = new THREE.Mesh(geometry, material);
        scene.add(cube);

        camera.position.z = 5;

        // Color array for different colors
        const colors = [
            0x00ff00, // Green
            0xff0000, // Red
            0x0000ff, // Blue
            0xffff00, // Yellow
            0xff00ff, // Magenta
            0x00ffff, // Cyan
            0xffa500, // Orange
            0x800080  // Purple
        ];
        let colorIndex = 0;

        // Change color button functionality
        const changeColorBtn = document.getElementById('changeColorBtn');
        changeColorBtn.addEventListener('click', function() {
            colorIndex = (colorIndex + 1) % colors.length;
            cube.material.color.setHex(colors[colorIndex]);
            console.log('Color changed to:', colors[colorIndex].toString(16));
        });

        function animate() {
            cube.rotation.x += 0.01;
            cube.rotation.y += 0.01;
            renderer.render(scene, camera);
        }
        renderer.setAnimationLoop(animate);
        
        console.log('Scene created successfully!');
    } else {
        console.error('Three.js not loaded!');
    }
});
