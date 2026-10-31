'use strict';

// Runtime pause is independent of disk persistence. A failed or older settings
// write must never undo the user's emergency stop.
class SafetyPause {
  constructor(stop, stopCapture = () => {}) {
    this.stop = stop; this.stopCapture = stopCapture; this.latched = false; this.generation = 0;
    this.channels = { vision: { latched: false, generation: 0 }, memory: { latched: false, generation: 0 } };
  }
  request(patch) {
    let captureOff = false;
    for (const [channel, disabled] of [['vision', patch?.vision?.enabled === false], ['memory', patch?.memory?.capture === false]]) {
      if (disabled) { this.channels[channel].latched = true; this.channels[channel].generation += 1; captureOff = true; }
    }
    if (patch?.paused === true) {
      this.latched = true;
      this.generation += 1;
      this.stop();
    } else if (captureOff) this.stopCapture();
    return { pause: this.generation, vision: this.channels.vision.generation, memory: this.channels.memory.generation };
  }
  patch(patch) {
    // Resuming never implicitly restores a capture that was stopped by pause.
    if (typeof patch?.paused === 'boolean') return { ...patch, vision: { ...patch.vision, enabled: false }, memory: { ...patch.memory, capture: false } };
    if (patch?.ai?.enabled === false) patch = { ...patch, vision: { ...patch.vision, enabled: false } };
    if (patch?.memory?.enabled === false) patch = { ...patch, memory: { ...patch.memory, capture: false } };
    return patch;
  }
  saved(patch, generation) {
    if (patch?.paused === false && generation.pause === this.generation) this.latched = false;
    for (const [channel, enabled] of [['vision', patch?.vision?.enabled === true], ['memory', patch?.memory?.capture === true]]) {
      if (enabled && generation[channel] === this.channels[channel].generation) this.channels[channel].latched = false;
    }
  }
  apply(settings) {
    if (!this.latched && !this.channels.vision.latched && !this.channels.memory.latched) return settings;
    const effective = { ...settings };
    if (this.latched) effective.paused = true;
    if (this.latched || this.channels.vision.latched) effective.vision = { ...settings.vision, enabled: false };
    if (this.latched || this.channels.memory.latched) effective.memory = { ...settings.memory, capture: false };
    return effective;
  }
}

module.exports = { SafetyPause };
