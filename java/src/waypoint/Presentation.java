package waypoint;

import java.util.ArrayList;
import java.util.List;
import javax.swing.Timer;

/**
 * The running show: where we are (slide and build step), the trail of slides visited so
 * Back can return to wherever the presenter jumped from, and the clock for transitions and
 * builds. Both windows observe it; only this changes it.
 *
 * Next plays the slide's next build if it has one, otherwise moves on with the next slide's
 * transition; its step-0 builds play once the transition ends. Previous steps back through
 * builds without animation, as in the web app.
 */
final class Presentation {
    private Deck deck;
    private Painter painter;
    private int at, build, play = -1;
    private boolean black;
    private long playStart;
    // The transition into the current slide: from which slide (and its build), started when.
    private int from = -1, fromBuild;
    private boolean forward = true;
    private long transStart;
    private final List<Integer> trail = new ArrayList<>();
    private final List<Runnable> listeners = new ArrayList<>();
    private final List<Runnable> frames = new ArrayList<>();
    private final Timer clock = new Timer(15, e -> frame());

    Presentation(Deck deck, int start) {
        setDeck(deck);
        this.at = deck.clamp(start);
        startSlide(-1, true);
        frame();   // step-0 builds of the first slide play straight away
    }

    Deck deck() { return deck; }
    Painter painter() { return painter; }
    int at() { return at; }
    int build() { return build; }
    Deck.Slide slide() { return deck.slides.get(at); }
    boolean black() { return black; }

    /** Listeners run on every change of place; frame listeners on every animation frame too. */
    void onChange(Runnable r) { listeners.add(r); }
    void onFrame(Runnable r) { frames.add(r); }
    private void changed() { for (Runnable r : listeners) r.run(); frame(); }

    /** The file was edited elsewhere: keep our place as best we can. */
    void setDeck(Deck d) {
        this.deck = d;
        this.painter = new Painter(d);
        this.at = d.clamp(at);
        this.build = Math.min(build, d.slides.get(at).buildSteps());
        this.from = -1;
        this.play = -1;
        trail.replaceAll(d::clamp);
        changed();
    }

    /* ---------- moving ---------- */

    void go(int i) {
        int j = deck.clamp(i);
        black = false;
        if (j != at) { trail.add(at); int was = at; at = j; startSlide(was, j > was); }
        changed();
    }

    /** Next (+1) or previous (-1): through builds first, then slides. */
    void step(int d) {
        black = false;
        if (d > 0) {
            if (build < slide().buildSteps()) { build++; play = build; playStart = System.nanoTime(); from = -1; changed(); return; }
            if (at < deck.slides.size() - 1) go(at + 1);
            return;
        }
        if (build > 0) { build--; play = -1; from = -1; changed(); return; }
        if (at > 0) {
            trail.add(at);
            at--;
            build = slide().buildSteps();   // arrive with everything shown, without effects
            play = -1;
            from = -1;
            changed();
        }
    }

    void back() {
        black = false;
        if (!trail.isEmpty()) { int was = at; at = deck.clamp(trail.remove(trail.size() - 1)); startSlide(was, false); }
        changed();
    }

    void toggleBlack() { black = !black; changed(); }

    private void startSlide(int was, boolean fwd) {
        fromBuild = build;   // the slide we leave keeps what it was showing
        build = 0;
        play = 0;
        playStart = transStart = System.nanoTime();
        from = was >= 0 && slide().trans() != null && !"none".equals(slide().trans().fx()) ? was : -1;
        forward = fwd;
    }

    /* ---------- what to draw now ---------- */

    /** The running transition into this slide, or null. */
    record Transition(int from, int fromBuild, String fx, double progress, boolean forward) {}

    Transition transition() {
        if (from < 0 || from >= deck.slides.size()) return null;
        Deck.Trans t = slide().trans();
        if (t == null) return null;
        double p = (System.nanoTime() - transStart) / 1e9 / Math.max(0.05, t.dur());
        return p >= 1 ? null : new Transition(from, fromBuild, t.fx(), Math.max(0, p), forward);
    }

    /** The current slide's builds as they should look this instant. */
    Painter.Builds builds() {
        double delay0 = play == 0 && slide().trans() != null && from >= 0 ? slide().trans().dur() : 0;
        return new Painter.Builds(build, play, (System.nanoTime() - playStart) / 1e9, delay0);
    }

    boolean animating() {
        return transition() != null || painter.animating(slide(), builds());
    }

    /** Runs the frame clock only while something moves. */
    private void frame() {
        for (Runnable r : frames) r.run();
        if (animating()) { if (!clock.isRunning()) clock.start(); }
        else if (clock.isRunning()) { clock.stop(); play = -1; for (Runnable r : frames) r.run(); }
    }
}
