package waypoint;

import java.awt.AlphaComposite;
import java.awt.Color;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.Rectangle2D;
import java.awt.image.BufferedImage;
import java.util.List;
import java.util.Objects;
import java.util.function.Supplier;
import javax.swing.JComponent;

/**
 * Shows one slide, scaled to fit. `which` picks the slide each time it paints.
 *   STATIC: that slide with every build shown (light table, thumbnails).
 *   LIVE:   the show as the room sees it: transitions and builds play.
 *   NEXT:   what Next will show: this slide's next build if it has one, else `which`.
 * Renders into a cached image so scrolling a big light table stays smooth; LIVE draws
 * every frame only while something moves.
 */
class SlideCanvas extends JComponent {
    enum Mode { STATIC, LIVE, NEXT }

    private final Presentation show;
    private final Supplier<Integer> which;
    private final Color backdrop;
    private final Mode mode;
    private BufferedImage cache, leaving;
    private Object cacheKey, leavingKey;

    SlideCanvas(Presentation show, Supplier<Integer> which, Color backdrop) { this(show, which, backdrop, Mode.STATIC); }

    SlideCanvas(Presentation show, Supplier<Integer> which, Color backdrop, Mode mode) {
        this.show = show;
        this.which = which;
        this.backdrop = backdrop;
        this.mode = mode;
        setOpaque(true);
        if (mode == Mode.LIVE) show.onFrame(this::repaint);
    }

    /** The slide's rectangle within this component, in pixels: {x, y, w, h}. */
    double[] slideBox() {
        double k = Math.min(getWidth() / (double) Deck.W, getHeight() / (double) Deck.H);
        double w = Deck.W * k, h = Deck.H * k;
        return new double[]{(getWidth() - w) / 2, (getHeight() - h) / 2, w, h};
    }

    @Override
    protected void paintComponent(Graphics g0) {
        Graphics2D g = (Graphics2D) g0;
        g.setColor(backdrop);
        g.fillRect(0, 0, getWidth(), getHeight());
        Integer i = which.get();
        List<Deck.Slide> slides = show.deck().slides;
        if (mode == Mode.NEXT && i != null && show.build() < show.slide().buildSteps()) i = show.at();
        if (i == null || i < 0 || i >= slides.size() || getWidth() < 2 || getHeight() < 2) {
            paintEmpty(g);
            return;
        }
        Deck.Slide slide = slides.get(i);
        Painter.Builds builds = switch (mode) {
            case STATIC -> Painter.Builds.ALL;
            case NEXT -> Painter.Builds.still(i == show.at() ? show.build() + 1 : 0);
            case LIVE -> i == show.at() ? show.builds() : Painter.Builds.ALL;
        };
        double[] box = slideBox();
        double scale = g.getTransform().getScaleX();   // HiDPI: draw at device resolution
        int pw = Math.max(1, (int) Math.ceil(box[2] * scale)), ph = Math.max(1, (int) Math.ceil(box[3] * scale));
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);

        Presentation.Transition tr = mode == Mode.LIVE && i == show.at() ? show.transition() : null;
        boolean moving = mode == Mode.LIVE && i == show.at() && show.animating();
        BufferedImage now;
        if (moving) {
            now = render(slide, builds, pw, ph);
        } else {
            Object key = List.of(slide, show.painter(), pw, ph, builds.build());
            if (cache == null || !key.equals(cacheKey)) { cache = render(slide, builds, pw, ph); cacheKey = key; }
            now = cache;
        }
        if (tr == null) {
            g.drawImage(now, (int) Math.round(box[0]), (int) Math.round(box[1]), (int) Math.round(box[2]), (int) Math.round(box[3]), null);
            return;
        }
        Object key = List.of(tr.from(), tr.fromBuild(), show.painter(), pw, ph);
        if (leaving == null || !Objects.equals(key, leavingKey)) {
            leaving = render(slides.get(tr.from()), Painter.Builds.still(tr.fromBuild()), pw, ph);
            leavingKey = key;
        }
        transition(g, tr, leaving, now, box);
    }

    private BufferedImage render(Deck.Slide slide, Painter.Builds builds, int pw, int ph) {
        BufferedImage img = new BufferedImage(pw, ph, BufferedImage.TYPE_INT_RGB);
        Graphics2D cg = img.createGraphics();
        show.painter().paint(cg, slide, 0, 0, pw, ph, builds);
        cg.dispose();
        return img;
    }

    /** Slide transitions, as in src/lib/transitions.js. Flip, cube and morph are simplified. */
    private void transition(Graphics2D g0, Presentation.Transition tr, BufferedImage a, BufferedImage b, double[] box) {
        Graphics2D g = (Graphics2D) g0.create();
        try {
            double x = box[0], y = box[1], w = box[2], h = box[3];
            g.clip(new Rectangle2D.Double(x, y, w, h));
            double p = Painter.bezier(.4, 0, .2, 1, tr.progress());
            int dir = tr.forward() ? 1 : -1;
            switch (tr.fx()) {
                case "push" -> { draw(g, a, x - dir * p * w, y, w, h, 1); draw(g, b, x + dir * (1 - p) * w, y, w, h, 1); }
                case "cover" -> { draw(g, a, x, y, w, h, 1); draw(g, b, x + dir * (1 - p) * w, y, w, h, 1); }
                case "cube" -> {
                    // A turning box seen from the front: the old face narrows as the new one widens.
                    double s = 1 - .1 * Math.sin(Math.PI * p), top = y + h * (1 - s) / 2;
                    if (dir > 0) { draw(g, a, x, top, w * (1 - p), h * s, 1); draw(g, b, x + w * (1 - p), top, w * p, h * s, 1); }
                    else { draw(g, b, x, top, w * p, h * s, 1); draw(g, a, x + w * p, top, w * (1 - p), h * s, 1); }
                }
                case "wipe" -> {
                    draw(g, a, x, y, w, h, 1);
                    Graphics2D c = (Graphics2D) g.create();
                    c.clip(dir > 0 ? new Rectangle2D.Double(x, y, w * p, h) : new Rectangle2D.Double(x + w * (1 - p), y, w * p, h));
                    draw(c, b, x, y, w, h, 1);
                    c.dispose();
                }
                case "zoom" -> {
                    draw(g, a, x, y, w, h, 1 - p);
                    double s = .85 + .15 * p;
                    draw(g, b, x + w * (1 - s) / 2, y + h * (1 - s) / 2, w * s, h * s, p);
                }
                case "flip" -> {
                    if (p < .5) { double s = 1 - 2 * p; draw(g, a, x + w * (1 - s) / 2, y, w * s, h, 1); }
                    else { double s = 2 * p - 1; draw(g, b, x + w * (1 - s) / 2, y, w * s, h, 1); }
                }
                default -> { draw(g, a, x, y, w, h, 1); draw(g, b, x, y, w, h, p); }   // fade, morph
            }
        } finally {
            g.dispose();
        }
    }

    private static void draw(Graphics2D g, BufferedImage img, double x, double y, double w, double h, double alpha) {
        if (alpha <= 0 || w <= 0.5 || h <= 0.5) return;
        Graphics2D c = (Graphics2D) g.create();
        if (alpha < 1) c.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, (float) alpha));
        c.drawImage(img, (int) Math.round(x), (int) Math.round(y), (int) Math.round(w), (int) Math.round(h), null);
        c.dispose();
    }

    /** Drawn when there is no slide to show (e.g. "next" at the end of the deck). */
    protected void paintEmpty(Graphics2D g) {}
}
