# Memory Journal + SafeSleep

A phone app for older adults living with memory changes, built around one grandmother's real day: taking medicine, a short morning check-in, walks, a spoken journal, and recorded voices from family. Underneath it runs **SafeSleep**, an on-device agent that watches for changes after a sleep medicine is started and tells the family when it may be time to talk with a doctor.

- **Phone app:** https://sunsuncrystal.github.io/memory-journal/ (open on a phone, then "Add to Home Screen")
- **Desktop demo for judges:** https://sunsuncrystal.github.io/memory-journal/demo.html

Works in Chinese, English and Spanish.

## Why

Sedating sleep medicines (zolpidem, benzodiazepines, diphenhydramine "PM" products and others) are on the American Geriatrics Society Beers Criteria list because they raise the risk of confusion and falls in older adults. The early signs, such as walking less, waking more at night, and slower reactions, show up at home over days. Doctors usually don't see them. Families often notice too late.

## What grandma sees

| | |
|---|---|
| 🏠 / 📞 | Two big buttons always at the top: *Take me home* (opens maps) and *Call family* |
| 💊 Medicine | One tap records a dose. A second tap the same day warns her before she logs it again |
| 🌅 Check-in | Three questions, one per screen: sleep, night waking, falls. Plus a 30-second tap game that measures reaction time |
| 🚶 Walk | *Start my walk* / *I'm back*, with a family voice saying goodbye and welcome home |
| 📖 Journal | Speak or type. *Ask my journal* finds past entries |
| 🐑 Mimi | A sheep mascot who delivers reminders. Tap her to hear the message (or the family recording) |
| 🌙 Night mode | From 10 pm to 6 am the app opens on a dim screen: *sit on the bed first, turn on the light, hold the wall*. It logs each bathroom trip and how long it took |
| 💌 Family voices | Family records reminders in their own voice. The app plays those recordings instead of a computer voice |

Large text (3 sizes), read-aloud on every screen, light and dark themes, works offline once installed.

## What family sees

Hold *Family* for 2 seconds to open the family area:

- **Safety report.** Green / yellow / gray, with plain-language reasons. Each reason cites an evidence ID (E1, E2…) that points to the underlying data. Also includes 60-day charts, a night get-up log, and questions to take to the doctor. Printable.
- **Medicine list.** Type a name in any language, misspelled or brand-name. It is matched to the ingredient and flagged if sedating or on the Beers list.
- **Voices & medicine times**, plus **📅 Add to phone calendar**, so the phone rings at medicine time even when the app is closed.
- **Setup checklist**, **backup** (including recordings), and **pilot usage stats** (counts only, CSV export).

## How SafeSleep decides

A deterministic pipeline of five tools. It runs entirely on the phone and needs no server and no AI API:

1. **validate_schema.** Is there enough data, and is it well-formed?
2. **normalize_medication.** Maps names to ingredients (fuzzy matching, brand, generic and Chinese names), then to drug class and sedation/Beers flags.
3. **analyze_activity_sleep.** Compares the last 7 days to *her own* baseline (median and MAD over up to 28 earlier days) on four signals: walking, night waking, reaction time, sleep rating. A change has to persist on at least 3 of 7 days. One bad night doesn't count.
4. **risk_model.** A transparent logistic score with every weight visible in the code.
5. **evidence_critic.** Checks the evidence before any alert:
   - If there's too little data (under 7 baseline days, under 4 recent days, or fewer than 2 usable signals), it **abstains** (gray) instead of guessing.
   - A *review* (yellow) needs a high enough score **and** at least two independent supporting signals.
   - A reported fall always alerts family (safety override).

### Results on synthetic scenarios

| Scenario | Expected | Rules only | No critic | SafeSleep |
|---|---|---|---|---|
| A. Several signals worsen after starting a sleep medicine | review | ✗ | ✓ | ✓ |
| B. Long-term medicine, only last night was bad | ok | ✗ | ✗ | ✓ |
| C. Very little recent data | abstain | ✗ | ✗ | ✓ |
| D. Stable on medicine | ok | ✓ | ✓ | ✓ |

Wrong decisions: rules only 3, without the critic 2, full SafeSleep 0. Medication name matching: 16/16 test names, including typos ("Ambian", "xanex") and Chinese names (思诺思, 舒乐安定). You can rerun all of this live in the family tab of the desktop demo (*Run all stress tests*).

## Mimi's voice

Phone voices sound robotic, so Mimi speaks in **Sunny's voice**. We recorded 12 seconds of Sunny reading a short script, with her consent. On the family computer, the open-source voice model **CosyVoice 3** (Apache-2.0) then rendered every fixed sentence the app says (60 in Chinese: reminders, check-in questions, night-mode coaching, Mimi's lines). The clips ship with the app (`voice/zh/`, about 15 KB each) and play offline.

- Nothing is uploaded: the model runs locally, and the phone only plays files.
- Sentences that change (names, times, journal text) still use the phone's voice. Real family recordings always come first.
- The app says the voice is AI-generated. Family can switch Mimi back to the phone's voice in *Text & read-aloud*.
- Sunny's original recording is kept off GitHub. To re-render the clips: `tests/export-phrases.js` lists the sentences and `dev/voices.py` renders them (`--check` transcribes each clip with Whisper to catch mistakes).

## Safety and privacy

- **Never** tells anyone to stop, reduce or change a medicine. The only action it suggests is talking with a doctor or pharmacist.
- **Not a diagnosis.** No claims that a medicine *caused* anything. The model is not clinically validated, and the app says so.
- **Data stays on the phone.** No accounts, no server, no analytics. Only the app's code is hosted on GitHub Pages. Backups are files the family saves themselves.

## Limitations

- These results come from synthetic test data, not clinical data. The weights were chosen by us, not learned or validated. The next step is a pilot with real users and review by a geriatrician.
- A web app can't run in the background. In-app reminders appear only when the app is open; the calendar export covers medicine times when it is closed.
- Walking time comes from the *Start / I'm back* buttons, not a step counter.
- Speech recognition may not work when the app is installed to the iPhone home screen. Typing always works.

## Project layout

```
index.html        phone app (built; this is what is deployed)
demo.html         desktop demo; also the source of the strings and the SafeSleep agent
dev/head.html     phone app HTML and CSS
dev/ui.js         phone app logic
dev/voices.py     renders Mimi's voice clips (CosyVoice 3) from dev/phrases-zh.json
voice/zh/         the rendered clips + index.json
dev/build.py      builds index.html = dev/head.html + agent from demo.html + dev/ui.js
tests/run.js      end-to-end tests (Chrome, headless)
sw.js, manifest.webmanifest, icons/   offline support and install
```

Build and test:

```
python3 dev/build.py
cd tests && npm install && npm test     # needs Google Chrome; set CHROME_PATH if not on macOS
```

After changing the app, bump `CACHE` in `sw.js` so installed phones pick up the new version.

## Credits

Made by Sunny Gao (The Harker School) for her grandmother.
