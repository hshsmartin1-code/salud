"""Build public/data/exercise-media.json + public/exercise-media/*.webp from the RepDB free tier.

Run (from app/):  python -I -X utf8 data-pipeline/repdb/build_repdb.py [--offline]

Source : https://github.com/RepDB/exercise-dataset  (pinned commit PINNED_SHA below)
License: RepDB Free Tier License v1.0 (LICENSE-DATA.md at that commit). In-app use only,
         visible attribution "Exercise data by RepDB (repdb.co)" required, no redistribution
         as a dataset / dataset repository / API, no generative-AI use of the images.
         See data-pipeline/repdb/REPORT.md for the audit.

Downloads are cached (gitignored) in data-pipeline/raw/repdb/<sha12>/ and treated as untrusted
data: JSON is only parsed, images are only decoded by Pillow. --offline rebuilds from the cache.
Only the images of exercises that end up mapped are downloaded.

Mapping fedb:<id> (public/data/exercises.json, untouched) -> RepDB id is conservative:
  1. overrides.csv (hand-verified, confidence 'high'; repdb_id '-' blocks an exercise).
  2. automatic: equipment class AND coarse primary-muscle group must agree, stretching vs
     non-stretching must agree, and name evidence must be strong (exact normalised EN/ES name,
     an alias, or token-set equality after removing filler and equipment words). Variant
     modifiers (incline/decline/close-grip/sumo/seated/single-arm/smith/...) must be identical.
     exact EN (or exact ES + equal EN token set) -> 'high'; other evidence -> 'medium'.
     Ties between different RepDB ids are rejected.
"""
import argparse, collections, csv, datetime, hashlib, io, json, re, shutil, sys, unicodedata
from pathlib import Path

import requests
from PIL import Image

HERE = Path(__file__).resolve().parent                 # app/data-pipeline/repdb
APP = HERE.parent.parent                               # app/
CATALOG = APP / 'public' / 'data' / 'exercises.json'   # read-only input
OUT_JSON = APP / 'public' / 'data' / 'exercise-media.json'
OUT_DIR = APP / 'public' / 'exercise-media'
OVERRIDES = HERE / 'overrides.csv'
REPORT = HERE / 'REPORT.md'

REPO = 'RepDB/exercise-dataset'
PINNED_SHA = 'f12da458a90f353a86c953f204304d5a8bd98275'   # main @ 2026-11-15T13:27:17Z
RAW = HERE.parent / 'raw' / 'repdb' / PINNED_SHA[:12]
RAW_URL = f'https://raw.githubusercontent.com/{REPO}/{PINNED_SHA}/'
UA = {'User-Agent': 'salud-pwa/1.0 (personal non-commercial app)'}

ATTRIBUTION = 'Exercise data by RepDB (repdb.co)'
ATTRIBUTION_URL = 'https://repdb.co'
LICENSE_URL = f'https://github.com/{REPO}/blob/{PINNED_SHA}/LICENSE-DATA.md'
LICENSE_NAME = 'RepDB Free Tier License v1.0 (in-app use only; visible attribution required; no redistribution as a dataset)'

THUMB_PX, THUMB_MAX = 160, 8 * 1024
DETAIL_PX, DETAIL_MAX = 600, 45 * 1024        # never upscale: source is 512 px
FOLDER_BUDGET = 20 * 1024 * 1024
THUMB_POSE_ORDER = ('peak', 'main', 'start')
POSE_ORDER = ('start', 'peak', 'main')


# ----------------------------------------------------------------------------- download / cache
def fetch(rel, offline):
    dest = RAW / rel
    if dest.exists() and dest.stat().st_size > 0:
        return dest.read_bytes()
    if offline:
        sys.exit(f'--offline: missing cached file {dest}')
    r = requests.get(RAW_URL + rel, headers=UA, timeout=60)
    r.raise_for_status()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(r.content)
    return r.content


# ----------------------------------------------------------------------------- normalisation
FILLER = {'the', 'a', 'an', 'with', 'on', 'to', 'of', 'and', 'in', 'for', 'at', 'version', 'exercise',
          'movement', 'standard', 'regular', 'basic', 'classic', 'normal', 'conventional', 'attachment'}
# Equipment words are dropped from the name tokens only when they name the record's OWN equipment class
# (so "Squat with Bands" on a barbell keeps 'band' as a meaningful token, "Seated Cable Row" loses 'cable').
CLASS_WORDS = {'barbell': {'barbell'}, 'dumbbell': {'dumbbell'}, 'kettlebell': {'kettlebell'},
               'cable': {'cable', 'pulley'}, 'machine': {'machine'}, 'smith': {'smith', 'machine'},
               'band': {'band', 'banded', 'resistance'}, 'bodyweight': {'bodyweight'}, 'ezbar': {'ezbar'},
               'plate': {'plate'}, 'trapbar': {'trapbar'}, 'rings': {'ring'}, 'suspension': {'trx', 'suspension'},
               'stability_ball': {'stability', 'ball', 'exercise', 'physioball', 'swiss'},
               'medicine_ball': {'medicine', 'ball'}, 'bosu': {'bosu', 'balance', 'dome'}}
EQUIP_WORDS = set().union(*CLASS_WORDS.values()) - {'ball', 'exercise', 'balance', 'dome', 'stability'}
NO_SINGULAR = {'triceps', 'biceps', 'abs', 'press', 'cross', 'swiss', 'plus', 'chess', 'lats'}
PHRASES = [  # applied in order on the space-joined lowercase ascii string
    (r'\be z\b', 'ez'), (r'\bez curl bar\b', 'ezbar'), (r'\bez bar\b', 'ezbar'),
    (r'\bpull ?ups?\b', 'pullup'), (r'\bchin ?ups?\b', 'chinup'), (r'\bpush ?ups?\b', 'pushup'),
    (r'\bsit ?ups?\b', 'situp'), (r'\bstep ?ups?\b', 'stepup'), (r'\bskull ?crushers?\b', 'skullcrusher'),
    (r'\bpush ?downs?\b', 'pushdown'), (r'\bpull ?downs?\b', 'pulldown'), (r'\bpull ?overs?\b', 'pullover'),
    (r'\bkick ?backs?\b', 'kickback'), (r'\bdead ?lifts?\b', 'deadlift'),
    (r'\b(one|single) arm(ed)?\b', 'singlearm'), (r'\b(one|single) leg(ged)?\b', 'singleleg'),
    (r'\bstiff leg(ged)?\b', 'stiffleg'), (r'\bbent over\b', 'bentover'), (r'\bstraight arm\b', 'straightarm'),
    (r'\bclose grip\b', 'closegrip'), (r'\bwide grip\b', 'widegrip'), (r'\breverse grip\b', 'reversegrip'),
    (r'\bneutral grip\b', 'neutralgrip'), (r'\bmedium grip\b', ' '),
    (r'\bsmith machine\b', 'smith'), (r'\blever(age)?\b', 'machine'), (r'\bv bar\b', 'vbar'),
    (r'\bt bar\b', 'tbar'), (r'\b(trap|hex) bar\b', 'trapbar'), (r'\bstraight bar\b', 'straightbar'),
    (r'\bbody ?weight\b', 'bodyweight'), (r'\bbody only\b', 'bodyweight'),
    (r'\bdb\b', 'dumbbell'), (r'\bkb\b', 'kettlebell'), (r'\bbb\b', 'barbell'),
    (r'\bohp\b', 'overhead press'), (r'\brdl\b', 'romanian deadlift'),
    (r'\btricep\b', 'triceps'), (r'\bbicep\b', 'biceps'), (r'\bcalves\b', 'calf'),
    (r'\b(flyes|flye|flys|flies)\b', 'fly'),
]
VARIANT = {  # meaningful modifiers: must be identical on both sides for any automatic match
    'incline', 'decline', 'flat', 'closegrip', 'close', 'widegrip', 'wide', 'narrow', 'reversegrip', 'reverse',
    'sumo', 'romanian', 'stiffleg', 'front', 'back', 'seated', 'standing', 'lying', 'kneeling', 'singlearm',
    'singleleg', 'alternating', 'alternate', 'smith', 'hack', 'goblet', 'overhead', 'behind', 'neck', 'pause',
    'paused', 'deficit', 'box', 'zercher', 'pendlay', 'bulgarian', 'split', 'jump', 'jumping', 'pistol',
    'hammer', 'preacher', 'concentration', 'spider', 'drag', 'cheat', 'neutralgrip', 'rope', 'vbar',
    'straightarm', 'straightbar', 'bentover', 'bent', 'isometric', 'hold', 'weighted', 'assisted', 'negative',
    'elevated', 'floor', 'landmine', 'trapbar', 'chain', 'side', 'rear', 'cross', 'crossbody', 'iso', 'plyo',
    'explosive', 'power', 'hang', 'clean', 'snatch', 'jerk', 'high', 'low', 'wall', 'ball', 'stability', 'bosu',
    'dome', 'trx', 'ring', 'suspension', 'partial', 'half', 'quarter', 'two', 'double', 'offset', 'rotational',
    'twist', 'walking', 'stationary', 'lateral', 'upright', 'military', 'arnold', 'tbar',
} | EQUIP_WORDS   # a foreign equipment word left in the core tokens is itself a variant


def ascii_lower(s):
    s = unicodedata.normalize('NFKD', (s or '').lower())
    s = ''.join(c for c in s if not unicodedata.combining(c)).replace('’', "'")
    s = re.sub(r"'s\b", '', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def tokens(name):
    s = ' ' + ascii_lower(name) + ' '
    for pat, rep in PHRASES:
        s = re.sub(pat, rep, s)
    out = []
    for t in s.split():
        if len(t) > 3 and t.endswith('s') and not t.endswith('ss') and t not in NO_SINGULAR:
            t = t[:-1]
        out.append(t)
    return out


def full_norm(name):
    return ' '.join(t for t in tokens(name) if t not in FILLER)


def core(name, equip_class):
    own = CLASS_WORDS.get(equip_class, set())
    return frozenset(t for t in tokens(name) if t not in FILLER and t not in own)


def variants(tokset):
    return frozenset(t for t in tokset if t in VARIANT)


# ----------------------------------------------------------------------------- vocabularies
FEDB_EQUIP = {'barbell': 'barbell', 'dumbbell': 'dumbbell', 'cable': 'cable', 'machine': 'machine',
              'body only': 'bodyweight', 'kettlebells': 'kettlebell', 'bands': 'band',
              'medicine ball': 'medicine_ball', 'exercise ball': 'stability_ball', 'foam roll': 'foam_roll',
              'e-z curl bar': 'ezbar', None: 'bodyweight', 'other': None}
REPDB_EQUIP = {None: 'bodyweight', 'pull_up_bar': 'bodyweight', 'dip_station': 'bodyweight',
               'flat_bench': 'bodyweight', 'plyo_box': 'bodyweight', 'smith_machine': 'smith',
               'ez_bar': 'ezbar', 'trap_bar': 'trapbar', 'resistance_band': 'band', 'loop_band': 'band',
               'bosu_ball': 'bosu', 'slam_ball': 'medicine_ball', 'wall_ball': 'medicine_ball',
               'plates': 'plate', 'rings': 'rings', 'suspension_trainer': 'suspension',
               'dumbbell': 'dumbbell', 'barbell': 'barbell', 'kettlebell': 'kettlebell', 'cable': 'cable',
               'stability_ball': 'stability_ball', 'medicine_ball': 'medicine_ball'}
NAME_EQUIP = [('smith', 'smith'), ('ezbar', 'ezbar'), ('trapbar', 'trapbar'), ('barbell', 'barbell'),
              ('dumbbell', 'dumbbell'), ('kettlebell', 'kettlebell'), ('cable', 'cable'), ('band', 'band'),
              ('banded', 'band'), ('trx', 'suspension'), ('suspension', 'suspension'), ('ring', 'rings'),
              ('machine', 'machine')]


def fedb_equip(e):
    toks = set(tokens(e['nameEn']))
    if 'smith' in toks:
        return 'smith'
    if 'ezbar' in toks and e['equipment'] in ('barbell', 'e-z curl bar', 'other', None):
        return 'ezbar'      # e.g. "Close-Grip EZ Bar Curl" filed under 'barbell' but uses an EZ bar
    eq = FEDB_EQUIP.get(e['equipment'], e['equipment'])
    if eq is None or (e['equipment'] is None and toks & {w for w, _ in NAME_EQUIP}):
        for w, cls in NAME_EQUIP:
            if w in toks:
                return cls
        return None if e['equipment'] == 'other' else 'bodyweight'
    return eq


def repdb_equip(r):
    eq = r.get('equipment')
    if eq in REPDB_EQUIP:
        return REPDB_EQUIP[eq]
    return 'machine'   # leg_press, leg_curl, hack_squat, pec_deck, *_machine, cardio machines, ...


FEDB_MUSCLE = {'abdominals': {'core'}, 'abductors': {'hip_ab_ad'}, 'adductors': {'hip_ab_ad'},
               'biceps': {'biceps'}, 'calves': {'calves'}, 'chest': {'chest'}, 'forearms': {'forearms'},
               'glutes': {'glutes'}, 'hamstrings': {'hamstrings'}, 'lats': {'back'}, 'lower back': {'back'},
               'middle back': {'back'}, 'neck': {'neck'}, 'quadriceps': {'quads'}, 'shoulders': {'shoulders'},
               'traps': {'back', 'shoulders'}, 'triceps': {'triceps'}}
REPDB_MUSCLE = {'gluteus_maximus': {'glutes'}, 'gluteus_medius': {'glutes'}, 'quadriceps': {'quads'},
                'pectoralis_major': {'chest'}, 'serratus_anterior': {'chest'}, 'latissimus_dorsi': {'back'},
                'rhomboids': {'back'}, 'erector_spinae': {'back'}, 'quadratus_lumborum': {'back'},
                'trapezius': {'back', 'shoulders'}, 'anterior_deltoid': {'shoulders'},
                'lateral_deltoid': {'shoulders'}, 'posterior_deltoid': {'shoulders'},
                'infraspinatus_teres_minor': {'shoulders'}, 'supraspinatus': {'shoulders'},
                'rectus_abdominis': {'core'}, 'obliques': {'core'}, 'transverse_abdominis': {'core'},
                'hip_flexors': {'core'}, 'hamstrings': {'hamstrings'}, 'triceps_brachii': {'triceps'},
                'biceps_brachii': {'biceps'}, 'brachialis': {'biceps'}, 'brachioradialis': {'forearms', 'biceps'},
                'forearm_flexors': {'forearms'}, 'forearm_extensors': {'forearms'}, 'forearms': {'forearms'},
                'gastrocnemius': {'calves'}, 'soleus': {'calves'}, 'tibialis_anterior': {'calves'},
                'adductors': {'hip_ab_ad'}, 'abductors': {'hip_ab_ad'}}


def groups(muscles, table):
    out = set()
    for m in muscles or []:
        out |= table.get(m, {m})
    return out


# ----------------------------------------------------------------------------- matching
def fedb_features(f):
    eq = fedb_equip(f)
    c = core(f['nameEn'], eq)
    return {'full_en': full_norm(f['nameEn']), 'full_es': full_norm(f['nameEs']), 'core_en': c,
            'var_en': variants(c), 'equip': eq, 'groups': groups(f['primaryMuscles'], FEDB_MUSCLE),
            'aliases': {full_norm(a) for a in f.get('aliases', [])} - {''}}


def repdb_features(rid, r):
    eq = repdb_equip(r)
    c, cs = core(r['name_en'], eq), core(rid.replace('-', ' '), eq)
    return {'full_en': full_norm(r['name_en']), 'full_es': full_norm(r['name_es']), 'core_en': c, 'core_slug': cs,
            'var_en': variants(c), 'var_slug': variants(cs), 'equip': eq,
            'groups': groups(r.get('primary_muscles'), REPDB_MUSCLE)}


EVIDENCE_RANK = {'exact_en': 4, 'tokenset': 3, 'exact_es': 2, 'alias': 1}


def evidence(f, r, fx, rx):
    ev = []
    if fx['full_en'] and fx['full_en'] == rx['full_en']:
        ev.append('exact_en')
    if fx['core_en'] and (fx['core_en'] == rx['core_en'] or fx['core_en'] == rx['core_slug']):
        ev.append('tokenset')
    if fx['full_es'] and fx['full_es'] == rx['full_es']:
        ev.append('exact_es')
    if fx['aliases'] & {rx['full_en'], rx['full_es']}:
        ev.append('alias')
    return ev


def checks(f, r, fx, rx):
    failed = []
    if fx['equip'] is None:
        failed.append(f"fedb equipment '{f['equipment']}' not specific")
    elif fx['equip'] != rx['equip']:
        failed.append(f"equipment {fx['equip']} != {rx['equip']}")
    if not (fx['groups'] & rx['groups']):
        failed.append(f"primary muscles {sorted(fx['groups'])} vs {sorted(rx['groups'])}")
    if (f['category'] == 'stretching') != (r['category'] == 'stretching'):
        failed.append(f"category {f['category']} vs {r['category']}")
    if fx['var_en'] != rx['var_en'] and fx['var_en'] != rx['var_slug']:
        diff = sorted(fx['var_en'] ^ rx['var_en'])
        failed.append('variant tokens differ: ' + ','.join(diff))
    return failed


def jaccard(a, b):
    return len(a & b) / len(a | b) if a | b else 0.0


def auto_match(fedb, repdb, fxs, rxs):
    matched, rejected = {}, {}
    for fid, f in fedb.items():
        fx = fxs[fid]
        passing, failing = [], []
        for rid, r in repdb.items():
            ev = evidence(f, r, fx, rxs[rid])
            if not ev:
                continue
            fails = checks(f, r, fx, rxs[rid])
            (failing if fails else passing).append((max(EVIDENCE_RANK[e] for e in ev), rid, ev, fails))
        if passing:
            passing.sort(key=lambda t: -t[0])
            top = [p for p in passing if p[0] == passing[0][0]]
            if len({p[1] for p in top}) == 1:
                rank, rid, ev, _ = top[0]
                conf = 'high' if ('exact_en' in ev or ('exact_es' in ev and 'tokenset' in ev)) else 'medium'
                matched[fid] = {'repdbId': rid, 'confidence': conf, 'evidence': '+'.join(ev)}
                continue
            rejected[fid] = {'kind': 'check', 'best': '/'.join(p[1] for p in top), 'score': '+'.join(top[0][2]),
                             'reason': 'ambiguous: several RepDB records with equal evidence'}
            continue
        if failing:
            failing.sort(key=lambda t: -t[0])
            rank, rid, ev, fails = failing[0]
            rejected[fid] = {'kind': 'check', 'best': rid, 'score': '+'.join(ev), 'reason': '; '.join(fails)}
            continue
        # no name evidence at all: report the nearest name by token overlap
        a = frozenset(tokens(f['nameEn'])) - FILLER
        best = max(repdb, key=lambda rid: jaccard(a, frozenset(tokens(repdb[rid]['name_en'])) - FILLER))
        sc = jaccard(a, frozenset(tokens(repdb[best]['name_en'])) - FILLER)
        if sc < 0.5:
            reason = 'no RepDB record with matching name'
        else:
            b_ = frozenset(tokens(repdb[best]['name_en'])) - FILLER
            reason = 'names differ: ' + ' '.join([f'+{t}' for t in sorted(a - b_)] + [f'-{t}' for t in sorted(b_ - a)])
        rejected[fid] = {'kind': 'weak', 'best': best if sc > 0 else '', 'score': f'{sc:.2f}', 'reason': reason}
    return matched, rejected


# ----------------------------------------------------------------------------- images
def encode_webp(im, max_bytes, qualities=(82, 75, 68, 60, 52, 45, 38, 30)):
    for q in qualities:
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=q, method=6)
        if buf.tell() <= max_bytes:
            return buf.getvalue(), q
    return buf.getvalue(), qualities[-1]


def has_alpha(im):
    return im.mode in ('RGBA', 'LA') and im.getchannel('A').getextrema()[0] < 255


def prep(im):
    return im.convert('RGBA') if has_alpha(im) else im.convert('RGB')


def resized(im, long_side):
    w, h = im.size
    s = long_side / max(w, h)
    if s >= 1:
        return im
    return im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)


def make_detail(src_bytes):
    """Return (bytes, note). Source WebP is copied verbatim when it already fits (no generational loss)."""
    im = Image.open(io.BytesIO(src_bytes))
    im.load()
    if im.format == 'WEBP' and max(im.size) <= DETAIL_PX and len(src_bytes) <= DETAIL_MAX:
        return src_bytes, 'verbatim', im.size
    out = resized(prep(im), DETAIL_PX)
    data, q = encode_webp(out, DETAIL_MAX)
    return data, f'q{q}', out.size


def make_thumb(src_bytes):
    im = Image.open(io.BytesIO(src_bytes))
    im.load()
    out = resized(prep(im), THUMB_PX)
    data, q = encode_webp(out, THUMB_MAX, qualities=(75, 68, 60, 52, 45, 38, 30))
    return data, f'q{q}', out.size


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--offline', action='store_true', help='rebuild from data-pipeline/raw/repdb cache only')
    args = ap.parse_args()

    raw_json = fetch('exercises.json', args.offline)
    license_md = fetch('LICENSE-DATA.md', args.offline).decode('utf-8')
    fetch('ATTRIBUTION.md', args.offline)
    if 'No redistribution as a dataset' not in license_md or 'Image modifications' not in license_md:
        sys.exit('LICENSE-DATA.md at the pinned commit no longer contains the audited terms; re-audit first.')
    src = json.loads(raw_json)
    repdb = {r['id']: r for r in src['exercises']}
    cat = json.loads(CATALOG.read_text(encoding='utf-8'))
    fedb = {e['id']: e for e in cat['exercises']}

    fxs = {fid: fedb_features(f) for fid, f in fedb.items()}
    rxs = {rid: repdb_features(rid, r) for rid, r in repdb.items()}

    # --- overrides
    overrides, blocked, override_rows = {}, {}, []
    with OVERRIDES.open(encoding='utf-8', newline='') as fh:
        for row in csv.DictReader(fh):
            fid, rid, note = row['fedb_id'].strip(), row['repdb_id'].strip(), row['note'].strip()
            if fid not in fedb:
                sys.exit(f'overrides.csv: unknown fedb id {fid}')
            if rid == '-':
                blocked[fid] = note
                continue
            if rid not in repdb:
                sys.exit(f'overrides.csv: unknown RepDB id {rid}')
            fails = checks(fedb[fid], repdb[rid], fxs[fid], rxs[rid])
            overrides[fid] = {'repdbId': rid, 'confidence': 'high', 'evidence': 'override'}
            override_rows.append((fid, rid, note, fails))

    todo = {fid: f for fid, f in fedb.items() if fid not in overrides and fid not in blocked}
    auto, rejected = auto_match(todo, repdb, fxs, rxs)
    for fid, note in blocked.items():
        rejected[fid] = {'kind': 'blocked', 'best': '', 'score': '', 'reason': 'manual block: ' + note}
    mapping = {**auto, **overrides}

    # --- images
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    needed = sorted({m['repdbId'] for m in mapping.values()})
    written, stats = {}, collections.Counter()
    sizes = {'thumb': [], 'detail': []}
    for rid in needed:
        flat = repdb[rid]['images']['flat']
        poses = [p for p in POSE_ORDER if p in flat]
        files = []
        for p in poses:
            rel = flat[p]
            if not re.fullmatch(r'images/flat/[a-z0-9-]+\.webp', rel):
                sys.exit(f'unexpected image path {rel!r}')
            data, note, size = make_detail(fetch(rel, args.offline))
            name = f'{rid}-{p}.webp'
            (OUT_DIR / name).write_bytes(data)
            files.append(name)
            stats['detail_verbatim' if note == 'verbatim' else 'detail_reencoded'] += 1
            sizes['detail'].append(len(data))
            stats['src_images'] += 1
        tpose = next(p for p in THUMB_POSE_ORDER if p in flat)
        tdata, tnote, tsize = make_thumb((RAW / flat[tpose]).read_bytes())
        tname = f'{rid}-thumb.webp'
        (OUT_DIR / tname).write_bytes(tdata)
        sizes['thumb'].append(len(tdata))
        written[rid] = {'thumb': tname, 'images': files, 'poses': poses, 'thumbPose': tpose}
    keep = {n for w in written.values() for n in [w['thumb'], *w['images']]}
    for p in OUT_DIR.glob('*.webp'):
        if p.name not in keep:
            p.unlink()
    total_bytes = sum(p.stat().st_size for p in OUT_DIR.iterdir() if p.is_file())
    if total_bytes > FOLDER_BUDGET:
        sys.exit(f'exercise-media folder is {total_bytes} bytes > budget {FOLDER_BUDGET}; lower DETAIL_PX/quality')

    # --- json
    items = {}
    instr_added = []
    for fid in sorted(mapping):
        m = mapping[fid]
        rid = m['repdbId']
        w = written[rid]
        item = {'repdbId': rid, 'confidence': m['confidence'], 'thumb': w['thumb'], 'images': w['images'],
                'poses': w['poses'], 'nameEn': repdb[rid]['name_en']}
        if not fedb[fid].get('instructionsEs') and repdb[rid].get('instructions_es'):
            item['instructionsEs'] = repdb[rid]['instructions_es']
            instr_added.append(fid)
        items[fid] = item
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
    out = {'format': 'pho-exercise-media', 'version': 1, 'source': 'RepDB exercise-dataset',
           'sourceUrl': f'https://github.com/{REPO}', 'sourceCommit': PINNED_SHA,
           'sourceSha256': hashlib.sha256(raw_json).hexdigest(), 'license': LICENSE_NAME,
           'attribution': ATTRIBUTION, 'attributionUrl': ATTRIBUTION_URL, 'licenseUrl': LICENSE_URL,
           'generatedAt': now, 'basePath': 'exercise-media/',
           'poseNote': "poses: 'start' and 'peak' (end/peak position) or a single 'main' pose for holds and stretches; "
                       "thumb is made from the peak (or main) pose",
           'items': items}
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

    write_report(src, hashlib.sha256(raw_json).hexdigest(), repdb, fedb, mapping, override_rows, blocked, auto, rejected, written, stats, sizes,
                 total_bytes, instr_added, now)
    conf = collections.Counter(m['confidence'] for m in mapping.values())
    print(f"RepDB exercises {len(repdb)} | fedb {len(fedb)} | mapped {len(mapping)} (high {conf['high']}, "
          f"medium {conf['medium']}) | unmapped {len(fedb) - len(mapping)} | RepDB ids used {len(needed)} | "
          f"thumbs {len(sizes['thumb'])} | details {len(sizes['detail'])} | folder {total_bytes} bytes")


# ----------------------------------------------------------------------------- report
LICENSE_SECTION = """\
## 1. License audit (RepDB free tier)

Sources read on 2026-11-15: [`LICENSE-DATA.md`]({lic}) and [`ATTRIBUTION.md`](https://github.com/RepDB/exercise-dataset/blob/{sha}/ATTRIBUTION.md)
at the pinned commit, the repo [README](https://github.com/RepDB/exercise-dataset/blob/{sha}/README.md),
and for context https://repdb.co/license/ (paid tiers), https://repdb.co/pricing/ (FAQ) and
https://repdb.co/npm-exercise-dataset/. The license is "RepDB - Free Tier License (v1.0)",
(c) 2026 Sergei Argutin (RepDB), German law. GitHub reports the license as `NOASSERTION` (custom).

| Question | Finding (short quotes from LICENSE-DATA.md unless noted) |
|---|---|
| Use in a free personal web app | Allowed. Term 1: "use the dataset and images inside applications — apps, websites, research projects". |
| Attribution | Required. Term 2: "Place a visible link — 'Exercise data by RepDB (repdb.co)'". Location: "your app's about/credits screen, your project's README, or your website footer". `rel="nofollow"` optional. ATTRIBUTION.md adds: "Keep the attribution visible to users." |
| Redistribution as a dataset | Forbidden. Term 3: "republish, resell, or repackage the dataset — or a modified or derived dataset" as "a dataset, dataset repository, or API. In-app use only." |
| Resizing / re-encoding / cropping | Allowed. Term 4: "Images may be resized, cropped, or recolored for in-app use." But "Upscaled or background-removed derivatives fall under the same no-redistribution rule" -> we never upscale (source is 512 px, so detail images stay 512 px, not 600). |
| Count / size limits | None stated anywhere in the free-tier terms. |
| Generative AI | Forbidden. Term 5: images "may not be used as input, reference, or conditioning material for generative models". |
| `premium-samples/` | Evaluation only (term 6). Not downloaded, not used. |
| Public GitHub repo + GitHub Pages | Not named explicitly. The README says "ship `exercises.json` and the images with your app" for production, and RepDB's own Next.js starter (github.com/RepDB/repdb-example-nextjs, which invites users to fork it) vendors the WebP images in a public repo for deployment. The paid-tier FAQ (pricing page) draws the line at bulk access: "no public archive of the bundle, open bucket, or bulk-download endpoint"; the paid license adds that "Serving individual images or records to your product's users is expressly fine." |

**Verdict: hosting resized copies publicly is permitted as in-app use**, so images were generated. Conditions the app must keep:
1. Show the visible attribution link (text below) in the app's about/credits screen (best: users see it); the README or a site footer also satisfy term 2. **Not done by this pipeline** (src/ and README were out of scope).
2. The repo stays an app repo: do not describe `public/exercise-media/` or `exercise-media.json` as a dataset, do not expose them as an API, do not add the full catalog or bulk-download tooling. We ship only the images of mapped exercises plus our own fedb->RepDB mapping (no RepDB descriptions, tips, muscles or MET; Spanish instructions only where ours were empty).
3. No upscaling, background removal or AI processing of the images.

Residual uncertainty: a public git repo makes these images bulk-downloadable from the repo itself; the free license does not address this case explicitly. It is an app repo carrying only a subset, which matches RepDB's own starter apps, but written confirmation from support@repdb.co would remove all doubt.

Required attribution text (exact): **`Exercise data by RepDB (repdb.co)`** linking to https://repdb.co (HTML form from ATTRIBUTION.md: `Exercise data by <a href="https://repdb.co" rel="nofollow">RepDB (repdb.co)</a>`).
"""

ALT_SECTION = """\
## 7. Alternative datasets (checked, not used)

* **hasaneyldrm/exercises-dataset** (commit 7455efae41b3): `LICENSE` is MIT, but its "MEDIA EXCEPTION" says the MIT license
  "DOES NOT cover the exercise media" in `images/` and `videos/`. The media is (c) Gym visual, redistributed there with written
  permission at 180x180 only, must carry "(c) Gym visual - https://gymvisual.com/", and NOTICE.md states cloning the repo
  "does not grant you any rights to the media". Not usable without our own Gym visual license.
* **OpenExerciseBase/OpenExerciseBase-Database** (commit 57790f9a1684): README and `LICENSE` put "the exercise data in this
  repository" under CC BY-NC 4.0 ((c) 2026 Ludwig Boltzmann Institute for Digital Health and Prevention); the LICENSE does not
  carve out the images, so they appear to be covered too (share/adapt non-commercially with credit; a free personal app would
  qualify). The `main` branch holds only 191 exercises with 191 PNG images (`images/<exercise_id>/`), mixing general fitness,
  mobility, breathing and rehab drills, so coverage of our 873-exercise catalog would be small. Image files were not inspected.

RepDB was usable, so neither alternative was used.
"""


def md_escape(s):
    return str(s).replace('|', '\\|')


def write_report(src, src_sha, repdb, fedb, mapping, override_rows, blocked, auto, rejected, written, stats, sizes,
                 total_bytes, instr_added, now):
    shapes = collections.Counter(tuple(sorted(r['images']['flat'])) for r in repdb.values())
    conf = collections.Counter(m['confidence'] for m in mapping.values())
    n_img_src = stats['src_images']
    reused = collections.Counter(m['repdbId'] for m in mapping.values())
    shared = {rid: sorted(f for f, m in mapping.items() if m['repdbId'] == rid) for rid, c in reused.items() if c > 1}
    L = []
    L.append('# RepDB exercise illustrations - build report\n')
    L.append(f'Generated {now} by `data-pipeline/repdb/build_repdb.py` from '
             f'[{REPO}@{PINNED_SHA[:12]}](https://github.com/{REPO}/tree/{PINNED_SHA}) '
             f'(full SHA `{PINNED_SHA}`; exercises.json sha256 `{src_sha}`).\n')
    L.append(LICENSE_SECTION.format(lic=LICENSE_URL, sha=PINNED_SHA))
    L.append('## 2. Source schema facts (verified on the pinned commit)\n')
    L.append(f"* `exercises.json`: object `{{{', '.join(k for k in src if k != 'exercises')}, exercises[]}}`, "
             f"schema_version {src.get('schema_version')}, count {src.get('count')}, {len(repdb)} records "
             f"(the task brief said ~701; the current snapshot has {len(repdb)}).")
    L.append('* Exercise id: URL-safe lowercase slug, e.g. `bulgarian-split-squat`; ids are unique.')
    L.append('* Languages: `name_*`, `description_*`, `instructions_*` (array), `tips_*` (array) in `en`, `de`, `es` for every record '
             '(no empty Spanish instructions found).')
    L.append('* Other fields: category, force_type, mechanic, difficulty, equipment (absent = bodyweight), body_part, primary_muscles, '
             'secondary_muscles, goals, tags, variation_group, met, is_unilateral, is_bodyweight, images.')
    L.append(f"* Images: `images.flat.start` + `images.flat.peak` for {shapes.get(('peak', 'start'), 0)} exercises, a single "
             f"`images.flat.main` for {shapes.get(('main',), 0)} (holds/stretches); path `images/flat/<id>-<pose>.webp`; "
             f"{sum(len(r['images']['flat']) for r in repdb.values())} image files, no path shared between ids.")
    L.append('* Format: WebP, 512x512, RGB (no alpha channel), flat style on a solid light-blue background (checked with Pillow). '
             'There is no separate "end" pose: the second pose is called `peak`. Note: some near-identical variants carry '
             'visually identical pictures (e.g. `standing-calf-raise` and `machine-calf-raise`).')
    L.append('* Also in the repo, not used: 29 muscle icons and 64 equipment icons (`images/muscles`, `images/equipment`), '
             '`premium-samples/` (evaluation-only).\n')

    L.append('## 3. Counts\n')
    L.append('| Item | Count |\n|---|---|')
    rows = [('RepDB exercises at pinned commit', len(repdb)),
            ('Existing catalog exercises (fedb)', len(fedb)),
            ('fedb exercises mapped (shipped)', len(mapping)),
            ('... confidence high (overrides)', sum(1 for m in mapping.values() if m['evidence'] == 'override')),
            ('... confidence high (automatic, exact name)', sum(1 for m in auto.values() if m['confidence'] == 'high')),
            ('... confidence medium (automatic)', conf['medium']),
            ('fedb exercises unmapped', len(fedb) - len(mapping)),
            ('... of which manually blocked', len(blocked)),
            ('Distinct RepDB exercises used', len(written)),
            ('RepDB source images used (start/peak/main of mapped exercises)', n_img_src),
            ('RepDB images in the local download cache (incl. audit probes / later-blocked)',
             sum(1 for _ in (RAW / 'images' / 'flat').glob('*.webp'))),
            ('Thumbnails written (160x160 WebP, from peak/main pose)', len(sizes['thumb'])),
            ('Detail images written (512x512 WebP)', len(sizes['detail'])),
            ('... copied verbatim (already WebP <= 45 KB, no upscaling)', stats['detail_verbatim']),
            ('... re-encoded', stats['detail_reencoded']),
            ('Spanish instructions added (ours were empty)', len(instr_added)),
            ('Total bytes in public/exercise-media/', f'{total_bytes:,} ({total_bytes / 1048576:.2f} MiB; budget 20 MiB)'),
            ('Thumbnail bytes min / median / max', ' / '.join(f'{v:,}' for v in (min(sizes['thumb']), sorted(sizes['thumb'])[len(sizes['thumb']) // 2], max(sizes['thumb'])))),
            ('Detail bytes min / median / max', ' / '.join(f'{v:,}' for v in (min(sizes['detail']), sorted(sizes['detail'])[len(sizes['detail']) // 2], max(sizes['detail'])))),
            ]
    L += [f'| {a} | {b} |' for a, b in rows]
    L.append('\nAll thumbnails are <= 8 KB and all detail images <= 45 KB (enforced by the script). Detail images are 512 px '
             '(not ~600 px) because the source is 512 px and the license treats upscaled derivatives as restricted.\n')
    if instr_added:
        L.append('Spanish instructions taken from RepDB for: ' + ', '.join(f'`{f}`' for f in instr_added) + '.\n')
    if shared:
        L.append('RepDB records used by more than one fedb exercise: ' +
                 '; '.join(f"`{rid}` <- {', '.join(f'`{f}`' for f in fs)}" for rid, fs in sorted(shared.items())) + '.\n')

    L.append('## 4. Common lifts: hand-verified overrides (`overrides.csv`)\n')
    L.append('Each pair was verified by reading both records (names, equipment, Spanish instructions vs RepDB instructions). '
             'Frequently used barbell/machine lifts (hack squat, rows, hip thrust) were checked first, '
             'including their RepDB peak images. In addition, every shipped thumbnail (overrides and automatic) was reviewed by eye on '
             'contact sheets on 2026-11-15; that review caused the `Hanging_Leg_Raise` block. Start-pose images were not all viewed '
             'individually. "Auto-check" shows whether the pair would also pass the automatic equipment/muscle/variant rules '
             '(failures here are labelling differences that were accepted after reading both records).\n')
    L.append('| fedb id | RepDB id | RepDB name | Auto-check | Note |\n|---|---|---|---|---|')
    for fid, rid, note, fails in override_rows:
        L.append(f"| `{fid}` | `{rid}` | {md_escape(repdb[rid]['name_en'])} | {'pass' if not fails else md_escape('; '.join(fails))} | {md_escape(note)} |")
    L.append('')
    L.append('Manually blocked (never illustrated): ' + '; '.join(f'`{f}` ({md_escape(n.replace("BLOCK: ", ""))})' for f, n in blocked.items()) + '.\n')

    L.append('## 5. Automatic mappings (shipped)\n')
    L.append('| fedb id | fedb name | RepDB id | RepDB name | confidence | evidence |\n|---|---|---|---|---|---|')
    for fid in sorted(auto, key=lambda k: (auto[k]['confidence'], k)):
        m = auto[fid]
        L.append(f"| `{fid}` | {md_escape(fedb[fid]['nameEn'])} | `{m['repdbId']}` | {md_escape(repdb[m['repdbId']]['name_en'])} | "
                 f"{m['confidence']} | {m['evidence']} |")
    L.append('')

    L.append('## 6. Unmatched / rejected fedb exercises\n')
    near = {f: r for f, r in rejected.items() if r['kind'] == 'check'}
    weak = {f: r for f, r in rejected.items() if r['kind'] == 'weak'}
    L.append(f'{len(rejected)} fedb exercises have no illustration. {len(blocked)} are manual blocks (section 4). '
             f'{len(near)} had name evidence for a RepDB record but failed a check (table 6a). '
             f'{len(weak)} had no strong name evidence; table 6b lists the nearest RepDB name by token overlap.\n')
    L.append('### 6a. Name evidence found, rejected by a check\n')
    L.append('| fedb id | best RepDB candidate | evidence | reason rejected |\n|---|---|---|---|')
    for fid in sorted(near):
        r = near[fid]
        L.append(f"| `{fid}` | `{r['best']}` | {r['score']} | {md_escape(r['reason'])} |")
    L.append('\n### 6b. No strong name evidence\n')
    L.append('| fedb id | nearest RepDB name | token overlap | reason |\n|---|---|---|---|')
    for fid in sorted(weak, key=lambda k: (-float(weak[k]['score'] or 0), k)):
        r = weak[fid]
        L.append(f"| `{fid}` | {('`' + r['best'] + '`') if r['best'] else '-'} | {r['score']} | {md_escape(r['reason'])} |")
    L.append('')
    L.append(ALT_SECTION)
    L.append('## 8. Reproduce\n')
    L.append('```\ncd app\npython -I -X utf8 data-pipeline/repdb/build_repdb.py            # downloads into data-pipeline/raw/repdb/<sha12>/ (gitignored)\n'
             'python -I -X utf8 data-pipeline/repdb/build_repdb.py --offline  # rebuild from the cache only\n```\n')
    L.append('To change the upstream version, edit `PINNED_SHA`, re-read LICENSE-DATA.md, rerun and review sections 4-6. '
             'To fix a wrong automatic pair, add `fedb:<id>,-,BLOCK: <reason>` (or the correct RepDB id) to `overrides.csv`.\n')
    L.append('Note for the app: the PWA precache pattern in `vite.config.ts` (`**/*.{js,css,html,svg,png,woff2,json}`) does not include '
             '`.webp`, so these images are fetched on demand and are only available offline if a runtime cache is added. '
             '`exercise-media.json` itself is precached.\n')
    REPORT.write_text('\n'.join(L), encoding='utf-8')


if __name__ == '__main__':
    main()
