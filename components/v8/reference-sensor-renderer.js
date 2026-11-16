// Retained from supplied EmbodiX website delivery: cases/warehouse/sensor-renderer.js. Synthetic visualization only.
import * as THREE from 'three';

const SENSOR_MODES = new Set(['rgb', 'thermal', 'depth', 'pointcloud']);
const NEAR_RANGE = 0.3;
const FAR_RANGE = 15;
const THERMAL_MIN = 10;
const THERMAL_MAX = 90;

const SCREEN_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const DISTANCE_FUNCTION = `
vec3 positionFromDepth(vec2 sampleUv, float depth) {
  vec4 view = uInverseProjection * vec4(sampleUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return view.xyz / view.w;
}
vec3 depthColor(float t) {
  t = clamp(t, 0.0, 1.0);
  if (t < 0.25) return mix(vec3(0.98,0.72,0.29), vec3(0.35,0.78,0.64), t / 0.25);
  if (t < 0.6) return mix(vec3(0.35,0.78,0.64), vec3(0.19,0.55,0.70), (t - 0.25) / 0.35);
  return mix(vec3(0.19,0.55,0.70), vec3(0.14,0.24,0.44), (t - 0.6) / 0.4);
}`;

const SCREEN_FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uRgb;
uniform sampler2D uDepth;
uniform sampler2D uAuxiliary;
uniform mat4 uInverseProjection;
uniform float uRangeNear;
uniform float uRangeFar;
uniform float uExposure;
uniform int uMode;
uniform bool uComparison;
${DISTANCE_FUNCTION}
vec3 rgbToneMap(vec3 color) {
  // Same ACES fit and exposure as Three.js r169's visible-light canvas.
  const mat3 inputMat = mat3(vec3(0.59719,0.07600,0.02840),vec3(0.35458,0.90834,0.13383),vec3(0.04823,0.01566,0.83777));
  const mat3 outputMat = mat3(vec3(1.60475,-0.10208,-0.00327),vec3(-0.53108,1.10813,-0.07276),vec3(-0.07367,-0.00605,1.07602));
  color = inputMat * (color * uExposure / 0.6);
  vec3 a = color * (color + 0.0245786) - 0.000090537;
  vec3 b = color * (0.983729 * color + 0.4329510) + 0.238081;
  color = clamp(outputMat * (a / b), 0.0, 1.0);
  return mix(12.92 * color, 1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308),color));
}
void main() {
  vec2 sampleUv = vUv;
  if (uComparison && uMode != 0) sampleUv.x = vUv.x < 0.5 ? vUv.x * 2.0 : (vUv.x - 0.5) * 2.0;
  vec3 color;
  if (uMode == 0 || (uComparison && vUv.x < 0.5)) {
    color = rgbToneMap(texture2D(uRgb,sampleUv).rgb);
  } else if (uMode == 2) {
    float depth = texture2D(uDepth,sampleUv).r;
    if (depth >= 0.999999 || depth <= 0.0) color = vec3(0.025,0.055,0.085);
    else {
      float metres = length(positionFromDepth(sampleUv,depth));
      color = depthColor((metres-uRangeNear)/(uRangeFar-uRangeNear));
    }
  } else color = texture2D(uAuxiliary,sampleUv).rgb;
  // All branches now contain display-referred sRGB; avoid a second transfer.
  gl_FragColor = vec4(color,1.0);
}`;

const THERMAL_VERTEX = `
varying vec3 vViewNormal;
void main() {
  vViewNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
}`;

const THERMAL_FRAGMENT = `
precision highp float;
varying vec3 vViewNormal;
uniform float uTemperature;
vec3 iron(float t) {
  t = clamp(t,0.0,1.0);
  if (t < 0.15) return mix(vec3(0.06,0.06,0.16),vec3(0.23,0.19,0.48),t/0.15);
  if (t < 0.30) return mix(vec3(0.23,0.19,0.48),vec3(0.47,0.21,0.51),(t-0.15)/0.15);
  if (t < 0.45) return mix(vec3(0.47,0.21,0.51),vec3(0.68,0.29,0.48),(t-0.30)/0.15);
  if (t < 0.60) return mix(vec3(0.68,0.29,0.48),vec3(0.87,0.39,0.30),(t-0.45)/0.15);
  if (t < 0.75) return mix(vec3(0.87,0.39,0.30),vec3(1.0,0.62,0.28),(t-0.60)/0.15);
  if (t < 0.90) return mix(vec3(1.0,0.62,0.28),vec3(1.0,0.85,0.45),(t-0.75)/0.15);
  return mix(vec3(1.0,0.85,0.45),vec3(1.0,0.96,0.75),(t-0.90)/0.10);
}
void main() {
  // A small deterministic face offset makes surfaces readable. The source is
  // object temperature metadata, never RGB luminance or a recoloured RGB frame.
  float faceOffset = dot(normalize(vViewNormal),normalize(vec3(-0.3,0.7,0.6))) * 0.55;
  float t = (uTemperature + faceOffset - 10.0) / 80.0;
  gl_FragColor = vec4(iron(t),1.0);
}`;

const POINT_VERTEX = `
precision highp float;
attribute vec2 sampleUv;
uniform sampler2D uDepth;
uniform mat4 uInverseProjection;
uniform mat4 uProjection;
uniform float uRangeNear;
uniform float uRangeFar;
uniform float uPointSize;
varying float vDistance;
varying float vValid;
void main() {
  float depth = texture2D(uDepth,sampleUv).r;
  vec4 view = uInverseProjection * vec4(sampleUv*2.0-1.0,depth*2.0-1.0,1.0);
  view /= view.w;
  vDistance = length(view.xyz);
  vValid = (depth > 0.0 && depth < 0.999999 && vDistance >= uRangeNear && vDistance <= uRangeFar) ? 1.0 : 0.0;
  gl_Position = vValid > 0.5 ? uProjection * vec4(view.xyz,1.0) : vec4(2.0,2.0,2.0,1.0);
  gl_PointSize = uPointSize * vValid;
}`;

const POINT_FRAGMENT = `
precision highp float;
uniform float uRangeNear;
uniform float uRangeFar;
varying float vDistance;
varying float vValid;
void main() {
  if (vValid < 0.5 || length(gl_PointCoord-vec2(0.5)) > 0.5) discard;
  float t = clamp((vDistance-uRangeNear)/(uRangeFar-uRangeNear),0.0,1.0);
  vec3 color = mix(vec3(0.68,0.96,1.0),vec3(0.16,0.34,0.61),sqrt(t));
  gl_FragColor = vec4(color,1.0);
}`;

export class SensorRenderer {
  constructor(renderer, { getTemperature } = {}) {
    this.renderer = renderer;
    this.getTemperature = typeof getTemperature === 'function' ? getTemperature : () => 20;
    this.thermalMaterials = new Map();
    this.width = 1;
    this.height = 1;
    this.pointCount = 0;
    this.cssWidth = 1;
    this.cssHeight = 1;
    this.pixelRatio = 1;
    this.comparisonLayout = false;
    const hdr = renderer.extensions.has('EXT_color_buffer_float');
    this.rgbTarget = new THREE.WebGLRenderTarget(1,1,{
      type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, stencilBuffer: false,
    });
    this.rgbTarget.texture.name = 'Embodex: visible-light linear capture';
    this.rgbTarget.depthTexture = new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
    this.rgbTarget.depthTexture.format = THREE.DepthFormat;
    this.rgbTarget.depthTexture.minFilter = THREE.NearestFilter;
    this.rgbTarget.depthTexture.magFilter = THREE.NearestFilter;
    this.auxiliaryTarget = new THREE.WebGLRenderTarget(1,1,{
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, stencilBuffer: false,
    });
    this.auxiliaryTarget.texture.name = 'Embodex: synthetic sensor display';
    this.screenMaterial = new THREE.ShaderMaterial({
      vertexShader: SCREEN_VERTEX, fragmentShader: SCREEN_FRAGMENT,
      depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: {
        uRgb: { value: this.rgbTarget.texture },
        uDepth: { value: this.rgbTarget.depthTexture },
        uAuxiliary: { value: this.auxiliaryTarget.texture },
        uInverseProjection: { value: new THREE.Matrix4() },
        uRangeNear: { value: NEAR_RANGE }, uRangeFar: { value: FAR_RANGE },
        uExposure: { value: 1.2 }, uMode: { value: 0 }, uComparison: { value: false },
      },
    });
    this.screenScene = new THREE.Scene();
    this.screenCamera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    this.screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.screenMaterial);
    this.screenMesh.frustumCulled = false;
    this.screenScene.add(this.screenMesh);
    this.pointMaterial = new THREE.ShaderMaterial({
      vertexShader: POINT_VERTEX, fragmentShader: POINT_FRAGMENT,
      depthTest: true, depthWrite: true, toneMapped: false,
      uniforms: {
        uDepth: { value: this.rgbTarget.depthTexture },
        uInverseProjection: { value: new THREE.Matrix4() },
        uProjection: { value: new THREE.Matrix4() },
        uRangeNear: { value: NEAR_RANGE }, uRangeFar: { value: FAR_RANGE },
        uPointSize: { value: 2.1 },
      },
    });
    this.pointScene = new THREE.Scene();
    this.pointScene.background = new THREE.Color(0x030b12);
    this.points = new THREE.Points(new THREE.BufferGeometry(),this.pointMaterial);
    this.points.frustumCulled = false;
    this.pointScene.add(this.points);
  }

  resize(cssWidth, cssHeight, pixelRatio = 1) {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.pixelRatio = pixelRatio;
    // Sensor targets have a bounded resolution so the concept remains usable on
    // integrated GPUs. RGB, depth, thermal and cloud use exactly this same grid.
    const scale = Math.min(Math.max(pixelRatio,1),1.5,1280/Math.max(cssWidth,1),800/Math.max(cssHeight,1));
    const width = Math.max(1,Math.round(cssWidth*scale*(this.comparisonLayout?0.5:1)));
    const height = Math.max(1,Math.round(cssHeight*scale));
    if (width===this.width && height===this.height) return;
    this.width=width; this.height=height;
    this.rgbTarget.setSize(width,height);
    this.auxiliaryTarget.setSize(width,height);
    const columns = Math.max(2,Math.min(240,Math.floor(width/5)));
    const rows = Math.max(2,Math.round(columns*height/width));
    const positions = new Float32Array(columns*rows*3);
    const samples = new Float32Array(columns*rows*2);
    for(let y=0;y<rows;y++) for(let x=0;x<columns;x++) {
      const index=y*columns+x;
      samples[index*2]=(x+0.5)/columns;
      samples[index*2+1]=(y+0.5)/rows;
    }
    this.points.geometry.dispose();
    this.points.geometry=new THREE.BufferGeometry();
    this.points.geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    this.points.geometry.setAttribute('sampleUv',new THREE.BufferAttribute(samples,2));
    this.pointCount=columns*rows;
    this.pointMaterial.uniforms.uPointSize.value=Math.max(1.65,Math.min(width/columns*0.53,3.0));
  }

  temperatureMaterial(temperature, side) {
    const value=Math.round(Math.max(-20,Math.min(200,Number(temperature)||20))*10)/10;
    const key=`${value}:${side}`;
    if(!this.thermalMaterials.has(key)) this.thermalMaterials.set(key,new THREE.ShaderMaterial({
      vertexShader:THERMAL_VERTEX,fragmentShader:THERMAL_FRAGMENT,
      uniforms:{uTemperature:{value}},side,depthTest:true,depthWrite:true,toneMapped:false,
    }));
    return this.thermalMaterials.get(key);
  }

  renderThermal(scene,camera) {
    const originals=[];
    const background=scene.background, override=scene.overrideMaterial;
    const shadowAutoUpdate=this.renderer.shadowMap.autoUpdate;
    try {
      scene.background=new THREE.Color(0x080411);
      scene.overrideMaterial=null;
      this.renderer.shadowMap.autoUpdate=false;
      scene.traverse(object=>{
        if(!object.isMesh || !object.material) return;
        const original=object.material;
        originals.push([object,original]);
        const temperature=this.getTemperature(object);
        object.material=Array.isArray(original)
          ? original.map(material=>this.temperatureMaterial(temperature,material.side))
          : this.temperatureMaterial(temperature,original.side);
      });
      this.renderer.setRenderTarget(this.auxiliaryTarget);
      this.renderer.render(scene,camera);
    } finally {
      originals.forEach(([object,material])=>{object.material=material;});
      scene.background=background;
      scene.overrideMaterial=override;
      this.renderer.shadowMap.autoUpdate=shadowAutoUpdate;
    }
  }

  render(scene,camera,{mode='rgb',comparison=false}={}) {
    if(!SENSOR_MODES.has(mode)) mode='rgb';
    const split = Boolean(comparison) && mode !== 'rgb';
    if(this.comparisonLayout !== split) {
      this.comparisonLayout = split;
      this.resize(this.cssWidth,this.cssHeight,this.pixelRatio);
    }
    const renderer=this.renderer;
    const target=renderer.getRenderTarget();
    const autoClear=renderer.autoClear;
    const scissorTest=renderer.getScissorTest();
    const xrEnabled=renderer.xr.enabled;
    const originalAspect=camera.aspect;
    const hidden=[],shown=[];
    try {
      if(split && camera.isPerspectiveCamera) {
        camera.aspect=originalAspect*0.5;
        camera.updateProjectionMatrix();
      }
      // Annotations are a UI aid, not optical / thermal / range returns. Apply
      // the exact same mask before all four captures, including visible light.
      scene.traverse(object=>{
        if(!object.visible && object.userData.sensorOnly) { shown.push(object);object.visible=true; }
        if(object.visible && (object.isSprite || object.isLine || object.userData.sensorOverlay)) {
          hidden.push(object);object.visible=false;
        }
      });
      renderer.autoClear=true;
      renderer.xr.enabled=false;
      renderer.setScissorTest(false);
      this.screenMaterial.uniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse);
      this.pointMaterial.uniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse);
      this.pointMaterial.uniforms.uProjection.value.copy(camera.projectionMatrix);
      this.screenMaterial.uniforms.uExposure.value=renderer.toneMappingExposure;
      renderer.setRenderTarget(this.rgbTarget);
      renderer.render(scene,camera);
      if(mode==='thermal') this.renderThermal(scene,camera);
      else if(mode==='pointcloud') {
        renderer.setRenderTarget(this.auxiliaryTarget);
        renderer.render(this.pointScene,this.screenCamera);
      }
      this.screenMaterial.uniforms.uMode.value={rgb:0,thermal:1,depth:2,pointcloud:3}[mode];
      this.screenMaterial.uniforms.uComparison.value=split;
      renderer.setRenderTarget(target);
      renderer.render(this.screenScene,this.screenCamera);
    } finally {
      hidden.forEach(object=>{object.visible=true;});
      shown.forEach(object=>{object.visible=false;});
      if(split && camera.isPerspectiveCamera) {
        camera.aspect=originalAspect;
        camera.updateProjectionMatrix();
      }
      renderer.setRenderTarget(target);
      renderer.autoClear=autoClear;
      renderer.setScissorTest(scissorTest);
      renderer.xr.enabled=xrEnabled;
    }
  }

  getLegend(mode,camera) {
    const shared={
      nearClip:camera.near,farClip:camera.far,
      resolution:`${this.width} × ${this.height}`,
      sameCamera:true,synthetic:true,
    };
    if(mode==='thermal') return {
      ...shared,title:'合成热像',unit:'°C',min:THERMAL_MIN,max:THERMAL_MAX,
      colors:['#0f0f29','#783682','#de644d','#ff9e47','#fff5bf'],
      description:'对象温度驱动的伪彩显示；非 RGB 滤镜，非物理热传导或真实热像仪仿真。',
      examples:[{label:'地面',value:18.5},{label:'货架',value:21},{label:'人员',value:32},{label:'电机外壳',value:68.4}],
    };
    if(mode==='depth') return {
      ...shared,title:'可见表面深度',unit:'m',min:NEAR_RANGE,max:FAR_RANGE,
      colors:['#fab849','#59c7a3','#318cb3','#243d70'],
      description:'由同帧深度缓冲反投影，显示相机至首个可见表面的线性欧氏距离；近暖远冷，15 m 以外颜色饱和，背景无返回。',
      metric:'linear Euclidean camera distance',
    };
    if(mode==='pointcloud') return {
      ...shared,title:'首个可见表面点云',unit:'m',min:NEAR_RANGE,max:FAR_RANGE,
      colors:['#adf5ff','#71b6db','#29579c'],samples:this.pointCount,
      description:'从同帧深度采样并反投影为点；只保留 0.3–15 m 的首个可见表面，丢弃背景，无隔墙点和隐藏背面。',
      metric:'depth-derived visible surface samples',
    };
    return {...shared,title:'相机 RGB',unit:'',colors:[],description:'同一虚拟相机与场景的相机画面；所有传感器模式保持相同机位、姿态和时刻。'};
  }

  dispose() {
    this.rgbTarget.dispose();
    this.auxiliaryTarget.dispose();
    this.screenMesh.geometry.dispose();
    this.screenMaterial.dispose();
    this.points.geometry.dispose();
    this.pointMaterial.dispose();
    this.thermalMaterials.forEach(material=>material.dispose());
    this.thermalMaterials.clear();
  }
}

export default SensorRenderer;

