export interface ZmStreamOpenOptions {
  url: string;
  stallTimeoutMs: number;
}

export interface ZmStreamHandle {
  streamId: string;
}

export interface ZmStreamPlugin {
  /** Start holding a ZoneMinder MJPEG stream natively; frames are served over zmframe://. */
  open(options: ZmStreamOpenOptions): Promise<ZmStreamHandle>;
  /** Stop the stream and release its connection. */
  close(options: ZmStreamHandle): Promise<void>;
  /** Stop every stream. Reclaims streams a previous webview left behind. */
  closeAll(): Promise<void>;
}
