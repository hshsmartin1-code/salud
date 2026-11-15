# RepDB exercise illustrations - build report

Generated 2026-11-15T15:46:40Z by `data-pipeline/repdb/build_repdb.py` from [RepDB/exercise-dataset@f12da458a90f](https://github.com/RepDB/exercise-dataset/tree/f12da458a90f353a86c953f204304d5a8bd98275) (full SHA `f12da458a90f353a86c953f204304d5a8bd98275`; exercises.json sha256 `ad7c602fcc6bd4322b6228673c0fff5ad60b87f219352d44f9b92a763835948f`).

## 1. License audit (RepDB free tier)

Sources read on 2026-11-15: [`LICENSE-DATA.md`](https://github.com/RepDB/exercise-dataset/blob/f12da458a90f353a86c953f204304d5a8bd98275/LICENSE-DATA.md) and [`ATTRIBUTION.md`](https://github.com/RepDB/exercise-dataset/blob/f12da458a90f353a86c953f204304d5a8bd98275/ATTRIBUTION.md)
at the pinned commit, the repo [README](https://github.com/RepDB/exercise-dataset/blob/f12da458a90f353a86c953f204304d5a8bd98275/README.md),
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

## 2. Source schema facts (verified on the pinned commit)

* `exercises.json`: object `{name, homepage, license, schema_version, count, note, exercises[]}`, schema_version 3, count 708, 708 records (the task brief said ~701; the current snapshot has 708).
* Exercise id: URL-safe lowercase slug, e.g. `bulgarian-split-squat`; ids are unique.
* Languages: `name_*`, `description_*`, `instructions_*` (array), `tips_*` (array) in `en`, `de`, `es` for every record (no empty Spanish instructions found).
* Other fields: category, force_type, mechanic, difficulty, equipment (absent = bodyweight), body_part, primary_muscles, secondary_muscles, goals, tags, variation_group, met, is_unilateral, is_bodyweight, images.
* Images: `images.flat.start` + `images.flat.peak` for 523 exercises, a single `images.flat.main` for 185 (holds/stretches); path `images/flat/<id>-<pose>.webp`; 1231 image files, no path shared between ids.
* Format: WebP, 512x512, RGB (no alpha channel), flat style on a solid light-blue background (checked with Pillow). There is no separate "end" pose: the second pose is called `peak`. Note: some near-identical variants carry visually identical pictures (e.g. `standing-calf-raise` and `machine-calf-raise`).
* Also in the repo, not used: 29 muscle icons and 64 equipment icons (`images/muscles`, `images/equipment`), `premium-samples/` (evaluation-only).

## 3. Counts

| Item | Count |
|---|---|
| RepDB exercises at pinned commit | 708 |
| Existing catalog exercises (fedb) | 873 |
| fedb exercises mapped (shipped) | 171 |
| ... confidence high (overrides) | 91 |
| ... confidence high (automatic, exact name) | 62 |
| ... confidence medium (automatic) | 18 |
| fedb exercises unmapped | 702 |
| ... of which manually blocked | 16 |
| Distinct RepDB exercises used | 170 |
| RepDB source images used (start/peak/main of mapped exercises) | 334 |
| RepDB images in the local download cache (incl. audit probes / later-blocked) | 338 |
| Thumbnails written (160x160 WebP, from peak/main pose) | 170 |
| Detail images written (512x512 WebP) | 334 |
| ... copied verbatim (already WebP <= 45 KB, no upscaling) | 334 |
| ... re-encoded | 0 |
| Spanish instructions added (ours were empty) | 2 |
| Total bytes in public/exercise-media/ | 6,184,852 (5.90 MiB; budget 20 MiB) |
| Thumbnail bytes min / median / max | 962 / 2,084 / 3,928 |
| Detail bytes min / median / max | 7,942 / 16,460 / 38,040 |

All thumbnails are <= 8 KB and all detail images <= 45 KB (enforced by the script). Detail images are 512 px (not ~600 px) because the source is 512 px and the license treats upscaled derivatives as restricted.

Spanish instructions taken from RepDB for: `fedb:One-Arm_Kettlebell_Swings`, `fedb:Push_Press`.

RepDB records used by more than one fedb exercise: `seated-db-press` <- `fedb:Dumbbell_Shoulder_Press`, `fedb:Seated_Dumbbell_Press`.

## 4. Common lifts: hand-verified overrides (`overrides.csv`)

Each pair was verified by reading both records (names, equipment, Spanish instructions vs RepDB instructions). Frequently used barbell/machine lifts (hack squat, rows, hip thrust) were checked first, including their RepDB peak images. In addition, every shipped thumbnail (overrides and automatic) was reviewed by eye on contact sheets on 2026-11-15; that review caused the `Hanging_Leg_Raise` block. Start-pose images were not all viewed individually. "Auto-check" shows whether the pair would also pass the automatic equipment/muscle/variant rules (failures here are labelling differences that were accepted after reading both records).

| fedb id | RepDB id | RepDB name | Auto-check | Note |
|---|---|---|---|---|
| `fedb:Barbell_Squat` | `squat` | Barbell Back Squat | pass | back squat; bar on upper traps in both records; image checked |
| `fedb:Front_Barbell_Squat` | `front-squat` | Front Squat | pass | barbell front-rack squat in both |
| `fedb:Smith_Machine_Squat` | `smith-machine-squat` | Smith Machine Squat | pass | Smith machine back squat in both |
| `fedb:Hack_Squat` | `hack-squat` | Hack Squat | pass | hack squat machine; image checked |
| `fedb:Goblet_Squat` | `goblet-squat` | Goblet Squat | pass | kettlebell held at chest in both |
| `fedb:Bodyweight_Squat` | `bodyweight-squat` | Bodyweight Squat | pass | air squat in both |
| `fedb:Leg_Press` | `leg-press` | Leg Press | pass | 45-degree sled leg press; image checked (not the horizontal variant) |
| `fedb:Leg_Extensions` | `leg-extension` | Leg Extension | pass | seated leg extension machine |
| `fedb:Lying_Leg_Curls` | `leg-curl` | Lying Leg Curl | pass | prone leg curl machine in both |
| `fedb:Seated_Leg_Curl` | `seated-leg-curl` | Seated Leg Curl | pass | seated leg curl machine |
| `fedb:Standing_Calf_Raises` | `standing-calf-raise` | Standing Calf Raise | pass | shoulder-pad standing calf machine; image checked |
| `fedb:Seated_Calf_Raise` | `seated-calf-raise` | Seated Calf Raise | pass | seated calf machine with thigh pads |
| `fedb:Thigh_Abductor` | `hip-abduction` | Machine Hip Abduction | primary muscles ['hip_ab_ad'] vs ['glutes'] | seated hip abduction machine |
| `fedb:Thigh_Adductor` | `hip-adduction` | Hip Adduction | pass | seated hip adduction machine |
| `fedb:Barbell_Bench_Press_-_Medium_Grip` | `bench-press` | Barbell Bench Press | pass | flat barbell bench press |
| `fedb:Barbell_Incline_Bench_Press_-_Medium_Grip` | `incline-bench-press` | Incline Barbell Bench Press | pass | incline barbell bench press |
| `fedb:Decline_Barbell_Bench_Press` | `decline-bench-press-barbell` | Decline Barbell Bench Press | pass | decline barbell bench press |
| `fedb:Dumbbell_Bench_Press` | `db-bench-press` | Dumbbell Bench Press | pass | flat dumbbell bench press |
| `fedb:Incline_Dumbbell_Press` | `incline-db-press` | Incline Dumbbell Press | pass | incline dumbbell press |
| `fedb:Decline_Dumbbell_Bench_Press` | `decline-bench-press` | Decline Bench Press | pass | RepDB record 'Decline Bench Press' is the dumbbell version (equipment dumbbell) |
| `fedb:Close-Grip_Barbell_Bench_Press` | `close-grip-bench-press` | Close-Grip Bench Press | pass | shoulder-width grip barbell bench in both |
| `fedb:Smith_Machine_Bench_Press` | `smith-machine-bench-press` | Smith Machine Bench Press | pass | flat bench inside Smith machine |
| `fedb:Smith_Machine_Incline_Bench_Press` | `smith-machine-incline-bench-press` | Smith Machine Incline Bench Press | pass | incline bench inside Smith machine |
| `fedb:Leverage_Chest_Press` | `chest-press-machine` | Machine Chest Press | pass | seated machine chest press (lever vs selectorised; same pattern) |
| `fedb:Dumbbell_Flyes` | `db-fly` | Dumbbell Fly | pass | flat dumbbell fly |
| `fedb:Incline_Dumbbell_Flyes` | `incline-dumbbell-fly` | Incline Dumbbell Fly | pass | incline dumbbell fly |
| `fedb:Decline_Dumbbell_Flyes` | `decline-db-fly` | Decline Dumbbell Fly | pass | decline dumbbell fly |
| `fedb:Butterfly` | `pec-deck` | Pec Deck | pass | pec deck machine |
| `fedb:Cable_Crossover` | `cable-fly` | Cable Fly | pass | standing cable fly from high pulleys in both |
| `fedb:Pushups` | `push-up` | Push-Up | pass | standard push-up |
| `fedb:Dips_-_Chest_Version` | `dips` | Chest Dips | fedb equipment 'other' not specific | RepDB 'dips' is 'Chest Dips' on parallel bars |
| `fedb:Bench_Dips` | `bench-dips` | Bench Dips | pass | hands on bench behind the body |
| `fedb:Barbell_Deadlift` | `deadlift` | Barbell Deadlift | pass | conventional barbell deadlift |
| `fedb:Romanian_Deadlift` | `romanian-deadlift` | Romanian Deadlift | pass | barbell RDL from standing |
| `fedb:Stiff-Legged_Barbell_Deadlift` | `stiff-leg-deadlift` | Stiff Leg Deadlift | pass | barbell stiff-leg deadlift |
| `fedb:Sumo_Deadlift` | `sumo-deadlift` | Sumo Deadlift | primary muscles ['hamstrings'] vs ['glutes', 'quads'] | same lift; primary-muscle labels differ (fedb hamstrings vs RepDB glutes/quads) |
| `fedb:Good_Morning` | `good-morning` | Good Morning | pass | barbell good morning |
| `fedb:Barbell_Hip_Thrust` | `hip-thrust` | Barbell Hip Thrust | pass | barbell hip thrust against bench; image checked |
| `fedb:Barbell_Glute_Bridge` | `barbell-glute-bridge` | Barbell Glute Bridge | pass | barbell glute bridge on the floor |
| `fedb:One-Legged_Cable_Kickback` | `cable-kickback` | Cable Glute Kickback | variant tokens differ: singleleg | ankle cuff on low pulley |
| `fedb:Glute_Kickback` | `glute-kickback` | Glute Kickback | pass | bodyweight kickback on all fours |
| `fedb:Dumbbell_Lunges` | `db-lunge` | Dumbbell Lunge | pass | forward lunge holding dumbbells |
| `fedb:Barbell_Lunge` | `barbell-lunge` | Barbell Lunge | pass | forward lunge with bar on upper back |
| `fedb:Dumbbell_Rear_Lunge` | `reverse-lunge` | Reverse Lunge | variant tokens differ: rear,reverse | RepDB 'Reverse Lunge' is the dumbbell version (equipment dumbbell) |
| `fedb:Split_Squat_with_Dumbbells` | `bulgarian-split-squat` | Bulgarian Split Squat | variant tokens differ: bulgarian | fedb text: rear foot elevated; RepDB bulgarian split squat with dumbbells |
| `fedb:Pullups` | `pull-up` | Pull-Up | pass | overhand pull-up |
| `fedb:Chin-Up` | `chin-ups` | Chin-Ups | pass | underhand chin-up |
| `fedb:Wide-Grip_Lat_Pulldown` | `lat-pulldown` | Lat Pulldown | variant tokens differ: widegrip | RepDB instructions: wide bar with overhand grip |
| `fedb:One_Arm_Lat_Pulldown` | `one-arm-lat-pulldown` | One-Arm Lat Pulldown | pass | single-handle pulldown |
| `fedb:Seated_Cable_Rows` | `seated-cable-row` | Seated Cable Row | pass | seated low-pulley row with close handle; image checked |
| `fedb:Bent_Over_Barbell_Row` | `barbell-row` | Bent-Over Barbell Row | pass | bent-over barbell row; image checked |
| `fedb:Reverse_Grip_Bent-Over_Rows` | `reverse-grip-bent-over-row` | Reverse Grip Bent Over Row | pass | underhand bent-over barbell row |
| `fedb:One-Arm_Dumbbell_Row` | `single-arm-db-row` | Single-Arm Dumbbell Row | pass | knee and hand on bench; image checked |
| `fedb:Bent_Over_Two-Dumbbell_Row` | `bent-over-db-row` | Bent-Over Dumbbell Row | variant tokens differ: two | two dumbbells; neutral grip in both |
| `fedb:T-Bar_Row_with_Handle` | `t-bar-row` | T-Bar Row | pass | landmine/T-bar row straddling the bar |
| `fedb:Inverted_Row` | `inverted-row` | Inverted Row | equipment bodyweight != barbell | bodyweight row under a racked bar (fedb equipment field empty) |
| `fedb:Standing_Military_Press` | `ohp` | Barbell Overhead Press | variant tokens differ: military,overhead,standing | standing barbell overhead press |
| `fedb:Seated_Barbell_Military_Press` | `seated-barbell-overhead-press` | Seated Barbell Overhead Press | variant tokens differ: military,overhead | seated barbell press in front of the head |
| `fedb:Seated_Dumbbell_Press` | `seated-db-press` | Seated Dumbbell Shoulder Press | pass | seated dumbbell shoulder press with back support |
| `fedb:Dumbbell_Shoulder_Press` | `seated-db-press` | Seated Dumbbell Shoulder Press | variant tokens differ: seated | fedb text is seated; RepDB dumbbell-shoulder-press image is standing so not used |
| `fedb:Arnold_Dumbbell_Press` | `arnold-press` | Arnold Press | pass | Arnold press |
| `fedb:Leverage_Shoulder_Press` | `machine-shoulder-press` | Machine Shoulder Press | pass | seated machine shoulder press (lever vs selectorised; same pattern) |
| `fedb:Side_Lateral_Raise` | `lateral-raise` | Dumbbell Lateral Raise | variant tokens differ: side | standing dumbbell lateral raise |
| `fedb:Face_Pull` | `face-pull` | Cable Face Pull | pass | rope on high pulley |
| `fedb:Upright_Barbell_Row` | `upright-row` | Barbell Upright Row | pass | barbell upright row |
| `fedb:Reverse_Machine_Flyes` | `machine-reverse-fly` | Machine Reverse Fly | pass | reverse pec deck |
| `fedb:Barbell_Shrug` | `shrug` | Barbell Shrug | pass | barbell shrug |
| `fedb:Dumbbell_Shrug` | `db-shrug` | Dumbbell Shrug | pass | dumbbell shrug |
| `fedb:Barbell_Curl` | `barbell-curl` | Barbell Curl | pass | standing barbell curl |
| `fedb:Dumbbell_Bicep_Curl` | `bicep-curl` | Dumbbell Bicep Curl | pass | standing dumbbell curl palms forward |
| `fedb:Hammer_Curls` | `hammer-curl` | Dumbbell Hammer Curl | pass | standing neutral-grip dumbbell curl |
| `fedb:EZ-Bar_Curl` | `ez-bar-curl` | EZ-Bar Curl | pass | standing EZ-bar curl |
| `fedb:Concentration_Curls` | `concentration-curl` | Concentration Curl | pass | seated concentration curl |
| `fedb:Incline_Dumbbell_Curl` | `incline-db-curl` | Incline Dumbbell Curl | pass | curl on incline bench |
| `fedb:Machine_Bicep_Curl` | `machine-bicep-curl` | Machine Bicep Curl | pass | biceps curl machine |
| `fedb:Triceps_Pushdown` | `tricep-pushdown` | Cable Tricep Pushdown | pass | straight-bar cable pushdown |
| `fedb:Triceps_Pushdown_-_V-Bar_Attachment` | `v-bar-tricep-pushdown` | V-Bar Tricep Pushdown | pass | V-bar cable pushdown |
| `fedb:EZ-Bar_Skullcrusher` | `ez-bar-lying-tricep-extension` | EZ-Bar Lying Triceps Extension | variant tokens differ: lying | lying EZ-bar triceps extension (skull crusher) |
| `fedb:Machine_Triceps_Extension` | `machine-triceps-extension` | Machine Triceps Extension | pass | triceps extension machine |
| `fedb:Plank` | `plank` | Plank | pass | forearm plank |
| `fedb:Crunches` | `crunches` | Crunches | pass | floor crunch |
| `fedb:Sit-Up` | `sit-ups` | Sit-Ups | pass | anchored sit-up |
| `fedb:Cable_Crunch` | `cable-crunch` | Cable Crunch | pass | kneeling rope cable crunch |
| `fedb:Ab_Crunch_Machine` | `machine-seated-crunch` | Machine Seated Crunch | variant tokens differ: seated | seated ab crunch machine |
| `fedb:Russian_Twist` | `russian-twist` | Russian Twist | pass | seated trunk rotation |
| `fedb:Mountain_Climbers` | `mountain-climbers` | Mountain Climbers | primary muscles ['quads'] vs ['core'] | same drill; primary-muscle labels differ (fedb quadriceps vs RepDB core/hip flexors) |
| `fedb:Hyperextensions_Back_Extensions` | `back-extension` | Back Extension | fedb equipment 'other' not specific | hyperextension bench |
| `fedb:Weighted_Pull_Ups` | `weighted-pull-up` | Weighted Pull-Up | fedb equipment 'other' not specific | pull-up with load on a dip belt in both (fedb equipment field 'other') |
| `fedb:Ab_Roller` | `ab-wheel-rollout` | Ab Wheel Rollout | fedb equipment 'other' not specific | kneeling ab wheel rollout (fedb equipment field 'other') |
| `fedb:Floor_Press` | `floor-press` | Floor Press | primary muscles ['triceps'] vs ['chest'] | barbell floor press from a rack; primary-muscle labels differ (fedb triceps vs RepDB chest) |
| `fedb:Dumbbell_Floor_Press` | `dumbbell-floor-press` | Dumbbell Floor Press | primary muscles ['triceps'] vs ['chest'] | dumbbell floor press; primary-muscle labels differ (fedb triceps vs RepDB chest) |

Manually blocked (never illustrated): `fedb:Hanging_Leg_Raise` (RepDB hanging-leg-raise peak image shows bent knees (knee-raise posture); fedb is a straight-leg raise); `fedb:Preacher_Curl` (fedb equipment says barbell but its text uses an EZ bar; RepDB has both versions); `fedb:Dips_-_Triceps_Version` (RepDB 'dips' is the chest version (forward lean)); `fedb:Triceps_Pushdown_-_Rope_Attachment` (RepDB pushdown uses a straight bar; no rope version); `fedb:Reverse_Flyes` (fedb is chest-supported on an incline bench; RepDB reverse flies are standing hip-hinge); `fedb:Close-Grip_Front_Lat_Pulldown` (fedb uses close overhand grip on a wide bar; RepDB uses a parallel V-handle); `fedb:Smith_Machine_Calf_Raise` (fedb bar on shoulders; RepDB bar held behind thighs); `fedb:Donkey_Calf_Raises` (fedb uses a donkey calf machine; RepDB is bodyweight); `fedb:Seated_Bent-Over_Rear_Delt_Raise` (fedb seated; RepDB rear-delt-fly is standing); `fedb:Cable_Rear_Delt_Fly` (fedb pulleys above head; RepDB pulleys at shoulder height); `fedb:Farmers_Walk` (fedb uses farmer's walk implements; RepDB uses dumbbells); `fedb:Calf_Raise_On_A_Dumbbell` (fedb stands on a dumbbell handle; RepDB holds dumbbells); `fedb:Squats_-_With_Bands` (fedb band under the feet as resistance; RepDB loop band above the knees); `fedb:Cable_One_Arm_Tricep_Extension` (fedb uses a supinated single-arm grip; RepDB pushdown grip differs/unspecified); `fedb:Overhead_Triceps` (fedb is a partner-assisted seated stretch; RepDB is a standing self stretch); `fedb:Lying_Dumbbell_Tricep_Extension` (fedb uses two dumbbells; RepDB one dumbbell held in both hands).

## 5. Automatic mappings (shipped)

| fedb id | fedb name | RepDB id | RepDB name | confidence | evidence |
|---|---|---|---|---|---|
| `fedb:Band_Assisted_Pull-Up` | Band Assisted Pull-Up | `band-assisted-pull-ups` | Band Assisted Pull Ups | high | exact_en+tokenset+alias |
| `fedb:Band_Pull_Apart` | Band Pull Apart | `band-pull-apart` | Band Pull Apart | high | exact_en+tokenset+exact_es+alias |
| `fedb:Barbell_Ab_Rollout` | Barbell Ab Rollout | `barbell-ab-rollout` | Barbell Ab Rollout | high | exact_en+tokenset+exact_es+alias |
| `fedb:Barbell_Rear_Delt_Row` | Barbell Rear Delt Row | `barbell-rear-delt-row` | Barbell Rear Delt Row | high | exact_en+tokenset+alias |
| `fedb:Bent-Arm_Barbell_Pullover` | Bent-Arm Barbell Pullover | `bent-arm-barbell-pullover` | Bent Arm Barbell Pullover | high | exact_en+tokenset+exact_es+alias |
| `fedb:Cable_Chest_Press` | Cable Chest Press | `cable-chest-press` | Cable Chest Press | high | exact_en+tokenset+alias |
| `fedb:Cable_Wrist_Curl` | Cable Wrist Curl | `cable-wrist-curl` | Cable Wrist Curl | high | exact_en+tokenset+alias |
| `fedb:Cat_Stretch` | Cat Stretch | `cat-stretch` | Cat Stretch | high | exact_en+tokenset+exact_es+alias |
| `fedb:Childs_Pose` | Child's Pose | `childs-pose` | Child's Pose | high | exact_en+tokenset+exact_es+alias |
| `fedb:Clean_and_Jerk` | Clean and Jerk | `clean-and-jerk` | Clean and Jerk | high | exact_en+tokenset+alias |
| `fedb:Close-Grip_EZ_Bar_Curl` | Close-Grip EZ Bar Curl | `close-grip-ez-bar-curl` | Close-Grip EZ-Bar Curl | high | exact_en+tokenset+exact_es+alias |
| `fedb:Cocoons` | Cocoons | `cocoons` | Cocoons | high | exact_en+tokenset+alias |
| `fedb:Cross-Body_Crunch` | Cross-Body Crunch | `cross-body-crunch` | Cross-Body Crunch | high | exact_en+tokenset+exact_es+alias |
| `fedb:Cross_Body_Hammer_Curl` | Cross Body Hammer Curl | `cross-body-hammer-curl` | Cross Body Hammer Curl | high | exact_en+tokenset+exact_es+alias |
| `fedb:Dead_Bug` | Dead Bug | `dead-bug` | Dead Bug | high | exact_en+tokenset+alias |
| `fedb:Decline_Crunch` | Decline Crunch | `decline-crunch` | Decline Crunch | high | exact_en+tokenset+alias |
| `fedb:Decline_Push-Up` | Decline Push-Up | `decline-push-up` | Decline Push-Up | high | exact_en+tokenset+alias |
| `fedb:Deficit_Deadlift` | Deficit Deadlift | `deficit-deadlift` | Deficit Deadlift | high | exact_en+tokenset+alias |
| `fedb:Double_Kettlebell_Jerk` | Double Kettlebell Jerk | `double-kettlebell-jerk` | Double Kettlebell Jerk | high | exact_en+tokenset+alias |
| `fedb:Double_Kettlebell_Push_Press` | Double Kettlebell Push Press | `double-kettlebell-push-press` | Double Kettlebell Push Press | high | exact_en+tokenset+alias |
| `fedb:Drag_Curl` | Drag Curl | `drag-curl` | Drag Curl | high | exact_en+tokenset+alias |
| `fedb:Dumbbell_Side_Bend` | Dumbbell Side Bend | `dumbbell-side-bend` | Dumbbell Side Bend | high | exact_en+tokenset+exact_es+alias |
| `fedb:Dumbbell_Squat` | Dumbbell Squat | `db-squat` | Dumbbell Squat | high | exact_en+tokenset+exact_es+alias |
| `fedb:Elliptical_Trainer` | Elliptical Trainer | `elliptical-trainer` | Elliptical Trainer | high | exact_en+tokenset+exact_es+alias |
| `fedb:Front_Dumbbell_Raise` | Front Dumbbell Raise | `dumbbell-front-raise` | Dumbbell Front Raise | high | tokenset+exact_es+alias |
| `fedb:Handstand_Push-Ups` | Handstand Push-Ups | `handstand-push-ups` | Handstand Push Ups | high | exact_en+tokenset+alias |
| `fedb:Hang_Clean` | Hang Clean | `hang-clean` | Hang Clean | high | exact_en+tokenset+alias |
| `fedb:Hanging_Pike` | Hanging Pike | `hanging-pike` | Hanging Pike | high | exact_en+tokenset+alias |
| `fedb:Incline_Hammer_Curls` | Incline Hammer Curls | `incline-hammer-curl` | Incline Hammer Curl | high | exact_en+tokenset+exact_es+alias |
| `fedb:Incline_Push-Up` | Incline Push-Up | `incline-push-ups` | Incline Push-Up | high | exact_en+tokenset+alias |
| `fedb:Jackknife_Sit-Up` | Jackknife Sit-Up | `jackknife-sit-up` | Jackknife Sit-Up | high | exact_en+tokenset+alias |
| `fedb:Kettlebell_One-Legged_Deadlift` | Kettlebell One-Legged Deadlift | `kettlebell-single-leg-deadlift` | Kettlebell Single Leg Deadlift | high | exact_en+tokenset+alias |
| `fedb:Kettlebell_Pistol_Squat` | Kettlebell Pistol Squat | `kettlebell-pistol-squat` | Kettlebell Pistol Squat | high | exact_en+tokenset+alias |
| `fedb:Kettlebell_Sumo_High_Pull` | Kettlebell Sumo High Pull | `kettlebell-sumo-high-pull` | Kettlebell Sumo High Pull | high | exact_en+tokenset+alias |
| `fedb:Kettlebell_Windmill` | Kettlebell Windmill | `kettlebell-windmills` | Kettlebell Windmills | high | exact_en+tokenset+alias |
| `fedb:Machine_Preacher_Curls` | Machine Preacher Curls | `machine-preacher-curl` | Machine Preacher Curl | high | exact_en+tokenset+alias |
| `fedb:One-Arm_Kettlebell_Floor_Press` | One-Arm Kettlebell Floor Press | `one-arm-kettlebell-floor-press` | One Arm Kettlebell Floor Press | high | exact_en+tokenset+alias |
| `fedb:One-Arm_Kettlebell_Push_Press` | One-Arm Kettlebell Push Press | `one-arm-kettlebell-push-press` | One Arm Kettlebell Push Press | high | exact_en+tokenset+alias |
| `fedb:One-Arm_Kettlebell_Row` | One-Arm Kettlebell Row | `one-arm-kettlebell-row` | One Arm Kettlebell Row | high | exact_en+tokenset+alias |
| `fedb:One-Arm_Kettlebell_Swings` | One-Arm Kettlebell Swings | `one-arm-kettlebell-swing` | One Arm Kettlebell Swing | high | exact_en+tokenset+alias |
| `fedb:One_Arm_Dumbbell_Bench_Press` | One Arm Dumbbell Bench Press | `single-arm-dumbbell-bench-press` | Single Arm Dumbbell Bench Press | high | exact_en+tokenset+exact_es+alias |
| `fedb:One_Arm_Dumbbell_Preacher_Curl` | One Arm Dumbbell Preacher Curl | `one-arm-dumbbell-preacher-curl` | One Arm Dumbbell Preacher Curl | high | exact_en+tokenset+exact_es+alias |
| `fedb:Overhead_Squat` | Overhead Squat | `overhead-squat` | Overhead Squat | high | exact_en+tokenset+alias |
| `fedb:Physioball_Hip_Bridge` | Physioball Hip Bridge | `stability-ball-hip-bridge` | Stability Ball Hip Bridge | high | tokenset+exact_es+alias |
| `fedb:Plyo_Push-up` | Plyo Push-up | `plyo-push-up` | Plyo Push-Up | high | exact_en+tokenset+alias |
| `fedb:Pull_Through` | Pull Through | `cable-pull-through` | Cable Pull-Through | high | tokenset+exact_es+alias |
| `fedb:Push_Press` | Push Press | `push-press` | Push Press | high | exact_en+tokenset+alias |
| `fedb:Rack_Pulls` | Rack Pulls | `rack-pull` | Rack Pull | high | exact_en+tokenset+exact_es+alias |
| `fedb:Ring_Dips` | Ring Dips | `ring-dips` | Ring Dips | high | exact_en+tokenset+exact_es+alias |
| `fedb:Scapular_Pull-Up` | Scapular Pull-Up | `scapular-pull-ups` | Scapular Pull Ups | high | exact_en+tokenset+alias |
| `fedb:Seated_Dumbbell_Curl` | Seated Dumbbell Curl | `seated-dumbbell-curl` | Seated Dumbbell Curl | high | exact_en+tokenset+alias |
| `fedb:Single_Leg_Glute_Bridge` | Single Leg Glute Bridge | `single-leg-glute-bridge` | Single Leg Glute Bridge | high | exact_en+tokenset+exact_es+alias |
| `fedb:Smith_Machine_Bent_Over_Row` | Smith Machine Bent Over Row | `smith-machine-bent-over-row` | Smith Machine Bent Over Row | high | exact_en+tokenset+alias |
| `fedb:Smith_Machine_Upright_Row` | Smith Machine Upright Row | `smith-machine-upright-row` | Smith Machine Upright Row | high | exact_en+tokenset+exact_es+alias |
| `fedb:Snatch` | Snatch | `snatch` | Snatch | high | exact_en+tokenset+alias |
| `fedb:Split_Jerk` | Split Jerk | `split-jerk` | Split Jerk | high | exact_en+tokenset+alias |
| `fedb:Straight-Arm_Pulldown` | Straight-Arm Pulldown | `straight-arm-pulldown` | Straight-Arm Pulldown | high | exact_en+tokenset+exact_es+alias |
| `fedb:Trap_Bar_Deadlift` | Trap Bar Deadlift | `hex-bar-deadlift` | Hex Bar Deadlift | high | exact_en+tokenset+exact_es+alias |
| `fedb:Tricep_Dumbbell_Kickback` | Tricep Dumbbell Kickback | `tricep-kickback` | Dumbbell Tricep Kickback | high | tokenset+exact_es+alias |
| `fedb:Worlds_Greatest_Stretch` | World's Greatest Stretch | `worlds-greatest-stretch` | World's Greatest Stretch | high | exact_en+tokenset+alias |
| `fedb:Zercher_Squats` | Zercher Squats | `zercher-squat` | Zercher Squat | high | exact_en+tokenset+exact_es+alias |
| `fedb:Zottman_Curl` | Zottman Curl | `zottman-curl` | Zottman Curl | high | exact_en+tokenset+exact_es+alias |
| `fedb:Ball_Leg_Curl` | Ball Leg Curl | `ball-leg-curl` | Stability Ball Leg Curl | medium | tokenset |
| `fedb:Band_Good_Morning` | Band Good Morning | `banded-good-morning` | Banded Good Morning | medium | tokenset |
| `fedb:Barbell_Shrug_Behind_The_Back` | Barbell Shrug Behind The Back | `behind-the-back-barbell-shrug` | Behind the Back Barbell Shrug | medium | tokenset |
| `fedb:Bicycling_Stationary` | Bicycling, Stationary | `stationary-bike` | Stationary Bike | medium | exact_es+alias |
| `fedb:Bodyweight_Walking_Lunge` | Bodyweight Walking Lunge | `walking-lunge` | Walking Lunge | medium | tokenset |
| `fedb:Box_Squat` | Box Squat | `barbell-box-squat` | Barbell Box Squat | medium | tokenset |
| `fedb:Butt_Lift_Bridge` | Butt Lift (Bridge) | `glute-bridge` | Glute Bridge | medium | exact_es+alias |
| `fedb:Dumbbell_One-Arm_Shoulder_Press` | Dumbbell One-Arm Shoulder Press | `one-arm-dumbbell-shoulder-press` | One Arm Dumbbell Shoulder Press | medium | tokenset |
| `fedb:External_Rotation_with_Cable` | External Rotation with Cable | `cable-external-rotation` | Cable External Rotation | medium | tokenset |
| `fedb:Front_Cable_Raise` | Front Cable Raise | `cable-front-raise` | Cable Front Raise | medium | tokenset |
| `fedb:Pallof_Press` | Pallof Press | `cable-pallof-press` | Cable Pallof Press | medium | tokenset |
| `fedb:Preacher_Hammer_Dumbbell_Curl` | Preacher Hammer Dumbbell Curl | `preacher-hammer-curl` | Preacher Hammer Curl | medium | tokenset |
| `fedb:Reverse_Barbell_Curl` | Reverse Barbell Curl | `reverse-curl` | Reverse Curl | medium | tokenset |
| `fedb:Running_Treadmill` | Running, Treadmill | `treadmill-running` | Treadmill Running | medium | tokenset |
| `fedb:Seated_One-arm_Cable_Pulley_Rows` | Seated One-arm Cable Pulley Rows | `one-arm-seated-cable-row` | One-Arm Seated Cable Row | medium | tokenset |
| `fedb:Spider_Curl` | Spider Curl | `ez-bar-spider-curl` | EZ Bar Spider Curl | medium | tokenset |
| `fedb:Upright_Cable_Row` | Upright Cable Row | `cable-upright-row` | Cable Upright Row | medium | tokenset |
| `fedb:Wide-Grip_Barbell_Bench_Press` | Wide-Grip Barbell Bench Press | `wide-grip-bench-press` | Wide-Grip Bench Press | medium | tokenset |

## 6. Unmatched / rejected fedb exercises

702 fedb exercises have no illustration. 16 are manual blocks (section 4). 78 had name evidence for a RepDB record but failed a check (table 6a). 608 had no strong name evidence; table 6b lists the nearest RepDB name by token overlap.

### 6a. Name evidence found, rejected by a check

| fedb id | best RepDB candidate | evidence | reason rejected |
|---|---|---|---|
| `fedb:Air_Bike` | `air-bike` | exact_en+tokenset+alias | equipment bodyweight != machine; primary muscles ['core'] vs ['hamstrings', 'quads'] |
| `fedb:Band_Hip_Adductions` | `hip-adduction` | tokenset | equipment band != machine |
| `fedb:Band_Skull_Crusher` | `db-skull-crusher` | tokenset | equipment band != dumbbell |
| `fedb:Barbell_Hack_Squat` | `hack-squat` | tokenset | equipment barbell != machine |
| `fedb:Barbell_Seated_Calf_Raise` | `seated-calf-raise` | tokenset | equipment barbell != machine |
| `fedb:Barbell_Shoulder_Press` | `dumbbell-shoulder-press` | tokenset | equipment barbell != dumbbell |
| `fedb:Barbell_Side_Bend` | `dumbbell-side-bend` | tokenset | equipment barbell != dumbbell |
| `fedb:Barbell_Step_Ups` | `balance-dome-step-up` | tokenset | equipment barbell != bosu |
| `fedb:Barbell_Walking_Lunge` | `walking-lunge` | tokenset | equipment barbell != bodyweight |
| `fedb:Battling_Ropes` | `battle-ropes` | exact_es+alias | fedb equipment 'other' not specific |
| `fedb:Bench_Press_-_With_Bands` | `bench-press` | tokenset | equipment band != barbell |
| `fedb:Bent-Arm_Dumbbell_Pullover` | `bent-arm-barbell-pullover` | tokenset | equipment dumbbell != barbell |
| `fedb:Bicycling` | `cycling` | exact_es+alias | fedb equipment 'other' not specific |
| `fedb:Cable_Deadlifts` | `deadlift` | tokenset | equipment cable != barbell; primary muscles ['quads'] vs ['back', 'glutes', 'hamstrings'] |
| `fedb:Cable_Hip_Adduction` | `hip-adduction` | tokenset | equipment cable != machine; primary muscles ['quads'] vs ['hip_ab_ad'] |
| `fedb:Cable_Lying_Triceps_Extension` | `ez-bar-lying-tricep-extension` | tokenset | equipment cable != ezbar |
| `fedb:Cable_Preacher_Curl` | `barbell-preacher-curl` | tokenset | equipment cable != barbell |
| `fedb:Cable_Russian_Twists` | `kettlebell-russian-twist` | tokenset | equipment cable != kettlebell |
| `fedb:Cable_Seated_Crunch` | `machine-seated-crunch` | tokenset | equipment cable != machine |
| `fedb:Cable_Seated_Lateral_Raise` | `seated-dumbbell-lateral-raise` | tokenset | equipment cable != dumbbell |
| `fedb:Cable_Shoulder_Press` | `dumbbell-shoulder-press` | tokenset | equipment cable != dumbbell |
| `fedb:Cable_Shrugs` | `db-shrug` | tokenset | equipment cable != dumbbell |
| `fedb:Calf_Raises_-_With_Bands` | `barbell-calf-raise` | tokenset | equipment band != barbell |
| `fedb:Chest_Stretch_on_Stability_Ball` | `banded-chest-stretch` | tokenset | equipment stability_ball != band |
| `fedb:Clean` | `clean` | exact_en+tokenset+alias | primary muscles ['hamstrings'] vs ['glutes', 'quads'] |
| `fedb:Clean_and_Press` | `dumbbell-clean-and-press` | tokenset | equipment barbell != dumbbell |
| `fedb:Dip_Machine` | `dips` | tokenset | equipment machine != bodyweight |
| `fedb:Dumbbell_Clean` | `clean` | tokenset | equipment dumbbell != barbell; primary muscles ['hamstrings'] vs ['glutes', 'quads'] |
| `fedb:Dumbbell_Step_Ups` | `balance-dome-step-up` | tokenset | equipment dumbbell != bosu |
| `fedb:Exercise_Ball_Crunch` | `balance-dome-crunch` | tokenset | equipment stability_ball != bosu |
| `fedb:External_Rotation` | `cable-external-rotation` | tokenset | equipment dumbbell != cable |
| `fedb:External_Rotation_with_Band` | `cable-external-rotation` | tokenset | equipment band != cable |
| `fedb:Flutter_Kicks` | `flutter-kicks` | exact_en+tokenset+alias | primary muscles ['glutes'] vs ['core'] |
| `fedb:Hamstring_Stretch` | `banded-hamstring-stretch` | tokenset | equipment bodyweight != band |
| `fedb:Hang_Snatch` | `hang-snatch` | exact_en+tokenset+alias | primary muscles ['hamstrings'] vs ['back', 'glutes', 'quads', 'shoulders'] |
| `fedb:Inchworm` | `inchworm` | exact_en+tokenset+alias | category stretching vs strength |
| `fedb:Incline_Cable_Flye` | `incline-dumbbell-fly` | tokenset | equipment cable != dumbbell |
| `fedb:Isometric_Neck_Exercise_-_Sides` | `isometric-neck-side` | tokenset | primary muscles ['neck'] vs ['back', 'shoulders'] |
| `fedb:Kettlebell_Arnold_Press` | `arnold-press` | tokenset | equipment kettlebell != dumbbell |
| `fedb:Kettlebell_Hang_Clean` | `hang-clean` | tokenset | equipment kettlebell != barbell; primary muscles ['hamstrings'] vs ['back', 'glutes', 'quads', 'shoulders'] |
| `fedb:Kettlebell_Seated_Press` | `seated-db-press` | tokenset | equipment kettlebell != dumbbell |
| `fedb:Kettlebell_Thruster` | `thruster` | tokenset | equipment kettlebell != barbell |
| `fedb:Lateral_Raise_-_With_Bands` | `bodyweight-lateral-raise` | tokenset | equipment band != bodyweight |
| `fedb:Leverage_Deadlift` | `deadlift` | tokenset | equipment machine != barbell; primary muscles ['quads'] vs ['back', 'glutes', 'hamstrings'] |
| `fedb:Leverage_Shrug` | `db-shrug` | tokenset | equipment machine != dumbbell |
| `fedb:Machine_Bench_Press` | `bench-press` | tokenset | equipment machine != barbell |
| `fedb:Muscle_Snatch` | `muscle-snatch` | exact_en+tokenset+alias | primary muscles ['hamstrings'] vs ['back', 'shoulders'] |
| `fedb:Muscle_Up` | `ring-muscle-up` | tokenset | fedb equipment 'other' not specific |
| `fedb:One_Arm_Floor_Press` | `one-arm-kettlebell-floor-press` | tokenset | equipment barbell != kettlebell; primary muscles ['triceps'] vs ['chest'] |
| `fedb:Plate_Pinch` | `plate-pinch` | exact_en+alias | fedb equipment 'other' not specific; variant tokens differ: plate |
| `fedb:Plyo_Kettlebell_Pushups` | `plyo-push-up` | tokenset | equipment kettlebell != bodyweight |
| `fedb:Reverse_Cable_Curl` | `db-reverse-curl` | tokenset | equipment cable != dumbbell |
| `fedb:Rope_Climb` | `rope-climb` | exact_en+tokenset+exact_es+alias | fedb equipment 'other' not specific |
| `fedb:Scissor_Kick` | `scissor-kicks` | exact_en+tokenset+alias | category stretching vs strength |
| `fedb:Scissors_Jump` | `jumping-jacks` | exact_es+alias | primary muscles ['quads'] vs ['calves', 'glutes', 'shoulders']; variant tokens differ: jump,jumping |
| `fedb:Seated_Cable_Shoulder_Press` | `seated-db-press` | tokenset | equipment cable != dumbbell |
| `fedb:Shoulder_Press_-_With_Bands` | `dumbbell-shoulder-press` | tokenset | equipment band != dumbbell |
| `fedb:Shoulder_Stretch` | `banded-shoulder-stretch` | tokenset | equipment bodyweight != band |
| `fedb:Side_Neck_Stretch` | `neck-side-stretch` | tokenset+exact_es+alias | primary muscles ['neck'] vs ['back', 'shoulders'] |
| `fedb:Sled_Push` | `sled-push` | exact_en+tokenset+exact_es+alias | fedb equipment 'other' not specific |
| `fedb:Sled_Row` | `sled-row` | exact_en+tokenset+exact_es+alias | fedb equipment 'other' not specific |
| `fedb:Smith_Machine_Behind_the_Back_Shrug` | `behind-the-back-barbell-shrug` | tokenset | equipment smith != barbell |
| `fedb:Smith_Machine_Close-Grip_Bench_Press` | `close-grip-bench-press` | tokenset | equipment smith != barbell |
| `fedb:Smith_Machine_Hang_Power_Clean` | `hang-power-clean` | tokenset | equipment smith != barbell; primary muscles ['hamstrings'] vs ['back', 'glutes', 'quads', 'shoulders'] |
| `fedb:Smith_Machine_Leg_Press` | `leg-press` | tokenset | equipment smith != machine |
| `fedb:Smith_Machine_Pistol_Squat` | `dumbbell-pistol-squat` | tokenset | equipment smith != dumbbell |
| `fedb:Smith_Machine_Stiff-Legged_Deadlift` | `stiff-leg-deadlift` | tokenset | equipment smith != barbell |
| `fedb:Split_Squats` | `split-squat` | exact_en+tokenset+alias | primary muscles ['hamstrings'] vs ['glutes', 'quads']; category stretching vs strength |
| `fedb:Standing_Barbell_Calf_Raise` | `standing-calf-raise` | tokenset | equipment barbell != machine |
| `fedb:Standing_Dumbbell_Calf_Raise` | `standing-calf-raise` | tokenset | equipment dumbbell != machine |
| `fedb:Standing_Leg_Curl` | `banded-standing-curl` | tokenset | equipment machine != band |
| `fedb:Stiff-Legged_Dumbbell_Deadlift` | `stiff-leg-deadlift` | tokenset | equipment dumbbell != barbell |
| `fedb:Superman` | `superman` | exact_en+tokenset+exact_es+alias | category stretching vs strength |
| `fedb:Svend_Press` | `svend-press` | exact_en+tokenset+exact_es+alias | fedb equipment 'other' not specific |
| `fedb:Triceps_Stretch` | `banded-triceps-stretch` | tokenset | equipment bodyweight != band |
| `fedb:Upright_Row_-_With_Bands` | `cable-upright-row` | tokenset | equipment band != cable |
| `fedb:Windmills` | `dumbbell-windmill` | tokenset | equipment bodyweight != dumbbell; primary muscles ['hip_ab_ad'] vs ['core', 'shoulders']; category stretching vs strength |
| `fedb:Wrist_Roller` | `wrist-roller` | exact_en+tokenset+exact_es+alias | fedb equipment 'other' not specific |

### 6b. No strong name evidence

| fedb id | nearest RepDB name | token overlap | reason |
|---|---|---|---|
| `fedb:Cable_Rope_Overhead_Triceps_Extension` | `cable-overhead-tricep-extension` | 0.80 | names differ: +rope |
| `fedb:Dumbbell_One-Arm_Triceps_Extension` | `single-arm-dumbbell-overhead-tricep-extension` | 0.80 | names differ: -overhead |
| `fedb:Wide-Grip_Decline_Barbell_Bench_Press` | `decline-bench-press-barbell` | 0.80 | names differ: +widegrip |
| `fedb:Alternate_Incline_Dumbbell_Curl` | `incline-db-curl` | 0.75 | names differ: +alternate |
| `fedb:Barbell_Ab_Rollout_-_On_Knees` | `barbell-ab-rollout` | 0.75 | names differ: +knee |
| `fedb:Barbell_Guillotine_Bench_Press` | `bench-press` | 0.75 | names differ: +guillotine |
| `fedb:Cable_Hammer_Curls_-_Rope_Attachment` | `cable-hammer-curl` | 0.75 | names differ: +rope |
| `fedb:Close-Grip_Dumbbell_Press` | `close-grip-db-bench-press` | 0.75 | names differ: -bench |
| `fedb:Close-Grip_EZ-Bar_Curl_with_Band` | `close-grip-ez-bar-curl` | 0.75 | names differ: +band |
| `fedb:Close-Grip_EZ-Bar_Press` | `close-grip-ez-bar-bench-press` | 0.75 | names differ: -bench |
| `fedb:Close-Grip_Standing_Barbell_Curl` | `close-grip-barbell-curl` | 0.75 | names differ: +standing |
| `fedb:Decline_Dumbbell_Triceps_Extension` | `dumbbell-tricep-extension` | 0.75 | names differ: +decline |
| `fedb:Decline_Smith_Press` | `smith-machine-decline-bench-press` | 0.75 | names differ: -bench |
| `fedb:Double_Kettlebell_Snatch` | `double-kettlebell-swing-snatch` | 0.75 | names differ: -swing |
| `fedb:Dumbbell_Alternate_Bicep_Curl` | `bicep-curl` | 0.75 | names differ: +alternate |
| `fedb:Dumbbell_Bench_Press_with_Neutral_Grip` | `db-bench-press` | 0.75 | names differ: +neutralgrip |
| `fedb:Dumbbell_One-Arm_Upright_Row` | `dumbbell-upright-row` | 0.75 | names differ: +singlearm |
| `fedb:Dumbbell_Prone_Incline_Curl` | `incline-db-curl` | 0.75 | names differ: +prone |
| `fedb:Flat_Bench_Leg_Pull-In` | `bench-leg-pull-in` | 0.75 | names differ: +flat |
| `fedb:Flexor_Incline_Dumbbell_Curls` | `incline-db-curl` | 0.75 | names differ: +flexor |
| `fedb:Front_Incline_Dumbbell_Raise` | `dumbbell-front-raise` | 0.75 | names differ: +incline |
| `fedb:Front_Two-Dumbbell_Raise` | `dumbbell-front-raise` | 0.75 | names differ: +two |
| `fedb:Incline_Cable_Chest_Press` | `cable-chest-press` | 0.75 | names differ: +incline |
| `fedb:Incline_Dumbbell_Flyes_-_With_A_Twist` | `incline-dumbbell-fly` | 0.75 | names differ: +twist |
| `fedb:Kettlebell_Dead_Clean` | `double-kettlebell-dead-clean` | 0.75 | names differ: -double |
| `fedb:Kneeling_Hip_Flexor` | `kneeling-hip-flexor-stretch` | 0.75 | names differ: -stretch |
| `fedb:Leverage_Decline_Chest_Press` | `chest-press-machine` | 0.75 | names differ: +decline |
| `fedb:Leverage_Incline_Chest_Press` | `chest-press-machine` | 0.75 | names differ: +incline |
| `fedb:Machine_Shoulder_Military_Press` | `machine-shoulder-press` | 0.75 | names differ: +military |
| `fedb:One-Arm_Medicine_Ball_Slam` | `medicine-ball-slam` | 0.75 | names differ: +singlearm |
| `fedb:Push_Press_-_Behind_the_Neck` | `behind-the-neck-press` | 0.75 | names differ: +push |
| `fedb:Reverse_Barbell_Preacher_Curls` | `barbell-preacher-curl` | 0.75 | names differ: +reverse |
| `fedb:Rocking_Standing_Calf_Raise` | `standing-calf-raise` | 0.75 | names differ: +rocking |
| `fedb:Single-Leg_High_Box_Squat` | `single-leg-box-squat` | 0.75 | names differ: +high |
| `fedb:Sled_Overhead_Triceps_Extension` | `overhead-tricep-extension` | 0.75 | names differ: +sled |
| `fedb:Smith_Machine_Decline_Press` | `smith-machine-decline-bench-press` | 0.75 | names differ: -bench |
| `fedb:Smith_Machine_One-Arm_Upright_Row` | `smith-machine-upright-row` | 0.75 | names differ: +singlearm |
| `fedb:Smith_Machine_Overhead_Shoulder_Press` | `smith-machine-shoulder-press` | 0.75 | names differ: +overhead |
| `fedb:Smith_Machine_Reverse_Calf_Raises` | `smith-machine-calf-raise` | 0.75 | names differ: +reverse |
| `fedb:Smith_Single-Leg_Split_Squat` | `smith-machine-split-squat` | 0.75 | names differ: +singleleg |
| `fedb:Standing_Cable_Chest_Press` | `cable-chest-press` | 0.75 | names differ: +standing |
| `fedb:Standing_Dumbbell_Reverse_Curl` | `db-reverse-curl` | 0.75 | names differ: +standing |
| `fedb:Standing_Dumbbell_Triceps_Extension` | `dumbbell-tricep-extension` | 0.75 | names differ: +standing |
| `fedb:Standing_Dumbbell_Upright_Row` | `dumbbell-upright-row` | 0.75 | names differ: +standing |
| `fedb:Standing_Elevated_Quad_Stretch` | `standing-quad-stretch` | 0.75 | names differ: +elevated |
| `fedb:Standing_Gastrocnemius_Calf_Stretch` | `standing-calf-stretch` | 0.75 | names differ: +gastrocnemiu |
| `fedb:Standing_Hamstring_and_Calf_Stretch` | `standing-calf-stretch` | 0.75 | names differ: +hamstring |
| `fedb:Triceps_Overhead_Extension_with_Rope` | `overhead-tricep-extension` | 0.75 | names differ: +rope |
| `fedb:Advanced_Kettlebell_Windmill` | `kettlebell-windmills` | 0.67 | names differ: +advanced |
| `fedb:Alternating_Floor_Press` | `floor-press` | 0.67 | names differ: +alternating |
| `fedb:Alternating_Hang_Clean` | `hang-clean` | 0.67 | names differ: +alternating |
| `fedb:Alternating_Renegade_Row` | `renegade-row` | 0.67 | names differ: +alternating |
| `fedb:Box_Squat_with_Bands` | `box-squat` | 0.67 | names differ: +band |
| `fedb:Box_Squat_with_Chains` | `box-squat` | 0.67 | names differ: +chain |
| `fedb:Cable_Reverse_Crunch` | `cable-crunch` | 0.67 | names differ: +reverse |
| `fedb:Crossover_Reverse_Lunge` | `reverse-lunge` | 0.67 | names differ: +crossover |
| `fedb:Decline_Oblique_Crunch` | `decline-crunch` | 0.67 | names differ: +oblique |
| `fedb:Decline_Reverse_Crunch` | `decline-crunch` | 0.67 | names differ: +reverse |
| `fedb:Double_Kettlebell_Windmill` | `kettlebell-windmills` | 0.67 | names differ: +double |
| `fedb:Dumbbell_Raise` | `dumbbell-calf-raise` | 0.67 | names differ: -calf |
| `fedb:Dumbbell_Squat_To_A_Bench` | `db-squat` | 0.67 | names differ: +bench |
| `fedb:Extended_Range_One-Arm_Kettlebell_Floor_Press` | `one-arm-kettlebell-floor-press` | 0.67 | names differ: +extended +range |
| `fedb:Floor_Press_with_Chains` | `floor-press` | 0.67 | names differ: +chain |
| `fedb:Freehand_Jump_Squat` | `jump-squat` | 0.67 | names differ: +freehand |
| `fedb:Front_Box_Jump` | `box-jump` | 0.67 | names differ: +front |
| `fedb:High_Cable_Curls` | `cable-curl` | 0.67 | names differ: +high |
| `fedb:Incline_Bench_Pull` | `bench-pull` | 0.67 | names differ: +incline |
| `fedb:Incline_Push-Up_Close-Grip` | `close-grip-push-ups` | 0.67 | names differ: +incline |
| `fedb:Incline_Push-Up_Medium` | `incline-push-ups` | 0.67 | names differ: +medium |
| `fedb:Incline_Push-Up_Reverse_Grip` | `incline-push-ups` | 0.67 | names differ: +reversegrip |
| `fedb:Incline_Push-Up_Wide` | `incline-push-ups` | 0.67 | names differ: +wide |
| `fedb:Inverted_Row_with_Straps` | `inverted-row` | 0.67 | names differ: +strap |
| `fedb:Kneeling_Jump_Squat` | `jump-squat` | 0.67 | names differ: +kneeling |
| `fedb:Lateral_Box_Jump` | `box-jump` | 0.67 | names differ: +lateral |
| `fedb:Leg_Pull-In` | `bench-leg-pull-in` | 0.67 | names differ: -bench |
| `fedb:Lying_Cable_Curl` | `cable-curl` | 0.67 | names differ: +lying |
| `fedb:Lying_T-Bar_Row` | `t-bar-row` | 0.67 | names differ: +lying |
| `fedb:Neck_Press` | `behind-the-neck-press` | 0.67 | names differ: -behind |
| `fedb:One_Arm_Pronated_Dumbbell_Triceps_Extension` | `single-arm-dumbbell-overhead-tricep-extension` | 0.67 | names differ: +pronated -overhead |
| `fedb:One_Arm_Supinated_Dumbbell_Triceps_Extension` | `single-arm-dumbbell-overhead-tricep-extension` | 0.67 | names differ: +supinated -overhead |
| `fedb:Overhead_Cable_Curl` | `cable-curl` | 0.67 | names differ: +overhead |
| `fedb:Overhead_Stretch` | `overhead-triceps-stretch` | 0.67 | names differ: -triceps |
| `fedb:Plie_Dumbbell_Squat` | `db-squat` | 0.67 | names differ: +plie |
| `fedb:Power_Clean` | `hang-power-clean` | 0.67 | names differ: -hang |
| `fedb:Push_Up_to_Side_Plank` | `side-plank` | 0.67 | names differ: +pushup |
| `fedb:Quad_Stretch` | `lying-quad-stretch` | 0.67 | names differ: -lying |
| `fedb:Rack_Pull_with_Bands` | `rack-pull` | 0.67 | names differ: +band |
| `fedb:Reverse_Plate_Curls` | `reverse-curl` | 0.67 | names differ: +plate |
| `fedb:Rope_Straight-Arm_Pulldown` | `straight-arm-pulldown` | 0.67 | names differ: +rope |
| `fedb:Seated_Bent-Over_One-Arm_Dumbbell_Triceps_Extension` | `seated-dumbbell-tricep-extension` | 0.67 | names differ: +bentover +singlearm |
| `fedb:Seated_Good_Mornings` | `good-morning` | 0.67 | names differ: +seated |
| `fedb:Single-Leg_Leg_Extension` | `leg-extension` | 0.67 | names differ: +singleleg |
| `fedb:Speed_Box_Squat` | `box-squat` | 0.67 | names differ: +speed |
| `fedb:Standing_Concentration_Curl` | `concentration-curl` | 0.67 | names differ: +standing |
| `fedb:Standing_One-Arm_Dumbbell_Triceps_Extension` | `single-arm-dumbbell-overhead-tricep-extension` | 0.67 | names differ: +standing -overhead |
| `fedb:Straight-Arm_Dumbbell_Pullover` | `db-pullover` | 0.67 | names differ: +straightarm |
| `fedb:Sumo_Deadlift_with_Bands` | `sumo-deadlift` | 0.67 | names differ: +band |
| `fedb:Sumo_Deadlift_with_Chains` | `sumo-deadlift` | 0.67 | names differ: +chain |
| `fedb:Suspended_Split_Squat` | `split-squat` | 0.67 | names differ: +suspended |
| `fedb:V-Bar_Pulldown` | `v-bar-lat-pulldown` | 0.67 | names differ: -lat |
| `fedb:Weighted_Bench_Dip` | `bench-dips` | 0.67 | names differ: +weighted |
| `fedb:Weighted_Jump_Squat` | `jump-squat` | 0.67 | names differ: +weighted |
| `fedb:Weighted_Sissy_Squat` | `sissy-squat` | 0.67 | names differ: +weighted |
| `fedb:Wide-Grip_Rear_Pull-Up` | `wide-grip-pull-ups` | 0.67 | names differ: +rear |
| `fedb:Zottman_Preacher_Curl` | `preacher-curl` | 0.67 | names differ: +zottman |
| `fedb:Backward_Medicine_Ball_Throw` | `medicine-ball-side-throw` | 0.60 | names differ: +backward -side |
| `fedb:Band_Good_Morning_Pull_Through` | `band-pull-through` | 0.60 | names differ: +good +morning |
| `fedb:Barbell_Side_Split_Squat` | `barbell-bulgarian-split-squat` | 0.60 | names differ: +side -bulgarian |
| `fedb:Bent-Knee_Hip_Raise` | `bent-knee-copenhagen-raises` | 0.60 | names differ: +hip -copenhagen |
| `fedb:Bent_Over_Two-Dumbbell_Row_With_Palms_In` | `bent-over-db-row` | 0.60 | names differ: +palm +two |
| `fedb:Cable_Incline_Triceps_Extension` | `cable-overhead-tricep-extension` | 0.60 | names differ: +incline -overhead |
| `fedb:Decline_EZ_Bar_Triceps_Extension` | `ez-bar-lying-tricep-extension` | 0.60 | names differ: +decline -lying |
| `fedb:Double_Kettlebell_Alternating_Hang_Clean` | `double-kettlebell-clean` | 0.60 | names differ: +alternating +hang |
| `fedb:Dumbbell_Lying_Rear_Lateral_Raise` | `lateral-raise` | 0.60 | names differ: +lying +rear |
| `fedb:Dumbbell_Seated_One-Leg_Calf_Raise` | `dumbbell-calf-raise` | 0.60 | names differ: +seated +singleleg |
| `fedb:Dumbbell_Tricep_Extension_-Pronated_Grip` | `dumbbell-tricep-extension` | 0.60 | names differ: +grip +pronated |
| `fedb:Flat_Bench_Lying_Leg_Raise` | `lying-leg-raise` | 0.60 | names differ: +bench +flat |
| `fedb:Front_Squats_With_Two_Kettlebells` | `one-arm-kettlebell-front-squat` | 0.60 | names differ: +two -singlearm |
| `fedb:IT_Band_and_Glute_Stretch` | `banded-it-band-stretch` | 0.60 | names differ: +glute -banded |
| `fedb:Kneeling_Cable_Triceps_Extension` | `cable-overhead-tricep-extension` | 0.60 | names differ: +kneeling -overhead |
| `fedb:Low_Cable_Triceps_Extension` | `cable-overhead-tricep-extension` | 0.60 | names differ: +low -overhead |
| `fedb:Lying_One-Arm_Lateral_Raise` | `side-lying-lateral-raise` | 0.60 | names differ: +singlearm -side |
| `fedb:Medicine_Ball_Scoop_Throw` | `medicine-ball-side-throw` | 0.60 | names differ: +scoop -side |
| `fedb:Narrow_Stance_Leg_Press` | `close-stance-leg-press` | 0.60 | names differ: +narrow -close |
| `fedb:One-Arm_Kettlebell_Para_Press` | `one-arm-kettlebell-floor-press` | 0.60 | names differ: +para -floor |
| `fedb:One-Arm_Kettlebell_Split_Jerk` | `double-kettlebell-split-jerk` | 0.60 | names differ: +singlearm -double |
| `fedb:One-Arm_Overhead_Kettlebell_Squats` | `one-arm-kettlebell-front-squat` | 0.60 | names differ: +overhead -front |
| `fedb:Seated_Close-Grip_Concentration_Barbell_Curl` | `close-grip-barbell-curl` | 0.60 | names differ: +concentration +seated |
| `fedb:Seated_Dumbbell_Inner_Biceps_Curl` | `bicep-curl` | 0.60 | names differ: +inner +seated |
| `fedb:Seated_Flat_Bench_Leg_Pull-In` | `bench-leg-pull-in` | 0.60 | names differ: +flat +seated |
| `fedb:Seated_Side_Lateral_Raise` | `seated-dumbbell-lateral-raise` | 0.60 | names differ: +side -dumbbell |
| `fedb:Side_Laterals_to_Front_Raise` | `side-lying-lateral-raise` | 0.60 | names differ: +front -lying |
| `fedb:Standing_Barbell_Press_Behind_Neck` | `behind-the-neck-press` | 0.60 | names differ: +barbell +standing |
| `fedb:Standing_Overhead_Barbell_Triceps_Extension` | `barbell-overhead-extension` | 0.60 | names differ: +standing +triceps |
| `fedb:Two-Arm_Dumbbell_Preacher_Curl` | `db-preacher-curl` | 0.60 | names differ: +arm +two |
| `fedb:Wide-Grip_Pulldown_Behind_The_Neck` | `behind-the-neck-lat-pulldown` | 0.60 | names differ: +widegrip -lat |
| `fedb:Wide_Stance_Stiff_Legs` | `wide-stance-leg-press` | 0.60 | names differ: +stiff -press |
| `fedb:Seated_Bent-Over_Two-Arm_Dumbbell_Triceps_Extension` | `seated-dumbbell-tricep-extension` | 0.57 | names differ: +arm +bentover +two |
| `fedb:Standing_Bent-Over_One-Arm_Dumbbell_Triceps_Extension` | `single-arm-dumbbell-overhead-tricep-extension` | 0.57 | names differ: +bentover +standing -overhead |
| `fedb:Alternate_Hammer_Curl` | `cable-hammer-curl` | 0.50 | names differ: +alternate -cable |
| `fedb:Alternating_Kettlebell_Press` | `kettlebell-floor-press` | 0.50 | names differ: +alternating -floor |
| `fedb:Alternating_Kettlebell_Row` | `double-kettlebell-row` | 0.50 | names differ: +alternating -double |
| `fedb:Barbell_Full_Squat` | `barbell-box-squat` | 0.50 | names differ: +full -box |
| `fedb:Barbell_Squat_To_A_Bench` | `barbell-box-squat` | 0.50 | names differ: +bench -box |
| `fedb:Bear_Crawl_Sled_Drags` | `bear-crawl` | 0.50 | names differ: +drag +sled |
| `fedb:Bench_Press_-_Powerlifting` | `bench-press` | 0.50 | names differ: +powerlifting -barbell |
| `fedb:Bench_Press_with_Chains` | `bench-press` | 0.50 | names differ: +chain -barbell |
| `fedb:Bottoms_Up` | `kettlebell-bottoms-up-hold` | 0.50 | names differ: -hold -kettlebell |
| `fedb:Box_Jump_Multiple_Response` | `box-jump` | 0.50 | names differ: +multiple +response |
| `fedb:Cable_Incline_Pushdown` | `tricep-pushdown` | 0.50 | names differ: +incline -triceps |
| `fedb:Cable_Internal_Rotation` | `cable-external-rotation` | 0.50 | names differ: +internal -external |
| `fedb:Cable_Rope_Rear-Delt_Rows` | `barbell-rear-delt-row` | 0.50 | names differ: +cable +rope -barbell |
| `fedb:Calf_Press_On_The_Leg_Press_Machine` | `leg-press` | 0.50 | names differ: +calf +machine |
| `fedb:Chin_To_Chest_Stretch` | `banded-chest-stretch` | 0.50 | names differ: +chin -banded |
| `fedb:Clean_Deadlift` | `clean` | 0.50 | names differ: +deadlift |
| `fedb:Clean_Pull` | `clean` | 0.50 | names differ: +pull |
| `fedb:Clean_Shrug` | `clean` | 0.50 | names differ: +shrug |
| `fedb:Clock_Push-Up` | `push-up` | 0.50 | names differ: +clock |
| `fedb:Close-Grip_Push-Up_off_of_a_Dumbbell` | `close-grip-push-ups` | 0.50 | names differ: +dumbbell +off |
| `fedb:Downward_Facing_Balance` | `downward-dog` | 0.50 | names differ: +balance -dog |
| `fedb:Dumbbell_Incline_Row` | `bent-over-db-row` | 0.50 | names differ: +incline -bentover |
| `fedb:Dumbbell_Lying_One-Arm_Rear_Lateral_Raise` | `lateral-raise` | 0.50 | names differ: +lying +rear +singlearm |
| `fedb:Dumbbell_Seated_Box_Jump` | `box-jump` | 0.50 | names differ: +dumbbell +seated |
| `fedb:Dynamic_Chest_Stretch` | `banded-chest-stretch` | 0.50 | names differ: +dynamic -banded |
| `fedb:Elevated_Cable_Rows` | `cable-bent-over-row` | 0.50 | names differ: +elevated -bentover |
| `fedb:Flat_Bench_Cable_Flyes` | `cable-fly` | 0.50 | names differ: +bench +flat |
| `fedb:Frog_Sit-Ups` | `sit-ups` | 0.50 | names differ: +frog |
| `fedb:Front_Barbell_Squat_To_A_Bench` | `front-squat` | 0.50 | names differ: +barbell +bench |
| `fedb:Front_Leg_Raises` | `barbell-front-raise` | 0.50 | names differ: +leg -barbell |
| `fedb:Front_Plate_Raise` | `barbell-front-raise` | 0.50 | names differ: +plate -barbell |
| `fedb:Front_Raise_And_Pullover` | `barbell-front-raise` | 0.50 | names differ: +pullover -barbell |
| `fedb:Front_Squat_Clean_Grip` | `front-squat` | 0.50 | names differ: +clean +grip |
| `fedb:Good_Morning_off_Pins` | `good-morning` | 0.50 | names differ: +off +pin |
| `fedb:Hammer_Grip_Incline_DB_Bench_Press` | `db-bench-press` | 0.50 | names differ: +grip +hammer +incline |
| `fedb:Hang_Clean_-_Below_the_Knees` | `hang-clean` | 0.50 | names differ: +below +knee |
| `fedb:Hang_Snatch_-_Below_Knees` | `hang-snatch` | 0.50 | names differ: +below +knee |
| `fedb:Hanging_Bar_Good_Morning` | `good-morning` | 0.50 | names differ: +bar +hanging |
| `fedb:Hug_Knees_To_Chest` | `knee-to-chest-stretch` | 0.50 | names differ: +hug -stretch |
| `fedb:Hyperextensions_With_No_Hyperextension_Bench` | `hyperextension-hold-bench` | 0.50 | names differ: +no -hold |
| `fedb:Incline_Push-Up_Depth_Jump` | `incline-push-ups` | 0.50 | names differ: +depth +jump |
| `fedb:Intermediate_Hip_Flexor_and_Quad_Stretch` | `kneeling-hip-flexor-stretch` | 0.50 | names differ: +intermediate +quad -kneeling |
| `fedb:Janda_Sit-Up` | `sit-ups` | 0.50 | names differ: +janda |
| `fedb:Kettlebell_Seesaw_Press` | `kettlebell-floor-press` | 0.50 | names differ: +seesaw -floor |
| `fedb:Kipping_Muscle_Up` | `ring-muscle-up` | 0.50 | names differ: +kipping -ring |
| `fedb:Knee_Tuck_Jump` | `plank-knee-tuck` | 0.50 | names differ: +jump -plank |
| `fedb:Kneeling_Forearm_Stretch` | `kneeling-wrist-stretch` | 0.50 | names differ: +forearm -wrist |
| `fedb:Leg-Over_Floor_Press` | `floor-press` | 0.50 | names differ: +leg +over |
| `fedb:Leg_Lift` | `side-plank-leg-lift` | 0.50 | names differ: -plank -side |
| `fedb:Lunge_Sprint` | `lunge` | 0.50 | names differ: +sprint |
| `fedb:Lying_Triceps_Press` | `lying-tricep-extension` | 0.50 | names differ: +press -extension |
| `fedb:Narrow_Stance_Hack_Squats` | `hack-squat` | 0.50 | names differ: +narrow +stance |
| `fedb:Oblique_Crunches` | `crunches` | 0.50 | names differ: +oblique |
| `fedb:One-Arm_Flat_Bench_Dumbbell_Flye` | `single-arm-dumbbell-bench-press` | 0.50 | names differ: +flat +fly -press |
| `fedb:One-Arm_Incline_Lateral_Raise` | `single-arm-plate-loaded-lateral-raise` | 0.50 | names differ: +incline -loaded -plate |
| `fedb:One-Arm_Kettlebell_Clean` | `double-kettlebell-clean` | 0.50 | names differ: +singlearm -double |
| `fedb:One-Arm_Kettlebell_Clean_and_Jerk` | `clean-and-jerk` | 0.50 | names differ: +kettlebell +singlearm |
| `fedb:One-Arm_Kettlebell_Jerk` | `double-kettlebell-jerk` | 0.50 | names differ: +singlearm -double |
| `fedb:One-Arm_Kettlebell_Military_Press_To_The_Side` | `one-arm-kettlebell-floor-press` | 0.50 | names differ: +military +side -floor |
| `fedb:One-Arm_Kettlebell_Snatch` | `one-arm-kettlebell-row` | 0.50 | names differ: +snatch -row |
| `fedb:One-Arm_Kettlebell_Split_Snatch` | `double-kettlebell-dead-split-snatch` | 0.50 | names differ: +singlearm -dead -double |
| `fedb:One_Arm_Chin-Up` | `chin-ups` | 0.50 | names differ: +singlearm |
| `fedb:One_Knee_To_Chest` | `knee-to-chest-stretch` | 0.50 | names differ: +one -stretch |
| `fedb:One_Leg_Barbell_Squat` | `barbell-box-squat` | 0.50 | names differ: +singleleg -box |
| `fedb:Pallof_Press_With_Rotation` | `banded-pallof-press` | 0.50 | names differ: +rotation -banded |
| `fedb:Power_Snatch` | `snatch` | 0.50 | names differ: +power |
| `fedb:Press_Sit-Up` | `sit-ups` | 0.50 | names differ: +press |
| `fedb:Push-Up_Wide` | `push-up` | 0.50 | names differ: +wide |
| `fedb:Push-Ups_With_Feet_On_An_Exercise_Ball` | `stability-ball-push-up` | 0.50 | names differ: +feet -stability |
| `fedb:Pyramid` | `pyramid-pose` | 0.50 | names differ: -pose |
| `fedb:Rear_Leg_Raises` | `hanging-leg-raise` | 0.50 | names differ: +rear -hanging |
| `fedb:Reverse_Band_Box_Squat` | `box-squat` | 0.50 | names differ: +band +reverse |
| `fedb:Reverse_Band_Sumo_Deadlift` | `sumo-deadlift` | 0.50 | names differ: +band +reverse |
| `fedb:Reverse_Grip_Triceps_Pushdown` | `single-arm-tricep-pushdown` | 0.50 | names differ: +reversegrip -singlearm |
| `fedb:Romanian_Deadlift_from_Deficit` | `deficit-deadlift` | 0.50 | names differ: +from +romanian |
| `fedb:Seated_Barbell_Twist` | `seated-spinal-twist` | 0.50 | names differ: +barbell -spinal |
| `fedb:Seated_Calf_Stretch` | `banded-calf-stretch` | 0.50 | names differ: +seated -banded |
| `fedb:Seated_Dumbbell_Palms-Down_Wrist_Curl` | `dumbbell-wrist-curl` | 0.50 | names differ: +down +palm +seated |
| `fedb:Seated_Dumbbell_Palms-Up_Wrist_Curl` | `dumbbell-wrist-curl` | 0.50 | names differ: +palm +seated +up |
| `fedb:Seated_Leg_Tucks` | `seated-leg-curl` | 0.50 | names differ: +tuck -curl |
| `fedb:Seated_Overhead_Stretch` | `overhead-triceps-stretch` | 0.50 | names differ: +seated -triceps |
| `fedb:Seated_Palm-Up_Barbell_Wrist_Curl` | `barbell-wrist-curl` | 0.50 | names differ: +palm +seated +up |
| `fedb:Seated_Palms-Down_Barbell_Wrist_Curl` | `barbell-wrist-curl` | 0.50 | names differ: +down +palm +seated |
| `fedb:Side_Leg_Raises` | `hanging-leg-raise` | 0.50 | names differ: +side -hanging |
| `fedb:Single-Arm_Push-Up` | `push-up` | 0.50 | names differ: +singlearm |
| `fedb:Single_Dumbbell_Raise` | `dumbbell-calf-raise` | 0.50 | names differ: +single -calf |
| `fedb:Sled_Reverse_Flye` | `cable-reverse-fly` | 0.50 | names differ: +sled -cable |
| `fedb:Smith_Machine_Hip_Raise` | `smith-machine-calf-raise` | 0.50 | names differ: +hip -calf |
| `fedb:Snatch_Balance` | `snatch` | 0.50 | names differ: +balance |
| `fedb:Snatch_Deadlift` | `snatch` | 0.50 | names differ: +deadlift |
| `fedb:Snatch_Pull` | `snatch` | 0.50 | names differ: +pull |
| `fedb:Snatch_Shrug` | `snatch` | 0.50 | names differ: +shrug |
| `fedb:Split_Clean` | `clean` | 0.50 | names differ: +split |
| `fedb:Split_Snatch` | `snatch` | 0.50 | names differ: +split |
| `fedb:Standing_Biceps_Cable_Curl` | `cable-curl` | 0.50 | names differ: +biceps +standing |
| `fedb:Standing_Biceps_Stretch` | `standing-adductor-stretch` | 0.50 | names differ: +biceps -adductor |
| `fedb:Standing_Dumbbell_Press` | `db-bench-press` | 0.50 | names differ: +standing -bench |
| `fedb:Standing_Front_Barbell_Raise_Over_Head` | `barbell-front-raise` | 0.50 | names differ: +head +over +standing |
| `fedb:Standing_Hip_Circles` | `standing-hip-abduction` | 0.50 | names differ: +circle -abduction |
| `fedb:Standing_Hip_Flexors` | `standing-hip-abduction` | 0.50 | names differ: +flexor -abduction |
| `fedb:Standing_Lateral_Stretch` | `standing-adductor-stretch` | 0.50 | names differ: +lateral -adductor |
| `fedb:Standing_One-Arm_Cable_Curl` | `cable-curl` | 0.50 | names differ: +singlearm +standing |
| `fedb:Standing_Palm-In_One-Arm_Dumbbell_Press` | `one-arm-dumbbell-push-press` | 0.50 | names differ: +palm +standing -push |
| `fedb:Step-up_with_Knee_Raise` | `hanging-knee-raise` | 0.50 | names differ: +stepup -hanging |
| `fedb:Stiff_Leg_Barbell_Good_Morning` | `good-morning` | 0.50 | names differ: +barbell +stiffleg |
| `fedb:Suspended_Push-Up` | `push-up` | 0.50 | names differ: +suspended |
| `fedb:Tricep_Side_Stretch` | `banded-triceps-stretch` | 0.50 | names differ: +side -banded |
| `fedb:V-Bar_Pullup` | `pull-up` | 0.50 | names differ: +vbar |
| `fedb:Walking_Treadmill` | `walking` | 0.50 | names differ: +treadmill |
| `fedb:Weighted_Crunches` | `crunches` | 0.50 | names differ: +weighted |
| `fedb:Wide-Grip_Decline_Barbell_Pullover` | `barbell-pullover` | 0.50 | names differ: +decline +widegrip |
| `fedb:Wide-Grip_Standing_Barbell_Curl` | `barbell-curl` | 0.50 | names differ: +standing +widegrip |
| `fedb:Kettlebell_Turkish_Get-Up_Lunge_style` | `kettlebell-turkish-get-ups` | 0.43 | no RepDB record with matching name |
| `fedb:Kettlebell_Turkish_Get-Up_Squat_style` | `kettlebell-turkish-get-ups` | 0.43 | no RepDB record with matching name |
| `fedb:Lying_Close-Grip_Barbell_Triceps_Extension_Behind_The_Head` | `lying-tricep-extension` | 0.43 | no RepDB record with matching name |
| `fedb:Palms-Down_Dumbbell_Wrist_Curl_Over_A_Bench` | `dumbbell-wrist-curl` | 0.43 | no RepDB record with matching name |
| `fedb:Palms-Up_Barbell_Wrist_Curl_Over_A_Bench` | `barbell-wrist-curl` | 0.43 | no RepDB record with matching name |
| `fedb:Palms-Up_Dumbbell_Wrist_Curl_Over_A_Bench` | `dumbbell-wrist-curl` | 0.43 | no RepDB record with matching name |
| `fedb:Seated_One-Arm_Dumbbell_Palms-Down_Wrist_Curl` | `dumbbell-wrist-curl` | 0.43 | no RepDB record with matching name |
| `fedb:Seated_One-Arm_Dumbbell_Palms-Up_Wrist_Curl` | `dumbbell-wrist-curl` | 0.43 | no RepDB record with matching name |
| `fedb:Standing_Bent-Over_Two-Arm_Dumbbell_Triceps_Extension` | `dumbbell-tricep-extension` | 0.43 | no RepDB record with matching name |
| `fedb:Standing_One-Arm_Dumbbell_Curl_Over_Incline_Bench` | `incline-db-curl` | 0.43 | no RepDB record with matching name |
| `fedb:All_Fours_Quad_Stretch` | `lying-quad-stretch` | 0.40 | no RepDB record with matching name |
| `fedb:Alternating_Cable_Shoulder_Press` | `cable-chest-press` | 0.40 | no RepDB record with matching name |
| `fedb:Barbell_Curls_Lying_Against_An_Incline` | `barbell-curl` | 0.40 | no RepDB record with matching name |
| `fedb:Barbell_Incline_Shoulder_Raise` | `barbell-calf-raise` | 0.40 | no RepDB record with matching name |
| `fedb:Barbell_Rollout_from_Bench` | `barbell-ab-rollout` | 0.40 | no RepDB record with matching name |
| `fedb:Behind_Head_Chest_Stretch` | `banded-chest-stretch` | 0.40 | no RepDB record with matching name |
| `fedb:Calf-Machine_Shoulder_Shrug` | `machine-calf-raise` | 0.40 | no RepDB record with matching name |
| `fedb:Chest_And_Front_Of_Shoulder_Stretch` | `banded-chest-stretch` | 0.40 | no RepDB record with matching name |
| `fedb:Crunch_-_Legs_On_Exercise_Ball` | `ball-leg-curl` | 0.40 | no RepDB record with matching name |
| `fedb:Decline_Close-Grip_Bench_To_Skull_Crusher` | `close-grip-bench-press` | 0.40 | no RepDB record with matching name |
| `fedb:Dumbbell_Incline_Shoulder_Raise` | `dumbbell-calf-raise` | 0.40 | no RepDB record with matching name |
| `fedb:Full_Range-Of-Motion_Lat_Pulldown` | `lat-pulldown` | 0.40 | no RepDB record with matching name |
| `fedb:Incline_Barbell_Triceps_Extension` | `barbell-overhead-extension` | 0.40 | no RepDB record with matching name |
| `fedb:Incline_Inner_Biceps_Curl` | `bicep-curl` | 0.40 | no RepDB record with matching name |
| `fedb:Internal_Rotation_with_Band` | `band-shoulder-external-rotation` | 0.40 | no RepDB record with matching name |
| `fedb:Kneeling_High_Pulley_Row` | `kneeling-cable-row` | 0.40 | no RepDB record with matching name |
| `fedb:Leg-Up_Hamstring_Stretch` | `banded-hamstring-stretch` | 0.40 | no RepDB record with matching name |
| `fedb:Leverage_High_Row` | `chest-supported-machine-row` | 0.40 | no RepDB record with matching name |
| `fedb:Leverage_Iso_Row` | `chest-supported-machine-row` | 0.40 | no RepDB record with matching name |
| `fedb:Lying_Bent_Leg_Groin` | `leg-curl` | 0.40 | no RepDB record with matching name |
| `fedb:Lying_Cambered_Barbell_Row` | `barbell-row` | 0.40 | no RepDB record with matching name |
| `fedb:Lying_High_Bench_Barbell_Curl` | `barbell-curl` | 0.40 | no RepDB record with matching name |
| `fedb:Lying_Rear_Delt_Raise` | `lying-leg-raise` | 0.40 | no RepDB record with matching name |
| `fedb:Lying_Supine_Dumbbell_Curl` | `bicep-curl` | 0.40 | no RepDB record with matching name |
| `fedb:Medicine_Ball_Chest_Pass` | `medicine-ball-slam` | 0.40 | no RepDB record with matching name |
| `fedb:Medicine_Ball_Full_Twist` | `medicine-ball-slam` | 0.40 | no RepDB record with matching name |
| `fedb:Middle_Back_Shrug` | `behind-the-back-barbell-shrug` | 0.40 | no RepDB record with matching name |
| `fedb:On-Your-Back_Quad_Stretch` | `lying-quad-stretch` | 0.40 | no RepDB record with matching name |
| `fedb:On_Your_Side_Quad_Stretch` | `lying-quad-stretch` | 0.40 | no RepDB record with matching name |
| `fedb:One-Arm_Long_Bar_Row` | `one-arm-kettlebell-row` | 0.40 | no RepDB record with matching name |
| `fedb:One-Arm_Side_Laterals` | `side-lying-lateral-raise` | 0.40 | no RepDB record with matching name |
| `fedb:Open_Palm_Kettlebell_Clean` | `double-kettlebell-clean` | 0.40 | no RepDB record with matching name |
| `fedb:Parallel_Bar_Dip` | `triceps-dip-hold-bars` | 0.40 | no RepDB record with matching name |
| `fedb:Power_Clean_from_Blocks` | `hang-power-clean` | 0.40 | no RepDB record with matching name |
| `fedb:Reverse_Band_Bench_Press` | `bench-press` | 0.40 | no RepDB record with matching name |
| `fedb:Reverse_Flyes_With_External_Rotation` | `cable-external-rotation` | 0.40 | no RepDB record with matching name |
| `fedb:Reverse_Triceps_Bench_Press` | `bench-press` | 0.40 | no RepDB record with matching name |
| `fedb:Round_The_World_Shoulder_Stretch` | `banded-shoulder-stretch` | 0.40 | no RepDB record with matching name |
| `fedb:Seated_Band_Hamstring_Curl` | `nordic-hamstring-curl` | 0.40 | no RepDB record with matching name |
| `fedb:Seated_Floor_Hamstring_Stretch` | `banded-hamstring-stretch` | 0.40 | no RepDB record with matching name |
| `fedb:Seated_Hamstring_and_Calf_Stretch` | `banded-calf-stretch` | 0.40 | no RepDB record with matching name |
| `fedb:Seated_Triceps_Press` | `seated-barbell-overhead-press` | 0.40 | no RepDB record with matching name |
| `fedb:Side-Lying_Floor_Stretch` | `lying-quad-stretch` | 0.40 | no RepDB record with matching name |
| `fedb:Side_Lying_Groin_Stretch` | `lying-quad-stretch` | 0.40 | no RepDB record with matching name |
| `fedb:Side_Standing_Long_Jump` | `standing-side-bend` | 0.40 | no RepDB record with matching name |
| `fedb:Single-Arm_Cable_Crossover` | `one-arm-seated-cable-row` | 0.40 | no RepDB record with matching name |
| `fedb:Smith_Incline_Shoulder_Raise` | `smith-machine-calf-raise` | 0.40 | no RepDB record with matching name |
| `fedb:Speed_Band_Overhead_Triceps` | `overhead-tricep-extension` | 0.40 | no RepDB record with matching name |
| `fedb:Standing_Alternating_Dumbbell_Press` | `db-bench-press` | 0.40 | no RepDB record with matching name |
| `fedb:Standing_Inner-Biceps_Curl` | `bicep-curl` | 0.40 | no RepDB record with matching name |
| `fedb:Standing_Palms-In_Dumbbell_Press` | `db-bench-press` | 0.40 | no RepDB record with matching name |
| `fedb:Standing_Soleus_And_Achilles_Stretch` | `standing-adductor-stretch` | 0.40 | no RepDB record with matching name |
| `fedb:Standing_Towel_Triceps_Extension` | `dumbbell-tricep-extension` | 0.40 | no RepDB record with matching name |
| `fedb:Two-Arm_Kettlebell_Clean` | `double-kettlebell-clean` | 0.40 | no RepDB record with matching name |
| `fedb:Two-Arm_Kettlebell_Jerk` | `double-kettlebell-jerk` | 0.40 | no RepDB record with matching name |
| `fedb:Two-Arm_Kettlebell_Row` | `double-kettlebell-row` | 0.40 | no RepDB record with matching name |
| `fedb:Weighted_Ball_Side_Bend` | `dumbbell-side-bend` | 0.40 | no RepDB record with matching name |
| `fedb:Wide_Stance_Barbell_Squat` | `barbell-box-squat` | 0.40 | no RepDB record with matching name |
| `fedb:Standing_Dumbbell_Straight-Arm_Front_Delt_Raise_Above_Head` | `dumbbell-front-raise` | 0.38 | no RepDB record with matching name |
| `fedb:Standing_Low-Pulley_One-Arm_Triceps_Extension` | `single-arm-dumbbell-overhead-tricep-extension` | 0.38 | no RepDB record with matching name |
| `fedb:Standing_Palms-Up_Barbell_Behind_The_Back_Wrist_Curl` | `barbell-wrist-curl` | 0.38 | no RepDB record with matching name |
| `fedb:3_4_Sit-Up` | `sit-ups` | 0.33 | no RepDB record with matching name |
| `fedb:90_90_Hamstring` | `90-90-hold` | 0.33 | no RepDB record with matching name |
| `fedb:Adductor` | `banded-adductor-stretch` | 0.33 | no RepDB record with matching name |
| `fedb:Ankle_On_The_Knee` | `high-knees` | 0.33 | no RepDB record with matching name |
| `fedb:Axle_Deadlift` | `deadlift` | 0.33 | no RepDB record with matching name |
| `fedb:Backward_Drag` | `drag-curl` | 0.33 | no RepDB record with matching name |
| `fedb:Balance_Board` | `step-up-to-balance` | 0.33 | no RepDB record with matching name |
| `fedb:Bench_Jump` | `bench-dips` | 0.33 | no RepDB record with matching name |
| `fedb:Bench_Sprint` | `bench-dips` | 0.33 | no RepDB record with matching name |
| `fedb:Bent_Over_One-Arm_Long_Bar_Row` | `barbell-row` | 0.33 | no RepDB record with matching name |
| `fedb:Bent_Press` | `arnold-press` | 0.33 | no RepDB record with matching name |
| `fedb:Board_Press` | `arnold-press` | 0.33 | no RepDB record with matching name |
| `fedb:Bodyweight_Flyes` | `bodyweight-squat` | 0.33 | no RepDB record with matching name |
| `fedb:Bosu_Ball_Cable_Crunch_With_Side_Bends` | `cable-crunch` | 0.33 | no RepDB record with matching name |
| `fedb:Bottoms-Up_Clean_From_The_Hang_Position` | `hang-clean` | 0.33 | no RepDB record with matching name |
| `fedb:Box_Skip` | `box-jump` | 0.33 | no RepDB record with matching name |
| `fedb:Butt-Ups` | `muscle-ups` | 0.33 | no RepDB record with matching name |
| `fedb:Calf_Press` | `arnold-press` | 0.33 | no RepDB record with matching name |
| `fedb:Calf_Stretch_Elbows_Against_Wall` | `banded-calf-stretch` | 0.33 | no RepDB record with matching name |
| `fedb:Calf_Stretch_Hands_Against_Wall` | `banded-calf-stretch` | 0.33 | no RepDB record with matching name |
| `fedb:Car_Deadlift` | `deadlift` | 0.33 | no RepDB record with matching name |
| `fedb:Chain_Press` | `arnold-press` | 0.33 | no RepDB record with matching name |
| `fedb:Chair_Leg_Extended_Stretch` | `captains-chair-leg-raise` | 0.33 | no RepDB record with matching name |
| `fedb:Chair_Squat` | `banded-squat` | 0.33 | no RepDB record with matching name |
| `fedb:Chair_Upper_Body_Stretch` | `cross-body-shoulder-stretch` | 0.33 | no RepDB record with matching name |
| `fedb:Clean_from_Blocks` | `clean` | 0.33 | no RepDB record with matching name |
| `fedb:Cuban_Press` | `arnold-press` | 0.33 | no RepDB record with matching name |
| `fedb:Dancers_Stretch` | `butterfly-stretch` | 0.33 | no RepDB record with matching name |
| `fedb:Deadlift_with_Bands` | `deadlift` | 0.33 | no RepDB record with matching name |
| `fedb:Deadlift_with_Chains` | `deadlift` | 0.33 | no RepDB record with matching name |
| `fedb:Drop_Push` | `push-jerk` | 0.33 | no RepDB record with matching name |
| `fedb:Dumbbell_Scaption` | `db-fly` | 0.33 | no RepDB record with matching name |
| `fedb:Elbow_to_Knee` | `high-knees` | 0.33 | no RepDB record with matching name |
| `fedb:Elbows_Back` | `back-extension` | 0.33 | no RepDB record with matching name |
| `fedb:Elevated_Back_Lunge` | `lunge` | 0.33 | no RepDB record with matching name |
| `fedb:Exercise_Ball_Pull-In` | `ball-pike` | 0.33 | no RepDB record with matching name |
| `fedb:Finger_Curls` | `barbell-curl` | 0.33 | no RepDB record with matching name |
| `fedb:Frankenstein_Squat` | `banded-squat` | 0.33 | no RepDB record with matching name |
| `fedb:Frog_Hops` | `frog-stretch` | 0.33 | no RepDB record with matching name |
| `fedb:Heaving_Snatch_Balance` | `snatch` | 0.33 | no RepDB record with matching name |
| `fedb:Hug_A_Ball` | `ball-pike` | 0.33 | no RepDB record with matching name |
| `fedb:Incline_Dumbbell_Bench_With_Palms_Facing_In` | `db-bench-press` | 0.33 | no RepDB record with matching name |
| `fedb:Isometric_Neck_Exercise_-_Front_And_Back` | `isometric-neck-side` | 0.33 | no RepDB record with matching name |
| `fedb:JM_Press` | `arnold-press` | 0.33 | no RepDB record with matching name |
| `fedb:Jefferson_Squats` | `banded-squat` | 0.33 | no RepDB record with matching name |
| `fedb:Jerk_Balance` | `clean-and-jerk` | 0.33 | no RepDB record with matching name |
| `fedb:Jogging_Treadmill` | `treadmill-running` | 0.33 | no RepDB record with matching name |
| `fedb:Knee_Circles` | `high-knees` | 0.33 | no RepDB record with matching name |
| `fedb:Knee_Hip_Raise_On_Parallel_Bars` | `hanging-knee-raise` | 0.33 | no RepDB record with matching name |
| `fedb:Kneeling_Cable_Crunch_With_Alternating_Oblique_Twists` | `cable-crunch` | 0.33 | no RepDB record with matching name |
| `fedb:Kneeling_Single-Arm_High_Pulley_Row` | `kneeling-cable-row` | 0.33 | no RepDB record with matching name |
| `fedb:Kneeling_Squat` | `banded-squat` | 0.33 | no RepDB record with matching name |
| `fedb:Landmine_180s` | `landmine-press` | 0.33 | no RepDB record with matching name |
| `fedb:London_Bridges` | `glute-bridge` | 0.33 | no RepDB record with matching name |
| `fedb:Lunge_Pass_Through` | `lunge` | 0.33 | no RepDB record with matching name |
| `fedb:Lying_Glute` | `glute-bridge` | 0.33 | no RepDB record with matching name |
| `fedb:Oblique_Crunches_-_On_The_Floor` | `crunches` | 0.33 | no RepDB record with matching name |
| `fedb:Olympic_Squat` | `banded-squat` | 0.33 | no RepDB record with matching name |
| `fedb:One-Arm_Open_Palm_Kettlebell_Clean` | `double-kettlebell-clean` | 0.33 | no RepDB record with matching name |
| `fedb:One-Arm_Side_Deadlift` | `one-arm-single-leg-dumbbell-romanian-deadlift` | 0.33 | no RepDB record with matching name |
| `fedb:Overhead_Lat` | `lat-pulldown` | 0.33 | no RepDB record with matching name |
| `fedb:Overhead_Slam` | `overhead-squat` | 0.33 | no RepDB record with matching name |
| `fedb:Peroneals_Stretch` | `butterfly-stretch` | 0.33 | no RepDB record with matching name |
| `fedb:Plate_Twist` | `plate-pinch` | 0.33 | no RepDB record with matching name |
| `fedb:Power_Jerk` | `clean-and-jerk` | 0.33 | no RepDB record with matching name |
| `fedb:Power_Stairs` | `stair-climber` | 0.33 | no RepDB record with matching name |
| `fedb:Push-Ups_With_Feet_Elevated` | `push-up` | 0.33 | no RepDB record with matching name |
| `fedb:Rack_Delivery` | `rack-pull` | 0.33 | no RepDB record with matching name |
| `fedb:Recumbent_Bike` | `air-bike` | 0.33 | no RepDB record with matching name |
| `fedb:Reverse_Crunch` | `bicycle-crunch` | 0.33 | no RepDB record with matching name |
| `fedb:Reverse_Hyperextension` | `reverse-crunches` | 0.33 | no RepDB record with matching name |
| `fedb:Rickshaw_Carry` | `sandbag-carry` | 0.33 | no RepDB record with matching name |
| `fedb:Rickshaw_Deadlift` | `deadlift` | 0.33 | no RepDB record with matching name |
| `fedb:Rocket_Jump` | `box-jump` | 0.33 | no RepDB record with matching name |
| `fedb:Rocky_Pull-Ups_Pulldowns` | `pull-up` | 0.33 | no RepDB record with matching name |
| `fedb:Rope_Crunch` | `battle-ropes` | 0.33 | no RepDB record with matching name |
| `fedb:Rope_Jumping` | `battle-ropes` | 0.33 | no RepDB record with matching name |
| `fedb:Rowing_Stationary` | `rowing-machine` | 0.33 | no RepDB record with matching name |
| `fedb:Runners_Stretch` | `butterfly-stretch` | 0.33 | no RepDB record with matching name |
| `fedb:Sandbag_Load` | `sandbag-carry` | 0.33 | no RepDB record with matching name |
| `fedb:Seated_Glute` | `glute-bridge` | 0.33 | no RepDB record with matching name |
| `fedb:Shotgun_Row` | `inverted-row` | 0.33 | no RepDB record with matching name |
| `fedb:Side_Bridge` | `glute-bridge` | 0.33 | no RepDB record with matching name |
| `fedb:Side_Jackknife` | `jackknife-sit-up` | 0.33 | no RepDB record with matching name |
| `fedb:Side_To_Side_Chins` | `side-lunge` | 0.33 | no RepDB record with matching name |
| `fedb:Sit_Squats` | `banded-squat` | 0.33 | no RepDB record with matching name |
| `fedb:Sledgehammer_Swings` | `kettlebell-swing` | 0.33 | no RepDB record with matching name |
| `fedb:Snatch_from_Blocks` | `snatch` | 0.33 | no RepDB record with matching name |
| `fedb:Speed_Squats` | `banded-squat` | 0.33 | no RepDB record with matching name |
| `fedb:Spider_Crawl` | `bear-crawl` | 0.33 | no RepDB record with matching name |
| `fedb:Spinal_Stretch` | `butterfly-stretch` | 0.33 | no RepDB record with matching name |
| `fedb:Split_Jump` | `box-jump` | 0.33 | no RepDB record with matching name |
| `fedb:Squat_Jerk` | `banded-squat` | 0.33 | no RepDB record with matching name |
| `fedb:Squat_with_Bands` | `banded-squat` | 0.33 | no RepDB record with matching name |
| `fedb:Squat_with_Chains` | `banded-squat` | 0.33 | no RepDB record with matching name |
| `fedb:Standing_Cable_Lift` | `standing-forward-fold-to-half-lift` | 0.33 | no RepDB record with matching name |
| `fedb:Standing_Low-Pulley_Deltoid_Raise` | `standing-calf-raise` | 0.33 | no RepDB record with matching name |
| `fedb:Star_Jump` | `box-jump` | 0.33 | no RepDB record with matching name |
| `fedb:Straight_Raises_on_Incline_Bench` | `close-grip-incline-bench` | 0.33 | no RepDB record with matching name |
| `fedb:Supine_One-Arm_Overhead_Throw` | `landmine-single-arm-overhead-hold` | 0.33 | no RepDB record with matching name |
| `fedb:Suspended_Row` | `inverted-row` | 0.33 | no RepDB record with matching name |
| `fedb:Tate_Press` | `arnold-press` | 0.33 | no RepDB record with matching name |
| `fedb:The_Straddle` | `seated-straddle-stretch` | 0.33 | no RepDB record with matching name |
| `fedb:Toe_Touchers` | `toes-to-bar` | 0.33 | no RepDB record with matching name |
| `fedb:Torso_Rotation` | `torso-twists` | 0.33 | no RepDB record with matching name |
| `fedb:Trail_Running_Walking` | `running` | 0.33 | no RepDB record with matching name |
| `fedb:Tuck_Crunch` | `bicycle-crunch` | 0.33 | no RepDB record with matching name |
| `fedb:Two-Arm_Kettlebell_Military_Press` | `kettlebell-floor-press` | 0.33 | no RepDB record with matching name |
| `fedb:Upper_Back-Leg_Grab` | `leg-swing-front-to-back` | 0.33 | no RepDB record with matching name |
| `fedb:Upward_Stretch` | `butterfly-stretch` | 0.33 | no RepDB record with matching name |
| `fedb:Vertical_Swing` | `kettlebell-swing` | 0.33 | no RepDB record with matching name |
| `fedb:Weighted_Sit-Ups_-_With_Bands` | `sit-ups` | 0.33 | no RepDB record with matching name |
| `fedb:Weighted_Squat` | `banded-squat` | 0.33 | no RepDB record with matching name |
| `fedb:Wrist_Circles` | `wrist-roller` | 0.33 | no RepDB record with matching name |
| `fedb:Bent_Over_Low-Pulley_Side_Lateral` | `side-lying-lateral-raise` | 0.29 | no RepDB record with matching name |
| `fedb:Bent_Over_Two-Arm_Long_Bar_Row` | `barbell-row` | 0.29 | no RepDB record with matching name |
| `fedb:Lying_Close-Grip_Bar_Curl_On_High_Pulley` | `close-grip-barbell-curl` | 0.29 | no RepDB record with matching name |
| `fedb:Lying_Close-Grip_Barbell_Triceps_Press_To_Chin` | `bench-press` | 0.29 | no RepDB record with matching name |
| `fedb:One-Arm_High-Pulley_Cable_Side_Bends` | `dumbbell-side-bend` | 0.29 | no RepDB record with matching name |
| `fedb:Palms-Down_Wrist_Curl_Over_A_Bench` | `barbell-wrist-curl` | 0.29 | no RepDB record with matching name |
| `fedb:Pushups_Close_and_Wide_Hand_Positions` | `stability-ball-push-up-hands-on-ball` | 0.29 | no RepDB record with matching name |
| `fedb:Adductor_Groin` | `banded-adductor-stretch` | 0.25 | no RepDB record with matching name |
| `fedb:Alternate_Heel_Touchers` | `heel-flicks` | 0.25 | no RepDB record with matching name |
| `fedb:Ankle_Circles` | `banded-ankle-stretch` | 0.25 | no RepDB record with matching name |
| `fedb:Anti-Gravity_Press` | `arnold-press` | 0.25 | no RepDB record with matching name |
| `fedb:Arm_Circles` | `flexed-arm-hang` | 0.25 | no RepDB record with matching name |
| `fedb:Around_The_Worlds` | `worlds-greatest-stretch` | 0.25 | no RepDB record with matching name |
| `fedb:Atlas_Stone_Trainer` | `elliptical-trainer` | 0.25 | no RepDB record with matching name |
| `fedb:Back_Flyes_-_With_Bands` | `back-extension` | 0.25 | no RepDB record with matching name |
| `fedb:Bent_Over_Dumbbell_Rear_Delt_Raise_With_Head_On_Bench` | `bent-over-db-row` | 0.25 | no RepDB record with matching name |
| `fedb:Body-Up` | `cross-body-crunch` | 0.25 | no RepDB record with matching name |
| `fedb:Body_Tricep_Press` | `arnold-press` | 0.25 | no RepDB record with matching name |
| `fedb:Bodyweight_Mid_Row` | `bodyweight-squat` | 0.25 | no RepDB record with matching name |
| `fedb:Cable_Iron_Cross` | `cable-crunch` | 0.25 | no RepDB record with matching name |
| `fedb:Cable_Judo_Flip` | `cable-crunch` | 0.25 | no RepDB record with matching name |
| `fedb:Calves-SMR` | `banded-calf-stretch` | 0.25 | no RepDB record with matching name |
| `fedb:Catch_and_Overhead_Throw` | `overhead-squat` | 0.25 | no RepDB record with matching name |
| `fedb:Chain_Handle_Extension` | `back-extension` | 0.25 | no RepDB record with matching name |
| `fedb:Conans_Wheel` | `ab-wheel-rollout` | 0.25 | no RepDB record with matching name |
| `fedb:Crunch_-_Hands_Overhead` | `bicycle-crunch` | 0.25 | no RepDB record with matching name |
| `fedb:Depth_Jump_Leap` | `box-jump` | 0.25 | no RepDB record with matching name |
| `fedb:Dumbbell_Lying_Pronation` | `db-fly` | 0.25 | no RepDB record with matching name |
| `fedb:Dumbbell_Lying_Supination` | `db-fly` | 0.25 | no RepDB record with matching name |
| `fedb:Dynamic_Back_Stretch` | `back-extension` | 0.25 | no RepDB record with matching name |
| `fedb:Floor_Glute-Ham_Raise` | `one-arm-kettlebell-floor-glute-bridge-press` | 0.25 | no RepDB record with matching name |
| `fedb:Forward_Drag_with_Press` | `arnold-press` | 0.25 | no RepDB record with matching name |
| `fedb:Glute_Ham_Raise` | `glute-bridge` | 0.25 | no RepDB record with matching name |
| `fedb:Gorilla_Chin_Crunch` | `bicycle-crunch` | 0.25 | no RepDB record with matching name |
| `fedb:Groin_and_Back_Stretch` | `back-extension` | 0.25 | no RepDB record with matching name |
| `fedb:Hamstring-SMR` | `banded-hamstring-stretch` | 0.25 | no RepDB record with matching name |
| `fedb:Hip_Circles_prone` | `hip-adduction` | 0.25 | no RepDB record with matching name |
| `fedb:Hip_Extension_with_Bands` | `back-extension` | 0.25 | no RepDB record with matching name |
| `fedb:Hip_Flexion_with_Band` | `hip-adduction` | 0.25 | no RepDB record with matching name |
| `fedb:Hip_Lift_with_Band` | `hip-adduction` | 0.25 | no RepDB record with matching name |
| `fedb:Intermediate_Groin_Stretch` | `butterfly-stretch` | 0.25 | no RepDB record with matching name |
| `fedb:Iron_Cross` | `cross-body-crunch` | 0.25 | no RepDB record with matching name |
| `fedb:Iron_Crosses_stretch` | `butterfly-stretch` | 0.25 | no RepDB record with matching name |
| `fedb:Isometric_Chest_Squeezes` | `dips` | 0.25 | no RepDB record with matching name |
| `fedb:Isometric_Wipers` | `isometric-split-squat` | 0.25 | no RepDB record with matching name |
| `fedb:Jerk_Dip_Squat` | `banded-squat` | 0.25 | no RepDB record with matching name |
| `fedb:Kettlebell_Figure_8` | `kettlebell-curl` | 0.25 | no RepDB record with matching name |
| `fedb:Kettlebell_Pirate_Ships` | `kettlebell-curl` | 0.25 | no RepDB record with matching name |
| `fedb:Knee_Across_The_Body` | `high-knees` | 0.25 | no RepDB record with matching name |
| `fedb:Landmine_Linear_Jammer` | `landmine-press` | 0.25 | no RepDB record with matching name |
| `fedb:Lateral_Bound` | `banded-lateral-walk` | 0.25 | no RepDB record with matching name |
| `fedb:Linear_Depth_Jump` | `box-jump` | 0.25 | no RepDB record with matching name |
| `fedb:Low_Cable_Crossover` | `cable-crunch` | 0.25 | no RepDB record with matching name |
| `fedb:Lower_Back-SMR` | `back-extension` | 0.25 | no RepDB record with matching name |
| `fedb:Lower_Back_Curl` | `back-extension` | 0.25 | no RepDB record with matching name |
| `fedb:Lying_Crossover` | `leg-curl` | 0.25 | no RepDB record with matching name |
| `fedb:Lying_Hamstring` | `banded-hamstring-stretch` | 0.25 | no RepDB record with matching name |
| `fedb:Lying_Machine_Squat` | `back-lever` | 0.25 | no RepDB record with matching name |
| `fedb:Middle_Back_Stretch` | `back-extension` | 0.25 | no RepDB record with matching name |
| `fedb:Monster_Walk` | `banded-lateral-walk` | 0.25 | no RepDB record with matching name |
| `fedb:Narrow_Stance_Squats` | `banded-squat` | 0.25 | no RepDB record with matching name |
| `fedb:Neck-SMR` | `behind-the-neck-press` | 0.25 | no RepDB record with matching name |
| `fedb:One_Arm_Against_Wall` | `single-arm-plank` | 0.25 | no RepDB record with matching name |
| `fedb:One_Half_Locust` | `locust-pose` | 0.25 | no RepDB record with matching name |
| `fedb:One_Handed_Hang` | `dead-hang` | 0.25 | no RepDB record with matching name |
| `fedb:Otis-Up` | `ring-muscle-up` | 0.25 | no RepDB record with matching name |
| `fedb:Posterior_Tibialis_Stretch` | `butterfly-stretch` | 0.25 | no RepDB record with matching name |
| `fedb:Power_Partials` | `hang-power-clean` | 0.25 | no RepDB record with matching name |
| `fedb:Power_Snatch_from_Blocks` | `snatch` | 0.25 | no RepDB record with matching name |
| `fedb:Push-Ups_-_Close_Triceps_Position` | `push-up` | 0.25 | no RepDB record with matching name |
| `fedb:Reverse_Band_Deadlift` | `deadlift` | 0.25 | no RepDB record with matching name |
| `fedb:Seated_Biceps` | `bicep-curl` | 0.25 | no RepDB record with matching name |
| `fedb:Seated_Front_Deltoid` | `front-lever` | 0.25 | no RepDB record with matching name |
| `fedb:Seated_Hamstring` | `banded-hamstring-stretch` | 0.25 | no RepDB record with matching name |
| `fedb:Shoulder_Circles` | `banded-shoulder-stretch` | 0.25 | no RepDB record with matching name |
| `fedb:Shoulder_Raise` | `banded-shoulder-stretch` | 0.25 | no RepDB record with matching name |
| `fedb:Side_Hop-Sprint` | `side-lunge` | 0.25 | no RepDB record with matching name |
| `fedb:Side_Wrist_Pull` | `bench-pull` | 0.25 | no RepDB record with matching name |
| `fedb:Side_to_Side_Box_Shuffle` | `box-jump` | 0.25 | no RepDB record with matching name |
| `fedb:Single-Arm_Linear_Jammer` | `single-arm-plank` | 0.25 | no RepDB record with matching name |
| `fedb:Single-Leg_Hop_Progression` | `single-leg-extension` | 0.25 | no RepDB record with matching name |
| `fedb:Single-Leg_Lateral_Hop` | `single-leg-extension` | 0.25 | no RepDB record with matching name |
| `fedb:Single-Leg_Stride_Jump` | `box-jump` | 0.25 | no RepDB record with matching name |
| `fedb:Single_Leg_Butt_Kick` | `flutter-kicks` | 0.25 | no RepDB record with matching name |
| `fedb:Single_Leg_Push-off` | `push-jerk` | 0.25 | no RepDB record with matching name |
| `fedb:Sled_Drag_-_Harness` | `drag-curl` | 0.25 | no RepDB record with matching name |
| `fedb:Squat_with_Plate_Movers` | `banded-squat` | 0.25 | no RepDB record with matching name |
| `fedb:Standing_Bradford_Press` | `arnold-press` | 0.25 | no RepDB record with matching name |
| `fedb:Standing_Long_Jump` | `box-jump` | 0.25 | no RepDB record with matching name |
| `fedb:Standing_Pelvic_Tilt` | `standing-split` | 0.25 | no RepDB record with matching name |
| `fedb:Standing_Rope_Crunch` | `battle-ropes` | 0.25 | no RepDB record with matching name |
| `fedb:Standing_Toe_Touches` | `heel-touches` | 0.25 | no RepDB record with matching name |
| `fedb:Stride_Jump_Crossover` | `box-jump` | 0.25 | no RepDB record with matching name |
| `fedb:Supine_Chest_Throw` | `dips` | 0.25 | no RepDB record with matching name |
| `fedb:Suspended_Reverse_Crunch` | `bicycle-crunch` | 0.25 | no RepDB record with matching name |
| `fedb:Underhand_Cable_Pulldowns` | `cable-crunch` | 0.25 | no RepDB record with matching name |
| `fedb:Upper_Back_Stretch` | `back-extension` | 0.25 | no RepDB record with matching name |
| `fedb:Weighted_Ball_Hyperextension` | `ball-pike` | 0.25 | no RepDB record with matching name |
| `fedb:Wrist_Rotations_with_Straight_Bar` | `straight-bar-dips` | 0.25 | no RepDB record with matching name |
| `fedb:Yoke_Walk` | `banded-lateral-walk` | 0.25 | no RepDB record with matching name |
| `fedb:Alternate_Leg_Diagonal_Bound` | `leg-extension` | 0.20 | no RepDB record with matching name |
| `fedb:Alternating_Deltoid_Raise` | `barbell-calf-raise` | 0.20 | no RepDB record with matching name |
| `fedb:Anterior_Tibialis-SMR` | `kettlebell-tibialis-raise` | 0.20 | no RepDB record with matching name |
| `fedb:Chair_Lower_Back_Stretch` | `back-extension` | 0.20 | no RepDB record with matching name |
| `fedb:Chest_Push_multiple_response` | `dips` | 0.20 | no RepDB record with matching name |
| `fedb:Chest_Push_single_response` | `dips` | 0.20 | no RepDB record with matching name |
| `fedb:Chest_Push_with_Run_Release` | `dips` | 0.20 | no RepDB record with matching name |
| `fedb:Cross_Over_-_With_Bands` | `band-assisted-pull-ups` | 0.20 | no RepDB record with matching name |
| `fedb:Double_Leg_Butt_Kick` | `flutter-kicks` | 0.20 | no RepDB record with matching name |
| `fedb:Foot-SMR` | `high-foot-leg-press` | 0.20 | no RepDB record with matching name |
| `fedb:Gironda_Sternum_Chins` | `chin-tuck-hold` | 0.20 | no RepDB record with matching name |
| `fedb:Heavy_Bag_Thrust` | `banded-hip-thrust` | 0.20 | no RepDB record with matching name |
| `fedb:Kettlebell_Pass_Between_The_Legs` | `kettlebell-curl` | 0.20 | no RepDB record with matching name |
| `fedb:Kneeling_Arm_Drill` | `flexed-arm-hang` | 0.20 | no RepDB record with matching name |
| `fedb:Lateral_Cone_Hops` | `banded-lateral-walk` | 0.20 | no RepDB record with matching name |
| `fedb:Linear_Acceleration_Wall_Drill` | `wall-ball` | 0.20 | no RepDB record with matching name |
| `fedb:Log_Lift` | `side-plank-leg-lift` | 0.20 | no RepDB record with matching name |
| `fedb:Low_Pulley_Row_To_Neck` | `inverted-row` | 0.20 | no RepDB record with matching name |
| `fedb:Lying_Prone_Quadriceps` | `leg-curl` | 0.20 | no RepDB record with matching name |
| `fedb:Mixed_Grip_Chin` | `chin-tuck-hold` | 0.20 | no RepDB record with matching name |
| `fedb:Natural_Glute_Ham_Raise` | `glute-bridge` | 0.20 | no RepDB record with matching name |
| `fedb:Pelvic_Tilt_Into_Bridge` | `glute-bridge` | 0.20 | no RepDB record with matching name |
| `fedb:Platform_Hamstring_Slides` | `banded-hamstring-stretch` | 0.20 | no RepDB record with matching name |
| `fedb:Prone_Manual_Hamstring` | `banded-hamstring-stretch` | 0.20 | no RepDB record with matching name |
| `fedb:Return_Push_from_Stance` | `push-jerk` | 0.20 | no RepDB record with matching name |
| `fedb:Reverse_Band_Power_Squat` | `banded-squat` | 0.20 | no RepDB record with matching name |
| `fedb:Seated_Two-Arm_Palms-Up_Low-Pulley_Wrist_Curl` | `barbell-wrist-curl` | 0.20 | no RepDB record with matching name |
| `fedb:Sled_Overhead_Backward_Walk` | `overhead-squat` | 0.20 | no RepDB record with matching name |
| `fedb:Standing_Cable_Wood_Chop` | `cable-crunch` | 0.20 | no RepDB record with matching name |
| `fedb:Straight_Bar_Bench_Mid_Rows` | `bench-dips` | 0.20 | no RepDB record with matching name |
| `fedb:Front_Cone_Hops_or_hurdle_hops` | `front-lever` | 0.17 | no RepDB record with matching name |
| `fedb:See-Saw_Press_Alternating_Side_Press` | `arnold-press` | 0.17 | no RepDB record with matching name |
| `fedb:Standing_Olympic_Plate_Hand_Squeeze` | `plate-pinch` | 0.17 | no RepDB record with matching name |
| `fedb:Standing_Two-Arm_Overhead_Throw` | `overhead-squat` | 0.17 | no RepDB record with matching name |
| `fedb:Supine_Two-Arm_Overhead_Throw` | `overhead-squat` | 0.17 | no RepDB record with matching name |
| `fedb:Chest_Push_from_3_point_stance` | `dips` | 0.14 | no RepDB record with matching name |
| `fedb:Lying_Face_Down_Plate_Neck_Resistance` | `plate-pinch` | 0.14 | no RepDB record with matching name |
| `fedb:Lying_Face_Up_Plate_Neck_Resistance` | `plate-pinch` | 0.14 | no RepDB record with matching name |
| `fedb:Seated_Head_Harness_Neck_Resistance` | `behind-the-neck-press` | 0.14 | no RepDB record with matching name |
| `fedb:Single-Cone_Sprint_Drill` | `single-db-svend-press` | 0.14 | no RepDB record with matching name |
| `fedb:Atlas_Stones` | - | 0.00 | no RepDB record with matching name |
| `fedb:Brachialis-SMR` | - | 0.00 | no RepDB record with matching name |
| `fedb:Bradford_Rocky_Presses` | - | 0.00 | no RepDB record with matching name |
| `fedb:Car_Drivers` | - | 0.00 | no RepDB record with matching name |
| `fedb:Carioca_Quick_Step` | - | 0.00 | no RepDB record with matching name |
| `fedb:Circus_Bell` | - | 0.00 | no RepDB record with matching name |
| `fedb:Crucifix` | - | 0.00 | no RepDB record with matching name |
| `fedb:Elbow_Circles` | - | 0.00 | no RepDB record with matching name |
| `fedb:Fast_Skipping` | - | 0.00 | no RepDB record with matching name |
| `fedb:Groiners` | - | 0.00 | no RepDB record with matching name |
| `fedb:Hurdle_Hops` | - | 0.00 | no RepDB record with matching name |
| `fedb:Iliotibial_Tract-SMR` | - | 0.00 | no RepDB record with matching name |
| `fedb:Keg_Load` | - | 0.00 | no RepDB record with matching name |
| `fedb:Latissimus_Dorsi-SMR` | - | 0.00 | no RepDB record with matching name |
| `fedb:Linear_3-Part_Start_Technique` | - | 0.00 | no RepDB record with matching name |
| `fedb:Looking_At_Ceiling` | - | 0.00 | no RepDB record with matching name |
| `fedb:Moving_Claw_Series` | - | 0.00 | no RepDB record with matching name |
| `fedb:Peroneals-SMR` | - | 0.00 | no RepDB record with matching name |
| `fedb:Pin_Presses` | - | 0.00 | no RepDB record with matching name |
| `fedb:Piriformis-SMR` | - | 0.00 | no RepDB record with matching name |
| `fedb:Prowler_Sprint` | - | 0.00 | no RepDB record with matching name |
| `fedb:Quadriceps-SMR` | - | 0.00 | no RepDB record with matching name |
| `fedb:Quick_Leap` | - | 0.00 | no RepDB record with matching name |
| `fedb:Rhomboids-SMR` | - | 0.00 | no RepDB record with matching name |
| `fedb:Skating` | - | 0.00 | no RepDB record with matching name |
| `fedb:Spell_Caster` | - | 0.00 | no RepDB record with matching name |
| `fedb:Stairmaster` | - | 0.00 | no RepDB record with matching name |
| `fedb:Step_Mill` | - | 0.00 | no RepDB record with matching name |
| `fedb:Stomach_Vacuum` | - | 0.00 | no RepDB record with matching name |
| `fedb:Suspended_Fallout` | - | 0.00 | no RepDB record with matching name |
| `fedb:Tire_Flip` | - | 0.00 | no RepDB record with matching name |
| `fedb:Wind_Sprints` | - | 0.00 | no RepDB record with matching name |

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

## 8. Reproduce

```
cd app
python -I -X utf8 data-pipeline/repdb/build_repdb.py            # downloads into data-pipeline/raw/repdb/<sha12>/ (gitignored)
python -I -X utf8 data-pipeline/repdb/build_repdb.py --offline  # rebuild from the cache only
```

To change the upstream version, edit `PINNED_SHA`, re-read LICENSE-DATA.md, rerun and review sections 4-6. To fix a wrong automatic pair, add `fedb:<id>,-,BLOCK: <reason>` (or the correct RepDB id) to `overrides.csv`.

Note for the app: the PWA precache pattern in `vite.config.ts` (`**/*.{js,css,html,svg,png,woff2,json}`) does not include `.webp`, so these images are fetched on demand and are only available offline if a runtime cache is added. `exercise-media.json` itself is precached.
