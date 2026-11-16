# Known issues

Shadowplay as submitted to the Meta VR Start Developer Competition 2026. These
are the limits we know of, stated plainly. Items found on a headset are added
with the session that showed them.

## What the headsets have shown

Shadowplay has been played on a Meta Quest 3 and a Meta Quest 3S with `?diag`
on; the sessions and what each one covered are in `docs/DEVICE-RESULTS.md`,
with their raw data in `docs/diag/`. In short: 72 Hz granted and held (no
5-second window under 60 fps outside the headset's own sleep, wake and menu
transitions), the quality level never stepped down, no errors, and nine shapes
woken by real hands (rabbit, fish, dog, bird, cup, deer, crocodile, snail and
swan). What the headsets have not yet covered is listed
in `docs/DEVICE-RESULTS.md` under "Not yet covered on a headset", and in the
items below.

## Design limits

- **Hand tracking needs light.** Shadowplay dims the room in the headset, but
  the room itself should stay lit. If hands keep dropping out during a shape,
  the story shows the ghost hand and suggests turning a light on.
- **Recognition is joint-angle based.** Each shape is matched from the tracked
  joint angles. A second, silhouette-based method exists in the code but is
  off: it has no recorded templates yet, and it would cost GPU time on Quest.
- **One-hand mode** covers the bird (an open hand) and the cup (one cupped
  hand). The deer and the crocodile still need two hands; after a minute, any
  steady hand in the light wakes them so nobody gets stuck.
- **The Settings panel sits beside the stage, to the right.** It spans about
  19 degrees up to 22 down (tightened from 27 up and 25 down) and reaches 33
  degrees to the right; the text and buttons were kept large rather than
  shrunk. From the seat, the desk lamp's head can cover the panel's lower
  corner; drag the lamp aside if it does.
- **Narrower-view devices** get a smaller stage (at most 45% of the view) and
  Settings over the stage; there the Settings panel can still be taller than
  the view, so its top and bottom rows need a slight tilt of the head. Tested
  by narrowing the emulator's view, not on such a device.
- **The stage remembers its wall** with a WebXR anchor where the browser
  supports anchors (Quest Browser does), and comes back to it on the next
  launch when that wall is still in front of the seat; otherwise the room is
  scanned as usual. On a headset the anchor is created and saved; coming back
  to it on a later launch has so far been tested only with the emulator.
- **Look to press uses head gaze**, the centre of the view, not eye tracking
  (Quest 3 and 3S have none). Its Settings toggle adds a row: the panel is
  about one degree taller at each end. Tested in the emulator only.
- **Voice commands depend on the browser.** Quest Browser's own speech
  recognition is not documented; where there is none, commands go through the
  server (`VOICE_STT=google`, Cloud Speech-to-Text), which needs the API
  enabled for the deployment. English only. Tested with a simulated recogniser
  and synthetic audio, not yet with a real voice on a headset.
- **Mo's tips are as good as the hand tracker's view.** The facts come from
  the same joint angles the recogniser uses, so a hand the headset sees poorly
  gets a poorer tip. Worded by Gemini where the server has a key, otherwise by
  fixed lines. On the headsets: 11 tips in three sessions, 10 worded by
  Gemini (one fell back to the app's own words), arriving in a median of
  0.7 to 0.8 s.
- **Dreamed stories are read by a voice made live** (Cloud Text-to-Speech, on
  the server), not by the narrators recorded for the library; when recorded or
  told live, the storyteller's own voice is the narration. Only the latest
  dreamed story is kept on the headset. Dreaming needs the server's AI key;
  without it the button says so and Mo's tips use the app's own words.
- **Live is one storyteller and one family member**, and Live rooms run on a
  single server instance (in memory). That is plenty for judging; a larger
  launch would need a shared room service.
- **Live voice on iPhone and iPad** may need a tap before the parent's voice is
  heard (Safari starts audio only from a tap). Under test.

## Cosmetic

- In the emulator, the "After 15 s" hint button needed aiming slightly above
  its centre to press; every other button pressed at its centre. Under test on
  a headset.
