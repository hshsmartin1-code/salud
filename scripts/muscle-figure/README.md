# Muscle figure generator (BodyParts3D → Blender → SVG paths + WebP)

Generates `src/features/training/muscleFigure.data.ts` and `public/muscle-figure/{front,back}.webp`.
The raw data and intermediate renders stay outside the repository (`assets-src/bodyparts3d/`).

Source: BodyParts3D 4.0, isa tree, OBJ files with 99 % polygon reduction (`isa_BP3D_4.0_obj_99.zip`) plus the
official text lists. Licence CC BY 4.0. Attribution, which must be reproduced exactly:
"BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International".
The OBJ file headers still carry the older release notice (CC BY-SA 2.1 JP). The licence page of 2025-02-25
(`assets-src/bodyparts3d/license-page-2026-11-15.html` and `README_e.html`) supersedes it with CC BY 4.0.

## Steps (deterministic, re-runnable)

```sh
A=../assets-src/bodyparts3d     # data folder (lists, zip, obj/, renders)
unzip -q -o -j "$A/isa_BP3D_4.0_obj_99.zip" '*.obj' -d "$A/obj"
python scripts/muscle-figure/build_mapping.py "$A" "$A/obj"            # -> scripts/muscle-figure/mapping.json
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P scripts/muscle-figure/render.py -- \
  scripts/muscle-figure/mapping.json "$A/obj" "$A/render" 1600 48      # id, part, kind, shaded and skin renders
python scripts/muscle-figure/trace.py "$A/render" .                     # data module + WebP (needs ffmpeg)
```

- `build_mapping.py` classifies every element by the most specific name available: the OBJ header's
  English name first, then the smallest concept that contains the element in the isa and part-of lists.
  Kinds: one of the 17 app muscle ids; "neutral" (a muscle with no app id, imported so it hides what lies
  behind it); "bone" (skeleton without the skull and facial bones; the mandible is only a landmark);
  "tissue" (linea alba, iliotibial tract, calcaneal tendon, costal cartilages, intervertebral discs, wrist
  retinaculum, long plantar ligament); "eye" (sclera and cornea, closing the eye openings of the skin);
  "skin". External genitalia are never imported.
- `render.py`: crops the skin to the head (above the chin), the hands (below the wrist) and the feet (below
  the ankle) by deleting faces (no vertex is moved), so hands and feet are solid and the neck/face muscles
  are covered. Workbench flat passes with no anti-aliasing (id map, part map, kind map), then one Cycles
  clay pass of the whole scene: key light from the upper front-left, weak fill, rim, low ambient, and two
  ambient-occlusion terms in every material (about 9 mm for the grooves between muscles, about 6 cm for
  volume). Bone, tissue and skin use a lighter, lower-contrast grey than muscle. A second pass renders the
  uncropped skin (only used for the synthesised latissimus). Two orthographic cameras, exactly front and
  exactly back, same scale, 3 % margin around everything (fingertips and feet included).
- `trace.py`: decodes the flat colours, drops id structures thinner than about 5 px, traces pixel-edge
  boundaries, simplifies them (Douglas-Peucker plus one Chaikin pass), and writes even-odd paths per id and
  side and the silhouette. Hairlines between parts are available (`HAIRLINES`) but off: the occlusion
  grooves of the base already separate the parts. The base is the Cycles render, levels + S-curve, face
  softened, downscaled to 720 px height (2x a 360 px display) and encoded as WebP with alpha. Same camera
  as the id map, so the vector regions are pixel-aligned with the base.
- Synthesised region: the dataset has no latissimus dorsi. Inside a proportional box of the back trunk,
  pixels that show ribs, deep (neutral) muscles or the serratus anterior become `lats`; the spine strip
  stays visible. The base shows the uncropped skin there, darkened to muscle tone. The dataset has no
  rectus abdominis either, but its external oblique element includes the aponeurosis over the whole
  anterior abdominal wall, so the front needs no synthesis.
