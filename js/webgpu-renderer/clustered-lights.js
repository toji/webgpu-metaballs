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
  constructor(renderer) {
    this.renderer = renderer;
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

    // Cluster Bounds computation resources
    const clusterStorageBindGroupLayout = device.createBindGroupLayout({
      label: `Cluster Storage Bind Group Layout`,
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' }
      }]
    });

    this.clusterBoundsReady = device.createComputePipelineAsync({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [
          this.renderer.bindGroupLayouts.frame, // set 0
          clusterStorageBindGroupLayout, // set 1
        ]
      }),
      compute: {
        module: device.createShaderModule({ code: ClusterBoundsSource, label: "Cluster Bounds" }),
        entryPoint: 'main',
      }
    }).then((pipeline) => {
      this.clusterBoundsPipeline = pipeline;
    });

    this.clusterStorageBindGroup = device.createBindGroup({
      layout: clusterStorageBindGroupLayout,
      entries: [{
        binding: 0,
        resource: {
          buffer: this.clusterBoundsBuffer,
        },
      }],
    });

    // Cluster Lights computation resources
    const clusterBoundsReadOnlyBindGroupLayout = device.createBindGroupLayout({
      label: `Cluster Bounds Bind Group Layout`,
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' }
      }]
    });

    device.createComputePipelineAsync({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [
          this.renderer.bindGroupLayouts.frame, // set 0
          clusterBoundsReadOnlyBindGroupLayout, // set 1
        ]
      }),
      compute: {
        module: device.createShaderModule({ code: ClusterLightsSource, label: "Cluster Lights" }),
        entryPoint: 'main',
      }
    }).then((pipeline) => {
      this.clusterLightsPipeline = pipeline;
    });

    this.clusterBoundsBindGroup = device.createBindGroup({
      layout: clusterBoundsReadOnlyBindGroupLayout,
      entries: [{
        binding: 0,
        resource: {
          buffer: this.clusterBoundsBuffer,
        },
      }],
    });
  }

  updateClusterBounds(commandEncoder = null) {
    const device = this.renderer.device;

    // If the cluster bounds pipeline isn't ready the first time we call this
    // wait till it is ready and then call back into it again.
    if (!this.clusterBoundsPipeline) {
      this.clusterBoundsReady.then(() => {
        this.updateClusterBounds();
      });
      return;
    }

    const externalCommandEncoder = !!commandEncoder;
    if (!externalCommandEncoder) {
      commandEncoder = device.createCommandEncoder();
    }
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.clusterBoundsPipeline);
    passEncoder.setBindGroup(BIND_GROUP.Frame, this.renderer.bindGroups.frame);
    passEncoder.setBindGroup(1, this.clusterStorageBindGroup);
    passEncoder.dispatchWorkgroups(...DISPATCH_SIZE);
    passEncoder.end();

    if (!externalCommandEncoder) {
      device.queue.submit([commandEncoder.finish()]);
    }
  }

  updateClusterLights(commandEncoder = null) {
    const device = this.renderer.device;

    if (!this.clusterLightsPipeline) { return; }

    // Reset the light offset counter to 0 before populating the light clusters.
    device.queue.writeBuffer(this.clusterLightsBuffer, 0, emptyArray);

    const externalCommandEncoder = !!commandEncoder;
    if (!externalCommandEncoder) {
      commandEncoder = device.createCommandEncoder();
    }

    // Update the FrameUniforms buffer with the values that are used by every
    // program and don't change for the duration of the frame.
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.clusterLightsPipeline);
    passEncoder.setBindGroup(BIND_GROUP.Frame, this.renderer.bindGroups.frame);
    passEncoder.setBindGroup(1, this.clusterBoundsBindGroup);
    passEncoder.dispatchWorkgroups(...DISPATCH_SIZE);
    passEncoder.end();

    if (!externalCommandEncoder) {
      device.queue.submit([commandEncoder.finish()]);
    }
  }
}
