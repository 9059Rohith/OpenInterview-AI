/** Aster's manual turn detection, measured in 24 kHz samples, never wall-clock timers. */
export const PCM_RATE = 24000;
export type PcmTurnEvent = {kind: 'append'; pcm: Int16Array} | {kind: 'commit' | 'clear'};

export class PcmTurnDetector {
  private preRoll: Int16Array[] = [];
  private preSamples = 0;
  private speaking = false;
  private turnSamples = 0;
  private silentSamples = 0;
  level = 0;
  voice = false;

  push(pcm: Int16Array): PcmTurnEvent[] {
    if (!pcm.length) return [];
    let energy = 0;
    for (const sample of pcm) energy += (sample / 32768) ** 2;
    this.level = Math.sqrt(energy / pcm.length);
    this.voice = this.level > .005;
    const events: PcmTurnEvent[] = [];
    if (!this.speaking) {
      this.preRoll.push(pcm);
      this.preSamples += pcm.length;
      // Trim precisely, including a partial packet, to retain at most 300 ms.
      while (this.preSamples > 7200) {
        const first = this.preRoll[0];
        const excess = this.preSamples - 7200;
        if (first.length <= excess) { this.preRoll.shift(); this.preSamples -= first.length; }
        else { this.preRoll[0] = first.slice(excess); this.preSamples -= excess; }
      }
      if (!this.voice) return events;
      this.speaking = true;
      this.turnSamples = 0;
      this.silentSamples = 0;
      for (const packet of this.preRoll) { events.push({kind: 'append', pcm: packet}); this.turnSamples += packet.length; }
      this.preRoll = [];
      this.preSamples = 0;
    } else {
      events.push({kind: 'append', pcm});
      this.turnSamples += pcm.length;
    }
    this.silentSamples = this.voice ? 0 : this.silentSamples + pcm.length;
    // Like LiveSource, the minimum is the whole turn, including pre-roll and silence.
    if ((this.silentSamples >= 16800 && this.turnSamples >= 6000) || this.turnSamples >= PCM_RATE * 18) {
      events.push({kind: 'commit'});
      this.speaking = false;
      this.turnSamples = this.silentSamples = 0;
    }
    return events;
  }

  finish(): PcmTurnEvent[] {
    const events: PcmTurnEvent[] = this.speaking ? [{kind: this.turnSamples >= 2400 ? 'commit' : 'clear'}] : [];
    this.reset();
    return events;
  }

  reset(): void {
    this.preRoll = [];
    this.preSamples = this.turnSamples = this.silentSamples = 0;
    this.speaking = this.voice = false;
    this.level = 0;
  }
}

/** Explicit little endian conversion also works on machines with a different host byte order. */
export function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < pcm.length; i++) view.setInt16(i * 2, pcm[i], true);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
