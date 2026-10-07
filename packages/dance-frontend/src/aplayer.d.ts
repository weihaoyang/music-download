declare module 'aplayer' {
  export interface APlayerAudio {
    name?: string;
    artist?: string;
    url: string;
    cover?: string;
    lrc?: string;
    theme?: string;
  }
  export interface APlayerOptions {
    container: HTMLElement;
    audio: APlayerAudio[];
    listFolded?: boolean;
    listMaxHeight?: string;
    theme?: string;
    loop?: string;
    order?: string;
    preload?: string;
    volume?: number;
    mutex?: boolean;
    autoplay?: boolean;
    [key: string]: unknown;
  }
  export default class APlayer {
    constructor(options: APlayerOptions);
    play(): void;
    pause(): void;
    destroy(): void;
    seek(time: number): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
    list: {
      switch(index: number): void;
      clear(): void;
      add(audio: APlayerAudio | APlayerAudio[]): void;
      show(): void;
      hide(): void;
    };
  }
}

declare module 'aplayer/dist/APlayer.min.css';
