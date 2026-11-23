package waypoint;

import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.Container;
import java.awt.Cursor;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.GraphicsConfiguration;
import java.awt.LayoutManager;
import java.awt.Rectangle;
import java.awt.RenderingHints;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JSplitPane;
import javax.swing.JTextArea;
import javax.swing.Scrollable;
import javax.swing.SwingUtilities;
import javax.swing.Timer;

/**
 * The presenter's screen, laid out like Keynote's presenter display: current slide,
 * next slide and notes on the left; every slide in the deck on a light table on the
 * right. Click any slide to send the audience there, whether or not "next" would.
 */
final class ControllerWindow extends JFrame {
    static final Color BG = new Color(0x131314), PANEL = new Color(0x1b1b1d), TEXT = new Color(0xe6e4df),
        DIM = new Color(0x8d8a83), ACCENT = new Color(0xf08a4b), NEXT = new Color(0x4b6b8f), CHOICE = new Color(0x8a7344);

    private final Presentation show;
    private final JLabel pos = label("", 18f), clock = label("", 18f), nextLabel = label("NEXT", 11f), nowLabel = label("CURRENT", 11f);
    private final JButton timer = button("00:00");
    private final JTextArea notes = new JTextArea();
    private final JPanel choices = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
    private final LightTable table = new LightTable();
    private long started = System.currentTimeMillis();
    String typed = "";

    ControllerWindow(Presentation show, GraphicsConfiguration screen, String where, Runnable onEnd) {
        super("Presenter · " + show.deck().title, screen);
        this.show = show;
        setDefaultCloseOperation(DO_NOTHING_ON_CLOSE);
        addWindowListener(new java.awt.event.WindowAdapter() {
            @Override public void windowClosing(java.awt.event.WindowEvent e) { onEnd.run(); }
        });
        getContentPane().setBackground(BG);
        setLayout(new BorderLayout(0, 10));
        ((JComponent) getContentPane()).setBorder(BorderFactory.createEmptyBorder(12, 12, 12, 12));

        // Top bar: timer, position, where the slides are, navigation, clock, end.
        JPanel bar = row();
        timer.setFont(timer.getFont().deriveFont(22f));
        timer.setToolTipText("Click to reset");
        timer.addActionListener(e -> { started = System.currentTimeMillis(); tick(); });
        bar.add(timer); bar.add(Box.createHorizontalStrut(10));
        bar.add(pos); bar.add(Box.createHorizontalStrut(10));
        JLabel whereLabel = label(where, 13f);
        whereLabel.setForeground(DIM);
        bar.add(whereLabel); bar.add(Box.createHorizontalStrut(10));
        bar.add(Box.createHorizontalGlue()); bar.add(Box.createHorizontalStrut(12));
        bar.add(action("‹ Prev", () -> show.step(-1))); bar.add(Box.createHorizontalStrut(10));
        bar.add(action("↩ Back", show::back)); bar.add(Box.createHorizontalStrut(10));
        JButton next = action("Next ›", () -> show.step(1));
        next.setBackground(ACCENT);
        next.setForeground(new Color(0x1a1a1a));
        bar.add(next); bar.add(Box.createHorizontalStrut(10));
        bar.add(action("Black", show::toggleBlack)); bar.add(Box.createHorizontalStrut(10));
        bar.add(clock); bar.add(Box.createHorizontalStrut(10));
        JButton end = action("End show", onEnd);
        end.setForeground(new Color(0xffb3a1));
        bar.add(end); bar.add(Box.createHorizontalStrut(10));
        add(bar, BorderLayout.NORTH);

        // Left: current, next, choices, notes.
        JPanel left = new JPanel();
        left.setLayout(new BoxLayout(left, BoxLayout.Y_AXIS));
        left.setBackground(BG);
        SlideCanvas now = new SlideCanvas(show, show::at, Color.BLACK, SlideCanvas.Mode.LIVE);
        now.setBorder(BorderFactory.createLineBorder(ACCENT, 2));
        SlideCanvas after = new SlideCanvas(show, () -> show.at() + 1, Color.BLACK, SlideCanvas.Mode.NEXT) {
            @Override protected void paintEmpty(Graphics2D g) {
                g.setColor(DIM);
                g.setFont(getFont().deriveFont(16f));
                String s = "End of deck";
                g.drawString(s, (getWidth() - g.getFontMetrics().stringWidth(s)) / 2, getHeight() / 2);
            }
        };
        after.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        after.addMouseListener(new MouseAdapter() { @Override public void mouseClicked(MouseEvent e) { if (!FocusGuard.justFocused()) show.step(1); } });
        choices.setOpaque(false);
        notes.setEditable(false);
        notes.setLineWrap(true);
        notes.setWrapStyleWord(true);
        notes.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 20));
        notes.setBackground(PANEL);
        notes.setForeground(TEXT);
        notes.setBorder(BorderFactory.createEmptyBorder(10, 12, 10, 12));
        notes.setFocusable(false);
        JScrollPane notesScroll = new JScrollPane(notes);
        notesScroll.setBorder(null);
        left.add(aligned(nowLabel));
        left.add(Box.createVerticalStrut(6));
        left.add(aligned(sixteenNine(now, 1.0)));
        left.add(Box.createVerticalStrut(10));
        left.add(aligned(nextLabel));
        left.add(Box.createVerticalStrut(6));
        left.add(aligned(sixteenNine(after, 0.62)));
        left.add(Box.createVerticalStrut(8));
        left.add(aligned(choices));
        left.add(Box.createVerticalStrut(8));
        left.add(aligned(label("NOTES", 11f)));
        left.add(Box.createVerticalStrut(6));
        left.add(aligned(notesScroll));

        // Right: the light table.
        JPanel right = new JPanel(new BorderLayout(0, 8));
        right.setBackground(PANEL);
        right.setBorder(BorderFactory.createEmptyBorder(10, 10, 10, 10));
        JPanel head = row();
        head.setOpaque(false);
        head.add(label("ALL SLIDES", 11f));
        head.add(Box.createHorizontalGlue());
        JLabel colsLabel = label("Click a slide to show it   ·   Columns", 12f);
        colsLabel.setMinimumSize(colsLabel.getPreferredSize());
        colsLabel.setMaximumSize(colsLabel.getPreferredSize());
        head.add(colsLabel);
        head.add(Box.createHorizontalStrut(8));
        JButton three = button("3"), four = button("4");
        Runnable mark = () -> {
            three.setForeground(table.cols == 3 ? ACCENT : TEXT);
            four.setForeground(table.cols == 4 ? ACCENT : TEXT);
        };
        three.addActionListener(e -> { table.setCols(3); mark.run(); });
        four.addActionListener(e -> { table.setCols(4); mark.run(); });
        head.add(three);
        head.add(Box.createHorizontalStrut(4));
        head.add(four);
        mark.run();
        right.add(head, BorderLayout.NORTH);
        JScrollPane scroll = new JScrollPane(table);
        scroll.setBorder(null);
        scroll.getViewport().setBackground(PANEL);
        scroll.getVerticalScrollBar().setUnitIncrement(24);
        right.add(scroll, BorderLayout.CENTER);

        JSplitPane split = new JSplitPane(JSplitPane.HORIZONTAL_SPLIT, left, right);
        split.setBorder(null);
        split.setDividerSize(10);
        split.setBackground(BG);
        split.setResizeWeight(0.36);
        add(split, BorderLayout.CENTER);

        Rectangle b = screen.getBounds();
        setBounds(b.x + 40, b.y + 40, Math.min(1400, b.width - 80), Math.min(860, b.height - 80));
        setExtendedState(MAXIMIZED_BOTH);
        SwingUtilities.invokeLater(() -> split.setDividerLocation(0.36));

        new Timer(1000, e -> tick()).start();
        show.onChange(this::refresh);
        refresh();
    }

    private void tick() {
        long s = (System.currentTimeMillis() - started) / 1000;
        timer.setText(String.format("%02d:%02d", s / 60, s % 60));
        LocalTime t = LocalTime.now();
        clock.setText(String.format("%d:%02d", t.getHour(), t.getMinute()));
    }

    void refresh() {
        Deck d = show.deck();
        int i = show.at();
        setTitle("Presenter · " + d.title);
        pos.setText("Slide " + (i + 1) + " of " + d.slides.size() + (typed.isEmpty() ? "" : "  ·  Go to " + typed) + (show.black() ? "  ·  BLACKED OUT" : ""));
        int steps = show.slide().buildSteps();
        nowLabel.setText("CURRENT · " + (i + 1) + (steps > 0 ? "  ·  build " + show.build() + " of " + steps : ""));
        nextLabel.setText(show.build() < steps ? "NEXT · build " + (show.build() + 1) : i + 1 < d.slides.size() ? "NEXT · " + (i + 2) : "NEXT");
        String n = show.slide().notes();
        notes.setText(n.isEmpty() ? "No notes for this slide." : n);
        notes.setCaretPosition(0);
        choices.removeAll();
        for (int j : d.choices(show.slide())) {
            JButton c = action((j + 1) + " · " + d.slides.get(j).title(), () -> show.go(j));
            c.setBorder(BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(CHOICE), BorderFactory.createEmptyBorder(4, 10, 4, 10)));
            choices.add(c);
        }
        choices.revalidate();
        table.rebuild();
        tick();
        repaint();
    }

    /* ---------- the light table ---------- */

    /** Every slide as a clickable tile, wrapping to fill the width (like Keynote's light table). */
    private final class LightTable extends JPanel implements Scrollable {
        int cols = 3;   // Keynote-style: 3 or 4 slides per row
        private final List<Tile> tiles = new ArrayList<>();

        LightTable() {
            setBackground(PANEL);
            setLayout(new WrapGrid());
        }

        void setCols(int n) { cols = n; revalidate(); repaint(); }

        void rebuild() {
            int count = show.deck().slides.size();
            while (tiles.size() < count) { Tile t = new Tile(tiles.size()); tiles.add(t); add(t); }
            while (tiles.size() > count) remove(tiles.remove(tiles.size() - 1));
            revalidate();
            repaint();
            Tile cur = tiles.get(show.at());
            SwingUtilities.invokeLater(() -> cur.scrollRectToVisible(new Rectangle(0, 0, cur.getWidth(), cur.getHeight())));
        }

        @Override public Dimension getPreferredScrollableViewportSize() { return getPreferredSize(); }
        @Override public int getScrollableUnitIncrement(Rectangle r, int o, int d) { return 24; }
        @Override public int getScrollableBlockIncrement(Rectangle r, int o, int d) { return r.height - 40; }
        @Override public boolean getScrollableTracksViewportWidth() { return true; }
        @Override public boolean getScrollableTracksViewportHeight() { return false; }

        /** A fixed number of equal columns that stretch to fill the row. */
        private final class WrapGrid implements LayoutManager {
            static final int GAP = 12, LABEL = 22;
            public void addLayoutComponent(String n, Component c) {}
            public void removeLayoutComponent(Component c) {}
            public Dimension minimumLayoutSize(Container p) { return new Dimension(200, 100); }
            public Dimension preferredLayoutSize(Container p) {
                // Use the scroll viewport's width: ours is stale until after this layout pass.
                int w = Math.max(p.getParent() != null ? p.getParent().getWidth() : p.getWidth(), 200);
                int cols = cols(w), cw = cellW(w, cols), rows = (p.getComponentCount() + cols - 1) / cols;
                return new Dimension(w, GAP + rows * (cw * 9 / 16 + LABEL + 10 + GAP));
            }
            public void layoutContainer(Container p) {
                int w = p.getWidth(), cols = cols(w), cw = cellW(w, cols), ch = cw * 9 / 16 + LABEL + 10;
                for (int n = 0; n < p.getComponentCount(); n++)
                    p.getComponent(n).setBounds(GAP + (n % cols) * (cw + GAP), GAP + (n / cols) * (ch + GAP), cw, ch);
            }
            private int cols(int w) { return cols; }
            private int cellW(int w, int cols) { return (w - GAP - cols * GAP) / cols; }
        }
    }

    private final class Tile extends JComponent {
        private final int index;
        private final SlideCanvas canvas;

        Tile(int index) {
            this.index = index;
            this.canvas = new SlideCanvas(show, () -> index, Color.BLACK);
            setLayout(null);
            add(canvas);
            setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
            MouseAdapter click = new MouseAdapter() {
                @Override public void mouseClicked(MouseEvent e) { if (!FocusGuard.justFocused()) show.go(index); }
                @Override public void mouseEntered(MouseEvent e) { hover = true; repaint(); }
                @Override public void mouseExited(MouseEvent e) { hover = false; repaint(); }
            };
            addMouseListener(click);   // the canvas has no listeners, so its clicks land here
        }

        boolean hover;

        @Override public void doLayout() {
            int w = getWidth() - 10;
            canvas.setBounds(5, 5, w, w * 9 / 16);
        }

        @Override protected void paintComponent(Graphics g0) {
            Graphics2D g = (Graphics2D) g0;
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            if (index >= show.deck().slides.size()) return;
            int at = show.at(), w = getWidth(), h = getHeight();
            boolean now = index == at, next = index == at + 1, choice = show.deck().choices(show.slide()).contains(index);
            if (now) { g.setColor(new Color(0x2a211b)); g.fillRoundRect(0, 0, w, h, 12, 12); }
            else if (hover) { g.setColor(new Color(0x232326)); g.fillRoundRect(0, 0, w, h, 12, 12); }
            Color edge = now ? ACCENT : next ? NEXT : choice ? CHOICE : hover ? new Color(0x55555c) : null;
            if (edge != null) {
                g.setColor(edge);
                g.setStroke(next ? new java.awt.BasicStroke(2, 0, 0, 1, new float[]{6, 4}, 0) : new java.awt.BasicStroke(now ? 3 : 2));
                g.drawRoundRect(1, 1, w - 3, h - 3, 12, 12);
            }
            int ch = (w - 10) * 9 / 16;
            g.setFont(getFont() != null ? getFont().deriveFont(12f) : new Font(Font.SANS_SERIF, Font.PLAIN, 12));
            String num = String.valueOf(index + 1);
            g.setColor(TEXT);
            g.setFont(g.getFont().deriveFont(Font.BOLD));
            g.drawString(num, 7, ch + 22);
            int nx = 7 + g.getFontMetrics().stringWidth(num) + 6;
            g.setFont(g.getFont().deriveFont(Font.PLAIN));
            g.setColor(now ? Color.WHITE : new Color(0xa9a59c));
            String title = show.deck().slides.get(index).title();
            while (title.length() > 1 && nx + g.getFontMetrics().stringWidth(title) > w - 6) title = title.substring(0, title.length() - 2) + "…";
            g.drawString(title, nx, ch + 22);
        }

        @Override protected void paintChildren(Graphics g0) {
            super.paintChildren(g0);
            int at = show.at();
            String badge = index == at ? "Now" : index == at + 1 ? "Next" : null;
            if (badge == null) return;
            Graphics2D g = (Graphics2D) g0;
            g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 11));
            int bw = g.getFontMetrics().stringWidth(badge) + 14;
            g.setColor(index == at ? ACCENT : NEXT);
            g.fillRoundRect(10, 10, bw, 18, 8, 8);
            g.setColor(index == at ? new Color(0x1a1a1a) : Color.WHITE);
            g.drawString(badge, 17, 23);
        }
    }

    /* ---------- small helpers ---------- */

    private static JLabel label(String text, float size) {
        JLabel l = new JLabel(text);
        l.setForeground(size <= 11f ? DIM : TEXT);
        l.setFont(l.getFont().deriveFont(size <= 11f ? Font.BOLD : Font.PLAIN, size));
        return l;
    }

    private static JButton button(String text) {
        JButton b = new JButton(text);
        b.setFocusable(false);
        b.setBackground(new Color(0x232326));
        b.setForeground(TEXT);
        b.setBorder(BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(new Color(0x3a3a3f)), BorderFactory.createEmptyBorder(5, 12, 5, 12)));
        b.setContentAreaFilled(true);
        b.setOpaque(true);
        return b;
    }

    private static JButton action(String text, Runnable r) {
        JButton b = button(text);
        b.addActionListener(e -> r.run());
        return b;
    }

    private static JPanel row() {
        JPanel p = new JPanel();
        p.setLayout(new BoxLayout(p, BoxLayout.X_AXIS));
        p.setBackground(BG);
        return p;
    }

    private static Component aligned(JComponent c) {
        c.setAlignmentX(Component.LEFT_ALIGNMENT);
        return c;
    }

    /** Wraps a canvas so it keeps a 16:9 shape at `share` of the column width. */
    private static JComponent sixteenNine(JComponent inner, double share) {
        JPanel box = new JPanel(null) {
            @Override public void doLayout() {
                int w = (int) (getWidth() * share);
                inner.setBounds(0, 0, w, w * 9 / 16);
            }
            @Override public Dimension getPreferredSize() {
                int w = getParent() == null ? 400 : getParent().getWidth();
                return new Dimension(w, (int) (w * share) * 9 / 16);
            }
            @Override public Dimension getMaximumSize() { return new Dimension(Integer.MAX_VALUE, getPreferredSize().height); }
        };
        box.setOpaque(false);
        box.add(inner);
        return box;
    }

}
