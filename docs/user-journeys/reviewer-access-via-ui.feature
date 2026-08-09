Feature: Access and review an artifact via the web UI
  As a reviewer (User B) in the Product team
  I want to open a shared link, sign in, and review the artifact
  So that I can view, download, and comment on it

  Background:
    Given User B is a registered user in the "Product" group
    And User A has published an artifact whose policy permits the "Product" group
    And the artifact's policy has not expired
    And User A shared a link with User B

  Scenario: Sign in and view the artifact from a shared link
    When User B clicks the shared link
    Then User B is directed to the frontend
    And User B is required to sign in
    When User B enters their email and receives a magic link
    And User B clicks the magic link and is authenticated
    Then User B is redirected to the artifact detail view
    And User B can view the artifact
    And User B can download the artifact
    And the view and the download are each recorded as access events

  Scenario: Read and add a comment
    Given User B is viewing the artifact detail view
    Then User B can see comments from other users with body, author name, and date
    When User B adds a comment
    Then the comment is saved and attributed to User B
    And the new comment appears in the comments list with the current date

  Scenario: A user outside the audience is denied
    Given User C is authenticated but is not in the "Product" group
    And User C is not individually granted access
    When User C opens the shared link and logs in
    Then access to the artifact is denied
