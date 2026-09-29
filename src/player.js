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
  constructor({ synth, createUtterance, audio, timers, onChange }) {
    this.synth = synth;
    this.audio = audio;
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
    this.audio?.cancel();
  }

  /** Stop playback without discarding the selected item or queue. */
  stop() {
    this.cancel();
    Object.assign(this.state, {
      phase: "idle",
      preview: false,
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
    if (!this.available(this.queue)) return;
    if (this.state.phase === "complete") this.state.index = 0;
    Object.assign(this.state, {
      reading: 0,
      error: "",
      remaining: 0,
      preview: false,
    });
    this.read();
  }

  /** Validate the whole session before starting; never skip unavailable items. */
  available(items) {
    if (this.settings.voice?.recorded) {
      if (!this.audio || items.some((item) => !this.audio.canPlay(item))) {
        this.fail("当前词表含未收录的预置英音，请选择系统英音或补充录音。");
        return false;
      }
    } else if (!this.synth || !isBritish(this.settings.voice)) {
      this.fail("没有可用的英国英语声音，请先选择英音。");
      return false;
    }
    return true;
  }

  /** A one-off preview must not discard a paused countdown or the main queue. */
  preview(item) {
    if (this.state.phase === "paused") return;
    this.stop();
    if (!this.available([item])) return;
    this.state.preview = true;
    this.read(item);
  }

  /** Only the current occurrence's end event can start the next wait. */
  read(item = this.queue[this.state.index]) {
    const generation = this.generation;
    this.state.phase = "speaking";
    this.state.remaining = 0;
    this.emit();
    let ended = false;
    const onend = () => {
      if (generation !== this.generation || ended) return;
      ended = true;
      this.utterance = null;
      this.timers.clearTimeout(this.watchdog);
      if (this.state.preview) return this.stop();
      this.state.reading++;
      if (this.state.reading < this.settings.repeat)
        this.wait("repeat-gap", 1000);
      else this.wait("writing-gap", this.settings.interval * 1000);
    };
    const onerror = (error) => {
      if (generation === this.generation && !ended)
        this.fail(
          `朗读失败（${error.message || error.error || "系统错误"}），请重播当前词。`,
        );
    };
    // Loading and decoding count as speaking, so silent failures still have a deadline.
    this.watchdog = this.timers.setTimeout(() => {
      if (generation === this.generation && !ended)
        this.fail("未能完成朗读，请检查声音或网络后重播当前词。");
    }, 30000);
    try {
      if (this.settings.voice?.recorded) {
        this.audio.play(item, { onend, onerror });
      } else {
        const u = this.createUtterance(item.english);
        this.utterance = u;
        Object.assign(u, {
          voice: this.settings.voice,
          lang: "en-GB",
          rate: 0.85,
          pitch: 1,
          volume: 1,
          onend,
          onerror,
        });
        this.synth.speak(u);
      }
    } catch (error) {
      onerror(error);
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
    if (this.state.preview) return this.stop();
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
    if (this.settings.voice?.recorded && this.pausedPhase !== "speaking") {
      const generation = this.generation;
      try {
        Promise.resolve(this.audio.unlock()).catch((error) => {
          if (generation === this.generation) this.fail(error.message);
        });
      } catch (error) {
        return this.fail(error.message);
      }
    }
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
    const running = RUNNING.has(this.state.phase) && !this.state.preview;
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
