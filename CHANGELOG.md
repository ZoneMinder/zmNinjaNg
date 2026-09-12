# Changelog

## [zmNinjaNg-2.4.0](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNg-2.4.0) (2026-09-12)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNg-2.3.0...zmNinjaNg-2.4.0)

**Implemented enhancements:**

- Choose which screen the app opens on [\#488](https://github.com/ZoneMinder/zmNinjaNg/issues/488)

**Fixed bugs:**

- monitor zoom functionality \(limited at 400%\) [\#478](https://github.com/ZoneMinder/zmNinjaNg/issues/478)
- Once set in full screen mode, monitor stays in full screen mode until unset in monitor prefs [\#476](https://github.com/ZoneMinder/zmNinjaNg/issues/476)

**Closed issues:**

- Russian translation contribution [\#484](https://github.com/ZoneMinder/zmNinjaNg/issues/484)
- Can full screen mode get some actions alongside the Exit button, like Recent Events, etc? [\#477](https://github.com/ZoneMinder/zmNinjaNg/issues/477)

## [zmNinjaNg-2.3.0](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNg-2.3.0) (2026-09-05)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNg-2.2.1...zmNinjaNg-2.3.0)

**Implemented enhancements:**

- Add Italian \(it\) interface language [\#475](https://github.com/ZoneMinder/zmNinjaNg/issues/475)
- Remember mute and fullscreen for live monitors and event playback; auto-fullscreen on rotation [\#463](https://github.com/ZoneMinder/zmNinjaNg/issues/463)
- Feature request - go directly to fullscreen from a montage view for a selected camera \(moniotr\) [\#462](https://github.com/ZoneMinder/zmNinjaNg/issues/462)

**Fixed bugs:**

- Montage view is still frozen in 2.2.1 when ZM servers does not use authentication [\#461](https://github.com/ZoneMinder/zmNinjaNg/issues/461)
- proven-red diffs from the base branch tip, so a branch that lags main fails on tests it never touched [\#455](https://github.com/ZoneMinder/zmNinjaNg/issues/455)
- Android: app crashes on open in 2.2.1 — R8 optimization deletes Capacitor's PluginHandle.pluginAnnotation [\#452](https://github.com/ZoneMinder/zmNinjaNg/issues/452)
- Assistant misattributes events to a place the user named but no monitor covers [\#427](https://github.com/ZoneMinder/zmNinjaNg/issues/427)
- Direct mode badge says "Poller not running" while the poller is running [\#425](https://github.com/ZoneMinder/zmNinjaNg/issues/425)

**Closed issues:**

- Replace the unlabelled capture badges with a monitor info popover; surface Decoding [\#467](https://github.com/ZoneMinder/zmNinjaNg/issues/467)
- Remove Dependabot: the security channel costs more attention than it returns [\#459](https://github.com/ZoneMinder/zmNinjaNg/issues/459)
- Time vocabulary: calendar month field - 'this month' ran as a rolling 30 days on Gemini Nano [\#449](https://github.com/ZoneMinder/zmNinjaNg/issues/449)
- Assistant: explicit continuation judgment with structured context and a UI badge; place-group comparisons [\#446](https://github.com/ZoneMinder/zmNinjaNg/issues/446)
- Assistant: whole-question time interrogation - express every period as structured windows, delete the copy step [\#444](https://github.com/ZoneMinder/zmNinjaNg/issues/444)
- parseFields drops the week and weekday-range fields; the time eval bypasses the production parser [\#442](https://github.com/ZoneMinder/zmNinjaNg/issues/442)
- Assistant: status questions default to the system; follow-ups parse with context; chat lane cannot state or promise system facts [\#440](https://github.com/ZoneMinder/zmNinjaNg/issues/440)
- Assistant: interrogation redesign - structured self-explanation fields instead of output rules [\#438](https://github.com/ZoneMinder/zmNinjaNg/issues/438)
- Planned fan-out needs a code coalescer; objects slot creeps to the whole vocabulary; SHOW parser chokes on brackets [\#436](https://github.com/ZoneMinder/zmNinjaNg/issues/436)
- Assistant time track: month-word scan guard, weekday-range windows, fold phrase extraction into the parse [\#434](https://github.com/ZoneMinder/zmNinjaNg/issues/434)
- Assistant: parse the question into structured slots first, execute the plan in code, keep the loop as fallback [\#432](https://github.com/ZoneMinder/zmNinjaNg/issues/432)
- Monitor stage denies an existing camera on paraphrase, and a transient interpreter failure is cached all day [\#430](https://github.com/ZoneMinder/zmNinjaNg/issues/430)

## [zmNinjaNg-2.2.1](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNg-2.2.1) (2026-08-31)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNg-2.2.0...zmNinjaNg-2.2.1)

**Fixed bugs:**

- App will not open on IOS 16.1.2 [\#421](https://github.com/ZoneMinder/zmNinjaNg/issues/421)
- Montage view frozen when cameras are set up in OnDemand+Keyframes \(without full encoding\) [\#383](https://github.com/ZoneMinder/zmNinjaNg/issues/383)
- Zoom should reset back to 100% when switching monitors [\#382](https://github.com/ZoneMinder/zmNinjaNg/issues/382)
- Zone overlay draws percent coords into the pixel viewBox, so zones shrink into the corner [\#378](https://github.com/ZoneMinder/zmNinjaNg/issues/378)
- PTZ pad shows tilt arrows on pan-only drivers \(CanPan/CanTilt ignored\) [\#373](https://github.com/ZoneMinder/zmNinjaNg/issues/373)
- \[Bug\] Montage fullscreen: videos letterboxed/shifted because tile heights include a header that does not render in flow [\#359](https://github.com/ZoneMinder/zmNinjaNg/issues/359)
- \[Bug\] Compact mode: gap between fullscreen toolbar and content \(hardcoded 2rem clearance vs compact h-8\) [\#358](https://github.com/ZoneMinder/zmNinjaNg/issues/358)
- \[Bug\] Tablet/desktop layout: scrolled content renders behind the status bar \(safe-area padding scrolls with content\) [\#357](https://github.com/ZoneMinder/zmNinjaNg/issues/357)
- \[Bug\] Android: status bar icons unreadable when app theme differs from system theme \(SystemBars style never set\) [\#356](https://github.com/ZoneMinder/zmNinjaNg/issues/356)
- \[Bug\] Android 15/16: app chrome renders under status bar — `--sai-*` never resolves on Android \(Capacitor 8 injected vars not consumed\) [\#355](https://github.com/ZoneMinder/zmNinjaNg/issues/355)
- Local Network permission needed in Android 17, help the user allow it [\#350](https://github.com/ZoneMinder/zmNinjaNg/issues/350)

**Refactoring:**

- Fable codebase review, 2026-08-29 [\#392](https://github.com/ZoneMinder/zmNinjaNg/issues/392)
- Fable review, pillar 13 \(instruction system overhead\), 2026-08-29 [\#391](https://github.com/ZoneMinder/zmNinjaNg/issues/391)
- Fable codebase review, 2026-08-06 [\#348](https://github.com/ZoneMinder/zmNinjaNg/issues/348)

**Closed issues:**

- Pick the initial Streaming Mode from monitor count and multi-port, and say why [\#385](https://github.com/ZoneMinder/zmNinjaNg/issues/385)
- Difficult to scroll down viewing monitor or events, related to screen resolution [\#365](https://github.com/ZoneMinder/zmNinjaNg/issues/365)
- Dead code: useImageError hook has no callers [\#353](https://github.com/ZoneMinder/zmNinjaNg/issues/353)
- Live monitor tiles show a broken or garbled thumbnail after a long background on mobile [\#352](https://github.com/ZoneMinder/zmNinjaNg/issues/352)

## [zmNinjaNg-2.2.0](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNg-2.2.0) (2026-08-08)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNg-2.1.0...zmNinjaNg-2.2.0)

**Implemented enhancements:**

- Allow combining one or more profiles together [\#341](https://github.com/ZoneMinder/zmNinjaNg/issues/341)
- All Profiles mode: virtual profile aggregating every server [\#337](https://github.com/ZoneMinder/zmNinjaNg/issues/337)
- Icon-only buttons have no explanation on touch devices [\#332](https://github.com/ZoneMinder/zmNinjaNg/issues/332)
- Toggle analysis frames on live streams [\#329](https://github.com/ZoneMinder/zmNinjaNg/issues/329)
- Force ZMS playback per monitor as an option \(was: Don't show 'Video not natively playable' toast on every event\) [\#315](https://github.com/ZoneMinder/zmNinjaNg/issues/315)
- feat: Live Activity view to only show monitors with active motion [\#313](https://github.com/ZoneMinder/zmNinjaNg/issues/313)

**Fixed bugs:**

- Permissions: gate the UI on the ZoneMinder account's actual rights [\#344](https://github.com/ZoneMinder/zmNinjaNg/issues/344)
- Hide or Option to hide ZMS Playback text when playing events [\#340](https://github.com/ZoneMinder/zmNinjaNg/issues/340)
- Watching a monitor yields me a lot of errors on my proxy [\#331](https://github.com/ZoneMinder/zmNinjaNg/issues/331)
- Old/deleted monitors show up in Hide Monitors [\#324](https://github.com/ZoneMinder/zmNinjaNg/issues/324)
- Old/deleted monitors show up in Dashboard [\#323](https://github.com/ZoneMinder/zmNinjaNg/issues/323)
- Can't scroll in Edit Server profile popup screen [\#322](https://github.com/ZoneMinder/zmNinjaNg/issues/322)
- Difficult to scroll when editing order of monitors on Montage on touchscreen [\#321](https://github.com/ZoneMinder/zmNinjaNg/issues/321)

**Refactoring:**

- e2e: tolerated-failure set needs an expiry \(shared live server flakiness\) [\#342](https://github.com/ZoneMinder/zmNinjaNg/issues/342)

**Closed issues:**

- Profiles: disable toggle \(listed but unselectable; All mode ignores\) [\#343](https://github.com/ZoneMinder/zmNinjaNg/issues/343)
- Android: document local network permission, declare ACCESS\_LOCAL\_NETWORK ahead of targetSdk 37 [\#333](https://github.com/ZoneMinder/zmNinjaNg/issues/333)
- Improve discoverability: landing page metadata and repo SEO [\#317](https://github.com/ZoneMinder/zmNinjaNg/issues/317)
- Can Event Frames be moved under the video? [\#314](https://github.com/ZoneMinder/zmNinjaNg/issues/314)

## [zmNinjaNg-2.1.0](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNg-2.1.0) (2026-07-30)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNg-2.0.0...zmNinjaNg-2.1.0)

**Implemented enhancements:**

- Feature Request: ability to view objdetect,alarm,snapshot frames as legacy zmNinja [\#272](https://github.com/ZoneMinder/zmNinjaNg/issues/272)

**Fixed bugs:**

- WebSocket disconnects from zmeventserver after app is backgrounded and resumed [\#274](https://github.com/ZoneMinder/zmNinjaNg/issues/274)

**Refactoring:**

- Restructure AGENTS.md: portable core, architecture contracts, self-improvement protocol [\#283](https://github.com/ZoneMinder/zmNinjaNg/issues/283)

**Closed issues:**

- Connection failures show raw platform error text with formatting artifacts [\#312](https://github.com/ZoneMinder/zmNinjaNg/issues/312)
- Assistant: backend labels name implementation details instead of what the user is choosing [\#311](https://github.com/ZoneMinder/zmNinjaNg/issues/311)
- Assistant: "N days ago" is invisible to the timeframe scanner, so the turn defaults to today [\#310](https://github.com/ZoneMinder/zmNinjaNg/issues/310)
- Assistant: models without a tool template 400 on every data question over Ollama [\#309](https://github.com/ZoneMinder/zmNinjaNg/issues/309)
- Extra checks to remove credentials in logs including those that come from ZM [\#307](https://github.com/ZoneMinder/zmNinjaNg/issues/307)
- Remap stale AGENTS.md rule-number citations in code comments [\#285](https://github.com/ZoneMinder/zmNinjaNg/issues/285)
- code quality hardening from the 12-pillar review \(React correctness rules, coverage scoping, cycles\) [\#281](https://github.com/ZoneMinder/zmNinjaNg/issues/281)
- feat\(assistant\): native on-device LLM backend for iOS and Android \(llama.cpp bridge\) [\#270](https://github.com/ZoneMinder/zmNinjaNg/issues/270)
- Spam moderation false positive: redacts maintainer links quoted by first-time contributors [\#268](https://github.com/ZoneMinder/zmNinjaNg/issues/268)

## [zmNinjaNg-2.0.0](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNg-2.0.0) (2026-07-22)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNg-1.4.0...zmNinjaNg-2.0.0)

**Implemented enhancements:**

- feat\(assistant\): intro suggested-question chip + Ollama connection status dot [\#251](https://github.com/ZoneMinder/zmNinjaNg/issues/251)
- Feature Request - Continuous event stream [\#250](https://github.com/ZoneMinder/zmNinjaNg/issues/250)
- feat: in-app assistant with pluggable LLM backend \(remote or on-device\) [\#246](https://github.com/ZoneMinder/zmNinjaNg/issues/246)

**Fixed bugs:**

- fix: prevent ZMS event player from looping after continuous advance [\#252](https://github.com/ZoneMinder/zmNinjaNg/issues/252)
- API validation fails for field V4LMultiBuffer on ZoneMinder 1.38.3 [\#247](https://github.com/ZoneMinder/zmNinjaNg/issues/247)
- Android release AAB ships without native debug symbols \(NDK not on CI runner\) [\#244](https://github.com/ZoneMinder/zmNinjaNg/issues/244)

**Closed issues:**

- Assistant: structured time windows — model interprets human time, app does arithmetic, no phrase grammar [\#265](https://github.com/ZoneMinder/zmNinjaNg/issues/265)
- Assistant: raw \<tool\_call\> XML leaks into chat; busiest-hour questions unanswerable by either tool [\#264](https://github.com/ZoneMinder/zmNinjaNg/issues/264)
- Assistant: resolveWhen rejects common human time phrases; answer times ignore the app time format [\#262](https://github.com/ZoneMinder/zmNinjaNg/issues/262)
- Assistant: first Ollama question pays ~36s for cold model load and one thinking turn [\#261](https://github.com/ZoneMinder/zmNinjaNg/issues/261)
- Assistant: erratic model output — constrained decoding, brittle guardrails, prompt verbosity, validation bugs [\#259](https://github.com/ZoneMinder/zmNinjaNg/issues/259)
- fix: persist native MNN download before CFNetwork cleanup [\#255](https://github.com/ZoneMinder/zmNinjaNg/issues/255)

## [zmNinjaNg-1.4.0](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNg-1.4.0) (2026-07-15)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNg-1.3.0...zmNinjaNg-1.4.0)

**Implemented enhancements:**

- feat: monitor card badge should count events since you last looked, not the last 7 days [\#239](https://github.com/ZoneMinder/zmNinjaNg/issues/239)
- docs: two missing call-flow traces \(Profiles edit/delete, PTZ\) [\#229](https://github.com/ZoneMinder/zmNinjaNg/issues/229)
- docs: call-flows drift fixes and a mutation write-path flow [\#227](https://github.com/ZoneMinder/zmNinjaNg/issues/227)
- docs: restructure catalog chapters and dissolve 08-common-pitfalls [\#226](https://github.com/ZoneMinder/zmNinjaNg/issues/226)
- docs: teach the React and React Query concepts the guide assumes [\#225](https://github.com/ZoneMinder/zmNinjaNg/issues/225)
- docs: encode the developer-guide teaching philosophy in AGENTS.md [\#224](https://github.com/ZoneMinder/zmNinjaNg/issues/224)
- Ability to see Relative time in Events view [\#210](https://github.com/ZoneMinder/zmNinjaNg/issues/210)

**Fixed bugs:**

- fix: rename misleading "Finishing setup" bootstrap dialog [\#243](https://github.com/ZoneMinder/zmNinjaNg/issues/243)
- App sends JavaScript timestamp instead of event ID in image requests [\#242](https://github.com/ZoneMinder/zmNinjaNg/issues/242)
- fix: TV mode disables keyboard shortcuts even on desktop [\#241](https://github.com/ZoneMinder/zmNinjaNg/issues/241)
- test: PTZ e2e never sees the control request \(proxy URL-encodes the match string\) [\#238](https://github.com/ZoneMinder/zmNinjaNg/issues/238)
- test: two e2e scenarios are flaky under parallel workers [\#237](https://github.com/ZoneMinder/zmNinjaNg/issues/237)
- chore: tsc -b never typechecks app/tests or scripts [\#236](https://github.com/ZoneMinder/zmNinjaNg/issues/236)
- test: ptz.steps.ts asserts data-testid ptz-controls which no component renders [\#234](https://github.com/ZoneMinder/zmNinjaNg/issues/234)
- docs: AGENTS.md testing section describes e2e infrastructure that does not exist [\#233](https://github.com/ZoneMinder/zmNinjaNg/issues/233)
- docs: fix fabricated and stale code examples in the developer guide [\#223](https://github.com/ZoneMinder/zmNinjaNg/issues/223)
- fix: montage renders wrong column count for non-divisors of 12 \(5 shows 6, 9 shows 12\) [\#220](https://github.com/ZoneMinder/zmNinjaNg/issues/220)
- fix\(ios\): SSLTrustPlugin fails to compile, SecCertificateCopyValues is macOS-only [\#219](https://github.com/ZoneMinder/zmNinjaNg/issues/219)
- Viewing an event, then using a back gesture or back button at top of view resets to very top of events [\#197](https://github.com/ZoneMinder/zmNinjaNg/issues/197)

**Refactoring:**

- chore: small code findings from the docs audit [\#232](https://github.com/ZoneMinder/zmNinjaNg/issues/232)
- chore: pages/States.tsx and pages/EventMontage.tsx are unrouted dead code [\#231](https://github.com/ZoneMinder/zmNinjaNg/issues/231)
- refactor: migrate three remaining whole-store Zustand subscriptions to selectors [\#230](https://github.com/ZoneMinder/zmNinjaNg/issues/230)
- chore: remove dead go2rtc code \(webrtcFallbackEnabled, getGo2RTCStreamUrl\) [\#228](https://github.com/ZoneMinder/zmNinjaNg/issues/228)

**Closed issues:**

- chore: auto-moderate first-time-contributor comments with download links [\#222](https://github.com/ZoneMinder/zmNinjaNg/issues/222)
- feat: per-profile toggle for WebRTC STUN servers \(go2rtc\) [\#221](https://github.com/ZoneMinder/zmNinjaNg/issues/221)
- Codebase review from Fable 5 \(10-pillar assessment\) [\#217](https://github.com/ZoneMinder/zmNinjaNg/issues/217)
- chore: suggest release version bump from closed issues, reusing the dev-notice Claude call [\#214](https://github.com/ZoneMinder/zmNinjaNg/issues/214)

## [zmNinjaNg-1.3.0](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNg-1.3.0) (2026-07-03)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNg-1.2.0...zmNinjaNg-1.3.0)

**Implemented enhancements:**

- feat: let users delete developer notices \(per-device\), with clear-all and reset [\#215](https://github.com/ZoneMinder/zmNinjaNg/issues/215)
- feat: Recent events list on monitor detail view [\#213](https://github.com/ZoneMinder/zmNinjaNg/issues/213)

**Fixed bugs:**

- Scrubbing in an event view works inconsistently [\#196](https://github.com/ZoneMinder/zmNinjaNg/issues/196)

## [zmNinjaNg-1.2.0](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNg-1.2.0) (2026-07-02)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNg-1.1.15...zmNinjaNg-1.2.0)

**Implemented enhancements:**

- feat: dev-only preview of developer notices \(local file + skip version gate\) [\#212](https://github.com/ZoneMinder/zmNinjaNg/issues/212)
- feat: auto-draft a developer notice for minor/major releases in make\_release.sh [\#211](https://github.com/ZoneMinder/zmNinjaNg/issues/211)
- All zones on a monitor are shown the same, even inactive ones [\#208](https://github.com/ZoneMinder/zmNinjaNg/issues/208)
- feat: Global command palette for quick navigation \(/, sidebar, mobile\) [\#207](https://github.com/ZoneMinder/zmNinjaNg/issues/207)
- Support for keyboard controls to navigate through screens [\#200](https://github.com/ZoneMinder/zmNinjaNg/issues/200)
- Language and Menu button placements seem intuitive [\#199](https://github.com/ZoneMinder/zmNinjaNg/issues/199)
- Window does not remember previous placement or size on launching [\#195](https://github.com/ZoneMinder/zmNinjaNg/issues/195)

**Fixed bugs:**

- Filtering for Favorites in Events view doesn't show any events past the "Load More" line [\#205](https://github.com/ZoneMinder/zmNinjaNg/issues/205)
- Changing monitor while viewing live stream does not always change to the new stream [\#201](https://github.com/ZoneMinder/zmNinjaNg/issues/201)
- Clearing event time filtering clears filter for monitor being viewed, not just time filtering [\#194](https://github.com/ZoneMinder/zmNinjaNg/issues/194)
- Event filtering does't work or is inconsistent [\#193](https://github.com/ZoneMinder/zmNinjaNg/issues/193)
- Back gesture on Android just goes to previous screen, never exits [\#192](https://github.com/ZoneMinder/zmNinjaNg/issues/192)
- Monitor view panning could use some improvements [\#191](https://github.com/ZoneMinder/zmNinjaNg/issues/191)
- fix: remove READ\_MEDIA\_IMAGES/READ\_MEDIA\_VIDEO permissions rejected by Google Play [\#190](https://github.com/ZoneMinder/zmNinjaNg/issues/190)

**Closed issues:**

- Filter option for viewing only Archived events, possibly ability to Mark Archived [\#209](https://github.com/ZoneMinder/zmNinjaNg/issues/209)
- \[Bug / Regression\] Monitor filtering no longer works in Monitors view [\#204](https://github.com/ZoneMinder/zmNinjaNg/issues/204)
- Enlarge view of monitor when zooming in, like zminja did in the past [\#198](https://github.com/ZoneMinder/zmNinjaNg/issues/198)

## [zmNinjaNg-1.1.15](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNg-1.1.15) (2026-06-17)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNg-1.1.14...zmNinjaNg-1.1.15)

**Implemented enhancements:**

- feat: auto-reconnect MJPEG stream on error with backoff and connkey release [\#187](https://github.com/ZoneMinder/zmNinjaNg/issues/187)
- refactor: code review cleanups \(reuse, dead code, multi-profile cache key, rule-25/23\) [\#186](https://github.com/ZoneMinder/zmNinjaNg/issues/186)
- refactor: code quality pass from architecture review \(DRY, SOLID, clarity\) [\#184](https://github.com/ZoneMinder/zmNinjaNg/issues/184)
- chore: delete or wire lib/tv-dpad-nav.ts \(dead code superseded by tv-spatial-nav\) [\#183](https://github.com/ZoneMinder/zmNinjaNg/issues/183)
- feat: Add per-profile 'Force disable multiport streaming' advanced toggle [\#179](https://github.com/ZoneMinder/zmNinjaNg/issues/179)

**Fixed bugs:**

- fix\(stream\): orphaned nph-zms on profile switch \(CMD\_QUIT races SSL-trust flip\) [\#188](https://github.com/ZoneMinder/zmNinjaNg/issues/188)
- fix: stability fixes from architecture review \(streams, error handling, resource bounds\) [\#182](https://github.com/ZoneMinder/zmNinjaNg/issues/182)
- fix\(http\): API requests can hang forever; add configurable request timeout + CMD\_QUIT timeout [\#181](https://github.com/ZoneMinder/zmNinjaNg/issues/181)
- fix\(monitor-detail\): back button returns to previous monitor instead of origin after prev/next [\#180](https://github.com/ZoneMinder/zmNinjaNg/issues/180)
- fix\(monitors\): leaving montage leaks live streams, starving the single-monitor view [\#178](https://github.com/ZoneMinder/zmNinjaNg/issues/178)

**Refactoring:**

- security review comparison of Faros \(partial\) and Opus [\#185](https://github.com/ZoneMinder/zmNinjaNg/issues/185)
- track: migrate iOS Firebase SDK off CocoaPods before Oct 2026 [\#134](https://github.com/ZoneMinder/zmNinjaNg/issues/134)

## [zmNinjaNg-1.1.14](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNg-1.1.14) (2026-06-04)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNg-1.1.13...zmNinjaNg-1.1.14)

**Implemented enhancements:**

- feat: include build number in desktop artifact filenames; fix CI shallow clone [\#177](https://github.com/ZoneMinder/zmNinjaNg/issues/177)
- feat: use git commit count for Android versionCode and iOS CFBundleVersion [\#176](https://github.com/ZoneMinder/zmNinjaNg/issues/176)
- feat: show build number next to app version in sidebar [\#175](https://github.com/ZoneMinder/zmNinjaNg/issues/175)
- feat: group-scoped montage arrangements [\#174](https://github.com/ZoneMinder/zmNinjaNg/issues/174)
- feat: in-app Developer Notice system [\#172](https://github.com/ZoneMinder/zmNinjaNg/issues/172)
- Allow event archiving [\#171](https://github.com/ZoneMinder/zmNinjaNg/issues/171)
- feat\(electron\): raise Chromium per-host connection limit to 32 for live streaming [\#169](https://github.com/ZoneMinder/zmNinjaNg/issues/169)
- feat\(montage\): add kebab menu with refresh and per-monitor visibility [\#168](https://github.com/ZoneMinder/zmNinjaNg/issues/168)
- ci: normalize Electron release artifact names to the 1.1.13 convention [\#167](https://github.com/ZoneMinder/zmNinjaNg/issues/167)
- ci: build Electron only \(disable Tauri steps\); flip naming \(tauri \_t, electron plain\) [\#165](https://github.com/ZoneMinder/zmNinjaNg/issues/165)
- feat: montage live streaming — MJPEG-first, longer MSE timeout, staggered starts [\#161](https://github.com/ZoneMinder/zmNinjaNg/issues/161)
- feat: Per-profile monitor exclusion [\#159](https://github.com/ZoneMinder/zmNinjaNg/issues/159)
- feat: native MJPEG transport for iOS and Android live views [\#156](https://github.com/ZoneMinder/zmNinjaNg/issues/156)

**Fixed bugs:**

- fix\(android\): build.gradle file\(''\) fails when keystore env is unset \(debug builds\) [\#166](https://github.com/ZoneMinder/zmNinjaNg/issues/166)
- fix: self-signed cert toggle missing from the Edit Profile dialog [\#164](https://github.com/ZoneMinder/zmNinjaNg/issues/164)
- fix: Electron trusts all SSL certs unconditionally; gate on profile allowSelfSignedCerts [\#163](https://github.com/ZoneMinder/zmNinjaNg/issues/163)
- fix: frozen go2rtc/MSE stream not detected after first frame [\#162](https://github.com/ZoneMinder/zmNinjaNg/issues/162)
- fix: event video uses mode=mpeg which Electron/Chromium can't decode [\#160](https://github.com/ZoneMinder/zmNinjaNg/issues/160)
- Refresh Interval setting is not working [\#158](https://github.com/ZoneMinder/zmNinjaNg/issues/158)
- fix: Tauri streaming-mode monitors leak WebKitGTK sockets, die after ~8 opens [\#155](https://github.com/ZoneMinder/zmNinjaNg/issues/155)
- fix: no-auth ZoneMinder servers show no feed and loop token-refresh warnings [\#153](https://github.com/ZoneMinder/zmNinjaNg/issues/153)
- fix: long-press zoom/expand not working on Android [\#152](https://github.com/ZoneMinder/zmNinjaNg/issues/152)
- AppImage white window [\#151](https://github.com/ZoneMinder/zmNinjaNg/issues/151)
- Linux: montage video eventually stops displaying; WebKitNetworkProcess spins CPU with stale ZoneMinder nph-zms connections [\#150](https://github.com/ZoneMinder/zmNinjaNg/issues/150)

**Refactoring:**

- Cleanup: remove dead Tauri code after Electron migration [\#173](https://github.com/ZoneMinder/zmNinjaNg/issues/173)

**Closed issues:**

- zmNinjaNG app doesn't show live preview in any way [\#170](https://github.com/ZoneMinder/zmNinjaNg/issues/170)
- Montage don't prevent from sleep or screensaver [\#157](https://github.com/ZoneMinder/zmNinjaNg/issues/157)

## [zmNinjaNg-1.1.13](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNg-1.1.13) (2026-05-16)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNg-1.1.12...zmNinjaNg-1.1.13)

**Implemented enhancements:**

- feat\(settings\): hover preview playback speed [\#149](https://github.com/ZoneMinder/zmNinjaNg/issues/149)
- feat: token freshness gate \(30 min leeway, no stale tokens to server\) [\#145](https://github.com/ZoneMinder/zmNinjaNg/issues/145)

**Fixed bugs:**

- fix: event playback stability — re-init churn, navigation remounts, cross-platform divergence [\#148](https://github.com/ZoneMinder/zmNinjaNg/issues/148)
- fix\(ios\): video controls hidden after rotation and unreachable in landscape fullscreen [\#147](https://github.com/ZoneMinder/zmNinjaNg/issues/147)
- fix\(android\): toolbar buttons unreachable in landscape under status bar [\#144](https://github.com/ZoneMinder/zmNinjaNg/issues/144)
- fix\(logs\): linux Tauri log file dir not created; reveal+truncate fail [\#143](https://github.com/ZoneMinder/zmNinjaNg/issues/143)
- fix\(ci\): linux-arm64 release fails — missing xdg-open on runner [\#142](https://github.com/ZoneMinder/zmNinjaNg/issues/142)

## [zmNinjaNg-1.1.12](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNg-1.1.12) (2026-05-04)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNg-1.1.11...zmNinjaNg-1.1.12)

**Implemented enhancements:**

- feat\(logs\): reduce console noise and surface meaningful HTTP details [\#141](https://github.com/ZoneMinder/zmNinjaNg/issues/141)
- feat: persistent log file with share/open/clear [\#139](https://github.com/ZoneMinder/zmNinjaNg/issues/139)

**Fixed bugs:**

- fix: single monitor view should always stream, never use snapshot mode [\#138](https://github.com/ZoneMinder/zmNinjaNg/issues/138)

## [zmNinjaNg-1.1.11](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNg-1.1.11) (2026-05-02)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNg-1.1.10...zmNinjaNg-1.1.11)

**Implemented enhancements:**

- chore: reduce low-quality issues via structured form + auto-close workflow [\#124](https://github.com/ZoneMinder/zmNinjaNg/issues/124)

**Fixed bugs:**

- fix: PTZ control protocol mismatch with ZoneMinder server [\#137](https://github.com/ZoneMinder/zmNinjaNg/issues/137)
- fix: saving a montage layout doesn't update the dropdown label to the new name [\#136](https://github.com/ZoneMinder/zmNinjaNg/issues/136)
- fix: montage column layout reverts to 3 columns after navigation [\#135](https://github.com/ZoneMinder/zmNinjaNg/issues/135)
- fix: compact-mode CSS hides last sidebar nav item [\#133](https://github.com/ZoneMinder/zmNinjaNg/issues/133)
- fix\(montage\): saved default layout name shown but layout not applied on Windows Tauri startup [\#127](https://github.com/ZoneMinder/zmNinjaNg/issues/127)
- fix: monitor detail view fails when ZM Servers row has placeholder Hostname/Port=0 [\#120](https://github.com/ZoneMinder/zmNinjaNg/issues/120)

**Closed issues:**

- DePress [\#123](https://github.com/ZoneMinder/zmNinjaNg/issues/123)
- Zonk [\#119](https://github.com/ZoneMinder/zmNinjaNg/issues/119)
- build\(android\): support 16 KB memory page sizes [\#117](https://github.com/ZoneMinder/zmNinjaNg/issues/117)
- build\(android\): upload native debug symbols with release AAB [\#116](https://github.com/ZoneMinder/zmNinjaNg/issues/116)
- build\(android\): enable R8/proguard minification for release AAB [\#115](https://github.com/ZoneMinder/zmNinjaNg/issues/115)

## [zmNinjaNg-1.1.10](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNg-1.1.10) (2026-04-13)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNg-1.1.9...zmNinjaNg-1.1.10)

**Implemented enhancements:**

- feat: hover preview for monitor list and dashboard widget [\#112](https://github.com/ZoneMinder/zmNinjaNg/issues/112)
- feat: hover preview for event list thumbnails on desktop [\#110](https://github.com/ZoneMinder/zmNinjaNg/issues/110)
- feat: configurable thumbnail fallback chain in display settings [\#109](https://github.com/ZoneMinder/zmNinjaNg/issues/109)

**Closed issues:**

- Boredoms [\#108](https://github.com/ZoneMinder/zmNinjaNg/issues/108)

## [zmNinjaNg-1.1.9](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNg-1.1.9) (2026-04-11)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNG-1.1.8...zmNinjaNg-1.1.9)

**Implemented enhancements:**

- feat: live mode for timeline with auto-scroll and real-time event display [\#107](https://github.com/ZoneMinder/zmNinjaNg/issues/107)
- feat: Alarm pulse and event count badge on montage tiles [\#105](https://github.com/ZoneMinder/zmNinjaNg/issues/105)
- feat: Group notification history by date sections [\#104](https://github.com/ZoneMinder/zmNinjaNg/issues/104)
- feat: Add Today quick range and inline quick filters on Events page [\#103](https://github.com/ZoneMinder/zmNinjaNg/issues/103)
- feat: Replace maximize button with volume toggle for RTC monitors [\#102](https://github.com/ZoneMinder/zmNinjaNg/issues/102)
- android TV/Firestick app [\#96](https://github.com/ZoneMinder/zmNinjaNg/issues/96)

**Fixed bugs:**

- fix: Monitors page toolbar cleanup and theme toggle offset [\#106](https://github.com/ZoneMinder/zmNinjaNg/issues/106)

## [zmNinjaNG-1.1.8](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNG-1.1.8) (2026-04-06)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNG-1.1.7...zmNinjaNG-1.1.8)

**Implemented enhancements:**

- feat: per-component log level control in settings [\#101](https://github.com/ZoneMinder/zmNinjaNg/issues/101)
- feat: timeline view UX improvements [\#99](https://github.com/ZoneMinder/zmNinjaNg/issues/99)

**Fixed bugs:**

- fix: multi-server routing for ZMS streams, daemon checks, and event URLs [\#100](https://github.com/ZoneMinder/zmNinjaNg/issues/100)

## [zmNinjaNG-1.1.7](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNG-1.1.7) (2026-04-03)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNG-1.1.6...zmNinjaNG-1.1.7)

**Fixed bugs:**

- fix: monitors page shows no video when status reports offline but stream works [\#98](https://github.com/ZoneMinder/zmNinjaNg/issues/98)

## [zmNinjaNG-1.1.6](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNG-1.1.6) (2026-04-02)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNG-1.1.5...zmNinjaNG-1.1.6)

**Implemented enhancements:**

- feat: redesign Timeline with custom Canvas renderer [\#97](https://github.com/ZoneMinder/zmNinjaNg/issues/97)
- feat: configurable grid columns on Monitor page [\#94](https://github.com/ZoneMinder/zmNinjaNg/issues/94)

**Fixed bugs:**

- fix: unify monitor status logic across all views [\#95](https://github.com/ZoneMinder/zmNinjaNg/issues/95)
- fix: i18n labels overflow on narrow screens [\#93](https://github.com/ZoneMinder/zmNinjaNg/issues/93)
- fix: move PTZ to info row, remove Type from monitor card [\#92](https://github.com/ZoneMinder/zmNinjaNg/issues/92)

## [zmNinjaNG-1.1.5](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNG-1.1.5) (2026-03-30)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNG-1.1.4...zmNinjaNG-1.1.5)

**Implemented enhancements:**

- feat: drag-to-reorder monitors in dashboard widget editor [\#91](https://github.com/ZoneMinder/zmNinjaNg/issues/91)
- feat: add grid view option to monitors list [\#90](https://github.com/ZoneMinder/zmNinjaNg/issues/90)
- chore: shorten i18n labels for mobile [\#89](https://github.com/ZoneMinder/zmNinjaNg/issues/89)
- feat: show event thumbnail on timeline hover [\#88](https://github.com/ZoneMinder/zmNinjaNg/issues/88)
- feat: replace Function label with icons for Capturing/Analysing/Recording [\#87](https://github.com/ZoneMinder/zmNinjaNg/issues/87)
- feat: consistent monitor card thumbnail layout [\#86](https://github.com/ZoneMinder/zmNinjaNg/issues/86)

## [zmNinjaNG-1.1.4](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNG-1.1.4) (2026-03-28)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNG-1.1.3...zmNinjaNG-1.1.4)

**Implemented enhancements:**

- feat: redesign monitor settings dialog with ZM 1.38+ support [\#85](https://github.com/ZoneMinder/zmNinjaNg/issues/85)
- feat: cross-platform E2E test overhaul with real device testing [\#84](https://github.com/ZoneMinder/zmNinjaNg/issues/84)

## [zmNinjaNG-1.1.3](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNG-1.1.3) (2026-03-22)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNG-1.1.2...zmNinjaNG-1.1.3)

**Implemented enhancements:**

- feat: native Android PiP via ExoPlayer for event video playback [\#83](https://github.com/ZoneMinder/zmNinjaNg/issues/83)
- feat: add prev/next monitor buttons to MonitorDetail header [\#82](https://github.com/ZoneMinder/zmNinjaNg/issues/82)
- feat: keep PiP video alive across navigation [\#81](https://github.com/ZoneMinder/zmNinjaNg/issues/81)
- chore: change default theme to slate [\#80](https://github.com/ZoneMinder/zmNinjaNg/issues/80)

**Fixed bugs:**

- fix: ZMS player progress bar doesn't advance during playback [\#79](https://github.com/ZoneMinder/zmNinjaNg/issues/79)
- fix: video zoom controls overlap with video.js control bar [\#78](https://github.com/ZoneMinder/zmNinjaNg/issues/78)
- fix: inconsistent resize options across views [\#77](https://github.com/ZoneMinder/zmNinjaNg/issues/77)
- fix: sidebar menu items too close together on desktop [\#76](https://github.com/ZoneMinder/zmNinjaNg/issues/76)
- fix: heading overlaps with device status bar on iPad/tablet [\#75](https://github.com/ZoneMinder/zmNinjaNg/issues/75)

## [zmNinjaNG-1.1.2](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNG-1.1.2) (2026-03-21)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNG-1.1.1...zmNinjaNG-1.1.2)

## [zmNinjaNG-1.1.1](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNG-1.1.1) (2026-03-21)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNG-1.1.0...zmNinjaNG-1.1.1)

**Implemented enhancements:**

- feat: add kiosk mode \(lock/unlock\) with PIN and biometric auth [\#73](https://github.com/ZoneMinder/zmNinjaNg/issues/73)

## [zmNinjaNG-1.1.0](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNG-1.1.0) (2026-03-20)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNG-1.0.9...zmNinjaNG-1.1.0)

**Implemented enhancements:**

- feat: add pin/lock icon to montage edit mode to prevent individual monitors from being moved [\#72](https://github.com/ZoneMinder/zmNinjaNg/issues/72)
- feat: reorganize Settings page into 3 sections, remove relaxed display mode [\#71](https://github.com/ZoneMinder/zmNinjaNg/issues/71)
- feat: add user-configurable time display format \(12h/24h\) with consistent formatting across all screens [\#70](https://github.com/ZoneMinder/zmNinjaNg/issues/70)
- feat: add favorites, object detection, and tags filters to Timeline page [\#69](https://github.com/ZoneMinder/zmNinjaNg/issues/69)
- feat: add option to disable video autoplay in event detail [\#68](https://github.com/ZoneMinder/zmNinjaNg/issues/68)
- feat: add zoom/pan controls to monitor and event views [\#64](https://github.com/ZoneMinder/zmNinjaNg/issues/64)

**Fixed bugs:**

- fix: montage missing notification bell and resolution placeholder flash [\#67](https://github.com/ZoneMinder/zmNinjaNg/issues/67)
- fix: back button goes nowhere on cold start to detail views [\#66](https://github.com/ZoneMinder/zmNinjaNg/issues/66)
- fix: iOS badge count and notification history sync [\#65](https://github.com/ZoneMinder/zmNinjaNg/issues/65)

## [zmNinjaNG-1.0.9](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNG-1.0.9) (2026-03-17)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNG-1.0.8...zmNinjaNG-1.0.9)

**Implemented enhancements:**

- feat: reduce heading font sizes app-wide for space efficiency [\#63](https://github.com/ZoneMinder/zmNinjaNg/issues/63)
- feat: montage view display enhancements [\#62](https://github.com/ZoneMinder/zmNinjaNg/issues/62)

## [zmNinjaNG-1.0.8](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNG-1.0.8) (2026-03-15)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNG-1.0.7...zmNinjaNG-1.0.8)

**Implemented enhancements:**

- feat: notification bell icon at top of app with animated badge [\#61](https://github.com/ZoneMinder/zmNinjaNg/issues/61)
- feat: reorderable sidebar menu items [\#60](https://github.com/ZoneMinder/zmNinjaNg/issues/60)
- feat: display event Notes field \(detection info\) across all event views [\#59](https://github.com/ZoneMinder/zmNinjaNg/issues/59)
- feat: add detected objects filter, tag filter, and tag display to dashboard events widget [\#58](https://github.com/ZoneMinder/zmNinjaNg/issues/58)
- feat: add Only Detected Objects filter to events page [\#57](https://github.com/ZoneMinder/zmNinjaNg/issues/57)
- feat: add All Tagged option to events tag filter [\#55](https://github.com/ZoneMinder/zmNinjaNg/issues/55)
- feat: add pinch-to-zoom and fullscreen to monitor detail view [\#51](https://github.com/ZoneMinder/zmNinjaNg/issues/51)

**Fixed bugs:**

- fix: event filters not persisting across navigation [\#56](https://github.com/ZoneMinder/zmNinjaNg/issues/56)
- fix: remove broken Account/Logout from Settings [\#54](https://github.com/ZoneMinder/zmNinjaNg/issues/54)
- fix: remove dead scale percentage widget from monitor detail [\#53](https://github.com/ZoneMinder/zmNinjaNg/issues/53)
- fix: fullscreen monitor detail overlaps iOS status bar [\#52](https://github.com/ZoneMinder/zmNinjaNg/issues/52)
- Montage full screen video controls opening between 2 windows and swapping continuously [\#50](https://github.com/ZoneMinder/zmNinjaNg/issues/50)

## [zmNinjaNG-1.0.7](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNG-1.0.7) (2026-03-12)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNG-1.0.6...zmNinjaNG-1.0.7)

**Implemented enhancements:**

- feat: profile-aware notification tap with switch confirmation [\#48](https://github.com/ZoneMinder/zmNinjaNg/issues/48)
- feat: send profile name during push token registration [\#47](https://github.com/ZoneMinder/zmNinjaNg/issues/47)

**Fixed bugs:**

- fix: replace WebView SSL trust-all with certificate pinning \(TOFU\) [\#49](https://github.com/ZoneMinder/zmNinjaNg/issues/49)

**Closed issues:**

- Could not find ZoneMinder API over HTTPS [\#45](https://github.com/ZoneMinder/zmNinjaNg/issues/45)

## [zmNinjaNG-1.0.6](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNG-1.0.6) (2026-03-09)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNinjaNG-1.0.4...zmNinjaNG-1.0.6)

**Implemented enhancements:**

- feat: add user-togglable self-signed certificate support [\#46](https://github.com/ZoneMinder/zmNinjaNg/issues/46)

**Fixed bugs:**

- Android App fails after being configured. [\#44](https://github.com/ZoneMinder/zmNinjaNg/issues/44)

## [zmNinjaNG-1.0.4](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNinjaNG-1.0.4) (2026-03-08)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-1.0.3...zmNinjaNG-1.0.4)

**Refactoring:**

- chore: rename zmNg to zmNinjaNG across the project [\#43](https://github.com/ZoneMinder/zmNinjaNg/issues/43)

## [zmNg-1.0.3](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-1.0.3) (2026-03-07)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-1.0.2...zmNg-1.0.3)

**Implemented enhancements:**

- feat: allow multiple monitor selection in events widget [\#42](https://github.com/ZoneMinder/zmNinjaNg/issues/42)
- feat: add cream theme [\#40](https://github.com/ZoneMinder/zmNinjaNg/issues/40)
- feat: add amber theme [\#39](https://github.com/ZoneMinder/zmNinjaNg/issues/39)
- feat: add slate theme [\#38](https://github.com/ZoneMinder/zmNinjaNg/issues/38)

**Fixed bugs:**

- fix: remove spacing between monitor feeds in dashboard montage widget [\#41](https://github.com/ZoneMinder/zmNinjaNg/issues/41)

## [zmNg-1.0.2](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-1.0.2) (2026-03-07)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-1.0.1...zmNg-1.0.2)

**Fixed bugs:**

- fix: notification history and badge sync improvements [\#37](https://github.com/ZoneMinder/zmNinjaNg/issues/37)

## [zmNg-1.0.1](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-1.0.1) (2026-03-07)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-1.0.0...zmNg-1.0.1)

**Fixed bugs:**

- fix: extra space at top after iOS rotation back to portrait [\#36](https://github.com/ZoneMinder/zmNinjaNg/issues/36)
- fix: new dashboard widgets should default to full width [\#35](https://github.com/ZoneMinder/zmNinjaNg/issues/35)
- fix: new dashboard widgets render tiny until refresh [\#34](https://github.com/ZoneMinder/zmNinjaNg/issues/34)
- fix: exclude deleted monitors from all views [\#33](https://github.com/ZoneMinder/zmNinjaNg/issues/33)
- fix: app badge count drifts higher than in-app notification count [\#32](https://github.com/ZoneMinder/zmNinjaNg/issues/32)

## [zmNg-1.0.0](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-1.0.0) (2026-03-06)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.2.6...zmNg-1.0.0)

**Implemented enhancements:**

- feat: add Direct ZM notification mode alongside ES mode [\#30](https://github.com/ZoneMinder/zmNinjaNg/issues/30)

**Closed issues:**

- chore: bump version to 1.0.0 and unify app identifier [\#31](https://github.com/ZoneMinder/zmNinjaNg/issues/31)

## [zmNg-0.2.6](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.2.6) (2026-03-03)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.2.5...zmNg-0.2.6)

## [zmNg-0.2.5](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.2.5) (2026-02-24)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.2.4...zmNg-0.2.5)

**Fixed bugs:**

- fix: no visible way to exit fullscreen montage on Tauri/desktop [\#29](https://github.com/ZoneMinder/zmNinjaNg/issues/29)
- Montage initially displays correctly in full screen mode but refresh halves videos [\#28](https://github.com/ZoneMinder/zmNinjaNg/issues/28)

## [zmNg-0.2.4](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.2.4) (2026-02-04)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.2.3...zmNg-0.2.4)

**Fixed bugs:**

- zms tokens expire without refresh [\#27](https://github.com/ZoneMinder/zmNinjaNg/issues/27)

## [zmNg-0.2.3](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.2.3) (2026-01-28)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.2.2...zmNg-0.2.3)

**Implemented enhancements:**

- Add event tags support [\#20](https://github.com/ZoneMinder/zmNinjaNg/issues/20)

**Fixed bugs:**

- fix: event thumbnails and playback broken on Android [\#24](https://github.com/ZoneMinder/zmNinjaNg/issues/24)
- fix: move filter popup buttons to top for better mobile accessibility [\#23](https://github.com/ZoneMinder/zmNinjaNg/issues/23)
- fix: QR scanner button unresponsive after closing scanner on mobile [\#22](https://github.com/ZoneMinder/zmNinjaNg/issues/22)
- fix: API queries firing before authentication completes [\#21](https://github.com/ZoneMinder/zmNinjaNg/issues/21)

## [zmNg-0.2.2](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.2.2) (2026-01-23)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.2.1...zmNg-0.2.2)

**Implemented enhancements:**

- feat: Add QR code import for profiles [\#19](https://github.com/ZoneMinder/zmNinjaNg/issues/19)
- Support ZoneMinder monitor groups for filtering [\#18](https://github.com/ZoneMinder/zmNinjaNg/issues/18)

## [zmNg-0.2.1](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.2.1) (2026-01-22)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.2.0...zmNg-0.2.1)

**Implemented enhancements:**

- Reconfigure changelog generation to be issue-based [\#17](https://github.com/ZoneMinder/zmNinjaNg/issues/17)
- Add bandwidth savings mode for reduced data usage [\#16](https://github.com/ZoneMinder/zmNinjaNg/issues/16)

**Closed issues:**

- Unify HTTP stack and fix ZMS snapshot downloads [\#15](https://github.com/ZoneMinder/zmNinjaNg/issues/15)

## [zmNg-0.2.0](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.2.0) (2026-01-14)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.1.5...zmNg-0.2.0)

**Implemented enhancements:**

- Add Go2RTC WebRTC streaming support [\#14](https://github.com/ZoneMinder/zmNinjaNg/issues/14)
- Code cleanup: Remove duplication, split large files, update documentation [\#12](https://github.com/ZoneMinder/zmNinjaNg/issues/12)

**Fixed bugs:**

- Fix infinite re-render loops caused by unstable Zustand selectors [\#13](https://github.com/ZoneMinder/zmNinjaNg/issues/13)

**Refactoring:**

- Code simplification and refactoring [\#11](https://github.com/ZoneMinder/zmNinjaNg/issues/11)

## [zmNg-0.1.5](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.1.5) (2026-01-08)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.1.4...zmNg-0.1.5)

**Closed issues:**

- connecting to local server with IP and Port [\#10](https://github.com/ZoneMinder/zmNinjaNg/issues/10)

## [zmNg-0.1.4](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.1.4) (2026-01-04)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.1.3...zmNg-0.1.4)

## [zmNg-0.1.3](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.1.3) (2026-01-04)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.1.2...zmNg-0.1.3)

**Implemented enhancements:**

- Montage doesn't stream more than about 6 cameras [\#9](https://github.com/ZoneMinder/zmNinjaNg/issues/9)

**Fixed bugs:**

- Mobile header/menu and safe-area scroll bug: header shifts and gets stuck after scrolling [\#8](https://github.com/ZoneMinder/zmNinjaNg/issues/8)

## [zmNg-0.1.2](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.1.2) (2025-12-25)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.1.1...zmNg-0.1.2)

## [zmNg-0.1.1](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.1.1) (2025-12-25)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.1.0...zmNg-0.1.1)

## [zmNg-0.1.0](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.1.0) (2025-12-24)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.0.9...zmNg-0.1.0)

## [zmNg-0.0.9](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.0.9) (2025-12-24)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.0.8...zmNg-0.0.9)

## [zmNg-0.0.8](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.0.8) (2025-12-23)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.0.7...zmNg-0.0.8)

**Fixed bugs:**

- intial setup user auth placeholders make it not clear that they are empty [\#4](https://github.com/ZoneMinder/zmNinjaNg/issues/4)

## [zmNg-0.0.7](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.0.7) (2025-12-22)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.0.6...zmNg-0.0.7)

## [zmNg-0.0.6](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.0.6) (2025-12-22)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.0.5...zmNg-0.0.6)

## [zmNg-0.0.5](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.0.5) (2025-12-20)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.0.4...zmNg-0.0.5)

## [zmNg-0.0.4](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.0.4) (2025-12-20)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.0.3...zmNg-0.0.4)

## [zmNg-0.0.3](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.0.3) (2025-12-19)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.0.2...zmNg-0.0.3)

## [zmNg-0.0.2](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.0.2) (2025-12-19)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/zmNg-0.0.1...zmNg-0.0.2)

## [zmNg-0.0.1](https://github.com/ZoneMinder/zmNinjaNg/tree/zmNg-0.0.1) (2025-12-15)

[Full Changelog](https://github.com/ZoneMinder/zmNinjaNg/compare/c54d94307f3abe693f2f7b4571c33fe2ad83939e...zmNg-0.0.1)

**Closed issues:**

- Incorrect CGI URL generation leads to double /zm/zm/ path and 404 errors [\#1](https://github.com/ZoneMinder/zmNinjaNg/issues/1)



\* *This Changelog was automatically generated by [github_changelog_generator](https://github.com/github-changelog-generator/github-changelog-generator)*
