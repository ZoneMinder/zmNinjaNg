Feature: Application Settings
  As a ZoneMinder user
  I want to configure application settings
  So that I can customize the app to my preferences

  Background:
    Given I am logged into zmNinjaNg

  @all
  Scenario: Toggle theme and verify background color changes
    When I navigate to the "Settings" page
    Then I should see theme selector
    When I toggle the theme
    Then the app background color should change
    When I navigate to the "Dashboard" page
    And I navigate to the "Settings" page
    Then the theme selection should persist

  @all
  Scenario: Streaming Mode says why it recommends a mode
    When I navigate to the "Settings" page
    Then the Streaming Mode row explains which mode it recommends

  @all
  Scenario: Change language and verify visible text updates
    When I navigate to the "Settings" page
    Then I should see language selector
    When I change the language to a different option
    Then a visible menu item should change to the selected language

  @all
  Scenario: Chosen start screen decides where the app opens
    When I navigate to the "Settings" page
    And I set the start screen to "Timeline"
    And I restart the app
    Then the app should open on the "timeline" page

  @all
  Scenario: Notification toggle persists across navigation
    When I navigate to the "Notifications" page
    Then I should see notification interface elements
    When I toggle a notification setting
    And I navigate to the "Dashboard" page
    And I navigate to the "Notifications" page
    Then the notification toggle state should be preserved

  @all
  Scenario: Server info shows version and system data
    When I navigate to the "Server" page
    Then I should see server information displayed

  @all
  Scenario: Log viewer filters by level and clears entries
    When I navigate to the "Logs" page
    Then I should see log entries or empty state
    And I should see log control elements
    And I change the log level to "WARN"
    And I clear logs if available

  @all
  Scenario: Bandwidth mode switch updates the mode label
    When I navigate to the "Settings" page
    When I toggle bandwidth mode
    Then the bandwidth mode label should update

  @all
  Scenario: Force-disable multiport toggle persists across navigation
    When I navigate to the "Settings" page
    And I expand the Advanced settings section
    And I enable the force-disable multiport toggle
    And I navigate to the "Dashboard" page
    And I navigate to the "Settings" page
    And I expand the Advanced settings section
    Then the force-disable multiport toggle should be enabled

  @all
  Scenario: Disabling log redaction warns that credentials will be logged
    When I navigate to the "Settings" page
    And I expand the Advanced settings section
    And I enable the log redaction toggle
    Then I should see the log redaction warning
    When I disable the log redaction toggle
    Then the log redaction warning should be gone

  @all
  Scenario: WebRTC STUN toggle persists across navigation
    When I navigate to the "Settings" page
    And I enable the WebRTC STUN toggle
    And I navigate to the "Dashboard" page
    And I navigate to the "Settings" page
    Then the WebRTC STUN toggle should be enabled

  @all
  Scenario: Thumbnail fallback chain reorder persists across reload
    When I navigate to the "Settings" page
    And I expand the thumbnail fallback chain editor
    Then I should see the thumbnail fallback chain editor
    When I move the "snapshot" thumbnail fallback entry up
    And I disable the "objdetect" thumbnail fallback entry
    And I navigate to the "Dashboard" page
    And I navigate to the "Settings" page
    And I expand the thumbnail fallback chain editor
    Then the "snapshot" thumbnail fallback entry should be above the "alarm" entry
    And the "objdetect" thumbnail fallback entry should be disabled

  @all
  Scenario: Collapsing a settings section hides its rows and is remembered
    When I navigate to the "Settings" page
    Then the "live-streaming" settings section should be expanded
    When I collapse the "live-streaming" settings section
    Then the "live-streaming" settings section should be collapsed
    When I navigate to the "Dashboard" page
    And I navigate to the "Settings" page
    Then the "live-streaming" settings section should be collapsed
    When I expand the "live-streaming" settings section
    Then the "live-streaming" settings section should be expanded

  @ios-phone @android
  Scenario: Phone layout makes all settings reachable via scroll
    Given the viewport is mobile size
    When I navigate to the "Settings" page
    Then I should see settings interface elements
    And no element should overflow the viewport horizontally
