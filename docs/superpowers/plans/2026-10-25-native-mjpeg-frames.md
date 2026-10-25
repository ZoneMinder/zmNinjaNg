# Native MJPEG Frames Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On iOS and Android, live MJPEG tiles stream through a native HTTP client and a `zmframe://` scheme handler, so the webview's six-connections-per-host pool no longer bounds a streaming montage.

**Architecture:** A Capacitor plugin `ZmStream` (`open`/`close`) owns one native reader per stream; the reader parses the multipart body into single JPEG frames held in a one-slot frame store. A custom URL scheme (`WKURLSchemeHandler` on iOS, `shouldInterceptRequest` on Android) serves `zmframe://frames/<streamId>/<n>` from that store, answering at once or parking until the next frame. A new hook `useNativeMjpegFrames` drives the `<img>` loop (bump `n` on `load`); `useMonitorStream` swaps it in for streaming mode on native and nothing else changes.

**Tech Stack:** Capacitor 8 (Swift, Java), React 19 hooks, Vitest + Testing Library, JUnit 4, Swift Package Manager (`swift test`).

**Spec:** `docs/superpowers/specs/2026-10-25-native-mjpeg-frames-design.md`
**Issue:** #156 (closed; Task 0 reopens it)
**Branch:** `feat/native-mjpeg-frames` (created; the spec and this plan are already committed on it)

## Global Constraints

- Run npm commands from `app/`. `npm run gates` before push.
- Native contract: Capacitor plugins import dynamically behind a platform check; a test mock in `app/src/tests/setup.ts`; no static plugin import.
- Logging contract: `log.*` with a `LogLevel`, never `console`; no token or URL in any log. Native logs (`CAPLog`, `Log.*`) that touch a URL or error object carry a `// log-safe:` reason (gate in `agents-contracts.test.ts`).
- Constants contract: the stall ceiling is a named entry in `ZM_INTEGRATION` (`app/src/lib/zmninja-ng-constants.ts`); no literal timeouts.
- HTTP contract applies to JS only; the native reader is the sanctioned native client here.
- C2: files under 400 lines of code. `useMonitorStream.ts` must not grow; the transport goes in the new hook.
- Scheme name `zmframe`, path `frames/<streamId>/<n>`. Frame response headers: `Content-Type: image/jpeg`, `Content-Length`, `Cache-Control: no-store`. Dead or unknown stream: `404`.
- Native per-host caps: iOS `httpMaximumConnectionsPerHost = 64` on the reader session; Android one `HttpURLConnection` per reader thread.
- TLS gating: iOS checks `SSLTrustPlugin.sslTrustEnabled` before `isCertTrustedForHTTP`, else `isServerTrustValid`. Android relies on the default `HttpsURLConnection` factory `SSLTrustPlugin` installs.
- No new dependency on any platform.
- P2: every unit test is proven red (`node scripts/proven-red.mjs <base> <head>`). Native parser tests are proven red by running them before the parser exists.
- Commit per task, conventional commits, `refs #156` in the body. Closing keywords only after the maintainer confirms.
- Device e2e is manual; agents never run it. Task 10 lists what the maintainer checks.

## Review Focus

- A frame whose `Content-Length` lies (shorter than the JPEG): the parser must resync on the next boundary, not emit garbage forever. Test in Task 2 and Task 6 (`resyncsAfterShortContentLength`).
- A `zmframe://` request for a `streamId` that was never opened: `404`, never a park. Tests in Task 3 and Task 6.
- Two `<img>` for one `streamId` (React StrictMode double mount): the second parked request replaces the first, and the first is completed with `404`; nothing leaks a parked task. Tests in Task 3 and Task 6.
- `close` while a request is parked: the parked request completes with `404` within one tick; the store forgets the stream. Tests in Task 3 and Task 6.
- Token refresh mid-stream: the URL changes, the hook closes the old `streamId` and opens the new one before exposing a new `frameSrc`; the old `streamId`'s late `load` is ignored. Tests in Task 4 and Task 5.

---

### Task 0: Reopen the issue

- [ ] **Step 1: Reopen #156 with a comment**

Run `gh api user --jq .login` for the login. Comment, in the slop-mop voice, that the design at the spec path revives #156 with frames instead of a multipart stream, and link the branch. End with `Posted by Claude, assisting @<login>.` Then `gh issue reopen 156`.

---

### Task 1: JS plugin wrapper and the stall constant

**Files:**
- Create: `app/src/plugins/zm-stream/definitions.ts`, `app/src/plugins/zm-stream/index.ts`, `app/src/plugins/zm-stream/web.ts`
- Modify: `app/src/lib/zmninja-ng-constants.ts` (inside `ZM_INTEGRATION`, next to `snapshotInFlightCeilingMs`)
- Modify: `app/src/tests/setup.ts` (after the SafeArea mock)
- Test: `app/src/plugins/zm-stream/__tests__/web.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ZmStreamOpenOptions { url: string; stallTimeoutMs: number }
  export interface ZmStreamHandle { streamId: string }
  export interface ZmStreamPlugin {
    open(options: ZmStreamOpenOptions): Promise<ZmStreamHandle>;
    close(options: ZmStreamHandle): Promise<void>;
  }
  export const ZmStream: ZmStreamPlugin;           // registerPlugin('ZmStream', { web })
  export const ZM_FRAME_SCHEME = 'zmframe';
  export function zmFrameUrl(streamId: string, n: number): string; // `zmframe://frames/${streamId}/${n}`
  export function zmFrameStreamId(url: string): string | null;    // inverse; null when not a zmframe URL
  ZM_INTEGRATION.nativeFrameStallMs = 30000
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// web.test.ts
it('web open rejects: the frame transport is native only', async () => {
  await expect(new ZmStreamWeb().open({ url: 'http://x', stallTimeoutMs: 1 }))
    .rejects.toThrow(/native/i);
});
it('zmFrameUrl and zmFrameStreamId round-trip', () => {
  expect(zmFrameUrl('7', 3)).toBe('zmframe://frames/7/3');
  expect(zmFrameStreamId('zmframe://frames/7/3')).toBe('7');
  expect(zmFrameStreamId('http://zm/cgi-bin/nph-zms')).toBeNull();
});
```

- [ ] **Step 2: Run them, expect FAIL (module not found)**

Run: `npx vitest run src/plugins/zm-stream`

- [ ] **Step 3: Implement the three plugin files in the `safe-area` shape, the two URL helpers in `index.ts`, the constant, and the `setup.ts` mock (`open` resolves `{ streamId: 'mock-stream' }`, `close` resolves)**

- [ ] **Step 4: Run them, expect PASS; run `npx vitest run src/tests/agents-contracts.test.ts`**

- [ ] **Step 5: Commit** `feat(native): ZmStream plugin wrapper and frame URL helpers`

---

### Task 2: iOS multipart parser as a Swift package

**Files:**
- Create: `app/ios/App/MjpegKit/Package.swift`, `app/ios/App/MjpegKit/Sources/MjpegKit/MjpegParser.swift`, `app/ios/App/MjpegKit/Tests/MjpegKitTests/MjpegParserTests.swift`
- Create fixtures: `app/ios/App/MjpegKit/Tests/MjpegKitTests/Fixtures/{clean-three.bin,no-content-length.bin,truncated.bin}` (build them with a small script in the test, or check in bytes; frames may be any bytes, a JPEG header is not required)
- Modify: `app/ios/App/App.xcodeproj/project.pbxproj` (add the local package and product the way `LlamaKit` is referenced: `XCLocalSwiftPackageReference "MjpegKit"`, `XCSwiftPackageProductDependency`, Frameworks build file)

**Interfaces:**
- Produces:
  ```swift
  public final class MjpegParser {
      public init(boundary: String)                 // "ZoneMinderFrame"
      public var onFrame: ((Data) -> Void)?
      public func feed(_ data: Data)                // any chunk size, call repeatedly
  }
  ```
  `Package.swift`: `platforms: [.iOS(.v16), .macOS(.v13)]`, one library product `MjpegKit`, one test target.

- [ ] **Step 1: Write the failing tests**

```swift
func testCleanStreamEmitsThreeFrames()        // feed whole fixture at once -> 3 frames, exact bytes
func testArbitrarySplitsEmitSameFrames()      // feed 1, 7, 64 bytes at a time -> identical frames
func testNoContentLengthScansToNextBoundary() // 2 frames, byte-exact
func testTruncatedFinalFrameIsNotEmitted()    // 2 frames from a 3-frame stream cut mid-body
func testResyncsAfterShortContentLength()     // header claims 10 bytes, body is 100 -> next frame still correct
```

- [ ] **Step 2: Run, expect FAIL (no `MjpegParser`)**

Run: `cd app/ios/App/MjpegKit && swift test`

- [ ] **Step 3: Implement the state machine (`boundary`, `headers`, `body(remaining)`, `scanToBoundary`) in `MjpegParser.swift`**

The resync rule: after emitting a `Content-Length` body, the next bytes must start with `\r\n--boundary` (optionally after a blank line); if not, drop bytes until the boundary.

- [ ] **Step 4: Run, expect PASS. Then link the package: edit `project.pbxproj` and confirm `xcodebuild -project app/ios/App/App.xcodeproj -scheme App -sdk iphonesimulator build` compiles**

- [ ] **Step 5: Commit** `feat(ios): MJPEG multipart parser package with tests`

---

### Task 3: iOS reader, frame store, scheme handler, plugin

**Files:**
- Create: `app/ios/App/MjpegKit/Sources/MjpegKit/FrameStore.swift` (in the package so `swift test` covers it; the app imports `MjpegKit`), `app/ios/App/App/ZmStream/MjpegReader.swift`, `app/ios/App/App/ZmStream/ZmFrameSchemeHandler.swift`, `app/ios/App/App/ZmStream/ZmStreamPlugin.swift`
- Modify: `app/ios/App/App/AppDelegate.swift` (`ViewController`: register `ZmStreamPlugin()` in `capacitorDidLoad`; add `override func webViewConfiguration(for:)` that calls super then `setURLSchemeHandler(ZmFrameSchemeHandler(), forURLScheme: "zmframe")`)
- Modify: `app/ios/App/App.xcodeproj/project.pbxproj` (the three new app Swift files in Sources)
- Test: `app/ios/App/MjpegKit/Tests/MjpegKitTests/FrameStoreTests.swift`

**Interfaces:**
- Consumes: `MjpegParser` (Task 2); `SSLTrustPlugin.sslTrustEnabled`, `isCertTrustedForHTTP`, `isServerTrustValid` (`SSLTrustPlugin.swift`).
- Produces (in `MjpegKit`):
  ```swift
  public final class FrameStore {
      public static let shared: FrameStore
      public func register(_ id: String)
      public func publish(_ id: String, frame: Data)                 // overwrite slot, bump seq, complete a parked waiter
      public func markDead(_ id: String)                              // future requests -> nil, waiter completed with nil
      public func remove(_ id: String)                                // close
      /// Calls `completion` on the store's queue with the next undelivered frame,
      /// nil for dead/unknown/timeout. Replaces any earlier waiter for `id`,
      /// completing that one with nil.
      public func next(_ id: String, deadline: TimeInterval, completion: @escaping (Data?) -> Void) -> WaiterToken
      public func cancel(_ token: WaiterToken)                        // WebKit stop(task)
  }
  ```
  Plugin methods: `open(url, stallTimeoutMs) -> { streamId }` (integer counter as string), `close(streamId)`.

- [ ] **Step 1: Write the failing store tests**

```swift
func testNextReturnsPublishedFrameOnce()             // publish, next -> frame; next again parks; publish -> frame
func testUnknownStreamCompletesNil()                 // never registered -> nil at once
func testSecondWaiterReplacesFirstWithNil()          // two next() -> first nil, second gets the frame
func testRemoveCompletesParkedWaiterWithNil()
func testMarkDeadKeepsAnsweringNilUntilRemove()
func testDeadlineCompletesNil()                      // deadline 0.05s, no publish -> nil
```

- [ ] **Step 2: Run `swift test`, expect FAIL**

- [ ] **Step 3: Implement `FrameStore` (serial `DispatchQueue`, dictionary of slots, `DispatchWorkItem` for the deadline); run `swift test`, expect PASS**

- [ ] **Step 4: Implement `MjpegReader`: `URLSession` per reader with `URLSessionConfiguration.ephemeral`, `httpMaximumConnectionsPerHost = 64`, `httpCookieAcceptPolicy = .never`, `urlCache = nil`; `URLSessionDataDelegate.didReceive data` feeds the parser (boundary from the response `Content-Type`, default `ZoneMinderFrame`); non-200 or `didCompleteWithError` calls `markDead`; `cancel()` invalidates the session. Trust delegate: `sslTrustEnabled ? isCertTrustedForHTTP : isServerTrustValid`.**

Any `CAPLog`/`NSLog` line near the URL or error carries `// log-safe:` and logs only a status code or `error.code`.

- [ ] **Step 5: Implement `ZmFrameSchemeHandler`: parse `frames/<id>/<n>`; call `FrameStore.shared.next(id, deadline: stall)`; on `Data` respond `200` with the three headers then `didReceive(data)`, `didFinish()`; on nil respond `404` and `didFinish()`; all task calls on the main thread; keep `[ObjectIdentifier: WaiterToken]` so `stop(task)` cancels the waiter and never touches the task again.**

- [ ] **Step 6: Implement `ZmStreamPlugin` (`open` registers in the store, starts a reader, returns the id; `close` cancels the reader and removes the slot); register in `ViewController`; add the `webViewConfiguration(for:)` override**

- [ ] **Step 7: Build for simulator: `xcodebuild -project app/ios/App/App.xcodeproj -scheme App -sdk iphonesimulator build`, expect success. Run `npx vitest run src/tests/agents-contracts.test.ts` from `app/` (log-safe gate scans `.swift`).**

- [ ] **Step 8: Commit** `feat(ios): native MJPEG reader and zmframe scheme handler`

---

### Task 4: `useNativeMjpegFrames` hook

**Files:**
- Create: `app/src/hooks/useNativeMjpegFrames.ts`
- Test: `app/src/hooks/__tests__/useNativeMjpegFrames.test.tsx`

**Interfaces:**
- Consumes: `ZmStream`, `zmFrameUrl`, `zmFrameStreamId` (Task 1); `Platform.isNative` (`lib/platform.ts`); `ZM_INTEGRATION.nativeFrameStallMs`.
- Produces:
  ```ts
  export interface NativeMjpegFrames {
    /** zmframe URL for the current streamId and n, or '' before open resolves / when inactive. */
    frameSrc: string;
    /** Call from the <img> load handler with the element; ignored when its currentSrc names another stream. Returns true when accepted. */
    advance(img: HTMLImageElement | null): boolean;
    /** The current streamId or null. Changes whenever a new stream opens. */
    streamId: string | null;
  }
  export function useNativeMjpegFrames(streamUrl: string, active: boolean): NativeMjpegFrames;
  ```
  `active` is `Platform.isNative && viewMode === 'streaming' && enabled`; when false the hook does nothing and returns `''`.

- [ ] **Step 1: Write the failing tests** (mock `../../plugins/zm-stream` with `open`/`close` spies; mock `../../lib/platform` with `isNative: true`)

```ts
it('opens with the given url and stall ceiling, then exposes frames/<id>/0', ...)
  // expect(open).toHaveBeenCalledWith({ url, stallTimeoutMs: ZM_INTEGRATION.nativeFrameStallMs })
  // await waitFor(() => expect(result.current.frameSrc).toBe('zmframe://frames/s1/0'))
it('advance bumps n only for a load from the current stream', ...)
  // img.currentSrc = 'zmframe://frames/s1/0' -> true, frameSrc ends with /1
  // img.currentSrc = 'zmframe://frames/old/4' -> false, frameSrc unchanged
it('a new url closes the previous stream before exposing the new one', ...)
  // open resolves s1 then s2; expect close({ streamId: 's1' }) called; frameSrc names s2; streamId changed
it('closes on unmount', ...)
it('closes a stream whose open resolved after the url changed or the hook unmounted', ...)
  // deferred open promise; unmount; resolve -> close called with that id; frameSrc never showed it
it('does nothing when inactive', ...)
  // open not called, frameSrc ''
it('an empty url closes and clears', ...)
```

- [ ] **Step 2: Run `npx vitest run src/hooks/__tests__/useNativeMjpegFrames.test.tsx`, expect FAIL (module not found)**

- [ ] **Step 3: Implement the hook: `useEffect` on `[streamUrl, active]` with a `cancelled` flag and `const { ZmStream } = await import('../plugins/zm-stream')`; state `{ streamId, n }`; `advance` compares `zmFrameStreamId(img?.currentSrc ?? '')` with `streamId`**

- [ ] **Step 4: Run, expect PASS. Run `node scripts/proven-red.mjs main HEAD` from the repo root after committing to confirm red-by-assertion.**

- [ ] **Step 5: Commit** `feat(monitors): useNativeMjpegFrames drives the zmframe img loop`

---

### Task 5: Wire the hook into `useMonitorStream`

**Files:**
- Modify: `app/src/hooks/useMonitorStream.ts` (around `imageSrc` effect at the `setImageSrc(streamUrl)` block, `reportStreamLoad`, and `hasFrame`)
- Test: `app/src/hooks/__tests__/useMonitorStream.nativeframes.test.tsx`

**Interfaces:**
- Consumes: `useNativeMjpegFrames` (Task 4).
- Produces: unchanged `UseMonitorStreamReturn`. In frame mode `imageSrc` is the `zmframe://` URL and `reportStreamLoad` calls `advance(imgRef.current)`.

- [ ] **Step 1: Write the failing tests** (reuse the fixture setup from `useMonitorStream.test.ts`; mock `../../lib/platform` `isNative: true`; mock the plugin as in Task 4)

```ts
it('streaming on native binds imageSrc to a zmframe URL, never to nph-zms', ...)
it('snapshot on native still binds imageSrc to the nph-zms URL', ...)
it('hasFrame is false after open and true after reportStreamLoad for the current stream', ...)
it('hasFrame stays true across frame advances', ...)              // load, advance, load again -> never flickers false
it('a new connkey resets hasFrame until the new stream loads', ...) // regenerateConnection -> false, then load -> true
it('reportStreamLoad ignores a load whose src names the previous stream', ...)
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement: `const frames = useNativeMjpegFrames(streamUrl, Platform.isNative && effectiveViewMode === 'streaming' && enabled)`; `const frameMode = frames.streamId !== null || (Platform.isNative && effectiveViewMode === 'streaming')`; the `imageSrc` effect binds `frameMode ? frames.frameSrc : streamUrl`; `reportStreamLoad` in frame mode returns early when `advance(imgRef.current)` is false, otherwise proceeds and sets `loadedSrc` to the loaded element's `currentSrc`; an effect on `frames.streamId` sets `loadedSrc('')`; `hasFrame` in frame mode is `imageSrc !== '' && loadedSrc !== ''`**

Keep `useMonitorStream.ts` at or below its current LOC: no new comments longer than two lines.

- [ ] **Step 4: Run the new file and `npx vitest run src/hooks src/components/monitors`, expect PASS**

- [ ] **Step 5: Commit** `feat(monitors): stream through native frames on iOS and Android`

---

### Task 6: Android parser, frame store, and their tests

**Files:**
- Create: `app/android/app/src/main/java/com/zoneminder/zmNinjaNG/stream/MjpegParser.java`, `app/android/app/src/main/java/com/zoneminder/zmNinjaNG/stream/FrameStore.java`
- Test: `app/android/app/src/test/java/com/zoneminder/zmNinjaNG/stream/MjpegParserTest.java`, `app/android/app/src/test/java/com/zoneminder/zmNinjaNG/stream/FrameStoreTest.java`
- Fixtures: `app/android/app/src/test/resources/mjpeg/{clean-three.bin,no-content-length.bin,truncated.bin}` (same bytes as Task 2)

**Interfaces:**
- Produces:
  ```java
  public final class MjpegParser {
      public interface FrameListener { void onFrame(byte[] frame); }
      public MjpegParser(String boundary, FrameListener listener);
      public void feed(byte[] chunk, int offset, int length);
  }
  public final class FrameStore {
      public static FrameStore shared();
      public void register(String id);
      public void publish(String id, byte[] frame);
      public void markDead(String id);
      public void remove(String id);
      /** Blocks up to deadlineMs for the next undelivered frame; null for dead/unknown/timeout.
       *  A second concurrent waiter for the same id makes the first return null. */
      public byte[] awaitNext(String id, long deadlineMs) throws InterruptedException;
  }
  ```

- [ ] **Step 1: Write the failing tests: the five parser tests from Task 2 (same names, camelCase) and the six store tests from Task 3 (the blocking ones use a second thread and `CountDownLatch`)**

- [ ] **Step 2: Run `cd app/android && ./gradlew :app:testDebugUnitTest --tests 'com.zoneminder.zmNinjaNG.stream.*'`, expect FAIL (compile)**

- [ ] **Step 3: Implement both classes (`FrameStore` with `synchronized` and `wait/notifyAll`; a waiter generation counter per slot so a replaced waiter wakes and returns null)**

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit** `feat(android): MJPEG multipart parser and frame store with tests`

---

### Task 7: Android reader, WebViewClient, plugin, SSLTrust client merge

**Files:**
- Create: `app/android/app/src/main/java/com/zoneminder/zmNinjaNG/stream/MjpegReader.java`, `.../stream/ZmFrameWebViewClient.java`, `.../stream/ZmStreamPlugin.java`
- Modify: `app/android/app/src/main/java/com/zoneminder/zmNinjaNG/MainActivity.java` (`registerPlugin(ZmStreamPlugin.class)` before `super.onCreate`; `getBridge().setWebViewClient(new ZmFrameWebViewClient(getBridge(), false))` after it)
- Modify: `app/android/app/src/main/java/com/zoneminder/zmNinjaNG/SSLTrustPlugin.java` (`installWebViewSslHandler` constructs `new ZmFrameWebViewClient(getBridge(), true)`; `restoreWebViewSslHandler` constructs `new ZmFrameWebViewClient(getBridge(), false)`; the existing `onReceivedSslError` body moves into `ZmFrameWebViewClient` behind the flag)

**Interfaces:**
- Consumes: `MjpegParser`, `FrameStore` (Task 6).
- Produces:
  ```java
  public final class ZmFrameWebViewClient extends BridgeWebViewClient {
      public ZmFrameWebViewClient(Bridge bridge, boolean trustSelfSigned);
      @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request);
      @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error);
  }
  ```
  The response for `zmframe://frames/<id>/<n>` is `new WebResourceResponse("image/jpeg", null, 200, "OK", headers, new FrameInputStream(id, stallMs))`, where `FrameInputStream.read()` calls `FrameStore.awaitNext` on first read and throws `IOException` on null. Headers include `Cache-Control: no-store`. An unknown or dead id returns a `404` response with an empty stream instead of parking.

- [ ] **Step 1: Implement `MjpegReader`: a `Thread` per stream; `HttpURLConnection` (so `HttpsURLConnection` picks up `SSLTrustPlugin`'s factory); `setUseCaches(false)`, no cookies; `getResponseCode() != 200` -> `markDead`; read the input stream in 16 KB chunks into the parser; `IOException`/EOF -> `markDead`; `close()` sets a flag and `disconnect()`s.**

Any `Log.*` near the URL or the exception carries `// log-safe:` and logs only the response code or the exception class name.

- [ ] **Step 2: Implement `ZmFrameWebViewClient` and `ZmStreamPlugin` (`@CapacitorPlugin(name = "ZmStream")`, `open`/`close` as `@PluginMethod`); wire `MainActivity` and `SSLTrustPlugin`**

- [ ] **Step 3: Build: `cd app/android && ./gradlew :app:assembleDebug`, expect success. From `app/`: `npx vitest run src/tests/agents-contracts.test.ts` (log-safe gate scans `.java`).**

- [ ] **Step 4: Commit** `feat(android): native MJPEG reader and zmframe interception`

---

### Task 8: Streaming by default where the host lifts the limit

**Files:**
- Modify: `app/src/lib/monitor/view-mode-recommendation.ts`
- Modify: `app/src/services/profile-bootstrap.ts:284-285`, `app/src/components/settings/LiveStreamingSection.tsx:34-36,72`
- Modify: `app/src/locales/{de,en,es,fa,fr,it,ru,zh}/translation.json` (new key `settings.view_mode_reason_no_host_limit`, beside the three existing reason keys)
- Modify: `docs/user-guide/settings.md` (the "A new profile picks its Streaming Mode" list gains the host case; done here, not in Task 9, so the behavior and its doc land together)
- Test: `app/src/lib/monitor/__tests__/view-mode-recommendation.test.ts` (extend the existing file if there is one, else create)

**Interfaces:**
- Produces:
  ```ts
  export type ViewModeReason = 'few-monitors' | 'multi-port' | 'no-host-limit' | 'many-monitors';
  export function recommendViewMode(
    monitorCount: number | null,
    minStreamingPort: number | undefined,
    hostLiftsLimit: boolean,          // Platform.isNative || Platform.isElectron at both call sites
  ): ViewModeRecommendation;
  ```
  Order of checks: few monitors, multi-port, host lifts limit, else many monitors. English copy for the new reason: "Recommended: Streaming. This app reads live feeds natively, so the limit on simultaneous live feeds does not apply." Other locales translate it; keep each under the 320px rule the existing reason lines meet.

- [ ] **Step 1: Write the failing tests**

```ts
it('recommends streaming with reason no-host-limit when the host lifts the limit and the count is large', () => {
  expect(recommendViewMode(40, undefined, true)).toEqual({ mode: 'streaming', reason: 'no-host-limit' });
});
it('still recommends snapshot on a plain web host past the limit', () => {
  expect(recommendViewMode(40, undefined, false)).toEqual({ mode: 'snapshot', reason: 'many-monitors' });
});
it('multi-port wins over the host reason, few monitors wins over both', () => {
  expect(recommendViewMode(40, 30000, true).reason).toBe('multi-port');
  expect(recommendViewMode(3, undefined, true).reason).toBe('few-monitors');
});
it('an unknown count on a lifting host recommends streaming', () => {
  expect(recommendViewMode(null, undefined, true).mode).toBe('streaming');
});
```

- [ ] **Step 2: Run `npx vitest run src/lib/monitor`, expect FAIL (arity / reason type)**

- [ ] **Step 3: Implement; pass `Platform.isNative || Platform.isElectron` from both call sites; add the reason key to the Settings hint map and all eight locales; update the settings.md list**

- [ ] **Step 4: Run `npx vitest run src/lib/monitor src/components/settings src/locales src/pages/__tests__/Settings.test.tsx`, expect PASS**

- [ ] **Step 5: Commit** `feat(settings): recommend Streaming where the app reads feeds natively`

---

### Task 9: Docs and playbook facts

**Files:**
- Modify: `docs/user-guide/settings.md` (the "Connection limits by platform" table and the note under it: Android and iOS rows read "Read natively by the app, not through the webview" / "No"; the note keeps only the web-browser case)
- Modify: `docs/user-guide/montage.md` (the paragraph at "On phones, tablets, and the web app" and the one after it: the limit now applies to the web app only)
- Modify: `docs/developer-guide/call-flows.rst` Flow 2 (one paragraph and one sequence-diagram hop: on iOS/Android `useMonitorStream` calls `useNativeMjpegFrames`, which opens `ZmStream`, and the `<img>` loads `zmframe://` frames)
- Modify: `agents/project/domain-context.md` (the six-connections bullet: add that on iOS and Android the native frame path lifts it; the bound remains on the web build)
- Modify: `agents/project/native.md` (three facts: WKWebView does not render `multipart/x-mixed-replace` from a scheme handler or loopback server, single JPEGs do (#156); a `WKURLSchemeTask` must not be touched after `stop`; `URLSessionConfiguration.httpMaximumConnectionsPerHost` defaults to 6 on iOS)

- [ ] **Step 1: Make the edits in the slop-mop voice; no marketing language**

- [ ] **Step 2: `sphinx-build -W -b html docs /tmp/zmninja-docs-out` from the repo root, expect no warnings; `npx vitest run src/tests/docs-screenshots.test.ts` from `app/`**

- [ ] **Step 3: Commit** `docs: native MJPEG frames lift the mobile stream limit`

---

### Task 10: Gates, device checklist, PR

- [ ] **Step 1: `npm run gates` from `app/`, all green; `node scripts/proven-red.mjs main HEAD` from the repo root, every changed test red by assertion**

- [ ] **Step 2: Open the PR against `main` with `## Spec` linking the design and `## Acceptance` quoting the design's Goals; body in the slop-mop voice; do not use a closing keyword for #156**

- [ ] **Step 3: Hand the maintainer this device checklist (they run it, agents never do):**

iOS first. If iOS fails the frame-rate check, stop and report before touching Android.

1. Streaming montage, 24 tiles, http server: all 24 paint and move.
2. Same against an https server with a self-signed cert, trust enabled: all paint. Trust disabled: tiles show no-video, not a stale frame.
3. Frame rate of a 6-tile montage is no worse than the release build's.
4. Background the app for a minute and resume: every tile recovers.
5. Leave the montage; on the server `ps aux | grep zms` shows no process for those connkeys within a few seconds.
6. Single-monitor page streams; the hover preview still streams.
7. Repeat 1 to 6 on a Pixel.
