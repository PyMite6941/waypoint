package waypoint;

import java.awt.AWTEvent;
import java.awt.Toolkit;
import java.awt.event.WindowEvent;

/**
 * A click that only brings a window to the front (the presenter clicking back from another
 * app) should not also change the slide. Same rule as justFocused() in src/lib/clicker.js.
 */
final class FocusGuard {
    private static volatile long focusedAt;

    static {
        Toolkit.getDefaultToolkit().addAWTEventListener(e -> {
            if (e.getID() == WindowEvent.WINDOW_GAINED_FOCUS) focusedAt = System.nanoTime();
        }, AWTEvent.WINDOW_FOCUS_EVENT_MASK);
    }

    private FocusGuard() {}

    static void install() { /* loading the class registers the listener */ }

    static boolean justFocused() { return System.nanoTime() - focusedAt < 400_000_000L; }
}
