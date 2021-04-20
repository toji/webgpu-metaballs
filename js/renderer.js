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

    this.range = -1;
    this.intensity = 1;
  }

  get range() {
    return this.rangeArray[0];
  }

  set range(value) {
    this.rangeArray[0] = value;
  }

  get intensity() {
    return this.intensityArray[0];
  }

  set intensity(value) {
    this.intensityArray[0] = value;
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

    // Storage for global uniforms.
    // These can either be used individually or as a uniform buffer.
    this.frameUniforms = new Float32Array(16 + 16 + 16 + 4 + 4);

    this.projectionMatrix = new Float32Array(this.frameUniforms.buffer, 0, 16);
    this.inverseProjectionMatrix = new Float32Array(this.frameUniforms.buffer, 16 * 4, 16);
    this.outputSize = new Float32Array(this.frameUniforms.buffer, 32 * 4, 2);
    this.zRange = new Float32Array(this.frameUniforms.buffer, 34 * 4, 2);

    this.zRange[0] = 0.2; // Near
    this.zRange[1] = 100.0; // Far

    this.viewMatrix = new Float32Array(this.frameUniforms.buffer, 36 * 4, 16);
    this.cameraPosition = new Float32Array(this.frameUniforms.buffer, 52 * 4, 3);

    // Allocate all the scene's lights
    this.lightManager = new LightManager(1024);

    // Ambient color
    //vec3.set(this.lightManager.ambientColor, 0.02, 0.02, 0.02);

    let lastTimestamp = -1;
    this.frameCallback = (timestamp) => {
      const timeDelta = lastTimestamp == -1 ? 0 : timestamp - lastTimestamp;
      lastTimestamp = timestamp;
      this.rafId = requestAnimationFrame(this.frameCallback);
      this.frameCount++;
      if (this.frameCount % 200 == 0) { return; }

      if (this.stats) {
        this.stats.begin();
      }

      this.beforeFrame(timestamp, timeDelta);

      this.onFrame(timestamp, timeDelta);

      if (this.stats) {
        this.stats.end();
      }
    };

    this.resizeCallback = () => {
      this.canvas.width = this.canvas.clientWidth * devicePixelRatio;
      this.canvas.height = this.canvas.clientHeight * devicePixelRatio;

      this.outputSize[0] = this.canvas.width;
      this.outputSize[1] = this.canvas.height;

      const aspect = this.canvas.width / this.canvas.height;
      // Using mat4.perspectiveZO instead of mat4.perpective because WebGPU's
      // normalized device coordinates Z range is [0, 1], instead of WebGL's [-1, 1]
      mat4.perspectiveZO(this.projectionMatrix, Math.PI * 0.5, aspect, this.zRange[0], this.zRange[1]);
      mat4.invert(this.inverseProjectionMatrix, this.projectionMatrix);

      this.onResize(this.canvas.width, this.canvas.height);
    };
  }

  async init() {
    // Override with renderer-specific initialization logic.
  }

  setStats(stats) {
    this.stats = stats;
  }

  setGltf(gltf) {
    // Override with renderer-specific mesh loading logic, but be sure to call
    // super.setGltf so that the light logic can be processed.

    for (let i = 0; i < gltf.lights.length; ++i) {
      const gltfLight = gltf.lights[i];
      if (gltfLight.type == "point") {
        const light = this.lightManager.lights[i];
        light.static = true;
        light.range = 4.5; //gltfLight.range;
        light.intensity = gltfLight.intensity;
        vec3.copy(light.color, gltfLight.color);
        vec3.copy(light.position, gltfLight.position);
      }
    }

    // Initialize positions and colors for all the lights
    /*for (let i = 0; i < this.lightManager.maxLightCount; ++i) {
      let light = this.lightManager.lights[i];
      light.static = false;

      // Sponza scene approximate bounds:
      // X [-11, 10]
      // Y [0.2, 6.5]
      // Z [-4.5, 4.0]
      light.position[0] = randomBetween(-11, 10);
      light.position[1] = randomBetween(0.2, 6.5);
      light.position[2] = randomBetween(-4.5, 4.0);

      light.range = 2;

      vec3.set(light.color,
        randomBetween(0.1, 1),
        randomBetween(0.1, 1),
        randomBetween(0.1, 1)
      );
    }*/

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

  updateWanderingLights(timeDelta) {
    for (let i = 0; i < this.lightManager.lightCount; ++i) {
      let light = this.lightManager.lights[i];
      if (light.static) { continue; }

      light.travelTime -= timeDelta;

      if (light.travelTime <= 0) {
        light.travelTime = randomBetween(500, 2000);
        light.destination[0] = randomBetween(-11, 10);
        light.destination[1] = randomBetween(0.2, 6.5);
        light.destination[2] = randomBetween(-4.5, 4.0);
      }

      light.velocity[0] += (light.destination[0] - light.position[0]) * 0.000005 * timeDelta;
      light.velocity[1] += (light.destination[1] - light.position[1]) * 0.000005 * timeDelta;
      light.velocity[2] += (light.destination[2] - light.position[2]) * 0.000005 * timeDelta;

      // Clamp the velocity
      if (vec3.length(light.velocity) > 0.05) {
        vec3.scale(light.velocity, vec3.normalize(light.velocity, light.velocity), 0.05);
      }

      vec3.add(light.position, light.position, light.velocity);
    }
  }

  // Handles frame logic that's common to all renderers.
  beforeFrame(timestamp, timeDelta) {
    // Copy values from the camera into our frame uniform buffers
    mat4.copy(this.viewMatrix, this.camera.viewMatrix);
    vec3.copy(this.cameraPosition, this.camera.position);

    this.updateWanderingLights(timeDelta);
  }

  onResize(width, height) {
    // Override with renderer-specific resize logic.
  }

  onFrame(timestamp) {
    // Override with renderer-specific frame logic.
  }


}