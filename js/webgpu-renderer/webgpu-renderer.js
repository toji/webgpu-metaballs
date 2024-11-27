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

import { Renderer } from '../renderer.js';
import { ProjectionUniformsSize, ViewUniformsSize, BIND_GROUP, ATTRIB_MAP } from './shaders/common.js';
import { WebGPUTextureLoader } from 'webgpu-texture-loader';
import { ClusteredLightManager } from './clustered-lights.js';
import { WebGPULightSprites } from './webgpu-light-sprites.js';
import { WebGPUglTF } from './webgpu-gltf.js';

//import { GPUStats } from './gpu-stats.js';

import {
  MetaballWriteBuffer,
  MetaballNewBuffer,
  MetaballNewStagingBuffer,
  MetaballSingleStagingBuffer,
  MetaballStagingBufferRing,
  MetaballComputeRenderer,
  MetaballComputePointRenderer,
} from './webgpu-metaball-renderer.js';
import { TimestampHelper } from './timestamp-helper.js';

const MetaballMethods = {
  writeBuffer: MetaballWriteBuffer,
  newBuffer: MetaballNewBuffer,
  newStaging: MetaballNewStagingBuffer,
  singleStaging: MetaballSingleStagingBuffer,
  stagingRing: MetaballStagingBufferRing,
  gpuGenerated: MetaballComputeRenderer,
  pointCloud: MetaballComputePointRenderer,
};

const SAMPLE_COUNT = 1;
const DEPTH_FORMAT = "depth24plus";

export class WebGPURenderer extends Renderer {
  constructor() {
    super();

    this.sampleCount = SAMPLE_COUNT;
    this.contextFormat = navigator.gpu.getPreferredCanvasFormat();
    this.depthFormat = DEPTH_FORMAT;

    this.context = this.canvas.getContext('webgpu');

    //this.gpuStats = new GPUStats();
    this.metaballMethod = null;

    this.xrBinding = null;
    this.xrLayer = null;
    this.xrRefSpace = null;
  }

  async init() {
    this.adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
      xrCompatible: true,
    });

    // Enable compressed textures if available
    const requiredFeatures = [];
    if (this.adapter.features.has('texture-compression-bc')) {
      requiredFeatures.push('texture-compression-bc');
    }

    if (this.adapter.features.has('texture-compression-etc2')) {
      requiredFeatures.push('texture-compression-etc2');
    }

    if (this.adapter.features.has('texture-compression-astc')) {
      requiredFeatures.push('texture-compression-astc');
    }

    // Enable timestamp queries if available
    if (this.adapter.features.has('timestamp-query') != -1) {
      requiredFeatures.push('timestamp-query');
    }

    this.device = await this.adapter.requestDevice({requiredFeatures});

    this.context.configure({
      device: this.device,
      format: this.contextFormat,
      alphaMode: 'opaque',
    });

    this.renderBundleDescriptor = {
      colorFormats: [ this.contextFormat ],
      depthStencilFormat: DEPTH_FORMAT,
      sampleCount: SAMPLE_COUNT
    };

    this.textureLoader = new WebGPUTextureLoader(this.device);

    this.colorAttachment = {
      // view is acquired and set in onResize.
      view: undefined,
      // attachment is acquired and set in onFrame.
      resolveTarget: undefined,
      loadOp: 'clear',
      storeOp: SAMPLE_COUNT > 1 ? 'discard' : 'store', // Discards the multisampled view, not the resolveTarget
    };

    this.depthAttachment = {
      // view is acquired and set in onResize.
      view: undefined,
      depthLoadOp: 'clear',
      depthClearValue: 1.0,
      depthStoreOp: 'discard',
    };

    this.renderPassDescriptor = {
      colorAttachments: [this.colorAttachment],
      depthStencilAttachment: this.depthAttachment,
    };

    this.bindGroupLayouts = {
      frame: this.device.createBindGroupLayout({
        label: `frame-bgl`,
        entries: [{
          binding: 0, // Projection uniforms
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: {},
        }, {
          binding: 1, // View uniforms
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
          buffer: {}
        }, {
          binding: 2, // Light uniforms
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' }
        }, {
          binding: 3, // Cluster Lights storage
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' }
        }]
      }),

      material: this.device.createBindGroupLayout({
        label: `material-bgl`,
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: {}
        },
        {
          binding: 1, // defaultSampler
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {}
        },
        {
          binding: 2, // baseColorTexture
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        },
        {
          binding: 3, // normalTexture
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        },
        {
          binding: 4, // metallicRoughnessTexture
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        },
        {
          binding: 5, // occlusionTexture
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        },
        {
          binding: 6, // emissiveTexture
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        }]
      }),

      primitive: this.device.createBindGroupLayout({
        label: `primitive-bgl`,
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: {}
        }]
      }),

      metaball: this.device.createBindGroupLayout({
        label: `lava-bgl`,
        entries: [{
          binding: 0, // sampler
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {}
        },
        {
          binding: 1, // texture
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        }]
      })
    };

    this.bindGroupLayouts.frame.label = "frame-bgl-SUPER ULTRA COOL EDITION";

    this.pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [
        this.bindGroupLayouts.frame, // set 0
        this.bindGroupLayouts.material, // set 1
        this.bindGroupLayouts.primitive, // set 2
      ]
    });

    this.projectionBuffer = this.device.createBuffer({
      size: ProjectionUniformsSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });

    this.viewBuffer = this.device.createBuffer({
      size: ViewUniformsSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });

    this.lightsBuffer = this.device.createBuffer({
      size: this.lightManager.uniformArray.byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    });

    this.clusteredLights = new ClusteredLightManager(this);

    this.bindGroups = {
      frame: this.device.createBindGroup({
        layout: this.bindGroupLayouts.frame,
        entries: [{
          binding: 0,
          resource: {
            buffer: this.projectionBuffer,
          },
        }, {
          binding: 1,
          resource: {
            buffer: this.viewBuffer,
          },
        }, {
          binding: 2,
          resource: {
            buffer: this.lightsBuffer,
          },
        }, {
          binding: 3,
          resource: {
            buffer: this.clusteredLights.clusterLightsBuffer,
          }
        }],
      })
    }

    this.defaultSampler = this.device.createSampler({
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });

    this.lightSprites = new WebGPULightSprites(this);

    this.metaballRenderer = null;
    this.metaballsNeedUpdate = true;

    this.timestampHelper = new TimestampHelper(this.device);
  }

  onResize(width, height) {
    if (!this.device) return;

    // Canvas/context resize already handled in base class.

    if (SAMPLE_COUNT > 1) {
      const msaaColorTexture = this.device.createTexture({
        size: { width, height },
        sampleCount: SAMPLE_COUNT,
        format: this.contextFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.colorAttachment.view = msaaColorTexture.createView();
    }

    const depthTexture = this.device.createTexture({
      size: { width, height },
      sampleCount: SAMPLE_COUNT,
      format: DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    this.depthAttachment.view = depthTexture.createView();

    // Update the Projection uniforms. These only need to be updated on resize.
    this.device.queue.writeBuffer(this.projectionBuffer, 0, this.frameUniforms.buffer, 0, ProjectionUniformsSize);

    // On every size change we need to re-compute the cluster grid.
    this.clusteredLights.updateClusterBounds();
  }

  async setScene(gltf) {
    super.setScene(gltf);
    this.scene = new WebGPUglTF(this, gltf);
    this.updateMetaballs(0);
  }

  setMetaballMethod(method) {
    const rendererConstructor = MetaballMethods[method];
    if (!rendererConstructor) {
      this.metaballRenderer = null;
      return;
    }

    this.metaballRenderer = new rendererConstructor(this, this.marchingCubes.volume);
    this.metaballsNeedUpdate = true;
    this.metaballMethod = method;
  }

  async setMetaballStyle(style) {
    super.setMetaballStyle(style);

    const metaballTexture = await this.textureLoader.fromUrl(this.metaballTexturePath, {colorSpace: 'sRGB'});

    this.bindGroups.metaball = this.device.createBindGroup({
      layout: this.bindGroupLayouts.metaball,
      entries: [{
        binding: 0,
        resource: this.defaultSampler,
      }, {
        binding: 1,
        resource: metaballTexture.texture.createView(),
      }],
    });
  }

  setMetaballStep(step) {
    super.setMetaballStep(step);
    this.setMetaballMethod(this.metaballMethod);
  }

  async updateMetaballs(timestamp) {
    if (this.metaballsNeedUpdate && this.metaballRenderer) {
      this.metaballsNeedUpdate = false;

      super.updateMetaballs(timestamp);

      this.metaballRenderer.updateMetaballs(this.metaballs, this.marchingCubes);

      /*if (!this.scene) {
        return;
      }*/

      await this.metaballRenderer.update(this.marchingCubes, this.timestampHelper);

      this.metaballsNeedUpdate = true;
    }
  }

  onFrame(timestamp, timeDelta) {
    //this.gpuStats.begin();

    // TODO: If we want multisampling this should attach to the resolveTarget,
    // but there seems to be a bug with that right now?
    if (SAMPLE_COUNT > 1) {
      this.colorAttachment.resolveTarget = this.context.getCurrentTexture().createView();
    } else {
      this.colorAttachment.view = this.context.getCurrentTexture().createView();
    }

    // Update the View uniforms buffer with the values. These are used by most shader programs
    // and don't change for the duration of the frame.
    this.device.queue.writeBuffer(this.viewBuffer, 0, this.frameUniforms.buffer, ProjectionUniformsSize, ViewUniformsSize);

    // Update the light unform buffer with the latest values as well.
    this.device.queue.writeBuffer(this.lightsBuffer, 0, this.lightManager.uniformArray);

    const commandEncoder = this.device.createCommandEncoder({});
    this.clusteredLights.updateClusterLights(commandEncoder);

    this.renderPassDescriptor.timestampWrites = this.timestampHelper.timestampWrites('Rendering');

    const passEncoder = commandEncoder.beginRenderPass(this.renderPassDescriptor);

    if (this.scene && this.renderEnvironment) {
      this.scene.draw(passEncoder);
    }

    if (this.drawMetaballs && this.metaballRenderer && this.bindGroups.metaball) {
      // Draw metaballs.
      this.metaballRenderer.draw(passEncoder);
    }

    if (this.lightManager.render) {
      // Last, render a sprite for all of the lights. This is done using instancing so it's a single
      // call for every light.
      this.lightSprites.draw(passEncoder);
    }

    passEncoder.end();

    this.timestampHelper.resolve(commandEncoder);

    const commandBuffer = commandEncoder.finish();
    this.device.queue.submit([commandBuffer]);

    this.timestampHelper.read().then((results) => {
      for (let [key, result] of Object.entries(results)) {
        this.stats.addSample(key, result);
      }
    });

    //this.gpuStats.end();
  }

  async onXRStarted() {
    this.xrBinding = new XRGPUBinding(this.xrSession, this.device);

    // TODO: Use XR preferred color format
    this.xrLayer = this.xrBinding.createProjectionLayer({
      colorFormat: this.contextFormat,
      depthStencilFormat: this.depthFormat,
    });

    this.xrSession.updateRenderState({ layers: [this.xrLayer] });

    this.xrRefSpace = await this.xrSession.requestReferenceSpace('local');
  }

  onXRFrame(timestamp, timeDelta, xrFrame) {
    // Update the View uniforms buffer with the values. These are used by most shader programs
    // and don't change for the duration of the frame.
    //this.device.queue.writeBuffer(this.viewBuffer, 0, this.frameUniforms.buffer, ProjectionUniformsSize, ViewUniformsSize);

    // Update the light unform buffer with the latest values as well.
    this.device.queue.writeBuffer(this.lightsBuffer, 0, this.lightManager.uniformArray);

    const commandEncoder = this.device.createCommandEncoder({});
    this.clusteredLights.updateClusterLights(commandEncoder);

    let pose = xrFrame.getViewerPose(this.xrRefSpace);

    if (pose) {
      for (let viewIndex = 0; viewIndex < pose.views.length; ++viewIndex) {
        const view = pose.views[viewIndex];

        // THIS DOESN'T WORK FOR MULTIPLE VIEWS!
        mat4.copy(this.projectionMatrix, view.projectionMatrix);
        mat4.invert(this.inverseProjectionMatrix, this.projectionMatrix);
        mat4.copy(this.viewMatrix, view.transform.inverse.matrix);
        vec3.copy(this.cameraPosition, [view.transform.position.x, view.transform.position.y, view.transform.position.z]);
        this.device.queue.writeBuffer(this.viewBuffer, 0, this.frameUniforms.buffer, ProjectionUniformsSize, ViewUniformsSize);

        let subImage = this.xrBinding.getViewSubImage(this.xrLayer, view);

        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
              view: subImage.colorTexture.createView(subImage.getViewDescriptor()),
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: [0.1, 0.0, 0.4, 1.0],
            }],
            depthStencilAttachment: {
              view: subImage.depthStencilTexture.createView(subImage.getViewDescriptor()),
              depthLoadOp: 'clear',
              depthStoreOp: 'store',
              depthClearValue: 1.0,
            }
          });

        let vp = subImage.viewport;
        renderPass.setViewport(vp.x, vp.y, vp.width, vp.height, 0.0, 1.0);

        if (this.scene && this.renderEnvironment) {
          this.scene.draw(renderPass);
        }
    
        if (this.drawMetaballs && this.metaballRenderer && this.bindGroups.metaball) {
          // Draw metaballs.
          this.metaballRenderer.draw(renderPass);
        }
    
        if (this.lightManager.render) {
          // Last, render a sprite for all of the lights. This is done using instancing so it's a single
          // call for every light.
          this.lightSprites.draw(renderPass);
        }

        renderPass.end();
      }
    }

    const commandBuffer = commandEncoder.finish();
    this.device.queue.submit([commandBuffer]);
  }
}