# Derived inspection quadruped geometry

This directory contains a modified visual derivative of the Unitree Go2 model in Google DeepMind MuJoCo Menagerie, pinned to commit `71f066ad0be9cd271f7ed58c030243ef157af9f4`.

- `mesh-data.js` exports `MESH_DATA` (16 indexed meshes) and `RIG` (the original visual hierarchy, 12 joints and home pose). Buffers use Base64-encoded little-endian Float32 positions/normals and Uint32 indices. No runtime network fetch is required.
- `LICENSE` preserves the complete upstream BSD-3-Clause license. The same text is included in the JavaScript header for redistribution.
- `DERIVATION.json` records source hashes, the frozen data hash, mesh conversion details, final runtime modifications, runtime file hashes and the compact validation result. Paths in `runtimeFiles` are relative to this directory.

Original upstream OBJ/MJCF hashes are retained in `DERIVATION.json`; source files can be retrieved from the pinned repository commit and are not shipped in the production package. Complete torso/head branding regions were reconstructed as continuous fitted surfaces with analytic normals and blended borders. The original text-only mesh was merged into the main shell, then a complete rectangular side cover was assigned to `base_3` so exploded views show a generic panel. Only triangles crossed by the panel boundary were split. These changes are already baked into the data module.

The current runtime refinements do not change `mesh-data.js`. Its SHA-256 remains `7ad2fb100188a173c7c16d3aa918480bc529f5e1763dc03e2a607c77ce8fe8e9` (9,269,354 bytes).

## Final runtime modifications

The following operations are applied to independent mesh instances by [concept-model.js](../../concept-model.js) and [concept-platform.js](../../concept-platform.js):

1. `base_3` and `base_4` share the same local-Y side shaping, with a 6 mm displacement limit, a longer central flat region, smoothly rounded upper/lower bevel transitions and blended normals. The matching side-cover boundary remains coincident.
2. Only the outer shoulder covers (`side*y > -30 mm`) receive soft six-direction edge shaping. Ellipse-normalized coordinates use the X/Z outline centre (-2.2445, 16.6105) mm and semiaxes 46.1485 / 33.9665 mm to calculate angular weights; there is no hard projection onto an ellipse. X/Z displacement is limited to 3 mm. Front-facing convex points (`side*normal.y > 0.65`, `side*y > 8 mm`) are smoothly flattened inward toward outward Y=15.6 mm by at most 1 mm. Inner motor-disc positions and rig transforms stay fixed. `side` is +1 for thigh meshes and -1 for mirrored meshes.
3. `thigh_0` and `thigh_mirror_0` use a white shell with the original silver-gray inner shoulder ring. Two material groups reorder existing triangle indices without changing their triangles or surface coordinates.
4. Four dark-blue service seams follow the actual upper-leg surfaces. Each tapered ribbon is at most 1.3 mm wide and spans 93 mm along local Z, from -55 to -148 mm, at X=-10 mm. Ray fitting is followed by a 0.18 mm outward local-Y offset. The seams use the original thigh part roots and IDs, so pose, explode, focus, dimension variants and reset act on the shell and seam together.
5. Two dark-blue front optical details are attached to `base_2`, each using two concentric discs (four added meshes in total). They retain the original `base.base_2` parent and part ID.
6. The adjacent white visible-light/thermal half-shells each measure 52 x 37 x 50 mm. Together they form a continuous 52 x 37 x 100 mm housing, with a matching 2.5 mm rounded XY perimeter. Existing sensor anchors and part IDs remain in place.
7. The runtime adds the conceptual inspection tray, standoffs, finned compute box, mounts, optics and sensor configurations separately from the licensed source meshes.

| Runtime file | Bytes | SHA-256 |
| --- | ---: | --- |
| `concept-model.js` | 16556 | `6825c00e9a77c386b4a580162376cad8e968f4188ca69f65b697317390de4282` |
| `concept-platform.js` | 29504 | `f3aa4aee3e4f7c9b51f5510522f77cc4e27103a7ae08a55342942b83342ff12a` |

The compact runtime audit passed 56 checks with zero fetch calls. It covered the 33 original body part IDs, 12 actuated joints, 54 catalog entries, surface-fitting and material groups, coincident body-panel boundaries, camera-shell continuity, four static poses, walking samples, and essential variant/explode/focus/export/disposal behavior. The integrating agent also reviewed assembled and fully exploded browser views.

## Attribution and scope

This remains derived third-party geometry, not wholly self-authored geometry. Preserve the upstream notice, conditions and disclaimer with redistributed or converted outputs. Do not imply endorsement by Unitree Robotics, Google DeepMind or their contributors.

Dimensions, masses and joints originate from a published simulation model. Added inspection hardware, materials and local surface changes are concept modifications and do not establish physical performance, production tolerances or manufacturing validity.
