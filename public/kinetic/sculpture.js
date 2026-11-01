import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }
catch { const msg=document.createElement('div');msg.className='error';msg.textContent='This sculpture needs WebGL. Please open it in a browser with hardware acceleration enabled.';document.body.append(msg);throw new Error('WebGL unavailable'); }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x05080e);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
document.body.prepend(renderer.domElement);
renderer.domElement.setAttribute('aria-label', 'Interactive luminous core surrounded by moving metallic orbital rings. Drag to rotate, scroll to zoom.');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05080e, .035);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, .1, 80);
camera.position.set(0, 1.2, 8.3);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.enablePan = false; controls.minDistance=4.6;controls.maxDistance=13;controls.target.set(0,.08,0);
scene.add(new THREE.HemisphereLight(0x90baff,0x111d35,3));
const light=new THREE.PointLight(0x7cdeff,38,12);light.position.set(1.2,2,2);scene.add(light);
const rim=new THREE.PointLight(0xffbf78,20,12);rim.position.set(-3,-1,1);scene.add(rim);
const sculpture=new THREE.Group();scene.add(sculpture);
const uniforms={time:{value:0},energy:{value:0},accent:{value:new THREE.Color('#83dcff')}};
const core=new THREE.Mesh(new THREE.IcosahedronGeometry(.77,5),new THREE.ShaderMaterial({uniforms,vertexShader:`
uniform float time;uniform float energy;varying vec3 vP;varying vec3 vN;
void main(){vN=normal;float d=sin(position.x*7.+time*.7)*sin(position.y*8.-time*.5)*sin(position.z*6.+time*.4);vec3 p=position+normal*d*(.045+energy*.09);vP=p;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}
`,fragmentShader:`
uniform float time;uniform float energy;uniform vec3 accent;varying vec3 vP;varying vec3 vN;
void main(){float f=sin(vP.x*12.+sin(vP.y*9.+time*.5)*2.)+sin(vP.y*12.+sin(vP.z*8.-time*.4)*2.)+sin(vP.z*12.+sin(vP.x*8.+time*.3)*2.);float veins=pow(1.-smoothstep(0.,.24,abs(f)),2.);float bands=.5+.5*sin(vP.y*55.+f*2.);float edge=pow(1.-abs(dot(normalize(vN),vec3(0.,.2,1.))),3.);vec3 c=vec3(.025,.055,.085)+accent*(veins*(1.7+energy*2.)+edge*.65+bands*.025);gl_FragColor=vec4(c,1.);}
`}));sculpture.add(core);
// A soft additive halo sits behind the solid core, preserving its silhouette.
const haloCanvas=document.createElement('canvas');haloCanvas.width=256;haloCanvas.height=256;
const ctx=haloCanvas.getContext('2d');const gradient=ctx.createRadialGradient(128,128,12,128,128,128);
gradient.addColorStop(0,'rgba(255,255,255,.3)');gradient.addColorStop(.3,'rgba(255,255,255,.16)');gradient.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,256,256);
const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(haloCanvas),color:0x53bdff,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,opacity:.6}));halo.scale.set(4.7,4.7,1);sculpture.add(halo);
const rings=[];const glowMaterials=[];const metalMaterials=[];
for(let i=0;i<5;i++){
 const pivot=new THREE.Group();pivot.rotation.set(.4+i*.47,.2+i*.63,i*.4);sculpture.add(pivot);
 const radius=1.14+i*.21;
 const material=new THREE.MeshStandardMaterial({color:i%2?0xa5bed2:0x30465d,metalness:.86,roughness:.24});metalMaterials.push(material);
 const ring=new THREE.Mesh(new THREE.TorusGeometry(radius,.018+(i%2)*.012,10,200),material);pivot.add(ring);
 const glowMat=new THREE.MeshBasicMaterial({color:0x83dcff,transparent:true,opacity:.85});glowMaterials.push(glowMat);
 const arc=new THREE.Mesh(new THREE.TorusGeometry(radius,.008,6,90,Math.PI*.65),glowMat);arc.position.z=.021;arc.rotation.z=i*1.6;pivot.add(arc);
 const bead=new THREE.Mesh(new THREE.SphereGeometry(.055,16,12),glowMat);bead.position.set(radius*Math.cos(i*1.6),radius*Math.sin(i*1.6),.021);pivot.add(bead);
 // Small radial ticks give each orbit the detail of a scientific instrument.
 const tickPoints=[];for(let j=0;j<64;j++){const a=j*Math.PI/32;const r2=radius+(j%8===0?.085:.035);tickPoints.push(new THREE.Vector3(Math.cos(a)*(radius+.035),Math.sin(a)*(radius+.035),0),new THREE.Vector3(Math.cos(a)*r2,Math.sin(a)*r2,0));}
 pivot.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tickPoints),new THREE.LineBasicMaterial({color:0x6c879e,transparent:true,opacity:.4})));
 rings.push({pivot,base:pivot.rotation.clone(),speed:(i%2?-1:1)*(.08+i*.019)});
}
const stars=new Float32Array(1300*3);for(let i=0;i<1300;i++){const r=8+Math.random()*17;const a=Math.random()*Math.PI*2;const y=Math.random()*2-1;stars[i*3]=r*Math.sqrt(1-y*y)*Math.cos(a);stars[i*3+1]=r*y;stars[i*3+2]=r*Math.sqrt(1-y*y)*Math.sin(a);}
const dust=new THREE.Points(new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(stars,3)),new THREE.PointsMaterial({color:0x91adc7,size:.018,transparent:true,opacity:.65,sizeAttenuation:true}));scene.add(dust);
const grid=new THREE.GridHelper(26,52,0x1c3146,0x101c2b);grid.position.y=-2.5;grid.material.transparent=true;grid.material.opacity=.32;scene.add(grid);
let paused=reduced;let solar=false;let pulse=0;let time=0;let last=performance.now();
const pauseBtn=document.querySelector('#pause');function updatePause(){pauseBtn.textContent=paused?'▷ Resume':'Ⅱ Pause';pauseBtn.setAttribute('aria-pressed',String(paused));}updatePause();
pauseBtn.onclick=()=>{paused=!paused;updatePause();};
document.querySelector('#pulse').onclick=()=>{pulse=1;};
document.querySelector('#palette').onclick=()=>{solar=!solar;const color=new THREE.Color(solar?'#ffc085':'#83dcff');uniforms.accent.value.copy(color);halo.material.color.copy(color);light.color.copy(color);glowMaterials.forEach(m=>m.color.copy(color));document.querySelector('#palette').textContent=solar?'◐ Lunar':'◐ Solar';};
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,2));});
renderer.setAnimationLoop(now=>{const dt=Math.min((now-last)/1000,.05);last=now;if(!paused)time+=dt;pulse=Math.max(0,pulse-dt*.52);uniforms.time.value=time;uniforms.energy.value=pulse;
 core.rotation.y=time*.12;core.rotation.z=Math.sin(time*.15)*.12;
 sculpture.position.y=Math.sin(time*.6)*.065;sculpture.rotation.y=Math.sin(time*.1)*.12;
 rings.forEach(({pivot,base,speed},i)=>{pivot.rotation.x=base.x+time*speed; pivot.rotation.y=base.y+Math.sin(time*.19+i)*.3;pivot.rotation.z=base.z+time*speed*.4;pivot.scale.setScalar(1+pulse*(.1+i*.035));});
 halo.material.opacity=.6+pulse*.4;halo.scale.setScalar(4.7+pulse*1.4);dust.rotation.y=time*.006;controls.update();renderer.render(scene,camera);
});
