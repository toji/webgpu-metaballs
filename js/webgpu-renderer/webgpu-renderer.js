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

import { Renderer } from '../renderer.js';
import { WebGPUTextureLoader } from 'webgpu-texture-loader';

import { WebGPULightSprites } from './webgpu-light-sprites.js';
import { WebGPUglTF } from './webgpu-gltf.js';
import { WebGPUView } from './webgpu-view.js';

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

const SAMPLE_COUNT = 4;
const DEPTH_FORMAT = "depth24plus";
const CLEAR_VALUE = [0.0, 0.0, 0.0, 0.0];

const MAX_VIEW_COUNT = 2;

export class WebGPURenderer extends Renderer {
  constructor() {
    super();

    this.sampleCount = SAMPLE_COUNT;
    this.contextFormat = navigator.gpu?.getPreferredCanvasFormat() ?? 'rgba8unorm';
    this.renderFormat = this.contextFormat; //`${this.contextFormat}-srgb`;
    this.depthFormat = DEPTH_FORMAT;

    this.context = this.canvas.getContext('webgpu');

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

    this.adapterInfo = this.adapter.adapterInfo;

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
      viewFormats: [this.renderFormat],
      alphaMode: 'opaque',
    });

    this.renderBundleDescriptor = {
      colorFormats: [ this.renderFormat ],
      depthStencilFormat: DEPTH_FORMAT,
      sampleCount: SAMPLE_COUNT
    };

    this.textureLoader = new WebGPUTextureLoader(this.device);

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

    this.bindGroupLayouts.frame.label = "frame-bgl";

    this.pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [
        this.bindGroupLayouts.frame, // set 0
        this.bindGroupLayouts.material, // set 1
        this.bindGroupLayouts.primitive, // set 2
      ]
    });

    this.lightsBuffer = this.device.createBuffer({
      size: this.lightManager.uniformArray.byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    });

    this.views = [];
    for (let i = 0; i < MAX_VIEW_COUNT; ++i) {
      this.views.push(new WebGPUView(this));
    }

    this.bindGroups = {}

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

  get needComputeWorkaround() {
    this.adapterInfo.architecture == 'adreno-6xx';
  }

  setScene(gltf) {
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

    let metaballTexture;
    if (this.metaballTexturePath) {
      metaballTexture = await this.textureLoader.fromUrl(this.metaballTexturePath, {colorSpace: 'sRGB'});
    } else {
      metaballTexture = this.textureLoader.fromColor(0, 0, 0);
    }

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

  updateMetaballs(timestamp) {
    if (this.drawMetaballs && this.metaballsNeedUpdate && this.metaballRenderer) {
      this.metaballsNeedUpdate = false;

      super.updateMetaballs(timestamp);

      this.metaballRenderer.updateMetaballs(this.metaballs, this.marchingCubes);

      this.metaballRenderer.update(this.marchingCubes);

      this.metaballsNeedUpdate = true;
    }
  }

  renderScene(renderPass, gpuView) {
    if (this.scene && this.renderEnvironment) {
      this.scene.draw(renderPass, gpuView);
    }

    if (this.drawMetaballs && this.metaballRenderer && this.bindGroups.metaball) {
      // Draw metaballs.
      this.metaballRenderer.draw(renderPass, gpuView);
    }

    if (this.lightManager.render) {
      // Last, render a sprite for all of the lights. This is done using instancing so it's a single
      // call for every light.
      this.lightSprites.draw(renderPass, gpuView);
    }
  }

  onFrame(timestamp, timeDelta) {
    const gpuView = this.views[0];

    // Update the light unform buffer with the latest values.
    this.device.queue.writeBuffer(this.lightsBuffer, 0, this.lightManager.uniformArray);

    // Copy values from the camera into our frame uniform buffers
    gpuView.updateMatrices(timestamp, this.camera);

    const commandEncoder = this.device.createCommandEncoder({});

    // First update the metaballs isosurface and mesh.
    this.metaballRenderer.updateCompute(commandEncoder, this.timestampHelper);

    const computePass = commandEncoder.beginComputePass({
      timestampWrites: this.timestampHelper.timestampWrites('Clusters'),
    });
    gpuView.clusteredLights.updateClusters(computePass);
    computePass.end();

    const currentTexture = this.context.getCurrentTexture();
    const currentView = currentTexture.createView({ format: this.renderFormat });
    const colorAttachment = {
      loadOp: 'clear',
      storeOp: SAMPLE_COUNT > 1 ? 'discard' : 'store', // Discards the multisampled view, not the resolveTarget
      clearValue: CLEAR_VALUE,
    };

    if (SAMPLE_COUNT > 1) {
      colorAttachment.view = gpuView.getMsaaTextureView(currentTexture, SAMPLE_COUNT);
      colorAttachment.resolveTarget = currentView;
    } else {
      colorAttachment.view = currentView;
    }

    const passEncoder = commandEncoder.beginRenderPass({
      label: '2D View',
      colorAttachments: [colorAttachment],
      depthStencilAttachment: {
        view: gpuView.getDepthTextureView(currentTexture, DEPTH_FORMAT, SAMPLE_COUNT),
        depthLoadOp: 'clear',
        depthClearValue: 1.0,
        depthStoreOp: 'discard',
      },
      timestampWrites: this.timestampHelper.timestampWrites('Rendering'),
    });

    this.renderScene(passEncoder, gpuView);

    passEncoder.end();

    this.timestampHelper.resolve(commandEncoder);

    const commandBuffer = commandEncoder.finish();
    this.device.queue.submit([commandBuffer]);

    this.timestampHelper.read().then((results) => {
      for (let [key, result] of Object.entries(results)) {
        this.stats.addSample(key, result);
      }
    });
  }

  async onXRStarted() {
    this.xrBinding = new XRGPUBinding(this.xrSession, this.device);

    // TODO: Use XR preferred color format
    this.xrLayer = this.xrBinding.createProjectionLayer({
      colorFormat: this.contextFormat,
      scaleFactor: 0.5,
    });

    this.xrSession.updateRenderState({ layers: [this.xrLayer] });

    const localFloorSpace = await this.xrSession.requestReferenceSpace('local-floor');

    // Scoot our reference space origin back a bit so that we don't start inside the metaballs.
    const offset = new XRRigidTransform({z: -1.8});
    this.xrRefSpace = localFloorSpace.getOffsetReferenceSpace(offset);
  }

  onXRFrame(timestamp, timeDelta, xrFrame) {
    let pose = xrFrame.getViewerPose(this.xrRefSpace);
    if (!pose) { return; }

    // Update the light unform buffer with the latest values as well.
    this.device.queue.writeBuffer(this.lightsBuffer, 0, this.lightManager.uniformArray);

    const commandEncoder = this.device.createCommandEncoder({});

    // First update the metaballs isosurface and mesh.
    this.metaballRenderer.updateCompute(commandEncoder, this.timestampHelper);

    // Next do a pass over the views to prep the uniforms/light clusters.
    const computePass = commandEncoder.beginComputePass({
      timestampWrites: this.timestampHelper.timestampWrites('Clusters'),
    });

    const subImages = [];

    for (let viewIndex = 0; viewIndex < pose.views.length; ++viewIndex) {
      const xrView = pose.views[viewIndex];
      const gpuView = this.views[viewIndex];
      subImages[viewIndex] = this.xrBinding.getViewSubImage(this.xrLayer, xrView);

      // This uses writeBuffer, so it will be enqueued before the command buffer is submitted.
      gpuView.updateMatricesForXR(timestamp, xrView, subImages[viewIndex]);
      gpuView.clusteredLights.updateClusters(computePass);
    }

    computePass.end();

    // Next loop through all the views again and just do the rendering.
    for (let viewIndex = 0; viewIndex < pose.views.length; ++viewIndex) {
      const xrView = pose.views[viewIndex];
      const gpuView = this.views[viewIndex];
      const subImage = subImages[viewIndex];

      const currentView = subImage.colorTexture.createView(subImage.getViewDescriptor());
      const colorAttachment = {
        loadOp: 'clear',
        storeOp: SAMPLE_COUNT > 1 ? 'discard' : 'store', // Discards the multisampled view, not the resolveTarget
        clearValue: CLEAR_VALUE,
      };

      if (SAMPLE_COUNT > 1) {
        colorAttachment.view = gpuView.getMsaaTextureView(subImage.colorTexture, SAMPLE_COUNT);
        colorAttachment.resolveTarget = currentView;
      } else {
        colorAttachment.view = currentView;
      }

      const renderPass = commandEncoder.beginRenderPass({
          label: `XR View ${viewIndex} (${xrView.eye})`,
          colorAttachments: [colorAttachment],
          depthStencilAttachment: {
            view: gpuView.getDepthTextureView(subImage.colorTexture, DEPTH_FORMAT, SAMPLE_COUNT),
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
            depthClearValue: 1.0,
          },
          timestampWrites: this.timestampHelper.timestampWrites(`View ${viewIndex}`)
        });

      const vp = subImage.viewport;
      renderPass.setViewport(vp.x, vp.y, vp.width, vp.height, 0.0, 1.0);

      this.renderScene(renderPass, gpuView);

      renderPass.end();
    }

    this.timestampHelper.resolve(commandEncoder);

    const commandBuffer = commandEncoder.finish();
    this.device.queue.submit([commandBuffer]);

    this.timestampHelper.read().then((results) => {
      for (let [key, result] of Object.entries(results)) {
        this.stats.addSample(key, result);
      }
    });
  }
}