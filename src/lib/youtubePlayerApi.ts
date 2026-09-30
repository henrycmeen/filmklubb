export interface YoutubePlayerSample {
  state: number;
  currentTime: number;
  duration: number;
}

export interface YoutubePlayer {
  mute: () => void;
  setVolume: (volume: number) => void;
  isMuted: () => boolean;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getPlayerState: () => number;
  getCurrentTime: () => number;
  getDuration: () => number;
  destroy: () => void;
  setOption?: (module: string, option: string, value: unknown) => void;
  unloadModule?: (module: string) => void;
}

export interface YoutubeIframeApi {
  Player: new (
    iframe: HTMLIFrameElement,
    options: {
      events: {
        onReady: (event: { target: YoutubePlayer }) => void;
        onStateChange: (event: { target: YoutubePlayer; data: number }) => void;
        onAutoplayBlocked: () => void;
        onError: (event: { data: number }) => void;
        onApiChange: (event: { target: YoutubePlayer }) => void;
      };
    },
  ) => YoutubePlayer;
}

interface ApiLoaderDependencies {
  getApi: () => YoutubeIframeApi | undefined;
  subscribeReady: (callback: () => void) => () => void;
  loadScript: (onError: () => void) => () => void;
  schedule: (callback: () => void, delay: number) => number;
  cancel: (timer: number) => void;
}

export const createYoutubeApiLoader = (dependencies: ApiLoaderDependencies) => {
  let pending: Promise<YoutubeIframeApi> | null = null;
  return (): Promise<YoutubeIframeApi> => {
    const ready = dependencies.getApi();
    if (ready?.Player) return Promise.resolve(ready);
    if (pending) return pending;
    pending = new Promise<YoutubeIframeApi>((resolve, reject) => {
      let settled = false;
      let unsubscribe = () => undefined as void;
      let removeErrorListener = () => undefined as void;
      let timer: number | null = null;
      const finish = (api?: YoutubeIframeApi) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        removeErrorListener();
        if (timer !== null) dependencies.cancel(timer);
        if (api?.Player) resolve(api);
        else reject(new Error("YouTube player API could not load"));
      };
      unsubscribe = dependencies.subscribeReady(() =>
        finish(dependencies.getApi()),
      );
      removeErrorListener = dependencies.loadScript(() => finish());
      timer = dependencies.schedule(() => finish(), 15_000);
    });
    const result = pending;
    // A failed load may be retried later. Successful callers share one promise.
    void result.catch(() => {
      if (pending === result) pending = null;
    });
    return result;
  };
};

type YoutubeWindow = Window & {
  YT?: YoutubeIframeApi;
  onYouTubeIframeAPIReady?: () => void;
};
let browserLoader: (() => Promise<YoutubeIframeApi>) | null = null;

export const loadYoutubeIframeApi = (): Promise<YoutubeIframeApi> => {
  if (!browserLoader) {
    const browser = window as YoutubeWindow;
    browserLoader = createYoutubeApiLoader({
      getApi: () => browser.YT,
      subscribeReady: (callback) => {
        const previous = browser.onYouTubeIframeAPIReady;
        const ready = () => {
          try {
            previous?.();
          } finally {
            callback();
          }
        };
        browser.onYouTubeIframeAPIReady = ready;
        return () => {
          if (browser.onYouTubeIframeAPIReady === ready) {
            browser.onYouTubeIframeAPIReady = previous;
          }
        };
      },
      loadScript: (onError) => {
        const existing = document.querySelector<HTMLScriptElement>(
          'script[src="https://www.youtube.com/iframe_api"]',
        );
        const script = existing ?? document.createElement("script");
        const failed = () => {
          if (!existing) script.remove();
          onError();
        };
        script.addEventListener("error", failed);
        if (!existing) {
          script.src = "https://www.youtube.com/iframe_api";
          script.async = true;
          document.head.appendChild(script);
        }
        return () => script.removeEventListener("error", failed);
      },
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (timer) => window.clearTimeout(timer),
    });
  }
  return browserLoader();
};

// Public getters are supplied by the official player, regardless of its private
// postMessage payload shape. A missing duration does not prevent picture reveal.
export const readYoutubePlayerSample = (
  player: Pick<
    YoutubePlayer,
    "getPlayerState" | "getCurrentTime" | "getDuration"
  >,
): YoutubePlayerSample | null => {
  const state = player.getPlayerState();
  const currentTime = player.getCurrentTime();
  const duration = player.getDuration();
  if (
    !Number.isFinite(state) ||
    !Number.isFinite(currentTime) ||
    currentTime < 0
  ) {
    return null;
  }
  return {
    state,
    currentTime,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
  };
};

export const createMutedYoutubePlayback = (
  player: Pick<YoutubePlayer, "mute" | "setVolume" | "isMuted" | "playVideo">,
) => {
  let playPending = false;
  const flush = () => {
    if (playPending && player.isMuted()) {
      playPending = false;
      player.playVideo();
    }
  };
  return {
    request: () => {
      playPending = true;
      player.setVolume(0);
      player.mute();
      flush();
    },
    flush,
    cancel: () => {
      playPending = false;
    },
  };
};

export const observeYoutubeProgress = (
  previousTime: number | null,
  lastAdvancedAt: number | null,
  currentTime: number,
  now: number,
): { advanced: boolean; lastAdvancedAt: number | null } => {
  const advanced = previousTime !== null && currentTime > previousTime + 0.01;
  return {
    advanced,
    lastAdvancedAt: previousTime === null || advanced ? now : lastAdvancedAt,
  };
};

export const shouldRecoverYoutubePoster = (
  state: number,
  previousTime: number | null,
  currentTime: number,
  manualPlaybackRequested: boolean,
): boolean =>
  manualPlaybackRequested &&
  state === 1 &&
  observeYoutubeProgress(previousTime, null, currentTime, 0).advanced;
