package com.zoneminder.zmNinjaNG;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PointF;
import android.os.SystemClock;
import android.util.AttributeSet;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.webkit.WebView;
import android.widget.FrameLayout;

/**
 * FrameLayout that overlays a virtual cursor on its child (WebView).
 * D-pad moves the cursor, center/enter dispatches touch events.
 * Based on patterns from TV Bro browser.
 */
public class TvCursorLayout extends FrameLayout {

    private final PointF cursorPos = new PointF();
    private final PointF cursorSpeed = new PointF(0, 0);
    private final PointF direction = new PointF(0, 0);

    private float maxSpeed;
    private float cursorRadius;
    private float scrollPadding;
    private boolean cursorVisible = false;
    private boolean cursorPressed = false;
    private long downTime = 0;
    private long lastHideTime = 0;

    private static final long HIDE_TIMEOUT = 5000;
    private static final float ACCEL = 0.05f;
    private static final float DEAD_ZONE = 0.1f;

    private final Paint fillPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint strokePaint = new Paint(Paint.ANTI_ALIAS_FLAG);

    // Track last direction to prevent stuck keys
    private int lastDpadKeyCode = 0;

    private final Runnable updateRunnable = new Runnable() {
        @Override
        public void run() {
            long now = SystemClock.uptimeMillis();

            // Auto-hide after timeout
            if (cursorVisible && direction.x == 0 && direction.y == 0
                    && cursorSpeed.length() < DEAD_ZONE
                    && now - lastHideTime > HIDE_TIMEOUT) {
                cursorVisible = false;
                invalidate();
                return;
            }

            float dTime = 16f; // assume ~60fps
            float accel = ACCEL * dTime;

            // Accelerate in direction
            cursorSpeed.x += direction.x * accel;
            cursorSpeed.y += direction.y * accel;

            // Clamp to max speed
            cursorSpeed.x = Math.max(-maxSpeed, Math.min(maxSpeed, cursorSpeed.x));
            cursorSpeed.y = Math.max(-maxSpeed, Math.min(maxSpeed, cursorSpeed.y));

            // Decelerate when no direction
            if (direction.x == 0) {
                cursorSpeed.x = 0;
            }
            if (direction.y == 0) {
                cursorSpeed.y = 0;
            }

            // Dead zone snap
            if (Math.abs(cursorSpeed.x) < DEAD_ZONE) cursorSpeed.x = 0;
            if (Math.abs(cursorSpeed.y) < DEAD_ZONE) cursorSpeed.y = 0;

            // Move cursor
            if (cursorSpeed.x != 0 || cursorSpeed.y != 0) {
                cursorPos.x = Math.max(0, Math.min(getWidth() - 1, cursorPos.x + cursorSpeed.x));
                cursorPos.y = Math.max(0, Math.min(getHeight() - 1, cursorPos.y + cursorSpeed.y));
                lastHideTime = now;

                // Edge scroll
                handleEdgeScroll();
            }

            invalidate();

            // Keep running if cursor is visible and moving or waiting to hide
            if (cursorVisible) {
                post(this);
            }
        }
    };

    public TvCursorLayout(Context context) {
        super(context);
        init();
    }

    public TvCursorLayout(Context context, AttributeSet attrs) {
        super(context, attrs);
        init();
    }

    private void init() {
        setWillNotDraw(false);
        int displayWidth = getResources().getDisplayMetrics().widthPixels;
        maxSpeed = displayWidth / 25f;
        cursorRadius = displayWidth / 80f;
        scrollPadding = displayWidth / 15f;

        fillPaint.setStyle(Paint.Style.FILL);
        fillPaint.setColor(Color.argb(160, 0, 168, 255)); // match app's #00a8ff

        strokePaint.setStyle(Paint.Style.STROKE);
        strokePaint.setStrokeWidth(2f);
        strokePaint.setColor(Color.argb(200, 255, 255, 255));
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int keyCode = event.getKeyCode();
        boolean isDown = event.getAction() == KeyEvent.ACTION_DOWN;

        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_UP:
            case KeyEvent.KEYCODE_DPAD_DOWN:
            case KeyEvent.KEYCODE_DPAD_LEFT:
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                return handleDirectionKey(keyCode, isDown);

            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
                return handleSelectKey(isDown);

            // BACK falls through so Capacitor's backButton listener
            // (useAndroidBackButton) gets it: close overlay, go back, or
            // double-press to exit (refs #555).
            default:
                return super.dispatchKeyEvent(event);
        }
    }

    private boolean handleDirectionKey(int keyCode, boolean isDown) {
        if (isDown) {
            // Show cursor if hidden; first press just shows, doesn't move
            if (!cursorVisible) {
                showCursor();
                return true;
            }

            // Release old direction before setting new (prevents stuck keys)
            if (lastDpadKeyCode != 0 && lastDpadKeyCode != keyCode) {
                releaseDirection(lastDpadKeyCode);
            }
            lastDpadKeyCode = keyCode;

            switch (keyCode) {
                case KeyEvent.KEYCODE_DPAD_UP:    direction.y = -1; break;
                case KeyEvent.KEYCODE_DPAD_DOWN:  direction.y = 1; break;
                case KeyEvent.KEYCODE_DPAD_LEFT:  direction.x = -1; break;
                case KeyEvent.KEYCODE_DPAD_RIGHT: direction.x = 1; break;
            }
        } else {
            releaseDirection(keyCode);
            if (keyCode == lastDpadKeyCode) lastDpadKeyCode = 0;
        }
        return true;
    }

    private void releaseDirection(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_UP:
            case KeyEvent.KEYCODE_DPAD_DOWN:
                direction.y = 0;
                cursorSpeed.y = 0;
                break;
            case KeyEvent.KEYCODE_DPAD_LEFT:
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                direction.x = 0;
                cursorSpeed.x = 0;
                break;
        }
    }

    private boolean handleSelectKey(boolean isDown) {
        if (!cursorVisible) {
            showCursor();
            return true;
        }

        if (isDown && !cursorPressed) {
            cursorPressed = true;
            downTime = SystemClock.uptimeMillis();
            dispatchTouchToChild(MotionEvent.ACTION_DOWN);
            invalidate();
        } else if (!isDown && cursorPressed) {
            cursorPressed = false;
            dispatchTouchToChild(MotionEvent.ACTION_UP);
            invalidate();
        }
        return true;
    }

    private void dispatchTouchToChild(int action) {
        long now = SystemClock.uptimeMillis();
        if (action == MotionEvent.ACTION_DOWN) {
            downTime = now;
        }

        MotionEvent.PointerProperties[] props = new MotionEvent.PointerProperties[1];
        props[0] = new MotionEvent.PointerProperties();
        props[0].id = 0;
        props[0].toolType = MotionEvent.TOOL_TYPE_FINGER;

        MotionEvent.PointerCoords[] coords = new MotionEvent.PointerCoords[1];
        coords[0] = new MotionEvent.PointerCoords();
        coords[0].x = cursorPos.x;
        coords[0].y = cursorPos.y;
        coords[0].pressure = 1f;
        coords[0].size = 1f;

        MotionEvent event = MotionEvent.obtain(
                downTime, now, action, 1, props, coords,
                0, 0, 1f, 1f, 0, 0, 0, 0
        );

        // Dispatch to child views (the WebView)
        View child = getChildAt(0);
        if (child != null) {
            child.dispatchTouchEvent(event);
        }
        event.recycle();
    }

    private void handleEdgeScroll() {
        View child = getChildAt(0);
        if (!(child instanceof WebView)) return;

        float scrollSpeed = Math.max(Math.abs(cursorSpeed.x), Math.abs(cursorSpeed.y));
        if (scrollSpeed < 1) return;

        int scrollDx = 0, scrollDy = 0;

        // Check if cursor is near edges
        if (cursorPos.y < scrollPadding) {
            scrollDy = (int) (-scrollSpeed * 2f);
        } else if (cursorPos.y > getHeight() - scrollPadding) {
            scrollDy = (int) (scrollSpeed * 2f);
        }
        if (cursorPos.x < scrollPadding) {
            scrollDx = (int) (-scrollSpeed * 2f);
        } else if (cursorPos.x > getWidth() - scrollPadding) {
            scrollDx = (int) (scrollSpeed * 2f);
        }

        if (scrollDx == 0 && scrollDy == 0) return;

        // Use JavaScript to scroll the element under the cursor.
        // This avoids synthetic touch events that accidentally click buttons.
        // Coordinates must be converted from native pixels to CSS pixels.
        WebView webView = (WebView) child;
        float midY = getHeight() / 2f;
        float midX = getWidth() / 2f;
        String js = String.format(
            "(function(){" +
            "  var dpr = window.devicePixelRatio || 1;" +
            "  var x = %f / dpr;" +
            "  var y = %f / dpr;" +
            "  var dx = %d;" +
            "  var dy = %d;" +
            "  function findScrollable(px, py) {" +
            "    var el = document.elementFromPoint(px, py);" +
            "    while (el) {" +
            "      var style = window.getComputedStyle(el);" +
            "      var oy = style.overflowY;" +
            "      var ox = style.overflowX;" +
            "      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;" +
            "      if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth) return el;" +
            "      el = el.parentElement;" +
            "    }" +
            "    return null;" +
            "  }" +
            // Try at cursor position first; if nothing found (cursor may be
            // over a fixed header/footer), retry at the same X but mid-screen Y
            // to find the scrollable container in the same column
            "  var target = findScrollable(x, y);" +
            "  if (!target) target = findScrollable(x, %f / dpr);" +
            "  if (target) { target.scrollBy(dx, dy); }" +
            "  else { window.scrollBy(dx, dy); }" +
            "})();",
            cursorPos.x, cursorPos.y,
            scrollDx, scrollDy,
            midY
        );
        webView.evaluateJavascript(js, null);
    }

    private void showCursor() {
        cursorVisible = true;
        lastHideTime = SystemClock.uptimeMillis();
        if (cursorPos.x == 0 && cursorPos.y == 0) {
            cursorPos.set(getWidth() / 2f, getHeight() / 2f);
        }
        removeCallbacks(updateRunnable);
        post(updateRunnable);
        invalidate();
    }

    @Override
    protected void dispatchDraw(Canvas canvas) {
        super.dispatchDraw(canvas);

        if (!cursorVisible) return;

        float r = cursorPressed ? cursorRadius * 0.7f : cursorRadius;
        canvas.drawCircle(cursorPos.x, cursorPos.y, r, fillPaint);
        canvas.drawCircle(cursorPos.x, cursorPos.y, r, strokePaint);
    }

    @Override
    protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
        removeCallbacks(updateRunnable);
    }
}
