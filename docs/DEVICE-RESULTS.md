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

Windows under 60 fps exclude the headset's own transitions (sleep, wake, the
system menu), which the summary reports separately; the lowest of those was
46.9 fps, in `cdj3st58rm`.

## What the sessions show

- **Frame rate.** 72 Hz was requested and granted wherever the request was
  recorded (Quest 3 and 3S). Median 71.5 to 72 fps, frame-time 95th percentile
  14.8 to 15.5 ms, and not one 5-second window under 60 fps in 457 windows
  (about 38 minutes in XR). The quality level never stepped down from q0.
- **No errors.** Every session reports `errors: 0`.
- **Recognition with real hands.** 25 creatures woke across the sessions, and
  every one of them was the shape the story had asked for (no false wakes):
  rabbit, fish and dog (3 sessions each), bird and cup (2), crocodile, snail,
  swan and deer (1 each).
- **First creature after entering XR** (sessions after the real-hands fixes):
  26 s (deer, `xnhuwf56d6`), 32 s (rabbit, `afthmamdpn`), 52 s (dog,
  `m3zdndu6vq`), 56 s (fish, `xhz96jhkv9`); target under 60 s.
- **Room understanding.** Room Setup planes arrive with semantic labels
  (`v wall 10, v door 2, h shelf 8, h table 2, h couch 1, h floor 1,
  h ceiling 1` in one room, 27 planes with 11 walls and 5 doors in another),
  and the stage was placed on a labelled wall in four sessions. The headsets
  report a 94-degree view, so both keep the full 33-degree stage.
- **Stage anchor.** On a wall the anchor goes `pending > live > saved` on the
  headset. Four sessions needed no correction; two moved the stage by up to
  50 cm (`cdj3st58rm`) and 52 cm (`49768whrpd`) as the headset refined its
  map.
- **AI on the headset.** Mo's tips: 11 in three sessions, 10 worded by Gemini
  and 1 by the app's own words, median 0.66 to 0.84 s per session. A dream
  request (`xhz96jhkv9`): a story with a dog and a fish in 4.5 s, then told to
  The End. Both sessions with dreamed stories held 72 Hz throughout
  (0 / 55 and 0 / 140 windows under 60 fps), so generating a story does not
  hold up rendering.
- **Start-up.** Enter XR to the stage placed: 1.2 to 4.0 s in six sessions,
  19.7 s in `m3zdndu6vq`, where the summary times the last placement: a paper
  screen was up 0.1 s after entering XR, and the room's 25 planes arrived
  19.7 s in and placement chose the paper screen again. Heap 35.6 to 45.2 MB.

## Checks run off the headset (Nov 16)

| Check | Result |
| --- | --- |
| `npm test` (typecheck, unit, server, recognition sweep, coach) | pass |
| `npm run build` with the framework split into chunks | pass; three 1.0 MB, framework 1.3 MB, app 0.25 MB (was one 2.6 MB file), no chunk cycles |
| Built app in headless Chromium, headset page and `?viewer` | both start (2.4 to 3.0 s locally), no page errors |
| Built app with the API server down | both pages start; `/api` failures do not stop the app |
| API server with no AI key | `GET /api/dream` reports `available: false`; `/api/coach` and `/api/dream` answer 503 with a message ("Mo is resting.", "Mo can only dream up stories where the server has AI."), never hang |
| `scripts/sim/solo-judge.mjs` (dev server, emulator) | 4 / 4: Mia's goodnight waits and plays; a story is recorded and sent and a family code comes back; the viewer plays Dad's sample and opens the new code |

## Not yet covered on a headset

These need a person in the headset (and, for some, a phone). Record the session
id beside each in `DEVICE-TEST.md`.

- **A room never tested in**, on the Quest 3S: cold start, the stage on a wall
  or the paper screen, no dead end. In the latest sessions the stage went to
  the paper screen even though Room Setup had 10 or more labelled walls; a
  wall is used only when it is within 40 degrees of straight ahead and 0.6 to
  4 m away, so note which way the seat faced. The `placed` event does not yet
  record why a wall was passed over.
- **The opening of a first launch** (Counting Stars, the bird): time from Enter
  XR to the first creature, since the real-hands fixes.
- **The two-person loop on a real phone**: Join in with camera hands, Send a
  goodnight back, Go live, Talk, Take turns (DEVICE-TEST D1 to D8).
- **The spoken-wish dream** (Say your idea) through the Quest's speech path.
- **The no-key fallback on the headset** (checked above on the server only).
- **Accessibility on the headset**: high contrast, Look to press, voice
  commands, one-hand mode (the diagnostics do not record settings).
- **Coming back to the anchored wall** on a later launch (`anchorLast` has not
  yet been true in any session).
- **Pause and resume** from the Quest menu and with the headset off (E1, E2).
