/*
 * isosurface - Triangulates an isosurface using the Marching Cubes algorithm
 */

/*
 * Copyright (c) 2012 Brandon Jones
 *
 * This software is provided 'as-is', without any express or implied
 * warranty. In no event will the authors be held liable for any damages
 * arising from the use of this software.
 *
 * Permission is granted to anyone to use this software for any purpose,
 * including commercial applications, and to alter it and redistribute it
 * freely, subject to the following restrictions:
 *
 *    1. The origin of this software must not be misrepresented; you must not
 *    claim that you wrote the original software. If you use this software
 *    in a product, an acknowledgment in the product documentation would be
 *    appreciated but is not required.
 *
 *    2. Altered source versions must be plainly marked as such, and must not
 *    be misrepresented as being the original software.
 *
 *    3. This notice may not be removed or altered from any source
 *    distribution.
 */

// Isosurface code starts here:

const edgeTable = new Uint16Array([
  0x000, 0x109, 0x203, 0x30a, 0x406, 0x50f, 0x605, 0x70c,
  0x80c, 0x905, 0xa0f, 0xb06, 0xc0a, 0xd03, 0xe09, 0xf00,
  0x190, 0x099, 0x393, 0x29a, 0x596, 0x49f, 0x795, 0x69c,
  0x99c, 0x895, 0xb9f, 0xa96, 0xd9a, 0xc93, 0xf99, 0xe90,
  0x230, 0x339, 0x033, 0x13a, 0x636, 0x73f, 0x435, 0x53c,
  0xa3c, 0xb35, 0x83f, 0x936, 0xe3a, 0xf33, 0xc39, 0xd30,
  0x3a0, 0x2a9, 0x1a3, 0x0aa, 0x7a6, 0x6af, 0x5a5, 0x4ac,
  0xbac, 0xaa5, 0x9af, 0x8a6, 0xfaa, 0xea3, 0xda9, 0xca0,
  0x460, 0x569, 0x663, 0x76a, 0x066, 0x16f, 0x265, 0x36c,
  0xc6c, 0xd65, 0xe6f, 0xf66, 0x86a, 0x963, 0xa69, 0xb60,
  0x5f0, 0x4f9, 0x7f3, 0x6fa, 0x1f6, 0x0ff, 0x3f5, 0x2fc,
  0xdfc, 0xcf5, 0xfff, 0xef6, 0x9fa, 0x8f3, 0xbf9, 0xaf0,
  0x650, 0x759, 0x453, 0x55a, 0x256, 0x35f, 0x055, 0x15c,
  0xe5c, 0xf55, 0xc5f, 0xd56, 0xa5a, 0xb53, 0x859, 0x950,
  0x7c0, 0x6c9, 0x5c3, 0x4ca, 0x3c6, 0x2cf, 0x1c5, 0x0cc,
  0xfcc, 0xec5, 0xdcf, 0xcc6, 0xbca, 0xac3, 0x9c9, 0x8c0,
  0x8c0, 0x9c9, 0xac3, 0xbca, 0xcc6, 0xdcf, 0xec5, 0xfcc,
  0x0cc, 0x1c5, 0x2cf, 0x3c6, 0x4ca, 0x5c3, 0x6c9, 0x7c0,
  0x950, 0x859, 0xb53, 0xa5a, 0xd56, 0xc5f, 0xf55, 0xe5c,
  0x15c, 0x055, 0x35f, 0x256, 0x55a, 0x453, 0x759, 0x650,
  0xaf0, 0xbf9, 0x8f3, 0x9fa, 0xef6, 0xfff, 0xcf5, 0xdfc,
  0x2fc, 0x3f5, 0x0ff, 0x1f6, 0x6fa, 0x7f3, 0x4f9, 0x5f0,
  0xb60, 0xa69, 0x963, 0x86a, 0xf66, 0xe6f, 0xd65, 0xc6c,
  0x36c, 0x265, 0x16f, 0x066, 0x76a, 0x663, 0x569, 0x460,
  0xca0, 0xda9, 0xea3, 0xfaa, 0x8a6, 0x9af, 0xaa5, 0xbac,
  0x4ac, 0x5a5, 0x6af, 0x7a6, 0x0aa, 0x1a3, 0x2a9, 0x3a0,
  0xd30, 0xc39, 0xf33, 0xe3a, 0x936, 0x83f, 0xb35, 0xa3c,
  0x53c, 0x435, 0x73f, 0x636, 0x13a, 0x033, 0x339, 0x230,
  0xe90, 0xf99, 0xc93, 0xd9a, 0xa96, 0xb9f, 0x895, 0x99c,
  0x69c, 0x795, 0x49f, 0x596, 0x29a, 0x393, 0x099, 0x190,
  0xf00, 0xe09, 0xd03, 0xc0a, 0xb06, 0xa0f, 0x905, 0x80c,
  0x70c, 0x605, 0x50f, 0x406, 0x30a, 0x203, 0x109, 0x000
]);

const triTable = [
  [],
  [0, 8, 3],
  [0, 1, 9],
  [1, 8, 3, 9, 8, 1],
  [1, 2, 10],
  [0, 8, 3, 1, 2, 10],
  [9, 2, 10, 0, 2, 9],
  [2, 8, 3, 2, 10, 8, 10, 9, 8],
  [3, 11, 2],
  [0, 11, 2, 8, 11, 0],
  [1, 9, 0, 2, 3, 11],
  [1, 11, 2, 1, 9, 11, 9, 8, 11],
  [3, 10, 1, 11, 10, 3],
  [0, 10, 1, 0, 8, 10, 8, 11, 10],
  [3, 9, 0, 3, 11, 9, 11, 10, 9 ],
  [9, 8, 10, 10, 8, 11],
  [4, 7, 8],
  [4, 3, 0, 7, 3, 4],
  [0, 1, 9, 8, 4, 7],
  [4, 1, 9, 4, 7, 1, 7, 3, 1],
  [1, 2, 10, 8, 4, 7],
  [3, 4, 7, 3, 0, 4, 1, 2, 10],
  [9, 2, 10, 9, 0, 2, 8, 4, 7],
  [2, 10, 9, 2, 9, 7, 2, 7, 3, 7, 9, 4],
  [8, 4, 7, 3, 11, 2],
  [11, 4, 7, 11, 2, 4, 2, 0, 4],
  [9, 0, 1, 8, 4, 7, 2, 3, 11],
  [4, 7, 11, 9, 4, 11, 9, 11, 2, 9, 2, 1],
  [3, 10, 1, 3, 11, 10, 7, 8, 4],
  [1, 11, 10, 1, 4, 11, 1, 0, 4, 7, 11, 4],
  [4, 7, 8, 9, 0, 11, 9, 11, 10, 11, 0, 3],
  [4, 7, 11, 4, 11, 9, 9, 11, 10],
  [9, 5, 4],
  [9, 5, 4, 0, 8, 3],
  [0, 5, 4, 1, 5, 0],
  [8, 5, 4, 8, 3, 5, 3, 1, 5],
  [1, 2, 10, 9, 5, 4],
  [3, 0, 8, 1, 2, 10, 4, 9, 5],
  [5, 2, 10, 5, 4, 2, 4, 0, 2],
  [2, 10, 5, 3, 2, 5, 3, 5, 4, 3, 4, 8],
  [9, 5, 4, 2, 3, 11],
  [0, 11, 2, 0, 8, 11, 4, 9, 5],
  [0, 5, 4, 0, 1, 5, 2, 3, 11],
  [2, 1, 5, 2, 5, 8, 2, 8, 11, 4, 8, 5],
  [10, 3, 11, 10, 1, 3, 9, 5, 4],
  [4, 9, 5, 0, 8, 1, 8, 10, 1, 8, 11, 10],
  [5, 4, 0, 5, 0, 11, 5, 11, 10, 11, 0, 3],
  [5, 4, 8, 5, 8, 10, 10, 8, 11],
  [9, 7, 8, 5, 7, 9],
  [9, 3, 0, 9, 5, 3, 5, 7, 3],
  [0, 7, 8, 0, 1, 7, 1, 5, 7],
  [1, 5, 3, 3, 5, 7],
  [9, 7, 8, 9, 5, 7, 10, 1, 2],
  [10, 1, 2, 9, 5, 0, 5, 3, 0, 5, 7, 3],
  [8, 0, 2, 8, 2, 5, 8, 5, 7, 10, 5, 2],
  [2, 10, 5, 2, 5, 3, 3, 5, 7],
  [7, 9, 5, 7, 8, 9, 3, 11, 2],
  [9, 5, 7, 9, 7, 2, 9, 2, 0, 2, 7, 11],
  [2, 3, 11, 0, 1, 8, 1, 7, 8, 1, 5, 7],
  [11, 2, 1, 11, 1, 7, 7, 1, 5],
  [9, 5, 8, 8, 5, 7, 10, 1, 3, 10, 3, 11],
  [5, 7, 0, 5, 0, 9, 7, 11, 0, 1, 0, 10, 11, 10, 0],
  [11, 10, 0, 11, 0, 3, 10, 5, 0, 8, 0, 7, 5, 7, 0],
  [11, 10, 5, 7, 11, 5],
  [10, 6, 5],
  [0, 8, 3, 5, 10, 6],
  [9, 0, 1, 5, 10, 6],
  [1, 8, 3, 1, 9, 8, 5, 10, 6],
  [1, 6, 5, 2, 6, 1],
  [1, 6, 5, 1, 2, 6, 3, 0, 8],
  [9, 6, 5, 9, 0, 6, 0, 2, 6],
  [5, 9, 8, 5, 8, 2, 5, 2, 6, 3, 2, 8],
  [2, 3, 11, 10, 6, 5],
  [11, 0, 8, 11, 2, 0, 10, 6, 5],
  [0, 1, 9, 2, 3, 11, 5, 10, 6],
  [5, 10, 6, 1, 9, 2, 9, 11, 2, 9, 8, 11],
  [6, 3, 11, 6, 5, 3, 5, 1, 3],
  [0, 8, 11, 0, 11, 5, 0, 5, 1, 5, 11, 6],
  [3, 11, 6, 0, 3, 6, 0, 6, 5, 0, 5, 9],
  [6, 5, 9, 6, 9, 11, 11, 9, 8],
  [5, 10, 6, 4, 7, 8],
  [4, 3, 0, 4, 7, 3, 6, 5, 10],
  [1, 9, 0, 5, 10, 6, 8, 4, 7],
  [10, 6, 5, 1, 9, 7, 1, 7, 3, 7, 9, 4],
  [6, 1, 2, 6, 5, 1, 4, 7, 8],
  [1, 2, 5, 5, 2, 6, 3, 0, 4, 3, 4, 7],
  [8, 4, 7, 9, 0, 5, 0, 6, 5, 0, 2, 6],
  [7, 3, 9, 7, 9, 4, 3, 2, 9, 5, 9, 6, 2, 6, 9],
  [3, 11, 2, 7, 8, 4, 10, 6, 5],
  [5, 10, 6, 4, 7, 2, 4, 2, 0, 2, 7, 11],
  [0, 1, 9, 4, 7, 8, 2, 3, 11, 5, 10, 6],
  [9, 2, 1, 9, 11, 2, 9, 4, 11, 7, 11, 4, 5, 10, 6],
  [8, 4, 7, 3, 11, 5, 3, 5, 1, 5, 11, 6],
  [5, 1, 11, 5, 11, 6, 1, 0, 11, 7, 11, 4, 0, 4, 11],
  [0, 5, 9, 0, 6, 5, 0, 3, 6, 11, 6, 3, 8, 4, 7],
  [6, 5, 9, 6, 9, 11, 4, 7, 9, 7, 11, 9],
  [10, 4, 9, 6, 4, 10],
  [4, 10, 6, 4, 9, 10, 0, 8, 3],
  [10, 0, 1, 10, 6, 0, 6, 4, 0],
  [8, 3, 1, 8, 1, 6, 8, 6, 4, 6, 1, 10],
  [1, 4, 9, 1, 2, 4, 2, 6, 4],
  [3, 0, 8, 1, 2, 9, 2, 4, 9, 2, 6, 4],
  [0, 2, 4, 4, 2, 6],
  [8, 3, 2, 8, 2, 4, 4, 2, 6],
  [10, 4, 9, 10, 6, 4, 11, 2, 3],
  [0, 8, 2, 2, 8, 11, 4, 9, 10, 4, 10, 6],
  [3, 11, 2, 0, 1, 6, 0, 6, 4, 6, 1, 10],
  [6, 4, 1, 6, 1, 10, 4, 8, 1, 2, 1, 11, 8, 11, 1],
  [9, 6, 4, 9, 3, 6, 9, 1, 3, 11, 6, 3],
  [8, 11, 1, 8, 1, 0, 11, 6, 1, 9, 1, 4, 6, 4, 1],
  [3, 11, 6, 3, 6, 0, 0, 6, 4],
  [6, 4, 8, 11, 6, 8],
  [7, 10, 6, 7, 8, 10, 8, 9, 10],
  [0, 7, 3, 0, 10, 7, 0, 9, 10, 6, 7, 10],
  [10, 6, 7, 1, 10, 7, 1, 7, 8, 1, 8, 0],
  [10, 6, 7, 10, 7, 1, 1, 7, 3],
  [1, 2, 6, 1, 6, 8, 1, 8, 9, 8, 6, 7],
  [2, 6, 9, 2, 9, 1, 6, 7, 9, 0, 9, 3, 7, 3, 9],
  [7, 8, 0, 7, 0, 6, 6, 0, 2],
  [7, 3, 2, 6, 7, 2],
  [2, 3, 11, 10, 6, 8, 10, 8, 9, 8, 6, 7],
  [2, 0, 7, 2, 7, 11, 0, 9, 7, 6, 7, 10, 9, 10, 7],
  [1, 8, 0, 1, 7, 8, 1, 10, 7, 6, 7, 10, 2, 3, 11],
  [11, 2, 1, 11, 1, 7, 10, 6, 1, 6, 7, 1],
  [8, 9, 6, 8, 6, 7, 9, 1, 6, 11, 6, 3, 1, 3, 6],
  [0, 9, 1, 11, 6, 7],
  [7, 8, 0, 7, 0, 6, 3, 11, 0, 11, 6, 0],
  [7, 11, 6],
  [7, 6, 11],
  [3, 0, 8, 11, 7, 6],
  [0, 1, 9, 11, 7, 6],
  [8, 1, 9, 8, 3, 1, 11, 7, 6],
  [10, 1, 2, 6, 11, 7],
  [1, 2, 10, 3, 0, 8, 6, 11, 7],
  [2, 9, 0, 2, 10, 9, 6, 11, 7],
  [6, 11, 7, 2, 10, 3, 10, 8, 3, 10, 9, 8],
  [7, 2, 3, 6, 2, 7],
  [7, 0, 8, 7, 6, 0, 6, 2, 0],
  [2, 7, 6, 2, 3, 7, 0, 1, 9],
  [1, 6, 2, 1, 8, 6, 1, 9, 8, 8, 7, 6],
  [10, 7, 6, 10, 1, 7, 1, 3, 7],
  [10, 7, 6, 1, 7, 10, 1, 8, 7, 1, 0, 8],
  [0, 3, 7, 0, 7, 10, 0, 10, 9, 6, 10, 7],
  [7, 6, 10, 7, 10, 8, 8, 10, 9],
  [6, 8, 4, 11, 8, 6],
  [3, 6, 11, 3, 0, 6, 0, 4, 6],
  [8, 6, 11, 8, 4, 6, 9, 0, 1],
  [9, 4, 6, 9, 6, 3, 9, 3, 1, 11, 3, 6],
  [6, 8, 4, 6, 11, 8, 2, 10, 1],
  [1, 2, 10, 3, 0, 11, 0, 6, 11, 0, 4, 6],
  [4, 11, 8, 4, 6, 11, 0, 2, 9, 2, 10, 9],
  [10, 9, 3, 10, 3, 2, 9, 4, 3, 11, 3, 6, 4, 6, 3],
  [8, 2, 3, 8, 4, 2, 4, 6, 2],
  [0, 4, 2, 4, 6, 2],
  [1, 9, 0, 2, 3, 4, 2, 4, 6, 4, 3, 8],
  [1, 9, 4, 1, 4, 2, 2, 4, 6],
  [8, 1, 3, 8, 6, 1, 8, 4, 6, 6, 10, 1],
  [10, 1, 0, 10, 0, 6, 6, 0, 4],
  [4, 6, 3, 4, 3, 8, 6, 10, 3, 0, 3, 9, 10, 9, 3],
  [10, 9, 4, 6, 10, 4],
  [4, 9, 5, 7, 6, 11],
  [0, 8, 3, 4, 9, 5, 11, 7, 6],
  [5, 0, 1, 5, 4, 0, 7, 6, 11],
  [11, 7, 6, 8, 3, 4, 3, 5, 4, 3, 1, 5],
  [9, 5, 4, 10, 1, 2, 7, 6, 11],
  [6, 11, 7, 1, 2, 10, 0, 8, 3, 4, 9, 5],
  [7, 6, 11, 5, 4, 10, 4, 2, 10, 4, 0, 2],
  [3, 4, 8, 3, 5, 4, 3, 2, 5, 10, 5, 2, 11, 7, 6],
  [7, 2, 3, 7, 6, 2, 5, 4, 9],
  [9, 5, 4, 0, 8, 6, 0, 6, 2, 6, 8, 7],
  [3, 6, 2, 3, 7, 6, 1, 5, 0, 5, 4, 0],
  [6, 2, 8, 6, 8, 7, 2, 1, 8, 4, 8, 5, 1, 5, 8],
  [9, 5, 4, 10, 1, 6, 1, 7, 6, 1, 3, 7],
  [1, 6, 10, 1, 7, 6, 1, 0, 7, 8, 7, 0, 9, 5, 4],
  [4, 0, 10, 4, 10, 5, 0, 3, 10, 6, 10, 7, 3, 7, 10],
  [7, 6, 10, 7, 10, 8, 5, 4, 10, 4, 8, 10],
  [6, 9, 5, 6, 11, 9, 11, 8, 9],
  [3, 6, 11, 0, 6, 3, 0, 5, 6, 0, 9, 5],
  [0, 11, 8, 0, 5, 11, 0, 1, 5, 5, 6, 11],
  [6, 11, 3, 6, 3, 5, 5, 3, 1],
  [1, 2, 10, 9, 5, 11, 9, 11, 8, 11, 5, 6],
  [0, 11, 3, 0, 6, 11, 0, 9, 6, 5, 6, 9, 1, 2, 10],
  [11, 8, 5, 11, 5, 6, 8, 0, 5, 10, 5, 2, 0, 2, 5],
  [6, 11, 3, 6, 3, 5, 2, 10, 3, 10, 5, 3],
  [5, 8, 9, 5, 2, 8, 5, 6, 2, 3, 8, 2],
  [9, 5, 6, 9, 6, 0, 0, 6, 2],
  [1, 5, 8, 1, 8, 0, 5, 6, 8, 3, 8, 2, 6, 2, 8],
  [1, 5, 6, 2, 1, 6],
  [1, 3, 6, 1, 6, 10, 3, 8, 6, 5, 6, 9, 8, 9, 6],
  [10, 1, 0, 10, 0, 6, 9, 5, 0, 5, 6, 0],
  [0, 3, 8, 5, 6, 10],
  [10, 5, 6],
  [11, 5, 10, 7, 5, 11],
  [11, 5, 10, 11, 7, 5, 8, 3, 0],
  [5, 11, 7, 5, 10, 11, 1, 9, 0],
  [10, 7, 5, 10, 11, 7, 9, 8, 1, 8, 3, 1],
  [11, 1, 2, 11, 7, 1, 7, 5, 1],
  [0, 8, 3, 1, 2, 7, 1, 7, 5, 7, 2, 11],
  [9, 7, 5, 9, 2, 7, 9, 0, 2, 2, 11, 7],
  [7, 5, 2, 7, 2, 11, 5, 9, 2, 3, 2, 8, 9, 8, 2],
  [2, 5, 10, 2, 3, 5, 3, 7, 5],
  [8, 2, 0, 8, 5, 2, 8, 7, 5, 10, 2, 5],
  [9, 0, 1, 5, 10, 3, 5, 3, 7, 3, 10, 2],
  [9, 8, 2, 9, 2, 1, 8, 7, 2, 10, 2, 5, 7, 5, 2],
  [1, 3, 5, 3, 7, 5],
  [0, 8, 7, 0, 7, 1, 1, 7, 5],
  [9, 0, 3, 9, 3, 5, 5, 3, 7],
  [9, 8, 7, 5, 9, 7],
  [5, 8, 4, 5, 10, 8, 10, 11, 8],
  [5, 0, 4, 5, 11, 0, 5, 10, 11, 11, 3, 0],
  [0, 1, 9, 8, 4, 10, 8, 10, 11, 10, 4, 5],
  [10, 11, 4, 10, 4, 5, 11, 3, 4, 9, 4, 1, 3, 1, 4],
  [2, 5, 1, 2, 8, 5, 2, 11, 8, 4, 5, 8],
  [0, 4, 11, 0, 11, 3, 4, 5, 11, 2, 11, 1, 5, 1, 11],
  [0, 2, 5, 0, 5, 9, 2, 11, 5, 4, 5, 8, 11, 8, 5],
  [9, 4, 5, 2, 11, 3],
  [2, 5, 10, 3, 5, 2, 3, 4, 5, 3, 8, 4],
  [5, 10, 2, 5, 2, 4, 4, 2, 0],
  [3, 10, 2, 3, 5, 10, 3, 8, 5, 4, 5, 8, 0, 1, 9],
  [5, 10, 2, 5, 2, 4, 1, 9, 2, 9, 4, 2],
  [8, 4, 5, 8, 5, 3, 3, 5, 1],
  [0, 4, 5, 1, 0, 5],
  [8, 4, 5, 8, 5, 3, 9, 0, 5, 0, 3, 5],
  [9, 4, 5],
  [4, 11, 7, 4, 9, 11, 9, 10, 11],
  [0, 8, 3, 4, 9, 7, 9, 11, 7, 9, 10, 11],
  [1, 10, 11, 1, 11, 4, 1, 4, 0, 7, 4, 11],
  [3, 1, 4, 3, 4, 8, 1, 10, 4, 7, 4, 11, 10, 11, 4],
  [4, 11, 7, 9, 11, 4, 9, 2, 11, 9, 1, 2],
  [9, 7, 4, 9, 11, 7, 9, 1, 11, 2, 11, 1, 0, 8, 3],
  [11, 7, 4, 11, 4, 2, 2, 4, 0],
  [11, 7, 4, 11, 4, 2, 8, 3, 4, 3, 2, 4],
  [2, 9, 10, 2, 7, 9, 2, 3, 7, 7, 4, 9],
  [9, 10, 7, 9, 7, 4, 10, 2, 7, 8, 7, 0, 2, 0, 7],
  [3, 7, 10, 3, 10, 2, 7, 4, 10, 1, 10, 0, 4, 0, 10],
  [1, 10, 2, 8, 7, 4],
  [4, 9, 1, 4, 1, 7, 7, 1, 3],
  [4, 9, 1, 4, 1, 7, 0, 8, 1, 8, 7, 1],
  [4, 0, 3, 7, 4, 3],
  [4, 8, 7],
  [9, 10, 8, 10, 11, 8],
  [3, 0, 9, 3, 9, 11, 11, 9, 10],
  [0, 1, 10, 0, 10, 8, 8, 10, 11],
  [3, 1, 10, 11, 3, 10],
  [1, 2, 11, 1, 11, 9, 9, 11, 8],
  [3, 0, 9, 3, 9, 11, 1, 2, 9, 2, 11, 9],
  [0, 2, 11, 8, 0, 11],
  [3, 2, 11],
  [2, 3, 8, 2, 8, 10, 10, 8, 9],
  [9, 10, 2, 0, 9, 2],
  [2, 3, 8, 2, 8, 10, 0, 1, 8, 1, 10, 8],
  [1, 10, 2],
  [1, 3, 8, 9, 1, 8],
  [0, 9, 1],
  [0, 3, 8],
  []
];

const indexlist = new Uint16Array(12);

// Lifted from https://stackoverflow.com/questions/43122082/efficiently-count-the-number-of-bits-in-an-integer-in-javascript/43122214
function bitCount (n) {
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return ((n + (n >> 4) & 0xF0F0F0F) * 0x1010101) >> 24;
}

function marchingCube(points, values, threshold, arrays) {
  let i, l;
  let cubeIndex = 0;

  var vertexOffset = arrays.vertexOffset;
  var indexOffset = arrays.indexOffset;

  const positions = arrays.position;
  const indices = arrays.index;

  // Determine the index into the edge table which tells us which vertices are
  // inside of the surface.
  if (values[0] < isolevel) cubeIndex |= 1;
  if (values[1] < isolevel) cubeIndex |= 2;
  if (values[2] < isolevel) cubeIndex |= 4;
  if (values[3] < isolevel) cubeIndex |= 8;
  if (values[4] < isolevel) cubeIndex |= 16;
  if (values[5] < isolevel) cubeIndex |= 32;
  if (values[6] < isolevel) cubeIndex |= 64;
  if (values[7] < isolevel) cubeIndex |= 128;

  const edges = edgeTable[cubeIndex];

  // Cube is entirely in/out of the surface
  if (edges === 0) {
    return true;
  }
  const vertCount = bitCount(edges);
  if (vertCount + vertexOffset >= arrays.maxVertices) {
    return false;
  }

  const tris = triTable[cubeIndex];
  // Not enough space in the index arrays for the triangles.
  if (tris.length + indexOffset >= arrays.index.length) {
    return false;
  }

  // Generate vertices where the surface intersects the cube
  if (edges & 1) {
    interpolate(positions, vertexOffset*3, threshold, points[0], points[1], values[0], values[1]);
    indexlist[0] = vertexOffset++;
  }
  if (edges & 2) {
    interpolate(positions, vertexOffset*3, threshold, points[1], points[2], values[1], values[2]);
    indexlist[1] = vertexOffset++;
  }
  if (edges & 4) {
    interpolate(positions, vertexOffset*3, threshold, points[2], points[3], values[2], values[3]);
    indexlist[2] = vertexOffset++;
  }
  if (edges & 8) {
    interpolate(positions, vertexOffset*3, threshold, points[3], points[0], values[3], values[0]);
    indexlist[3] = vertexOffset++;
  }
  if (edges & 16) {
    interpolate(positions, vertexOffset*3, threshold, points[4], points[5], values[4], values[5]);
    indexlist[4] = vertexOffset++;
  }
  if (edges & 32) {
    interpolate(positions, vertexOffset*3, threshold, points[5], points[6], values[5], values[6]);
    indexlist[5] = vertexOffset++;
  }
  if (edges & 64) {
    interpolate(positions, vertexOffset*3, threshold, points[7], points[6], values[7], values[6]);
    indexlist[6] = vertexOffset++;
  }
  if (edges & 128) {
    interpolate(positions, vertexOffset*3, threshold, points[7], points[4], values[7], values[4]);
    indexlist[7] = vertexOffset++;
  }
  if (edges & 256) {
    interpolate(positions, vertexOffset*3, threshold, points[0], points[4], values[0], values[4]);
    indexlist[8] = vertexOffset++;
  }
  if (edges & 512) {
    interpolate(positions, vertexOffset*3, threshold, points[1], points[5], values[1], values[5]);
    indexlist[9] = vertexOffset++;
  }
  if (edges & 1024) {
    interpolate(positions, vertexOffset*3, threshold, points[2], points[6], values[2], values[6]);
    indexlist[10] = vertexOffset++;
  }
  if (edges & 2048) {
    interpolate(positions, vertexOffset*3, threshold, points[3], points[7], values[3], values[7]);
    indexlist[11] = vertexOffset++;
  }

  /* Record the indices */
  for (i = 0, l = tris.length; i < l; ++i) {
    indices[indexOffset++] = indexlist[tris[i]];
  }

  arrays.vertexOffset = vertexOffset;
  arrays.indexOffset = indexOffset;

  return true;
}

function interpolate(out, offset, threshold, p1, p2, valp1, valp2) {
  if (Math.abs(threshold-valp2) < 0.0001) {
    out[offset] = p2[0];
    out[offset+1] = p2[1];
    out[offset+2] = p2[2];
    return;
  } else if (Math.abs(threshold-valp1) < 0.0001 || Math.abs(valp1-valp2) < 0.0001) {
    out[offset] = p1[0];
    out[offset+1] = p1[1];
    out[offset+2] = p1[2];
    return;
  } else {
    const mu = (threshold - valp1) / (valp2 - valp1);
    out[offset] = p1[0] + mu * (p2[0] - p1[0]);
    out[offset+1] = p1[1] + mu * (p2[1] - p1[1]);
    out[offset+2] = p1[2] + mu * (p2[2] - p1[2]);
  }
}

const DEFAULT_VOLUME = {
  xMin: -1,
  xMax: 1,
  xStep: 0.01,
  yMin: -1,
  yMax: 1,
  yStep: 0.01,
  zMin: -1,
  zMax: 1,
  zStep: 0.01,
};

export class Isosurface {
  constructor(surfaceVolume = {}) {
    this.volume = Object.assign({}, DEFAULT_VOLUME, surfaceVolume);
  }

  surfaceFunc(x, y, z) {
    // Just a dummy function
    return (x + y + z) / 3.0;
  }

  generateMesh(arrays, threshold = 0) {
    if (!arrays.position) {
      throw new Error('Must specify a positions array');
    }

    const maxVertices = Math.floor(arrays.positions.length / 3);

    let i, l;
    let idx0, idx1, idx2;

    let positions = [];
    let colors = [];
    let indices = [];
    let indexTable = {};

    const val = new Float32Array(8);
    const p0 = new Float32Array(3);
    const p1 = new Float32Array(3);
    const p2 = new Float32Array(3);
    const p3 = new Float32Array(3);
    const p4 = new Float32Array(3);
    const p5 = new Float32Array(3);
    const p6 = new Float32Array(3);
    const p7 = new Float32Array(3);

    let pt = [ p0, p1, p2, p3, p4, p5, p6, p7 ];

    let vertexCount = 0;

    // Iterate through the full volume and evaluate the isosurface at every
    // point, then generate the triangulated surface based on that.
    const vol = this.volume;
    for (let x = vol.xMin; x < vol.xMax; x += vol.xStep) {
      let xNext = x + vol.xStep;

      p0[0] = x;
      p1[0] = xNext;
      p2[0] = xNext;
      p3[0] = x;
      p4[0] = x;
      p5[0] = xNext;
      p6[0] = xNext;
      p7[0] = x;

      for (let y = vol.yMin; y < vol.yMax; y += vol.yStep) {
        let yNext = y + vol.yStep;

        p0[1] = y;
        p1[1] = y;
        p2[1] = yNext;
        p3[1] = yNext;
        p4[1] = y;
        p5[1] = y;
        p6[1] = yNext;
        p7[1] = yNext;

        // Setup the first set of Z values, since they're re-used
        p4[2] = vol.zMin;
        p5[2] = vol.zMin;
        p6[2] = vol.zMin;
        p7[2] = vol.zMin;

        // These are always on the edge, so they get clamped to 0
        // This prevents holes in the bottom of the world
        val[4] = this.surfaceFunc(p4[0], p4[1], p4[2]);
        val[5] = this.surfaceFunc(p5[0], p5[1], p5[2]);
        val[6] = this.surfaceFunc(p6[0], p6[1], p6[2]);
        val[7] = this.surfaceFunc(p7[0], p7[1], p7[2]);

        for (let z = vol.zMin; z < vol.zMax; z += vol.zStep) {
          let zNext = zy + vol.zStep;

          p0[2] = z;
          p1[2] = z;
          p2[2] = z;
          p3[2] = z;
          p4[2] = zNext;
          p5[2] = zNext;
          p6[2] = zNext;
          p7[2] = zNext;

          val[0] = val[4];
          val[1] = val[5];
          val[2] = val[6];
          val[3] = val[7];
          val[4] = this.surfaceFunc(p4[0], p4[1], p4[2]);
          val[5] = this.surfaceFunc(p5[0], p5[1], p5[2]);
          val[6] = this.surfaceFunc(p6[0], p6[1], p6[2]);
          val[7] = this.surfaceFunc(p7[0], p7[1], p7[2]);

          vertexCount += this.marchingCube(pt, val, threshold, indexlist, arrays, vertexCount, maxVertices);

          // If we hit this then our output arrays have run out of room and we'll simply have to
          // abort mid-triangulation. At least you'll get a partially computed surface out of it!
          if (vertexCount >= maxVertices) {
            return vertexCount;
          }
        }
      }
    }
    return vertexCount;
  }
}

function interp(isolevel, p1, p2, valp1, valp2, out, colors, colorFn) {
  var l = out.length;
  var index = l / 3;

  if (Math.abs(isolevel-valp2) < 0.0001) {
    out[l] = p2[0];
    out[l+1] = p2[1];
    out[l+2] = p2[2];
    colors.push(colorFn(out[l], out[l+1], out[l+2]));
    return index;
  }

  if (Math.abs(isolevel-valp1) < 0.0001 || Math.abs(valp1-valp2) < 0.0001) {
    out[l] = p1[0];
    out[l+1] = p1[1];
    out[l+2] = p1[2];
    colors.push(colorFn(out[l], out[l+1], out[l+2]));
    return index;
  }

  var mu = (isolevel - valp1) / (valp2 - valp1);

  out[l] = p1[0] + mu * (p2[0] - p1[0]);
  out[l+1] = p1[1] + mu * (p2[1] - p1[1]);
  out[l+2] = p1[2] + mu * (p2[2] - p1[2]);
  colors.push(colorFn(out[l], out[l+1], out[l+2]));
  return index;
}

function polygonise(pt, val, isolevel, indexlist, positions, colors, indices, indexTable, colorFn) {
  let i, l, k;
  let cubeindex = 0;
  let vertices = [];

  /*
    Determine the index into the edge table which
    tells us which vertices are inside of the surface
  */
  if (val[0] < isolevel) cubeindex |= 1;
  if (val[1] < isolevel) cubeindex |= 2;
  if (val[2] < isolevel) cubeindex |= 4;
  if (val[3] < isolevel) cubeindex |= 8;
  if (val[4] < isolevel) cubeindex |= 16;
  if (val[5] < isolevel) cubeindex |= 32;
  if (val[6] < isolevel) cubeindex |= 64;
  if (val[7] < isolevel) cubeindex |= 128;

  const edges = edgeTable[cubeindex];

  /* Cube is entirely in/out of the surface */
  if (edges === 0) {
    return false;
  }

  /* Find the vertices where the surface intersects the cube */
  if (edges & 1) {
    k = edgeKey(pt[0], 0);
    if(k in indexTable) {
      indexlist[0] = indexTable[k];
    } else {
      indexlist[0] = interp(isolevel,pt[0],pt[1],val[0],val[1],positions, colors, colorFn);
      indexTable[k] = indexlist[0];
    }
  }
  if (edges & 2) {
    k = edgeKey(pt[1], 1);
    if(k in indexTable) {
      indexlist[1] = indexTable[k];
    } else {
      indexlist[1] = interp(isolevel,pt[1],pt[2],val[1],val[2],positions, colors, colorFn);
      indexTable[k] = indexlist[1];
    }
  }
  if (edges & 4) {
    k = edgeKey(pt[3], 0);
    if(k in indexTable) {
      indexlist[2] = indexTable[k];
    } else {
      indexlist[2] = interp(isolevel,pt[2],pt[3],val[2],val[3],positions, colors, colorFn);
      indexTable[k] = indexlist[2];
    }
  }
  if (edges & 8) {
    k = edgeKey(pt[0], 1);
    if(k in indexTable) {
      indexlist[3] = indexTable[k];
    } else {
      indexlist[3] = interp(isolevel,pt[3],pt[0],val[3],val[0],positions, colors, colorFn);
      indexTable[k] = indexlist[3];
    }
  }
  if (edges & 16) {
    k = edgeKey(pt[4], 0);
    if(k in indexTable) {
      indexlist[4] = indexTable[k];
    } else {
      indexlist[4] = interp(isolevel,pt[4],pt[5],val[4],val[5],positions, colors, colorFn);
      indexTable[k] = indexlist[4];
    }
  }
  if (edges & 32) {
    k = edgeKey(pt[5], 1);
    if(k in indexTable) {
      indexlist[5] = indexTable[k];
    } else {
      indexlist[5] = interp(isolevel,pt[5],pt[6],val[5],val[6],positions, colors, colorFn);
      indexTable[k] = indexlist[5];
    }
  }
  if (edges & 64) {
    k = edgeKey(pt[7], 0);
    if(k in indexTable) {
      indexlist[6] = indexTable[k];
    } else {
      indexlist[6] = interp(isolevel,pt[7],pt[6],val[7],val[6],positions, colors, colorFn);
      indexTable[k] = indexlist[6];
    }
  }
  if (edges & 128) {
    k = edgeKey(pt[4], 1);
    if(k in indexTable) {
      indexlist[7] = indexTable[k];
    } else {
      indexlist[7] = interp(isolevel,pt[7],pt[4],val[7],val[4],positions, colors, colorFn);
      indexTable[k] = indexlist[7];
    }
  }
  if (edges & 256) {
    k = edgeKey(pt[0], 2);
    if(k in indexTable) {
      indexlist[8] = indexTable[k];
    } else {
      indexlist[8] = interp(isolevel,pt[0],pt[4],val[0],val[4],positions, colors, colorFn);
      indexTable[k] = indexlist[8];
    }
  }
  if (edges & 512) {
    k = edgeKey(pt[1], 2);
    if(k in indexTable) {
      indexlist[9] = indexTable[k];
    } else {
      indexlist[9] = interp(isolevel,pt[1],pt[5],val[1],val[5],positions, colors, colorFn);
      indexTable[k] = indexlist[9];
    }
  }
  if (edges & 1024) {
    k = edgeKey(pt[2], 2);
    if(k in indexTable) {
      indexlist[10] = indexTable[k];
    } else {
      indexlist[10] = interp(isolevel,pt[2],pt[6],val[2],val[6],positions, colors, colorFn);
      indexTable[k] = indexlist[10];
    }
  }
  if (edges & 2048) {
    k = edgeKey(pt[3], 2);
    if(k in indexTable) {
      indexlist[11] = indexTable[k];
    } else {
      indexlist[11] = interp(isolevel,pt[3],pt[7],val[3],val[7],positions, colors, colorFn);
      indexTable[k] = indexlist[11];
    }
  }

  /* Create the triangle */
  for (i = 0, l = triTable[cubeindex].length; i < l; i += 3) {
    indices.push(
      indexlist[triTable[cubeindex][i+0]],
      indexlist[triTable[cubeindex][i+2]],
      indexlist[triTable[cubeindex][i+1]]
    );
  }
  return triTable[cubeindex].length;
}

function compute(xmin, ymin, zmin, xmax, ymax, zmax, fn, colorFn, isolevel = 0.0) {
  let i, l;
  let idx0, idx1, idx2;

  let positions = [];
  let colors = [];
  let indices = [];
  let indexTable = {};

  let val = new Float32Array(8);
  let p0 = new Float32Array(3);
  let p1 = new Float32Array(3);
  let p2 = new Float32Array(3);
  let p3 = new Float32Array(3);
  let p4 = new Float32Array(3);
  let p5 = new Float32Array(3);
  let p6 = new Float32Array(3);
  let p7 = new Float32Array(3);

  let pt = [ p0, p1, p2, p3, p4, p5, p6, p7 ];

  let indexlist = new Uint16Array(12);

  let vertCount;
  let xcur, ycur, zcur;
  let xnext, ynext, znext;
  for (xcur = xmin; xcur < xmax; ++xcur) {
    xnext = xcur + 1;

    p0[0] = xcur;
    p1[0] = xnext;
    p2[0] = xnext;
    p3[0] = xcur;
    p4[0] = xcur;
    p5[0] = xnext;
    p6[0] = xnext;
    p7[0] = xcur;

    for (ycur = ymin; ycur < ymax; ++ycur) {
      ynext = ycur + 1;

      p0[1] = ycur;
      p1[1] = ycur;
      p2[1] = ynext;
      p3[1] = ynext;
      p4[1] = ycur;
      p5[1] = ycur;
      p6[1] = ynext;
      p7[1] = ynext;

      // Setup the first set of Z values, since they're re-used
      p4[2] = zmin;
      p5[2] = zmin;
      p6[2] = zmin;
      p7[2] = zmin;

      // These are always on the edge, so they get clamped to 0
      // This prevents holes in the bottom of the world
      val[4] = fn(p4[0], p4[1], p4[2]);
      val[5] = fn(p5[0], p5[1], p5[2]);
      val[6] = fn(p6[0], p6[1], p6[2]);
      val[7] = fn(p7[0], p7[1], p7[2]);

      for (zcur = zmin; zcur < zmax; ++zcur) {
        znext = zcur + 1;

        p0[2] = zcur;
        p1[2] = zcur;
        p2[2] = zcur;
        p3[2] = zcur;
        p4[2] = znext;
        p5[2] = znext;
        p6[2] = znext;
        p7[2] = znext;

        val[0] = val[4];
        val[1] = val[5];
        val[2] = val[6];
        val[3] = val[7];
        val[4] = fn(p4[0], p4[1], p4[2]);
        val[5] = fn(p5[0], p5[1], p5[2]);
        val[6] = fn(p6[0], p6[1], p6[2]);
        val[7] = fn(p7[0], p7[1], p7[2]);

        // If we're on the top edge force the value to 0 if it's less.
        // This prevents holes in the top of mountains
        if(znext == zmax) {
          val[4] = Math.max(isolevel, val[4]);
          val[5] = Math.max(isolevel, val[5]);
          val[6] = Math.max(isolevel, val[6]);
          val[7] = Math.max(isolevel, val[7]);
        }

        vertCount = polygonise(pt, val, isolevel, indexlist, positions, colors, indices, indexTable, colorFn);
        if (vertCount) {
          for(i = indices.length - vertCount, l = indices.length; i < l; i += 3) {
            idx0 = indices[i] * 3;
            idx1 = indices[i+1] * 3;
            idx2 = indices[i+2] * 3;
          }
        }
      }
    }
  }

  return {positions: positions, colors: colors, indices: indices};
}

// Everything below this is worker communication

// Using CMWCRand for consistent values between runs (it's seedable);
var rand = new CMWCRand(1);
var noise = new SimplexNoise(rand);

function isoFunc(x, y, z) {
  return noise.noise3d(x, y, z);
}

function lerpColors(color1, color2, lerp) {
  var r1 = (color1 >> 24) & 0xFF;
  var g1 = (color1 >> 16) & 0xFF;
  var b1 = (color1 >> 8) & 0xFF;
  var a1 = (color1) & 0xFF;

  var r2 = (color2 >> 24) & 0xFF;
  var g2 = (color2 >> 16) & 0xFF;
  var b2 = (color2 >> 8) & 0xFF;
  var a2 = (color2) & 0xFF;

  var ro = Math.max(0, Math.min(255, Math.floor(r1 + lerp * (r2 - r1))));
  var go = Math.max(0, Math.min(255, Math.floor(g1 + lerp * (g2 - g1))));
  var bo = Math.max(0, Math.min(255, Math.floor(b1 + lerp * (b2 - b1))));
  var ao = Math.max(0, Math.min(255, Math.floor(a1 + lerp * (a2 - a1))));

  return (ro << 24) + (go << 16) + (bo << 8) + (ao);
}

function colorFunc(x, y, z) {
  if(z > 0) {
    return lerpColors(0xFF008800, 0xFFCCDDEE, z/32);
  } else {
    return lerpColors(0xFF004400, 0xFF008800, (z+32)/32);
  }
}

root.buildIsosurface = function (xmin, ymin, zmin, xmax, ymax, zmax, isolevel) {
  return compute(xmin, ymin, zmin, xmax, ymax, zmax, isoFunc, colorFunc, isolevel);
};

function updateAlgorithm(src, id) {
  var funcSrc = "(function() { \n" + src + "\n })()";
  try {
    var func = eval(funcSrc);
    isoFunc = func.isosurface;
    colorFunc = func.color;
    postMessage({id: id, type: "algorithm"});
  } catch(ex) {
    postMessage({id: id, type: "algorithm", err: ex.toString()});
  }
}

onmessage = function(msg) {
  var out;
  switch(msg.data.type) {
    case "build":
      out = compute(msg.data.xmin, msg.data.ymin, msg.data.zmin, msg.data.xmax, msg.data.ymax, msg.data.zmax, isoFunc, colorFunc, msg.data.isolevel);
      out.id = msg.data.id;
      out.type = "build";
      postMessage(out);
      break;
    case "algorithim":
      updateAlgorithm(msg.data.src, msg.data.id);
  }
};
