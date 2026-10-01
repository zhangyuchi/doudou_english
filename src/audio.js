/** Match imported occurrences to recordings without depending on source-specific IDs. */
export function normalizeWord(text) {
  return text.trim().toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ");
}

export const bundledVoice = {
  lang: "en-GB",
  voiceURI: "bundled-en-GB",
  recorded: true,
  name: "预置英音 · 真人录音优先",
};

/** Own a cancellable fetch/decode/source and a bounded cache; reuse one unlocked context. */
export class BundledAudio {
  constructor({
    catalog,
    baseURL,
    contextFactory,
    fetch: fetcher = globalThis.fetch,
  }) {
    this.catalog = new Map(
      catalog.map((entry) => [normalizeWord(entry.english), entry]),
    );
    this.baseURL = baseURL;
    this.contextFactory =
      contextFactory ||
      (() => {
        const Context =
          globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Context) throw new Error("浏览器不支持音频播放，请更新浏览器。");
        return new Context();
      });
    this.fetch = fetcher.bind(globalThis);
    this.generation = 0;
    this.cache = new Map();
    this.context = null;
    this.source = null;
    this.request = null;
  }

  canPlay(item) {
    return this.catalog.has(normalizeWord(item.english));
  }

  /**
   * Select media playback routing and resume synchronously within the click gesture.
   * iPad's default Web Audio session can obey the silent switch; browsers without
   * Audio Session keep their existing route. Cancellation does not reset this
   * page-wide policy, since another recorded driver may be about to start.
   */
  unlock() {
    const session = globalThis.navigator?.audioSession;
    if (session) session.type = "playback";
    this.context ||= this.contextFactory();
    return this.context.resume();
  }

  cancel() {
    this.generation++;
    this.request?.abort();
    this.request = null;
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        // A failed start leaves no scheduled source to stop; cleanup must still finish.
      }
      this.source.disconnect();
      this.source = null;
    }
  }

  async play(item, { onend, onerror }) {
    this.cancel();
    const generation = this.generation;
    const valid = () => generation === this.generation;
    try {
      const entry = this.catalog.get(normalizeWord(item.english));
      if (!entry) throw new Error("该项没有预置英音。");
      await this.unlock();
      if (!valid()) return;
      let buffer = this.cache.get(entry.file);
      if (!buffer) {
        this.request = new AbortController();
        const response = await this.fetch(
          new URL(entry.file, this.baseURL).href,
          { signal: this.request.signal },
        );
        if (!valid()) return;
        if (!response.ok)
          throw new Error(
            `音频加载失败（${response.status}），请检查网络后重试。`,
          );
        const data = await response.arrayBuffer();
        if (!valid()) return;
        buffer = await this.context.decodeAudioData(data);
        if (!valid()) return;
        this.cache.set(entry.file, buffer);
        if (this.cache.size > 32)
          this.cache.delete(this.cache.keys().next().value);
      }
      const source = this.context.createBufferSource();
      this.source = source;
      source.buffer = buffer;
      source.connect(this.context.destination);
      source.onended = () => {
        if (!valid() || this.source !== source) return;
        this.source = null;
        source.onended = null;
        source.disconnect();
        onend();
      };
      source.start();
    } catch (error) {
      if (valid()) onerror(error);
    }
  }
}
