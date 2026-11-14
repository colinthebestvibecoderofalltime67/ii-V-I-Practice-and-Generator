import { drillStep, type DrillConfig, type DrillStep } from './drill';

export interface SessionConfig {
  callResponse: boolean;
  /** Response passes after each call, 1 or 2. */
  responses: number;
  /** The 12-key drill, or null when it is off. A "repeat" of the drill is one whole call+response group. */
  drill: DrillConfig | null;
  keys: readonly number[];
  startBpm: number;
}

export interface SessionStep {
  role: 'call' | 'response';
  /** Which response of the group (0-based); 0 for a call. */
  responseIndex: number;
  /** Which call+response group this pass belongs to (0-based). */
  groupIndex: number;
  /** Passes in each group: 1 without call and response, else 1 + responses. */
  groupSize: number;
  /** Lead muted this pass. */
  silentLead: boolean;
  /** The drill position of this group (null when the drill is off). */
  drill: DrillStep | null;
  /** The key to switch to at the start of this pass (only on the first pass of a drill key), else null. */
  newKey: number | null;
  /** Tempo this pass; null = leave the tempo alone (no drill). */
  bpm: number | null;
  /** Past the end of the drill: stop. Always false without a drill. */
  done: boolean;
}

/**
 * What pass number `passIndex` (0 = first) should do. Without the drill the pass loop runs forever, alternating call
 * and response; with it, the drill's repeat counter advances once per call+response group, so the key and the
 * tempo ladder only change between groups, never between a call and its response.
 */
export function sessionStep(cfg: SessionConfig, passIndex: number): SessionStep {
  const responses = Math.min(2, Math.max(1, Math.round(cfg.responses)));
  const groupSize = cfg.callResponse ? 1 + responses : 1;
  const p = Math.max(0, Math.floor(passIndex));
  const groupIndex = Math.floor(p / groupSize);
  const slot = p % groupSize;
  const role = slot === 0 ? 'call' : 'response';
  const drill = cfg.drill ? drillStep(cfg.drill, cfg.keys, cfg.startBpm, groupIndex) : null;
  return {
    role,
    responseIndex: Math.max(0, slot - 1),
    groupIndex,
    groupSize,
    silentLead: role === 'response',
    drill,
    newKey: drill && slot === 0 && drill.keyChanged ? drill.key : null,
    bpm: drill ? drill.bpm : null,
    done: !!drill && drill.done,
  };
}
