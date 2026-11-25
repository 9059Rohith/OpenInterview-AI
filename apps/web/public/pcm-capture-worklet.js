/* The resampler keeps interpolation phase and its boundary sample across every
 * render quantum. Capture timing comes entirely from the audio rendering thread. */
export class StreamingPcmResampler {
  constructor(inputRate, outputRate = 24000) {
    if (!Number.isFinite(inputRate) || inputRate <= 0 || !Number.isFinite(outputRate) || outputRate <= 0) throw new Error('Invalid audio sample rate.');
    this.step = inputRate / outputRate;
    this.pending = new Float32Array(0);
    this.position = 0;
  }
  push(channels) {
    const frames = channels[0]?.length ?? 0;
    if (!frames) return new Int16Array(0);
    const combined = new Float32Array(this.pending.length + frames);
    combined.set(this.pending);
    for (let frame = 0; frame < frames; frame++) {
      let mono = 0;
      for (const channel of channels) mono += Number.isFinite(channel[frame]) ? channel[frame] : 0;
      combined[this.pending.length + frame] = mono / channels.length;
    }
    this.pending = combined;
    return this.read(false);
  }
  read(final) {
    const output = [];
    while (final ? this.position < this.pending.length : this.position + 1 < this.pending.length) {
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      const next = Math.min(index + 1, this.pending.length - 1);
      const value = this.pending[index] * (1 - fraction) + this.pending[next] * fraction;
      output.push(Math.max(-32768, Math.min(32767, Math.trunc(value * 32767))));
      this.position += this.step;
    }
    const consumed = Math.min(Math.floor(this.position), Math.max(0, this.pending.length - 1));
    this.pending = this.pending.slice(consumed);
    this.position -= consumed;
    if (final) { this.pending = new Float32Array(0); this.position = 0; }
    return Int16Array.from(output);
  }
  flush() { return this.read(true); }
}

// The guard lets synthetic tests import the actual worklet resampler in Node.
if (typeof registerProcessor === 'function') {
  class PcmCaptureProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.resampler = new StreamingPcmResampler(sampleRate);
      this.packet = new Int16Array(480); // 20 ms, 24 kHz mono PCM16.
      this.used = 0;
      this.stopped = false;
      this.port.onmessage = event => {
        if (event.data?.type === 'stop' && !this.stopped) {
          this.stopped = true;
          this.write(this.resampler.flush());
          if (this.used) this.send(this.packet.slice(0, this.used));
          this.used = 0;
          this.port.postMessage({type: 'drained'});
        }
      };
    }
    send(pcm) { this.port.postMessage({type: 'pcm', buffer: pcm.buffer}, [pcm.buffer]); }
    write(samples) {
      let offset = 0;
      while (offset < samples.length) {
        const count = Math.min(this.packet.length - this.used, samples.length - offset);
        this.packet.set(samples.subarray(offset, offset + count), this.used);
        this.used += count;
        offset += count;
        if (this.used === this.packet.length) { this.send(this.packet); this.packet = new Int16Array(480); this.used = 0; }
      }
    }
    process(inputs, outputs) {
      if (this.stopped) return false;
      // No input during loopback silence still advances sample-based VAD.
      const channels = inputs[0]?.length ? inputs[0] : [new Float32Array(outputs[0]?.[0]?.length ?? 128)];
      try { this.write(this.resampler.push(channels)); }
      catch { this.port.postMessage({type: 'error', message: 'PCM audio processing failed.'}); this.stopped = true; return false; }
      // The output remains zero: captured PC/MIC sound is never played back.
      return true;
    }
  }
  registerProcessor('shadow-pcm-capture', PcmCaptureProcessor);
}
