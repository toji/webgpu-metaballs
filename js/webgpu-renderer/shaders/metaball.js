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

let edges = '';
for (const edge of MarchingCubesEdgeTable) {
  edges += `${edge}u,`;
}

const edgeTable = `
  let edgeTable : array<u32, ${MarchingCubesEdgeTable.length}> =
    array<u32, ${MarchingCubesEdgeTable.length}>(${edges});
`;

function triIdx(i) {
  return Math.max(MarchingCubesTriTable[i], 0);
}
let triIndices = '';
for (let i = 0; i < MarchingCubesTriTable.length;i++) {
  triIndices += `
    vec3<u32>(${triIdx(i++)}u,${triIdx(i++)}u,${triIdx(i++)}u),
    vec3<u32>(${triIdx(i++)}u,${triIdx(i++)}u,${triIdx(i++)}u),
    vec3<u32>(${triIdx(i++)}u,${triIdx(i++)}u,${triIdx(i++)}u),
    vec3<u32>(${triIdx(i++)}u,${triIdx(i++)}u,${triIdx(i++)}u),
    vec3<u32>(${triIdx(i++)}u,${triIdx(i++)}u,${triIdx(i++)}u),
  `;
}
// Is it better to just do this as an array of ints?
/*for (const index of MarchingCubesTriTable) {
  triIndices += `${index},`;
}*/

const triTable = `
  let triTable : array<vec3<u32>, ${MarchingCubesEdgeTable.length*5}> =
    array<vec3<u32>, ${MarchingCubesEdgeTable.length*5}>(${triIndices});
`;

const IsosurfaceVolume = `
  [[block]] struct IsosurfaceVolume {
    min: vec3<f32>;
    max: vec3<f32>;
    step: vec3<f32>;
    size: vec3<u32>;
    threshold: f32;
    values: [[stride(4)]] array<f32>;
  };
`;

export const MetaballFieldComputeSource = `

`;

export const MarchingCubesComputeSource = `
  ${edgeTable}
  ${triTable}

  ${IsosurfaceVolume}
  [[group(0), binding(0)]] var<storage> volume : [[access(read)]] IsosurfaceVolume;

  // Output buffers
  [[block]] struct PositionBuffer {
    values : array<vec3<f32>>;
  };
  [[group(0), binding(1)]] var<storage> positionsOut : [[access(write)]] PositionBuffer;

  [[block]] struct NormalBuffer {
    values : array<vec3<f32>>;
  };
  [[group(0), binding(2)]] var<storage> normalsOut : [[access(write)]] NormalBuffer;

  [[block]] struct IndexBuffer {
    tris : array<vec3<u32>>;
  };
  [[group(0), binding(3)]] var<storage> indicesOut : [[access(write)]] IndexBuffer;

  // Data fetchers
  fn valueAt(index : vec3<u32>) -> f32 {
    let valueIndex : u32 = index.x +
                          (index.y * volume.size.x) +
                          (index.z * volume.size.x * volume.size.y);
    return volume.values[valueIndex];
  }

  fn positionAt(index : vec3<u32>) -> vec3<f32> {
    return volume.min + (volume.step * vec3<f32>(index.xyz));
  }

  fn normalAt(index : vec3<u32>) -> vec3<f32> {
    return vec3<f32>(
      valueAt(index - vec3<u32>(1u, 0u, 0u)) - valueAt(index + vec3<u32>(1u, 0u, 0u)),
      valueAt(index - vec3<u32>(0u, 1u, 0u)) - valueAt(index + vec3<u32>(0u, 1u, 0u)),
      valueAt(index - vec3<u32>(0u, 0u, 1u)) - valueAt(index + vec3<u32>(0u, 0u, 1u))
    );
  }
  
  // Vertex interpolation
  var<private> positions : array<vec3<f32>, 12>;
  var<private> normals : array<vec3<f32>, 12>;

  fn interpX(offset : u32, i : vec3<u32>, va : f32, vb : f32) {
    let mu : f32 = (volume.threshold - va) / (vb - va);
    positions[offset] = positionAt(i) + vec3<f32>(volume.step.x * mu, 0.0, 0.0);

    let na : vec3<f32> = normalAt(i);
    let nb : vec3<f32> = normalAt(i + vec3<u32>(1u, 0u, 0u));
    normals[offset] = mix(na, nb, vec3<f32>(mu, mu, mu));
  }

  fn interpY(offset : u32, i : vec3<u32>, va : f32, vb : f32) {
    let mu : f32 = (volume.threshold - va) / (vb - va);
    positions[offset] = positionAt(i) + vec3<f32>(0.0, volume.step.y * mu, 0.0);

    let na : vec3<f32> = normalAt(i);
    let nb : vec3<f32> = normalAt(i + vec3<u32>(0u, 1u, 0u));
    normals[offset] = mix(na, nb, vec3<f32>(mu, mu, mu));
  }

  fn interpZ(offset : u32, i : vec3<u32>, va : f32, vb : f32) {
    let mu : f32 = (volume.threshold - va) / (vb - va);
    positions[offset] = positionAt(i) + vec3<f32>(0.0, 0.0, volume.step.z * mu);

    let na : vec3<f32> = normalAt(i);
    let nb : vec3<f32> = normalAt(i + vec3<u32>(0u, 0u, 1u));
    normals[offset] = mix(na, nb, vec3<f32>(mu, mu, mu));
  }

  // Main marching cubes algorithm
  [[stage(compute)]]
  fn computeMain([[builtin(global_invocation_id)]] global_id : vec3<u32>) {
    // Cache the values we're going to be referencing frequently.
    let i0 : vec3<u32> = global_id;
    let i1 : vec3<u32> = global_id + vec3<u32>(1u, 0u, 0u);
    let i2 : vec3<u32> = global_id + vec3<u32>(1u, 1u, 0u);
    let i3 : vec3<u32> = global_id + vec3<u32>(0u, 1u, 0u);
    let i4 : vec3<u32> = global_id + vec3<u32>(0u, 0u, 1u);
    let i5 : vec3<u32> = global_id + vec3<u32>(1u, 0u, 1u);
    let i6 : vec3<u32> = global_id + vec3<u32>(1u, 1u, 1u);
    let i7 : vec3<u32> = global_id + vec3<u32>(0u, 1u, 1u);

    let v0 : f32 = valueAt(i0);
    let v1 : f32 = valueAt(i1);
    let v2 : f32 = valueAt(i2);
    let v3 : f32 = valueAt(i3);
    let v4 : f32 = valueAt(i4);
    let v5 : f32 = valueAt(i5);
    let v6 : f32 = valueAt(i6);
    let v7 : f32 = valueAt(i7);

    var cubeIndex : u32 = 0u;
    if (v0 < volume.threshold) { cubeIndex = cubeIndex | 1u; }
    if (v1 < volume.threshold) { cubeIndex = cubeIndex | 2u; }
    if (v2 < volume.threshold) { cubeIndex = cubeIndex | 4u; }
    if (v3 < volume.threshold) { cubeIndex = cubeIndex | 8u; }
    if (v4 < volume.threshold) { cubeIndex = cubeIndex | 16u; }
    if (v5 < volume.threshold) { cubeIndex = cubeIndex | 32u; }
    if (v6 < volume.threshold) { cubeIndex = cubeIndex | 64u; }
    if (v7 < volume.threshold) { cubeIndex = cubeIndex | 128u; }

    let edges : u32 = edgeTable[cubeIndex];

    // Once we have atomics we can early-terminate here if edges == 0

    if ((edges & 1u) != 0u) { interpX(0u, i0, v0, v1); }
    if ((edges & 2u) != 0u) { interpY(1u, i1, v1, v2); }
    if ((edges & 4u) != 0u) { interpX(2u, i3, v3, v2); }
    if ((edges & 8u) != 0u) { interpY(3u, i0, v0, v3); }

    if ((edges & 16u) != 0u) { interpX(4u, i4, v4, v5); }
    if ((edges & 32u) != 0u) { interpY(5u, i5, v5, v6); }
    if ((edges & 64u) != 0u) { interpX(6u, i7, v7, v6); }
    if ((edges & 128u) != 0u) { interpY(7u, i4, v4, v7); }

    if ((edges & 256u) != 0u) { interpZ(8u, i0, v0, v4); }
    if ((edges & 512u) != 0u) { interpZ(9u, i1, v1, v5); }
    if ((edges & 1024u) != 0u) { interpZ(10u, i2, v2, v6); }
    if ((edges & 2048u) != 0u) { interpZ(11u, i3, v3, v7); }

    // Copy positions to output buffer

    // In an ideal world this offset is tracked as an atomic so that we don't waste so much space.
    let vertexOffset : u32 = (global_id.x +
                              global_id.y * volume.size.x +
                              global_id.z * volume.size.x * volume.size.y);
    for (var i : u32 = 0u; i < 12u; i = i + 1u) {
      positionsOut.values[vertexOffset*12u + i] = positions[i];
      normalsOut.values[vertexOffset*12u + i] = normals[i];
    }

    // Compute the indices for the positions
    var triTableOffset : u32 = cubeIndex * 5u;
    for (var i : u32 = 0u; i < 5u; i = i + 1u) {
      let tri : vec3<u32> = triTable[triTableOffset + i];
      indicesOut.tris[i] = vec3<u32>(
        tri.x + vertexOffset,
        tri.y + vertexOffset,
        tri.z + vertexOffset
      );
    }
  }
`;

export const MetaballVertexSource = `
  ${ProjectionUniforms}
  ${ViewUniforms}

  struct VertexInput {
    [[location(${ATTRIB_MAP.POSITION})]] position : vec3<f32>;
    [[location(${ATTRIB_MAP.NORMAL})]] normal : vec3<f32>;
  };

  struct VertexOutput {
    [[location(0)]] worldPosition : vec3<f32>;
    [[location(1)]] normal : vec3<f32>;
    [[location(2)]] flow : vec3<f32>;
    [[builtin(position)]] position : vec4<f32>;
  };

  [[stage(vertex)]]
  fn vertexMain(input : VertexInput) -> VertexOutput {
    var output : VertexOutput;
    output.worldPosition = input.position;
    output.normal = input.normal;
    output.flow = vec3<f32>(sin(view.time * 0.0001), cos(view.time * 0.0004), sin(view.time * 0.00007));

    output.position = projection.matrix * view.matrix * vec4<f32>(input.position, 1.0);
    return output;
  }
`;

export const MetaballFragmentSource = `
  ${ColorConversions}

  [[group(1), binding(0)]] var baseSampler : sampler;
  [[group(1), binding(1)]] var baseTexture : texture_2d<f32>;

  struct VertexOutput {
    [[location(0)]] worldPosition : vec3<f32>;
    [[location(1)]] normal : vec3<f32>;
    [[location(2)]] flow : vec3<f32>;
  };

  [[stage(fragment)]]
  fn fragmentMain(input : VertexOutput) -> [[location(0)]] vec4<f32> {
    let normal : vec3<f32> = normalize(input.normal);

    var blending : vec3<f32> = abs(normal);
    blending = normalize(max(blending, vec3<f32>(0.00001, 0.00001, 0.00001))); // Force weights to sum to 1.0

    let xTex : vec4<f32> = textureSample(baseTexture, baseSampler, input.worldPosition.yz + input.flow.yz);
    let yTex : vec4<f32> = textureSample(baseTexture, baseSampler, input.worldPosition.xz + input.flow.xz);
    let zTex : vec4<f32> = textureSample(baseTexture, baseSampler, input.worldPosition.xy + input.flow.xy);
    // blend the results of the 3 planar projections.
    let tex : vec4<f32> = xTex * blending.x + yTex * blending.y + zTex * blending.z;

    return vec4<f32>(linearTosRGB(tex.xyz), 1.0);
  }
`;
