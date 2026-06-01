export interface SportProfile {
  label: string;
  trainingFocus: string;
  keyQualities: string[];
  nutritionFocus: string;
  mealTiming: string;
  keyExercises: string[];
  coachingContext: string;
}

export const SPORT_PROFILES: Record<string, SportProfile> = {
  none: {
    label: 'General Fitness',
    trainingFocus: 'balanced strength, conditioning, and body composition',
    keyQualities: ['strength', 'endurance', 'mobility', 'body composition'],
    nutritionFocus: 'balanced macros — roughly 0.7–1g protein per lb bodyweight, moderate carbs around training, healthy fats',
    mealTiming: 'eat a balanced meal 1–2 hours before training; refuel with protein + carbs within 60 minutes after',
    keyExercises: ['Squat', 'Deadlift', 'Bench Press', 'Pull-Ups', 'Overhead Press', 'Romanian Deadlift'],
    coachingContext: `The user trains for general fitness and health. Apply these principles:

PROGRAMMING: 3–4 days/week full body or upper/lower split. Focus on compound movements first, accessories second. Progressive overload is the primary driver of progress — add weight or reps each week.

REP RANGES: Strength work 3–5 reps; hypertrophy 8–15 reps; endurance 15–20+ reps. Vary across a training block.

RECOVERY: Beginners need 48 hours between sessions for the same muscle group. Sleep (7–9 hrs) and nutrition are the biggest recovery levers.

COMMON MISTAKES: Skipping warm-up, programming hopping, neglecting posterior chain, not tracking progressive overload.`,
  },

  bodybuilding: {
    label: 'Bodybuilding',
    trainingFocus: 'hypertrophy, muscle isolation, symmetry, and peak week conditioning',
    keyQualities: ['muscle size', 'muscle definition', 'mind-muscle connection', 'symmetry', 'vascularity'],
    nutritionFocus: 'high protein (0.8–1.2g per lb bodyweight), carb cycling (high on training days, lower on rest days), moderate dietary fat (0.3–0.5g per lb), timed around sessions for maximal anabolism',
    mealTiming: 'fast-digesting carbs + 30–40g protein within 30 min post-workout; spread 4–6 meals across the day to stay anabolic; casein protein before bed for overnight muscle protein synthesis',
    keyExercises: ['Barbell Bench Press', 'Incline Dumbbell Press', 'Cable Fly', 'Lat Pulldown', 'Cable Row', 'Leg Press', 'Hack Squat', 'Lying Leg Curl', 'Preacher Curl', 'Skull Crusher', 'Cable Lateral Raise', 'Rear Delt Fly'],
    coachingContext: `The user is a bodybuilder focused on hypertrophy, aesthetics, and muscle symmetry.

PROGRAMMING PRINCIPLES:
- Volume is the primary driver of hypertrophy: aim for 10–20 working sets per muscle group per week
- Use a PPL (Push/Pull/Legs) 6-day split or Upper/Lower 4-day for most intermediates
- Train each muscle group 2x/week minimum — frequency matters as much as volume
- Leave 1–3 reps in reserve (RIR) on most sets; go to failure occasionally on isolation work only

REP RANGES & TECHNIQUE:
- Hypertrophy sweet spot: 8–15 reps at 65–80% 1RM
- Emphasise time under tension (TUT): 2–3 sec eccentric, brief pause at stretch, explosive concentric
- Mind-muscle connection is critical — use lighter loads if needed to feel the target muscle
- Advanced techniques: drop sets, supersets, rest-pause, mechanical drop sets (use sparingly, 1–2 per session)

WEAK POINTS & SYMMETRY:
- Prioritise lagging muscle groups at the start of sessions when fresh
- Common weak points: rear delts, serratus anterior, VMO, long head bicep

BULKING / CUTTING:
- Lean bulk: 250–350 calorie surplus, maximises muscle gain while minimising fat
- Cut: 300–500 calorie deficit, keep protein very high (1.2g/lb) to preserve muscle
- Avoid extreme bulks — they primarily add fat after the first few weeks

COMMON MISTAKES: Neglecting compound movements for isolation-only training; insufficient weekly volume; not tracking progressive overload on each exercise; cutting calories too aggressively during prep.`,
  },

  powerlifting: {
    label: 'Powerlifting',
    trainingFocus: 'maximal strength in squat, bench press, and deadlift — training the competition lifts and their variations',
    keyQualities: ['maximal strength', 'neuromuscular efficiency', 'technique under fatigue', 'competition peaking'],
    nutritionFocus: 'calorie surplus to support strength gains (10–15% above maintenance); high protein (0.8–1g per lb); high carbs (3–5g per lb) for glycolytic training demands; strategic weight management for weight class',
    mealTiming: 'large carb-heavy meal 2–3 hours pre-training; simple carbs + protein immediately post-training; prioritise total daily intake over intra-workout timing for powerlifters',
    keyExercises: ['Barbell Back Squat', 'Low Bar Squat', 'Conventional Deadlift', 'Sumo Deadlift', 'Barbell Bench Press', 'Pause Squat', 'Romanian Deadlift', 'Close-Grip Bench Press', 'Good Morning', 'Belt Squat', 'Tricep Pushdown', 'Pendlay Row'],
    coachingContext: `The user is a powerlifter training for maximal squat, bench press, and deadlift.

PROGRAMMING FRAMEWORKS:
- Linear progression (novice): GZCLP, Starting Strength, StrongLifts 5x5
- Intermediate: 5/3/1 (Wendler), GZCL method, Juggernaut, nSuns
- Advanced: Sheiko, Conjugate/Westside, RTS Generalized Intermediate
- Typical structure: 3–5 days/week; each competition lift trained 2–3x/week

INTENSITY & VOLUME:
- Work in multiple rep ranges: 1–3 reps (>90% 1RM) for neural adaptation; 3–5 reps (80–90%) for strength; 5–8 reps (70–80%) for volume
- Use RPE (Rate of Perceived Exertion) scale 1–10: most training at RPE 7–8, top sets at RPE 9
- Autoregulation: adjust loads based on daily readiness, not fixed percentages alone

TECHNIQUE PRIORITIES:
- Squat: bar position (high vs low bar), hip hinge vs knee dominant, bracing mechanics, depth standards
- Bench: arch, leg drive, scapular retraction, bar path, pause at chest for competition
- Deadlift: conventional vs sumo stance, starting position, lat engagement, lockout mechanics

ACCESSORY WORK:
- Target weak points in each competition lift
- Squat accessories: pause squats, box squats, SSB squat, leg press, GHR
- Bench accessories: close-grip bench, board press, tricep work (pushdowns, JM press), larsen press
- Deadlift accessories: Romanian DL, deficit deadlift, rack pulls, good mornings, barbell row

COMPETITION PREP (PEAKING):
- 4–6 week peak: reduce volume 40–60%, maintain intensity, increase specificity
- Openers should be 90–93% of expected max — something you can triple on a bad day
- Third attempts should be realistic competition PRs, not lottery lifts

COMMON MISTAKES: Using too much equipment (belt, wraps) before mastering technique; ego lifting with poor form; neglecting upper back strength; skipping accessory work; cutting weight too aggressively before a meet.`,
  },

  crossfit: {
    label: 'CrossFit',
    trainingFocus: 'broad GPP — Olympic weightlifting, gymnastics, and metabolic conditioning across all time domains',
    keyQualities: ['work capacity', 'aerobic power', 'Olympic lifting technique', 'gymnastics skill', 'mental toughness'],
    nutritionFocus: 'high carbs (3–5g per lb) for WOD intensity, high protein (0.8–1g per lb) for recovery from high volume, electrolytes for heavy sweat sessions',
    mealTiming: 'light carb-based snack (banana, rice cake) 60–90 min pre-WOD; protein + carbs immediately post-WOD; electrolyte drink during long AMRAPs or outdoor workouts',
    keyExercises: ['Clean & Jerk', 'Snatch', 'Thruster', 'Muscle-Up (Ring & Bar)', 'Kipping Pull-Up', 'Handstand Push-Up', 'Box Jump', 'Burpee', 'Wall Ball', 'Double-Under', 'GHD Sit-Up', 'Toes-to-Bar'],
    coachingContext: `The user does CrossFit — training involves Olympic lifting, gymnastics, and metabolic conditioning.

OLYMPIC LIFTING:
- Snatch: overhead squat mobility prerequisite; focus on lat engagement, aggressive pull under the bar, catch in squat
- Clean & Jerk: front rack flexibility is critical; drive through heels on jerk dip, aggressive hip extension
- Common faults: early arm bend, slow elbows in clean, press-out in snatch — address these before loading heavily
- Drill progression: hang positions → blocks → floor → full movement

GYMNASTICS PROGRESSIONS:
- Pull-up → kipping pull-up → butterfly pull-up → chest-to-bar → muscle-up
- Prerequisites for muscle-up: strict pull-up with full ROM, dip, transition drill on low rings
- Handstand: wall holds → kick-ups → freestanding → HSPU (strict before kipping)
- Toes-to-bar: dead hang first, then kip, then TTB — never skip hollow/arch swing

WOD STRATEGY & PACING:
- Time domains change the strategy: <5 min (sprint, go hard); 5–15 min (threshold pace, sustainable); 15+ min (aerobic, conversational)
- Learn to pace: going out too hot in a 20-min AMRAP is the most common mistake
- Break sets early and often — unbroken sets that fail mid-way cost more time than planned breaks
- Transitions matter: smooth, fast transitions can save 30–60 sec in a workout

SCALING PHILOSOPHY:
- Scale to maintain intended stimulus, not just reduce reps
- Weight scales before movement modifications where possible
- RX is irrelevant — your best relative effort is what matters

COMMON MISTAKES: Neglecting strict strength for kipping skills; poor Olympic lifting technique under fatigue; no aerobic base work outside WODs; under-recovering from high training volume.`,
  },

  running: {
    label: 'Running',
    trainingFocus: 'aerobic base, running economy, lactate threshold, and injury resilience',
    keyQualities: ['aerobic capacity (VO2 max)', 'lactate threshold', 'running economy', 'injury resilience', 'mental endurance'],
    nutritionFocus: 'high carbs as primary fuel (55–65% of total calories); 0.6–0.8g protein per lb for muscle repair; fat important for long aerobic efforts; iron and B12 monitoring for high-volume runners',
    mealTiming: 'carb-rich meal 2–3 hours before long runs; 30–60g carbs per hour for runs over 60 min (gels, dates, banana); protein + carbs within 30 min post-run for recovery; low-fibre foods pre-race to prevent GI issues',
    keyExercises: ['Single-Leg Romanian Deadlift', 'Hip Thrust', 'Nordic Hamstring Curl', 'Calf Raise (single leg)', 'Step-Up', 'Side-Lying Clamshell', 'Side-Lying Hip Abduction', 'Dead Bug', 'Copenhagen Plank', 'A-Skip', 'B-Skip'],
    coachingContext: `The user is a runner. Training revolves around building aerobic capacity and running economy.

TRAINING ZONES:
- Zone 1–2 (easy, conversational): 80% of weekly mileage — builds aerobic base, improves mitochondrial density
- Zone 3 (tempo/threshold): comfortably hard, about 1 hour race pace; lactate threshold development
- Zone 4–5 (VO2 max intervals): 800m–1 mile repeats at 5K race pace; improve maximal aerobic power
- 80/20 principle: 80% easy, 20% hard — most runners run their easy days too fast

MILEAGE PROGRESSION:
- 10% rule: never increase weekly mileage more than 10% per week
- Build phase: 3–4 weeks build, 1 week cutback (reduce volume 20–30%)
- Most injury risk comes from rapid mileage increases, not from high volume itself

STRENGTH TRAINING FOR RUNNERS:
- 2x/week strength: focus on posterior chain and single-leg stability
- Nordic hamstring curls are the #1 exercise for hamstring injury prevention
- Hip abductor and glute med work prevents IT band syndrome and knee valgus
- Calf raises (bent and straight knee) prevent Achilles tendinopathy
- Avoid heavy leg training 48 hours before a key run

COMMON RUNNING INJURIES:
- IT Band Syndrome: hip abductor weakness, overstriding — fix with clamshells, hip hikes, gait cues
- Shin splints: too much too soon — reduce volume, calf raises, improve footwear
- Plantar fasciitis: calf tightness, high mileage — calf stretching, toe curls, reduced mileage
- Runner's knee (PFPS): quad weakness, hip drop — step-downs, single-leg squat work
- Stress fractures: insufficient calcium/vitamin D, low energy availability — nutrition review critical

RACE PREPARATION: 2–3 week taper before marathon (reduce volume 40–50%, maintain intensity); 1-week taper for 5K/10K.`,
  },

  cycling: {
    label: 'Cycling',
    trainingFocus: 'aerobic power, functional threshold power (FTP), and sport-specific lower body strength',
    keyQualities: ['VO2 max', 'functional threshold power (FTP)', 'lactate threshold', 'pedalling efficiency', 'power-to-weight ratio'],
    nutritionFocus: 'very high carb intake on ride days (6–10g per kg bodyweight); 60–90g carbs per hour on the bike; high protein (0.7–0.9g per lb) for muscle repair; power-to-weight ratio is critical — excess body fat directly impairs performance',
    mealTiming: 'carb-heavy meal 2–3 hours pre-ride; 60–90g carbs per hour during rides over 60 min (mix of glucose + fructose sources); recovery shake with 4:1 carb:protein ratio within 30 min post-ride',
    keyExercises: ['Barbell Back Squat', 'Leg Press', 'Single-Leg Press', 'Hip Thrust', 'Nordic Hamstring Curl', 'Calf Raise', 'Copenhagen Plank', 'Glute Bridge', 'Single-Leg Romanian Deadlift'],
    coachingContext: `The user is a cyclist. Training is structured around power zones and FTP.

POWER ZONES (based on % FTP):
- Zone 1 (Active Recovery): <55% FTP
- Zone 2 (Endurance): 56–75% FTP — aerobic base, fat oxidation
- Zone 3 (Tempo): 76–90% FTP — sustainable hard effort
- Zone 4 (Sweet Spot): 88–93% FTP — high training value, builds FTP efficiently
- Zone 5 (VO2 Max): 106–120% FTP — short intervals (3–8 min)
- Zone 6 (Anaerobic): >120% FTP — sprints, 30 sec–2 min

TRAINING APPROACHES:
- Sweet Spot Training (SST): most efficient for FTP gains; 2–3x 20-min blocks at 88–93% FTP
- Polarized training: 80% Z1–2, 20% Z5+ — good for high-volume riders
- FTP test: 20-min all-out effort × 0.95, or ramp test (more beginner-friendly)
- Test FTP every 4–6 weeks to track progress and update zones

STRENGTH TRAINING FOR CYCLISTS:
- 2x/week in off-season; 1x/week in-season maintenance
- Heavy squats (3–5 rep range) build force production at high cadences
- Single-leg work corrects imbalances common in cycling
- Hip flexor and hip flexor mobility work to counteract cycling position
- Core anti-rotation (Pallof press) for stable platform when climbing

BIKE FIT BASICS:
- Saddle height: slight bend in knee at bottom of pedal stroke (25–30° knee angle)
- Too-low saddle = knee pain; too-high saddle = hip rocking, IT band issues
- Cleat position: ball of foot over pedal axle

COMMON MISTAKES: Riding all training at moderate intensity (zone 3 trap); neglecting strength work; insufficient carb intake during long rides; poor bike fit causing knee/back pain.`,
  },

  swimming: {
    label: 'Swimming',
    trainingFocus: 'stroke efficiency, upper body pulling endurance, and aerobic capacity',
    keyQualities: ['stroke efficiency', 'upper body pulling endurance', 'core stability', 'aerobic capacity', 'shoulder health'],
    nutritionFocus: 'moderate-high carbs, high protein (0.8–1g per lb) for recovery from high training volume; swimmers often underestimate caloric needs; hydration is critical despite not feeling thirsty',
    mealTiming: 'light meal 1–2 hours before pool session (heavy food causes GI issues); protein + carbs within 30 min post-swim; drink water before, during, and after — cold water suppresses sweat-triggered thirst cues',
    keyExercises: ['Pull-Up', 'Lat Pulldown', 'Single-Arm Dumbbell Row', 'Cable Row', 'Face Pull', 'Band Pull-Apart', 'Rotator Cuff External Rotation', 'Dead Bug', 'Pallof Press', 'Hip Flexor Stretch'],
    coachingContext: `The user is a swimmer. Training combines pool technique work with dryland strength.

STROKE MECHANICS (FREESTYLE):
- High elbow catch: early vertical forearm (EVF) maximises propulsion — most important technical element
- Body rotation: drive rotation from hips, not shoulders; 45–60° rotation each stroke
- Head position: eyes down, head neutral; lifting head kills body position and causes drag
- Kick: 6-beat kick for sprint/middle distance; 2-beat for distance; kick from hip, not knee

DRYLAND STRENGTH PRIORITIES:
- Lats and rhomboids are the primary pulling muscles — prioritise vertical and horizontal pull
- Rotator cuff health is critical: external rotation exercises (band ER, face pull) should be in every session
- Scapular stability: swimmers are prone to scapular winging from excessive internal rotation
- Core: anti-rotation and anti-extension patterns (dead bug, Pallof press) for stable stroke platform
- Hip flexors often overdeveloped from kicking — balance with hip extensor work

SHOULDER HEALTH:
- Swimmer's shoulder (impingement) is extremely common — always warm up rotator cuff
- Ratio rule: for every push exercise, do 2 pull exercises
- Reduce yardage if anterior shoulder pain develops — do not train through impingement
- Posterior capsule stretching (sleeper stretch) for internal rotation deficit

STROKE RATES & TRAINING ZONES:
- Aerobic base: long, slow distance (LSD) at 65–75% max HR
- Threshold sets: CSS (Critical Swim Speed) — find via 400m and 200m time trial
- Sprint sets: 25–50m maximal efforts with full rest

COMMON MISTAKES: Overtraining pulling without rotator cuff work; poor body rotation reducing propulsive efficiency; neglecting leg training; insufficient caloric intake for high swim volume.`,
  },

  basketball: {
    label: 'Basketball',
    trainingFocus: 'explosive vertical jump, lateral quickness, first-step speed, and aerobic conditioning for 40-minute game demands',
    keyQualities: ['vertical jump', 'lateral quickness', 'first-step explosiveness', 'aerobic endurance', 'deceleration mechanics'],
    nutritionFocus: 'moderate-high carbs for repeated sprint demands, high protein (0.8–1g per lb) for recovery, sodium and electrolytes post-game for sweat replacement',
    mealTiming: 'carb-focused meal 2–3 hours pre-game; banana or sports drink at halftime; high-protein recovery meal within 45 min post-game; avoid heavy foods 2 hours before tip-off',
    keyExercises: ['Box Jump', 'Depth Jump', 'Broad Jump', 'Romanian Deadlift', 'Bulgarian Split Squat', 'Lateral Band Walk', 'Barbell Back Squat', 'Single-Leg Calf Raise', 'Lateral Shuffle', 'Deceleration Lunge', 'Nordic Hamstring Curl'],
    coachingContext: `The user plays basketball. Training targets explosive athleticism for on-court performance.

VERTICAL JUMP DEVELOPMENT:
- Strength foundation first: need 1.5× bodyweight squat before heavy plyometric work
- Plyometric progression: bilateral jumps → unilateral → depth jumps → reactive jumps
- Depth jumps: step off box (20–30"), minimize ground contact time — trains reactive strength
- Jump training 2–3x/week; max 4 sets per session; full rest between sets (jump quality > quantity)
- Track vertical jump with consistent testing to measure progress

LATERAL QUICKNESS & AGILITY:
- Lateral band walks, hip abduction work for glute med — critical for change-of-direction
- Deceleration mechanics are equally important as acceleration — train hard stops and cuts
- 5-10-5 (pro agility) and T-drill for change-of-direction speed
- Reactive agility: use partner calls or visual cues, not pre-programmed drills

BASKETBALL CONDITIONING:
- Games demand repeated sprints with incomplete recovery (anaerobic alactic + aerobic)
- 16-minute miler test for aerobic baseline; shuttle runs for sport-specific conditioning
- Conditioning should mirror game: 4–8 sec sprints, 15–30 sec rest, repeated for 2–4 min blocks

INJURY PREVENTION:
- Ankle sprains: single-leg balance board work, lateral band exercises, landing mechanics
- ACL prevention: Nordic hamstring curls, landing mechanics training (soft landings, knees over toes), hip abductor strength
- Patellar tendinopathy: eccentric quad work (Spanish squat, decline board squat), reduce jump volume acutely

COMMON MISTAKES: Training vertical jump with plyometrics before building strength base; neglecting deceleration and landing mechanics; insufficient conditioning for game demands; not addressing ankle stability.`,
  },

  soccer: {
    label: 'Soccer',
    trainingFocus: 'aerobic base, sprint speed, hamstring health, and lower body power for 90-minute match demands',
    keyQualities: ['aerobic endurance', 'sprint speed (5–30m)', 'change of direction', 'lower body power', 'injury resilience'],
    nutritionFocus: 'high carbs as primary fuel (5–7g per kg/day, up to 8–10g on match days), adequate protein (0.6–0.8g per lb) for recovery, electrolytes for 90-minute sweat demands',
    mealTiming: 'carb-heavy pasta meal 3 hours pre-match; small carb snack 60 min out; sports drink during; carbs + protein recovery meal within 45 min post-match; carb load the day before big matches',
    keyExercises: ['Nordic Hamstring Curl', 'Box Jump', 'Bulgarian Split Squat', 'Hip Thrust', 'Lateral Squat', 'Copenhagen Plank', 'Single-Leg Romanian Deadlift', 'Sprint Acceleration Drills', 'Calf Raise', 'Core Rotation'],
    coachingContext: `The user plays soccer. Training balances aerobic fitness, explosiveness, and injury prevention.

HAMSTRING HEALTH (CRITICAL):
- Hamstring strains are the most common injury in soccer
- Nordic hamstring curls are the single most evidence-based injury prevention exercise — do them every week
- Progress: assisted eccentric → full eccentric → full Nordic → weighted
- Bilateral hamstring weakness is a major red flag — test single-leg hamstring curl strength

SPRINT MECHANICS & SPEED:
- Soccer sprints are mostly 10–30m — train acceleration, not just top speed
- Sprint sessions: 10x20m with 90 sec rest; 8x30m with 2 min rest
- Change of direction: 5-10-5 drills, T-drills, reactive agility with coach cues
- Power development: hip thrusts and Bulgarian split squats directly transfer to acceleration

AEROBIC CONDITIONING:
- Match demands: ~10–13km total distance; ~1–1.5km high-intensity sprints
- Small-sided games (SSGs) are the most efficient conditioning tool — simulate match demands
- Yo-Yo Intermittent Recovery Test (YYIRT) is the gold standard fitness test for soccer
- High-intensity interval training (HIIT): 4×4 intervals at 90–95% HR max

MATCH WEEK PERIODIZATION:
- Day after match: active recovery only
- MD-3 (3 days before match): higher intensity training, low volume
- MD-2: technical and tactical, moderate intensity
- MD-1: activation only, no fatigue
- Reduce heavy lifting during in-season — 1x/week maintenance is enough

COMMON MISTAKES: Neglecting Nordic curls despite strong evidence; running easy mileage when sport-specific conditioning is more valuable; heavy strength training too close to match day; insufficient carb intake for match day.`,
  },

  football: {
    label: 'Football',
    trainingFocus: 'explosive power, maximal strength, sprint speed, and position-specific athleticism',
    keyQualities: ['explosive power', 'maximal strength', 'sprint speed', 'collision resilience', 'anaerobic conditioning'],
    nutritionFocus: 'very high calories for linemen (4000–6000+ kcal); high protein (1–1.2g per lb) for all positions; carb loading on game day; creatine monohydrate is evidence-based and recommended',
    mealTiming: 'large balanced meal 3–4 hours pre-game; fast carb snack 60 min out; high-protein recovery meal post-game; hydrate aggressively in full pads — heat illness risk is significant',
    keyExercises: ['Power Clean', 'Hang Clean', 'Barbell Back Squat', 'Conventional Deadlift', 'Barbell Bench Press', 'Broad Jump', 'Prowler Push', 'Trap Bar Deadlift', 'Pull-Up', 'Glute Ham Raise'],
    coachingContext: `The user plays football. Training emphasises explosive strength and power for collision sport demands.

POSITION-SPECIFIC DEMANDS:
- Linemen (OL/DL): maximal strength, short burst power, mass for leverage — heavy compound lifts, high calorie intake
- Skill positions (RB, WR, DB): speed, agility, change of direction, relative strength — plyometrics, sprint work
- Linebackers/TE: combination of strength and speed — balanced program
- QB: rotational power, shoulder health, agility in pocket

EXPLOSIVE POWER DEVELOPMENT:
- Olympic lifts (power clean, hang clean) are the most transferable exercises for football explosiveness
- Progression: Romanian DL → hang high pull → hang clean → power clean
- Plyometrics: broad jump, vertical jump, hurdle hops — max 3–4 sets per session, full rest
- Contrast training: heavy squat set immediately followed by box jumps — post-activation potentiation (PAP)

STRENGTH STANDARDS (rough targets for serious players):
- Squat: 1.5–2.0× bodyweight
- Bench: 1.0–1.5× bodyweight
- Deadlift: 2.0–2.5× bodyweight
- Power Clean: 0.8–1.0× bodyweight

IN-SEASON vs OFF-SEASON:
- Off-season: high volume, build strength base, increase muscle mass
- Spring/summer: speed and power emphasis, reduce mass training
- In-season: maintenance lifting 1–2x/week — do not try to build strength in-season, just maintain
- Avoid heavy lower body work 48 hours before a game

CREATINE: 3–5g/day creatine monohydrate has the strongest evidence base for power sport performance.

COMMON MISTAKES: Bench pressing as primary measure of strength (neglects lower body and pulling); neglecting Olympic lift technique; poor hydration management in pads; trying to build max strength in-season.`,
  },

  baseball: {
    label: 'Baseball',
    trainingFocus: 'rotational power for hitting, arm health for throwing, and hip-shoulder separation mechanics',
    keyQualities: ['rotational power', 'arm health', 'hip-shoulder separation', 'wrist speed', 'reaction time'],
    nutritionFocus: 'balanced macros with high protein (0.8–1g per lb) for long-season recovery; careful caloric management for speed and agility; anti-inflammatory foods during high throwing volume periods',
    mealTiming: 'balanced meal 2–3 hours pre-game; light snack between innings if needed; protein + carbs immediately post-game; consistent eating during day games (avoid GI issues)',
    keyExercises: ['Med Ball Rotational Throw', 'Cable Woodchop', 'Hip Thrust', 'Single-Leg Romanian Deadlift', 'Band Pull-Apart', 'Face Pull', 'External Rotation (90°)', 'Pallof Press', 'Anti-Rotation Press', 'Rotational Medicine Ball Slam'],
    coachingContext: `The user plays baseball. Training focuses on rotational power and arm health.

ROTATIONAL POWER FOR HITTING:
- Hip-shoulder separation is the primary source of bat speed — the hips must lead the shoulders
- Med ball work: rotational throws, scoop tosses, overhead slams — high velocity, low rep (3–5 per set)
- Hip thrust and single-leg RDL develop the hip extension and rotation needed for swing power
- Anti-rotation exercises (Pallof press) build the ability to resist unwanted movement, improving swing stability
- Ground force: power comes from the ground up — single-leg exercises improve force transfer

ARM HEALTH & THROWING:
- Rotator cuff pre-hab: band ER at 0° and 90°, face pulls, prone Y/T/W — do before every throwing session
- Scapular stability: band pull-aparts, prone rows — scapular dyskinesis is a major injury risk factor
- Arm care programs (J-Band, Jaeger bands) should be part of pre-game routine
- Elbow: UCL stress from valgus load — protect with mechanics, monitor pitch/throw counts
- Wrist extensors and flexors: strengthen to reduce elbow stress

PERIODISATION (LONG SEASON):
- Off-season (Oct–Jan): strength base, address movement imbalances, high weight room volume
- Spring training (Feb–Mar): shift to power, reduce volume, increase sport-specific work
- In-season (Apr–Sep): maintenance lifting 1–2x/week; arm care daily; recovery is the priority
- Recovery: cold tubs, sleep, nutrition are critical during 162-game season

COMMON MISTAKES: Neglecting arm care until injury occurs; over-rotating with shoulders before hips in swing; heavy upper body pressing that creates internal rotation dominance; insufficient hip mobility work.`,
  },

  tennis: {
    label: 'Tennis',
    trainingFocus: 'rotational power for groundstrokes, lateral speed, shoulder longevity, and on-court endurance',
    keyQualities: ['rotational power', 'lateral movement speed', 'shoulder endurance', 'change of direction', 'mental resilience'],
    nutritionFocus: 'moderate carbs on training days, higher on match days; high protein (0.7–0.9g per lb); electrolytes critical during long matches; caffeine shown to improve reaction time in tennis',
    mealTiming: 'carb-rich meal 2 hours pre-match; banana, gel, or sports drink during changeovers; protein + carbs within 30 min post-match; avoid big meals during day of late match (digestive discomfort)',
    keyExercises: ['Med Ball Rotational Slam', 'Med Ball Side Throw', 'Lateral Bound', 'Romanian Deadlift', 'Band ER at 90°', 'Reverse Fly', 'Bulgarian Split Squat', 'Pallof Press', 'Lateral Lunge', 'Hip 90/90 Mobility'],
    coachingContext: `The user plays tennis. Training targets rotational power, lateral speed, and shoulder health.

ROTATIONAL POWER (GROUNDSTROKES & SERVE):
- Serve: power comes from leg drive → hip rotation → trunk rotation → shoulder → arm
- Groundstrokes: hip-shoulder separation drives pace; core rotational strength is key
- Med ball work: rotational chest pass, side throw, overhead slam — same movement pattern as strokes
- Train both open and closed kinetic chain hip rotation to handle different court positions

LATERAL MOVEMENT:
- Split step timing: always split step as opponent contacts the ball to prep reactive movement
- Lateral bound progressions: bilateral → unilateral → reactive with direction change
- Deceleration: need to absorb force when changing direction — eccentric quad and hip work
- Crossover step mechanics for wide balls — hip abductor strength critical

SHOULDER HEALTH (CRITICAL FOR TENNIS):
- Tennis shoulder: combination of internal rotation overdevelopment + posterior capsule tightness
- Fix: posterior capsule (sleeper stretch), external rotation strengthening (band ER, face pull)
- Ratio: 2:1 pulling:pushing in all training
- Wrist and elbow: tennis elbow (lateral epicondylitis) from backhand — wrist extensor eccentric work
- Serve shoulder: rotator cuff must be trained preventively — band work before every on-court session

MOVEMENT PATTERNS:
- Court coverage: 85% of points end within 4 shots — explosive first step matters more than top-end speed
- Recovery position: always recover to T after each shot — conditioning must support this
- Footwork patterns: ghost drills, cone drills specific to tennis movement patterns

COMMON MISTAKES: Ignoring shoulder health until pain develops; training speed only without strength base; insufficient core anti-rotation work; neglecting posterior chain leading to anterior knee pain.`,
  },

  wrestling: {
    label: 'Wrestling / MMA',
    trainingFocus: 'explosive takedown power, grappling endurance, anaerobic conditioning, and weight class management',
    keyQualities: ['grip strength', 'explosive power', 'anaerobic endurance', 'body composition control', 'neck strength'],
    nutritionFocus: 'high protein (1–1.2g per lb) for muscle preservation during weight cuts; strategic carb cycling; careful weight management for competition class; rehydration protocol post-weigh-in',
    mealTiming: 'protein + moderate carbs 2 hours pre-training; avoid heavy food 2 hours before drilling/sparring (nausea risk); high protein recovery meal immediately post-session; pre-competition weight cut requires sports dietitian guidance',
    keyExercises: ['Deadlift', 'Power Clean', 'Farmer Carry', 'Sandbag Carry', 'Neck Harness', 'Sprawl Drill', 'Bear Hug Carry', 'Kettlebell Swing', 'Pull-Up', 'Grip Roller', 'Turkish Get-Up'],
    coachingContext: `The user is a wrestler or MMA fighter. Training combines maximal strength, explosive power, and combat-specific conditioning.

STRENGTH & POWER PRIORITIES:
- Grip strength is foundational to grappling — farmer carries, gi pull-ups, thick bar work
- Hip extension power drives takedowns, throws, and escapes — deadlift, hip thrust, power clean
- Neck strength is critical for injury prevention (bridging, neck harness, manual resistance)
- Explosive pulling strength (power clean, hang clean) for snap-downs and underhook battles
- Single-leg and bilateral lower body work for shot completion and sprawl defense

ANAEROBIC CONDITIONING:
- Wrestling/MMA rounds are primarily anaerobic alactic + lactic systems
- Energy system training: 20–30 sec all-out effort, 2–3 min rest (alactic); 60–90 sec hard, 2–3 min rest (lactic)
- Sport-specific conditioning: shot drills, pummeling, live drilling — more transferable than generic cardio
- Wrestling-specific: 6-minute round simulation drills with 30-sec scrambles at 2-minute marks

WEIGHT CLASS MANAGEMENT:
- Compete at a weight class you can make without large cuts (>5% bodyweight cut = performance impairment)
- Aggressive water cuts impair strength, reaction time, and injury resistance — minimise them
- Slow, gradual weight loss in off-season is safer and maintains performance
- Rehydration post-weigh-in: electrolytes + carbs + water in structured protocol

INJURY PREVENTION:
- Fingers: tape joints before every session
- Knees: knee sleeves, proper stance and movement mechanics for sprawls
- Neck: bridging progressions before any neck loading
- Lower back: Romanian DL, anti-flexion core work

COMMON MISTAKES: Cutting too much weight; neglecting neck strengthening; not developing grip strength; conditioning only through running rather than sport-specific work.`,
  },

  gymnastics: {
    label: 'Gymnastics',
    trainingFocus: 'relative bodyweight strength, active flexibility, skill-specific conditioning, and tendon health',
    keyQualities: ['relative strength', 'active flexibility', 'body control', 'spatial awareness', 'tendon resilience'],
    nutritionFocus: 'adequate calories for performance (undereating is extremely common and harmful in gymnastics); high protein (0.8–1g per lb) for tendon and muscle repair; calcium and vitamin D for bone health',
    mealTiming: 'light balanced meal 1–2 hours pre-training (heavy food impairs movement); protein + carbs post-session; spread protein across 4–5 meals; calcium-rich foods daily for bone density',
    keyExercises: ['Ring Row', 'L-Sit Progression', 'Hollow Body Hold', 'Arch Body Hold', 'Wall Handstand', 'Tuck Planche', 'Front Lever Progression', 'Skin the Cat', 'Pike Push-Up', 'Wrist Circles', 'German Hang'],
    coachingContext: `The user does gymnastics. Training prioritises bodyweight strength progressions and active flexibility.

FUNDAMENTAL MOVEMENT PATTERNS:
- Hollow body: posterior pelvic tilt, rib cage down, lower back to floor — the foundation of all gymnastics positions
- Arch body: opposite of hollow; opposite tension pattern — must train both
- These two positions underpin every gymnastics skill — master them before advanced progressions

STRENGTH PROGRESSIONS:
- Pull-up progression: scapular pull-up → negative → assisted → full → L-sit pull-up → muscle-up
- Push-up progression: push-up → pike push-up → elevated HSPU → wall HSPU → freestanding HSPU
- L-sit: tuck L-sit → one-leg extended → full L-sit → L-sit on rings/parallettes
- Planche: tuck planche → advanced tuck → straddle → full (years of progression)
- Front lever: tuck → advanced tuck → straddle → full front lever

HANDSTAND DEVELOPMENT:
- Phase 1: wall holds for shoulder strength and alignment (ears between arms, hollow position)
- Phase 2: kick-ups against wall, learn to bail safely
- Phase 3: balance point — find equilibrium through fingertip pressure adjustment
- Phase 4: freestanding hold, timed practice daily

TENDON HEALTH (CRITICAL):
- Wrists and elbows take enormous load — daily wrist warm-up (circles, compression, extension)
- Progress slowly — tendons adapt 3–4× slower than muscles
- Wrist pain is common early; reduce load, increase mobility, build gradually
- Shoulder health: external rotation and scapular stability work (dislocates with band, band pull-aparts)

FLEXIBILITY vs MOBILITY:
- Passive flexibility (end-range stretch) must be matched by active strength in same range
- Hip flexor and hamstring active flexibility is critical for handstands and L-skills
- Shoulder dislocates (PVC or band) for overhead range development

COMMON MISTAKES: Attempting advanced skills without strength prerequisites; ignoring hollow/arch body quality; training through wrist pain; insufficient caloric intake causing underfuelled training.`,
  },

  volleyball: {
    label: 'Volleyball',
    trainingFocus: 'vertical jump, shoulder health, lateral movement, and repeated explosive efforts',
    keyQualities: ['vertical jump', 'shoulder endurance', 'lateral speed', 'upper body power', 'reaction time'],
    nutritionFocus: 'moderate-high carbs for repeated explosive demands, high protein (0.7–0.9g per lb), electrolytes and fluids during long training sessions and matches',
    mealTiming: 'carb-focused meal 2–3 hours pre-match; light snack between sets if match is long; protein + carbs post-match within 30 min; stay hydrated throughout — volleyball courts can be warm',
    keyExercises: ['Box Jump', 'Jump Squat', 'Depth Jump', 'Band Pull-Apart', 'Band ER at 90°', 'Face Pull', 'Bulgarian Split Squat', 'Lateral Band Walk', 'Single-Arm Cable Row', 'Copenhagen Plank', 'Single-Leg Calf Raise'],
    coachingContext: `The user plays volleyball. Training prioritises vertical jump, shoulder durability, and lateral movement.

VERTICAL JUMP FOR VOLLEYBALL:
- Attack jump (approach): 3–4 step approach with two-foot takeoff — train approach mechanics separately from straight vertical
- Plyometric progression: squat jump → box jump → depth jump → approach jump with arm swing
- Arm swing technique: aggressive arm swing can add 2–4 inches to vertical — train timing and coordination
- Train touch height on net, not just standing vertical — sport-specific measurement

SHOULDER HEALTH (HIGH PRIORITY):
- Volleyball players hit hundreds of balls per session — shoulder overuse is extremely common
- Rotator cuff work before every session (band ER, face pull, prone Y/T/W)
- Scapular stability: serratus anterior activation (push-up plus, serratus wall slides)
- Ratio rule: 2 pulling movements for every pushing movement in gym
- Signs of impingement: pain on overhead reach or behind-back position — reduce hitting volume immediately

LATERAL MOVEMENT:
- Defensive movement requires explosive lateral first step and quick directional change
- Lateral band walks for glute med activation
- Defensive posture holds (athletic stance) build positional endurance
- Dive and roll mechanics: practice landing technique to reduce impact injury

BLOCKING MECHANICS:
- Penetrate hands over net — core anti-extension strength for forward lean stability
- Quick first step to block position — lateral reaction drills

COMMON MISTAKES: Only training vertical without approach mechanics; neglecting rotator cuff pre-hab leading to impingement; insufficient hip abductor training for lateral movement; overtraining hitting volume without adequate recovery.`,
  },

  hockey: {
    label: 'Hockey',
    trainingFocus: 'skating-specific hip power, anaerobic conditioning for shifts, and upper body strength for physical play',
    keyQualities: ['skating stride power', 'hip abductor/adductor strength', 'anaerobic endurance', 'upper body strength', 'edge control'],
    nutritionFocus: 'high carbs (4–6g per kg) for shift-based explosive demands, high protein (0.7–0.9g per lb) for recovery, aggressive hydration and electrolytes (heavy sweat in gear)',
    mealTiming: 'carb-heavy meal 2–3 hours pre-game; sports drink on bench between shifts; high-protein meal with carbs immediately post-game; rehydrate aggressively — significant sweat loss in full equipment',
    keyExercises: ['Lateral Lunge', 'Skater Squat', 'Sumo Deadlift', 'Hip Thrust', 'Copenhagen Plank', 'Lateral Band Walk', 'Barbell Back Squat', 'Single-Leg Squat', 'Core Anti-Rotation', 'Farmer Carry'],
    coachingContext: `The user plays hockey. Training builds skating-specific athleticism and conditioning for shift-based play.

SKATING-SPECIFIC STRENGTH:
- Skating stride primarily uses hip abductors, adductors, and glutes in a unique lateral movement pattern
- Lateral lunge and skater squat are the most skating-specific gym exercises
- Copenhagen plank: most evidence-based exercise for adductor injury prevention in hockey
- Sumo deadlift: wide stance hip extension mimics skating power generation
- Single-leg strength (skater squat, single-leg hip thrust) addresses common bilateral imbalances

HIP FLEXOR & GROIN HEALTH:
- Groin strains are the most common hockey injury
- Copenhagen plank is evidence-based for injury prevention — include in every lower body session
- Hip flexor strength and length: skating posture keeps hip flexors shortened; stretch and strengthen
- Adductor strengthening: side-lying adduction, Copenhagen plank, sumo squat

SHIFT CONDITIONING:
- Hockey shifts are 35–55 sec of near-maximal effort with 3–5 min rest (on bench)
- Conditioning target: repeated sprint ability, not aerobic base
- Off-ice conditioning: 30 sec all-out bike sprints with 3 min recovery × 8–10 sets
- Battle rope, sled push for anaerobic power without joint stress in off-season

OFF-ICE vs ON-ICE:
- Off-season: high gym volume — build strength base and address skating-specific imbalances
- Pre-season: shift to power and conditioning, reduce max strength work
- In-season: 1–2x/week maintenance lifting — focus on injury prevention exercises (Copenhagen plank, cuff work)

UPPER BODY FOR PHYSICAL PLAY:
- Upper body pressing strength matters for board battles and puck protection
- Pull strength (rows, pull-ups) for puck battles and face-offs
- Core stability for absorbing body checks and delivering physical play

COMMON MISTAKES: Only training sagittal plane movements (squats, deadlifts) without lateral work; neglecting Copenhagen plank for groin health; over-training in-season without managing cumulative fatigue.`,
  },

  golf: {
    label: 'Golf',
    trainingFocus: 'rotational power for clubhead speed, hip and thoracic mobility, and stability under 4–5 hour round fatigue',
    keyQualities: ['rotational power', 'hip mobility', 'thoracic rotation', 'balance', 'endurance for 18 holes'],
    nutritionFocus: 'steady energy throughout a 4–5 hour round, moderate carbs avoiding blood sugar spikes, hydration in heat; avoid alcohol during rounds — significantly impairs motor skill and decision-making',
    mealTiming: 'balanced meal 2 hours before tee time; light snack (banana, nuts) every 6 holes; water or sports drink consistently throughout round; avoid large meals mid-round (sluggishness)',
    keyExercises: ['Cable Woodchop', 'Med Ball Rotational Throw', 'Hip 90/90 Stretch', 'Glute Bridge', 'Single-Leg RDL', 'Pallof Press', 'Thoracic Rotation on Foam Roller', 'Half-Kneeling Rotational Press', 'Hip Flexor Stretch', 'Cat-Cow'],
    coachingContext: `The user plays golf. Training improves clubhead speed through rotational power and mobility.

ROTATIONAL POWER FOR CLUBHEAD SPEED:
- Swing power comes from ground up: foot pressure → hip rotation → trunk → shoulders → arms → club
- Hip-shoulder separation (X-factor): ability to rotate hips before shoulders is the key driver of distance
- Med ball work at high velocity (not slow): side throw, rotational slam, scoop toss — same pattern as swing
- Strength-speed work: heavy cable woodchop → explosive med ball throw in same session (PAP)

THORACIC MOBILITY (CRITICAL):
- Limited thoracic rotation is the most common limiter of golf swing turn
- Thoracic rotation drills: seated rotation, open books, foam roller extension
- Hip internal rotation: required for backswing (trail hip) and follow-through (lead hip) — 90/90 hip stretch
- These mobility limitations are the root cause of most swing faults — fix mobility before fixing mechanics

STABILITY & BALANCE:
- Single-leg balance for lead leg: must stabilise entire lead side impact position
- Core anti-extension (plank) and anti-rotation (Pallof press) for stable spine through impact
- Glute activation: glutes control hip rotation timing — hip thrust and glute bridge are foundational

LOWER BACK HEALTH (HIGH PRIORITY):
- Lower back pain affects ~50% of golfers — rotation under load stresses lumbar spine
- Strengthen hip rotators and glutes to offload lumbar spine during swing
- Avoid extreme lumbar extension in backswing — thoracic rotation should replace it
- McKenzie extensions for acute low back issues

ROUND ENDURANCE:
- Walking 18 holes = 8–10km; combined with heat = significant fatigue
- Aerobic base (walking, cycling) helps maintain swing quality on back 9
- Core endurance (not just max strength) — posture maintenance over 5 hours

COMMON MISTAKES: Only stretching, not building strength through range of motion; neglecting hip rotation for thoracic rotation; dehydrating during rounds; swinging for power before addressing mobility limitations.`,
  },

  climbing: {
    label: 'Rock Climbing',
    trainingFocus: 'finger tendon strength, pulling power, body tension, and movement efficiency on the wall',
    keyQualities: ['finger strength', 'pulling endurance', 'body tension', 'footwork precision', 'route reading'],
    nutritionFocus: 'optimal body composition for strength-to-weight ratio (climbing is very weight sensitive); high protein (0.8–1g per lb) for tendon repair; collagen + vitamin C supplementation has evidence for tendon health',
    mealTiming: 'light meal 1–2 hours pre-session (heavy food impairs movement on wall); protein + carbs post-session; collagen 30 min before session may increase tendon collagen synthesis (research-backed)',
    keyExercises: ['Hangboard Dead Hang', 'Half Crimp', 'Pull-Up', 'Weighted Pull-Up', 'Front Lever Progression', 'L-Sit', 'Wrist Roller', 'Reverse Wrist Curl', 'Push-Up (antagonist)', 'Shoulder External Rotation'],
    coachingContext: `The user is a rock climber. Training must carefully balance finger tendon load with strength development.

FINGER TRAINING (HANGBOARD):
- Beginners (<2 years): focus on climbing volume only — tendons are not ready for hangboard
- Intermediate+: minimum edge hangs (7–10 sec dead hangs on 20mm edge), max hangs (5–10 sec on smallest edge)
- Repeaters: 7 sec on / 3 sec off × 6 reps, 3 min rest — builds tendon endurance
- Max hangs: 5 sec maximal effort on smallest holdable edge, 3+ min rest — builds recruitment
- Grip positions: open hand (safest), half crimp, full crimp (highest injury risk — avoid overuse)
- NEVER train on painful fingers — tendon injuries in climbing are catastrophic and slow to heal

STRENGTH TRAINING:
- Pull-ups: the most transferable gym exercise; weighted pull-ups build lock-off strength
- Body tension: hollow body holds, front lever progressions — ability to keep feet on holds requires core
- Hip mobility: high step-ups, hip openers — ability to flag and rock-over
- Antagonist work (critical): push-ups, rows, external rotation — prevents climber's shoulder imbalance

INJURY PREVENTION:
- A2 pulley strain: most common climbing injury; sharp pain on crimping; rest, then eccentric rehab
- Finger tendon health: warm-up slowly (easy climbing or light hangs before max effort)
- Elbow (medial epicondylitis, flexor mass): reverse wrist curls, band finger extensions
- Shoulder: internal rotation dominance from climbing — face pulls, band ER every session

MOVEMENT SKILLS (MORE IMPORTANT THAN STRENGTH):
- Footwork precision: trust your feet, look at footholds, quiet feet
- Body positioning: straight arms when possible — bent arms fatigue 10× faster
- Hip turn: use hip into wall to reach holds that seem out of range
- Resting on the wall: find rest positions on every route, shake out forearms

PERIODIZATION:
- Project phase (high intensity): limit maximal bouldering, reduce volume, full rest days
- Volume phase: 3–4 sessions/week on moderate grades, build aerobic pump threshold
- Deload: complete rest from climbing every 4–6 weeks — tendons need full recovery cycles

COMMON MISTAKES: Fingerboarding too early in climbing career; neglecting antagonist work leading to shoulder injury; training through finger pain; pulling with bent arms instead of positioning hips.`,
  },

  yoga: {
    label: 'Yoga',
    trainingFocus: 'active flexibility, joint mobility, strength through full range of motion, and breathwork',
    keyQualities: ['active flexibility', 'balance', 'strength through range of motion', 'breath control', 'body awareness'],
    nutritionFocus: 'light easily digestible foods, adequate protein (0.6–0.8g per lb) for connective tissue support, anti-inflammatory foods (omega-3, turmeric, ginger), hydration for hot yoga',
    mealTiming: 'avoid eating 1–2 hours before practice (twists and inversions are uncomfortable on full stomach); light protein + healthy fats post-practice for recovery; hot yoga: rehydrate with electrolytes',
    keyExercises: ['Hip Flexor Stretch (deep lunge)', 'Pigeon Pose', 'Shoulder Mobility Flow', 'Thoracic Extension over Roller', 'Core Hollow Body', 'Single-Leg Glute Bridge', 'Wrist Conditioning', 'Scapular Push-Up'],
    coachingContext: `The user practices yoga. Training combines active flexibility with complementary strength work.

ACTIVE vs PASSIVE FLEXIBILITY:
- Passive stretching (relaxed holds) increases range but doesn't build usable strength in that range
- Active flexibility: contract the opposing muscle to access the range — this is what yoga builds
- End-range strength: the ability to actively control and move through full ROM prevents injury
- PNF (proprioceptive neuromuscular facilitation): contract-relax technique accelerates flexibility gains

KEY MOBILITY AREAS FOR YOGA:
- Hips: hip flexors, external rotators (pigeon), adductors, hip internal rotation
- Thoracic spine: extension and rotation for backbends and twists
- Shoulders: flexion (overhead), external rotation, internal rotation
- Hamstrings: primarily limits forward folds — differentiate tight muscles from neural tension
- Wrists: yoga places significant load on extended wrists — daily wrist conditioning is essential

STRENGTH THAT COMPLEMENTS YOGA:
- Posterior chain: glutes and hamstrings often undertrained in yoga — hip thrusts, RDLs
- Scapular stability: upward rotation and serratus strength for chaturanga and arm balances
- Core anti-flexion: yoga builds flexion; add plank and dead bug for spinal extension strength
- Single-leg balance: warrior III, tree pose — proprioceptive training under load improves stability

BREATHWORK PRINCIPLES:
- Diaphragmatic breathing: belly expands on inhale, not chest — reduces cortisol, improves recovery
- Box breathing (4-4-4-4): useful for pre-practice nervous system downregulation
- Ujjayi breath (ocean breath): slight glottal constriction creates internal pressure and focus

HOT YOGA SPECIFIC:
- Electrolyte replacement is critical (significant sodium loss)
- Do not push to end range in first 30 min — hyperthermia increases tissue laxity and injury risk
- Dizziness/nausea is a sign of overheating — step out immediately

COMMON MISTAKES: Forcing end range with momentum rather than active muscle control; neglecting posterior chain and external rotation; ignoring wrist pain from weight-bearing poses; treating yoga as only stretching without complementary strength training.`,
  },

  rowing: {
    label: 'Rowing',
    trainingFocus: 'posterior chain power, aerobic endurance, and rowing stroke technique',
    keyQualities: ['aerobic endurance', 'posterior chain strength', 'power output at catch', 'rowing technique', 'mental endurance'],
    nutritionFocus: 'high carbs (5–7g per kg/day) for high-volume aerobic training, high protein (0.7–0.9g per lb) for recovery, electrolytes for long sweat sessions; rowers burn extremely high calories — underestimating intake is common',
    mealTiming: 'carb-rich meal 2–3 hours before rowing; carbs + electrolytes during sessions over 60 min; protein + carbs post-session within 30 min; rehydrate by 150% of sweat loss (weigh before/after to estimate)',
    keyExercises: ['Barbell Row', 'Deadlift', 'Hip Thrust', 'Leg Press', 'Single-Leg Press', 'Cable Row', 'Glute Ham Raise', 'Back Extension', 'Core Anti-Flexion (plank)', 'Core Anti-Rotation (Pallof press)'],
    coachingContext: `The user is a rower. Training builds posterior chain power and aerobic capacity for the erg and water.

ROWING STROKE MECHANICS:
- Catch: shins vertical, arms straight, leaning slightly forward — back angle is set here, don't change it
- Drive: legs push first (80% of power), then hips open, then arms pull last — sequential, not simultaneous
- Finish: body slightly behind vertical, handle at lower chest/upper abdomen, strong leg extension
- Recovery: opposite of drive: arms out first, then body forward, then legs compress
- Most common fault: "shooting the slide" — hips opening before legs fully press — causes significant power loss

ERG TRAINING ZONES:
- UT2 (Aerobic base): long slow pieces at rate 18–22, HR 70–75% max — most of yearly volume
- UT1 (Threshold): 20–40 min pieces, HR 75–80% max, rate 22–26
- AT (Anaerobic threshold): 4×8 min with 3 min rest, rate 26–28, hard but sustainable
- TR/AN (Sprint work): 500m–2000m intervals at race pace, full rest — power and pain tolerance

STRENGTH TRAINING FOR ROWERS:
- Deadlift: most direct transfer to drive power — develop strong posterior chain
- Heavy leg press + hip thrust: leg drive development
- Barbell row: mimics the pull portion of stroke
- Back extension/GHR: spinal erectors must be strong to maintain posture over long pieces
- Core work: anti-flexion (plank) and anti-rotation (Pallof press) for stable spine through stroke
- Avoid excessive spinal flexion work — rowing already puts high flexion load on lumbar spine

COMMON ROWING INJURIES:
- Lower back: most common; caused by rounding at catch and excessive spinal flexion
- Rib stress fractures: from high volume with inadequate bone loading history — gradual progression
- Knee: if pain develops on slide, check foot stretcher angle and compression under load
- Wrist: from feathering mechanics — ensure smooth rotation, not tight grip

PERIODIZATION:
- Base phase (fall): high volume, low intensity — build aerobic foundation
- Pre-season (spring): increase intensity, decrease volume — speed development
- Race season: maintain with low volume, high quality pieces
- Off-season: strength emphasis in gym, cross-training

COMMON MISTAKES: Over-training UT2 at too high an intensity (zone 3 trap); sequential drive fault (shooting the slide); neglecting back extension and posterior chain work; insufficient caloric intake for high training volume.`,
  },
};

export const getSportProfile = (sport: string): SportProfile =>
  SPORT_PROFILES[sport] ?? SPORT_PROFILES['none'];
