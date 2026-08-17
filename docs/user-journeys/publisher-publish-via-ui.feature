Feature: Publish an artifact from the web app
  As a publisher (User A) signed into the Artifact Hub web app
  I want to upload a file and set its access policy without leaving the browser
  So that I can publish something without switching to an agent

  Background:
    Given User A is a registered, active user
    And User A is signed into the Artifact Hub web app
    And the group "Design" exists

  Scenario: Publish a file to a group via the two-step modal
    Given User A is on the Dashboard
    When User A clicks "Publish New Artifact"
    Then a modal opens on step 1, "Choose a file"
    When User A selects a file named "roadmap.pdf" from their device
    Then the modal shows the file's name, size, and content type
    And the "Next" button becomes enabled
    When User A clicks "Next"
    Then the modal advances to step 2, "Access policy"
    When User A sets the audience to the group "Design"
    And User A leaves the expiry as "Never"
    And User A clicks "Publish"
    Then the artifact is created with title "roadmap.pdf"
    And the file's bytes are uploaded directly to object storage via a presigned URL
    And the artifact has audience type "user_groups" allowing "Design"
    And the artifact never expires
    And User A is recorded as the owner
    And the modal closes and My Artifacts shows the new artifact

  Scenario: Cannot publish without picking an audience
    Given User A is on step 2 of the Publish New Artifact modal with "Specific people" selected
    And User A has not selected anyone from the combo box
    When User A clicks "Publish"
    Then an inline message says to select at least one person
    And no artifact is created

  Scenario: "Specific people" only allows picking real users, never free text
    Given User A is on step 2 of the Publish New Artifact modal
    When User A sets the audience to "Specific people"
    Then User A sees a checkbox list of real user accounts (by email)
    And there is no free-text field to type an arbitrary email into

  Scenario: A newly published artifact starts with only a filename-derived title
    Given User A has just published "roadmap.pdf" via the web app
    When User A opens the artifact's detail page
    Then the title reads "roadmap.pdf"
    And there is no control to rename it (artifact editing is out of scope for v1)
    But User A can still widen or narrow who can see it via the access policy editor there
