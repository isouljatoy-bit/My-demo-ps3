Ps3  
<!DOCTYPE html>  
<html lang="en">  
<head>  
  <meta charset="UTF-8">  
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">  
  <title>PS3-Style Mobile Demo</title>  
  <style>  
    body { margin: 0; overflow: hidden; touch-action: none; background: #000; }  
    canvas { display: block; }  
    #joystick { position: fixed; bottom: 40px; left: 40px; width: 100px; height: 100px; background: rgba(255,255,255,0.15); border-radius: 50%; border: 2px solid rgba(255,255,255,0.3); }  
    #stick { position: absolute; top: 25px; left: 25px; width: 50px; height: 50px; background: rgba(255,255,255,0.5); border-radius: 50%; }  
  </style>  
</head>  
<body>  
  <div id="joystick">  
    <div id="stick"></div>  
  </div>  
  
  <script type="importmap">  
    {  
      "imports": {  
        "three": "https://unpkg.com/three@0.160.0/build/three.module.js",  
        "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"  
      }  
    }  
  </script>  
  
  <script type="module">  
    import * as THREE from 'three';  
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; // fallback  
    import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';  
    import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';  
    import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';  
    import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';  
    import { RGBShiftShader } from 'three/addons/shaders/RGBShiftShader.js';  
  
    // --- Setup renderer ---  
    const renderer = new THREE.WebGLRenderer({ antialias: true });  
    renderer.setSize(window.innerWidth, window.innerHeight);  
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // save battery  
    renderer.toneMapping = THREE.ACESFilmicToneMapping;  
    renderer.toneMappingExposure = 1.1;  
    document.body.appendChild(renderer.domElement);  
  
    const scene = new THREE.Scene();  
    scene.background = new THREE.Color(0x1a1a1a);  
    scene.fog = new THREE.Fog(0x1a1a1a, 20, 80);  
  
    const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 200);  
    camera.position.set(0, 5, 12);  
    camera.lookAt(0, 0, 0);  
  
    // --- Post processing (PS3 bloom + gritty color) ---  
    const composer = new EffectComposer(renderer);  
    composer.addPass(new RenderPass(scene, camera));  
  
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.8, 0.3, 0.2);  
    bloomPass.threshold = 0.6;  
    bloomPass.strength = 0.9;  
    bloomPass.radius = 0.5;  
    composer.addPass(bloomPass);  
  
    // RGB shift for slight chromatic aberration (PS3 effect)  
    const rgbShift = new ShaderPass(RGBShiftShader);  
    rgbShift.uniforms.amount.value = 0.0015;  
    composer.addPass(rgbShift);  
  
    // --- Lighting ---  
    const ambient = new THREE.AmbientLight(0x404066);  
    scene.add(ambient);  
    const dirLight = new THREE.DirectionalLight(0xffeedd, 1.5);  
    dirLight.position.set(10, 20, 5);  
    dirLight.castShadow = true;  
    dirLight.shadow.mapSize.set(512, 512);  
    dirLight.shadow.camera.near = 1;  
    dirLight.shadow.camera.far = 50;  
    dirLight.shadow.camera.left = -15;  
    dirLight.shadow.camera.right = 15;  
    dirLight.shadow.camera.top = 15;  
    dirLight.shadow.camera.bottom = -10;  
    scene.add(dirLight);  
  
    // --- Ground with a gritty PS3 texture (procedural) ---  
    const groundCanvas = document.createElement('canvas');  
    groundCanvas.width = 512;  
    groundCanvas.height = 512;  
    const ctx = groundCanvas.getContext('2d');  
    ctx.fillStyle = '#2a2a2a';  
    ctx.fillRect(0, 0, 512, 512);  
    // add noise and cracks  
    for (let i = 0; i < 4000; i++) {  
      const x = Math.random() * 512;  
      const y = Math.random() * 512;  
      const val = Math.floor(Math.random() * 80 + 40);  
      ctx.fillStyle = `rgb(${val},${val},${val})`;  
      ctx.fillRect(x, y, 2, 2);  
    }  
    // cracks  
    ctx.strokeStyle = '#111';  
    ctx.lineWidth = 2;  
    for (let j = 0; j < 15; j++) {  
      ctx.beginPath();  
      ctx.moveTo(Math.random()*512, Math.random()*512);  
      ctx.lineTo(Math.random()*512, Math.random()*512);  
      ctx.stroke();  
    }  
    const groundTex = new THREE.CanvasTexture(groundCanvas);  
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;  
    groundTex.repeat.set(8, 8);  
  
    const groundMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.9, metalness: 0.1 });  
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), groundMat);  
    ground.rotation.x = -Math.PI / 2;  
    ground.receiveShadow = true;  
    scene.add(ground);  
  
    // --- A PS3-style "character" (rusty metal cube) ---  
    const charCanvas = document.createElement('canvas');  
    charCanvas.width = 256;  
    charCanvas.height = 256;  
    const cctx = charCanvas.getContext('2d');  
    cctx.fillStyle = '#8b5a2b';  
    cctx.fillRect(0,0,256,256);  
    // rust spots  
    for (let i=0;i<600;i++) {  
      cctx.fillStyle = `rgb(${100+Math.random()*80},${60+Math.random()*50},${20+Math.random()*30})`;  
      cctx.fillRect(Math.random()*256, Math.random()*256, 4, 4);  
    }  
    const charTex = new THREE.CanvasTexture(charCanvas);  
    const charMat = new THREE.MeshStandardMaterial({ map: charTex, roughness: 0.6, metalness: 0.4 });  
    const character = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.8), charMat);  
    character.position.y = 1.1;  
    character.castShadow = true;  
    character.receiveShadow = true;  
    scene.add(character);  
  
    // Add some debris to fill the scene (PS3 clutter)  
    const debrisMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });  
    for (let i = 0; i < 25; i++) {  
      const debris = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), debrisMat);  
      debris.position.set((Math.random()-0.5)*20, 0.15, (Math.random()-0.5)*20);  
      debris.castShadow = true;  
      debris.receiveShadow = true;  
      scene.add(debris);  
    }  
  
    // --- Mobile controls ---  
    // We'll use simple touch joystick for movement  
    const joystick = document.getElementById('joystick');  
    const stick = document.getElementById('stick');  
    let moveX = 0, moveY = 0;  
    let joystickActive = false;  
  
    function handleTouchStart(e) {  
      e.preventDefault();  
      const touch = e.touches[0];  
      const rect = joystick.getBoundingClientRect();  
      const centerX = rect.left + rect.width/2;  
      const centerY = rect.top + rect.height/2;  
      const dx = touch.clientX - centerX;  
      const dy = touch.clientY - centerY;  
      const maxDist = rect.width/2;  
      const dist = Math.min(maxDist, Math.sqrt(dx*dx+dy*dy));  
      const angle = Math.atan2(dy, dx);  
      moveX = Math.cos(angle) * (dist/maxDist);  
      moveY = -Math.sin(angle) * (dist/maxDist);  
      stick.style.transform = `translate(${moveX * maxDist * 0.5}px, ${-moveY * maxDist * 0.5}px)`;  
      joystickActive = true;  
    }  
  
    function handleTouchMove(e) {  
      e.preventDefault();  
      if (!joystickActive) return;  
      const touch = e.touches[0];  
      const rect = joystick.getBoundingClientRect();  
      const centerX = rect.left + rect.width/2;  
      const centerY = rect.top + rect.height/2;  
      const dx = touch.clientX - centerX;  
      const dy = touch.clientY - centerY;  
      const maxDist = rect.width/2;  
      const dist = Math.min(maxDist, Math.sqrt(dx*dx+dy*dy));  
      const angle = Math.atan2(dy, dx);  
      moveX = Math.cos(angle) * (dist/maxDist);  
      moveY = -Math.sin(angle) * (dist/maxDist);  
      stick.style.transform = `translate(${moveX * maxDist * 0.5}px, ${-moveY * maxDist * 0.5}px)`;  
    }  
  
    function handleTouchEnd(e) {  
      e.preventDefault();  
      moveX = 0;  
      moveY = 0;  
      stick.style.transform = 'translate(0, 0)';  
      joystickActive = false;  
    }  
  
    joystick.addEventListener('touchstart', handleTouchStart, {passive: false});  
    joystick.addEventListener('touchmove', handleTouchMove, {passive: false});  
    joystick.addEventListener('touchend', handleTouchEnd);  
    joystick.addEventListener('touchcancel', handleTouchEnd);  
  
    // --- Resize ---  
    window.addEventListener('resize', () => {  
      camera.aspect = window.innerWidth / window.innerHeight;  
      camera.updateProjectionMatrix();  
      renderer.setSize(window.innerWidth, window.innerHeight);  
      composer.setSize(window.innerWidth, window.innerHeight);  
    });  
  
    // --- Animation loop ---  
    const clock = new THREE.Clock();  
    function animate() {  
      requestAnimationFrame(animate);  
      const dt = Math.min(clock.getDelta(), 0.1);  
  
      // Move character based on joystick  
      if (Math.abs(moveX) > 0.05 || Math.abs(moveY) > 0.05) {  
        const speed = 4.0;  
        const forward = new THREE.Vector3(-moveX, 0, -moveY).normalize();  
        character.position.x += forward.x * speed * dt;  
        character.position.z += forward.z * speed * dt;  
        // rotate character to face movement direction  
        if (forward.length() > 0.1) {  
          const angle = Math.atan2(forward.x, forward.z);  
          character.rotation.y = angle;  
        }  
      }  
  
      // Camera follows character (third-person)  
      const camOffset = new THREE.Vector3(0, 3.5, 6);  
      const targetPos = character.position.clone().add(camOffset);  
      camera.position.lerp(targetPos, 0.1);  
      camera.lookAt(character.position.x, character.position.y + 1.5, character.position.z);  
  
      // subtle directional light animation  
      dirLight.position.x = 10 + Math.sin(Date.now()*0.0005)*3;  
  
      composer.render();  
    }  
    animate();  
  </script>  
</body>  
</html>  
