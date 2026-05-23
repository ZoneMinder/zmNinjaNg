# Parked in .wip until a Tauri e2e runner exists (scripts/test-tauri.sh is a stub).
# Kept out of tests/features/ because the web CI run has no tag filter and would
# execute @tauri scenarios on chromium, which tests the webview path, not the Rust
# MJPEG path this regression targets. Move back to tests/features/ when Tauri e2e
# is implemented. refs #155
@tauri @native
Feature: MJPEG streaming socket pool (Tauri desktop)
  Regression test for issue #155. Opening many monitors in streaming mode
  leaked WebKitGTK sockets and stopped displaying after ~8 monitors. MJPEG
  frames are now read in Rust and pushed to the webview as blob URLs.

  Background:
    Given I am logged into zmNinjaNg
    When I navigate to the "Monitors" page
    And I click into the first monitor detail page

  @tauri @native
  Scenario: Opening 10 monitors in sequence still shows live MJPEG frames
    Then I should see the monitor player
    When I cycle through up to 10 monitors using the next arrow and verify each shows a live MJPEG frame
    Then the currently open monitor should show a live MJPEG frame
