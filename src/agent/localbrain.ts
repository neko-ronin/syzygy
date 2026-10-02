/**
 * Deterministic heuristic conductor.
 *
 * This is what runs when no API key is configured — the simulation has to be
 * fully explorable with zero setup. It parses plain English into the *same*
 * tool calls the LLM would emit, so the executor, the UI chips and the tour
 * system never learn the difference.
 */

import { describeWorld, type ToolCall } from './tools';
import type { WorldState } from '../core/state';

/** Text to speak plus the calls to run, in order. */
export interface LocalPlan {
  text: string;
  calls: ToolCall[];
}

/** One clause rule: regex → a tool call and a director's line. */
interface Rule {
  re: RegExp;
  /** Turns a match into the calls to run, in order. */
  calls?: (m: RegExpExecArray, ctx: LocalBrainContext) => ToolCall[];
  /** The director's line. May be computed from the match. */
  say: string | ((m: RegExpExecArray) => string);
  /** Skip if any of these also match — first rule wins per clause. */
  unless?: RegExp;
}

const D = Math.PI / 180;

/** Split a sentence into clauses so "storm and go to the canyon" does both. */
function clauses(input: string): string[] {
  return input
    .split(/\s*(?:,|;|\band then\b|\bthen\b|\band also\b|\band\b|\bafter that\b|\.|\bbut\b)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

const RULES: Rule[] = [
  // ---- reset / meta -------------------------------------------------------
  { re: /\b(reset|start over|begin again|default weather|restore)\b/, say: 'Back to authored defaults.', calls: () => [{ name: 'reset_world', input: {} }] },
  { re: /\b(what(?:'s| is) (?:it )?(?:like )?now|state|status|describe)\b/, say: () => 'Current state —', calls: () => [{ name: 'describe_world', input: {} }] },

  // ---- weather: severe ----------------------------------------------------
  {
    re: /\b(monsoon)\b/,
    calls: () => [
      { name: 'set_weather', input: { sky: 'storm', precip: 'rain', storminess: 0.85, cloudCover: 0.95, windSpeed: 26, wetness: 0.9, godRays: 0.05 } },
      { name: 'trigger_event', input: { kind: 'monsoon', ttl: 120, radius: 400 } },
    ],
    say: 'Monsoon. The whole basin is under water.',
  },
  {
    re: /\b(storm|stormy|tempest|thunder|thunderstorm|squall|howl|howling)\b/,
    calls: () => [
      { name: 'set_weather', input: { sky: 'storm', precip: 'rain', storminess: 0.95, cloudCover: 0.96, windSpeed: 24, wetness: 0.9, godRays: 0.04, haze: 0.35 } },
      { name: 'trigger_event', input: { kind: 'lightning', ttl: 25, radius: 300, params: { strobes: 14 } } },
    ],
    say: 'Storm. Sky gone black, wind up, lightning on the far towers.',
  },
  {
    re: /\b(lightning|thunder|bolt|bolts|lightning strike)\b/,
    calls: () => [{ name: 'trigger_event', input: { kind: 'lightning', ttl: 18, radius: 300, params: { strobes: 10 } } }],
    say: 'Lightning.',
  },
  {
    re: /\b(downpour|deluge|torrential|heavy rain|hard rain|rain hard)\b/,
    calls: () => [
      { name: 'set_weather', input: { precip: 'rain', wetness: 0.95, cloudCover: 0.85, haze: 0.4, windSpeed: 14 } },
      { name: 'trigger_event', input: { kind: 'rain-burst', ttl: 40, radius: 320 } },
    ],
    say: 'Downpour.',
  },
  { re: /\b(rain|raining|rained|wet down|pouring)\b/, unless: /\b(storm|monsoon|downpour)\b/, calls: () => [{ name: 'set_weather', input: { precip: 'rain', wetness: 0.8, cloudCover: 0.7, haze: 0.32, windSpeed: 8 } }], say: 'Rain, easing in.' },
  { re: /\b(drizzle|mizzle|spit|sprinkle|light rain)\b/, calls: () => [{ name: 'set_weather', input: { precip: 'drizzle', wetness: 0.55, cloudCover: 0.6, haze: 0.35 } }], say: 'A fine drizzle.' },
  { re: /\b(snow|snowing|snowfall|blizzard)\b/, calls: () => [{ name: 'set_weather', input: { precip: 'snow', cloudCover: 0.8, haze: 0.5, motes: 0.7, godRays: 0.3 } }], say: 'Snow, drifting through the canyon.' },
  { re: /\b(clear|clear it up|clear up|cloud the (?:sky|clouds) away|sunshine|blue sky|make it nice|lovely|beautiful|perfect)\b/, calls: () => [{ name: 'set_weather', input: { sky: 'clear', cloudCover: 0.1, storminess: 0, precip: 'none', haze: 0.12, godRays: 0.85, wetness: 0.05, bloomStrength: 0.3 } }], say: 'Clear. Let the light in.' },
  { re: /\b(cloud|cloudy|clouds|overcast|grey|gray|dull)\b/, calls: () => [{ name: 'set_weather', input: { sky: 'overcast', cloudCover: 0.88, storminess: 0.05, godRays: 0.15, haze: 0.3 } }], say: 'Overcast.' },
  { re: /\b(fog|foggy|mist|misty|haze|hazy)\b/, calls: () => [{ name: 'set_weather', input: { sky: 'hazy', haze: 0.85, aerialHaze: 0.8, cloudCover: 0.4, wetness: 0.2 } }], say: 'Fog, thick as wool.' },
  { re: /\b(fog bank|bank of fog|low cloud|sea of clouds)\b/, calls: () => [{ name: 'trigger_event', input: { kind: 'fog-bank', ttl: 90, radius: 600 } }], say: 'A fog bank rolls in off the water.' },
  { re: /\b(dust|sand|smoke|ash|soot|choke)\b/, calls: () => [{ name: 'set_weather', input: { precip: 'ash', haze: 0.7, aerialHaze: 0.75, motes: 0.8, sky: 'hazy' } }], say: 'Ash in the air.' },
  { re: /\b(pollen)\b/, calls: () => [{ name: 'set_weather', input: { precip: 'pollen', motes: 0.9, haze: 0.28 } }], say: 'Pollen.' },
  { re: /\b(spores|spore|fungal|mushroom cloud)\b/, calls: () => [{ name: 'set_weather', input: { precip: 'spores', motes: 0.95 } }, { name: 'trigger_event', input: { kind: 'spore-bloom', ttl: 60, radius: 300 } }], say: 'Spore bloom.' },
  { re: /\b(wind|windy|blow|blowing|gale|breeze|breezy|gust|howl)\b/, say: (m) => `More wind — ${/\b(gale|howl|strong|hard)\b/i.test(m[0]) ? 'properly' : 'a little'} of it.`, calls: (m) => [{ name: 'set_weather', input: { windSpeed: /\b(gale|howl|strong|hard|storm)\b/i.test(m[0]) ? 20 : 11, haze: 0.3 } }] },
  { re: /\b(still the air|calm|drop the wind|dead calm)\b/, calls: () => [{ name: 'set_weather', input: { windSpeed: 0.6, storminess: 0 } }], say: 'Wind drops away.' },
  { re: /\b(god rays?|godray|crepuscular|sun ?beams?|shafts? of light|light shafts?|volumetric light)\b/, calls: () => [{ name: 'set_weather', input: { godRays: 0.95, cloudCover: 0.6, haze: 0.4 } }], say: 'God rays through the gaps.' },
  { re: /\b(rainbow|prism|iridescent|scatter)\b/, calls: () => [{ name: 'set_weather', input: { scatter: 0.9 } }], say: 'Rainbow scattering.' },
  { re: /\b(motes|particles|floating dust|drifting)\b/, calls: () => [{ name: 'set_weather', input: { motes: 0.85 } }], say: 'Motes in the air.' },
  { re: /\b(dry|evaporate|soak up|drain)\b/, calls: () => [{ name: 'set_weather', input: { wetness: 0.05, precip: 'none' } }], say: 'Drying out.' },
  { re: /\b(wet|puddles|reflections|reflect)\b/, calls: () => [{ name: 'set_weather', input: { wetness: 0.9 } }], say: 'Every surface mirrors.' },

  // ---- time ---------------------------------------------------------------
  { re: /\b(dawn|daybreak|first light|early morning|before sunrise)\b/, calls: () => [{ name: 'set_time', input: { phase: 'dawn' } }], say: 'Dawn.' },
  { re: /\b(morning|forenoon)\b/, calls: () => [{ name: 'set_time', input: { phase: 'morning' } }], say: 'Morning.' },
  { re: /\b(noon|midday|high sun|overhead)\b/, calls: () => [{ name: 'set_time', input: { phase: 'noon' } }], say: 'Noon. Hard light, short shadows.' },
  { re: /\b(afternoon|late afternoon)\b/, calls: () => [{ name: 'set_time', input: { phase: 'afternoon' } }], say: 'Afternoon.' },
  { re: /\b(sunset|sundown|dusk|golden hour|golden light|golden|magic hour|evening|twilight)\b/, calls: () => [{ name: 'set_time', input: { phase: 'dusk' } }], say: 'Golden hour. Everything goes amber.' },
  { re: /\b(night|midnight|dark|after dark|black|nighttime|lights on)\b/, calls: () => [{ name: 'set_time', input: { phase: 'night' } }], say: 'Night.' },
  { re: /\b(freeze time|stop time|hold time|freeze the (?:clock|time|sun))\b/, calls: () => [{ name: 'set_time', input: { freeze: true } }], say: 'Time held.' },
  { re: /\b(unfreeze|resume time|let time (?:run|flow|go)|start the day)\b/, calls: () => [{ name: 'set_time', input: { freeze: false, dayLengthSeconds: 900 } }], say: 'Time moves again.' },
  { re: /\b(shorter day|faster day|quick day)\b/, calls: () => [{ name: 'set_time', input: { dayLengthSeconds: 180, freeze: false } }], say: 'A short day.' },
  { re: /\b(long day|slow day)\b/, calls: () => [{ name: 'set_time', input: { dayLengthSeconds: 2400, freeze: false } }], say: 'A long day.' },
  { re: /\b(sun)\b/, unless: /\b(god rays?|sunbeams?|sunset|low sun|sunlight)\b/, calls: () => [{ name: 'set_sun', input: { elevation: 28, azimuth: 135, intensity: 4.4 } }], say: 'Sun repositioned.' },

  // ---- time scale ---------------------------------------------------------
  { re: /\b(much faster|way faster|blur the (?:sim|simulation)|light speed)\b/, calls: () => [{ name: 'set_time_scale', input: { scale: 8 } }], say: 'Time x8.' },
  { re: /\b(faster|quicker|hurry|accelerate|speed ?(?:it )?up)\b/, calls: () => [{ name: 'set_time_scale', input: { scale: 3 } }], say: 'Faster.' },
  { re: /\b(slower|slow it down|drag it out|half speed)\b/, calls: () => [{ name: 'set_time_scale', input: { scale: 0.35 } }], say: 'Slower.' },
  { re: /\b(pause|freeze|hold on)\b/, unless: /\bfreeze time\b/, calls: () => [{ name: 'set_time_scale', input: { scale: 0 } }], say: 'Held.' },

  // ---- camera tours -------------------------------------------------------
  { re: /\b(canyon|gorge|ravine|down below|below|trench)\b/, calls: () => [{ name: 'tour', input: { preset: 'canyon' } }], say: 'Down into the canyon.' },
  { re: /\b(skyline|towers|horizon|establishing|wide shot|sweep)\b/, calls: () => [{ name: 'tour', input: { preset: 'skyline' } }], say: 'Skyline.' },
  { re: /\b(canal|water|river|harbour|harbor|docks|reflections?)\b/, unless: /\b(reflections?)\s*$|\bwet\b/, calls: () => [{ name: 'tour', input: { preset: 'canal' } }], say: 'Down to the canal.' },
  { re: /\b(aerial|above|bird'?s ?eye|top ?down|overhead from up|drone|high above)\b/, calls: () => [{ name: 'tour', input: { preset: 'aerial' } }], say: 'Aerial.' },
  { re: /\b(ground|street|pedestrian|walking|walk|human scale|person)\b/, calls: () => [{ name: 'tour', input: { preset: 'ground' } }], say: 'Down to street level.' },
  { re: /\b(vertical drop|drop|plunge|fall|freefall|free fall|dive|topple)\b/, calls: () => [{ name: 'tour', input: { preset: 'vertical-drop' } }], say: 'Vertical drop.' },
  { re: /\b(orbit|circle|revolve|around|encircle|spin around)\b/, calls: () => [{ name: 'tour', input: { preset: 'orbit' } }], say: 'Orbiting.' },

  // ---- camera moves -------------------------------------------------------
  { re: /\b(stop|halt|hold still|freeze camera|steady|brake)\b/, say: 'Holding position.', calls: (_m, ctx) => [{ name: 'move_camera', input: { to: ctx.cam, seconds: 0.4, easing: 'ease-in-out' } }] },
  { re: /\b(fly up|ascend|climb|rise|higher|go up|uplink)\b/, calls: () => [{ name: 'move_camera', input: { direction: [0, 1, 0], speed: 90, seconds: 3 } }], say: 'Up.' },
  { re: /\b(fly down|descend|dive down|sink|lower|go down|down)\b/, unless: /\bvertical drop\b/, calls: () => [{ name: 'move_camera', input: { direction: [0, -1, 0], speed: 70, seconds: 3 } }], say: 'Down.' },
  { re: /\b(forward|ahead|onward|push in)\b/, calls: () => [{ name: 'move_camera', input: { direction: [0, 0, -1], speed: 120, seconds: 4 } }], say: 'Forward.' },
  { re: /\b(back|backward|retreat|pull back|pull out)\b/, calls: () => [{ name: 'move_camera', input: { direction: [0, 0, 1], speed: 90, seconds: 4 } }], say: 'Back.' },
  { re: /\b(left)\b/, calls: () => [{ name: 'move_camera', input: { direction: [-1, 0, 0], speed: 70, seconds: 3 } }], say: 'Left.' },
  { re: /\b(right)\b/, calls: () => [{ name: 'move_camera', input: { direction: [1, 0, 0], speed: 70, seconds: 3 } }], say: 'Right.' },
  { re: /\b(look at|face|turn to|point at)\b/, calls: () => [{ name: 'look_at', input: { point: [0, 120, -400], seconds: 2 } }], say: 'Looking.' },

  // ---- lens ---------------------------------------------------------------
  { re: /\b(miniature|tilt ?shift|toy city|model)\b/, calls: () => [{ name: 'set_lens', input: { tiltShift: 0.9, bokeh: 0.85, focusWidth: 0.1, fov: 26 * D, saturation: 1.3, horizonBend: 0.35 } }], say: 'Miniature.' },
  { re: /\b(blur|blurrier|blurry|soft focus|shallow|out of focus|dreamy|ethereal|soft)\b/, calls: () => [{ name: 'set_lens', input: { bokeh: 0.9, tiltShift: 0.7, focusWidth: 0.18 } }], say: 'Soft focus.' },
  { re: /\b(sharp|crisp|focus|focused|in focus|clear shot)\b/, calls: () => [{ name: 'set_lens', input: { bokeh: 0.15, tiltShift: 0.05, focusWidth: 0.9 } }], say: 'Sharp.' },
  { re: /\b(wider|wide angle|wide-angle|wider angle|wide)\b/, calls: () => [{ name: 'set_lens', input: { fov: 92 * D } }], say: 'Wider.' },
  { re: /\b(telephoto|zoom|long lens|narrow|compressed)\b/, calls: () => [{ name: 'set_lens', input: { fov: 18 * D } }], say: 'Long lens.' },
  { re: /\b(dutch|dutch angle|bank|banked|roll|tilt the horizon)\b/, calls: () => [{ name: 'set_lens', input: { roll: 0.22 } }], say: 'Banked horizon.' },
  { re: /\b(level|straight|straighten|unbank)\b/, calls: () => [{ name: 'set_lens', input: { roll: 0 } }], say: 'Level.' },
  { re: /\b(grain|film|noisy|16mm|analog(?:ue)?)\b/, calls: () => [{ name: 'set_lens', input: { grain: 0.65 } }], say: 'Film grain.' },
  { re: /\b(vignette|vignetted)\b/, calls: () => [{ name: 'set_lens', input: { vignette: 0.8 } }], say: 'Vignette.' },
  { re: /\b(warp|melt|melting|liquid|impossible|dream(?:y)?|strange|uncanny|surreal|weird|bending|swim)\b/, calls: () => [{ name: 'set_lens', input: { warp: 0.65, horizonBend: 0.5, breathe: 0.6, distortion: 0.14 } }], say: 'Letting the geometry go.' },
  { re: /\b(chroma|chromatic|aberration|fringe)\b/, calls: () => [{ name: 'set_lens', input: { chroma: 0.9 } }], say: 'Chromatic edges.' },
  { re: /\b(saturate|vivid|colourful|colorful|punchy|rich)\b/, calls: () => [{ name: 'set_color_grade', input: { saturation: 1.45 } }], say: 'More colour.' },
  { re: /\b(desaturate|monochrome|black ?and ?white|b&w|muted|grey ?out|greyish)\b/, calls: () => [{ name: 'set_color_grade', input: { saturation: 0.18 } }], say: 'Monochrome.' },
  { re: /\b(bright(?:er)?|expose up|lift|overexposed)\b/, calls: () => [{ name: 'set_lens', input: { exposure: 0.55 } }], say: 'Brighter.' },
  { re: /\b(darker|expose down|underexposed|dim)\b/, calls: () => [{ name: 'set_lens', input: { exposure: -0.6 } }], say: 'Darker.' },
  { re: /\b(bloom|glow|glowing|luminous|halo|halation|blown out)\b/, calls: () => [{ name: 'set_lens', input: { bloom: 0.95 } }], say: 'Bloom up.' },
  { re: /\b(calm lens|normal lens|clean lens|no effects|reset the look)\b/, calls: () => [{ name: 'reset_world', input: {} }], say: 'Back to the authored look.' },

  // ---- grade --------------------------------------------------------------
  { re: /\b(teal and orange|warm grade|cold grade|blue grade|grade|colour grade|color grade)\b/, say: (m) => `Grading ${/\b(teal|cold|blue)\b/i.test(m[0]) ? 'cold' : 'warm'}.`, calls: (m) => [{ name: 'set_color_grade', input: /\b(teal|cold|blue)\b/i.test(m[0]) ? { tint: [0.85, 1.0, 1.2] } : { tint: [1.2, 1.0, 0.82] } }] },

  // ---- crowds / traffic ---------------------------------------------------
  { re: /\b(celebrat\w*|party|festival|feast|carnival|parade|celebratory)\b/, calls: () => [{ name: 'trigger_event', input: { kind: 'bloom-festival', ttl: 120, radius: 500 } }, { name: 'set_crowd', input: { count: 14000, density: 0.95, agitation: 0.55 } }], say: 'Festival. The terraces are packed.' },
  { re: /\b(panic|chaos|riot|scare|frighten|terrify|scared)\b/, calls: () => [{ name: 'set_crowd', input: { agitation: 0.95 } }], say: 'Panic.' },
  { re: /\b(crowd|crowded|crowds|busts|busy|people|pedestrians|mass(?:es)? of people)\b/, calls: () => [{ name: 'set_crowd', input: { count: 12000, density: 0.9, agitation: 0.2 } }], say: 'Thick with people.' },
  { re: /\b(empty|desolate|abandoned|quiet|calm streets|nobody|lonely)\b/, calls: () => [{ name: 'set_crowd', input: { count: 120, density: 0.08, agitation: 0.02 } }, { name: 'set_traffic', input: { count: 12, density: 0.1 } }], say: 'Empty. Nobody home.' },
  { re: /\b(rush hour|gridlock|traffic jam|jam)\b/, calls: () => [{ name: 'set_traffic', input: { count: 900, density: 1 } }], say: 'Gridlock.' },
  { re: /\b(traffic|cars|trams|tram|vehicles|convoy)\b/, calls: () => [{ name: 'set_traffic', input: { count: 520, density: 0.85 } }], say: 'More traffic.' },

  // ---- events -------------------------------------------------------------
  { re: /\b(birds?|migration|flock|swarm)\b/, calls: () => [{ name: 'trigger_event', input: { kind: 'migration', ttl: 90, radius: 500 } }], say: 'A migration coming over the ridge.' },
  { re: /\b(market|bazaar|stalls|traders)\b/, calls: () => [{ name: 'trigger_event', input: { kind: 'market-rush', ttl: 150, radius: 320 } }, { name: 'set_crowd', input: { count: 7000, density: 0.8, agitation: 0.35 } }], say: 'Market rush.' },
  { re: /\b(balloons?|release)\b/, calls: () => [{ name: 'trigger_event', input: { kind: 'balloon-release', ttl: 150, radius: 400 } }], say: 'Letting them go.' },
  { re: /\b(lanterns?|sky lanterns?|paper lanterns?)\b/, calls: () => [{ name: 'trigger_event', input: { kind: 'lantern-rise', ttl: 180, radius: 400 } }], say: 'Lanterns.' },
  { re: /\b(blimps?|zeppelins?|dirigibles?|airships?)\b/, calls: () => [{ name: 'trigger_event', input: { kind: 'blimp-parade', ttl: 200, radius: 600 } }], say: 'Blimp parade.' },
  { re: /\b(collapse|collapse it|demolish|destroy|wreck|topple|bring it down)\b/, calls: () => [], say: 'I cannot collapse structures — nothing here comes down.' },
  { re: /\b(power ?(?:out|outage|failure)|blackout|lights out|power cycle|darkness)\b/, calls: () => [{ name: 'trigger_event', input: { kind: 'power-cycle', ttl: 45, radius: 900 } }], say: 'Power cycle. The city blinks out.' },
  { re: /\b(flood|flash ?flood|inundat\w*)\b/, calls: () => [{ name: 'trigger_event', input: { kind: 'flash-flood', ttl: 90, radius: 700 } }, { name: 'set_weather', input: { precip: 'rain', wetness: 1, haze: 0.5 } }], say: 'Flash flood.' },
  { re: /\b(aurora|aurora borealis|northern lights|northern light)\b/, calls: () => [{ name: 'trigger_event', input: { kind: 'aurora-borealis', ttl: 240, radius: 1400 } }], say: 'Aurora.' },
  { re: /\b(sunbreak|break in the clouds|god ?break|sun ?break|shaft of sun)\b/, calls: () => [{ name: 'trigger_event', input: { kind: 'sunbreak', ttl: 45, radius: 500 } }], say: 'A sunbreak.' },
];

/** Camera position is needed by the "stop" rule; passed in via context. */
export interface LocalBrainContext {
  cam: [number, number, number];
}

function runClause(clause: string, ctx: LocalBrainContext): { text: string; calls: ToolCall[] } {
  for (const rule of RULES) {
    if (rule.unless && rule.unless.test(clause)) continue;
    const m = rule.re.exec(clause);
    if (!m) continue;
    const calls = rule.calls ? rule.calls(m, ctx) : [];
    return { text: typeof rule.say === 'function' ? rule.say(m) : rule.say, calls };
  }
  return { text: '', calls: [] };
}

/**
 * Parse free text into tool calls. Unmatched clauses are reported back so the
 * console can explain what the local brain actually understands.
 */
export function localBrain(input: string, world: WorldState, cam: [number, number, number] = [0, 0, 0]): LocalPlan {
  const ctx: LocalBrainContext = { cam };
  const parts = clauses(input);
  const calls: ToolCall[] = [];
  const lines: string[] = [];
  const missed: string[] = [];

  for (const p of parts) {
    const r = runClause(p, ctx);
    if (r.calls.length === 0 && r.text === '') { missed.push(p); continue; }
    if (r.text) lines.push(r.text);
    calls.push(...r.calls);
  }

  if (lines.length === 0) {
    if (missed.length === 0) {
      return { text: 'Nothing to change.', calls: [{ name: 'describe_world', input: {} }] };
    }
    calls.push({ name: 'describe_world', input: {} });
    return {
      text:
        `I can't steer that without an API key configured (set ANTHROPIC_API_KEY and restart the dev server).\n\n` +
        `What I do understand: weather ("make it rain", "storm", "fog", "clear it up"), ` +
        `time ("golden hour", "night", "freeze time", "faster"), camera ("go to the canyon", "orbit", "fly up"), ` +
        `lens ("miniature", "blurrier", "dutch angle", "warp"), and events ("lanterns", "festival").\n\n` +
        `Current state —\n${describeWorld(world)}`,
      calls,
    };
  }

  if (missed.length) lines.push(`(ignored: ${missed.join(', ')})`);
  return { text: lines.join(' '), calls };
}

/** Commands handled locally without any parsing ambiguity, for the `/` prefix. */
export const SLASH_COMMANDS = [
  '/help', '/state', '/clear', '/reset',
  '/weather storm|rain|snow|fog|clear|cloud|haze|ash|pollen',
  '/tour canyon|skyline|canal|aerial|ground|vertical-drop|orbit',
  '/lens miniature|soft|sharp|wide|tele|dutch|normal|warp',
  '/time dawn|morning|noon|afternoon|dusk|night',
  '/event lantern-rise|bloom-festival|migration|aurora-borealis|lightning|monsoon',
] as const;
