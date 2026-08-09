Feature: Discover and download shared artifacts via an agent (MCP)
  As a reviewer (User B) using Claude Desktop
  I want to find artifacts shared with me recently and save one to disk
  So that I can review it without bloating the agent's context with file bytes

  Background:
    Given User B is a registered user in the "Product" group
    And User B has authenticated to the MCP server via Claude Desktop
    And several artifacts have been shared with User B, some within the last 24 hours

  Scenario: List artifacts shared with me in the last 24 hours as a table
    When User B asks Claude "Which artifacts have been shared with me in the last 24 hours?"
    And Claude calls the "list_shared_with_me" tool with a 24 hour window
    Then all matching artifacts are returned in the tool result
    And only the first 10 are shown to the user
    And the shown rows form a markdown table with a numeric identifier, filetype, publishingUserName, and publicationDate

  Scenario: Download a selected artifact as an MCP Resource
    Given Claude has listed the shared artifacts with numeric identifiers
    When Claude asks whether User B wants to download any of them
    And User B selects an artifact by its numeric identifier
    Then Claude reads the artifact via its resource uri "artifact://<id>"
    And the artifact bytes are delivered as an MCP Resource with the correct mimeType
    And the file bytes are never returned as a tool result
    And Claude offers User B the option to save the artifact
    When User B chooses to save
    Then the host writes the file to disk (host-mediated save)

  Scenario: Access is re-authorized on each resource read
    Given the owner has since changed the policy to exclude User B
    When Claude attempts to read the artifact resource again
    Then the read is denied
