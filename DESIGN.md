# BLACKBOX — DESIGN SPEC
### Replaces §8 of the master prompt. The `/xui` skill is not available in this
### session; these are the rules it would have supplied. Follow them directly.

---

## 0. THE ONE SENTENCE

An emergency operations console built by people who expected to use it at 3 AM
with their hands shaking.

Reference points: a trading terminal, an air-traffic console, NASA flight
control, aircraft avionics. **Not** a SaaS dashboard, not a marketing site,
not a startup landing page.

---

## 0.1 PHILOSOPHY (these rules carry over from my design toolkit)

**The feeling: precise, calm, severe, alive.** Every effect should feel like
real instrumentation under real light — never generic tech-demo neon, never
particles for the sake of particles, never gradient blobs. If an effect
couldn't exist on a physical console, question it.

**Bold where it counts, quiet where people need to read or act.** Bold: the
login, the integrity rupture, the attack sequence, the agent revising itself.
Quiet: incident forms, scope entry, chat, task lists, anything a stressed
person operates. Never bold in both places — the contrast is what makes the
bold moments land.

**Research before designing.** Before building the first view, look at 4–6
real operations interfaces (Bloomberg Terminal, air-traffic displays,
SOC/SIEM consoles, mission-control screenshots, Codrops dark-UI demos). Note
one specific technique worth adapting from each. Write them into `DESIGN.md`
under "References" before you write CSS. Do this once, fast — 15 minutes, not
an hour.

**Never ship stock shadcn styling.** Install the primitive, then restyle it
completely to the tokens in §3. A judge recognizing default shadcn is the same
failure as recognizing a gradient hero.

**Never write an API from memory when unsure.** Check the installed package's
own type declarations first. This already saved us once tonight on
`useTable`.

**Every effect needs a fallback.** If WebGL, a font, or an animation doesn't
load, the view still works and still reads correctly. The demo cannot depend
on anything optional succeeding.

**Respect `prefers-reduced-motion`.** All four motion moments degrade to
instant state changes. No flashing. A judge with vestibular sensitivity is a
real possibility and a crash-stop for the pitch.

**Self-critique each view once.** When a view is done, open it, compare it
against §2 (banned list) and §10 (self-check), list the problems, fix the
high-priority ones. One round, not three.

---

## 1. HARD CONSTRAINT FROM THE JUDGES

Winstead judges on, verbatim: *"The team entering the dashboard will be under
stress and will not likely recall tutorials. The ability to operate in the
dashboard with little instruction is almost as important as security."*

So the working views are **restrained and fast**. Motion is spent in exactly
four places (§6) and nowhere else. If an animation doesn't communicate state,
delete it.

---

## 2. BANNED — DO NOT SHIP ANY OF THESE

These read as AI-generated. Judges will have seen two hundred by Sunday.

- Purple→blue or any gradient hero
- Three rounded stat cards in a row with big numbers
- A generic left sidebar with a square logo at the top
- Default-weight Inter at every size
- Emoji anywhere in the UI
- A "✨ AI-powered" badge or sparkle icons
- A centered marketing landing page
- Glassmorphism, frosted blur panels, neon glow on everything
- Rounded-2xl everything with heavy drop shadows
- Lorem-ipsum-shaped filler copy
- Generic empty states with an illustration and "Nothing here yet!"
- Pulsing/breathing animations on idle elements

---

## 3. COLOR

Dark only. No light mode — we have no time and it's wrong for the context.

```css
--bg-0:    #0A0C0F   /* app background */
--bg-1:    #11151A   /* panel */
--bg-2:    #171C23   /* raised / input */
--line:    #232A33   /* borders, 1px, everywhere */
--line-hi: #333D4A   /* hovered / focused border */

--text-0:  #E6EBF2   /* primary */
--text-1:  #9AA6B5   /* secondary */
--text-2:  #5E6B7C   /* tertiary, timestamps */

--accent:  #4D9FFF   /* THE one accent. Selection, focus, active nav. */

/* Status — these carry meaning, never decoration */
--critical: #FF4D4D
--high:     #FF8A3D
--medium:   #FFC53D
--low:      #4D9FFF
--ok:       #35D07F
--unknown:  #5E6B7C
```

**Rules:**
- One accent color. `--accent` is never used for status.
- Status colors appear **only** on status. Never a status color on a button
  that isn't destructive, never on a heading, never decorative.
- No gradients on status elements. Flat fills, 1px borders.
- Backgrounds step by elevation: `bg-0` → `bg-1` → `bg-2`. Not by shadow.
- Shadows: almost none. Use a 1px `--line` border instead. One soft shadow is
  allowed on modals and nothing else.

---

## 4. TYPE

```
UI / prose:  Inter  (400 body · 500 labels · 600 headings)
Data:        JetBrains Mono  (IDs, hashes, timestamps, counts, severities,
                              asset names, anything a machine produced)
```

The mono/sans split is the single biggest thing that will make this look
engineered rather than generated. **Anything a machine produced is mono.**

Scale — tight, dense, small:
```
11px / 600 / 0.08em tracking / uppercase   section labels
12px / 400                                  metadata, timestamps
13px / 400                                  body, list rows        ← the workhorse
15px / 500                                  panel headings
20px / 600                                  incident title
28px / 600 mono                             the one big number (severity, count)
```

Line-height 1.45 for prose, 1.25 for dense rows. Never center body text.
Never justify.

---

## 5. LAYOUT

- **8px grid.** Spacing values: 4, 8, 12, 16, 24, 32. Nothing else.
- **Border radius: 4px.** Everywhere. 2px on small chips. Never more.
- **Full-bleed.** The app fills the viewport. No max-width container, no
  centered column, no page margins.
- **Density over whitespace.** A real operator wants more on screen. Rows are
  32px tall, not 56px.
- **A persistent top chrome bar**, 44px, always visible, containing:
  `BLACKBOX` wordmark · active incident · **chain status** · model badge ·
  connected responders · live UTC clock (ticking seconds)
- Three-pane COMMAND layout: list 280px · detail flex · chat 320px. Panes
  divided by 1px `--line`, no gaps, no floating cards.

**Readable from 6 feet.** Judges stand. Nothing critical below 12px.

---

## 6. WHERE MOTION IS ALLOWED — FOUR PLACES ONLY

Everywhere else: transitions ≤150ms, opacity and transform only. No layout
animation, no parallax, no scroll-jacking, no 3D.

### 6.1 Login / code entry
The first five seconds a judge sees. Spend real effort.
- Near-black. A single centered 6-digit code field in mono, large (32px),
  character boxes, not a text input.
- Each digit lands with a 60ms scale-in.
- Behind it, a very slow, very low-contrast scanline or grain. Barely visible.
- On success: the field locks green for 200ms, then a hard cut to COMMAND.
  No fade, no spinner, no "Welcome back!"
- On failure: 3-frame horizontal shake, field goes `--critical`, one line of
  mono text. No toast.

### 6.2 INTEGRITY BROKEN / ANCHOR MISMATCH — the signature moment
This is the thing judges remember. Build it properly.
- The entire top chrome bar expands from 44px to a full-width red band.
- A single `--critical` wash sweeps the viewport left→right over 400ms at
  ~8% opacity, then settles.
- The RECORD timeline auto-scrolls to the broken record and isolates it:
  every other row drops to 25% opacity, the broken one gets a 2px
  `--critical` border and its stored vs. recomputed hashes shown side by side
  in mono, diffed character by character with the first differing character
  highlighted.
- `ANCHOR MISMATCH` is the louder variant: same treatment plus a second line,
  `DATABASE REWRITTEN AFTER CHECKPOINT #40 · 14:32:07Z`.
- No sound. No modal. The UI itself changes state.

### 6.3 The attack sequence
Four attacks, ~40 seconds. Each gets a sharp acknowledgment, ~600ms:
- A mono label slides in from the right naming the attack
- Then the outcome stamps in: `BLOCKED` in `--ok`, or the integrity rupture
- Blocked attacks leave a persistent row in a small "Attacks repelled" counter
  in the chrome bar. By the end it reads `4`.

### 6.4 The agent changing its mind — TrustGraph
The NVIDIA moment. Must be legible in under 5 seconds.
- The previous conclusion does **not** disappear. It gets struck through and
  drops to `--text-2`, staying visible above.
- The new conclusion resolves in below it over 300ms.
- A `--critical` line is drawn connecting the two conflicting evidence cards,
  with the conflict reason in 12px mono on the line.
- A `REVISED` chip appears beside the conclusion with the timestamp.
- Never a silent overwrite. The judge must see the old answer being replaced.

---

## 7. COMPONENT RULES

**Buttons.** Flat. 1px border. 28px tall, 32px for primary. Mono uppercase
11px with tracking for destructive actions. Primary = `--accent` border +
`--accent` text on `bg-2`, never a filled gradient. Destructive = `--critical`
border, and it must require two-person approval, so its label reads
`REQUEST ISOLATION · 2 APPROVALS` not `Delete`.

**Status chips.** 2px radius, 11px mono uppercase, 1px border in the status
color, background at 12% of that color. Never solid-filled.

**Lists.** 32px rows. 1px `--line` between. Hover raises background to `bg-2`,
no transform. Selected row gets a 2px `--accent` left border.

**Inputs.** `bg-2`, 1px `--line`, focus swaps to `--accent`, no glow, no ring.
Labels above in 11px uppercase `--text-1`.

**Empty states.** One line of 13px `--text-2` prose stating what will appear
here. No illustration, no icon, no exclamation mark.
Good: `No scope items recorded.`
Bad: `🔍 Nothing here yet! Add your first item to get started.`

**Loading.** No spinners. A 1px `--accent` progress line at the top of the
affected pane, or skeleton rows at the exact final height.

**Toasts.** Bottom-left, 13px, mono for anything machine-generated, auto-dismiss
4s, max one at a time. Never top-right.

**Icons.** lucide-react, 14px, `--text-1`, stroke 1.5. Icons accompany text;
they never replace it. No icon-only buttons except window controls.

---

## 8. THE AGENT PANEL (INVESTIGATE)

The judges watch this for 50 seconds. It must read like a machine working.

- A vertical trace, one row per step, appearing as they happen.
- Each row: `[14:32:07] → searchIncidents("ransomware payroll")` in mono,
  12px, `--text-1`, with the tool name in `--accent`.
- Result collapses underneath in `--text-2`, two lines max, expandable.
- The currently-running step gets a 1px `--accent` left border and a single
  blinking block cursor at the end of the line. That is the only idle
  animation in the entire app.
- Completed steps go `--text-2`.
- **Model badge on every run**: `LIGHTNING 30B · 2.1s` or `ULTRA 550B · 11.4s`
  in 11px mono, top-right of the panel. Shows the routing happening.
- Tasks created by the agent land on the COMMAND board with a `NEMOTRON` chip
  in `--accent`, and a 200ms highlight flash as they arrive.

---

## 9. THE CHAIN STATUS BAR

Always visible in the chrome. Three states:

```
● CHAIN VERIFIED · 47 records · anchored 0:32 ago        --ok, 11px mono
▲ INTEGRITY BROKEN · record #23 · hash mismatch          --critical, full-width band
▲ ANCHOR MISMATCH · rewritten after checkpoint #40       --critical, full-width band
```

Green state is quiet — a small dot and mono text. Red states take the whole
width and change the chrome height. The asymmetry is the point.

---

## 10. SELF-CHECK BEFORE YOU CALL ANY VIEW DONE

- [ ] Could this be mistaken for a generic AI-generated dashboard? If yes, fix.
- [ ] Is every machine-produced value in mono?
- [ ] Is there exactly one accent color, and is it absent from all status?
- [ ] Does any animation exist that doesn't communicate state? Delete it.
- [ ] Can a stranger operate this with zero explanation?
- [ ] Is anything critical smaller than 12px?
- [ ] Any gradient, emoji, glassmorphism, or sparkle? Remove.
- [ ] Does it look like a tool, or like a product page? It must look like a tool.

---

## References

_To be filled with 4–6 real operations interfaces (one adaptable technique each) at the start of slice 3, before any CSS is written — per §0.1._
