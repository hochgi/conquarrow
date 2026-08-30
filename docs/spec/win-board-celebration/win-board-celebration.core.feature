# language: en
# Overview: docs/spec/win-board-celebration/win-board-celebration.md
# SPEC §9 (read), §7 shares vs land

Feature: Win board celebration — banner, shine, pulse, quiet board
  As a player who just won or lost
  I want the board itself to show who won, without a splash
  So that I can still pan around the match I built

  Background:
    Given a GameState and a GeometryPort
    And player labels are styleFor (Player A / Player B)

  Rule: The banner names the winner and no mechanism

    # Superseded by P36: the banner names no mechanism.
    Scenario: The banner names the winner and no mechanism
      Given A is the winner
      And only A has heads remaining
      Then victoryFx carries no how field
      And the banner is "Player A wins"

    # Superseded by P36: a lost seat vanishes, so no victim survives a win.
    Scenario: The banner is the same however the match was won
      Given A is the winner
      And B still has at least one head
      Then victoryFx carries no how field
      And the banner is "Player A wins"

    Scenario: In play the turn banner is unchanged
      Given winner is unset
      Then victoryFx.kind is playing
      And there is no win banner
      And the turn banner still names the active player

  Rule: Shine is shares, pulse is stacks

    Scenario: Winner shares shine; non-share territory does not
      Given A is the winner
      And A owns territory on spawner-border arrows s1 and s2
      And A owns territory on a non-share arrow t1
      Then shine includes s1 and s2
      And shine does not include t1

    Scenario: Winner stacks pulse; loser stacks do not
      Given A is the winner
      And A has a group on g1
      And B has a group on g2
      Then pulse includes g1
      And pulse does not include g2

    Scenario: Yield-soon is suppressed when over
      Given A is the winner
      And a share would otherwise be yield-soon
      Then yield-soon shine is not applied
      And that share shines only if it is in the winner share set

    Scenario: Yield-soon still works in play
      Given winner is unset
      And share s1 will birth a head on the next full round
      Then yield-soon includes s1 at full strength
      And victory shine is empty

  Rule: The rest of the board goes quiet

    Scenario: Non-winner arrows dim; winner territory does not
      Given A is the winner
      And x is empty ground
      And y is B territory
      And z is A territory
      Then x is dimmed
      And y is dimmed
      And z is not dimmed

    Scenario: Match-over hint and controls
      Given A is the winner
      Then the HUD hint is "Match over — pan to look around"
      And End turn is disabled
      # *Skip group* was the other locked control; P50 removed the button and
      # P51 removed the move it sent.
