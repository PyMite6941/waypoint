package waypoint;

import java.awt.Color;
import java.awt.LinearGradientPaint;
import java.awt.Paint;
import java.awt.geom.Point2D;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A Waypoint deck, read from a .waypoint.json file. Mirrors src/lib/deck.js:
 * slides on a 1600 x 900 canvas, each with elements (text, rect, ellipse, image, line).
 * Every field added after the first version is optional, as in the web app.
 */
final class Deck {
    static final int W = 1600, H = 900;
    // CSS colour syntax. Declared first: THEMES below parses colours while the class loads.
    private static final Pattern RGB = Pattern.compile("rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,\\s/]+([\\d.]+%?))?\\s*\\)");
    private static final Pattern COLOR = Pattern.compile("#[0-9a-fA-F]{3,8}\\b|rgba?\\([^)]*\\)|transparent");
    private static final Pattern ANGLE = Pattern.compile("linear-gradient\\(\\s*(-?[\\d.]+)deg");
    private static final Pattern STOP = Pattern.compile("(#[0-9a-fA-F]{3,8}\\b|rgba?\\([^)]*\\))\\s*(-?[\\d.]+%)?");

    /** A build (entrance effect): plays on click `step` (0: with the slide). */
    record Anim(String fx, int step, double dur, double delay) {}

    /** One styled run of rich text. Null fields inherit from the element. */
    record Run(String t, Boolean b, Boolean i, boolean u, String color, double size, String font) {}

    record Para(String align, int lvl, String bullet, double size, double before, List<Run> runs) {}

    record El(String id, String type, double x, double y, double w, double h, String text, double size,
              boolean bold, boolean italic, boolean underline, String align, String valign, double lh, double[] pad, boolean nowrap,
              String color, String fill, String font, String src, String link,
              double rot, double opacity, String line, double lineW, Double radius, String geom,
              String pathD, double pathW, double pathH, double[] crop, String flip, String arrow,
              Anim anim, List<Para> rich) {
        int buildStep() { return anim == null ? -1 : anim.step(); }
        boolean flipH() { return flip.contains("h"); }
        boolean flipV() { return flip.contains("v"); }
    }

    record Trans(String fx, double dur) {}

    record Slide(String id, String bg, String bgImg, Trans trans, String name, String notes, List<String> next, List<El> els) {
        String title() {
            for (El e : els) {
                if ("text".equals(e.type()) && e.text() != null && !e.text().isBlank()) {
                    String t = e.text().strip().split("\n", 2)[0].replaceFirst("^[•◦▪\\-*–]\\s+", "");
                    return t.length() > 40 ? t.substring(0, 40) : t;
                }
            }
            return name.isBlank() ? "Untitled" : name;
        }

        /** How many clicks of builds this slide has before Next moves on. */
        int buildSteps() {
            int n = 0;
            for (El e : els) if (e.anim() != null) n = Math.max(n, e.anim().step());
            return n;
        }
    }

    /** Theme colours and font families, as in style.css. */
    record Theme(Color bg, Color fg, Color accent, String[] fonts) {}

    static final Map<String, Theme> THEMES = Map.of(
        "paper", new Theme(hex("#fbfaf7"), hex("#1c1b19"), hex("#c2410c"), new String[]{"Iowan Old Style", "Palatino Linotype", "Palatino", "Georgia", "Serif"}),
        "ink", new Theme(hex("#121315"), hex("#f1efea"), hex("#e9b44c"), new String[]{"Segoe UI", "SF Pro Text", "Roboto", "SansSerif"}),
        "chalk", new Theme(hex("#1f3a34"), hex("#eef3ee"), hex("#f2c14e"), new String[]{"Avenir Next", "Avenir", "Segoe UI", "SansSerif"}),
        "signal", new Theme(hex("#ffffff"), hex("#0b1f33"), hex("#1d4ed8"), new String[]{"Helvetica Neue", "Helvetica", "Arial", "SansSerif"})
    );

    final String title;
    final String theme;
    final Map<String, String> assets;
    final List<Slide> slides;

    private Deck(String title, String theme, Map<String, String> assets, List<Slide> slides) {
        this.title = title; this.theme = theme; this.assets = assets; this.slides = slides;
    }

    Theme theme() { return THEMES.getOrDefault(theme, THEMES.get("paper")); }

    int indexOf(String slideId) {
        for (int i = 0; i < slides.size(); i++) if (slides.get(i).id().equals(slideId)) return i;
        return -1;
    }

    /** The slides a slide offers as jumps, as indexes, skipping deleted ones. */
    List<Integer> choices(Slide s) {
        List<Integer> out = new ArrayList<>();
        for (String id : s.next()) { int j = indexOf(id); if (j >= 0) out.add(j); }
        return out;
    }

    int clamp(int i) { return Math.max(0, Math.min(slides.size() - 1, i)); }

    static Deck load(Path file) throws IOException {
        Object root = Json.parse(Files.readString(file, StandardCharsets.UTF_8));
        if (!(root instanceof Map<?, ?> d) || !(d.get("slides") instanceof List<?> raw) || raw.isEmpty())
            throw new IOException("Not a Waypoint deck");

        Map<String, String> assets = new HashMap<>();
        if (d.get("assets") instanceof Map<?, ?> a)
            a.forEach((k, v) -> { if (v instanceof String src && src.startsWith("data:image/")) assets.put(String.valueOf(k), src); });

        // Custom animations (made in the web or desktop app) play here as a fade; emphasis ones,
        // which act on an object already on the slide, leave it showing all along. So do entrances
        // started by clicking another object (triggers). Later actions (el.acts: exits, moves,
        // emphasis) are not played here; the object stays where it was placed.
        java.util.Set<String> emphasis = new java.util.HashSet<>();
        if (d.get("anims") instanceof Map<?, ?> an)
            an.forEach((k, v) -> { if (v instanceof Map<?, ?> m && "emphasis".equals(m.get("kind"))) emphasis.add("custom:" + k); });

        List<Slide> slides = new ArrayList<>();
        int n = 0;
        for (Object o : raw) {
            if (!(o instanceof Map<?, ?> s)) continue;
            List<String> next = new ArrayList<>();
            if (s.get("next") instanceof List<?> l) for (Object x : l) if (x instanceof String id) next.add(id);
            List<El> els = new ArrayList<>();
            if (s.get("els") instanceof List<?> l) for (Object x : l) if (x instanceof Map<?, ?> e) els.add(el(e, emphasis));
            Trans trans = null;
            if (s.get("trans") instanceof Map<?, ?> t && t.get("fx") instanceof String fx && !fx.equals("none"))
                trans = new Trans(fx, num(t.get("dur"), 0.6));
            slides.add(new Slide(str(s.get("id"), "s" + n++), str(s.get("bg"), ""), str(s.get("bgImg"), ""), trans,
                str(s.get("name"), ""), str(s.get("notes"), ""), next, els));
        }
        String theme = str(d.get("theme"), "paper");
        return new Deck(str(d.get("title"), "Untitled deck"), THEMES.containsKey(theme) ? theme : "paper", assets, slides);
    }

    private static El el(Map<?, ?> e, java.util.Set<String> emphasis) {
        Anim anim = null;
        if (e.get("anim") instanceof Map<?, ?> a && a.get("fx") instanceof String fx && !fx.isEmpty() && !emphasis.contains(fx) && !(a.get("on") instanceof String))
            anim = new Anim(fx, (int) num(a.get("step"), 0), num(a.get("dur"), 0.5), num(a.get("delay"), 0));
        List<Para> rich = null;
        if (e.get("rich") instanceof List<?> ps && !ps.isEmpty()) {
            rich = new ArrayList<>();
            for (Object o : ps) {
                if (!(o instanceof Map<?, ?> p)) continue;
                List<Run> runs = new ArrayList<>();
                if (p.get("runs") instanceof List<?> rs) for (Object r0 : rs) if (r0 instanceof Map<?, ?> r)
                    runs.add(new Run(str(r.get("t"), ""), bool(r.get("b")), bool(r.get("i")), Boolean.TRUE.equals(r.get("u")),
                        str(r.get("color"), ""), num(r.get("size"), 0), str(r.get("font"), "")));
                rich.add(new Para(str(p.get("align"), ""), (int) num(p.get("lvl"), 0), str(p.get("bullet"), ""),
                    num(p.get("size"), 0), num(p.get("before"), 0), runs));
            }
        }
        String pathD = "";
        double pathW = 0, pathH = 0;
        if (e.get("path") instanceof Map<?, ?> p) { pathD = str(p.get("d"), ""); pathW = num(p.get("w"), 0); pathH = num(p.get("h"), 0); }
        String type = str(e.get("type"), "rect");
        return new El(str(e.get("id"), ""), type,
            num(e.get("x"), 0), num(e.get("y"), 0), num(e.get("w"), 0), num(e.get("h"), 0),
            str(e.get("text"), ""), num(e.get("size"), 0) > 0 ? num(e.get("size"), 0) : 38,
            Boolean.TRUE.equals(e.get("bold")), Boolean.TRUE.equals(e.get("italic")), Boolean.TRUE.equals(e.get("underline")),
            str(e.get("align"), "left"), str(e.get("valign"), ""), num(e.get("lh"), 1.25), nums(e.get("pad"), 4), Boolean.TRUE.equals(e.get("nowrap")),
            str(e.get("color"), ""), str(e.get("fill"), ""), str(e.get("font"), ""), str(e.get("src"), ""), str(e.get("link"), ""),
            num(e.get("rot"), 0), num(e.get("opacity"), 1), str(e.get("line"), ""), num(e.get("lineW"), 0),
            e.get("radius") instanceof Double r ? r : null, str(e.get("geom"), ""),
            pathD, pathW, pathH, nums(e.get("crop"), 4), str(e.get("flip"), ""), str(e.get("arrow"), ""),
            anim, rich);
    }

    private static String str(Object o, String fallback) { return o instanceof String s ? s : fallback; }
    private static double num(Object o, double fallback) { return o instanceof Double v && !v.isNaN() ? v : fallback; }
    private static Boolean bool(Object o) { return o instanceof Boolean b ? b : null; }
    private static double[] nums(Object o, int n) {
        if (!(o instanceof List<?> l) || l.size() != n) return null;
        double[] out = new double[n];
        for (int i = 0; i < n; i++) out[i] = num(l.get(i), 0);
        return out;
    }

    /* ---------- CSS colours ---------- */


    /** Parses #rgb, #rrggbb, #rrggbbaa, rgb(), rgba() and "transparent"; null for anything else (empty means "use the theme"). */
    static Color hex(String s) {
        if (s == null) return null;
        s = s.strip();
        if (s.equals("transparent")) return new Color(0, 0, 0, 0);
        Matcher m = RGB.matcher(s);
        if (m.matches()) {
            int a = 255;
            if (m.group(4) != null) {
                String v = m.group(4);
                double f = v.endsWith("%") ? Double.parseDouble(v.substring(0, v.length() - 1)) / 100 : Double.parseDouble(v);
                a = (int) Math.round(Math.max(0, Math.min(1, f)) * 255);
            }
            return new Color(clamp255(m.group(1)), clamp255(m.group(2)), clamp255(m.group(3)), a);
        }
        if (!s.startsWith("#")) return null;
        String h = s.substring(1);
        if (h.length() == 3 || h.length() == 4) {
            StringBuilder b = new StringBuilder();
            for (char c : h.toCharArray()) b.append(c).append(c);
            h = b.toString();
        }
        try {
            if (h.length() == 6) return new Color(Integer.parseInt(h, 16));
            if (h.length() == 8) return new Color(Integer.parseInt(h.substring(0, 6), 16) | Integer.parseInt(h.substring(6), 16) << 24, true);
        } catch (NumberFormatException ex) { /* fall through */ }
        return null;
    }

    private static int clamp255(String v) { return (int) Math.max(0, Math.min(255, Math.round(Double.parseDouble(v)))); }


    /**
     * A CSS background as a Java paint over the box (x, y, w, h): a colour, or a linear
     * gradient (as the PowerPoint importer writes them). Other gradients use their first colour.
     */
    static Paint paint(String css, double x, double y, double w, double h) {
        if (css == null || css.isBlank()) return null;
        if (!css.contains("gradient")) return hex(css);
        List<Color> colors = new ArrayList<>();
        List<Float> stops = new ArrayList<>();
        Matcher m = STOP.matcher(css);
        while (m.find()) {
            Color c = hex(m.group(1));
            if (c == null) continue;
            colors.add(c);
            stops.add(m.group(2) == null ? Float.NaN : Float.parseFloat(m.group(2).replace("%", "")) / 100f);
        }
        if (colors.isEmpty()) return null;
        if (colors.size() == 1 || !css.startsWith("linear")) return colors.get(0);
        // Even spacing for stops without a position; positions must strictly increase.
        float[] f = new float[colors.size()];
        for (int i = 0; i < f.length; i++) {
            float v = Float.isNaN(stops.get(i)) ? (float) i / (f.length - 1) : stops.get(i);
            f[i] = Math.max(i == 0 ? 0f : Math.min(1f, f[i - 1] + 1e-4f), Math.min(1f, v));
        }
        for (int i = f.length - 2; i >= 0; i--) if (f[i] >= f[i + 1]) f[i] = f[i + 1] - 1e-4f;
        if (f[0] < 0) return colors.get(0);
        Matcher a = ANGLE.matcher(css);
        double deg = a.find() ? Double.parseDouble(a.group(1)) : 180;   // CSS default: to bottom
        double rad = Math.toRadians(deg), dx = Math.sin(rad), dy = -Math.cos(rad);
        double len = Math.abs(w * dx) + Math.abs(h * dy), cx = x + w / 2, cy = y + h / 2;
        Point2D p0 = new Point2D.Double(cx - dx * len / 2, cy - dy * len / 2), p1 = new Point2D.Double(cx + dx * len / 2, cy + dy * len / 2);
        if (p0.distance(p1) < 1e-3) return colors.get(0);
        return new LinearGradientPaint(p0, p1, f, colors.toArray(new Color[0]));
    }

    /** The first colour named anywhere in a CSS value (for borders and text). */
    static Color firstColor(String css) {
        if (css == null) return null;
        Color c = hex(css);
        if (c != null) return c;
        Matcher m = COLOR.matcher(css);
        return m.find() ? hex(m.group()) : null;
    }
}
