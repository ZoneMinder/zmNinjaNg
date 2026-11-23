Feature: Profile Management
  As a ZoneMinder user
  I want to manage multiple server profiles
  So that I can connect to different ZoneMinder instances

  Background:
    Given I am logged into zmNinjaNg
    When I navigate to the "Profiles" page

  @all
  Scenario: Profile list shows profiles with correct names
    Then I should see at least 1 profile cards

  @all
  Scenario: Server addresses stay folded away until asked for
    Then the profile server addresses should be hidden
    When I open the profile server addresses
    Then I should see the profile portal address

  @all
  Scenario: Active profile has a visible indicator
    Then I should see the active profile indicator

  @all
  Scenario: Edit profile form shows current values and saves changes
    When I open the edit dialog for the first profile
    Then I should see the profile edit dialog
    When I change the profile name to a new value
    And I save profile edits
    Then the updated profile name should appear in the list

  @web
  Scenario: Edit profile dialog scrolls when it is taller than a short screen
    Given the viewport is phone landscape size
    When I open the edit dialog for the first profile
    Then I should see the profile edit dialog
    And the profile edit dialog should fit within the viewport
    And the profile edit dialog body should be scrollable
    When I scroll the profile edit dialog to the bottom
    Then the profile edit save button should be within the viewport
    And the dialog close button should be within the viewport

  @web
  Scenario: A dialog stays inside the safe area when system bars take part of the screen
    Given the viewport is phone landscape size with safe-area insets on the top and right
    When I open the edit dialog for the first profile
    Then I should see the profile edit dialog
    And the profile edit dialog should sit inside the safe area

  @web
  Scenario: A confirmation dialog stays reachable on a screen shorter than it is
    Given the viewport is shorter than a dialog
    When I open the delete all profiles dialog
    Then the delete all profiles dialog should fit within the viewport
    And the delete all profiles buttons should be reachable

  @all
  Scenario: Add profile with connection details
    When I click the add profile button
    Then I should see the profile form
    When I fill in new profile connection details
    And I save the new profile
    Then I should see the new profile in the list

  @all
  Scenario: Cancelling profile deletion keeps the profile in the list
    When I click the add profile button
    Then I should see the profile form
    When I fill in new profile connection details
    And I save the new profile
    Then the newly added profile should appear in the list
    When I open the delete dialog for the newly added profile
    Then I should see the profile delete dialog
    When I cancel profile deletion
    Then the newly added profile should still appear in the list

  @all
  Scenario: Deleting a profile removes it from the list
    When I click the add profile button
    Then I should see the profile form
    When I fill in new profile connection details
    And I save the new profile
    Then the newly added profile should appear in the list
    When I open the delete dialog for the newly added profile
    Then I should see the profile delete dialog
    When I confirm profile deletion
    Then the newly added profile should no longer appear in the list

  @ios-phone @android
  Scenario: Phone layout stacks profile cards
    Given the viewport is mobile size
    Then I should see at least 1 profile cards
    And no element should overflow the viewport horizontally
