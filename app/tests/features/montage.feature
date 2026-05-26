Feature: Montage Live Grid
  As a ZoneMinder user
  I want to see all monitors in a live montage grid
  So that I can view multiple camera feeds simultaneously

  Background:
    Given I am logged into zmNinjaNg
    When I navigate to the "Montage" page

  @all
  Scenario: Montage grid shows monitor feeds with names
    Then I should see at least 1 monitor in montage grid
    And each montage cell should show a monitor name label

  @all
  Scenario: Tap monitor in montage navigates to detail
    Then I should see at least 1 monitor in montage grid
    When I click into the first monitor detail page
    Then I should see the monitor player

  @all
  Scenario: Snapshot download from montage
    Then I should see at least 1 monitor in montage grid
    When I click the snapshot button on the first montage monitor
    Then the snapshot should be saved successfully

  @ios-phone @android @visual
  Scenario: Phone portrait shows 1-2 columns with readable feeds
    Given the viewport is mobile size
    Then I should see at least 1 monitor in montage grid
    And no element should overflow the viewport horizontally
    And the page should match the visual baseline

  @ios-tablet @visual
  Scenario: Tablet shows wider montage grid
    Then I should see at least 1 monitor in montage grid
    And the page should match the visual baseline

  @all
  Scenario: Hide a monitor from the montage view via the kebab menu
    Then I should see at least 1 monitor in montage grid
    When I capture the first montage monitor id
    And I open the montage kebab menu
    And I open the montage show-monitors submenu
    And I uncheck the visibility for the captured monitor
    Then the captured monitor tile should not be present in the montage grid
    When I reload the current page
    Then I should see at least 1 monitor in montage grid
    And the captured monitor tile should not be present in the montage grid
    When I open the montage kebab menu
    And I open the montage show-monitors submenu
    And I check the visibility for the captured monitor
    Then the captured monitor tile should be present in the montage grid
