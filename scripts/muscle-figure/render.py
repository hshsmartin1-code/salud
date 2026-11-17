"""Blender (headless) renders of BodyParts3D for the Salud muscle figure.

Usage:
  blender -b -P scripts/muscle-figure/render.py -- <mapping.json> <obj dir> <out dir> [height_px] [samples]

Scene: every mapped muscle (app id or neutral), the skeleton and a few connective-tissue sheets (linea alba,
iliotibial tract, calcaneal tendon, costal cartilages, discs), and the body surface (skin) CROPPED to the head,
hands and feet (faces outside those regions are deleted; no vertex is moved). The skin therefore covers the
facial muscles, the open neck tube and the loose finger/toe tendons, and gives solid hands and feet.

Writes per view (front, back) into <out dir>:
  id_<view>.png      flat colour per app muscle id + side (no anti-aliasing, raw colours); everything else black
  part_<view>.png    flat colour per anatomical part + side
  kind_<view>.png    flat colour per kind: muscle red, neutral muscle green, bone/tissue blue, skin white
  deep_back.png      flat id colours of the rhomboids alone (their footprint under the trapezius)
  shaded_<view>.png  Cycles clay render of the whole scene (transparent background, AO in the grooves)
  skinfull_<view>.png Cycles render of the uncropped body surface (only used where the dataset has no mesh)
  palette.json       colour -> id / part, camera framing
Deterministic: fixed seeds, sorted inputs, no randomness.
"""
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
MAPPING, OBJ_DIR, OUT = Path(argv[0]), Path(argv[1]), Path(argv[2])
HEIGHT = int(argv[3]) if len(argv) > 3 else 1600
SAMPLES = int(argv[4]) if len(argv) > 4 else 64
PASSES = set((argv[5] if len(argv) > 5 else "id,part,kind,deep,shaded").split(","))
OUT.mkdir(parents=True, exist_ok=True)
mapping = json.loads(MAPPING.read_text(encoding="utf-8"))
elements = mapping["elements"]

# Grey levels of the clay (linear base colour) and the strength of the occlusion terms per kind.
TONE = {"muscle": 0.50, "neutral": 0.50, "bone": 0.68, "tissue": 0.62, "skin": 0.62, "eye": 0.62}
CAVITY = {"muscle": 0.80, "neutral": 0.80, "bone": 0.45, "tissue": 0.45, "skin": 0.35, "eye": 0.35}  # small-radius AO (grooves)
FORM_AO = {"muscle": 0.45, "neutral": 0.45, "bone": 0.30, "tissue": 0.30, "skin": 0.25, "eye": 0.25}  # large-radius AO (volume)

# ───────────── scene ─────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def import_obj(path: Path):
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=str(path), forward_axis="Y", up_axis="Z")
    return [o for o in bpy.data.objects if o not in before]


objs = {}  # element -> object
for el in sorted(elements):
    f = OBJ_DIR / f"{el}.obj"
    if not f.exists():
        print("missing obj", el)
        continue
    new = import_obj(f)
    if not new:
        continue
    if len(new) > 1:
        bpy.ops.object.select_all(action="DESELECT")
        for o in new:
            o.select_set(True)
        bpy.context.view_layer.objects.active = new[0]
        bpy.ops.object.join()
    o = new[0]
    o.name = el
    objs[el] = o
print("imported", len(objs))


def bbox(names):
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    for el in names:
        o = objs[el]
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mins = Vector(map(min, mins, w))
            maxs = Vector(map(max, maxs, w))
    return mins, maxs


def els(pred):
    return [el for el in objs if pred(elements[el])]


# ───────────── crop the body surface to head, hands and feet ─────────────
import re  # noqa: E402

skin_el = els(lambda e: e["kind"] == "skin")[0]
skin_full = objs[skin_el].copy()
skin_full.data = objs[skin_el].data.copy()
skin_full.name = "skin_full"
scene.collection.objects.link(skin_full)

HAND = r"scaphoid|lunate|triquetral|pisiform|trapezium|trapezoid|capitate|hamate|metacarpal|finger|thumb"
CARPAL = r"scaphoid|lunate|triquetral|pisiform|trapezium|trapezoid|capitate|hamate"
FOOT = r"talus|calcaneus$|cuboid|navicular|cuneiform|metatarsal|toe|sesamoid"
regions = []  # (min, max) boxes in world coordinates, skin faces whose centre lies inside one are kept
for side in ("left", "right"):
    hand = els(lambda e, s=side: e["kind"] == "bone" and e.get("side") == s and re.search(HAND, e["part"]))
    carp = els(lambda e, s=side: e["kind"] == "bone" and e.get("side") == s and re.search(CARPAL, e["part"]))
    lo, hi = bbox(hand)
    wrist = bbox(carp)[1].z + 12
    regions.append((Vector((lo.x - 30, lo.y - 30, -1e9)), Vector((hi.x + 30, hi.y + 30, wrist))))
    foot = els(lambda e, s=side: e["kind"] == "bone" and e.get("side") == s and re.search(FOOT, e["part"]))
    talus = els(lambda e, s=side: e["kind"] == "bone" and e.get("side") == s and "talus" in e["part"])
    lo, hi = bbox(foot)
    ankle = bbox(talus)[1].z + 18
    regions.append((Vector((lo.x - 40, lo.y - 40, -1e9)), Vector((hi.x + 40, hi.y + 40, ankle))))
chin = bbox(els(lambda e: e["part"] == "mandible"))[0].z - 4
regions.append((Vector((-1e9, -1e9, chin)), Vector((1e9, 1e9, 1e9))))

skin = objs[skin_el]
bm = bmesh.new()
bm.from_mesh(skin.data)
mw = skin.matrix_world
# Clean straight cuts: split the faces along the chin, wrist and ankle planes first (no vertex moves).
for z in sorted({round(chin, 3)} | {round(hi.z, 3) for lo, hi in regions if hi.z < 1e8}):
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=mw.inverted() @ Vector((0, 0, z)), plane_no=(0, 0, 1))
drop = []
for f in bm.faces:
    c = mw @ f.calc_center_median()
    if not any(lo.x <= c.x <= hi.x and lo.y <= c.y <= hi.y and lo.z <= c.z <= hi.z for lo, hi in regions):
        drop.append(f)
bmesh.ops.delete(bm, geom=drop, context="FACES")
bm.to_mesh(skin.data)
bm.free()
print("skin faces kept", len(skin.data.polygons), "chin z", round(chin))

# Mandible only served as a landmark (it is inside the head skin anyway).
# ───────────── framing ─────────────
mins, maxs = bbox(list(objs))
ext = maxs - mins
up = 2
assert max(range(3), key=lambda i: ext[i]) == up, "expected a Z-up dataset"


def centroid(pred):
    pts = []
    for el, o in objs.items():
        if pred(elements[el]):
            pts.append(o.matrix_world @ (sum((Vector(c) for c in o.bound_box), Vector()) / 8))
    return sum(pts, Vector()) / max(1, len(pts))


front_c = centroid(lambda e: e.get("muscle") in ("chest", "abdominals", "quadriceps"))
back_c = centroid(lambda e: e.get("muscle") in ("glutes", "lower back", "hamstrings"))
depth = max((0, 1), key=lambda i: abs(front_c[i] - back_c[i]))
lateral = 1 - depth
front_sign = 1 if front_c[depth] > back_c[depth] else -1
center = (mins + maxs) / 2
print("axes depth/lateral", depth, lateral, "front sign", front_sign, "extent", tuple(round(v) for v in ext))

MARGIN = 0.03
ortho = ext[up] * (1 + 2 * MARGIN)
aspect = (ext[lateral] + 2 * MARGIN * ext[up]) / ortho
scene.render.resolution_y = HEIGHT
scene.render.resolution_x = int(round(HEIGHT * aspect / 2) * 2)
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "8"


def make_camera(view: str):
    cam_data = bpy.data.cameras.new(view)
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho  # applies to the larger side: height here
    cam = bpy.data.objects.new(view, cam_data)
    scene.collection.objects.link(cam)
    pos = center.copy()
    sign = front_sign if view == "front" else -front_sign
    pos[depth] = center[depth] + sign * ext[depth] * 3
    cam.location = pos
    look_positive = sign < 0
    if depth == 1:
        cam.rotation_euler = (math.pi / 2, 0, 0 if look_positive else math.pi)
    else:
        cam.rotation_euler = (math.pi / 2, 0, -math.pi / 2 if look_positive else math.pi / 2)
    cam_data.clip_end = ext[depth] * 10
    return cam


cams = {v: make_camera(v) for v in ("front", "back")}


def image_left(view):
    """World lateral direction that appears on the left of the image in this view."""
    cam = cams[view]
    right = cam.matrix_world.to_3x3() @ Vector((1, 0, 0))
    return -1 if right[lateral] > 0 else 1


# ───────────── palettes ─────────────
muscle_keys = sorted({(e["muscle"], e["side"] or "mid") for e in elements.values() if e["kind"] == "muscle"})
part_keys = sorted({(e["muscle"], e["part"], e["side"] or "mid") for e in elements.values() if e["kind"] == "muscle"})
KIND_COLOUR = {"muscle": (220, 60, 60), "neutral": (60, 220, 60), "bone": (60, 60, 220), "tissue": (60, 60, 220),
               "skin": (220, 220, 220), "eye": (220, 220, 220)}


def code_colour(i: int):
    """Distinct 8-bit sRGB colour for index i (1-based); 0 is black (neutral)."""
    return ((i * 53) % 230 + 20, (i * 97) % 230 + 20, (i * 31) % 200 + 40)


def srgb_to_linear(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


palette = {
    "id": {",".join(map(str, code_colour(i + 1))): {"muscle": m, "side": s} for i, (m, s) in enumerate(muscle_keys)},
    "part": {",".join(map(str, code_colour(i + 1))): {"muscle": m, "part": p, "side": s} for i, (m, p, s) in enumerate(part_keys)},
    "kind": {",".join(map(str, v)): k for k, v in KIND_COLOUR.items() if k not in ("tissue", "eye")},
}


def flat_pass(kind: str):
    """Workbench, flat lighting, object colour, no AA: every pixel is exactly one id."""
    scene.render.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    sh.light = "FLAT"
    sh.color_type = "OBJECT"
    sh.show_shadows = False
    sh.show_cavity = False
    sh.show_object_outline = False
    sh.show_specular_highlight = False
    sh.show_backface_culling = False
    scene.display.render_aa = "OFF"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    keys = muscle_keys if kind == "id" else part_keys
    index = {k: i + 1 for i, k in enumerate(keys)}
    skin_full.hide_render = True
    for el, o in objs.items():
        e = elements[el]
        o.hide_render = False
        if kind == "kind":
            rgb = KIND_COLOUR[e["kind"]]
        elif e["kind"] != "muscle":
            rgb = (0, 0, 0)
        else:
            k = (e["muscle"], e["side"] or "mid") if kind == "id" else (e["muscle"], e["part"], e["side"] or "mid")
            rgb = code_colour(index[k])
        o.color = (*[srgb_to_linear(v) for v in rgb], 1)


def clay_material(name, kind):
    """Principled clay; base colour darkened by a small-radius AO (cavity: grooves between muscles read as
    dark lines) and a large-radius AO (form)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 0.6 if kind != "bone" else 0.7
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.25

    def ao_term(distance, strength):
        ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
        ao.samples = 16
        ao.inputs["Distance"].default_value = distance
        inv = nt.nodes.new("ShaderNodeMath")
        inv.operation = "SUBTRACT"
        inv.inputs[0].default_value = 1.0
        nt.links.new(ao.outputs["AO"], inv.inputs[1])
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        mul.inputs[1].default_value = strength
        nt.links.new(inv.outputs[0], mul.inputs[0])
        one = nt.nodes.new("ShaderNodeMath")
        one.operation = "SUBTRACT"
        one.inputs[0].default_value = 1.0
        nt.links.new(mul.outputs[0], one.inputs[1])
        return one

    cav = ao_term(9.0, CAVITY[kind])  # ~9 mm: the grooves between neighbouring muscles
    form = ao_term(60.0, FORM_AO[kind])  # ~6 cm: armpits, between the legs, under the chest
    a = nt.nodes.new("ShaderNodeMath")
    a.operation = "MULTIPLY"
    nt.links.new(cav.outputs[0], a.inputs[0])
    nt.links.new(form.outputs[0], a.inputs[1])
    b = nt.nodes.new("ShaderNodeMath")
    b.operation = "MULTIPLY"
    b.inputs[1].default_value = TONE[kind]
    nt.links.new(a.outputs[0], b.inputs[0])
    nt.links.new(b.outputs[0], bsdf.inputs["Base Color"])
    return m


def shaded_setup():
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = SAMPLES
    scene.cycles.seed = 1
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 3
    scene.render.filter_size = 1.2
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    world = bpy.data.worlds.new("w")
    scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (1, 1, 1, 1)
    bg.inputs["Strength"].default_value = 0.14

    def area(name, offset, power, size):
        d = bpy.data.lights.new(name, "AREA")
        d.energy = power
        d.size = size
        o = bpy.data.objects.new(name, d)
        scene.collection.objects.link(o)
        p = center.copy()
        for axis, v in offset.items():
            p[axis] += v
        o.location = p
        o.rotation_mode = "QUATERNION"
        o.rotation_quaternion = (center - p).to_track_quat("-Z", "Y")
        return o

    H = ext[up]
    k = (H / 1700) ** 2
    L = {}
    for view in ("front", "back"):
        s = front_sign if view == "front" else -front_sign
        left = image_left(view)
        L[view] = [
            # Key: upper front-left of the image, soft.
            area(f"key_{view}", {depth: s * H * 1.1, lateral: left * H * 0.75, up: H * 0.75}, 9.0e6 * k, H * 0.55),
            # Fill: front right, lower and weaker.
            area(f"fill_{view}", {depth: s * H * 1.3, lateral: -left * H * 0.8, up: H * 0.05}, 1.3e6 * k, H * 1.0),
            # Rim from behind-above: separates the silhouette edge.
            area(f"rim_{view}", {depth: -s * H * 0.9, lateral: -left * H * 0.3, up: H * 0.9}, 1.6e6 * k, H * 0.6),
        ]
    return L


def render(path: Path, cam):
    scene.camera = cam
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


for kind in ("id", "part", "kind"):
    if kind not in PASSES:
        continue
    flat_pass(kind)
    for view, cam in cams.items():
        render(OUT / f"{kind}_{view}.png", cam)

if "deep" in PASSES:
    # Footprint of the rhomboids (middle back) alone, from the back: they lie under the trapezius, so the
    # visible id map barely shows them. Same flat id colours, every other object hidden.
    flat_pass("id")
    for el, o in objs.items():
        o.hide_render = elements[el].get("muscle") != "middle back"
    render(OUT / "deep_back.png", cams["back"])
    for o in objs.values():
        o.hide_render = False

if "shaded" not in PASSES:
    print("done")
    sys.exit(0)
lights = shaded_setup()
mats = {k: clay_material(k, k) for k in TONE}
for o in list(objs.values()) + [skin_full]:
    kind = "skin" if o is skin_full else elements[o.name]["kind"]
    o.data.materials.clear()
    o.data.materials.append(mats[kind])
    for p in o.data.polygons:
        p.use_smooth = True
for layer in ("shaded", "skinfull"):
    for el, o in objs.items():
        o.hide_render = layer == "skinfull"
    skin_full.hide_render = layer != "skinfull"
    for view, cam in cams.items():
        for v, ls in lights.items():
            for li in ls:
                li.hide_render = v != view
        render(OUT / f"{layer}_{view}.png", cam)

palette["frame"] = {"ortho_mm": ortho, "width": scene.render.resolution_x, "height": scene.render.resolution_y,
                    "chin_z_mm": chin, "min_z_mm": mins.z, "max_z_mm": maxs.z}
(OUT / "palette.json").write_text(json.dumps(palette, indent=1), encoding="utf-8")
print("done")
