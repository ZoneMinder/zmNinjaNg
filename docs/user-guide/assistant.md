# Ninjii, the assistant

Ninjii answers questions about your cameras and events. It is read-only: it cannot change or delete anything on your ZoneMinder server. Its event and monitor answers come with cards you tap to open that screen; Ninjii does not move the app on its own. The model that answers runs either on your device or on a server you run yourself. Nothing goes to a server operated by zmNinjaNg or any AI company.

## Enabling the Assistant

Go to **Settings > Ninjii** and turn on **Enable Ninjii**.

Underneath it, **Show in toolbar** puts the Ninjii icon in the toolbar of the
Dashboard, Monitors, Montage, Events, Timeline, and Live Activity screens,
beside their menu, so a question is one tap away. It is off by default: Ninjii
already answers from the command palette and the keyboard, and a toolbar shared
with each page's own controls is the one place a global tool has to earn its
spot. The setting only appears once Ninjii is enabled, and the icon only shows
where the assistant is actually configured.

Underneath, **Backend** picks where the model runs:

- **Ollama (remote)**: the model runs on an [Ollama](https://ollama.com) server (or anything else speaking the OpenAI-compatible chat API) that you point the app at. The only option where the question leaves this device, and it goes to your server, not to anyone else's.
- **On-device (AICore)**: on an Android phone whose system provides Gemini Nano through AICore. Android downloads the model once, and after that it belongs to the system rather than the app, so it uses none of the app's memory for model weights and other apps share the same copy. Nothing leaves your device (see below).
- **On-device (Apple Intelligence)**: on an iPhone 15 Pro or newer running iOS 26 with Apple Intelligence turned on, the assistant uses Apple's own on-device system model. There is nothing to download: Apple ships and runs the model as part of iOS, so it uses none of the app's memory for model weights. Nothing leaves your device (see below).
- **On-device (Download model)**: the app fetches a model and runs it itself. Nothing leaves your device. This is the only option that costs you a download and disk space, which is why it is named for that rather than for the engine behind it. Which engine that is depends on the platform, and you do not choose it:
  - On desktop and web, the model runs on your computer's GPU through WebGPU, and you pick which model from the list under the picker.
  - On a supported iPhone or iPad, it runs inside the app on the device's GPU through Metal, with one model (Qwen3 4B Instruct). Only on a device with enough memory (see below).
  - On Android this option does not appear at all. With no GPU path there, the same model decoded several times slower than the phone's own system model, so Android uses AICore instead.

The two labels naming a system component, AICore and Apple Intelligence, mean the operating system already has the model and the app is borrowing it. **Download model** means the app supplies its own. That is the distinction worth caring about, because it decides whether you wait for a download and give up storage.

The backends differ in how accurate their answers are, and a note under the picker says so, naming the model each one runs. The ranking depends on the platform:

- **iPhone and iPad**: Ollama (qwen3:8b recommended), then Qwen3 4B Instruct on the device, then Apple Intelligence.
- **Android**: Ollama (qwen3:8b recommended), then Gemini Nano on the device.
- **Desktop and web**: Ollama (qwen3:8b recommended), then whichever WebGPU model you pick.

When the assistant is running on a system model it cannot swap (Apple Intelligence or Gemini Nano), the chat window keeps a note pointing at the better backend for that platform: the on-device model on an iPhone, and your own Ollama server on Android.

The WebGPU on-device backend is not offered on phones or tablets: those models need more memory than a mobile browser engine is allowed to use, and answers take minutes on phone hardware. An iPhone or iPad with roughly 6GB of RAM or more gets **On-device (Download model)** instead, running the same kind of downloaded model through Metal (see below). An Android phone gets Gemini Nano where the system provides it, and Ollama otherwise. Below those thresholds there is no on-device choice, just a note saying so and the Ollama settings. On a desktop or in a browser, WebGPU on-device is available whenever your GPU supports WebGPU.

The chat window's header always names the model that is answering and where it runs, for example "Llama 3.2 3B · On-device" or "llama3.2:latest · Ollama", so you never have to open Settings to check which one you are talking to. On the Ollama backend a coloured dot next to that label shows whether the server is reachable: green means connected, red means it cannot be reached (check the address, or that the server is running), and a pulsing amber dot means the app is still checking. The dot rechecks periodically while the window is open. On-device has no server to reach, so no dot appears.

## Asking a Question

Once enabled, there are three ways to start a conversation:

- Press `?` on a keyboard (desktop, web).
- Open the command palette (`/`, the sidebar button, or the mobile header icon) and tap **Ask**.
- Type a leading `?` directly into the command palette's search field.
- Tap the Ninjii icon in a page's toolbar, if you have turned that on.

Before you have typed anything, Ninjii shows a few example prompts as tappable chips (one of them is "Summarize my day"). Tapping a chip drops its text into the input so you can send it as-is or edit it first.

Type your question and press Enter (or tap Send). While the assistant is working, a spinner and the name of whatever it is doing (for example, looking up an event or checking a monitor) show above the input. Tap the stop button to cancel a request in progress.

### On a phone

The assistant is a bottom sheet that shares the screen instead of covering it, so the app stays visible above it. Its tinted header, accent outline, and shadow separate the Ninjii workspace from the app. It rests as a slim bar at the bottom. Drag the grip at the top of the sheet up to any height to see more of the conversation, or down to shrink it. Tapping the input grows the sheet above the keyboard so you can read replies as you type. The chevron collapses the sheet to a floating button (tap the button to bring it back), and the X closes it. The sheet keeps its proportion when you rotate the phone.

On a tablet or desktop the assistant is a floating, resizable card in the bottom-right corner instead, with the same tinted header, accent outline, and shadow.

Examples of what you can ask:

- "Is the server ok?"
- "Summarize today"
- "How many events happened on the driveway camera in the last hour?"
- "How many people came by yesterday?"
- "What was my busiest hour on Sunday?" (weekday names and "2 days ago" work too)
- "Show me the most recent event on the front door camera" (tap the card in the answer to open it)

Answers come with cards underneath: event thumbnails you can tap to open the event, and monitor cards with a live preview when the answer is about a few specific cameras (a long list of monitors stays text, since every preview is a real stream). The cards are the rows the answer is about, not everything the lookup touched: ask for your busiest hour and you get that hour's events, not the whole day's.

Hover an event card's thumbnail on desktop, or long-press it on a phone or tablet, and the event plays enlarged in place, the same preview the Events list gives you. It closes when you move away or tap elsewhere, and the stream is shut down with it. Turn it off under Settings, General, Previews, Assistant cards.

Ask it to change something, such as "arm the backyard camera" or "delete event 1234", and it will tell you it cannot and point you to the screen where you can. See below for why.

Ninjii only knows what its tools can look up: your monitors, events, groups, tags, and server health. Ask it something unrelated to this ZoneMinder server and it answers as an ordinary assistant would, without pretending to have looked anything up.

## Asking about several servers

When you are looking at a group of servers, Ninjii knows the group's servers by name and answers about all of them.

Name a server and it looks there only: "how many events on warehouse today". Name none and it asks every server in the group and reports each one separately, so a total always says which server it came from. Name two and you get the comparison: "compare events in warehouse and cabin today". The names it knows are your profile names, exactly as they appear on the Profiles screen, so renaming a profile renames it for Ninjii too.

Every event and monitor card underneath the answer is labelled with the server it came from, and opening one takes you to that server's screen. Two servers can each have a camera called "Front Door", and the label is how you tell those apart.

The picker at the top of the chat window still names one server, and that is deliberate: it decides which server's assistant settings run the conversation (the backend, model and history length), not which servers get asked. Its own conversation history stays with it, so switching it gives you a separate thread.

A group with one enabled server behaves exactly like a single server: no names, no per-server breakdown.

## The assistant cannot change anything

The assistant is read-only. It can look things up, and that is all. It cannot arm or disarm a monitor, trigger or cancel an alarm, change a monitor's function, change the run state, or delete or archive an event.

This is deliberate. The assistant works by having a language model choose which action matches your words, and a model can misread a request: "clear out today's events" is one phrasing away from deleting them, and "I'm cabin" is one phrasing away from changing your run state. Earlier versions asked you to confirm each action first, but that put the entire safeguard on a single tap, in a dialog that looks the same whether the model understood you or not. Deleting an event cannot be undone, and a monitor left disarmed records nothing.

Ask for one of these and the assistant will say it cannot do it and point you to the screen where you can: monitors and arming on **Monitors**, run state on **Server**, deleting and archiving on the event itself. Doing it there means you picked the target yourself.

## The on-device model (desktop and web)

On a desktop or in a browser, the model runs inside the app using your GPU (WebGPU), the same way a game or video effect uses the GPU, rather than sending your conversation to a company's servers over the internet. This is not available on phones or tablets; a supported iPhone or iPad runs Qwen3 4B Instruct on-device instead, and an Android phone runs Gemini Nano (both below). Ollama remains the alternative everywhere.

**Settings > Ninjii > Model** shows which model runs, then **Download** fetches it. The download runs as a background task you can watch or cancel, and the model is stored on your device until you tap **Delete**.

| Model | Download | Notes |
|---|---|---|
| Llama 3.2 3B | ~2264 MB | Fastest download, smallest memory footprint. |
| Qwen3 4B | ~3432 MB | The default. Answers camera questions more accurately in testing. Needs about a gigabyte more GPU memory. |

Earlier versions offered a choice of six models. Those models varied widely in whether they would use a tool at all, so the list is now short and every entry on it is tested against the same question suite. If your settings still name a model that was removed, the app moves you to Llama 3.2 3B automatically.

The download size is a floor, not the total: running a model needs additional memory on top of its weights, and how much depends on how long the conversation gets.

:::{warning}
Local models run in your computer's memory. If the app crashes or the model never finishes loading, the machine does not have enough memory for it. Switch to the Ollama backend to run the model on a server instead. This is the same note shown next to the model picker in Settings.
:::

## The on-device model on iPhone and iPad

WebGPU on-device does not run in a mobile browser engine, but a recent iPhone or iPad can still run the model itself, inside the app, instead of talking to a server. **Settings > Ninjii > Backend** offers **On-device (Download model)** only when your device qualifies; on a device that does not, the option simply does not appear, and Ollama is the only backend shown. On Android this option does not exist at all (see Gemini Nano below).

Qualifying takes memory, not a particular device generation: the app checks your device's physical memory at startup and offers **On-device (Download model)** above roughly 6GB. A device below the threshold never sees the option, so there is nothing to turn off if the app decides not to offer it.

It also takes iOS 16.4 or later. The inference engine the app embeds is built for that version, so on an older iOS it is not loaded at all and **Settings > Ninjii** says so instead of offering the option. The rest of the app works normally; update iOS, or point the assistant at an Ollama server.

iPhone and iPad run the model on the device's GPU through Metal, which is what makes it usable: replies take a couple of seconds. Ollama is still the more accurate backend when you have a server to point at.

The model is a single fixed choice (Qwen3 4B Instruct), unlike the desktop and web picker above. **Settings > Ninjii > Model** shows its download size, about 2.5GB, and **Download** fetches it once, the same background task you can watch or cancel that other downloads use. It stays on your device until you tap **Delete**, and nothing about it changes on later app updates unless you delete and download it again.

As with WebGPU on-device, this is fully on-device: your questions, the assistant's answers, and anything it looks up on your ZoneMinder server never leave your phone or tablet except to reach that server itself. No conversation data goes to Ollama, to zmNinjaNg, or to any AI company.

## The on-device model with Apple Intelligence (iOS 26)

On an iPhone that supports Apple Intelligence, the assistant can use Apple's own on-device system model instead of a model the app ships or downloads. **Settings > Ninjii > Backend** offers **On-device (Apple Intelligence)** only when three things are true: the phone is eligible hardware (iPhone 15 Pro or newer), it runs iOS 26, and Apple Intelligence is turned on in iOS Settings. When any of these is missing the option does not appear, and the other backends are shown instead.

If your phone has Apple Intelligence hardware and iOS 26 but you have not turned Apple Intelligence on, Settings shows a short note telling you to enable it in iOS Settings. Turn it on there and the backend option appears. While iOS is still preparing Apple Intelligence after you enable it, the option stays hidden until the model is ready.

This backend is separate from **On-device (Download model)** above and does not share its memory requirement: a phone can offer Apple Intelligence without qualifying to download a model, or the other way round, so each option appears on its own.

Unlike the other on-device backends, there is nothing to download and no **Model** picker: Apple manages the model as part of iOS, and it uses none of the app's memory for model weights. The model, and therefore how well it answers and which languages it replies in, is Apple's, not something zmNinjaNg selects or tunes. Everything else about the assistant works the same way.

Which to choose on an iPhone: Ollama first if you have a server, then **On-device (Download model)**, then this. Apple Intelligence is the least accurate of the three, and measurably so. Asked to plan thirty-eight camera questions it chose the right lookup twenty-one times, against thirty-three for Android's system model on the same questions; its usual mistakes are looking up the wrong period and searching your events to answer questions that have nothing to do with your cameras. Pick it when you want an answer without downloading a model and without a server, and accept that it will more often go and fetch the wrong thing.

This is fully on-device: your questions, the assistant's answers, and anything it looks up on your ZoneMinder server never leave your phone except to reach that server itself. No conversation data goes to Apple, to Ollama, to zmNinjaNg, or to any AI company.

## The on-device model with Gemini Nano (Android)

On an Android phone whose system provides Gemini Nano, the assistant can use that system model instead of the one the app downloads. **Settings > Ninjii > Backend** offers **On-device (AICore)** once the phone supports it and the model has been downloaded. Where Apple ships its system model with iOS, Android fetches Gemini Nano on request, so the first thing you see on a supported phone is a short note in Settings saying the model is available but not downloaded yet, with a **Download** button under it. Tap it, wait for the progress to finish, and the backend option appears.

The download belongs to Android, not to zmNinjaNg. Other apps that use Gemini Nano share the same copy, it does not count against the app's storage, and there is no **Delete** button here: removing it is Android's business, not the app's. There is no **Model** picker either, for the same reason there is none under Apple Intelligence: the model is the system's, and how well it answers and which languages it replies in are Google's choices rather than something zmNinjaNg selects or tunes.

Two limits are worth knowing. Android only runs this model while zmNinjaNg is on screen, so a question left running as you switch apps comes back asking you to reopen the app and try again. Android also meters how much each app may use the model in a day; if you reach that limit the assistant says so and you can either wait or switch to Ollama.

Gemini Nano is the only on-device backend on Android. The app used to also run Qwen3 4B Instruct here the way it does on iPhone, and that was removed: without a GPU path on Android it produced about seven words a second, against roughly a second and a half for a whole Gemini Nano reply, and it cost 76MB of app download plus a 2.5GB model download to be the slower option.

Which to choose on an Android phone: Ollama first if you have a server, then this. Gemini Nano is the only on-device option, and it is a capable one: asked to plan thirty-eight camera questions it chose the right lookup thirty-three times, and it correctly answered all eight questions that needed no lookup at all. A server-backed qwen3:8b is still the recommended choice where you have one, though the two have not been scored against each other on the same questions, so use Gemini Nano when you have no server or want the conversation to stay on the phone.

This is fully on-device: your questions, the assistant's answers, and anything it looks up on your ZoneMinder server never leave your phone except to reach that server itself. No conversation data goes to Google, to Ollama, to zmNinjaNg, or to any AI company.

## Running the model on your own server (Ollama)

Set **Backend** to **Ollama** and give the app the address of your server. Left empty, the app uses your ZoneMinder server's own address on port 11434, which is right when Ollama runs on that machine. The field's placeholder shows the address it will use. Type a different one if your Ollama server is elsewhere. Avoid `localhost` on a phone: there it means the phone itself, which is not running Ollama.

**Test model**, next to the model list, checks two separate things and tells you which one failed: first that the server answers at all, and then that the model you picked can call the app's tools. A model that cannot, such as gemma2, is reachable but useless here: it never looks anything up, so the assistant can only guess. A large model may take a minute to answer the first test while the server loads it into memory, and the button reports which step it is waiting on.

The model list fills in automatically from the server, and you can also type a model name by hand. A GPU-backed Ollama server is recommended, and Qwen3 8B on such a server answers noticeably better than the on-device model; Llama 3.2 is a good pick when you want the fastest possible replies. If your server does not have the recommended model, Settings shows you the `ollama pull` command to add it. The **API key** field is optional, for a server that requires one; it is stored in your device's secure storage, not alongside the rest of your settings.

## Performance and accuracy

Which model you pick matters more than any other assistant setting. zmNinjaNg carries a test suite for exactly this: camera-and-events questions ("summarize today", "how many people came today", "compare may to june", "is the server ok", and so on) asked against known data, scored on whether the model looked the right thing up with usable filters and whether its answer quoted the data correctly. The table below comes from that suite as it stood in July 2026, fourteen questions asked three times each, measured against Ollama 0.32 on a GPU server. Your hardware changes the times, not the accuracy. The suite has since grown to thirty-eight planning questions, which is what the on-device figures further down were measured on.

| Ollama model | Accuracy | Typical reply |
|---|---|---|
| **qwen3:8b** (recommended) | every check passed | about 2 seconds |
| llama3.2 | every check passed, leaning on the app's guardrails | about half a second |
| qwen3:30b-a3b | every check passed | about 11 seconds |
| qwen3:4b | every check passed | about 20 seconds |
| qwen3:1.7b | roughly a third of checks failed | about 3 seconds |

Why qwen3:8b: it is the smallest model that passed every check on its own judgement. It never mistook small talk for a camera question, and never dropped the object filter on questions like "how many people came today". llama3.2 reaches the same final scores but only because the app corrects it along the way, and each correction costs an extra round trip; it stays the right choice when reply speed matters most.

Two things to know about the qwen3 family:

- They are "thinking" models that normally reason at length before answering. The app turns that off automatically on Ollama, which made replies about five times faster in testing with identical accuracy. The very first question after the app meets a new server still includes one slow, thinking reply.
- The size tag matters: qwen3:8b passed everything, while qwen3:1.7b failed a third of the same checks. A sibling tag is a different model, not a smaller copy of the same one.

Some models cannot drive the assistant at all: gemma2 has no tool support and qwen2.5-coder never uses one, so with either the assistant can only guess. The **Test model** button catches both cases before you commit to a model.

The on-device Llama 3.2 3B passed 21 of 24 lookup checks in an equivalent test. Its misses were answering from memory instead of looking things up, which the app detects and corrects by insisting on a lookup, at the cost of a slower reply. The on-device Qwen3 4B option scored between Llama 3.2 and the server-backed qwen3:8b in the same suite, at the cost of a larger download and more GPU memory. A server-backed qwen3:8b answers noticeably better and faster than either; on-device remains the choice when the conversation must not leave your machine.

The two system models were measured in July 2026 on the larger suite, thirty-eight questions asked once each on the phone itself, scored only on whether the model planned the right lookup. They ran a different, harder set of questions than the Ollama table above, so read them against each other rather than against that table:

| System model | Planned the right lookup | Knew when no lookup was needed |
|---|---|---|
| Gemini Nano (Android) | 33 of 38 | 8 of 8 |
| Apple Intelligence (iOS) | 21 of 38 | 4 of 8 |

The second column is the one to read. Both models were asked eight questions that needed no camera lookup at all, such as "who won the world cup in 2018" and "how do I add a camera". Gemini Nano answered all eight without searching; Apple Intelligence went looking through your events for half of them, which wastes a few seconds and can produce an answer built on cameras that had nothing to do with the question. A server-backed qwen3:8b remains the recommendation on every platform.

## Long conversations

Every model can only hold so much of a conversation at once. Ninjii limits the amount of recent history and each tool result it sends to a model. When an on-device conversation approaches its known limit, Ninjii posts a note saying it has started a fresh one, and stops sending earlier messages to the model. The messages above that note stay on screen for you to read; the model simply no longer sees them. On Ollama the limit belongs to your server's configuration and the app cannot read it, so it cannot know when to clear automatically.

**Clear** in the chat header wipes the conversation entirely at any time and leaves a note saying so.

While the model is loading, the chat says so instead of showing the usual "Thinking" line, so a long first wait is explained rather than looking like a hang.

## Advanced settings

**Advanced** at the bottom of the assistant settings is collapsed by default. Nothing in it needs changing for normal use.

**Temperature** controls how much the model varies its wording. Leave it at 0. Testing this app's own questions against a real server, 0 answered every one correctly, while higher settings got several wrong on the same questions, including reporting the total number of events when asked how many people were detected. Above 0 the assistant is more likely to state a count, a time, or a camera name that is not in the results it was given.

**Reply timeout** is how long to wait for one answer, in seconds. Raise it if your server runs the model on a processor rather than a graphics card, where a single answer can take minutes. Lower it if you would rather be told quickly that something is wrong.

**Remembered exchanges** is how many earlier questions and answers the model is shown. More helps it follow up on what you just asked. Fewer keeps each answer faster, and stops it repeating an earlier answer instead of looking again.

## Language

The assistant now understands questions in other languages: the model itself interprets your time words ("letzte Woche", "ayer por la tarde") into the exact window it looks up, and tool routing no longer depends on English keywords. English remains the best-tested path, and a few answer-accuracy safeguards (such as catching an answer that contradicts the data) only recognize English replies, so a note above the conversation says as much when the app language is not English. Replies come back in the app's language either way.

## Privacy

No third-party AI service ever sees your cameras, events, or questions. Which machines do see them depends on the backend:

- **Any on-device backend** (a downloaded model on desktop, web, iPhone or iPad; Apple Intelligence on iOS 26; AICore on Android): your questions, the answers, and anything the assistant looks up stay on your device. The only network requests are to your own ZoneMinder server, the same requests every other screen in the app makes.
- **Ollama**: the same data, plus your questions and the assistant's answers, also go to the Ollama server you configured. That server is yours; the app never sends the conversation anywhere else.

Either way the conversation is not saved. Closing zmNinjaNg clears it.

## Platform support

The WebGPU on-device backend runs on desktop and in the browser, where there is enough memory to hold a model, and it needs a GPU with WebGPU support. It is not offered on phones or tablets: a mobile browser engine is capped at far less memory than a model needs, so loading one crashes the app. An iPhone or iPad with enough physical memory downloads its model and runs it through Metal instead (see above), with no browser engine or WebGPU involved; below that memory there is no on-device choice at all. An iPhone 15 Pro or newer on iOS 26 with Apple Intelligence turned on can additionally use Apple's on-device system model, which needs no memory of its own because iOS hosts the model (see above). An Android phone whose system provides Gemini Nano can use that the same way, once it has been downloaded (see above). Ollama has none of these requirements and works anywhere the app runs, so it is the way to use the assistant on a phone or tablet without enough memory for on-device, or on a desktop without WebGPU.

On the Linux desktop app, picking the on-device backend usually shows a "no WebGPU" note. That is not a missing GPU: Chromium ships with WebGPU turned off on Linux because Vulkan driver support there is uneven, and the app inherits that default. You can turn it on by launching the app with Chromium's own flags:

```
zmNinjaNg --enable-unsafe-webgpu --enable-features=Vulkan
```

(For the AppImage, put the flags after the AppImage file name.) This needs working Vulkan drivers, and "unsafe" is in the flag's name because Chromium has not finished hardening this path on Linux; if the app becomes unstable, drop the flags and use Ollama instead. On macOS and Windows none of this is needed, WebGPU is on by default there.
