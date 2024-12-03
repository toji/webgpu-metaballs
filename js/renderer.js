// Copyright 2020 Brandon Jones
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import { vec3, mat4 } from 'gl-matrix';
import { Metaballs } from './metaballs.js';
import { MarchingCubes } from './marching-cubes.js'

const lightFloatCount = 8;
const lightByteSize = lightFloatCount * 4;

class Light {
  static floatSize = 8;
  static byteSize = Light.floatSize * 4;

  constructor(buffer, byteOffset) {
    this.position = new Float32Array(buffer, byteOffset, 4);
    this.rangeArray = new Float32Array(buffer, byteOffset + 12, 1);
    this.color = new Float32Array(buffer, byteOffset + 16, 3);
    this.intensityArray = new Float32Array(buffer, byteOffset + 28, 1);
    this.velocity = new Float32Array(3);
    this.destination = new Float32Array(3);
    this.travelTime = 0;
    this.static = true;
    this.renderEnvironment = true;

    this._range = -1;
    this._intensity = 1;
    this._enabled = true;
  }

  get range() {
    return this._range;
  }

  set range(value) {
    this._range = value;
    this.rangeArray[0] = this._range >= 0 ? this._range : this.computedRange;
  }

  get intensity() {
    return this._intensity;
  }

  set intensity(value) {
    this._intensity = value;
    this.intensityArray[0] = this._enabled ? this._intensity : 0;
    this.rangeArray[0] = this._range >= 0 ? this._range : this.computedRange;
  }

  get computedRange() {
    const lightRadius = 0.05;
    const illuminationThreshold = 0.001;
    return lightRadius * (Math.sqrt(this.intensityArray[0]/illuminationThreshold) - 1);
  }

  set enabled(value) {
    this._enabled = !!value;
    this.intensityArray[0] = this._enabled ? this._intensity : 0;
  }

  get enabled() {
    return this._enabled;
  }
}

class LightManager extends EventTarget {
  constructor(lightCount) {
    super();

    this.maxLightCount = lightCount;

    this.uniformArray = new Float32Array(4 + Light.floatSize * lightCount);

    this.ambientColor = new Float32Array(this.uniformArray.buffer, 0, 3);
    this.lightCountArray = new Uint32Array(this.uniformArray.buffer, 12, 1);
    this.lightCountArray[0] = lightCount;

    this.lights = new Array(lightCount);
    for (let i = 0; i < lightCount; ++i) {
      this.lights[i] = new Light(this.uniformArray.buffer, 16 + lightByteSize * i);
    }
  }

  get lightCount() {
    return this.lightCountArray[0];
  }

  set lightCount(value) {
    this.lightCountArray[0] = Math.min(value, this.maxLightCount);
  }
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

export class Renderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.camera = null;
    this.rafId = 0;
    this.frameCount = -1;

    this.lightPattern = 'wandering';

    // Allocate all the scene's lights
    this.lightManager = new LightManager(1024);
    this.sceneLightCount = 0;

    // Ambient color
    //vec3.set(this.lightManager.ambientColor, 0.02, 0.02, 0.02);

    this.metaballs = new Metaballs();
    this.drawMetaballs = true;
    this.marchingCubes = null;

    this.xrSession = null;

    let lastTimestamp = -1;
    this.frameCallback = (timestamp) => {
      if (this.xrSession) { return; }
      const timeDelta = lastTimestamp == -1 ? 0 : timestamp - lastTimestamp;
      lastTimestamp = timestamp;
      this.rafId = requestAnimationFrame(this.frameCallback);
      this.frameCount++;
      if (this.frameCount % 200 == 0) { return; }

      if (this.stats) {
        this.stats.beginFrame();
      }

      this.beforeFrame(timestamp, timeDelta);

      this.onFrame(timestamp, timeDelta);

      if (this.stats) {
        this.stats.endFrame();
      }
    };

    this.xrFrameCallback = (timestamp, xrFrame) => {
      const timeDelta = lastTimestamp == -1 ? 0 : timestamp - lastTimestamp;
      lastTimestamp = timestamp;
      this.rafId = this.xrSession.requestAnimationFrame(this.xrFrameCallback);
      this.frameCount++;
      if (this.frameCount % 200 == 0) { return; }

      if (this.stats) {
        this.stats.beginFrame();
      }

      this.beforeFrame(timestamp, timeDelta);

      this.onXRFrame(timestamp, timeDelta, xrFrame);

      if (this.stats) {
        this.stats.endFrame();
      }
    };

    this.resizeCallback = () => {
      // Just to make life a little easier on some lower-end devices.
      const scalar = Math.min(devicePixelRatio, 1.5);

      this.canvas.width = this.canvas.clientWidth * scalar;
      this.canvas.height = this.canvas.clientHeight * scalar;

      if (this.canvas.width == 0 || this.canvas.height == 0) {
        return;
      }

      this.onResize(this.canvas.width, this.canvas.height);
    };
  }

  async init() {
    // Override with renderer-specific initialization logic.
  }

  setStats(stats) {
    this.stats = stats;
  }

  setScene(gltf) {
    // Override with renderer-specific mesh loading logic, but be sure to call
    // super.setScene so that the light logic can be processed.

    for (let i = 0; i < gltf.lights.length; ++i) {
      const gltfLight = gltf.lights[i];
      if (gltfLight.type == "point") {
        const light = this.lightManager.lights[i];
        light.static = true;
        light.range = gltfLight.range;
        light.intensity = gltfLight.intensity;
        vec3.copy(light.color, gltfLight.color);
        vec3.copy(light.position, gltfLight.position);
      }
    }

    this.sceneLightCount = gltf.lights.length;
    this.lightManager.lightCount = gltf.lights.length;
  }

  setViewMatrix(viewMatrix) {
    mat4.copy(this.viewMatrix, viewMatrix);
  }

  setOutputType(output) {
    this.outputType = output;
  }

  onLightPatternChange(pattern) {
    this.lightPattern = pattern;
  }

  updateLightRange(lightRange) {
    for (let i = 0; i < this.lightManager.lightCount; ++i) {
      const light = this.lightManager.lights[i];
      if (light.static) continue;

      light.range = lightRange;
    }
  }

  start() {
    window.addEventListener('resize', this.resizeCallback);
    this.resizeCallback();
    this.rafId = requestAnimationFrame(this.frameCallback);
  }

  stop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    window.removeEventListener('resize', this.resizeCallback);
  }

  setMetaballMethod(method) {
    // Override
  }

  setMetaballStyle(style) {
    this.drawMetaballs = true;
    switch(style) {
      case 'lava':
        this.metaballLightColor = [0.9, 0.1, 0.0];
        this.metaballTexturePath = './media/textures/lava.jpg';
        break;
      case 'slime':
        this.metaballLightColor = [0.0, 0.9, 0.0];
        this.metaballTexturePath = './media/textures/slime.png';
        break;
      case 'water':
        this.metaballLightColor = [0.4, 0.5, 0.9];
        this.metaballTexturePath = './media/textures/water.jpg';
        break;
      case 'none':
        this.drawMetaballs = false;
        this.lightManager.lightCount = this.sceneLightCount;
        break;
    }
  }

  setMetaballStep(step) {
    this.marchingCubes = new MarchingCubes({
      xMin: -1,
      xMax: 1,
      xStep: step,
      yMin: -0.1,
      yMax: 2.5,
      yStep: step,
      zMin: -1,
      zMax: 1,
      zStep: step,
    });
  }

  updateMetaballs(timestamp) {
    this.metaballs.updateBalls(timestamp);

    // Attach a light to each ball
    let lightIndex = this.sceneLightCount;
    for (const ball of this.metaballs.balls) {
      let light = this.lightManager.lights[lightIndex];
      light.static = true;

      vec3.copy(light.color, this.metaballLightColor);
      light.intensity = 4;
      vec3.copy(light.position, ball.position);

      lightIndex++;
    }

    this.lightManager.lightCount = lightIndex;
  }

  enableLights(enableSceneLights, enabledMetaballLights) {
    let i = 0;
    for (; i < this.sceneLightCount; ++i) {
      this.lightManager.lights[i].enabled = enableSceneLights;
    }

    for (; i < this.lightManager.lightCount; ++i) {
      this.lightManager.lights[i].enabled = enabledMetaballLights;
    }
  }

  // Handles frame logic that's common to all renderers.
  beforeFrame(timestamp, timeDelta) {
    //this.timeArray[0] = timestamp;

    if (this.drawMetaballs) {
      this.updateMetaballs(timestamp);
    }
  }

  onResize(width, height) {
    // Override with renderer-specific resize logic.
  }

  onFrame(timestamp, timeDelta) {
    // Override with renderer-specific frame logic.
  }

  onXRFrame(timestamp, timeDelta, xrFrame) {
    // Override with renderer-specific frame logic.
  }

  async setWebXRSession(session) {
    this.xrSession = session;
    if (!this.xrSession) {
      this.onXREnded();
      requestAnimationFrame(this.frameCallback);
      return;
    }

    await this.onXRStarted();
    this.xrSession.requestAnimationFrame(this.xrFrameCallback);
  }

  async onXRStarted() {}
  onXREnded() {}
}