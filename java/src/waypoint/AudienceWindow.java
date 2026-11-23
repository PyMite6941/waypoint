package waypoint;

import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Cursor;
import java.awt.GraphicsConfiguration;
import java.awt.Point;
import java.awt.Rectangle;
import java.awt.Toolkit;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.image.BufferedImage;
import javax.swing.JFrame;
import javax.swing.Timer;

/**
 * What the room sees. On a second display it covers that whole screen like a projector
 * output (Google Slides style); with one display it is an ordinary window you can move.
 */
final class AudienceWindow extends JFrame {
    private static final Cursor HIDDEN = Toolkit.getDefaultToolkit().createCustomCursor(
        new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB), new Point(), "hidden");

    AudienceWindow(Presentation show, GraphicsConfiguration screen, boolean fullScreen) {
        super(show.deck().title + " · Waypoint", screen);
        setDefaultCloseOperation(DISPOSE_ON_CLOSE);
        SlideCanvas canvas = new SlideCanvas(show, () -> show.black() ? -1 : show.at(), Color.BLACK, SlideCanvas.Mode.LIVE);
        add(canvas, BorderLayout.CENTER);

        Rectangle b = screen.getBounds();
        if (fullScreen) {
            // Borderless and exactly the size of the other display. Unlike exclusive
            // full-screen mode, this does not minimise when the presenter clicks elsewhere.
            setUndecorated(true);
            setBounds(b);
        } else {
            setSize(Math.min(1280, b.width - 120), Math.min(760, b.height - 120));
            setLocation(b.x + 60, b.y + 60);
        }
        getContentPane().setBackground(Color.BLACK);

        // Click: follow a link on the slide, otherwise advance. The cursor hides when still.
        Timer sleep = new Timer(2000, e -> canvas.setCursor(HIDDEN));
        sleep.setRepeats(false);
        MouseAdapter mouse = new MouseAdapter() {
            @Override public void mouseClicked(MouseEvent e) {
                if (FocusGuard.justFocused()) return;   // that click only brought the window to the front
                if (show.black()) { show.toggleBlack(); return; }
                if (e.getButton() == MouseEvent.BUTTON3) { show.step(-1); return; }
                double[] box = canvas.slideBox();
                double sx = (e.getX() - box[0]) * Deck.W / box[2], sy = (e.getY() - box[1]) * Deck.H / box[3];
                int j = show.painter().linkAt(show.slide(), sx, sy);
                if (j >= 0) show.go(j); else show.step(1);
            }
            @Override public void mouseMoved(MouseEvent e) {
                double[] box = canvas.slideBox();
                double sx = (e.getX() - box[0]) * Deck.W / box[2], sy = (e.getY() - box[1]) * Deck.H / box[3];
                boolean link = !show.black() && show.painter().linkAt(show.slide(), sx, sy) >= 0;
                canvas.setCursor(Cursor.getPredefinedCursor(link ? Cursor.HAND_CURSOR : Cursor.DEFAULT_CURSOR));
                sleep.restart();
            }
        };
        canvas.addMouseListener(mouse);
        canvas.addMouseMotionListener(mouse);
        show.onChange(() -> { setTitle(show.deck().title + " · Waypoint"); canvas.repaint(); });
    }
}
