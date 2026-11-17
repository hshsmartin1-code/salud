"""Build mapping.json: BodyParts3D element files -> app muscle id + side + anatomical part.

Usage: python scripts/muscle-figure/build_mapping.py <bodyparts3d dir> [<obj dir>]
Reads isa_parts_list_e.txt, isa_element_parts.txt and partof_element_parts.txt (BodyParts3D 4.0) and,
when <obj dir> is given, the "English name" line of every OBJ header (the element lists can be
truncated; the header name of an element is the most specific name available).
Deterministic: output sorted. Writes scripts/muscle-figure/mapping.json next to this file.
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

SRC = Path(sys.argv[1])
OUT = Path(__file__).with_name("mapping.json")

# Ordered rules: first match on the most specific concept name wins. (regex, app muscle id)
RULES = [
    (r"pectoralis major", "chest"),
    (r"deltoid(?! branch)", "shoulders"),
    (r"infraspinatus|teres minor|supraspinatus", "shoulders"),
    (r"trapezius", "traps"),
    (r"latissimus dorsi|teres major", "lats"),
    (r"rhomboid", "middle back"),
    (r"iliocostalis|longissimus|spinalis(?! capitis)|erector spinae|quadratus lumborum|multifidus", "lower back"),
    (r"sternocleidomastoid|splenius|levator scapulae|scalenus|scalene", "neck"),
    (r"biceps brachii|brachialis|coracobrachialis", "biceps"),
    (r"triceps brachii|anconeus", "triceps"),
    (r"brachioradialis|flexor carpi|extensor carpi|palmaris longus|pronator teres|flexor digitorum superficialis|"
     r"flexor digitorum profundus|flexor pollicis longus|extensor digitorum(?! longus| brevis)|extensor digiti minimi|"
     r"abductor pollicis longus|extensor pollicis|extensor indicis|supinator", "forearms"),
    (r"rectus abdominis|external oblique|internal oblique|transversus abdominis|pyramidalis|serratus anterior", "abdominals"),
    (r"rectus femoris|vastus (lateralis|medialis|intermedius)", "quadriceps"),
    (r"biceps femoris|semitendinosus|semimembranosus", "hamstrings"),
    (r"gastrocnemius|soleus|tibialis anterior|fibularis|peroneus|extensor digitorum longus|extensor hallucis longus|plantaris", "calves"),
    (r"adductor (longus|brevis|magnus|minimus)|gracilis|pectineus", "adductors"),
    (r"gluteus medius|gluteus minimus|tensor fasciae latae", "abductors"),
    (r"gluteus maximus", "glutes"),
]
# Body surface (rendered as its own layer behind the muscles).
BODY_RULES = [r"^skin$"]
# Muscles with no app id that are imported so they occlude correctly and appear in the shaded base
# (neutral: never coloured, never tappable).
NEUTRAL_RULES = r"sartorius|iliacus|psoas major|pectoralis minor|subscapularis|tibialis posterior|flexor digitorum longus|"     r"flexor hallucis longus|popliteus|serratus posterior|piriformis|obturator internus|gemellus|quadratus femoris|"     r"sternohyoid|sternothyroid|thyrohyoid(?! membrane)|omohyoid|digastric|mylohyoid"
EXCLUDE = r"penis|scrot|testis|spermatic|prepuce|glans"
# Skeleton and connective tissue rendered in a quieter neutral so the figure is complete (joints, sternum,
# linea alba, lumbar spine). Matched on the most specific (header) name only. Skull and facial bones are not
# imported: the head is shown by the (cropped) body surface.
BONE_RULES = (r"^((left|right) )?(clavicle|scapula|humerus|radius|ulna|femur|patella|tibia|fibula|hip bone|sacrum|coccyx|"
              r"atlas|axis|manubrium|body of sternum|xiphoid process|talus|calcaneus|cuboid bone|navicular bone of foot|"
              r"(medial|intermediate|lateral) cuneiform bone|scaphoid|lunate|triquetral|pisiform|trapezium|trapezoid|"
              r"capitate|hamate|sesamoid bone of foot|mandible)$|(cervical|thoracic|lumbar) vertebra$|(^| )rib$|"
              r"metacarpal bone$|metatarsal bone$|phalanx of ")
TISSUE_RULES = (r"^((left|right) )?(linea alba|calcaneal tendon|thyroid cartilage|cricoid cartilage|trachea|hyoid bone|flexor retinaculum of (left|right) wrist|"
                r"long plantar ligament)$|costal cartilage$|^intervertebral disk")

names = {}
for line in (SRC / "isa_parts_list_e.txt").read_text(encoding="utf-8").splitlines()[1:]:
    cid, _rep, en = line.split("\t")
    names[cid] = en

concepts_of = defaultdict(set)  # element -> concepts
size = defaultdict(int)  # concept -> element count
SEEN = set()
for fname in ("isa_element_parts.txt", "partof_element_parts.txt"):
    for line in (SRC / fname).read_text(encoding="utf-8").splitlines()[1:]:
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        cid, name, el = parts
        names.setdefault(cid, name)
        if (cid, el) in SEEN:
            continue
        SEEN.add((cid, el))
        concepts_of[el].add(cid)
        size[cid] += 1

if len(sys.argv) > 2:
    for f in sorted(Path(sys.argv[2]).glob("FJ*.obj")):
        with f.open(encoding="utf-8", errors="replace") as fh:
            for _ in range(20):
                line = fh.readline()
                if line.startswith("# English name :"):
                    name = line.split(":", 1)[1].strip().lower()
                    if name:
                        key = "hdr:" + f.stem
                        names[key] = name
                        size[key] = 0
                        concepts_of[f.stem].add(key)
                    break


def side_of(text):
    if re.search(r"\bright\b", text):
        return "right"
    if re.search(r"\bleft\b", text):
        return "left"
    return None


elements = {}
for el, cids in concepts_of.items():
    ordered = sorted(cids, key=lambda c: (size[c], names.get(c, "")))
    labels = [names.get(c, c) for c in ordered]
    if any(re.search(EXCLUDE, l) for l in labels):
        continue
    if any(re.search(r, l) for r in BODY_RULES for l in labels):
        elements[el] = {"kind": "skin", "part": labels[0]}
        continue
    if re.search(r"^(left|right) (sclera|cornea)$", labels[0]):
        # Closes the eye openings of the body-surface mesh (rendered like the skin).
        elements[el] = {"kind": "eye", "part": labels[0], "side": side_of(labels[0])}
        continue
    if re.search(r"artery|vein|nerve|branch", labels[0]):
        pass
    elif re.search(BONE_RULES, labels[0]):
        elements[el] = {"kind": "bone", "part": labels[0], "side": side_of(labels[0])}
        continue
    elif re.search(TISSUE_RULES, labels[0]):
        elements[el] = {"kind": "tissue", "part": labels[0], "side": side_of(labels[0])}
        continue
    hit = None
    for label in labels:  # most specific concept first
        if "muscle" not in " ".join(labels) and not any(re.search(r, label) for r, _ in RULES):
            continue
        for rx, mid in RULES:
            if re.search(rx, label) and not re.search(r"artery|vein|nerve|branch|tendon sheath|bursa", label):
                hit = (mid, label)
                break
        if hit:
            break
    if not hit:
        neutral = next((l for l in labels if re.search(NEUTRAL_RULES, l) and not re.search(r"artery|vein|nerve|branch", l)), None)
        if neutral:
            elements[el] = {"kind": "neutral", "part": neutral, "side": next((s for s in (side_of(l) for l in labels) if s), None)}
        continue
    mid, label = hit
    side = next((s for s in (side_of(l) for l in labels) if s), None)
    elements[el] = {"kind": "muscle", "muscle": mid, "side": side, "part": label}

found = defaultdict(set)
for v in elements.values():
    if v["kind"] == "muscle":
        found[v["muscle"]].add(re.sub(r"\b(left|right) ", "", v["part"]))

APP_IDS = ["chest", "lats", "middle back", "lower back", "traps", "shoulders", "neck", "biceps", "triceps", "forearms",
           "abdominals", "quadriceps", "hamstrings", "calves", "adductors", "abductors", "glutes"]
out = {
    "source": "BodyParts3D 4.0 (isa tree), (c) The Database Center for Life Science, CC BY 4.0",
    "elements": dict(sorted(elements.items())),
    "coverage": {m: sorted(found.get(m, [])) for m in APP_IDS},
    "missing": [m for m in APP_IDS if not found.get(m)],
}
OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"{sum(1 for v in elements.values() if v['kind']=='bone')} bone, {sum(1 for v in elements.values() if v['kind']=='tissue')} tissue, "
      f"{sum(1 for v in elements.values() if v['kind']=='neutral')} neutral muscle elements, "
      f"{sum(1 for v in elements.values() if v['kind']=='muscle')} muscle elements, "
      f"{sum(1 for v in elements.values() if v['kind']=='skin')} skin elements; missing ids: {out['missing']}")
for m in APP_IDS:
    print(f"  {m}: {', '.join(sorted(found.get(m, [])))[:300]}")
