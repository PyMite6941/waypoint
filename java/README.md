# Waypoint Presenter (Java)

A standalone desktop presenter for Waypoint decks, written in plain Java (Swing, no dependencies).
Make and save a deck in Waypoint (File, Save file gives a `.waypoint.json`), then present it here.

## Build and run

Needs a JDK 17 or newer.

```sh
sh java/build.sh              # or: powershell java/build.ps1
java -jar java/waypoint-presenter.jar                       # opens a launcher (or drop a deck on it)
java -jar java/waypoint-presenter.jar talk.waypoint.json 3  # present from slide 3
```

On Java 22+ you can also run it without building: `java -cp java/src java/src/waypoint/Main.java talk.waypoint.json`.

## What happens when you present

- **Two or more displays:** the slides fill the other display, borderless, like a projector output. Your screen gets the controller.
- **One display:** the slides open in a window of their own, next to the controller.

The controller is laid out like Keynote's presenter display: current slide, next slide, the slide's next choices and your notes on the left, and every slide on a light table on the right. Click any slide to jump the audience straight to it. Columns switches between 3 and 4 slides per row; the slide on screen is ringed in orange.

Keys (in either window): arrows, Space, Page Up/Down or a clicker move in order, playing each slide's builds first; type a number and Enter to jump; Backspace returns to where you jumped from; Home/End; B or `.` blacks out the screen; Esc ends the show. Clicking the slides follows a link on the slide or advances; right-click goes back. A click that only brings a window to the front does nothing else, so clicking back from another app never skips a slide. F5 (a clicker's start button) is ignored.

Transitions and builds play as in the web app. Flip, cube and morph are simplified (morph cross-fades).

If you save the deck again from Waypoint while presenting, the presenter picks up the changes within a couple of seconds.

## Limits

- Images saved as WebP (Waypoint shrinks large photos to WebP) show as a placeholder: the JDK cannot decode WebP without a plugin. PNG, JPEG and GIF images draw normally.
- Fonts fall back to what is installed, so text can wrap slightly differently from the browser.

| File | Purpose |
| --- | --- |
| `Main.java` | Launcher, picking displays, keys, reloading the deck file |
| `Deck.java` / `Json.java` | Reading `.waypoint.json` (mirrors `src/lib/deck.js`) |
| `Painter.java` | Drawing a slide with Java2D, matching `style.css` |
| `Presentation.java` | Current slide, build step, transitions and the back trail |
| `SlideCanvas.java` | Draws a slide scaled to fit, with transitions |
| `FocusGuard.java` | Ignores the click that only focuses a window |
| `AudienceWindow.java` / `ControllerWindow.java` | The two screens |
