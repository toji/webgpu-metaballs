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

import { ProjectionUniforms, ViewUniforms, ColorConversions, ATTRIB_MAP } from './common.js';
import {
  MarchingCubesEdgeTable,
  MarchingCubesTriTable,
} from "../../marching-cubes-tables.js";

export const WORKGROUP_SIZE = [4, 4, 4];

const IsosurfaceVolume = /*wgsl*/`
  struct IsosurfaceVolume {
    min: vec3f,
    max: vec3f,
    step: vec3f,
    size: vec3u,
    threshold: f32,
    values: array<f32>,
  }
`;

export const MetaballFieldComputeSource = /*wgsl*/`
  struct Metaball {
    position: vec3f,
    radius: f32,
    strength: f32,
    subtract: f32,
  }

  struct MetaballList {
    ballCount: u32,
    balls: array<Metaball>,
  }
  @group(0) @binding(0) var<storage> metaballs : MetaballList;

  ${IsosurfaceVolume}
  @group(0) @binding(1) var<storage, read_write> volume : IsosurfaceVolume;

  fn positionAt(index : vec3u) -> vec3f {
    return volume.min + (volume.step * vec3f(index.xyz));
  }

  fn surfaceFunc(position : vec3f) -> f32 {
    var result = 0.0;

    // Always render geometry on the floor
    if ((position.x*position.x + position.z*position.z < 1.1) && position.y < 0) {
      return 100;
    }

    for (var i = 0u; i < metaballs.ballCount; i = i + 1) {
      let ball = metaballs.balls[i];
      let dist = distance(position, ball.position);
      let val = ball.strength / (0.000001 + (dist * dist)) - ball.subtract;
      if (val > 0.0) {
        result = result + val;
      }
    }
    return result;
  }

  @compute @workgroup_size(${WORKGROUP_SIZE[0]}, ${WORKGROUP_SIZE[1]}, ${WORKGROUP_SIZE[2]})
  fn computeMain(@builtin(global_invocation_id) global_id : vec3u) {
    if (any(global_id >= volume.size)) { return; }
    let position = positionAt(global_id);
    let valueIndex = global_id.x +
                    (global_id.y * volume.size.x) +
                    (global_id.z * volume.size.x * volume.size.y);

    volume.values[valueIndex] = surfaceFunc(position);
  }
`;

export const MarchingCubesComputeSource = /*wgsl*/`
  struct Tables {
    edges: array<u32, ${MarchingCubesEdgeTable.length}>,
    tris: array<i32, ${MarchingCubesTriTable.length}>,
  }
  @group(0) @binding(0) var<storage> tables : Tables;

  ${IsosurfaceVolume}
  @group(0) @binding(1) var<storage, read_write> volume : IsosurfaceVolume;

  // Output buffers
  struct PositionBuffer {
    values : array<f32>,
  }
  @group(0) @binding(2) var<storage, read_write> positionsOut : PositionBuffer;

  struct NormalBuffer {
    values : array<f32>,
  }
  @group(0) @binding(3) var<storage, read_write> normalsOut : NormalBuffer;

  struct IndexBuffer {
    tris : array<u32>,
  }
  @group(0) @binding(4) var<storage, read_write> indicesOut : IndexBuffer;

  struct DrawIndirectArgs {
    vc : u32,
    vertexCount : atomic<u32>, // Actually instance count, treated as vertex count for point cloud rendering.
    firstVertex : u32,
    firstInstance : u32,

    indexCount : atomic<u32>,
    indexedInstanceCount : u32,
    indexedFirstIndex : u32,
    indexedBaseVertex : u32,
    indexedFirstInstance : u32,
  }
  @group(0) @binding(5) var<storage, read_write> drawOut : DrawIndirectArgs;

  // Data fetchers
  fn valueAt(index : vec3u) -> f32 {
    // Don't index outside of the volume bounds.
    if (any(index >= volume.size)) { return 0.0; }

    let valueIndex = index.x +
                    (index.y * volume.size.x) +
                    (index.z * volume.size.x * volume.size.y);
    return volume.values[valueIndex];
  }

  fn positionAt(index : vec3u) -> vec3f {
    return volume.min + (volume.step * vec3f(index.xyz));
  }

  fn normalAt(index : vec3u) -> vec3f {
    return vec3f(
      valueAt(index - vec3u(1, 0, 0)) - valueAt(index + vec3u(1, 0, 0)),
      valueAt(index - vec3u(0, 1, 0)) - valueAt(index + vec3u(0, 1, 0)),
      valueAt(index - vec3u(0, 0, 1)) - valueAt(index + vec3u(0, 0, 1))
    );
  }

  // Vertex interpolation
  var<private> positions : array<vec3f, 12>;
  var<private> normals : array<vec3f, 12>;
  var<private> indices : array<u32, 12>;
  var<private> cubeVerts = 0u;

  fn interpX(index : u32, i : vec3u, va : f32, vb : f32) {
    let mu = (volume.threshold - va) / (vb - va);
    positions[cubeVerts] = positionAt(i) + vec3f(volume.step.x * mu, 0, 0);

    let na = normalAt(i);
    let nb = normalAt(i + vec3u(1, 0, 0));
    normals[cubeVerts] = mix(na, nb, vec3(mu));

    indices[index] = cubeVerts;
    cubeVerts = cubeVerts + 1;
  }

  fn interpY(index : u32, i : vec3u, va : f32, vb : f32) {
    let mu = (volume.threshold - va) / (vb - va);
    positions[cubeVerts] = positionAt(i) + vec3f(0, volume.step.y * mu, 0);

    let na = normalAt(i);
    let nb = normalAt(i + vec3u(0, 1, 0));
    normals[cubeVerts] = mix(na, nb, vec3(mu));

    indices[index] = cubeVerts;
    cubeVerts = cubeVerts + 1;
  }

  fn interpZ(index : u32, i : vec3u, va : f32, vb : f32) {
    let mu = (volume.threshold - va) / (vb - va);
    positions[cubeVerts] = positionAt(i) + vec3f(0, 0, volume.step.z * mu);

    let na = normalAt(i);
    let nb = normalAt(i + vec3u(0, 0, 1));
    normals[cubeVerts] = mix(na, nb, vec3(mu));

    indices[index] = cubeVerts;
    cubeVerts = cubeVerts + 1;
  }

  // Main marching cubes algorithm
  @compute @workgroup_size(${WORKGROUP_SIZE[0]}, ${WORKGROUP_SIZE[1]}, ${WORKGROUP_SIZE[2]})
  fn computeMain(@builtin(global_invocation_id) global_id : vec3u) {
    if (any(global_id >= volume.size)) { return; }

    // Cache the values we're going to be referencing frequently.
    let i0 = global_id;
    let i1 = global_id + vec3u(1, 0, 0);
    let i2 = global_id + vec3u(1, 1, 0);
    let i3 = global_id + vec3u(0, 1, 0);
    let i4 = global_id + vec3u(0, 0, 1);
    let i5 = global_id + vec3u(1, 0, 1);
    let i6 = global_id + vec3u(1, 1, 1);
    let i7 = global_id + vec3u(0, 1, 1);

    let v0 = valueAt(i0);
    let v1 = valueAt(i1);
    let v2 = valueAt(i2);
    let v3 = valueAt(i3);
    let v4 = valueAt(i4);
    let v5 = valueAt(i5);
    let v6 = valueAt(i6);
    let v7 = valueAt(i7);

    var cubeIndex = 0u;
    if (v0 < volume.threshold) { cubeIndex = cubeIndex | 1; }
    if (v1 < volume.threshold) { cubeIndex = cubeIndex | 2; }
    if (v2 < volume.threshold) { cubeIndex = cubeIndex | 4; }
    if (v3 < volume.threshold) { cubeIndex = cubeIndex | 8; }
    if (v4 < volume.threshold) { cubeIndex = cubeIndex | 16; }
    if (v5 < volume.threshold) { cubeIndex = cubeIndex | 32; }
    if (v6 < volume.threshold) { cubeIndex = cubeIndex | 64; }
    if (v7 < volume.threshold) { cubeIndex = cubeIndex | 128; }

    let edges = tables.edges[cubeIndex];

    // Early-terminate here if edges == 0
    if (edges == 0u) { return; }

    if ((edges & 1) != 0) { interpX(0, i0, v0, v1); }
    if ((edges & 2) != 0) { interpY(1, i1, v1, v2); }
    if ((edges & 4) != 0) { interpX(2, i3, v3, v2); }
    if ((edges & 8) != 0) { interpY(3, i0, v0, v3); }
    if ((edges & 16) != 0) { interpX(4, i4, v4, v5); }
    if ((edges & 32) != 0) { interpY(5, i5, v5, v6); }
    if ((edges & 64) != 0) { interpX(6, i7, v7, v6); }
    if ((edges & 128) != 0) { interpY(7, i4, v4, v7); }
    if ((edges & 256) != 0) { interpZ(8, i0, v0, v4); }
    if ((edges & 512) != 0) { interpZ(9, i1, v1, v5); }
    if ((edges & 1024) != 0) { interpZ(10, i2, v2, v6); }
    if ((edges & 2048) != 0) { interpZ(11, i3, v3, v7); }

    let triTableOffset = (cubeIndex << 4) + 1;
    let indexCount = u32(tables.tris[triTableOffset - 1]);

    // Increment atomics that track the current vertex and index offsets
    var firstVertex = atomicAdd(&drawOut.vertexCount, cubeVerts);
    let firstIndex = atomicAdd(&drawOut.indexCount, indexCount);

    // Copy positions to output buffer
    for (var i = 0u; i < cubeVerts; i = i + 1) {
      positionsOut.values[firstVertex*3 + i*3] = positions[i].x;
      positionsOut.values[firstVertex*3 + i*3 + 1] = positions[i].y;
      positionsOut.values[firstVertex*3 + i*3 + 2] = positions[i].z;

      normalsOut.values[firstVertex*3 + i*3] = normals[i].x;
      normalsOut.values[firstVertex*3 + i*3 + 1] = normals[i].y;
      normalsOut.values[firstVertex*3 + i*3 + 2] = normals[i].z;
    }

    // Write out the indices
    for (var i = 0u; i < indexCount; i = i + 1) {
      let index = tables.tris[triTableOffset + i];
      indicesOut.tris[firstIndex + i] = firstVertex + indices[index];
    }
  }
`;

export const MetaballRenderSource = /*wgsl*/`
  ${ProjectionUniforms}
  ${ViewUniforms}
  ${ColorConversions}

  struct VertexInput {
    @location(${ATTRIB_MAP.POSITION}) position : vec3f,
    @location(${ATTRIB_MAP.NORMAL}) normal : vec3f,
  }

  struct VertexOutput {
    @location(0) worldPosition : vec3f,
    @location(1) normal : vec3f,
    @location(2) flow : vec3f,
    @builtin(position) position : vec4f,
  }

  @vertex
  fn vertexMain(input : VertexInput) -> VertexOutput {
    var output : VertexOutput;
    output.worldPosition = input.position;
    output.normal = input.normal;
    output.flow = vec3f(sin(view.time * 0.0001), cos(view.time * 0.0004), sin(view.time * 0.00007));

    output.position = projection.matrix * view.matrix * vec4f(input.position, 1);
    return output;
  }

  @group(1) @binding(0) var baseSampler : sampler;
  @group(1) @binding(1) var baseTexture : texture_2d<f32>;

  @fragment
  fn fragmentMain(input : VertexOutput) -> @location(0) vec4f {
    let normal = normalize(input.normal);

    var blending = abs(normal);
    blending = normalize(max(blending, vec3f(0.00001))); // Force weights to sum to 1.0

    let xTex = textureSample(baseTexture, baseSampler, input.worldPosition.yz + input.flow.yz);
    let yTex = textureSample(baseTexture, baseSampler, input.worldPosition.xz + input.flow.xz);
    let zTex = textureSample(baseTexture, baseSampler, input.worldPosition.xy + input.flow.xy);
    // blend the results of the 3 planar projections.
    let tex = xTex * blending.x + yTex * blending.y + zTex * blending.z;

    return vec4f(linearTosRGB(tex.xyz), 1);
  }
`;

// For visualizing the metaballs as a point cloud
export const MetaballRenderPointSource = /*wgsl*/`
  ${ProjectionUniforms}
  ${ViewUniforms}
  ${ColorConversions}

  var<private> pos : array<vec2f, 4> = array<vec2f, 4>(
    vec2f(-1, 1), vec2f(1, 1), vec2f(-1, -1), vec2f(1, -1)
  );

  struct VertexInput {
    @location(${ATTRIB_MAP.POSITION}) position : vec3f,
    @builtin(vertex_index) vertexIndex : u32,
  }

  struct VertexOutput {
    @builtin(position) position : vec4f,
  }

  @vertex
  fn vertexMain(input : VertexInput) -> VertexOutput {
    var output : VertexOutput;

    var bbModelViewMatrix : mat4x4f;
    bbModelViewMatrix[3] = vec4(input.position, 1.0);
    bbModelViewMatrix = view.matrix * bbModelViewMatrix;
    bbModelViewMatrix[0][0] = 1.0;
    bbModelViewMatrix[0][1] = 0.0;
    bbModelViewMatrix[0][2] = 0.0;

    bbModelViewMatrix[1][0] = 0.0;
    bbModelViewMatrix[1][1] = 1.0;
    bbModelViewMatrix[1][2] = 0.0;

    bbModelViewMatrix[2][0] = 0.0;
    bbModelViewMatrix[2][1] = 0.0;
    bbModelViewMatrix[2][2] = 1.0;

    output.position = projection.matrix * bbModelViewMatrix * vec4f(pos[input.vertexIndex] * 0.005, 0, 1);
    return output;
  }

  @group(1) @binding(0) var baseSampler : sampler;
  @group(1) @binding(1) var baseTexture : texture_2d<f32>;

  @fragment
  fn fragmentMain(input : VertexOutput) -> @location(0) vec4f {
    return vec4f(1);
  }
`;
