# Device results (Quest 3 and Quest 3S)

What the headset sessions have shown so far, read from their `?diag` data. Every
number here comes from a session file in [`docs/diag/`](diag) and can be
recomputed with:

```sh
node scripts/diag/summarize.mjs docs/diag
```

The checklist these sessions feed is [`DEVICE-TEST.md`](DEVICE-TEST.md); rows are
ticked there only where the data shows the row's pass condition, with the session
id beside it. Everything else is listed below under "Not yet covered on a headset".

## Sessions

Time in XR is counted from the 5-second frame windows recorded while immersive.

| Session | Headset | Started | In XR | fps median (p5) | Frame p95 | Windows under 60 fps | Quality | Stage | What was played |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [`cdj3st58rm`](diag/2026-11-14/cdj3st58rm.jsonl) ([part 2](diag/2026-11-15/cdj3st58rm.jsonl)) | Quest 3 | Nov 14, 22:56 | 12 min | 71.8 (71.0) | 15.0 ms | 0 / 144 | q0 | wall 8.15 m wide at 2.4 m, then paper screen | Counting Stars, waiting on the opening bird (before the real-hands shape fixes) |
| [`32kbw476u2`](diag/2026-11-15/32kbw476u2.jsonl) | Quest 3S | Nov 15, 07:19 | 0.3 min | 71.6 (68.0) | 15.2 ms | 0 / 3 | q0 | wall 1.13 m wide at 2.7 m | A dreamed story (start only) |
| [`49768whrpd`](diag/2026-11-15/49768whrpd.jsonl) | Quest 3 | Nov 15, 16:28 | 0.7 min | 72.0 (61.1) | 15.5 ms | 0 / 8 | q0 | paper screen (no planes) | Start-up only (the rest of this session was lost; see the README) |
| [`xhz96jhkv9`](diag/2026-11-15/xhz96jhkv9.jsonl) | Quest 3 | Nov 15, 16:28 | 4.6 min | 71.6 (70.6) | 14.8 ms | 0 / 55 | q0 | wall 0.93 m wide, and paper screen | Two dreamed stories, each to The End |
| [`xnhuwf56d6`](diag/2026-11-15/xnhuwf56d6.jsonl) | Quest 3S | Nov 15, 16:38 | 0.5 min | 71.5 (68.3) | 15.5 ms | 0 / 6 | q0 | wall 1.13 m wide at 2.5 m | The Night Garden (deer) |
| [`afthmamdpn`](diag/2026-11-15/afthmamdpn.jsonl) | Quest 3S | Nov 15, 16:39 | 8.4 min | 71.6 (70.6) | 14.8 ms | 0 / 101 | q0 | paper screen | The Night Garden, The Moth, Moon Buggy (to The End), Goodnight Across the Sea |
| [`m3zdndu6vq`](diag/2026-11-15/m3zdndu6vq.jsonl) | Quest 3 | Nov 15, 19:25 | 11.7 min | 71.8 (71.0) | 14.8 ms | 0 / 140 | q0 | paper screen | A dreamed story, Moon Buggy, Sleepy Little Dinosaur, Little Lost Spaceship, each to The End |
| [`8b2ca94jd3`](diag/2026-11-16/8b2ca94jd3.jsonl) | Quest 3 | Nov 16, 06:47 | 16.2 min | 71.6 (71.0) | 14.9 ms | 1 / 194 (the first 5 s, entering XR) | q0 | paper screen (Room Setup had another room) | Four stories dreamed from ideas said aloud; Moon Buggy, Sleepy Little Dinosaur |
| [`g3bb9hvnvt`](diag/2026-11-16/g3bb9hvnvt.jsonl) | Quest 3S | Nov 16, 07:04 | 16.4 min | 71.8 (71.0) | 14.9 ms | 0 / 197 | q0 | paper screen; a wall 1.13 m wide at 2.5 m for a while | Goodnight Across the Sea (to The End), Little Lost Spaceship, Moon Buggy, a dreamed story |
| [`fpxa7ky672`](diag/2026-11-16/fpxa7ky672.jsonl) | Quest 3 | Nov 16, 16:43 | 11.0 min | 71.6 (70.6) | 14.9 ms | 0 / 132 | q0 | wall 3.99 m wide at 1.66 m (after Room Setup of this room) | The Moth (to The End), two dreamed stories; high contrast, one hand, Look to press and voice commands on |
| [`r9w45r8ghs`](diag/2026-11-16/r9w45r8ghs.jsonl) | Quest 3 | Nov 16, 16:54 | 1.8 min | 71.8 (71.2) | 14.7 ms | 0 / 22 | q0 | wall, back on last time's spot | Launched again from the same seat |
| [`9f89mnu4ye`](diag/2026-11-16/9f89mnu4ye.jsonl) | Quest 3S | Nov 16, 17:13 | 15.7 min | 71.6 (70.2) | 14.9 ms | 0 / 188 | q0 | wall 4.04 m wide at 1.63 m; desk surface | A dreamed story, Moon Buggy, Little Lost Spaceship, Sleepy Little Dinosaur; voice commands |
| [`v7sw83fr98`](diag/2026-11-16/v7sw83fr98.jsonl) | Quest 3S | Nov 16, 18:44 | 11.2 min | 71.8 (70.4) | 14.9 ms | 0 / 134 | q0 | wall, back on last time's spot; desk surface | Moon Buggy, The Moth (to The End), a dreamed story; voice commands |
| [`4zp7d8t7yg`](diag/2026-11-17/4zp7d8t7yg.jsonl) | Quest 3 | Nov 17, 00:34 | 19.3 min | 71.6 (70.6) | 15.0 ms | 0 / 231 | q0 | wall, back on last time's spot; desk surface | Six story-world stories and a dream: every world creature woke; two recordings with voice saved and sent |

Windows under 60 fps exclude the headset's own transitions (sleep, wake, the
system menu), which the summary reports separately (31 in all); the lowest of
those was 46.9 fps, in `cdj3st58rm`, waking after three hours asleep.

## What the sessions show

- **Frame rate.** 72 Hz was requested and granted wherever the request was
  recorded (Quest 3 and 3S). Across 14 sessions (1,555 five-second windows,
  about 130 minutes in XR): median 71.5 to 72 fps, frame-time 95th percentile
  14.7 to 15.5 ms. One window was under 60 fps: the first five seconds of
  `8b2ca94jd3` (46.9 fps), as it entered XR and the room loaded, before the
  story began; every window after it held 70 to 72. The quality level never
  stepped down from q0.
- **No errors.** Every session reports `errors: 0`.
- **Recognition with real hands.** 123 creatures woke across the sessions, and
  every one of them was the shape the story had asked for (no false wakes):
  cup 22, bird 21, dog 20, fish 16, rabbit 13, crocodile 6, snail 5, swan 4,
  whale 4, octopus 2, deer 1, and on Nov 17 (`4zp7d8t7yg`) every story-world
  creature: rocket, alien, asteroid, shark, octopus, whale, car, aeroplane,
  digger, T. rex and pterodactyl. With one-hand mode on, birds and cups woke
  with one hand (`9f89mnu4ye`, `v7sw83fr98`).
- **Stories to The End.** The Moth (`fpxa7ky672`, `v7sw83fr98`), Goodnight
  Across the Sea (`g3bb9hvnvt`), Moon Buggy, Sleepy Little Dinosaur and Little
  Lost Spaceship (`m3zdndu6vq`), and dreamed stories in five sessions.
- **First creature after entering XR** (sessions after the real-hands fixes):
  26 s (deer, `xnhuwf56d6`), 28 s (fish, `fpxa7ky672`), 32 s (rabbit,
  `afthmamdpn`), 35 s (rabbit, `9f89mnu4ye`), 39 s (dog, `v7sw83fr98`), 46 s
  (swan, `g3bb9hvnvt`), 52 s (dog, `m3zdndu6vq`), 53 s (fish, `8b2ca94jd3`),
  56 s (fish, `xhz96jhkv9`), 65 s (asteroid, `4zp7d8t7yg`, the first
  world-creature story); target under 60 s. None of these was a first launch
  (Counting Stars).
- **Room understanding.** Room Setup planes arrive with semantic labels
  (`v wall 10, v door 2, h shelf 8, h table 2, h couch 1, h floor 1,
  h ceiling 1` in one room, 27 planes with 11 walls and 5 doors in another),
  and the stage was placed on a labelled wall in four sessions. The headsets
  report a 94-degree view, so both keep the full 33-degree stage.
- **The stage on the real wall.** Until Nov 16 most sessions used the paper
  screen, though the room had 10 or more labelled walls: Room Setup had
  scanned a different room. Since the diagnostics record why each wall was
  passed over (distance, angle, verdict), and with the room in use scanned,
  the stage stood on the real wall in every session (`fpxa7ky672`,
  `r9w45r8ghs`, `9f89mnu4ye`, `v7sw83fr98`, `4zp7d8t7yg`; bedroom planes:
  `v wall 14, v door 4, v window 1, h shelf 8, h table 3, h bed 1`). The desk
  props stood on the detected desk (`desk surface`) in `9f89mnu4ye`,
  `v7sw83fr98` and `4zp7d8t7yg`.
- **Stage anchor.** On a wall the anchor goes `pending > live > saved` on the
  headset. Launched again from the same seat, the stage came back on last
  time's spot of the wall, 0.3 to 0.4 s after entering XR (`r9w45r8ghs`,
  `v7sw83fr98`, `4zp7d8t7yg`). Corrections since Nov 16 are at most 2 cm;
  earlier, two moved the stage by up to 50 cm (`cdj3st58rm`) and 52 cm
  (`49768whrpd`) as the headset refined its map.
- **AI on the headset.** Mo's tips: 28, 23 worded by Gemini (median 0.58 to
  1.2 s per session); the other 5 were the app's own words, 4 of them for the
  new world creatures before the server knew them (`4zp7d8t7yg`, fixed since).
  Dreams: 9, none failed, each written in 3.8 to 10.8 s, 8 of them from ideas
  said aloud through the Quest's speech path (`8b2ca94jd3` four, and
  `fpxa7ky672`, `g3bb9hvnvt`, `v7sw83fr98`, `4zp7d8t7yg`). Sessions with dreams held 72 Hz,
  so generating a story does not hold up rendering.
- **Voice commands.** On both headsets through the server's speech path
  (`server`): commands heard and acted on in `fpxa7ky672`, `9f89mnu4ye` and
  `v7sw83fr98`. On the Quest 3S they work once the browser is allowed the
  microphone (an earlier 3S session had not been).
- **Settings and pauses** (recorded since Nov 16). High contrast, one-hand
  mode, Look to press and voice commands were all switched on on the headset
  (`fpxa7ky672`); the story paused for the journal and for the Quest menu and
  went on after (`fpxa7ky672`, `9f89mnu4ye`).
- **Recordings.** Two stories recorded with voice and sent, a family code
  each (`4zp7d8t7yg`); one was a dreamed story.
- **Start-up.** Enter XR to the stage placed: 0.3 to 0.4 s when the anchored wall
  comes back, 1.2 to 9.7 s otherwise; earlier, 1.2 to 4.0 s in six sessions,
  19.7 s in `m3zdndu6vq`, where the summary times the last placement: a paper
  screen was up 0.1 s after entering XR, and the room's 25 planes arrived
  19.7 s in and placement chose the paper screen again. Heap 35.6 to 45.2 MB.

## Checks run off the headset (Nov 16)

| Check | Result |
| --- | --- |
| `npm test` (typecheck, unit, server, recognition sweep, coach) | pass |
| `npm run build` with the framework split into chunks | pass; three 1.0 MB, framework 1.3 MB, app 0.25 MB, no chunk cycles. Not shipped (#116 closed: little gain for judges, untested on Quest Browser) |
| Built app in headless Chromium, headset page and `?viewer` | both start (2.4 to 3.0 s locally), no page errors |
| Built app with the API server down | both pages start; `/api` failures do not stop the app |
| API server with no AI key | `GET /api/dream` reports `available: false`; `/api/coach` and `/api/dream` answer 503 with a message ("Mo is resting.", "Mo can only dream up stories where the server has AI."), never hang |
| `scripts/sim/solo-judge.mjs` (dev server, emulator) | 4 / 4: Mia's goodnight waits and plays; a story is recorded and sent and a family code comes back; the viewer plays Dad's sample and opens the new code |

## Checks run off the headset (Nov 16 and 17)

Emulator sims for what the headset sessions showed, each failing on the old
code and passing with the fix:

| Check | Result |
| --- | --- |
| `scripts/sim/raise-hand.mjs`, `grow.mjs`, `resting-hands.mjs` | a flat raised palm goes on at once; a 12 cm pull grows the fish and the dog by hand; a lowered hand casts no shadow |
| `scripts/sim/voice-commands.mjs` | a spoken bird crosses the wall and carries Mo, with a relaxed hand held up in the light |
| `scripts/sim/finale-lights.mjs` | the released light lights each scenery; Counting Stars ends under stars |
| `scripts/sim/world-creatures.mjs` | the eight world-creature stories told to The End, each creature waking as itself |
| `scripts/sim/playback-hands.mjs` | during a recording, pinches on the lamp switch and the journal work |
| `scripts/sim/join-in-voice.mjs` | Join in with every later play() refused (as on iOS): the recorded voice comes back |
| `scripts/sim/viewer-shelf.mjs` | the shelf, the ending kept in view, fading controls, Full screen, no lamp hum |
| `scripts/sim/dream-wish.mjs`, `dream-stories.mjs` | four shapes and world creatures in a spoken idea; Done / Got it; "Mo is dreaming" with moving dots |

## Not yet covered on a headset

These need a person in the headset (and, for some, a phone). Record the session
id beside each in `DEVICE-TEST.md`.

- **A room never tested in**, on the Quest 3S: cold start, the stage on a wall
  or the paper screen, no dead end. (The paper screen of Nov 15 was a room
  Room Setup had not scanned; the `placed` event now records why each wall was
  or was not used.)
- **The opening of a first launch** with The Shy Little Shark (first launches
  open it since Nov 17): time from Enter XR to the shark. The last first launch
  with Counting Stars was measured: `ufckcgf798` (Nov 17, the first visit to the
  new address), the bird 32 s after Enter XR.
- **The two-person loop on a real phone**: Go live, Talk, Take turns, a
  dropout (DEVICE-TEST D5 to D8). Watching a sent story on a computer and an
  iPad and sending a goodnight back were done (Nov 16 and 17, by family code;
  the viewer sends no diagnostics); Join in on the iPad lost the voice after
  the first shape, fixed since and to be tried again.
- **The no-key fallback on the headset** (checked above on the server only).
- **Accessibility on the headset**, beyond switching it on: whether high
  contrast reads well in passthrough and Look to press tells a whole story
  (settings are recorded since Nov 16; one-hand mode and voice commands are
  shown working above).
- **Pause with the headset off for 30 s** (E2, beyond the three-hour sleep in
  `cdj3st58rm`) and **Move stage here** to another wall, then relaunch (A5e).
- **The fixes made since the last session**, each with a sim but not yet on a
  headset: whale and snail carries (#140), Mo's tips for world creatures
  (#142), pinches during a recording (#143), recording codes in the journal
  (#144), "Mo is dreaming" dots (#145), each world's first story (#146), the
  child's drawing coming once (#139), and on the iPad, Join in's voice (#151).
