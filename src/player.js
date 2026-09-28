const RUNNING = new Set(["speaking", "repeat-gap", "writing-gap"]);

/** True only for the explicitly British voice dialect used by this application. */
export function isBritish(voice) {
  return voice?.lang?.replace("_", "-").toLowerCase() === "en-gb";
}

/**
 * Own one utterance and one wait timer for an ordered paper-dictation session.
 * Generation guards invalidate all speech/timer callbacks before cancellation.
 * Interrupted speech is reread on resume; timed pauses preserve remaining time.
 */
export class DictationPlayer {
  constructor({ synth, createUtterance, timers, onChange }) {
    this.synth = synth;
    this.createUtterance = createUtterance;
    this.timers = timers || {
      now: () => performance.now(),
      setTimeout: (f, ms) => setTimeout(f, ms),
      clearTimeout: (id) => clearTimeout(id),
    };
    this.onChange = onChange || (() => {});
    this.queue = [];
    this.settings = { repeat: 1, interval: 10, voice: null };
    this.state = {
      phase: "idle",
      index: 0,
      reading: 0,
      remaining: 0,
      error: "",
    };
    this.generation = 0;
    this.timer = null;
    this.watchdog = null;
    this.utterance = null;
    this.pausedPhase = null;
  }

  /** Replace the queue after cancelling all actions from the previous session. */
  setQueue(items) {
    this.stop();
    this.queue = [...items];
    this.state.index = 0;
    this.emit();
  }

  /** Apply valid settings between runs, resetting the interrupted current item. */
  configure(settings) {
    const next = { ...this.settings, ...settings };
    if (
      ![1, 2, 3].includes(next.repeat) ||
      !Number.isInteger(next.interval) ||
      next.interval < 1 ||
      next.interval > 60
    )
      throw new Error("朗读次数或书写间隔无效。");
    this.stop();
    this.settings = next;
  }

  /** Notify UI with an immutable state snapshot. */
  emit() {
    this.onChange({ ...this.state });
  }

  /** Invalidate callbacks first, then release owned speech and timers. */
  cancel() {
    this.generation++;
    this.timers.clearTimeout(this.timer);
    this.timers.clearTimeout(this.watchdog);
    this.timer = null;
    this.watchdog = null;
    this.utterance = null;
    this.synth?.cancel();
  }

  /** Stop playback without discarding the selected item or queue. */
  stop() {
    this.cancel();
    Object.assign(this.state, {
      phase: "idle",
      reading: 0,
      remaining: 0,
      error: "",
    });
    this.pausedPhase = null;
    this.emit();
  }

  /** Start the selected item using an explicit en-GB voice only. */
  start() {
    this.cancel();
    if (!this.queue.length) return this.fail("当前没有可听写的单词。");
    if (!this.synth || !isBritish(this.settings.voice))
      return this.fail("没有可用的英国英语声音，请先选择英音。");
    if (this.state.phase === "complete") this.state.index = 0;
    Object.assign(this.state, { reading: 0, error: "", remaining: 0 });
    this.read();
  }

  /** Read exactly one occurrence; only its end event can start the next wait. */
  read() {
    const generation = this.generation;
    this.state.phase = "speaking";
    this.state.remaining = 0;
    this.emit();
    const u = this.createUtterance(this.queue[this.state.index].english);
    this.utterance = u;
    u.voice = this.settings.voice;
    u.lang = "en-GB";
    u.rate = 0.85;
    u.pitch = 1;
    u.volume = 1;
    let ended = false;
    u.onend = () => {
      if (generation !== this.generation || ended) return;
      ended = true;
      this.utterance = null;
      this.timers.clearTimeout(this.watchdog);
      this.state.reading++;
      if (this.state.reading < this.settings.repeat)
        this.wait("repeat-gap", 1000);
      else this.wait("writing-gap", this.settings.interval * 1000);
    };
    u.onerror = (e) => {
      if (generation === this.generation && !ended)
        this.fail(`朗读失败（${e.error || "系统错误"}），请重播当前词。`);
    };
    // A silent browser failure must surface rather than leaving a session running forever.
    this.watchdog = this.timers.setTimeout(() => {
      if (generation === this.generation && !ended)
        this.fail("系统未完成朗读，请检查声音后重播当前词。");
    }, 30000);
    try {
      this.synth.speak(u);
    } catch (error) {
      this.fail(`无法朗读：${error.message}`);
    }
  }

  /** Run one countdown, scheduling by a deadline to avoid cumulative timer drift. */
  wait(phase, ms) {
    this.state.phase = phase;
    this.deadline = this.timers.now() + ms;
    const generation = this.generation;
    const tick = () => {
      if (generation !== this.generation) return;
      const remaining = Math.max(0, this.deadline - this.timers.now());
      this.state.remaining = remaining;
      this.emit();
      if (remaining > 0)
        this.timer = this.timers.setTimeout(tick, Math.min(100, remaining));
      else if (phase === "repeat-gap") this.read();
      else if (this.state.index < this.queue.length - 1) {
        this.state.index++;
        this.state.reading = 0;
        this.read();
      } else {
        this.state.phase = "complete";
        this.emit();
      }
    };
    tick();
  }

  /** Freeze a timed wait or cancel incomplete speech for a safe word-level resume. */
  pause() {
    if (!RUNNING.has(this.state.phase)) return;
    const phase = this.state.phase;
    const remaining =
      phase === "speaking" ? 0 : Math.max(0, this.deadline - this.timers.now());
    this.cancel();
    this.pausedPhase = phase;
    Object.assign(this.state, { phase: "paused", remaining });
    this.emit();
  }

  /** Resume a frozen wait or reread the interrupted occurrence from its beginning. */
  resume() {
    if (this.state.phase !== "paused") return;
    if (this.pausedPhase === "speaking") this.read();
    else this.wait(this.pausedPhase, this.state.remaining);
  }

  /** Replay the current item with its full configured reading count and writing interval. */
  replay() {
    this.stop();
    this.start();
  }

  /** Select an adjacent item; continue automatically only when the prior state was running. */
  move(delta) {
    const running = RUNNING.has(this.state.phase);
    const index = Math.max(
      0,
      Math.min(this.queue.length - 1, this.state.index + delta),
    );
    this.stop();
    this.state.index = index;
    this.emit();
    if (running) this.start();
  }

  /** Surface a recoverable failure and stop advancing the queue. */
  fail(message) {
    this.cancel();
    this.state.phase = "error";
    this.state.error = message;
    this.emit();
  }
}
