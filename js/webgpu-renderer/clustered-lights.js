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
  TILE_COUNT,
  TOTAL_TILES,
  CLUSTER_LIGHTS_SIZE
} from './shaders/clustered-compute.js';
import { BIND_GROUP } from './shaders/common.js';

export class ClusteredLightManager {
  constructor(renderer) {
    this.renderer = renderer;
    this.clusterPipeline = null;

    const device = renderer.device;
    this.clusterLightsBuffer = device.createBuffer({
      size: CLUSTER_LIGHTS_SIZE * TOTAL_TILES,
      usage: GPUBufferUsage.STORAGE
    });

    this.clusterBoundsBuffer = device.createBuffer({
      size: TOTAL_TILES * 32, // Cluster x, y, z size * 32 bytes per cluster.
      usage: GPUBufferUsage.STORAGE
    });

    this.clusterBoundsReadOnlyBindGroupLayout = device.createBindGroupLayout({
      label: `Cluster Bounds Bind Group Layout`,
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' }
      }]
    });
  }

  updateClusterBounds(commandEncoder = null) {
    const device = this.renderer.device;

    if (!this.clusterBoundsPipeline) {
      const clusterStorageBindGroupLayout = device.createBindGroupLayout({
        label: `Cluster Storage Bind Group Layout`,
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' }
        }]
      });

      this.clusterBoundsPipeline = device.createComputePipeline({
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

      this.clusterBoundsBindGroups = device.createBindGroup({
        layout: this.clusterBoundsReadOnlyBindGroupLayout,
        entries: [{
          binding: 0,
          resource: {
            buffer: this.clusterBoundsBuffer,
          },
        }],
      });
    }

    const externalCommandEncoder = !!commandEncoder;
    if (!externalCommandEncoder) {
      commandEncoder = device.createCommandEncoder();
    }
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.clusterBoundsPipeline);
    passEncoder.setBindGroup(BIND_GROUP.Frame, this.renderer.bindGroups.frame);
    passEncoder.setBindGroup(1, this.clusterStorageBindGroup);
    passEncoder.dispatch(...TILE_COUNT);
    passEncoder.endPass();

    if (!externalCommandEncoder) {
      device.queue.submit([commandEncoder.finish()]);
    }
  }

  updateClusterLights(commandEncoder = null) {
    const device = this.renderer.device;

    if (!this.clusterLightsPipeline) {
      const clusterLightsPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [
          this.renderer.bindGroupLayouts.frame, // set 0
          this.clusterBoundsReadOnlyBindGroupLayout, // set 1
        ]
      });

      this.clusterLightsPipeline = device.createComputePipeline({
        layout: clusterLightsPipelineLayout,
        compute: {
          module: device.createShaderModule({ code: ClusterLightsSource, label: "Cluster Lights" }),
          entryPoint: 'main',
        }
      });
    }

    const externalCommandEncoder = !!commandEncoder;
    if (!externalCommandEncoder) {
      commandEncoder = device.createCommandEncoder();
    }

    // Update the FrameUniforms buffer with the values that are used by every
    // program and don't change for the duration of the frame.
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.clusterLightsPipeline);
    passEncoder.setBindGroup(BIND_GROUP.Frame, this.renderer.bindGroups.frame);
    passEncoder.setBindGroup(1, this.clusterBoundsBindGroups);
    passEncoder.dispatch(...TILE_COUNT);
    passEncoder.endPass();

    if (!externalCommandEncoder) {
      device.queue.submit([commandEncoder.finish()]);
    }
  }
}
