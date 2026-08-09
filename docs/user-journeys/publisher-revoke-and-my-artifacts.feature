Feature: Owner retains access after expiry and can read comments
  As a publisher (User A)
  I want my artifact to become inaccessible to others after 7 days while I keep access
  So that sharing ends on schedule but I never lose my own work

  Background:
    Given User A has published an artifact with audience groups "Product" and "Development"
    And the artifact's expiry was set to "7d"
    And other users have left comments on the artifact

  Scenario: After expiry, only the owner can view the artifact
    Given 7 days have passed since publication
    When a non-owner in the "Product" group requests the artifact
    Then access is denied
    When User A opens the "My Artifacts" section
    Then the artifact is listed
    And User A can open and view the artifact
    And User A can download the artifact

  Scenario: Owner can read attributable comments
    Given the artifact has comments from other users
    When User A views the artifact's comments
    Then each comment shows its body
    And each comment shows the author's name
    And each comment shows the date it was left

  Scenario: Revoking access before expiry invalidates previously issued links
    Given User A previously created a share link for the artifact
    And a non-owner in "Product" could access it via that link
    When User A changes the access policy to remove the "Product" group
    Then the next attempt to use the previously issued link is denied for that non-owner
    And User A can still view the artifact from "My Artifacts"
