package waypoint;

import java.awt.BorderLayout;
import java.awt.Font;
import java.awt.GraphicsConfiguration;
import java.awt.GraphicsDevice;
import java.awt.GraphicsEnvironment;
import java.awt.KeyEventDispatcher;
import java.awt.KeyboardFocusManager;
import java.awt.Window;
import java.awt.datatransfer.DataFlavor;
import java.awt.event.KeyEvent;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.prefs.Preferences;
import javax.swing.BorderFactory;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JFileChooser;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.SwingUtilities;
import javax.swing.Timer;
import javax.swing.TransferHandler;
import javax.swing.filechooser.FileNameExtensionFilter;

/**
 * Waypoint Presenter for the desktop, in Java.
 *
 *   java -jar waypoint-presenter.jar [deck.waypoint.json] [start slide number]
 *
 * With a second display the slides fill that display and the controller opens on this
 * one; with a single display the slides open in a window of their own.
 */
public final class Main {
    private static final Preferences PREFS = Preferences.userNodeForPackage(Main.class);
    private static JFrame launcher;

    public static void main(String[] args) {
        System.setProperty("sun.java2d.uiScale.enabled", "true");
        SwingUtilities.invokeLater(() -> {
            if (args.length > 0) present(Path.of(args[0]), args.length > 1 ? parseInt(args[1]) - 1 : 0);
            else showLauncher();
        });
    }

    private static int parseInt(String s) { try { return Integer.parseInt(s); } catch (NumberFormatException e) { return 1; } }

    /* ---------- launcher ---------- */

    private static void showLauncher() {
        if (launcher != null) { launcher.setVisible(true); launcher.toFront(); return; }
        launcher = new JFrame("Waypoint Presenter");
        launcher.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        JPanel p = new JPanel();
        p.setLayout(new BoxLayout(p, BoxLayout.Y_AXIS));
        p.setBorder(BorderFactory.createEmptyBorder(28, 32, 28, 32));
        p.setBackground(ControllerWindow.BG);
        JLabel title = new JLabel("Waypoint Presenter");
        title.setFont(title.getFont().deriveFont(Font.BOLD, 22f));
        title.setForeground(ControllerWindow.TEXT);
        JLabel hint = new JLabel("<html>Open a <b>.waypoint.json</b> deck (File, Save file in Waypoint), or drop one here.<br>"
            + displaysText() + "</html>");
        hint.setForeground(ControllerWindow.DIM);
        hint.setBorder(BorderFactory.createEmptyBorder(8, 0, 18, 0));
        JButton open = new JButton("Open deck…");
        open.addActionListener(e -> choose());
        p.add(title);
        p.add(hint);
        p.add(open);
        String last = PREFS.get("last", null);
        if (last != null && Files.exists(Path.of(last))) {
            JButton again = new JButton("Present " + Path.of(last).getFileName());
            again.addActionListener(e -> present(Path.of(last), 0));
            p.add(javax.swing.Box.createVerticalStrut(8));
            p.add(again);
        }
        // Drag a deck onto the window.
        p.setTransferHandler(new TransferHandler() {
            @Override public boolean canImport(TransferSupport s) { return s.isDataFlavorSupported(DataFlavor.javaFileListFlavor); }
            @Override public boolean importData(TransferSupport s) {
                try {
                    @SuppressWarnings("unchecked")
                    List<File> files = (List<File>) s.getTransferable().getTransferData(DataFlavor.javaFileListFlavor);
                    if (files.isEmpty()) return false;
                    present(files.get(0).toPath(), 0);
                    return true;
                } catch (Exception ex) { return false; }
            }
        });
        launcher.add(p, BorderLayout.CENTER);
        launcher.pack();
        launcher.setLocationRelativeTo(null);
        launcher.setVisible(true);
    }

    private static String displaysText() {
        int n = GraphicsEnvironment.getLocalGraphicsEnvironment().getScreenDevices().length;
        return n > 1 ? n + " displays found: slides go full screen on the other one."
                     : "One display found: slides open in their own window.";
    }

    private static void choose() {
        JFileChooser fc = new JFileChooser(PREFS.get("dir", null));
        fc.setFileFilter(new FileNameExtensionFilter("Waypoint deck (.json)", "json"));
        if (fc.showOpenDialog(launcher) != JFileChooser.APPROVE_OPTION) return;
        PREFS.put("dir", fc.getSelectedFile().getParent());
        present(fc.getSelectedFile().toPath(), 0);
    }

    /* ---------- presenting ---------- */

    private static void present(Path file, int start) {
        Deck deck;
        try {
            deck = Deck.load(file);
        } catch (Exception ex) {
            JOptionPane.showMessageDialog(launcher, "That file is not a Waypoint deck.\n" + ex.getMessage(), "Waypoint", JOptionPane.ERROR_MESSAGE);
            if (launcher == null) showLauncher();
            return;
        }
        PREFS.put("last", file.toAbsolutePath().toString());
        if (launcher != null) launcher.setVisible(false);

        // The controller goes on the display we were started from (the primary one);
        // the slides go on any other display, or a window here if there is none.
        GraphicsEnvironment env = GraphicsEnvironment.getLocalGraphicsEnvironment();
        GraphicsDevice home = launcher != null && launcher.getGraphicsConfiguration() != null
            ? launcher.getGraphicsConfiguration().getDevice() : env.getDefaultScreenDevice();
        GraphicsDevice other = null;
        for (GraphicsDevice d : env.getScreenDevices()) if (d != home) { other = d; break; }
        GraphicsConfiguration homeConf = home.getDefaultConfiguration();

        Presentation show = new Presentation(deck, start);
        AudienceWindow audience = other != null
            ? new AudienceWindow(show, other.getDefaultConfiguration(), true)
            : new AudienceWindow(show, homeConf, false);
        String where = other != null ? "Slides are on the other display" : "Slides are in their own window";

        Window[] windows = new Window[2];
        Timer[] watch = new Timer[1];
        KeyEventDispatcher[] keys = new KeyEventDispatcher[1];
        Runnable end = () -> {
            watch[0].stop();
            KeyboardFocusManager.getCurrentKeyboardFocusManager().removeKeyEventDispatcher(keys[0]);
            for (Window w : windows) if (w != null) w.dispose();
            showLauncher();
        };
        ControllerWindow controller = new ControllerWindow(show, homeConf, where, end);
        windows[0] = controller;
        windows[1] = audience;
        // Closing the slides window from the taskbar ends the show too.
        audience.addWindowListener(new java.awt.event.WindowAdapter() {
            @Override public void windowClosed(java.awt.event.WindowEvent e) { if (controller.isDisplayable()) end.run(); }
        });

        FocusGuard.install();
        keys[0] = e -> handleKey(e, show, controller, end);
        KeyboardFocusManager.getCurrentKeyboardFocusManager().addKeyEventDispatcher(keys[0]);

        // Edited the deck in Waypoint and saved it again? Pick up the changes.
        long[] stamp = {file.toFile().lastModified()};
        watch[0] = new Timer(1500, e -> {
            long m = file.toFile().lastModified();
            if (m == stamp[0]) return;
            stamp[0] = m;
            try { show.setDeck(Deck.load(file)); } catch (Exception ignored) { /* mid-write; next tick */ }
        });
        watch[0].start();

        audience.setVisible(true);
        controller.setVisible(true);
        controller.toFront();
        controller.requestFocus();
    }

    /** The same keys as the web app's show and presenter view, in both windows. */
    private static boolean handleKey(KeyEvent e, Presentation show, ControllerWindow c, Runnable end) {
        if (e.getID() != KeyEvent.KEY_PRESSED || e.isControlDown() || e.isAltDown() || e.isMetaDown()) return false;
        int k = e.getKeyCode();
        char ch = e.getKeyChar();
        if (Character.isDigit(ch)) { c.typed += ch; c.refresh(); return true; }
        if (!c.typed.isEmpty() && k == KeyEvent.VK_ENTER) { int n = Integer.parseInt(c.typed); c.typed = ""; show.go(n - 1); return true; }
        if (!c.typed.isEmpty() && k == KeyEvent.VK_ESCAPE) { c.typed = ""; c.refresh(); return true; }
        switch (k) {
            case KeyEvent.VK_RIGHT, KeyEvent.VK_DOWN, KeyEvent.VK_PAGE_DOWN, KeyEvent.VK_SPACE, KeyEvent.VK_ENTER, KeyEvent.VK_N -> show.step(1);
            case KeyEvent.VK_LEFT, KeyEvent.VK_UP, KeyEvent.VK_PAGE_UP, KeyEvent.VK_P -> show.step(-1);
            case KeyEvent.VK_BACK_SPACE -> show.back();
            case KeyEvent.VK_HOME -> show.go(0);
            case KeyEvent.VK_END -> show.go(show.deck().slides.size() - 1);
            case KeyEvent.VK_B, KeyEvent.VK_PERIOD -> show.toggleBlack();
            case KeyEvent.VK_ESCAPE -> end.run();
            case KeyEvent.VK_F5 -> { }   // the clicker's start-show button; never acts mid-talk
            default -> { return false; }
        }
        return true;
    }

}
