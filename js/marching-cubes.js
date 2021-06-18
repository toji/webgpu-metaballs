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

import { vec3 } from "gl-matrix";
import {
  MarchingCubesEdgeTable as edgeTable,
  MarchingCubesTriTable as triTable
} from "./marching-cubes-tables.js";

//
// Triangulates an isosurface using the Marching Cubes algorithm
//

const indexList = new Uint16Array(12);
const TMP_VEC3_A = vec3.create();
const TMP_VEC3_B = vec3.create();

// Lifted from https://stackoverflow.com/questions/43122082/efficiently-count-the-number-of-bits-in-an-integer-in-javascript/43122214
function bitCount (n) {
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return ((n + (n >> 4) & 0xF0F0F0F) * 0x1010101) >> 24;
}

const DEFAULT_VOLUME = {
  xMin: -1,
  xMax: 1,
  xStep: 0.1,
  yMin: -1,
  yMax: 1,
  yStep: 0.1,
  zMin: -1,
  zMax: 1,
  zStep: 0.1,
};

export class MarchingCubes {
  constructor(surfaceVolume = {}) {
    this.volume = Object.assign({}, DEFAULT_VOLUME, surfaceVolume);
    this.volume.width = Math.floor((this.volume.xMax - this.volume.xMin) / this.volume.xStep) + 1;
    this.volume.height = Math.floor((this.volume.yMax - this.volume.yMin) / this.volume.yStep) + 1;
    this.volume.depth = Math.floor((this.volume.zMax - this.volume.zMin) / this.volume.zStep) + 1;
    this.volume.values = new Float32Array(this.volume.width * this.volume.height * this.volume.depth);

    this.valueCache = new Float32Array(8);
    this.normalCache = new Float32Array(8 * 3);
  }

  updateVolume(isosurface) {
    const vol = this.volume;
    const values = vol.values;
    let offset = 0;
    for (let k = 0; k < vol.depth; ++k) {
      const z = vol.zMin + (vol.zStep * k);
      for (let j = 0; j < vol.height; ++j) {
        const y = vol.yMin + (vol.yStep * j);
        for (let i = 0; i < vol.width; ++i) {
          const x = vol.xMin + (vol.xStep * i);
          values[offset++] = isosurface.surfaceFunc(x, y, z);
        }
      }
    }
  }

  valueAt(i, j, k) {
    const vol = this.volume;
    const index = i +
                 (j * vol.width) +
                 (k * vol.width * vol.height);
    return vol.values[index];
  }

  generateMesh(arrays, threshold = 40) {
    if (!arrays.positions) {
      throw new Error('Must specify a positions array');
    }
    if (!arrays.indices) {
      throw new Error('Must specify a index array');
    }

    if (!arrays.vertexOffset) {
      arrays.vertexOffset = 0;
    }
    if (!arrays.indexOffset) {
      arrays.indexOffset = 0;
    }

    arrays.maxVertices = Math.floor(arrays.positions.length / 3);
    if (arrays.normals) {
      arrays.maxVertices = Math.min(arrays.maxVertices, Math.floor(arrays.normals.length / 3));
    }

    const initialIndexOffset = arrays.indexOffset;

    // Iterate through the full volume and evaluate the isosurface at every
    // point, then generate the triangulated surface based on that.
    const vol = this.volume;
    for (let k = 0; k < vol.depth-1; ++k) {
      for (let j = 0; j < vol.height-1; ++j) {
        for (let i = 0; i < vol.width-1; ++i) {
          if (!this.marchingCube(i, j, k, threshold, arrays)) {
            // If we hit this then our output arrays have run out of room and we'll simply have to
            // abort mid-triangulation. At least you'll get a partially computed surface out of it!
            return arrays.indexOffset - initialIndexOffset;
          }
        }
      }
    }
    return arrays.indexOffset - initialIndexOffset;
  }

  marchingCube(i, j , k, threshold, arrays) {
    let vertexOffset = arrays.vertexOffset;
    const vol = this.volume;
    const positions = arrays.positions;
    const normals = arrays.normals;

    const x = vol.xMin + (vol.xStep * i);
    const y = vol.yMin + (vol.yStep * j);
    const z = vol.zMin + (vol.zStep * k);

    const values = this.valueCache;
    values[0] = this.valueAt(i, j, k);
    values[1] = this.valueAt(i+1, j, k);
    values[2] = this.valueAt(i+1, j+1, k);
    values[3] = this.valueAt(i, j+1, k);
    values[4] = this.valueAt(i, j, k+1);
    values[5] = this.valueAt(i+1, j, k+1);
    values[6] = this.valueAt(i+1, j+1, k+1);
    values[7] = this.valueAt(i, j+1, k+1);

    // Determine the index into the edge table which tells us which vertices are
    // inside of the surface.
    let cubeIndex = 0;
    if (values[0] < threshold) cubeIndex |= 1;
    if (values[1] < threshold) cubeIndex |= 2;
    if (values[2] < threshold) cubeIndex |= 4;
    if (values[3] < threshold) cubeIndex |= 8;
    if (values[4] < threshold) cubeIndex |= 16;
    if (values[5] < threshold) cubeIndex |= 32;
    if (values[6] < threshold) cubeIndex |= 64;
    if (values[7] < threshold) cubeIndex |= 128;

    const edges = edgeTable[cubeIndex];
  
    // Cube is entirely in/out of the surface
    if (edges === 0) {
      return true;
    }
    // Will we run out of space in the vertex buffers?
    const vertCount = bitCount(edges);
    if (vertCount + vertexOffset >= arrays.maxVertices) {
      return false;
    }
  
    // Generate vertices where the surface intersects the cube
    if (edges & 1) {
      this.interpX(positions, normals, vertexOffset*3, threshold, i, j, k, values[0], values[1]);
      indexList[0] = vertexOffset++;
    }
    if (edges & 2) {
      this.interpY(positions, normals, vertexOffset*3, threshold, i+1, j, k, values[1], values[2]);
      indexList[1] = vertexOffset++;
    }
    if (edges & 4) {
      this.interpX(positions, normals, vertexOffset*3, threshold, i, j+1, k, values[3], values[2]);
      indexList[2] = vertexOffset++;
    }
    if (edges & 8) {
      this.interpY(positions, normals, vertexOffset*3, threshold, i, j, k, values[0], values[3]);
      indexList[3] = vertexOffset++;
    }

    if (edges & 16) {
      this.interpX(positions, normals, vertexOffset*3, threshold, i, j, k+1, values[4], values[5]);
      indexList[4] = vertexOffset++;
    }
    if (edges & 32) {
      this.interpY(positions, normals, vertexOffset*3, threshold, i+1, j, k+1, values[5], values[6]);
      indexList[5] = vertexOffset++;
    }
    if (edges & 64) {
      this.interpX(positions, normals, vertexOffset*3, threshold, i, j+1, k+1, values[7], values[6]);
      indexList[6] = vertexOffset++;
    }
    if (edges & 128) {
      this.interpY(positions, normals, vertexOffset*3, threshold, i, j, k+1, values[4], values[7]);
      indexList[7] = vertexOffset++;
    }

    if (edges & 256) {
      this.interpZ(positions, normals, vertexOffset*3, threshold, i, j, k, values[0], values[4]);
      indexList[8] = vertexOffset++;
    }
    if (edges & 512) {
      this.interpZ(positions, normals, vertexOffset*3, threshold, i+1, j, k, values[1], values[5]);
      indexList[9] = vertexOffset++;
    }
    if (edges & 1024) {
      this.interpZ(positions, normals, vertexOffset*3, threshold, i+1, j+1, k, values[2], values[6]);
      indexList[10] = vertexOffset++;
    }
    if (edges & 2048) {
      this.interpZ(positions, normals, vertexOffset*3, threshold, i, j+1, k, values[3], values[7]);
      indexList[11] = vertexOffset++;
    }
  
    arrays.vertexOffset = vertexOffset;
  
    // Record the triangle indices
    let triTableOffset = cubeIndex <<= 4;
    const indexCount = triTable[triTableOffset++];
    if (indexCount >= arrays.indices.length) {
      // Not enough space in the index arrays for any more triangles.
      return false;
    }

    for (let i = 0; i < indexCount; ++i) {
      const index = triTable[triTableOffset++];
      arrays.indices[arrays.indexOffset++] = indexList[index];
    }

    return true;
  }

  interpX(out, nout, offset, threshold, i, j, k, valp1, valp2, q) {
    const vol = this.volume;
    const mu = (threshold - valp1) / (valp2 - valp1);
    out[offset] = vol.xMin + (vol.xStep * i) + (mu * vol.xStep);
    out[offset+1] = vol.yMin + (vol.yStep * j);
    out[offset+2] = vol.zMin + (vol.zStep * k);

    if (nout) {
      this.computeNormal(TMP_VEC3_A, 0, i, j, k);
      this.computeNormal(TMP_VEC3_B, 0, i+1, j, k);

      vec3.lerp(TMP_VEC3_A, TMP_VEC3_A, TMP_VEC3_B, mu);
      nout[offset] = TMP_VEC3_A[0];
      nout[offset+1] = TMP_VEC3_A[1];
      nout[offset+2] = TMP_VEC3_A[2];
    }
  };
  
  interpY(out, nout, offset, threshold, i, j, k, valp1, valp2, q) {
    const vol = this.volume;
    const mu = (threshold - valp1) / (valp2 - valp1);
    out[offset] = vol.xMin + (vol.xStep * i);
    out[offset+1] = vol.yMin + (vol.yStep * j) + (mu * vol.yStep);
    out[offset+2] = vol.zMin + (vol.zStep * k);

    if (nout) {
      this.computeNormal(TMP_VEC3_A, 0, i, j, k);
      this.computeNormal(TMP_VEC3_B, 0, i, j+1, k);
    
      vec3.lerp(TMP_VEC3_A, TMP_VEC3_A, TMP_VEC3_B, mu);
      nout[offset] = TMP_VEC3_A[0];
      nout[offset+1] = TMP_VEC3_A[1];
      nout[offset+2] = TMP_VEC3_A[2];
    }
  };
  
  interpZ(out, nout, offset, threshold, i, j, k, valp1, valp2, q) {
    const vol = this.volume;
    const mu = (threshold - valp1) / (valp2 - valp1);
    out[offset] = vol.xMin + (vol.xStep * i);
    out[offset+1] = vol.yMin + (vol.yStep * j);
    out[offset+2] = vol.zMin + (vol.zStep * k) + (mu * vol.zStep);

    if (nout) {
      this.computeNormal(TMP_VEC3_A, 0, i, j, k);
      this.computeNormal(TMP_VEC3_B, 0, i, j, k+1);

      vec3.lerp(TMP_VEC3_A, TMP_VEC3_A, TMP_VEC3_B, mu);
      nout[offset] = TMP_VEC3_A[0];
      nout[offset+1] = TMP_VEC3_A[1];
      nout[offset+2] = TMP_VEC3_A[2];
    }
  };

  // TODO: How much difference does it make if we cache this?
  computeNormal = function(nout, offset, i, j ,k) {
    nout[offset] = this.valueAt(i-1, j, k) - this.valueAt(i+1, j, k);
    nout[offset+1] = this.valueAt(i, j-1, k) - this.valueAt(i, j+1, k);
    nout[offset+2] = this.valueAt(i, j, k-1) - this.valueAt(i, j, k+1);
  };
}
