"""Build public/data/exercises.json (Spanish exercise catalog) + EXERCISES_REPORT.md.

Run: python -I -X utf8 data-pipeline/exercises.py [--no-download]
Sources: Cawlumm/open-exercise-db (es snapshot) joined by source_id to yuhonas/free-exercise-db.
Raw downloads are treated as untrusted data (JSON parse only) and live in raw/exercises/.
"""
import base64, collections, datetime, hashlib, json, re, sys, unicodedata
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
RAW = HERE / 'raw' / 'exercises'
OUT = HERE.parent / 'public' / 'data' / 'exercises.json'
REPORT = HERE / 'EXERCISES_REPORT.md'
UA = {'User-Agent': 'salud-pwa/1.0 (personal non-commercial nutrition app)'}
BASE = 'https://cawlumm.github.io/open-exercise-db/v1/'
MANIFEST_URL = BASE + 'manifest.json'
FEDB_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json'
LICENSE_API = 'https://api.github.com/repos/Cawlumm/open-exercise-db/license'

LABELS_ES = {
    'muscles': {
        'abdominals': 'Abdominales', 'abductors': 'Abductores', 'adductors': 'Aductores', 'biceps': 'Bíceps',
        'calves': 'Pantorrillas', 'chest': 'Pecho', 'forearms': 'Antebrazos', 'glutes': 'Glúteos',
        'hamstrings': 'Isquiotibiales', 'lats': 'Dorsales', 'lower back': 'Zona lumbar',
        'middle back': 'Espalda media', 'neck': 'Cuello', 'quadriceps': 'Cuádriceps', 'shoulders': 'Hombros',
        'traps': 'Trapecios', 'triceps': 'Tríceps',
    },
    'equipment': {
        'barbell': 'Barra', 'dumbbell': 'Mancuernas', 'cable': 'Polea', 'machine': 'Máquina',
        'body only': 'Peso corporal', 'kettlebells': 'Pesa rusa', 'bands': 'Bandas elásticas',
        'medicine ball': 'Balón medicinal', 'exercise ball': 'Balón de estabilidad',
        'foam roll': 'Rodillo de espuma', 'e-z curl bar': 'Barra Z', 'other': 'Otro',
    },
    'category': {
        'strength': 'Fuerza', 'stretching': 'Estiramiento', 'cardio': 'Cardio', 'plyometrics': 'Pliometría',
        'powerlifting': 'Powerlifting', 'olympic weightlifting': 'Halterofilia', 'strongman': 'Strongman',
    },
}

# Colombian gym names. Keys = free-exercise-db ids (verified by name against the dataset).
OVERRIDES = {
    'Barbell_Hip_Thrust': {'nameEs': 'Hip thrust con barra', 'aliases': ['hip thrust', 'hip trust', 'empuje de cadera', 'hipthrust']},
    'Barbell_Bench_Press_-_Medium_Grip': {'nameEs': 'Press de banca plano con barra', 'aliases': ['press plano', 'pecho plano', 'banca', 'bench press', 'press banca', 'press de pecho plano']},
    'Dumbbell_Bench_Press': {'nameEs': 'Press de banca plano con mancuernas', 'aliases': ['press plano con mancuernas', 'pecho plano con mancuernas', 'press pecho mancuernas']},
    'Barbell_Incline_Bench_Press_-_Medium_Grip': {'nameEs': 'Press inclinado con barra', 'aliases': ['press inclinado', 'inclinado con barra', 'incline bench press', 'pecho inclinado']},
    'Incline_Dumbbell_Press': {'nameEs': 'Press inclinado con mancuernas', 'aliases': ['inclinado con mancuernas', 'incline dumbbell press', 'pecho inclinado con mancuernas']},
    'Barbell_Squat': {'nameEs': 'Sentadilla con barra', 'aliases': ['sentadilla libre', 'sentadilla', 'squat', 'back squat', 'sentadilla trasera']},
    'Hack_Squat': {'nameEs': 'Sentadilla hack', 'aliases': ['hack', 'hack squat', 'maquina hack', 'sentadilla en hack']},
    'Leg_Press': {'nameEs': 'Prensa de piernas', 'aliases': ['prensa', 'leg press', 'prensa 45', 'prensa inclinada']},
    'Barbell_Deadlift': {'nameEs': 'Peso muerto con barra', 'aliases': ['peso muerto', 'deadlift', 'muerto']},
    'Romanian_Deadlift': {'nameEs': 'Peso muerto rumano', 'aliases': ['rumano', 'peso muerto rumano', 'romanian deadlift', 'rdl']},
    'Bent_Over_Barbell_Row': {'nameEs': 'Remo con barra', 'aliases': ['remo', 'remo con barra', 'remo inclinado', 'barbell row']},
    'One-Arm_Dumbbell_Row': {'nameEs': 'Remo con mancuerna a un brazo', 'aliases': ['remo con mancuerna', 'remo unilateral', 'remo a una mano', 'dumbbell row']},
    'Seated_Cable_Rows': {'nameEs': 'Remo sentado en polea', 'aliases': ['remo en polea', 'remo sentado', 'remo polea baja', 'seated cable row']},
    'Wide-Grip_Lat_Pulldown': {'nameEs': 'Jalón al pecho', 'aliases': ['jalon', 'jalon al pecho', 'polea al pecho', 'lat pulldown', 'jalon dorsal']},
    'Pullups': {'nameEs': 'Dominadas', 'aliases': ['barra fija', 'pull ups', 'pull-ups', 'dominadas', 'pullups']},
    'Dips_-_Chest_Version': {'nameEs': 'Fondos en paralelas (pecho)', 'aliases': ['paralelas', 'dips', 'fondos', 'fondos en paralelas']},
    'Standing_Military_Press': {'nameEs': 'Press militar de pie', 'aliases': ['press militar', 'press de hombro', 'press de hombros', 'military press', 'overhead press']},
    'Side_Lateral_Raise': {'nameEs': 'Elevaciones laterales', 'aliases': ['vuelos laterales', 'laterales', 'elevaciones laterales', 'lateral raise']},
    'Face_Pull': {'nameEs': 'Face pull', 'aliases': ['face pull', 'facepull', 'jalon a la cara', 'jalon a la cara con cuerda']},
    'Barbell_Curl': {'nameEs': 'Curl de bíceps con barra', 'aliases': ['curl con barra', 'curl de biceps', 'biceps con barra', 'barbell curl']},
    'Hammer_Curls': {'nameEs': 'Curl martillo', 'aliases': ['martillo', 'curl martillo', 'hammer curl', 'biceps martillo']},
    'Triceps_Pushdown': {'nameEs': 'Extensión de tríceps en polea', 'aliases': ['triceps en polea', 'pushdown', 'triceps pushdown', 'extension de triceps en polea', 'jalon de triceps']},
    'Leg_Extensions': {'nameEs': 'Extensión de cuádriceps', 'aliases': ['extensiones', 'silla de cuadriceps', 'extension de piernas', 'extensiones de cuadriceps', 'leg extension']},
    'Lying_Leg_Curls': {'nameEs': 'Curl femoral acostado', 'aliases': ['femoral', 'curl de isquios', 'curl femoral', 'leg curl', 'femoral acostado']},
    'Thigh_Adductor': {'nameEs': 'Aductores en máquina', 'aliases': ['aductora', 'aductores', 'maquina de aductores', 'adductor machine']},
    'Thigh_Abductor': {'nameEs': 'Abductores en máquina', 'aliases': ['abductora', 'abductores', 'maquina de abductores', 'abductor machine']},
    'Standing_Calf_Raises': {'nameEs': 'Elevación de talones de pie', 'aliases': ['pantorrilla', 'gemelos', 'elevacion de talones', 'pantorrillas de pie', 'calf raise']},
    'Dumbbell_Lunges': {'nameEs': 'Zancadas con mancuernas', 'aliases': ['estocadas', 'lunges', 'zancadas', 'desplantes', 'lunge']},
    'Split_Squat_with_Dumbbells': {'nameEs': 'Sentadilla búlgara con mancuernas', 'aliases': ['bulgaras', 'sentadilla bulgara', 'bulgara', 'bulgarian split squat', 'sentadilla dividida']},
    'Dumbbell_Flyes': {'nameEs': 'Aperturas con mancuernas', 'aliases': ['aperturas', 'flyes', 'flys', 'aperturas planas', 'dumbbell fly']},
    'Butterfly': {'nameEs': 'Aperturas en máquina (pec deck)', 'aliases': ['pec deck', 'peck deck', 'aperturas en maquina', 'mariposa', 'contractora', 'aperturas', 'flyes en maquina']},
    'One-Legged_Cable_Kickback': {'nameEs': 'Patada de glúteo en polea', 'aliases': ['patada', 'patada de gluteo', 'patada de gluteo en polea', 'patada en polea', 'glute kickback']},
    'Barbell_Glute_Bridge': {'nameEs': 'Puente de glúteo con barra', 'aliases': ['glute bridge', 'puente de gluteo', 'puente de gluteos', 'puente de cadera']},
    'Crunches': {'nameEs': 'Crunch abdominal', 'aliases': ['abdominales', 'crunch', 'abdominal', 'abdominales crunch']},
    'Plank': {'nameEs': 'Plancha', 'aliases': ['plank', 'plancha abdominal', 'plancha isometrica']},
}

CARDIO_DISTANCE_RE = re.compile(r'running|jogging|walking|cycling|bicycling|bike|rowing|elliptical|skiing|swimming|treadmill|\brun\b|\bjog\b|\bwalk\b', re.I)
TIME_NAME_RE = re.compile(r'plank|\bholds?\b|isometric|wall sit|\bhang\b|static|l-sit', re.I)
VALID_TRACKING = {'weight_reps', 'bodyweight_reps', 'time', 'distance'}


def log(*a):
    print(*a, flush=True)


def fetch(url, dest):
    r = requests.get(url, headers=UA, timeout=120)
    r.raise_for_status()
    dest.write_bytes(r.content)
    return r.content


def strip_accents(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def tracking_type(name_en, category, equipment):
    if category == 'stretching':
        return 'time'
    if category == 'cardio':
        return 'distance' if CARDIO_DISTANCE_RE.search(name_en) else 'time'
    if TIME_NAME_RE.search(name_en):
        return 'time'
    if equipment in ('body only', None) and category in ('strength', 'plyometrics'):
        return 'bodyweight_reps'
    return 'weight_reps'


def aliases_for(name_es, name_en, extra):
    out, seen = [], set()
    for a in [*extra, name_es, name_en]:
        a = a.strip().lower()
        for v in (a, strip_accents(a)):
            if v and v not in seen:
                seen.add(v)
                out.append(v)
    return out


def main():
    download = '--no-download' not in sys.argv
    RAW.mkdir(parents=True, exist_ok=True)
    retrieved = datetime.date.today().isoformat()
    if download:
        manifest_bytes = fetch(MANIFEST_URL, RAW / 'manifest.json')
        manifest = json.loads(manifest_bytes)
        loc = next(l for l in manifest['locales'] if l['code'] == 'es')
        es_bytes = fetch(BASE + loc['file'], RAW / 'exercises.es.json')
        if hashlib.sha256(es_bytes).hexdigest() != loc['sha256']:
            raise SystemExit('sha256 mismatch for es snapshot')
        fetch(FEDB_URL, RAW / 'fedb.json')
        lic = json.loads(fetch(LICENSE_API, RAW / 'license_api.json'))
        (RAW / 'LICENSE.txt').write_text(base64.b64decode(lic['content']).decode('utf-8'), encoding='utf-8')
    manifest = json.loads((RAW / 'manifest.json').read_text(encoding='utf-8'))
    es_loc = next(l for l in manifest['locales'] if l['code'] == 'es')
    es = json.loads((RAW / 'exercises.es.json').read_text(encoding='utf-8'))['exercises']
    fedb = {x['id']: x for x in json.loads((RAW / 'fedb.json').read_text(encoding='utf-8'))}
    if not (RAW / 'LICENSE.txt').exists():
        lic = json.loads((RAW / 'license_api.json').read_text(encoding='utf-8'))
        (RAW / 'LICENSE.txt').write_text(base64.b64decode(lic['content']).decode('utf-8'), encoding='utf-8')
    license_head = (RAW / 'LICENSE.txt').read_text(encoding='utf-8').splitlines()[0]

    exercises, joined, unjoined, en_instr_fallback = [], 0, [], []
    for rec in es:
        sid = rec.get('source_id')
        fe = fedb.get(sid)
        if fe is None:
            unjoined.append(sid)
            continue
        joined += 1
        tr = rec['translation']
        name_es = (tr.get('name') or '').strip()
        name_en = fe['name'].strip()
        instr = [s.strip() for s in tr.get('instructions') or [] if s and s.strip()]
        if not instr:
            instr = [t.strip() for t in fe.get('instructions') or [] if t and t.strip()]  # English fallback
            en_instr_fallback.append(sid)
        equipment = fe.get('equipment')
        category = fe['category']
        exercises.append({
            'id': 'fedb:' + sid,
            'nameEs': name_es,
            'nameEn': name_en,
            'aliases': [],
            'primaryMuscles': list(fe.get('primaryMuscles') or []),
            'secondaryMuscles': list(fe.get('secondaryMuscles') or []),
            'equipment': equipment,
            'category': category,
            'level': fe.get('level'),
            'mechanic': fe.get('mechanic'),
            'force': fe.get('force'),
            'trackingType': tracking_type(name_en, category, equipment),
            'instructionsEs': instr,
        })

    by_id = {e['id']: e for e in exercises}
    applied, skipped = [], []
    extras = {}
    for fid, ov in OVERRIDES.items():
        e = by_id.get('fedb:' + fid)
        if e is None:
            skipped.append(fid)
            continue
        old = e['nameEs']
        if ov.get('nameEs'):
            e['nameEs'] = ov['nameEs']
        extras[e['id']] = list(ov['aliases']) + ([old] if old != e['nameEs'] else [])
        applied.append((fid, old, e['nameEs']))
    for e in exercises:
        e['aliases'] = aliases_for(e['nameEs'], e['nameEn'], extras.get(e['id'], []))

    # validation
    problems = []
    if len(exercises) < 870:
        log(f'NOTE: only {len(exercises)} exercises (< 870); source is smaller than expected')
    ids = [e['id'] for e in exercises]
    if len(set(ids)) != len(ids):
        problems.append('duplicate ids')
    for e in exercises:
        if not e['nameEs'] or not e['nameEn']:
            problems.append(f"empty name {e['id']}")
        if e['trackingType'] not in VALID_TRACKING:
            problems.append(f"bad trackingType {e['id']}")
        for m in e['primaryMuscles'] + e['secondaryMuscles']:
            if m not in LABELS_ES['muscles']:
                problems.append(f"muscle {m} {e['id']}")
        if e['equipment'] is not None and e['equipment'] not in LABELS_ES['equipment']:
            problems.append(f"equipment {e['equipment']} {e['id']}")
        if e['category'] not in LABELS_ES['category']:
            problems.append(f"category {e['category']} {e['id']}")
        if any(k in e for k in ('images', 'image', 'imageUrl', 'img')):
            problems.append(f"image field {e['id']}")
        # empty instructionsEs is allowed (5 exercises have none in either source; reported)
    if problems:
        raise SystemExit('VALIDATION FAILED:\n' + '\n'.join(problems[:50]))

    generated = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    dataset_version = (f"open-exercise-db es snapshot {manifest.get('published_at', '?')[:10]} "
                       f"(sha256 {es_loc['sha256'][:12]}); free-exercise-db main {retrieved}")
    doc = {
        'format': 'pho-catalog-exercises', 'version': 1,
        'source': 'open-exercise-db (es) + free-exercise-db',
        'datasetVersion': dataset_version, 'generatedAt': generated,
        'license': 'CC0-1.0 (open-exercise-db data) / Unlicense (free-exercise-db)',
        'attribution': 'Spanish exercise data: Cawlumm/open-exercise-db (CC0-1.0 data; MIT code, Copyright (c) 2026 cwlumm, https://github.com/Cawlumm/open-exercise-db); '
                       'exercise metadata: yuhonas/free-exercise-db (Unlicense, https://github.com/yuhonas/free-exercise-db). '
                       'Colombian gym aliases curated for Salud. No images included.',
        'labelsEs': LABELS_ES, 'exercises': exercises,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    size = OUT.stat().st_size

    cat = collections.Counter(e['category'] for e in exercises)
    eq = collections.Counter(e['equipment'] or 'null' for e in exercises)
    tt = collections.Counter(e['trackingType'] for e in exercises)
    for title, c in (('category', cat), ('equipment', eq), ('trackingType', tt)):
        log(title, dict(c.most_common()))
    log(f'exercises={len(exercises)} joined={joined} unjoined={len(unjoined)} size={size} bytes')
    log(f'overrides applied={len(applied)} skipped={skipped}')

    def table(c):
        return '\n'.join(f'| {k} | {v} |' for k, v in c.most_common())

    ov_rows = '\n'.join(f'| {a} | {b} | {c} |' for a, b, c in applied)
    fallback = ', '.join(en_instr_fallback)
    rep = f"""# Exercise catalog report

Generated by `data-pipeline/exercises.py` on {retrieved} (UTC {generated}).

## Sources and licenses
- Spanish snapshot: Cawlumm/open-exercise-db, manifest `{MANIFEST_URL}` -> `{BASE}{es_loc['file']}` (sha256 verified, {es_loc['total']} records, published {manifest.get('published_at')}).
  - Repo license on GitHub (`{LICENSE_API}`): **{license_head}** (Copyright (c) 2026 cwlumm). The repository code license is MIT; database content is CC0-1.0 under https://github.com/Cawlumm/open-exercise-db/blob/main/DATA_LICENSE. The per-record `license` field in the data says `Unlicense` (inherited from free-exercise-db). Attribution is carried in the output `attribution` field. The output `license` field is `CC0-1.0 (open-exercise-db data) / Unlicense (free-exercise-db)`.
- English metadata: yuhonas/free-exercise-db `{FEDB_URL}` (Unlicense / public domain), retrieved {retrieved}.
- Retrieval date: {retrieved}. Raw files are in `data-pipeline/raw/exercises/` (gitignored, parsed only).

## Join
- Joined by Cawlumm `source_id` == free-exercise-db `id`: **{joined}** of {len(es)} Spanish records; unjoined: {len(unjoined)}. free-exercise-db has {len(fedb)} entries ({len(fedb) - joined} have no Spanish record and are excluded).
- Muscles, equipment, category, level, mechanic, force and English names come from free-exercise-db (canonical keys; Cawlumm uses hyphenated keys and a single `muscle_group`, so it was not used for these). Spanish name and instructions come from Cawlumm.
- Final exercise count: **{len(exercises)}**. Output: `public/data/exercises.json`, {size:,} bytes.

## Counts
| category | n |
|---|---|
{table(cat)}

| equipment | n |
|---|---|
{table(eq)}

| trackingType | n |
|---|---|
{table(tt)}

## trackingType rules (first match wins)
1. category `stretching` -> `time`
2. category `cardio` -> `distance` if the English name matches running/jogging/walking/cycling/bicycling/bike/rowing/elliptical/skiing/swimming (also treadmill, run, jog, walk as whole words), else `time`
3. English name matches plank, hold(s), isometric, wall sit, `hang` (whole word, so "Hanging Leg Raise" stays reps), static, l-sit -> `time`
4. equipment `body only` or null (no equipment) with category strength/plyometrics -> `bodyweight_reps` (null-equipment extension: free-exercise-db leaves bodyweight moves without equipment as null)
5. otherwise `weight_reps`

## Colombian gym overrides
Applied ({len(applied)}): nameEs may be replaced; the original Spanish name is kept as an alias. Aliases are lowercase with accent-free variants.

| id | original nameEs | display nameEs |
|---|---|---|
{ov_rows}

Skipped (no matching id): {skipped or 'none'}

Matching notes: "sentadilla bulgara" maps to `Split_Squat_with_Dumbbells` (no exact Bulgarian split squat entry exists); "aperturas" is aliased on both dumbbell flyes and the pec-deck machine; "puente de gluteo" maps to the barbell glute bridge (the bodyweight version exists only single-leg); "patada de gluteo en polea" maps to the one-legged cable kickback.

## Limitations
- The source flags names and instructions as not machine translated (`*_machine_origin=false`), but the wording can be literal or inconsistent (e.g. "Aductor con rodillo de espuma"). Several names keep English terms (face pull, kettlebell, pec deck).
- {len(en_instr_fallback)} exercises have no instructions in either source (instructionsEs is an empty array): {fallback or 'none'}.
- No images or image URLs are included (provenance unknown).
- The source has no Spanish aliases (all empty); aliases are our own plus the overrides above.
- Muscle assignment follows free-exercise-db (the primary list may have several entries).
"""
    REPORT.write_text(rep, encoding='utf-8')


if __name__ == '__main__':
    main()
