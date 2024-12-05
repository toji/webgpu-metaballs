// Copyright 2021 Brandon Jones
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

import {
  ClusterBoundsSource,
  ClusterLightsSource,
  DISPATCH_SIZE,
  TOTAL_TILES,
  CLUSTER_LIGHTS_SIZE
} from './shaders/clustered-compute.js';
import { BIND_GROUP } from './shaders/common.js';

const emptyArray = new Uint32Array(1);

export class ClusteredLightManager {
  static rendererPipelinePromises = new Map();

  static GetPipelineForRenderer(renderer) {
    let promise = ClusteredLightManager.rendererPipelinePromises.get(renderer);
    if (!promise) {
      const device = renderer.device;

      // These two bind groups layout expose the same buffer but with different
      // access, because the bounds don't need to be altered when the lights
      // are being clustered.
      const clusterBoundsBindGroupLayout = device.createBindGroupLayout({
        label: `Cluster Storage Bind Group Layout`,
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' }
        }]
      });

      const clusterBoundsReadOnlyBindGroupLayout = device.createBindGroupLayout({
        label: `Cluster Bounds Bind Group Layout`,
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' }
        }]
      });

      const boundsPromise = device.createComputePipelineAsync({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [
            renderer.bindGroupLayouts.frame, // set 0
            clusterBoundsBindGroupLayout, // set 1
          ]
        }),
        compute: {
          module: device.createShaderModule({ code: ClusterBoundsSource, label: "Cluster Bounds" }),
          entryPoint: 'main',
        }
      });

      const lightsPromise = device.createComputePipelineAsync({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [
            renderer.bindGroupLayouts.frame, // set 0
            clusterBoundsReadOnlyBindGroupLayout, // set 1
          ]
        }),
        compute: {
          module: device.createShaderModule({ code: ClusterLightsSource, label: "Cluster Lights" }),
          entryPoint: 'main',
        }
      });

      promise = Promise.all([boundsPromise, lightsPromise]);
      ClusteredLightManager.rendererPipelinePromises.set(renderer, promise);
    }
    return promise;
  }

  constructor(renderer, view) {
    this.renderer = renderer;
    this.view = view;
    this.clusterPipeline = null;

    const device = renderer.device;
    this.clusterLightsBuffer = device.createBuffer({
      size: CLUSTER_LIGHTS_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    this.clusterBoundsBuffer = device.createBuffer({
      size: TOTAL_TILES * 32, // Cluster x, y, z size * 32 bytes per cluster.
      usage: GPUBufferUsage.STORAGE
    });

    // Cluster computation resources
    ClusteredLightManager.GetPipelineForRenderer(renderer).then((pipelines) => {
      this.clusterBoundsPipeline = pipelines[0];
      this.clusterLightsPipeline = pipelines[1];

      this.clusterBoundsBindGroup = device.createBindGroup({
        layout: this.clusterBoundsPipeline.getBindGroupLayout(1),
        entries: [{
          binding: 0,
          resource: {
            buffer: this.clusterBoundsBuffer,
          },
        }],
      });

      this.clusterBoundsReadOnlyBindGroup = device.createBindGroup({
        layout: this.clusterLightsPipeline.getBindGroupLayout(1),
        entries: [{
          binding: 0,
          resource: {
            buffer: this.clusterBoundsBuffer,
          },
        }],
      });
    });
  }

  updateClusters(computePass = null, updateBounds = true) {
    const device = this.renderer.device;

    // If the cluster pipelines aren't ready return early.
    if (!this.clusterLightsPipeline || (updateBounds && !this.clusterBoundsPipeline)) {
      return false;
    }

    // Reset the light offset counter to 0 before populating the light clusters.
    device.queue.writeBuffer(this.clusterLightsBuffer, 0, emptyArray);

    const externalComputePass = !!computePass;
    const commandEncoder = null;
    if (!externalComputePass) {
      commandEncoder = device.createCommandEncoder();
      computePass = commandEncoder.beginComputePass();
    }

    computePass.setBindGroup(BIND_GROUP.Frame, this.view.bindGroup);

    if (updateBounds) {
      // Update the cluster bounds if needed. This has to happen any time the
      // projection matrix changes, but not if the view matrix changes.
      computePass.setPipeline(this.clusterBoundsPipeline);
      computePass.setBindGroup(1, this.clusterBoundsBindGroup);
      computePass.dispatchWorkgroups(...DISPATCH_SIZE);
    }

    // Update the lights for each cluster
    computePass.setPipeline(this.clusterLightsPipeline);
    computePass.setBindGroup(1, this.clusterBoundsReadOnlyBindGroup);
    computePass.dispatchWorkgroups(...DISPATCH_SIZE);

    if (!externalComputePass) {
      computePass.end();
      device.queue.submit([commandEncoder.finish()]);
    }

    return true;
  }
}
