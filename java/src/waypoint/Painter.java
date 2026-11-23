package waypoint;

import java.awt.AlphaComposite;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.GraphicsEnvironment;
import java.awt.Paint;
import java.awt.RenderingHints;
import java.awt.Shape;
import java.awt.font.FontRenderContext;
import java.awt.font.LineMetrics;
import java.awt.geom.AffineTransform;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Line2D;
import java.awt.geom.Path2D;
import java.awt.geom.Rectangle2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.imageio.ImageIO;

/**
 * Draws one slide with Java2D, matching how the web app lays it out (style.css and
 * SlideView.jsx), including builds part-way through their entrance effect.
 */
final class Painter {
    private static final Set<String> INSTALLED = new HashSet<>(Arrays.asList(
        GraphicsEnvironment.getLocalGraphicsEnvironment().getAvailableFontFamilyNames()));
    /** Metric-compatible stand-ins for Office fonts, as in src/lib/fonts.js. */
    private static final Map<String, String> SUBSTITUTE = Map.of(
        "Calibri", "Carlito", "Cambria", "Caladea", "Arial", "Arimo", "Helvetica", "Arimo", "Helvetica Neue", "Arimo",
        "Times New Roman", "Tinos", "Courier New", "Cousine", "Calibri Light", "Carlito");

    /** Polygons in 0-1 fractions of the box; the same table as GEOMS in deck.js. */
    static final Map<String, double[][]> GEOMS = Map.ofEntries(
        Map.entry("triangle", new double[][]{{.5, 0}, {1, 1}, {0, 1}}),
        Map.entry("rtTriangle", new double[][]{{0, 0}, {1, 1}, {0, 1}}),
        Map.entry("diamond", new double[][]{{.5, 0}, {1, .5}, {.5, 1}, {0, .5}}),
        Map.entry("parallelogram", new double[][]{{.25, 0}, {1, 0}, {.75, 1}, {0, 1}}),
        Map.entry("trapezoid", new double[][]{{.25, 0}, {.75, 0}, {1, 1}, {0, 1}}),
        Map.entry("pentagon", new double[][]{{.5, 0}, {1, .38}, {.81, 1}, {.19, 1}, {0, .38}}),
        Map.entry("hexagon", new double[][]{{.25, 0}, {.75, 0}, {1, .5}, {.75, 1}, {.25, 1}, {0, .5}}),
        Map.entry("octagon", new double[][]{{.29, 0}, {.71, 0}, {1, .29}, {1, .71}, {.71, 1}, {.29, 1}, {0, .71}, {0, .29}}),
        Map.entry("homePlate", new double[][]{{0, 0}, {.8, 0}, {1, .5}, {.8, 1}, {0, 1}}),
        Map.entry("chevron", new double[][]{{0, 0}, {.8, 0}, {1, .5}, {.8, 1}, {0, 1}, {.2, .5}}),
        Map.entry("rightArrow", new double[][]{{0, .25}, {.65, .25}, {.65, 0}, {1, .5}, {.65, 1}, {.65, .75}, {0, .75}}),
        Map.entry("leftArrow", new double[][]{{1, .25}, {.35, .25}, {.35, 0}, {0, .5}, {.35, 1}, {.35, .75}, {1, .75}}),
        Map.entry("upArrow", new double[][]{{.25, 1}, {.25, .35}, {0, .35}, {.5, 0}, {1, .35}, {.75, .35}, {.75, 1}}),
        Map.entry("downArrow", new double[][]{{.25, 0}, {.25, .65}, {0, .65}, {.5, 1}, {1, .65}, {.75, .65}, {.75, 0}}),
        Map.entry("plus", new double[][]{{.33, 0}, {.67, 0}, {.67, .33}, {1, .33}, {1, .67}, {.67, .67}, {.67, 1}, {.33, 1}, {.33, .67}, {0, .67}, {0, .33}, {.33, .33}}),
        Map.entry("star5", new double[][]{{.5, 0}, {.62, .38}, {1, .38}, {.69, .62}, {.81, 1}, {.5, .76}, {.19, 1}, {.31, .62}, {0, .38}, {.38, .38}}));

    /**
     * Which builds to show. Objects whose step is above `build` stay hidden; objects of step
     * `play` run their entrance effect, `t` seconds after it began (step 0 waits `delay0`,
     * the length of the slide transition). ALL shows the finished slide.
     */
    record Builds(int build, int play, double t, double delay0) {
        static final Builds ALL = new Builds(Integer.MAX_VALUE, -1, 0, 0);
        static Builds still(int build) { return new Builds(build, -1, 0, 0); }
    }

    private final Deck deck;
    private final String family;
    private final Map<String, Optional<BufferedImage>> images = new HashMap<>();
    private final Map<String, Font> fonts = new HashMap<>();

    Painter(Deck deck) {
        this.deck = deck;
        String pick = "SansSerif";
        for (String f : deck.theme().fonts()) if (INSTALLED.contains(f) || f.equals("Serif") || f.equals("SansSerif")) { pick = f; break; }
        this.family = pick;
    }

    void paint(Graphics2D g0, Deck.Slide slide, double x, double y, double w, double h) { paint(g0, slide, x, y, w, h, Builds.ALL); }

    /** Paints the slide into the box (x, y, w, h), letterboxed to 16:9. */
    void paint(Graphics2D g0, Deck.Slide slide, double x, double y, double w, double h, Builds builds) {
        double k = Math.min(w / Deck.W, h / Deck.H);
        double ox = x + (w - Deck.W * k) / 2, oy = y + (h - Deck.H * k) / 2;
        Graphics2D g = (Graphics2D) g0.create();
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_FRACTIONALMETRICS, RenderingHints.VALUE_FRACTIONALMETRICS_ON);
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
            g.translate(ox, oy);
            g.scale(k, k);
            g.clipRect(0, 0, Deck.W, Deck.H);
            paintNative(g, slide, builds);
        } finally {
            g.dispose();
        }
    }

    /** True while any object of the playing step is still mid-effect. */
    boolean animating(Deck.Slide slide, Builds b) {
        if (b.play() < 0) return false;
        for (Deck.El e : slide.els()) {
            if (e.buildStep() != b.play()) continue;
            if (b.t() < start(e, b) + length(e)) return true;
        }
        return false;
    }

    private static double start(Deck.El e, Builds b) { return (e.anim().step() == 0 ? b.delay0() : 0) + e.anim().delay(); }
    private static double length(Deck.El e) { return "appear".equals(e.anim().fx()) ? 0.01 : Math.max(0.01, e.anim().dur()); }

    private void paintNative(Graphics2D g, Deck.Slide slide, Builds builds) {
        Deck.Theme t = deck.theme();
        Paint bg = Deck.paint(slide.bg(), 0, 0, Deck.W, Deck.H);
        g.setPaint(bg != null ? bg : t.bg());
        g.fillRect(0, 0, Deck.W, Deck.H);
        BufferedImage bgImg = slide.bgImg().isEmpty() ? null : image(slide.bgImg());
        if (bgImg != null) {   // background-size: cover, centred
            double k = Math.max((double) Deck.W / bgImg.getWidth(), (double) Deck.H / bgImg.getHeight());
            double iw = bgImg.getWidth() * k, ih = bgImg.getHeight() * k;
            g.drawImage(bgImg, (int) Math.round((Deck.W - iw) / 2), (int) Math.round((Deck.H - ih) / 2), (int) Math.round(iw), (int) Math.round(ih), null);
        }
        for (Deck.El e : slide.els()) {
            int step = e.buildStep();
            if (step > builds.build()) continue;
            Fx fx = step >= 0 && step == builds.play() ? effect(e, (builds.t() - start(e, builds)) / length(e)) : Fx.NONE;
            if (fx.alpha() <= 0.001) continue;
            Graphics2D eg = (Graphics2D) g.create();
            try {
                double cx = e.x() + e.w() / 2, cy = e.y() + e.h() / 2;
                // CSS order: translate, rotate, scale, then the element's own transform (rotate), about its centre.
                eg.translate(cx + fx.dx(), cy + fx.dy());
                if (fx.rot() != 0) eg.rotate(Math.toRadians(fx.rot()));
                if (fx.scale() != 1) eg.scale(fx.scale(), fx.scale());
                if (e.rot() != 0) eg.rotate(Math.toRadians(e.rot()));
                eg.translate(-cx, -cy);
                if (fx.clip() < 1) eg.clip(new Rectangle2D.Double(e.x(), e.y() - 4000, e.w() * Math.max(0, fx.clip()), e.h() + 8000));
                float alpha = (float) Math.max(0, Math.min(1, fx.alpha() * e.opacity()));
                if (alpha < 1) eg.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, alpha));
                switch (e.type()) {
                    case "text" -> text(eg, e, t);
                    case "image" -> picture(eg, e);
                    case "line" -> line(eg, e, t);
                    default -> shape(eg, e, t);
                }
            } finally {
                eg.dispose();
            }
        }
    }

    /* ---------- build effects (the same keyframes as style.css) ---------- */

    private record Fx(double alpha, double dx, double dy, double scale, double rot, double clip) {
        static final Fx NONE = new Fx(1, 0, 0, 1, 0, 1);
    }

    private static Fx effect(Deck.El e, double p0) {
        double p = Math.max(0, Math.min(1, p0));
        double ease = bezier(.25, .1, .25, 1, p), fly = bezier(.2, .8, .2, 1, p);
        return switch (e.anim().fx()) {
            case "appear" -> new Fx(p >= 1 ? 1 : 0, 0, 0, 1, 0, 1);
            case "rise" -> new Fx(ease, 0, 60 * (1 - ease), 1, 0, 1);
            case "fly-left" -> new Fx(1, -1800 * (1 - fly), 0, 1, 0, 1);
            case "fly-right" -> new Fx(1, 1800 * (1 - fly), 0, 1, 0, 1);
            case "fly-up" -> new Fx(1, 0, 1000 * (1 - fly), 1, 0, 1);
            case "drop" -> new Fx(1, 0, keyframes(p, new double[]{0, .65, .82, 1}, new double[]{-1000, 24, -10, 0}), 1, 0, 1);
            case "zoom" -> new Fx(ease, 0, 0, .3 + .7 * ease, 0, 1);
            case "pop" -> new Fx(Math.min(1, ease / .65), 0, 0, keyframes(p, new double[]{0, .65, 1}, new double[]{0, 1.08, 1}), 0, 1);
            case "wipe" -> new Fx(1, 0, 0, 1, 0, p);
            case "blur" -> new Fx(ease, 0, 0, 1.08 - .08 * ease, 0, 1);
            case "spin" -> new Fx(ease, 0, 0, .2 + .8 * ease, -360 * (1 - ease), 1);
            default -> new Fx(ease, 0, 0, 1, 0, 1);   // fade, and anything newer than this presenter
        };
    }

    /** Piecewise keyframes, eased within each segment. */
    private static double keyframes(double p, double[] at, double[] v) {
        for (int i = 1; i < at.length; i++) {
            if (p <= at[i]) {
                double f = (p - at[i - 1]) / (at[i] - at[i - 1]);
                return v[i - 1] + (v[i] - v[i - 1]) * bezier(.42, 0, .58, 1, f);
            }
        }
        return v[v.length - 1];
    }

    /** CSS cubic-bezier timing function. */
    static double bezier(double x1, double y1, double x2, double y2, double x) {
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        double t = x;
        for (int i = 0; i < 8; i++) {   // Newton's method for t where bx(t) = x
            double bx = 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t - x;
            double d = 3 * x1 * (1 - t) * (1 - 3 * t) + 3 * x2 * t * (2 - 3 * t) + 3 * t * t;
            if (Math.abs(bx) < 1e-5 || d == 0) break;
            t = Math.max(0, Math.min(1, t - bx / d));
        }
        return 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t;
    }

    /* ---------- shapes, lines, pictures ---------- */

    private static double radius(Deck.El e, double fallback) { return e.radius() != null ? e.radius() : fallback; }

    private static Shape outline(Deck.El e) {
        double[][] poly = GEOMS.get(e.geom());
        if (poly != null) {
            Path2D p = new Path2D.Double();
            for (int i = 0; i < poly.length; i++) {
                double px = e.x() + poly[i][0] * e.w(), py = e.y() + poly[i][1] * e.h();
                if (i == 0) p.moveTo(px, py); else p.lineTo(px, py);
            }
            p.closePath();
            return p;
        }
        if ("ellipse".equals(e.type())) return new Ellipse2D.Double(e.x(), e.y(), e.w(), e.h());
        double r = Math.min(radius(e, "rect".equals(e.type()) ? 10 : 0), Math.min(e.w(), e.h()) / 2);
        return r > 0 ? new RoundRectangle2D.Double(e.x(), e.y(), e.w(), e.h(), 2 * r, 2 * r) : new Rectangle2D.Double(e.x(), e.y(), e.w(), e.h());
    }

    /** A CSS border: drawn inside the box (border-box), so clip to the shape and stroke twice as wide. */
    private static void border(Graphics2D g, Shape s, Deck.El e, Deck.Theme t) {
        if (e.lineW() <= 0) return;
        Color c = Deck.firstColor(e.line());
        Graphics2D bg = (Graphics2D) g.create();
        bg.clip(s);
        bg.setColor(c != null ? c : t.fg());
        bg.setStroke(new BasicStroke((float) (e.lineW() * 2)));
        bg.draw(s);
        bg.dispose();
    }

    private static void shape(Graphics2D g, Deck.El e, Deck.Theme t) {
        if (!e.pathD().isEmpty() && e.pathW() > 0 && e.pathH() > 0) { path(g, e, t); return; }
        Shape s = outline(e);
        Paint fill = e.fill().isEmpty() ? t.accent() : Deck.paint(e.fill(), e.x(), e.y(), e.w(), e.h());
        if (fill != null) { g.setPaint(fill); g.fill(s); }
        border(g, s, e, t);
    }

    private static final Pattern PATH_CMD = Pattern.compile("([MLCQZmlcqz])([^MLCQZmlcqz]*)");

    /** A freeform outline from the importer: SVG path data (M L C Q Z) in its own w x h box. */
    private static void path(Graphics2D g, Deck.El e, Deck.Theme t) {
        Path2D p = new Path2D.Double();
        Matcher m = PATH_CMD.matcher(e.pathD());
        while (m.find()) {
            String[] parts = m.group(2).trim().isEmpty() ? new String[0] : m.group(2).trim().split("[\\s,]+");
            double[] n = new double[parts.length];
            try { for (int i = 0; i < parts.length; i++) n[i] = Double.parseDouble(parts[i]); } catch (NumberFormatException ex) { return; }
            switch (Character.toUpperCase(m.group(1).charAt(0))) {
                case 'M' -> { if (n.length >= 2) p.moveTo(n[0], n[1]); }
                case 'L' -> { for (int i = 0; i + 1 < n.length; i += 2) p.lineTo(n[i], n[i + 1]); }
                case 'C' -> { for (int i = 0; i + 5 < n.length; i += 6) p.curveTo(n[i], n[i + 1], n[i + 2], n[i + 3], n[i + 4], n[i + 5]); }
                case 'Q' -> { for (int i = 0; i + 3 < n.length; i += 4) p.quadTo(n[i], n[i + 1], n[i + 2], n[i + 3]); }
                default -> p.closePath();
            }
        }
        AffineTransform at = new AffineTransform();
        at.translate(e.x(), e.y());
        at.scale(e.w() / e.pathW(), e.h() / e.pathH());
        if (e.flipH()) { at.translate(e.pathW(), 0); at.scale(-1, 1); }
        if (e.flipV()) { at.translate(0, e.pathH()); at.scale(1, -1); }
        Shape s = at.createTransformedShape(p);
        Paint fill = e.fill().isEmpty() ? t.accent() : Deck.paint(e.fill(), e.x(), e.y(), e.w(), e.h());
        if (fill != null) { g.setPaint(fill); g.fill(s); }
        if (e.lineW() > 0) {
            Color c = Deck.firstColor(e.line());
            g.setColor(c != null ? c : t.fg());
            g.setStroke(new BasicStroke((float) e.lineW(), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            g.draw(s);
        }
    }

    private static void line(Graphics2D g, Deck.El e, Deck.Theme t) {
        double x1 = e.flipH() ? e.x() + e.w() : e.x(), y1 = e.flipV() ? e.y() + e.h() : e.y();
        double x2 = e.flipH() ? e.x() : e.x() + e.w(), y2 = e.flipV() ? e.y() : e.y() + e.h();
        Color c = Deck.firstColor(e.line());
        g.setColor(c != null ? c : t.fg());
        double sw = e.lineW() > 0 ? e.lineW() : 4;
        g.setStroke(new BasicStroke((float) sw, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.draw(new Line2D.Double(x1, y1, x2, y2));
        if (e.arrow().equals("end") || e.arrow().equals("both")) arrowHead(g, x1, y1, x2, y2, sw);
        if (e.arrow().equals("start") || e.arrow().equals("both")) arrowHead(g, x2, y2, x1, y1, sw);
    }

    /** The SVG marker in SlideView: a triangle 4 stroke-widths long, tip on the end point. */
    private static void arrowHead(Graphics2D g, double x1, double y1, double x2, double y2, double sw) {
        double a = Math.atan2(y2 - y1, x2 - x1), len = 4 * sw * .8, half = 4 * sw / 2;
        Path2D p = new Path2D.Double();
        p.moveTo(x2 + Math.cos(a) * len * .25, y2 + Math.sin(a) * len * .25);
        p.lineTo(x2 - Math.cos(a) * len * .75 - Math.sin(a) * half * .5, y2 - Math.sin(a) * len * .75 + Math.cos(a) * half * .5);
        p.lineTo(x2 - Math.cos(a) * len * .75 + Math.sin(a) * half * .5, y2 - Math.sin(a) * len * .75 - Math.cos(a) * half * .5);
        p.closePath();
        g.fill(p);
    }

    private BufferedImage image(String id) {
        return images.computeIfAbsent(id, k -> Optional.ofNullable(decode(deck.assets.get(k)))).orElse(null);
    }

    private void picture(Graphics2D g, Deck.El e) {
        BufferedImage img = image(e.src());
        Shape box = outline(e);
        if (e.radius() != null || GEOMS.containsKey(e.geom())) g.clip(box);
        if (img != null) {
            double[] c = e.crop() != null ? e.crop() : new double[4];
            int iw = img.getWidth(), ih = img.getHeight();
            int sx = (int) Math.round(iw * c[0]), sy = (int) Math.round(ih * c[1]);
            int sw = Math.max(1, (int) Math.round(iw * (1 - c[0] - c[2]))), sh = Math.max(1, (int) Math.round(ih * (1 - c[1] - c[3])));
            g.drawImage(img, (int) Math.round(e.x()), (int) Math.round(e.y()), (int) Math.round(e.x() + e.w()), (int) Math.round(e.y() + e.h()),
                sx, sy, sx + sw, sy + sh, null);
        } else {   // e.g. WebP, which the JDK cannot read without a plugin
            g.setColor(new Color(0, 0, 0, 40));
            g.fill(new Rectangle2D.Double(e.x(), e.y(), e.w(), e.h()));
            g.setColor(new Color(0, 0, 0, 120));
            g.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 28));
            g.drawString("image", (float) (e.x() + 16), (float) (e.y() + 40));
        }
        border(g, box, e, deck.theme());
    }

    private static BufferedImage decode(String dataUrl) {
        if (dataUrl == null) return null;
        int comma = dataUrl.indexOf(',');
        if (comma < 0 || !dataUrl.substring(0, comma).endsWith(";base64")) return null;
        try {
            return ImageIO.read(new ByteArrayInputStream(Base64.getDecoder().decode(dataUrl.substring(comma + 1))));
        } catch (Exception ex) {
            return null;
        }
    }

    /* ---------- text ---------- */

    private Font font(String name, boolean bold, boolean italic, double size) {
        String fam = family;
        if (name != null && !name.isBlank()) {
            if (INSTALLED.contains(name)) fam = name;
            else if (SUBSTITUTE.containsKey(name) && INSTALLED.contains(SUBSTITUTE.get(name))) fam = SUBSTITUTE.get(name);
        }
        String key = fam + (bold ? "/b" : "") + (italic ? "/i" : "") + "/" + size;
        String f = fam;
        return fonts.computeIfAbsent(key, k -> new Font(f, (bold ? Font.BOLD : 0) | (italic ? Font.ITALIC : 0), 1).deriveFont((float) size));
    }

    private record Seg(String s, Font f, Color c, boolean u, double w) {}
    private record Row(List<Seg> segs, double w, double h, double base, double left, double avail, String align, Seg bullet) {}

    private void text(Graphics2D g, Deck.El e, Deck.Theme t) {
        Paint fill = Deck.paint(e.fill(), e.x(), e.y(), e.w(), e.h());
        boolean filled = fill != null;
        double r = Math.min(radius(e, filled ? 10 : 0), Math.min(e.w(), e.h()) / 2);
        Shape box = r > 0 ? new RoundRectangle2D.Double(e.x(), e.y(), e.w(), e.h(), 2 * r, 2 * r) : new Rectangle2D.Double(e.x(), e.y(), e.w(), e.h());
        if (filled) { g.setPaint(fill); g.fill(box); }
        border(g, box, e, t);

        double[] pad = e.pad() != null ? e.pad() : filled ? new double[]{0, 24, 0, 24} : new double[4];
        double innerX = e.x() + pad[3] + (e.lineW() > 0 ? e.lineW() : 0), innerW = e.w() - pad[1] - pad[3] - (e.lineW() > 0 ? 2 * e.lineW() : 0);
        double innerY = e.y() + pad[0] + Math.max(0, e.lineW()), innerH = e.h() - pad[0] - pad[2] - Math.max(0, 2 * e.lineW());
        Color base = Deck.firstColor(e.color());
        if (base == null) base = t.fg();

        List<Deck.Para> paras = e.rich() != null ? e.rich() : new ArrayList<>();
        if (e.rich() == null) for (String line : e.text().split("\n", -1))
            paras.add(new Deck.Para("", 0, "", 0, 0, List.of(new Deck.Run(line, null, null, false, "", 0, ""))));

        FontRenderContext frc = g.getFontRenderContext();
        List<Row> rows = new ArrayList<>();
        List<Double> gaps = new ArrayList<>();   // space above each row (paragraph "before")
        for (Deck.Para p : paras) {
            double em = p.size() > 0 ? p.size() : e.size();
            if (p.size() <= 0) for (Deck.Run run : p.runs()) if (run.size() > 0) { em = run.size(); break; }
            double indent = p.lvl() * 1.1 * em, bulletW = p.bullet().isEmpty() ? 0 : 1.1 * em;
            double left = innerX + indent + bulletW, avail = Math.max(1, innerW - indent - bulletW);
            String align = p.align().isEmpty() ? e.align() : p.align();
            Seg bullet = null;
            if (!p.bullet().isEmpty()) {
                Font bf = font(e.font(), e.bold(), e.italic(), em);
                bullet = new Seg(p.bullet(), bf, base, false, bf.getStringBounds(p.bullet(), frc).getWidth());
            }
            List<List<Seg>> lines = new ArrayList<>();
            List<Seg> cur = new ArrayList<>();
            double curW = 0;
            for (Deck.Run run : p.runs()) {
                Font f = font(run.font().isEmpty() ? e.font() : run.font(), run.b() != null ? run.b() : e.bold(), run.i() != null ? run.i() : e.italic(),
                    run.size() > 0 ? run.size() : em);
                Color c = Deck.firstColor(run.color());
                if (c == null) c = base;
                boolean u = run.u() || e.underline();
                String[] hard = run.t().split("\n", -1);
                for (int hi = 0; hi < hard.length; hi++) {
                    if (hi > 0) { lines.add(cur); cur = new ArrayList<>(); curW = 0; }
                    for (String word : hard[hi].split("(?<= )")) {
                        if (word.isEmpty()) continue;
                        double ww = f.getStringBounds(word, frc).getWidth(), trimmed = f.getStringBounds(word.stripTrailing(), frc).getWidth();
                        if (!e.nowrap() && !cur.isEmpty() && curW + trimmed > avail) { lines.add(cur); cur = new ArrayList<>(); curW = 0; }
                        // A word wider than the box breaks by character (overflow-wrap: break-word).
                        while (!e.nowrap() && cur.isEmpty() && trimmed > avail && word.length() > 1) {
                            int cut = word.length() - 1;
                            while (cut > 1 && f.getStringBounds(word.substring(0, cut), frc).getWidth() > avail) cut--;
                            String head = word.substring(0, cut);
                            lines.add(List.of(new Seg(head, f, c, u, f.getStringBounds(head, frc).getWidth())));
                            word = word.substring(cut);
                            ww = f.getStringBounds(word, frc).getWidth();
                            trimmed = f.getStringBounds(word.stripTrailing(), frc).getWidth();
                        }
                        cur.add(new Seg(word, f, c, u, ww));
                        curW += ww;
                    }
                }
            }
            lines.add(cur);
            for (int li = 0; li < lines.size(); li++) {
                List<Seg> segs = lines.get(li);
                double h = 0, b = 0, w = 0;
                for (Seg s : segs) {
                    LineMetrics lm = s.f().getLineMetrics(s.s(), frc);
                    double size = s.f().getSize2D(), lineH = size * e.lh();
                    h = Math.max(h, lineH);
                    b = Math.max(b, (lineH - (lm.getAscent() + lm.getDescent())) / 2 + lm.getAscent());
                    w += s.w();
                }
                if (!segs.isEmpty()) w -= segs.get(segs.size() - 1).w() - segs.get(segs.size() - 1).f().getStringBounds(segs.get(segs.size() - 1).s().stripTrailing(), frc).getWidth();
                if (segs.isEmpty()) {   // an empty line keeps the paragraph's height
                    Font f = font(e.font(), e.bold(), e.italic(), em);
                    LineMetrics lm = f.getLineMetrics("Ag", frc);
                    h = em * e.lh();
                    b = (h - (lm.getAscent() + lm.getDescent())) / 2 + lm.getAscent();
                }
                if (li == 0 && bullet != null) {
                    LineMetrics lm = bullet.f().getLineMetrics(bullet.s(), frc);
                    h = Math.max(h, em * e.lh());
                    b = Math.max(b, (em * e.lh() - (lm.getAscent() + lm.getDescent())) / 2 + lm.getAscent());
                }
                rows.add(new Row(segs, w, h, b, left, avail, align, li == 0 ? bullet : null));
                gaps.add(li == 0 ? p.before() : 0);
            }
        }

        double total = 0;
        for (int i = 0; i < rows.size(); i++) total += rows.get(i).h() + gaps.get(i);
        String valign = e.valign().isEmpty() ? (filled ? "middle" : "top") : e.valign();
        double y = switch (valign) {
            case "middle" -> innerY + (innerH - total) / 2;
            case "bottom" -> innerY + innerH - total;
            default -> innerY;
        };
        for (int i = 0; i < rows.size(); i++) {
            Row row = rows.get(i);
            y += gaps.get(i);
            double x = switch (row.align()) {
                case "center" -> row.left() + (row.avail() - row.w()) / 2;
                case "right" -> row.left() + row.avail() - row.w();
                default -> row.left();
            };
            float baseline = (float) (y + row.base());
            if (row.bullet() != null) {
                g.setFont(row.bullet().f());
                g.setColor(row.bullet().c());
                double bx = "left".equals(row.align()) || row.align().isEmpty() || "justify".equals(row.align()) ? row.left() - row.bullet().f().getSize2D() * 1.1 : x - row.bullet().f().getSize2D() * 1.1;
                g.drawString(row.bullet().s(), (float) bx, baseline);
            }
            for (Seg s : row.segs()) {
                g.setFont(s.f());
                g.setColor(s.c());
                g.drawString(s.s(), (float) x, baseline);
                if (s.u()) {
                    double size = s.f().getSize2D(), tw = s.f().getStringBounds(s.s().stripTrailing(), frc).getWidth();
                    g.fill(new Rectangle2D.Double(x, baseline + size * .1, tw, Math.max(1, size * .06)));
                }
                x += s.w();
            }
            y += row.h();
        }
    }

    /** Which linked element (if any) is under a point in slide coordinates. */
    int linkAt(Deck.Slide slide, double sx, double sy) {
        List<Deck.El> els = slide.els();
        for (int n = els.size() - 1; n >= 0; n--) {
            Deck.El e = els.get(n);
            if (e.link().isEmpty()) continue;
            if (sx >= e.x() && sx <= e.x() + e.w() && sy >= e.y() && sy <= e.y() + e.h()) {
                int j = deck.indexOf(e.link());
                if (j >= 0) return j;
            }
        }
        return -1;
    }
}
